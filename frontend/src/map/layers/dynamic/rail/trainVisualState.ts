import type { TrainState } from "./trainKinematics";

export const TRAIN_PIXEL_LENGTH = 5;
export const TRAIN_WAKE_MAX_CELLS = 4;
export const TRAIN_WAKE_LIFETIME_SECONDS = 0.9;

const TRAIN_WAKE_MAX_OPACITY = 0.28;
const TRAIN_WAKE_MAX_SAMPLE_GAP_SECONDS = 0.75;

export interface TrainPixelPlacement {
  bodyIndices: number[];
  frontIndex: number | null;
}

export interface TrainWakeCell {
  pathIndex: number;
  opacity: number;
  age: number;
}

interface TrainWakeSample {
  pathIndex: number;
  sampledAt: number;
}

export interface TrainWakeState {
  direction: 1 | -1 | null;
  previousBodyIndices: number[];
  samples: TrainWakeSample[];
  lastUpdatedAt: number | null;
}

type TrainPlacementState = Pick<
  TrainState,
  "direction" | "moving" | "stationPhase" | "visible"
>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedUnique(indices: number[], pathLength: number) {
  return [...new Set(indices)].filter(
    (index) => index >= 0 && index < pathLength,
  );
}

/**
 * Finds the numerically nearest sampled route distance with a binary
 * lower-bound search. Exact midpoint ties resolve to the lower route index.
 */
export function nearestPathIndex(
  cumulative: number[],
  distance: number,
) {
  if (!cumulative.length) return 0;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle] < distance) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;

  const previous = low - 1;
  const previousDifference = Math.abs(
    cumulative[previous] - distance,
  );
  const insertionDifference = Math.abs(cumulative[low] - distance);
  return previousDifference <= insertionDifference ? previous : low;
}

/**
 * Returns occupied path indices in visual front-to-tail order.
 *
 * During ingress, the station-side front stays anchored while the far tail
 * disappears first. During egress, the newest cell is the front moving away
 * from the station.
 */
export function trainPixelPlacement(
  pathLength: number,
  headIndex: number,
  train: TrainPlacementState,
): TrainPixelPlacement {
  const available = Math.max(0, Math.floor(pathLength));
  const count = Math.min(
    TRAIN_PIXEL_LENGTH,
    available,
    Math.max(0, Math.floor(train.visible)),
  );
  if (count === 0) {
    return { bodyIndices: [], frontIndex: null };
  }

  const head = clamp(Math.round(headIndex), 0, available - 1);
  let indices: number[];

  if (train.stationPhase === "ingress") {
    indices = Array.from(
      { length: count },
      (_, offset) => head - train.direction * offset,
    );
  } else if (train.stationPhase === "egress") {
    indices = Array.from(
      { length: count },
      (_, offset) =>
        head + train.direction * (count - 1 - offset),
    );
  } else if (train.moving) {
    const front =
      train.direction > 0
        ? clamp(head, count - 1, available - 1)
        : clamp(head, 0, available - count);
    indices = Array.from(
      { length: count },
      (_, offset) => front - train.direction * offset,
    );
  } else {
    indices = [];
  }

  const bodyIndices = boundedUnique(indices, available);
  return {
    bodyIndices,
    frontIndex: bodyIndices[0] ?? null,
  };
}

export function createTrainWakeState(): TrainWakeState {
  return {
    direction: null,
    previousBodyIndices: [],
    samples: [],
    lastUpdatedAt: null,
  };
}

function clearTrainWake(
  wake: TrainWakeState,
  elapsedSeconds: number,
  direction: 1 | -1 | null,
  bodyIndices: number[],
) {
  wake.direction = direction;
  wake.previousBodyIndices = [...bodyIndices];
  wake.samples = [];
  wake.lastUpdatedAt = elapsedSeconds;
}

/**
 * Samples cells recently vacated by the moving train. This keeps the wake
 * transient and tied to actual rendered positions instead of drawing a fixed
 * geometric extension behind every train.
 */
export function updateTrainWake(
  wake: TrainWakeState,
  bodyIndices: number[],
  direction: 1 | -1,
  moving: boolean,
  elapsedSeconds: number,
): TrainWakeCell[] {
  if (!moving || bodyIndices.length === 0) {
    clearTrainWake(wake, elapsedSeconds, null, []);
    return [];
  }

  const stale =
    wake.lastUpdatedAt !== null &&
    (elapsedSeconds < wake.lastUpdatedAt ||
      elapsedSeconds - wake.lastUpdatedAt >
        TRAIN_WAKE_MAX_SAMPLE_GAP_SECONDS);
  if (
    stale ||
    wake.direction !== direction ||
    wake.previousBodyIndices.length === 0
  ) {
    clearTrainWake(wake, elapsedSeconds, direction, bodyIndices);
    return [];
  }

  const currentBody = new Set(bodyIndices);
  const vacated = wake.previousBodyIndices.filter(
    (pathIndex) => !currentBody.has(pathIndex),
  );
  const samples = [
    ...vacated.map((pathIndex) => ({
      pathIndex,
      sampledAt: elapsedSeconds,
    })),
    ...wake.samples,
  ];
  const seen = new Set<number>();
  wake.samples = samples
    .filter((sample) => {
      const age = elapsedSeconds - sample.sampledAt;
      if (
        age < 0 ||
        age > TRAIN_WAKE_LIFETIME_SECONDS ||
        currentBody.has(sample.pathIndex) ||
        seen.has(sample.pathIndex)
      ) {
        return false;
      }
      seen.add(sample.pathIndex);
      return true;
    })
    .slice(0, TRAIN_WAKE_MAX_CELLS);
  wake.direction = direction;
  wake.previousBodyIndices = [...bodyIndices];
  wake.lastUpdatedAt = elapsedSeconds;

  return wake.samples.map((sample) => {
    const age = elapsedSeconds - sample.sampledAt;
    const freshness = Math.max(
      0,
      1 - age / TRAIN_WAKE_LIFETIME_SECONDS,
    );
    return {
      pathIndex: sample.pathIndex,
      opacity: TRAIN_WAKE_MAX_OPACITY * freshness * freshness,
      age,
    };
  });
}
