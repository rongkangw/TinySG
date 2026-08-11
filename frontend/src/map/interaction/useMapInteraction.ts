import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  DashboardConfig,
  CityDataPayload,
  Incident,
  NetworkPayload,
  Point,
  AirportArea,
  RailLine,
  RoadEdge,
} from "../../types";
import { cleanRoadworkMessage } from "../../features/roadworks/roadworkCopy";
import {
  formatRoadworkDate,
  roadworkCompletion,
} from "../../features/roadworks/roadworkProgress";
import {
  busNextStopStatus,
  busPositionAt,
} from "../layers/dynamic/vehicles/BusLayer";
import type { AircraftJourney } from "../layers/dynamic/vehicles/AircraftLayer";
import type { TrainLineModel } from "../layers/dynamic/rail/TrainLayer";
import {
  activeTrainCount,
  formatArrivalSeconds,
  trainArrivalBoard,
  nextStationArrivalSeconds,
} from "../layers/dynamic/rail/trainStatus";
import type { LandUseArea } from "../layers/static/landUseAreas";
import {
  buildRoadSpeedSummaries,
  formatAverageSpeedRange,
} from "../traffic/speedBandMetrics";
import { isMajorRoadHoverClass, roadEdgeHoverKey } from "./hoverKey";
import {
  cameraForWorldFocus,
  cameraTransform,
  screenToWorld,
  zoomCameraAt,
  type MapCamera,
  type ViewportSize,
} from "./cameraTransform";
import type {
  CameraTween,
  MapFocusTarget,
  MapHoverInfo,
  MapHoverRow,
} from "./types";

interface UseMapInteractionOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  network: NetworkPayload;
  config: DashboardConfig;
  cityData: CityDataPayload | null;
  incidents: Incident[];
  edgeMap: Map<number, RoadEdge>;
  roadCells: Map<string, RoadEdge>;
  roadGroups: Map<string, RoadEdge[]>;
  railCells: Map<string, RailLine>;
  airportCells: Map<string, AirportArea>;
  landUseOverlay: boolean;
  landUseCells: readonly (LandUseArea | undefined)[];
  busPixelRoutes: Map<string, Point[]>;
  trainLines: TrainLineModel[];
  trainEpochMs: number;
  aircraftJourneys: AircraftJourney[];
  focusTarget?: MapFocusTarget | null;
  size: ViewportSize;
}

