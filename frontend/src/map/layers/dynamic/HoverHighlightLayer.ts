import type {
  AirportArea,
  NetworkPayload,
  RailLine,
  RoadEdge,
  Point,
} from "../../../types";
import { appendCell, roadCellScale, roadOutlineScale } from "../../core/geometry";
import type { MapHoverInfo } from "../../interaction/types";
import type { LandUseArea } from "../static/landUseAreas";
import { LAND_USE_COLOURS } from "../landUseStyles";

interface HoverHighlightOptions {
  network: NetworkPayload;
  hover: MapHoverInfo | null;
  roadGroups: Map<string, RoadEdge[]>;
  railLines: Map<string, RailLine>;
  airportAreas: Map<string, AirportArea>;
  landUseSectors: Map<string, LandUseArea>;
  elapsedSeconds: number;
}

function fillPixels(
  context: CanvasRenderingContext2D,
  pixels: readonly Point[],
  resolution: number,
  scale: number,
) {
  const path = new Path2D();
  const seen = new Set<string>();
  pixels.forEach(([x, y]) => {
    const key = `${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    appendCell(path, x, y, resolution, scale);
  });
  context.fill(path);
}

function drawRoadHighlight(
  context: CanvasRenderingContext2D,
  edges: readonly RoadEdge[],
  resolution: number,
  pulse: number,
  tone: "default" | "roadwork" = "default",
) {
  if (!edges.length) return;
  const roadClass = edges[0].highway_class;
  const pixels = edges.flatMap((edge) => edge.pixels);
  const palette =
    tone === "roadwork"
      ? {
          shadow: "rgba(150, 112, 34, 0.9)",
          fill: "#9e7924",
          outlineAlpha: 0.2 + pulse * 0.1,
          bodyAlpha: 0.34 + pulse * 0.14,
        }
      : {
          shadow: "rgba(205, 235, 255, 0.9)",
          fill: "#dbefff",
          outlineAlpha: 0.15 + pulse * 0.1,
          bodyAlpha: 0.32 + pulse * 0.16,
        };

  context.save();
  context.globalCompositeOperation = "lighter";
  context.shadowColor = palette.shadow;
  context.shadowBlur = 7;
  context.fillStyle = palette.fill;
  context.globalAlpha = palette.outlineAlpha;
  fillPixels(context, pixels, resolution, roadOutlineScale(roadClass) + 0.16);
  context.shadowBlur = 0;
  context.globalAlpha = palette.bodyAlpha;
  fillPixels(context, pixels, resolution, roadCellScale(roadClass) + 0.08);
  context.restore();
}

function drawRailHighlight(
  context: CanvasRenderingContext2D,
  line: RailLine,
  resolution: number,
  pulse: number,
) {
  context.save();
  context.globalCompositeOperation = "lighter";
  context.shadowColor = line.colour;
  context.shadowBlur = 10;
  context.fillStyle = line.colour;
  context.globalAlpha = 0.1 + pulse * 0.08;
  fillPixels(
    context,
    line.pixels,
    resolution,
    1.48,
  );
  context.shadowBlur = 0;
  context.globalAlpha = 0.08 + pulse * 0.05;
  fillPixels(
    context,
    line.pixels,
    resolution,
    0.52,
  );
  context.restore();
}

function drawSpans(
  context: CanvasRenderingContext2D,
  spans: readonly [number, number, number][],
  resolution: number,
) {
  const unit = 1 / resolution;
  spans.forEach(([y, start, end]) => {
    context.fillRect(start * unit, y * unit, (end - start + 1) * unit, unit);
  });
}

function drawAirportHighlight(
  context: CanvasRenderingContext2D,
  airport: AirportArea,
  resolution: number,
  pulse: number,
) {
  const unit = 1 / resolution;

  context.save();
  context.globalCompositeOperation = "source-over";
  context.shadowBlur = 0;
  context.fillStyle = "#9adaff";
  context.globalAlpha = 0.1 + pulse * 0.04;
  drawSpans(context, airport.ground_spans, resolution);
  drawSpans(context, airport.terminal_spans, resolution);

  context.globalAlpha = 0.34 + pulse * 0.1;
  airport.taxiway_pixels.forEach(([x, y]) =>
    context.fillRect(x * unit, y * unit, unit, unit),
  );
  context.globalAlpha = 0.5 + pulse * 0.12;
  airport.runway_pixels.forEach(([x, y]) =>
    context.fillRect(x * unit, y * unit, unit, unit),
  );
  context.restore();
}

function drawLandUseHighlight(
  context: CanvasRenderingContext2D,
  area: LandUseArea,
  resolution: number,
  pulse: number,
) {
  const colours =
    LAND_USE_COLOURS[area.category] ?? LAND_USE_COLOURS.transport;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.shadowColor = colours.outline;
  context.shadowBlur = 7;
  context.fillStyle = colours.outline;
  context.globalAlpha = 0.14 + pulse * 0.08;
  drawSpans(context, area.spans, resolution);
  context.shadowBlur = 2;
  context.globalAlpha = 0.58 + pulse * 0.16;
  drawSpans(context, area.outline_spans, resolution);
  context.restore();
}

export function drawHoverHighlight(
  context: CanvasRenderingContext2D,
  {
    network,
    hover,
    roadGroups,
    railLines,
    airportAreas,
    landUseSectors,
    elapsedSeconds,
  }: HoverHighlightOptions,
) {
  const target = hover?.target;
  if (!target) return;
  const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * 5.2);
  if (target.kind === "road") {
    drawRoadHighlight(
      context,
      roadGroups.get(target.key) ?? [],
      network.resolution,
      pulse,
      target.tone,
    );
  } else if (target.kind === "rail") {
    const line = railLines.get(target.ref);
    if (line) drawRailHighlight(context, line, network.resolution, pulse);
  } else if (target.kind === "airport") {
    const airport = airportAreas.get(target.id);
    if (airport) {
      drawAirportHighlight(context, airport, network.resolution, pulse);
    }
  } else {
    const area = landUseSectors.get(target.id);
    if (area) {
      drawLandUseHighlight(context, area, network.resolution, pulse);
    }
  }
}
