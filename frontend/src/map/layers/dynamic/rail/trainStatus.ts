import type { RailStation } from "../../../../types";
import type { TrainLineModel } from "./TrainLayer";
import { trainStateAt } from "./trainKinematics";
import type { TrainRouteStop } from "./trainStops";

function phaseCycle(phases: TrainLineModel["phases"][number]) {
  return phases.reduce((total, phase) => total + phase.duration, 0);
}

export function activeTrainCount(line: TrainLineModel | undefined) {
  return line?.phases.filter((phases) => phases.length > 0).length ?? 0;
}

export function formatArrivalSeconds(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "not scheduled";
  if (seconds <= 3) return "arriving now";
  if (seconds < 60) return `${Math.ceil(seconds)} sec`;
  return `${Math.ceil(seconds / 60)} min`;
}

export function nextStationArrivalSeconds(
  line: TrainLineModel | undefined,
  station: RailStation,
  elapsedSeconds: number,
) {
  if (!line) return null;
  const stop = line.stops.find(
    (candidate) =>
      candidate.stationId === station.id ||
      candidate.stationName === station.name,
  );
  if (!stop) return null;

  let next: number | null = null;
  line.phases.forEach((phases) => {
    const cycle = phaseCycle(phases);
    if (!cycle) return;
    const now = ((elapsedSeconds % cycle) + cycle) % cycle;
    let cursor = 0;
    phases.forEach((phase) => {
      const startsAt = cursor;
      const endsAt = cursor + phase.duration;
      const isStationDwell =
        !phase.moving && Math.abs(phase.from - stop.routeDistance) <= 1e-6;
      if (isStationDwell) {
        const wait =
          now <= endsAt && now >= startsAt
            ? 0
            : now < startsAt
              ? startsAt - now
              : cycle - now + startsAt;
        next = next === null ? wait : Math.min(next, wait);
      }
      cursor = endsAt;
    });
  });
  return next;
}

function stopNearDistance(
  stops: TrainRouteStop[],
  distance: number,
): TrainRouteStop | null {
  let selected: TrainRouteStop | null = null;
  let selectedDifference = Number.POSITIVE_INFINITY;
  stops.forEach((stop) => {
    const difference = Math.abs(stop.routeDistance - distance);
    if (difference < selectedDifference) {
      selected = stop;
      selectedDifference = difference;
    }
  });
  return selected;
}

function phaseAt(
  phases: TrainLineModel["phases"][number],
  elapsedSeconds: number,
):
  | {
      index: number;
      phase: TrainLineModel["phases"][number][number];
      elapsedInPhase: number;
      remainingInPhase: number;
    }
  | null {
  const cycle = phaseCycle(phases);
  if (!cycle) return null;
  let local = ((elapsedSeconds % cycle) + cycle) % cycle;
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    if (local <= phase.duration) {
      return {
        index,
        phase,
        elapsedInPhase: local,
        remainingInPhase: Math.max(0, phase.duration - local),
      };
    }
    local -= phase.duration;
  }
  return null;
}

function nextMovingLeg(
  phases: TrainLineModel["phases"][number],
  startIndex: number,
) {
  for (let offset = 1; offset <= phases.length; offset += 1) {
    const index = (startIndex + offset) % phases.length;
    const phase = phases[index];
    if (phase?.moving) return phase;
  }
  return null;
}

export interface TrainArrivalBoardRow {
  towards: string;
  nextStation: string;
  etaSeconds: number | null;
  status: "arriving" | "boarding" | "departing" | "moving" | "idle";
}

export function trainArrivalBoard(
  line: TrainLineModel | undefined,
  elapsedSeconds: number,
): TrainArrivalBoardRow[] {
  if (!line) return [];
  return line.phases.flatMap((phases) => {
    if (!phases.length) return [];
    const current = phaseAt(phases, elapsedSeconds);
    if (!current) return [];
    const state = trainStateAt(phases, elapsedSeconds);
    let targetDistance = current.phase.to;
    let etaSeconds: number | null = current.remainingInPhase;
    let status: TrainArrivalBoardRow["status"] = "moving";

    if (!current.phase.moving) {
      const nextLeg = nextMovingLeg(phases, current.index);
      targetDistance = nextLeg?.to ?? current.phase.to;
      etaSeconds = nextLeg
        ? current.remainingInPhase + nextLeg.duration
        : null;
      status =
        state.stationPhase === "ingress"
          ? "arriving"
          : state.stationPhase === "dwell"
            ? "boarding"
            : "departing";
    }

    const stop = stopNearDistance(line.stops, targetDistance);
    const terminal =
      state.direction > 0
        ? line.stops[line.stops.length - 1]
        : line.stops[0];
    return [
      {
        towards: terminal?.stationName ?? "line terminus",
        nextStation: stop?.stationName ?? "next station",
        etaSeconds,
        status,
      },
    ];
  });
}
