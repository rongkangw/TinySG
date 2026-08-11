import type { Point, RailLine } from "../../../types";

export type RailPaintKind = "outline" | "track";

export interface RailPaintStep {
  kind: RailPaintKind;
  line: RailLine;
}

function railPriority(line: RailLine) {
  if (line.future) return 0;
  return line.route === "light_rail" ? 1 : 2;
}

/**
 * Establishes explicit rail precedence instead of relying on payload order.
 * Future lines sit lowest, then LRT, then MRT. References break ties so the
 * result is stable when preprocessing or API ordering changes.
 */
export function orderRailLines(lines: readonly RailLine[]): RailLine[] {
  return [...lines].sort((left, right) => {
    const priority = railPriority(left) - railPriority(right);
    if (priority !== 0) return priority;
    if (left.ref < right.ref) return -1;
    if (left.ref > right.ref) return 1;
    return 0;
  });
}

/**
 * All casings must be painted before any coloured track. Otherwise a later
 * line's casing can erase the track of an earlier line at a shared cell.
 */
export function railPaintPlan(
  lines: readonly RailLine[],
): RailPaintStep[] {
  const ordered = orderRailLines(lines);
  return [
    ...ordered.map((line) => ({ kind: "outline" as const, line })),
    ...ordered.map((line) => ({ kind: "track" as const, line })),
  ];
}

/**
 * Returns the line whose colour is visible at an exactly shared raster cell.
 * It mirrors the track pass in railPaintPlan and is intentionally pure so the
 * collision rule can be regression-tested without a browser canvas.
 */
export function railCellOwner(
  lines: readonly RailLine[],
  [targetX, targetY]: Point,
): RailLine | undefined {
  let owner: RailLine | undefined;
  orderRailLines(lines).forEach((line) => {
    if (
      line.pixels.some(
        ([pixelX, pixelY]) =>
          pixelX === targetX && pixelY === targetY,
      )
    ) {
      owner = line;
    }
  });
  return owner;
}
