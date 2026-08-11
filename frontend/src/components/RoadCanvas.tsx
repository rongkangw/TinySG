import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { blendHex, daylightAt } from "../map/core/time";
import {
  drawTrains,
  prepareTrainLines,
} from "../map/layers/dynamic/rail/TrainLayer";
import { prepareRailInfrastructure } from "../map/layers/static/RailInfrastructureLayer";
import { prepareMainMap } from "../map/layers/static/MainMapLayer";
import { prepareLandUseOverlay } from "../map/layers/static/LandUseOverlayLayer";
import {
  drawLandUseLights,
  prepareLandUseLights,
} from "../map/layers/dynamic/LandUseLightsLayer";
import { drawRunwayLights } from "../map/layers/dynamic/RunwayLightsLayer";
import {
  busPositionAt,
  drawBuses,
  prepareBusRoutes,
} from "../map/layers/dynamic/vehicles/BusLayer";
import {
  drawBackgroundTraffic,
  matchTrafficSpeedBands,
  prepareBackgroundTraffic,
} from "../map/layers/dynamic/vehicles/BackgroundTrafficLayer";
import { prepareRoadworksLayer } from "../map/layers/dynamic/RoadworksLayer";
import { drawIncidents } from "../map/layers/dynamic/IncidentLayer";
import { drawLightning } from "../map/layers/dynamic/LightningLayer";
import { drawHoverHighlight } from "../map/layers/dynamic/HoverHighlightLayer";
import {
  aircraftPositionAt,
  drawAircraft,
  prepareAircraftJourneys,
} from "../map/layers/dynamic/vehicles/AircraftLayer";
import {
  drawClouds,
  prepareCloudSprites,
} from "../map/layers/dynamic/CloudLayer";
import {
  renderLayerStack,
  type LayerDrawCommand,
} from "../map/layers/compositor";
import { useMapInteraction } from "../map/interaction/useMapInteraction";
import {
  isMajorRoadHoverClass,
  roadEdgeHoverKey,
} from "../map/interaction/hoverKey";
import type { MapFocusTarget } from "../map/interaction/types";
import {
  cameraForWorldFocus,
  cameraTransform,
} from "../map/interaction/cameraTransform";
import { orderRailLines } from "../map/layers/static/railPaintPlan";
import {
  buildLandUseAreaGrid,
  buildLandUseAreas,
} from "../map/layers/static/landUseAreas";
import type {
  DashboardConfig,
  CityDataPayload,
  Incident,
  AirportArea,
  NetworkPayload,
  Point,
  RoadEdge,
  RoadState,
} from "../types";

interface Props {
  network: NetworkPayload;
  roadState: Map<number, RoadState>;
  config: DashboardConfig;
  cityData: CityDataPayload | null;
  incidents: Incident[];
  backgroundTraffic: boolean;
  landUseOverlay: boolean;
  focusTarget?: MapFocusTarget | null;
  onFps?: (fps: number) => void;
}

