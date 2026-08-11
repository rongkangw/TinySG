import type { Point } from "../../types";

export interface TimedRouteVehicle {
  started_at: string;
  duration_seconds: number;
  phase_offset?: number;
  simulated: boolean;
}

export type MotionPolicy = "once" | "loop" | "reverse";

export function routeProgress(
  elapsedSeconds: number,
  durationSeconds: number,
  phaseOffset = 0,
  policy: MotionPolicy = "once",
) {
  const raw =
    Math.max(0, elapsedSeconds) / Math.max(1, durationSeconds) +
    phaseOffset;
  if (policy === "once") return Math.min(1, raw);
  if (policy === "loop") return raw - Math.floor(raw);
  const cycle = raw % 2;
  return cycle <= 1 ? cycle : 2 - cycle;
}

export function timedVehicleProgress(
  vehicle: TimedRouteVehicle,
  nowEpochMs: number,
  policy: MotionPolicy = vehicle.simulated ? "reverse" : "once",
) {
  const started = Date.parse(vehicle.started_at);
  const elapsed = Math.max(
    0,
    (nowEpochMs - (Number.isFinite(started) ? started : nowEpochMs)) / 1000,
  );
  return routeProgress(
    elapsed,
    vehicle.duration_seconds,
    vehicle.phase_offset,
    policy,
  );
}

export function routePosition(route: Point[], progress: number): Point {
  if (!route.length) return [0, 0];
  const index = Math.round(
    Math.max(0, Math.min(1, progress)) * (route.length - 1),
  );
  return route[index];
}

export function routeHeading(route: Point[], index: number) {
  const head = route[Math.max(0, Math.min(route.length - 1, index))] ?? [0, 0];
  const behind = route[Math.max(0, index - 1)] ?? head;
  return {
    head,
    behind,
    directionX: Math.sign(head[0] - behind[0]),
    directionY: Math.sign(head[1] - behind[1]),
  };
}
