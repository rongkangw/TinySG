export interface TrainPhase {
  duration: number;
  from: number;
  to: number;
  direction: 1 | -1;
  moving: boolean;
  maximumSpeed: number;
}

export type TrainStationPhase = "moving" | "ingress" | "dwell" | "egress";

export interface TrainState {
  distance: number;
  direction: 1 | -1;
  moving: boolean;
  appearing: boolean;
  visible: number;
  stationPhase: TrainStationPhase;
  transitionProgress: number;
  stationActivity: number;
}

export const TRAIN_PIXEL_TRANSITION_SECONDS = 5;
export const TRAIN_STATION_WAIT_SECONDS = 30;

const MINIMUM_STATION_ACTIVITY = 0.32;

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothStep(value: number) {
  const progress = clampUnit(value);
  return progress * progress * (3 - 2 * progress);
}

export function travelDuration(
  distance: number,
  maximumSpeed: number,
) {
  return distance / maximumSpeed;
}

export function travelledDistance(
  distance: number,
  elapsed: number,
  maximumSpeed: number,
) {
  return Math.max(0, Math.min(distance, elapsed * maximumSpeed));
}

export function buildTrainPhases(
  stationDistances: number[],
  reverse: boolean,
  maximumSpeed: number,
): TrainPhase[] {
  const order = reverse ? [...stationDistances].reverse() : stationDistances;
  const direction = reverse ? -1 : 1;
  if (!order.length) return [];

  const phases: TrainPhase[] = [
    {
      duration:
        TRAIN_STATION_WAIT_SECONDS + TRAIN_PIXEL_TRANSITION_SECONDS * 2,
      from: order[0],
      to: order[0],
      direction,
      moving: false,
      maximumSpeed,
    },
  ];
  const addLeg = (from: number, to: number, includeDwell: boolean) => {
    const distance = Math.abs(to - from);
    const legDirection = (to >= from ? 1 : -1) as 1 | -1;
    phases.push({
      duration: travelDuration(distance, maximumSpeed),
      from,
      to,
      direction: legDirection,
      moving: true,
      maximumSpeed,
    });
    if (includeDwell) {
      phases.push({
        duration:
          TRAIN_STATION_WAIT_SECONDS + TRAIN_PIXEL_TRANSITION_SECONDS * 2,
        from: to,
        to,
        direction: legDirection,
        moving: false,
        maximumSpeed,
      });
    }
  };

  for (let index = 1; index < order.length; index += 1) {
    addLeg(order[index - 1], order[index], true);
  }
  for (let index = order.length - 2; index >= 0; index -= 1) {
    addLeg(order[index + 1], order[index], index > 0);
  }
  return phases;
}

export function trainStateAt(
  phases: TrainPhase[],
  elapsed: number,
): TrainState {
  if (!phases.length) {
    return {
      distance: 0,
      direction: 1,
      moving: false,
      appearing: false,
      visible: 0,
      stationPhase: "moving",
      transitionProgress: 0,
      stationActivity: 0,
    };
  }
  const cycle = phases.reduce((total, phase) => total + phase.duration, 0);
  let time = elapsed % Math.max(1, cycle);
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];
    if (time <= phase.duration) {
      if (!phase.moving) {
        const transition = TRAIN_PIXEL_TRANSITION_SECONDS;
        const egressStart = phase.duration - transition;
        const appearing = time >= egressStart;
        const visible =
          time < transition
            ? Math.max(0, 5 - Math.floor(time))
            : appearing
              ? Math.min(
                  5,
                  Math.floor(time - egressStart) + 1,
                )
              : 0;
        const nextPhase = phases[(phaseIndex + 1) % phases.length];
        if (time < transition) {
          const transitionProgress = clampUnit(time / transition);
          return {
            distance: phase.from,
            direction: phase.direction,
            moving: false,
            appearing: false,
            visible,
            stationPhase: "ingress",
            transitionProgress,
            stationActivity:
              MINIMUM_STATION_ACTIVITY +
              (1 - MINIMUM_STATION_ACTIVITY) *
                smoothStep(transitionProgress),
          };
        }
        if (!appearing) {
          return {
            distance: phase.from,
            direction: phase.direction,
            moving: false,
            appearing: false,
            visible,
            stationPhase: "dwell",
            transitionProgress: clampUnit(
              (time - transition) /
                Math.max(1, TRAIN_STATION_WAIT_SECONDS),
            ),
            stationActivity: 1,
          };
        }
        const transitionProgress = clampUnit(
          (time - egressStart) / transition,
        );
        return {
          distance: phase.from,
          direction: nextPhase.direction,
          moving: false,
          appearing: true,
          visible,
          stationPhase: "egress",
          transitionProgress,
          stationActivity:
            MINIMUM_STATION_ACTIVITY +
            (1 - MINIMUM_STATION_ACTIVITY) *
              (1 - smoothStep(transitionProgress)),
        };
      }
      const distance = Math.abs(phase.to - phase.from);
      const moved = travelledDistance(
        distance,
        time,
        phase.maximumSpeed,
      );
      return {
        distance: phase.from + moved * phase.direction,
        direction: phase.direction,
        moving: true,
        appearing: false,
        visible: 5,
        stationPhase: "moving",
        transitionProgress: 0,
        stationActivity: 0,
      };
    }
    time -= phase.duration;
  }
  return {
    distance: phases[0].from,
    direction: phases[0].direction,
    moving: false,
    appearing: false,
    visible: 0,
    stationPhase: "moving",
    transitionProgress: 0,
    stationActivity: 0,
  };
}