export function RoadCanvas({
  network,
  roadState,
  config,
  cityData,
  incidents,
  backgroundTraffic,
  landUseOverlay,
  focusTarget,
  onFps,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const trainEpochRef = useRef(performance.now());
  const cloudRainDarknessRef = useRef(0);
  const [size, setSize] = useState({ width: 1200, height: 800, dpr: 1 });

  const edgeMap = useMemo(
    () => new Map(network.edges.map((edge) => [edge.id, edge])),
    [network],
  );

  const staticLayers = useMemo(
    () => prepareMainMap(network, config.rendering),
    [config.rendering, network],
  );

  const landUseOverlayLayer = useMemo(
    () => prepareLandUseOverlay(network, staticLayers.landPath),
    [network, staticLayers.landPath],
  );

  const landUseLights = useMemo(
    () => prepareLandUseLights(network),
    [network],
  );

  const railLayer = useMemo(
    () => prepareRailInfrastructure(network),
    [network],
  );

  const trainLines = useMemo(() => prepareTrainLines(network), [network]);

  const roadCells = useMemo(() => {
    const cells = new Map<string, RoadEdge>();
    network.edges.forEach((edge) => {
      if (!isMajorRoadHoverClass(edge.highway_class)) return;
      edge.pixels.forEach(([x, y]) => cells.set(`${x}:${y}`, edge));
    });
    return cells;
  }, [network]);

  const roadHoverGroups = useMemo(() => {
    const groups = new Map<string, RoadEdge[]>();
    network.edges.forEach((edge) => {
      if (!isMajorRoadHoverClass(edge.highway_class)) return;
      const key = roadEdgeHoverKey(edge);
      const group = groups.get(key) ?? [];
      group.push(edge);
      groups.set(key, group);
    });
    return groups;
  }, [network]);

  const railHoverLines = useMemo(
    () =>
      new Map(
        (network.rail?.lines ?? [])
          .filter((line) => !line.future && line.route !== "light_rail")
          .map((line) => [line.ref, line]),
      ),
    [network.rail],
  );

  const railCells = useMemo(() => {
    const cells = new Map<
      string,
      NonNullable<typeof network.rail>["lines"][number]
    >();
    orderRailLines(
      (network.rail?.lines ?? []).filter(
        (line) => !line.future && line.route !== "light_rail",
      ),
    ).forEach((line) => {
      line.pixels.forEach(([x, y]) => cells.set(`${x}:${y}`, line));
    });
    return cells;
  }, [network.rail]);

  const airportCells = useMemo(() => {
    const cells = new Map<string, AirportArea>();
    const addPixel = (airport: AirportArea, [x, y]: [number, number]) =>
      cells.set(`${x}:${y}`, airport);
    (network.environment_overlay.airports.airport_areas ?? []).forEach(
      (airport) => {
        airport.ground_spans.forEach(([y, start, end]) => {
          for (let x = start; x <= end; x += 1) {
            cells.set(`${x}:${y}`, airport);
          }
        });
        airport.terminal_spans.forEach(([y, start, end]) => {
          for (let x = start; x <= end; x += 1) {
            cells.set(`${x}:${y}`, airport);
          }
        });
        airport.taxiway_pixels.forEach((pixel) => addPixel(airport, pixel));
        airport.runway_pixels.forEach((pixel) => addPixel(airport, pixel));
        airport.runway_light_pixels.forEach((pixel) =>
          addPixel(airport, pixel),
        );
        airport.runway_threshold_pixels.forEach((pixel) =>
          addPixel(airport, pixel),
        );
      },
    );
    return cells;
  }, [network]);

  const airportHoverAreas = useMemo(
    () =>
      new Map(
        (network.environment_overlay.airports.airport_areas ?? []).map(
          (airport) => [airport.id, airport],
        ),
      ),
    [network],
  );

  const landUseAreas = useMemo(
    () => {
      if (!landUseOverlay) return [];
      return buildLandUseAreas(
        network.environment_overlay.land_use.sectors,
        network.resolution,
      );
    },
    [landUseOverlay, network],
  );

  const landUseCells = useMemo(
    () =>
      landUseOverlay
        ? buildLandUseAreaGrid(landUseAreas, network.resolution)
        : [],
    [landUseAreas, landUseOverlay, network.resolution],
  );

  const landUseHoverSectors = useMemo(
    () => new Map(landUseAreas.map((area) => [area.id, area])),
    [landUseAreas],
  );

  const busPixelRoutes = useMemo(
    () =>
      prepareBusRoutes(
        cityData?.buses.vehicles ?? [],
        network.resolution,
      ),
    [cityData?.buses.vehicles, network.resolution],
  );

  const trafficCars = useMemo(
    () => prepareBackgroundTraffic(network),
    [network],
  );

  const trafficBands = useMemo(
    () => matchTrafficSpeedBands(trafficCars, cityData, edgeMap),
    [edgeMap, cityData, trafficCars],
  );

  const airJourneys = useMemo(
    () => prepareAircraftJourneys(network),
    [network],
  );

  const cloudSprites = useMemo(() => prepareCloudSprites(), []);

  const roadworksLayer = useMemo(
    () =>
      prepareRoadworksLayer(
        network,
        edgeMap,
        cityData?.roadworks.works ?? [],
      ),
    [edgeMap, cityData?.roadworks.works, network],
  );

  const ambientCells = useMemo(
    () =>
      Array.from({ length: 64 }, (_, index) => ({
        x: ((index * 137 + 41) % 997) / 997,
        y: ((index * 251 + 79) % 991) / 991,
        phase: (index * 0.618) % 1,
      })),
    [],
  );

  const { camera, cameraTween, dragging, hover } = useMapInteraction({
    containerRef,
    network,
    config,
    cityData,
    incidents,
    edgeMap,
    roadCells,
    roadGroups: roadHoverGroups,
    railCells,
    airportCells,
    landUseOverlay,
    landUseCells,
    busPixelRoutes,
    trainLines,
    trainEpochMs: trainEpochRef.current,
    aircraftJourneys: airJourneys,
    focusTarget,
    size,
  });

  const liveScene = useRef({
    backgroundTraffic,
    busPixelRoutes,
    cityData,
    focusTarget,
    hover,
    landUseOverlay,
    onFps,
    roadState,
    roadworksLayer,
    trafficBands,
  });
  liveScene.current = {
    backgroundTraffic,
    busPixelRoutes,
    cityData,
    focusTarget,
    hover,
    landUseOverlay,
    onFps,
    roadState,
    roadworksLayer,
    trafficBands,
  };

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
        dpr: Math.min(1.5, window.devicePixelRatio || 1),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frames = 0;
    let fpsClock = performance.now();
    let lastPaint = 0;
    const minimumFrameMs = 1000 / 30;

    const render = (now: number) => {
      if (now - lastPaint < minimumFrameMs) {
        frameRef.current = requestAnimationFrame(render);
        return;
      }
      lastPaint = now;
      frames += 1;
      if (now - fpsClock >= 1000) {
        liveScene.current.onFps?.(
          Math.round((frames * 1000) / (now - fpsClock)),
        );
        frames = 0;
        fpsClock = now;
      }

      const seconds = now / 1000;
      const daylight = daylightAt(Date.now());
      const tween = cameraTween.current;
      if (tween) {
        const linear = Math.max(0, Math.min(1, (now - tween.startedAt) / 900));
        const eased = 1 - (1 - linear) ** 3;
        camera.current = {
          zoom: tween.from.zoom + (tween.to.zoom - tween.from.zoom) * eased,
          x: tween.from.x + (tween.to.x - tween.from.x) * eased,
          y: tween.from.y + (tween.to.y - tween.from.y) * eased,
        };
        if (linear >= 1) cameraTween.current = null;
      }
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      context.fillStyle = blendHex(
        config.rendering.background,
        "#123244",
        daylight,
      );
      context.fillRect(0, 0, size.width, size.height);

      ambientCells.forEach((cell) => {
        const energy =
          (0.16 + 0.12 * Math.sin(seconds * 0.34 + cell.phase * 6.28)) *
          (1 - daylight * 0.72);
        context.fillStyle = `rgba(105, 119, 137, ${Math.max(0.03, energy)})`;
        context.fillRect(cell.x * size.width, cell.y * size.height, 1.3, 1.3);
      });

      const { scale, originX, originY } = cameraTransform(
        camera.current,
        size,
      );
      context.save();
      context.setTransform(
        scale * size.dpr,
        0,
        0,
        scale * size.dpr,
        originX * size.dpr,
        originY * size.dpr,
      );
      context.imageSmoothingEnabled = false;
      const epochMs = Date.now();
      const trainElapsed = (now - trainEpochRef.current) / 1000;
      const current = liveScene.current;
      const tracking = current.focusTarget?.follow;
      if (tracking && !cameraTween.current) {
        let trackedWorld: Point | null = null;
        if (tracking.kind === "bus") {
          const vehicle = current.cityData?.buses.vehicles.find(
            (candidate) => candidate.id === tracking.id,
          );
          if (vehicle) {
            trackedWorld = busPositionAt(
              vehicle,
              current.busPixelRoutes,
              epochMs,
            );
          }
        } else {
          const journey = airJourneys[tracking.index];
          const point = journey
            ? aircraftPositionAt(journey, seconds, tracking.index)
            : null;
          if (point) {
            trackedWorld = [
              (point[0] + 0.5) / network.resolution,
              (point[1] + 0.5) / network.resolution,
            ];
          }
        }
        if (trackedWorld) {
          const target = cameraForWorldFocus(
            trackedWorld[0],
            trackedWorld[1],
            Math.min(
              config.camera.maximum_zoom,
              Math.max(
                config.camera.default_zoom,
                current.focusTarget?.zoom ?? 8,
              ),
            ),
            size,
          );
          camera.current = {
            zoom: camera.current.zoom + (target.zoom - camera.current.zoom) * 0.12,
            x: camera.current.x + (target.x - camera.current.x) * 0.12,
            y: camera.current.y + (target.y - camera.current.y) * 0.12,
          };
        }
      }
      const layers: LayerDrawCommand[] = [
        {
          id: "baseMap",
          draw: (layerContext) => {
            layerContext.drawImage(staticLayers.night, 0, 0, 1, 1);
            if (daylight > 0.001) {
              layerContext.globalAlpha = daylight;
              layerContext.drawImage(staticLayers.day, 0, 0, 1, 1);
            }
          },
        },
        {
          id: "sectorLights",
          draw: (layerContext) =>
            drawLandUseLights(
              layerContext,
              landUseLights,
              network.resolution,
              epochMs,
              seconds,
            ),
        },
        {
          id: "runwayLights",
          draw: (layerContext) =>
            drawRunwayLights(layerContext, network, seconds, daylight),
        },
        {
          id: "roadworks",
          draw: (layerContext) =>
            layerContext.drawImage(current.roadworksLayer, 0, 0, 1, 1),
        },
        {
          id: "incidents",
          draw: (layerContext) =>
            drawIncidents(
              layerContext,
              current.roadState,
              edgeMap,
              network.resolution,
              config,
              scale,
            ),
        },
        {
          id: "buses",
          draw: (layerContext) =>
            drawBuses(
              layerContext,
              current.cityData,
              current.busPixelRoutes,
              network.resolution,
              epochMs,
              seconds,
            ),
        },
        {
          id: "railInfrastructure",
          draw: (layerContext) =>
            layerContext.drawImage(railLayer, 0, 0, 1, 1),
        },
        {
          id: "trains",
          draw: (layerContext) =>
            drawTrains(
              layerContext,
              trainLines,
              network.resolution,
              trainElapsed,
            ),
        },
        {
          id: "aircraft",
          draw: (layerContext) =>
            drawAircraft(
              layerContext,
              airJourneys,
              network.resolution,
              seconds,
            ),
        },
        {
          id: "lightning",
          draw: (layerContext) =>
            drawLightning(
              layerContext,
              current.cityData?.lightning ?? [],
              network.resolution,
              now,
            ),
        },
        {
          id: "clouds",
          draw: (layerContext) => {
            cloudRainDarknessRef.current = drawClouds(
              layerContext,
              cloudSprites,
              current.cityData,
              network.resolution,
              seconds,
              cloudRainDarknessRef.current,
            );
          },
        },
        {
          id: "hoverHighlight",
          draw: (layerContext) =>
            drawHoverHighlight(layerContext, {
              network,
              hover: current.hover,
              roadGroups: roadHoverGroups,
              railLines: railHoverLines,
              airportAreas: airportHoverAreas,
              landUseSectors: landUseHoverSectors,
              elapsedSeconds: seconds,
            }),
        },
      ];
      if (current.landUseOverlay) {
        layers.push({
          id: "landUseOverlay",
          draw: (layerContext) =>
            layerContext.drawImage(landUseOverlayLayer, 0, 0, 1, 1),
        });
      }
      if (current.backgroundTraffic) {
        layers.push({
          id: "backgroundTraffic",
          draw: (layerContext) =>
            drawBackgroundTraffic(
              layerContext,
              trafficCars,
              current.trafficBands,
              network.resolution,
              seconds,
              daylight,
            ),
        });
      }
      renderLayerStack(context, layers);
      context.restore();

      frameRef.current = requestAnimationFrame(render);
    };
    frameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameRef.current);
  }, [
    ambientCells,
    airJourneys,
    cloudSprites,
    config,
    edgeMap,
    landUseOverlayLayer,
    landUseLights,
    landUseHoverSectors,
    network,
    railLayer,
    railHoverLines,
    airportHoverAreas,
    roadHoverGroups,
    size,
    staticLayers,
    trafficCars,
    trainLines,
  ]);

  return (
    <div
      ref={containerRef}
      className={`ambient-world ${dragging ? "is-dragging" : ""}`}
      aria-label="Living Singapore traffic map"
    >
      <canvas ref={canvasRef} />
      <div className="world-vignette" />
      {hover && (
        <div
          className="pixel-tooltip"
          style={{
            left: Math.max(8, Math.min(size.width - 300, hover.x + 14)),
            top: Math.max(76, Math.min(size.height - 252, hover.y - 12)),
          }}
        >
          <span className="tooltip-kicker">{hover.kicker}</span>
          <strong className="tooltip-title">{hover.title}</strong>
          {hover.detail && <small className="tooltip-detail">{hover.detail}</small>}
          {hover.rows && hover.rows.length > 0 && (
            <div className="tooltip-rows">
              {hover.rows.map((row, index) => (
                <div
                  className={`tooltip-row is-${row.tone ?? "default"}`}
                  key={`${row.label}-${index}`}
                >
                  <span>
                    {row.icon && (
                      <i
                        className={`tooltip-row-icon is-${row.icon}`}
                        aria-hidden="true"
                      >
                        ✈︎
                      </i>
                    )}
                    {row.label}
                  </span>
                  <strong>{row.value}</strong>
                  {row.progress !== undefined && (
                    <i aria-hidden="true">
                      <b
                        style={{
                          width: `${Math.max(0, Math.min(1, row.progress)) * 100}%`,
                        }}
                      />
                    </i>
                  )}
                </div>
              ))}
            </div>
          )}
          {hover.meta && <div className="tooltip-note">{hover.meta}</div>}
        </div>
      )}
    </div>
  );
}
