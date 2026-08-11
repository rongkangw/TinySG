import type {
  DashboardConfig,
  RoadEdge,
  RoadState,
} from "../../../types";
import { appendCell, cellsAround } from "../../core/geometry";

export function drawIncidents(
  context: CanvasRenderingContext2D,
  roadState: Map<number, RoadState>,
  edgeMap: Map<number, RoadEdge>,
  resolution: number,
  config: DashboardConfig,
  worldScale: number,
) {
  roadState.forEach((state, edgeId) => {
    const edge =
      edgeMap.get(edgeId) ??
      ({
        id: edgeId,
        road: "",
        highway_class: state.highway_class,
        points: [],
        pixels: state.pixels,
      } as RoadEdge);
    const normalizedIntensity =
      state.intensity / config.animation.maximum_intensity;
    cellsAround(edge, state.phase, resolution).forEach(
      ({ pixel: [x, y], falloff }) => {
        const energy = normalizedIntensity * falloff;
        const cell = new Path2D();
        appendCell(cell, x, y, resolution);
        context.fillStyle = config.rendering.ping_colours.new;
        context.globalAlpha = Math.max(
          0,
          Math.min(0.95, energy * 2.2),
        );
        context.shadowColor = config.rendering.ping_colours.new;
        context.shadowBlur = energy > 0.55 ? 2.5 / worldScale : 0;
        context.fill(cell);
      },
    );
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}
