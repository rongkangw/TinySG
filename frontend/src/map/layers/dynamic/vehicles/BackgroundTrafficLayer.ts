import type {
  CityDataPayload,
  NetworkPayload,
  Point,
  RoadEdge,
} from "../../../../types";
import {
  trafficDensityForSpeedBand,
  trafficSpeedMultiplierForBand,
} from "../../../traffic/speedBandMetrics";

export interface BackgroundVehicle {
  route: Point[];
  offset: number;
  speed: number;
}

export function prepareBackgroundTraffic(
  network: NetworkPayload,
): BackgroundVehicle[] {
  return network.traffic_routes.flatMap((route, index) =>
    [0, 1, 2].map((lane) => ({
      route,
      offset:
        index * 53 +
        lane * Math.max(11, Math.floor(route.length * 0.31)),
      speed: 0.45 + ((index * 17 + lane * 7) % 15) / 20,
    })),
  );
}

export function matchTrafficSpeedBands(
  vehicles: BackgroundVehicle[],
  cityData: CityDataPayload | null,
  edges: Map<number, RoadEdge>,
) {
  const byCell = new Map<string, number>();
  (cityData?.traffic_speed_bands?.bands ?? []).forEach((band) => {
    const edge = edges.get(band.edge_id);
    edge?.pixels.forEach(([x, y]) => {
      const key = `${x}:${y}`;
      byCell.set(
        key,
        Math.min(byCell.get(key) ?? 8, Math.max(1, band.speed_band)),
      );
    });
  });
  return vehicles.map((vehicle) => {
    let bandTotal = 0;
    let observedCells = 0;
    vehicle.route.forEach(([x, y]) => {
      const value = byCell.get(`${x}:${y}`);
      if (value === undefined) return;
      bandTotal += value;
      observedCells += 1;
    });
    return observedCells ? bandTotal / observedCells : null;
  });
}

export function drawBackgroundTraffic(
  context: CanvasRenderingContext2D,
  vehicles: BackgroundVehicle[],
  speedBands: Array<number | null>,
  resolution: number,
  seconds: number,
  daylight: number,
) {
  const unit = 1 / resolution;
  vehicles.forEach((vehicle, index) => {
    if (!vehicle.route.length) return;
    const speedBand = speedBands[index];
    const density = trafficDensityForSpeedBand(speedBand);
    const densityRoll = ((index * 73 + 19) % 100) / 100;
    if (densityRoll > density) return;
    const speedMultiplier = trafficSpeedMultiplierForBand(speedBand);
    const travelled = Math.floor(
      seconds * vehicle.speed * speedMultiplier,
    );
    const pause = Math.max(8, Math.round(vehicle.route.length * 0.16));
    const routeIndex =
      (vehicle.offset + travelled) % (vehicle.route.length + pause);
    if (routeIndex >= vehicle.route.length) return;
    const [x, y] = vehicle.route[routeIndex];
    context.fillStyle = index % 6 === 0 ? "#ffc0df" : "#e596bd";
    context.globalAlpha = 0.48 + daylight * 0.06;
    context.fillRect(
      x * unit + unit * 0.17,
      y * unit + unit * 0.17,
      unit * 0.66,
      unit * 0.66,
    );
  });
  context.globalAlpha = 1;
}
