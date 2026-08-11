import type { LandUseSector } from "../../../types";

export interface LandUseArea extends LandUseSector {
  id: string;
  pixel_count: number;
}

function cellKey(x: number, y: number, resolution: number) {
  return y * resolution + x;
}

function cellPoint(key: number, resolution: number) {
  return [key % resolution, Math.floor(key / resolution)] as const;
}

function spanKeys(
  spans: readonly [number, number, number][],
  resolution: number,
) {
  const keys = new Set<number>();
  spans.forEach(([y, start, end]) => {
    for (let x = start; x <= end; x += 1) {
      if (x < 0 || y < 0 || x >= resolution || y >= resolution) continue;
      keys.add(cellKey(x, y, resolution));
    }
  });
  return keys;
}

function spansFromKeys(
  keys: Iterable<number>,
  resolution: number,
): [number, number, number][] {
  const rows = new Map<number, number[]>();
  for (const key of keys) {
    const [x, y] = cellPoint(key, resolution);
    const row = rows.get(y) ?? [];
    row.push(x);
    rows.set(y, row);
  }
  const spans: [number, number, number][] = [];
  [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([y, columns]) => {
      const ordered = [...new Set(columns)].sort((left, right) => left - right);
      if (!ordered.length) return;
      let start = ordered[0];
      let previous = start;
      ordered.slice(1).forEach((x) => {
        if (x === previous + 1) {
          previous = x;
          return;
        }
        spans.push([y, start, previous]);
        start = x;
        previous = x;
      });
      spans.push([y, start, previous]);
    });
  return spans;
}

function neighbourKeys(key: number, resolution: number) {
  const [x, y] = cellPoint(key, resolution);
  const neighbours: number[] = [];
  if (x > 0) neighbours.push(cellKey(x - 1, y, resolution));
  if (x < resolution - 1) neighbours.push(cellKey(x + 1, y, resolution));
  if (y > 0) neighbours.push(cellKey(x, y - 1, resolution));
  if (y < resolution - 1) neighbours.push(cellKey(x, y + 1, resolution));
  return neighbours;
}

function componentOutline(component: Set<number>, resolution: number) {
  const outline = new Set<number>();
  component.forEach((key) => {
    if (
      neighbourKeys(key, resolution).some(
        (neighbour) => !component.has(neighbour),
      )
    ) {
      outline.add(key);
    }
  });
  return outline;
}

export function buildLandUseAreas(
  sectors: readonly LandUseSector[],
  resolution: number,
) {
  const areas: LandUseArea[] = [];
  const categoryCounts = new Map<string, number>();
  sectors.forEach((sector) => {
    const pixels = spanKeys(sector.spans, resolution);
    const visited = new Set<number>();
    [...pixels]
      .sort((left, right) => left - right)
      .forEach((seed) => {
        if (visited.has(seed)) return;
        const component = new Set<number>();
        const stack = [seed];
        visited.add(seed);
        while (stack.length) {
          const key = stack.pop();
          if (key === undefined) continue;
          component.add(key);
          neighbourKeys(key, resolution).forEach((neighbour) => {
            if (!pixels.has(neighbour) || visited.has(neighbour)) return;
            visited.add(neighbour);
            stack.push(neighbour);
          });
        }
        const index = (categoryCounts.get(sector.category) ?? 0) + 1;
        categoryCounts.set(sector.category, index);
        areas.push({
          id: `${sector.category}-${index}`,
          category: sector.category,
          spans: spansFromKeys(component, resolution),
          outline_spans: spansFromKeys(
            componentOutline(component, resolution),
            resolution,
          ),
          pixel_count: component.size,
        });
      });
  });
  return areas;
}

export function buildLandUseAreaGrid(
  areas: readonly LandUseArea[],
  resolution: number,
) {
  const cells = Array<LandUseArea | undefined>(resolution * resolution);
  areas.forEach((area) => {
    area.spans.forEach(([y, start, end]) => {
      for (let x = start; x <= end; x += 1) {
        cells[cellKey(x, y, resolution)] = area;
      }
    });
  });
  return cells;
}
