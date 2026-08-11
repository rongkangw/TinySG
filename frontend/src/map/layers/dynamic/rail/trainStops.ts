import type { Point, RailStation } from "../../../../types";

/**
 * Active-line artifact measurements put intended selected-path station
 * offsets at 0–2 cells (HarbourFront is 1; EWL Jurong East is 2). The first
 * off-branch matches are SKLRT at 7.07 cells and CCL Esplanade at 9, so an
 * inclusive two-cell limit keeps raster offsets without inventing stops on a
 * different branch.
 */
export const TRAIN_STOP_MAX_PATH_DISTANCE_CELLS = 2;

export interface MatchedTrainStop {
  stationId: string;
  stationName: string;
  stationPixel: Point;
  routeIndex: number;
  pathDistance: number;
}

export interface TrainRouteStop extends MatchedTrainStop {
  routeDistance: number;
}

export interface PreparedTrainRoute {
  path: Point[];
  cumulative: number[];
  stops: TrainRouteStop[];
}

function compareMatchedStops(
  left: MatchedTrainStop,
  right: MatchedTrainStop,
) {
  return (
    left.pathDistance - right.pathDistance ||
    left.stationId.localeCompare(right.stationId) ||
    left.stationName.localeCompare(right.stationName) ||
    left.stationPixel[0] - right.stationPixel[0] ||
    left.stationPixel[1] - right.stationPixel[1]
  );
}

function nearestRouteCell(path: Point[], stationPixel: Point) {
  let routeIndex = -1;
  let squaredDistance = Number.POSITIVE_INFINITY;
  path.forEach(([x, y], index) => {
    const candidate =
      (x - stationPixel[0]) ** 2 + (y - stationPixel[1]) ** 2;
    if (candidate < squaredDistance) {
      routeIndex = index;
      squaredDistance = candidate;
    }
  });
  return {
    routeIndex,
    pathDistance: Math.sqrt(squaredDistance),
  };
}

export function matchStationsToTrainPath(
  path: Point[],
  stations: RailStation[],
  maximumDistance = TRAIN_STOP_MAX_PATH_DISTANCE_CELLS,
): MatchedTrainStop[] {
  if (!path.length || maximumDistance < 0) return [];

  const closestByRouteIndex = new Map<number, MatchedTrainStop>();
  stations.forEach((station) => {
    const { routeIndex, pathDistance } = nearestRouteCell(
      path,
      station.pixel,
    );
    if (routeIndex < 0 || pathDistance > maximumDistance) return;

    const candidate: MatchedTrainStop = {
      stationId: station.id,
      stationName: station.name,
      stationPixel: [...station.pixel],
      routeIndex,
      pathDistance,
    };
    const existing = closestByRouteIndex.get(routeIndex);
    if (!existing || compareMatchedStops(candidate, existing) < 0) {
      closestByRouteIndex.set(routeIndex, candidate);
    }
  });

  return [...closestByRouteIndex.values()].sort(
    (left, right) =>
      left.routeIndex - right.routeIndex ||
      compareMatchedStops(left, right),
  );
}

export function prepareTrimmedTrainRoute(
  sourcePath: Point[],
  matchedStops: MatchedTrainStop[],
): PreparedTrainRoute | null {
  if (matchedStops.length < 2) return null;

  const sortedStops = [...matchedStops].sort(
    (left, right) =>
      left.routeIndex - right.routeIndex ||
      compareMatchedStops(left, right),
  );
  const firstRouteIndex = sortedStops[0].routeIndex;
  const finalRouteIndex =
    sortedStops[sortedStops.length - 1].routeIndex;
  if (
    firstRouteIndex < 0 ||
    finalRouteIndex >= sourcePath.length ||
    finalRouteIndex <= firstRouteIndex
  ) {
    return null;
  }

  const path = sourcePath.slice(firstRouteIndex, finalRouteIndex + 1);
  const cumulative = [0];
  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] +
        Math.hypot(
          path[index][0] - path[index - 1][0],
          path[index][1] - path[index - 1][1],
        ),
    );
  }
  const stops = sortedStops.map((stop) => {
    const routeIndex = stop.routeIndex - firstRouteIndex;
    return {
      ...stop,
      stationPixel: [...stop.stationPixel] as Point,
      routeIndex,
      routeDistance: cumulative[routeIndex],
    };
  });

  return { path, cumulative, stops };
}

export function trainStopAtDistance(
  stops: TrainRouteStop[],
  routeDistance: number,
  tolerance = 1e-6,
) {
  let nearest: TrainRouteStop | undefined;
  let nearestDifference = Number.POSITIVE_INFINITY;
  stops.forEach((stop) => {
    const difference = Math.abs(stop.routeDistance - routeDistance);
    if (
      difference < nearestDifference ||
      (difference === nearestDifference &&
        stop.routeIndex < (nearest?.routeIndex ?? Number.POSITIVE_INFINITY))
    ) {
      nearest = stop;
      nearestDifference = difference;
    }
  });
  return nearestDifference <= tolerance ? nearest : undefined;
}