export function useMapInteraction({
  containerRef,
  network,
  config,
  cityData,
  incidents,
  edgeMap,
  roadCells,
  roadGroups,
  railCells,
  airportCells,
  landUseOverlay,
  landUseCells,
  busPixelRoutes,
  trainLines,
  trainEpochMs,
  aircraftJourneys,
  focusTarget,
  size,
}: UseMapInteractionOptions) {
  const camera = useRef<MapCamera>({
    zoom: config.camera.default_zoom,
    x: 0,
    y: 0,
  });
  const cameraTween = useRef<CameraTween | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<MapHoverInfo | null>(null);
  const roadSpeedSummaries = useMemo(
    () =>
      buildRoadSpeedSummaries(
        roadGroups,
        cityData?.traffic_speed_bands.bands ?? [],
      ),
    [cityData?.traffic_speed_bands.bands, roadGroups],
  );
  const hoverData = useRef({
    busPixelRoutes,
    cityData,
    incidents,
    roadSpeedSummaries,
  });
  hoverData.current = {
    busPixelRoutes,
    cityData,
    incidents,
    roadSpeedSummaries,
  };

  useEffect(() => {
    if (!focusTarget) return;
    let worldX: number;
    let worldY: number;
    if (focusTarget.world) {
      [worldX, worldY] = focusTarget.world;
    } else {
      const pixels =
        (focusTarget.edgeId !== undefined
          ? edgeMap.get(focusTarget.edgeId)?.pixels
          : undefined) ?? focusTarget.pixels;
      if (!pixels.length) return;
      const index = Math.round(
        Math.max(0, Math.min(1, focusTarget.phase ?? 0)) * (pixels.length - 1),
      );
      const [pixelX, pixelY] = pixels[index];
      worldX = (pixelX + 0.5) / network.resolution;
      worldY = (pixelY + 0.5) / network.resolution;
    }
    const zoom = Math.min(
      config.camera.maximum_zoom,
      Math.max(config.camera.default_zoom, focusTarget.zoom ?? 3.6),
    );
    cameraTween.current = {
      startedAt: performance.now(),
      from: { ...camera.current },
      to: cameraForWorldFocus(worldX, worldY, zoom, size),
    };
  }, [
    config.camera.default_zoom,
    config.camera.maximum_zoom,
    edgeMap,
    focusTarget,
    network.resolution,
    size,
  ]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const worldAt = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      const mouseX = event.clientX - bounds.left;
      const mouseY = event.clientY - bounds.top;
      const transform = cameraTransform(camera.current, bounds);
      const world = screenToWorld(mouseX, mouseY, transform);
      return {
        mouseX,
        mouseY,
        worldX: world.x,
        worldY: world.y,
        scale: transform.scale,
      };
    };
    const distanceTo = (worldX: number, worldY: number, point: Point) =>
      Math.hypot(worldX - point[0], worldY - point[1]);
    const edgePoint = (edgeId: number, phase: number): Point | null => {
      const edge = edgeMap.get(edgeId);
      if (!edge?.pixels.length) return null;
      const index = Math.round(
        Math.max(0, Math.min(1, phase)) * (edge.pixels.length - 1),
      );
      const [x, y] = edge.pixels[index];
      return [(x + 0.5) / network.resolution, (y + 0.5) / network.resolution];
    };
    const mrtLineRefs = new Set(
      (network.rail?.lines ?? [])
        .filter((line) => !line.future && line.route !== "light_rail")
        .map((line) => line.ref),
    );
    const trainLineModels = new Map(trainLines.map((line) => [line.ref, line]));
    const airportFlightCounts = new Map<
      string,
      { arrivals: number; departures: number }
    >();
    aircraftJourneys.forEach((journey) => {
      const counts = airportFlightCounts.get(journey.airport_id) ?? {
        arrivals: 0,
        departures: 0,
      };
      if (journey.operation === "arrival") counts.arrivals += 1;
      else counts.departures += 1;
      airportFlightCounts.set(journey.airport_id, counts);
    });
    const roadTargetFor = (
      edge: RoadEdge | undefined,
      tone: "default" | "roadwork" = "default",
    ) =>
      edge && isMajorRoadHoverClass(edge.highway_class)
        ? { kind: "road" as const, key: roadEdgeHoverKey(edge), tone }
        : undefined;
    const titleCase = (value: string) =>
      value
        .split("_")
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ");
    const findLandUseCell = (
      pixelX: number,
      pixelY: number,
      radius: number,
    ): LandUseArea | null => {
      for (let y = pixelY - radius; y <= pixelY + radius; y += 1) {
        if (y < 0 || y >= network.resolution) continue;
        for (let x = pixelX - radius; x <= pixelX + radius; x += 1) {
          if (x < 0 || x >= network.resolution) continue;
          const value = landUseCells[y * network.resolution + x];
          if (value) return value;
        }
      }
      return null;
    };
    const roadDetail = (edge: RoadEdge) => {
      const key = roadEdgeHoverKey(edge);
      const summary = hoverData.current.roadSpeedSummaries.get(key);
      const groupedEdges = roadGroups.get(key) ?? [edge];
      const groupedIds = new Set(groupedEdges.map((candidate) => candidate.id));
      const works =
        hoverData.current.cityData?.roadworks.works.filter((work) =>
          groupedIds.has(work.edge_id),
        ).length ?? 0;
      const activeIncidents = hoverData.current.incidents.filter((incident) =>
        groupedIds.has(incident.edge_id),
      ).length;
      const events = [
        activeIncidents
          ? `${activeIncidents} incident${activeIncidents === 1 ? "" : "s"}`
          : "",
        works ? `${works} work zone${works === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      const tone: MapHoverRow["tone"] = !summary
        ? "default"
        : summary.averageBand <= 3.5
          ? "slow"
          : summary.averageBand <= 5.5
            ? "busy"
            : "clear";
      const traffic = summary
        ? tone === "slow"
          ? "Traffic is moving slowly"
          : tone === "busy"
            ? "Traffic is moderately busy"
            : "Traffic is moving freely"
        : events.length
          ? "Traffic activity on this stretch"
          : "Major road";
      return {
        detail: traffic,
        meta: events.length ? events.join(" · ") : undefined,
        rows: summary
          ? [
              {
                label: "AVERAGE SPEED RANGE",
                value: formatAverageSpeedRange(summary),
                progress: 1 - (summary.averageBand - 1) / 7,
                tone,
              },
            ]
          : undefined,
      };
    };
    const trainElapsedSeconds = () =>
      Math.max(0, (performance.now() - trainEpochMs) / 1000);
    const updateHover = (event: PointerEvent) => {
      const position = worldAt(event);
      if (
        position.worldX < 0 ||
        position.worldX > 1 ||
        position.worldY < 0 ||
        position.worldY > 1
      ) {
        setHover(null);
        return;
      }
      const threshold = Math.max(7 / position.scale, 1.8 / network.resolution);
      const current = hoverData.current;
      const pixelX = Math.floor(position.worldX * network.resolution);
      const pixelY = Math.floor(position.worldY * network.resolution);
      const radius = Math.max(
        1,
        Math.min(4, Math.ceil((6 / position.scale) * network.resolution)),
      );
      const findMappedCell = <T>(cells: Map<string, T>): T | null => {
        for (let y = pixelY - radius; y <= pixelY + radius; y += 1) {
          for (let x = pixelX - radius; x <= pixelX + radius; x += 1) {
            const value = cells.get(`${x}:${y}`);
            if (value) return value;
          }
        }
        return null;
      };
      if (landUseOverlay) {
        const landUseArea = findLandUseCell(pixelX, pixelY, radius);
        if (landUseArea) {
          setHover({
            key: `landuse-${landUseArea.id}`,
            x: position.mouseX,
            y: position.mouseY,
            kicker: "LAND USE",
            title: titleCase(landUseArea.category),
            detail:
              landUseArea.category === "water"
                ? "Water body"
                : `${landUseArea.pixel_count.toLocaleString()} pixel sector`,
            meta:
              landUseArea.category === "residential"
                ? "Warm window lights stagger after dusk"
                : landUseArea.category === "commercial"
                  ? "Denser evening lights and late activity"
                  : landUseArea.category === "recreation"
                    ? "Sparse park and nature lighting"
                    : landUseArea.category === "water"
                      ? "No city lights here — just water"
                      : "A sector of the city.",
            target: { kind: "landUse", id: landUseArea.id },
          });
        } else {
          setHover(null);
        }
        return;
      }
      for (const incident of current.incidents) {
        const edge = edgeMap.get(incident.edge_id);
        const point =
          edgePoint(incident.edge_id, incident.phase) ??
          (() => {
            if (!incident.pixels?.length) return null;
            const index = Math.round(
              Math.max(0, Math.min(1, incident.phase)) *
                (incident.pixels.length - 1),
            );
            const [x, y] = incident.pixels[index];
            return [
              (x + 0.5) / network.resolution,
              (y + 0.5) / network.resolution,
            ] as Point;
          })();
        if (
          point &&
          distanceTo(position.worldX, position.worldY, point) <= threshold * 2
        ) {
          setHover({
            key: `incident-${incident.id}`,
            x: position.mouseX,
            y: position.mouseY,
            kicker: incident.simulated
              ? "SIMULATED TRAFFIC"
              : "TRAFFIC INCIDENT",
            title: incident.incident_type,
            detail: `${incident.road}${
              incident.message ? ` · ${incident.message}` : ""
            }`,
            target: roadTargetFor(edge),
          });
          return;
        }
      }
      for (const work of current.cityData?.roadworks.works ?? []) {
        const edge = edgeMap.get(work.edge_id);
        const point = edgePoint(work.edge_id, work.phase);
        const completion = roadworkCompletion(
          work.start_date,
          work.end_date,
        );
        if (
          point &&
          distanceTo(position.worldX, position.worldY, point) <= threshold * 2
        ) {
          setHover({
            key: `work-${work.id}`,
            x: position.mouseX,
            y: position.mouseY,
            kicker: work.simulated ? "SIMULATED WORKS" : "ROAD WORKS",
            title: work.road,
            detail: [
              work.department,
              work.end_date
                ? `Until ${formatRoadworkDate(work.end_date)}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
            meta: cleanRoadworkMessage(work.message) || undefined,
            rows:
              completion === null
                ? undefined
                : [
                    {
                      label: "WORK PROGRESS",
                      value: `${Math.round(completion * 100)}%`,
                      progress: completion,
                      tone: "busy",
                    },
                  ],
            target: roadTargetFor(edge, "roadwork"),
          });
          return;
        }
      }
      for (const vehicle of current.cityData?.buses.vehicles ?? []) {
        const point = busPositionAt(
          vehicle,
          current.busPixelRoutes,
          Date.now(),
        );
        if (
          distanceTo(position.worldX, position.worldY, point) <=
          threshold * 1.5
        ) {
          const load =
            vehicle.load === "LSD"
              ? "Crowded"
              : vehicle.load === "SDA"
                ? "Standing available"
                : "Seats available";
          const nextStop = busNextStopStatus(vehicle, Date.now());
          setHover({
            key: `bus-${vehicle.id}`,
            x: position.mouseX,
            y: position.mouseY,
            kicker: vehicle.simulated ? "SIMULATED BUS" : "BUS IN MOTION",
            title: `Service ${vehicle.service}`,
            detail: load,
            rows: [
              { label: "NEXT STOP", value: nextStop.stop },
              {
                label: "ARRIVAL",
                value: formatArrivalSeconds(nextStop.etaSeconds),
              },
            ],
            meta: `Travelling at ~${vehicle.estimated_speed_kmh.toFixed(0)} km/h`,
          });
          return;
        }
      }
      for (const station of network.rail?.stations ?? []) {
        const point: Point = [
          (station.pixel[0] + 0.5) / network.resolution,
          (station.pixel[1] + 0.5) / network.resolution,
        ];
        if (
          distanceTo(position.worldX, position.worldY, point) <=
          threshold * 1.5
        ) {
          setHover({
            key: `station-${station.id}`,
            x: position.mouseX,
            y: position.mouseY,
            kicker: station.lrt ? "LRT STATION" : "MRT STATION",
            title: station.name,
            detail: (() => {
              const lineRef =
                station.lines.find((line) => trainLineModels.has(line)) ??
                (trainLineModels.has(station.ref) ? station.ref : "");
              const line = trainLineModels.get(lineRef);
              const next = nextStationArrivalSeconds(
                line,
                station,
                trainElapsedSeconds(),
              );
              return lineRef
                ? next === null
                  ? "No train due yet"
                  : `Next ${lineRef} train · ${formatArrivalSeconds(next)}`
                : "No train due yet";
            })(),
            meta:
              station.lines.length > 0
                ? station.lines.join(" · ")
                : "Line association unavailable",
            target:
              (station.lines.find((line) => mrtLineRefs.has(line)) ??
              (mrtLineRefs.has(station.ref) ? station.ref : ""))
                ? {
                    kind: "rail",
                    ref:
                      station.lines.find((line) => mrtLineRefs.has(line)) ??
                      station.ref,
                  }
                : undefined,
          });
          return;
        }
      }
      const railLine = findMappedCell(railCells);
      if (railLine) {
        const line = trainLineModels.get(railLine.ref);
        const trains = activeTrainCount(line);
        const board = trainArrivalBoard(line, trainElapsedSeconds());
        setHover({
          key: `rail-${railLine.ref}`,
          x: position.mouseX,
          y: position.mouseY,
          kicker: railLine.route === "light_rail" ? "LRT LINE" : "MRT LINE",
          title: railLine.name || railLine.ref,
          detail: trains
            ? `${trains} train${trains === 1 ? "" : "s"} in service`
            : "This line is not currently operating!",
          rows: board.map((row) => ({
            label: `TOWARDS ${row.towards.toUpperCase()}`,
            value: `Next ${row.nextStation} · ${formatArrivalSeconds(row.etaSeconds)}`,
          })),
          meta: line
            ? trains
              ? `${line.stops.length} stops on this line`
              : "Typical service hours · 5:30 AM–12:30 AM"
            : "Typical service hours · 5:30 AM–12:30 AM",
          target: { kind: "rail", ref: railLine.ref },
        });
        return;
      }
      const airport = findMappedCell(airportCells);
      if (airport) {
        const counts = airportFlightCounts.get(airport.id) ?? {
          arrivals: 0,
          departures: 0,
        };
        const total = counts.arrivals + counts.departures;
        setHover({
          key: `airport-${airport.id}`,
          x: position.mouseX,
          y: position.mouseY,
          kicker: "AIRPORT",
          title: airport.name,
          detail: total
            ? `${total} aircraft in the current rotation`
            : "The airfield is quiet right now",
          rows: [
            {
              label: "DEPARTURES",
              value: `${counts.departures}`,
              icon: "takeoff",
              tone: "departure",
            },
            {
              label: "ARRIVALS",
              value: `${counts.arrivals}`,
              icon: "landing",
              tone: "arrival",
            },
          ],
          target: { kind: "airport", id: airport.id },
        });
        return;
      }
      for (let y = pixelY - radius; y <= pixelY + radius; y += 1) {
        for (let x = pixelX - radius; x <= pixelX + radius; x += 1) {
          const edge = roadCells.get(`${x}:${y}`);
          if (!edge) continue;
          const context = roadDetail(edge);
          setHover({
            key: `road-${edge.id}`,
            x: position.mouseX,
            y: position.mouseY,
            kicker: edge.highway_class.replace("_", " ").toUpperCase(),
            title: edge.road,
            detail: context.detail,
            meta: context.meta,
            rows: context.rows,
            target: { kind: "road", key: roadEdgeHoverKey(edge) },
          });
          return;
        }
      }
      setHover(null);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraTween.current = null;
      const bounds = element.getBoundingClientRect();
      const mouseX = event.clientX - bounds.left;
      const mouseY = event.clientY - bounds.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = Math.max(
        config.camera.minimum_zoom,
        Math.min(config.camera.maximum_zoom, camera.current.zoom * factor),
      );
      camera.current = zoomCameraAt(
        camera.current,
        bounds,
        mouseX,
        mouseY,
        nextZoom,
      );
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      cameraTween.current = null;
      element.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setDragging(true);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) {
        camera.current.x += event.clientX - drag.current.x;
        camera.current.y += event.clientY - drag.current.y;
        drag.current.x = event.clientX;
        drag.current.y = event.clientY;
        setHover(null);
        return;
      }
      updateHover(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      element.releasePointerCapture(event.pointerId);
    };
    const onDoubleClick = () => {
      cameraTween.current = null;
      camera.current = {
        zoom: config.camera.default_zoom,
        x: 0,
        y: 0,
      };
    };
    const onPointerLeave = () => setHover(null);

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("pointerleave", onPointerLeave);
    element.addEventListener("dblclick", onDoubleClick);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.removeEventListener("dblclick", onDoubleClick);
    };
  }, [
    config.camera,
    containerRef,
    edgeMap,
    roadCells,
    roadGroups,
    railCells,
    airportCells,
    landUseCells,
    landUseOverlay,
    trainEpochMs,
    trainLines,
    aircraftJourneys,
    network.rail,
    network.resolution,
  ]);

  return { camera, cameraTween, dragging, hover };
}
