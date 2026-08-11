import type {
  BusVehicle,
  CityDataPayload,
  Point,
} from "../../../../types";
import { rasterizePixelRoute } from "../../../core/geometry";
import {
  routePosition,
  timedVehicleProgress,
} from "../../../vehicles/motion";

export function prepareBusRoutes(
  vehicles: BusVehicle[],
  resolution: number,
) {
  return new Map(
    vehicles.map((vehicle) => [
      vehicle.id,
      vehicle.road_pixels
        ? vehicle.route
        : rasterizePixelRoute(vehicle.route, resolution),
    ]),
  );
}

export function busPositionAt(
  vehicle: BusVehicle,
  routes: Map<string, Point[]>,
  epochMs: number,
) {
  return routePosition(
    routes.get(vehicle.id) ?? [],
    timedVehicleProgress(vehicle, epochMs),
  );
}

export function busNextStopStatus(
  vehicle: BusVehicle,
  epochMs: number,
) {
  const progress = timedVehicleProgress(vehicle, epochMs);
  const markers = [...(vehicle.route_stops ?? [])].sort(
    (left, right) => left.phase - right.phase,
  );
  const marker =
    markers.find((candidate) => candidate.phase >= progress + 0.015) ??
    markers[markers.length - 1];
  const remainingProgress = marker
    ? Math.max(0, marker.phase - progress)
    : Math.max(0, 1 - progress);
  const routeSeconds = vehicle.duration_seconds * remainingProgress;
  const fallbackSeconds = Number.isFinite(routeSeconds)
    ? routeSeconds
    : vehicle.next_stop_eta_seconds;
  const etaSeconds =
    fallbackSeconds === undefined || !Number.isFinite(fallbackSeconds)
      ? null
      : Math.max(0, fallbackSeconds);
  return {
    stop:
      marker?.name ||
      vehicle.next_stop_name ||
      vehicle.next_stop_code ||
      "next stop",
    etaSeconds,
  };
}

export function drawBuses(
  context: CanvasRenderingContext2D,
  cityData: CityDataPayload | null,
  routes: Map<string, Point[]>,
  resolution: number,
  epochMs: number,
  seconds: number,
) {
  const unit = 1 / resolution;
  cityData?.buses.vehicles.forEach((vehicle, index) => {
    const [x, y] = busPositionAt(vehicle, routes, epochMs);
    context.fillStyle =
      vehicle.load === "LSD"
        ? "#44c7a5"
        : vehicle.load === "SDA"
          ? "#59d8b4"
          : "#74e8c4";
    context.globalAlpha =
      0.76 + 0.18 * Math.sin(seconds * 1.7 + index);
    context.fillRect(
      x - unit * 0.42,
      y - unit * 0.42,
      unit * 0.84,
      unit * 0.84,
    );
  });
  context.globalAlpha = 1;
}
