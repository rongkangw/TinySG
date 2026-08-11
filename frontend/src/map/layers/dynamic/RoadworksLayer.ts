import type {
  NetworkPayload,
  RoadEdge,
  Roadwork,
} from "../../../types";
import { appendCell, cellsAround } from "../../core/geometry";

export function prepareRoadworksLayer(
  network: NetworkPayload,
  edgeMap: Map<number, RoadEdge>,
  works: Roadwork[],
) {
  const canvas = document.createElement("canvas");
  canvas.width = network.resolution;
  canvas.height = network.resolution;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.setTransform(
    network.resolution,
    0,
    0,
    network.resolution,
    0,
    0,
  );
  const groups = new Map<string, Path2D>();
  works.forEach((work) => {
    const edge =
      edgeMap.get(work.edge_id) ??
      ({
        id: work.edge_id,
        road: work.road,
        highway_class: work.highway_class,
        points: [],
        pixels: work.pixels,
      } as RoadEdge);
    if (!edge.pixels.length) return;
    cellsAround(edge, work.phase, network.resolution).forEach(
      ({ pixel: [x, y], falloff }) => {
        if (falloff < 0.14) return;
        const bucket = Math.min(7, Math.floor(falloff * 8));
        const key = `${work.simulated ? "sim" : "live"}:${bucket}`;
        const path = groups.get(key) ?? new Path2D();
        appendCell(path, x, y, network.resolution, 0.82);
        groups.set(key, path);
      },
    );
  });
  groups.forEach((path, key) => {
    const [source, bucketText] = key.split(":");
    const falloff = (Number(bucketText) + 0.5) / 8;
    const alpha =
      source === "sim"
        ? 0.07 + falloff * 0.24
        : 0.065 + falloff * 0.22;
    context.fillStyle =
      source === "sim"
        ? `rgba(166, 126, 34, ${alpha})`
        : `rgba(184, 138, 36, ${alpha})`;
    context.fill(path);
  });
  context.globalAlpha = 1;
  return canvas;
}
