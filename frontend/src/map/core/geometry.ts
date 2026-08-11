import type { Point, RoadEdge } from "../../types";

export const roadTier = (roadClass: string) =>
  roadClass.startsWith("motorway")
    ? "1"
    : roadClass.startsWith("trunk")
      ? "2"
      : roadClass.startsWith("primary")
        ? "3"
        : roadClass.startsWith("secondary")
          ? "4"
          : roadClass.startsWith("tertiary")
            ? "5"
            : roadClass === "residential" || roadClass === "unclassified"
              ? "6"
              : "7";

export const roadCellScale = (roadClass: string) =>
  roadClass.endsWith("_link")
    ? Math.max(0.48, Number(roadTier(roadClass)) <= 3 ? 0.72 : 0.58)
    : roadTier(roadClass) === "1"
      ? 0.96
      : roadTier(roadClass) === "2"
        ? 0.88
        : roadTier(roadClass) === "3"
          ? 0.8
          : roadTier(roadClass) === "4"
            ? 0.7
            : roadTier(roadClass) === "5"
              ? 0.62
              : roadTier(roadClass) === "6"
                ? 0.55
              : 0.49;

export const roadOutlineScale = (roadClass: string) =>
  Math.min(1.16, roadCellScale(roadClass) + 0.2);

export function appendCell(
  path: Path2D,
  x: number,
  y: number,
  resolution: number,
  scale = 1,
) {
  const unit = 1 / resolution;
  const cell = unit * 0.84 * scale;
  const inset = (unit - cell) / 2;
  const radius = Math.min(cell * 0.16, unit * 0.13);
  path.roundRect(
    x * unit + inset,
    y * unit + inset,
    cell,
    cell,
    radius,
  );
}

export function rasterizePixelRoute(
  route: Point[],
  resolution: number,
): Point[] {
  if (!route.length) return [];
  const result: Point[] = [];
  const push = (x: number, y: number) => {
    const point: Point = [
      (Math.max(0, Math.min(resolution - 1, x)) + 0.5) / resolution,
      (Math.max(0, Math.min(resolution - 1, y)) + 0.5) / resolution,
    ];
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      result.push(point);
    }
  };
  for (let segment = 1; segment < route.length; segment += 1) {
    let x0 = Math.round(route[segment - 1][0] * (resolution - 1));
    let y0 = Math.round(route[segment - 1][1] * (resolution - 1));
    const x1 = Math.round(route[segment][0] * (resolution - 1));
    const y1 = Math.round(route[segment][1] * (resolution - 1));
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      push(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x0 += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y0 += stepY;
      }
    }
  }
  if (!result.length) {
    push(
      Math.round(route[0][0] * (resolution - 1)),
      Math.round(route[0][1] * (resolution - 1)),
    );
  }
  return result;
}

export function cellsAround(
  edge: RoadEdge,
  phase: number,
  resolution = 496,
) {
  if (!edge.pixels.length) return [];
  const resolutionScale = resolution / 496;
  const radius = Math.round(24 * resolutionScale);
  const decay = 0.12 / resolutionScale;
  const centre = Math.round(
    Math.max(0, Math.min(1, phase)) * (edge.pixels.length - 1),
  );
  const cells: Array<{ pixel: [number, number]; falloff: number }> = [];
  for (
    let index = Math.max(0, centre - radius);
    index <= Math.min(edge.pixels.length - 1, centre + radius);
    index += 1
  ) {
    cells.push({
      pixel: edge.pixels[index],
      falloff: Math.exp(-Math.abs(index - centre) * decay),
    });
  }
  return cells;
}
