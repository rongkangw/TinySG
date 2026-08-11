import type { NetworkPayload, Point } from "../../../../types";

type AirportArea =
  NetworkPayload["environment_overlay"]["airports"]["airport_areas"][number];

export interface AircraftJourney {
  id: string;
  airport_id: string;
  airport_name: string;
  operation: "arrival" | "departure";
  path: Point[];
  taxi_end_index: number;
  runway_end_index: number;
  idle_seconds: number;
  phase_offset: number;
}

function linePath(from: Point, to: Point): Point[] {
  const steps = Math.max(
    1,
    Math.abs(to[0] - from[0]),
    Math.abs(to[1] - from[1]),
  );
  const path: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const phase = index / steps;
    path.push([
      Math.round(from[0] + (to[0] - from[0]) * phase),
      Math.round(from[1] + (to[1] - from[1]) * phase),
    ]);
  }
  return path;
}

function appendPath(target: Point[], segment: Point[]) {
  segment.forEach((point) => {
    const last = target[target.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) {
      target.push(point);
    }
  });
}

const pixelKey = ([x, y]: Point) => `${x}:${y}`;

function runwayComponents(pixels: Point[]) {
  const byKey = new Map(pixels.map((pixel) => [pixelKey(pixel), pixel]));
  const remaining = new Set(byKey.keys());
  const components: Point[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as string;
    const queue = [first];
    const component: Point[] = [];
    remaining.delete(first);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const key = queue[cursor];
      const point = byKey.get(key);
      if (!point) continue;
      component.push(point);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbour = `${point[0] + dx}:${point[1] + dy}`;
          if (!remaining.delete(neighbour)) continue;
          queue.push(neighbour);
        }
      }
    }
    components.push(component);
  }
  return components.sort(
    (left, right) =>
      right.length - left.length ||
      pixelKey(left[0]).localeCompare(pixelKey(right[0])),
  );
}

function farthestPath(component: Point[], start: Point) {
  const points = new Map(component.map((pixel) => [pixelKey(pixel), pixel]));
  const startKey = pixelKey(start);
  const queue = [startKey];
  const distance = new Map([[startKey, 0]]);
  const previous = new Map<string, string>();
  let farthest = startKey;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor];
    const point = points.get(key);
    if (!point) continue;
    const currentDistance = distance.get(key) ?? 0;
    const farthestDistance = distance.get(farthest) ?? 0;
    if (
      currentDistance > farthestDistance ||
      (currentDistance === farthestDistance && key < farthest)
    ) {
      farthest = key;
    }
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const neighbour = `${point[0] + dx}:${point[1] + dy}`;
        if (!points.has(neighbour) || distance.has(neighbour)) continue;
        distance.set(neighbour, currentDistance + 1);
        previous.set(neighbour, key);
        queue.push(neighbour);
      }
    }
  }
  const path: Point[] = [];
  for (let key: string | undefined = farthest; key; key = previous.get(key)) {
    const point = points.get(key);
    if (point) path.push(point);
  }
  return { endpoint: points.get(farthest) ?? start, path };
}

export function continuousRunwayPath(
  pixels: Point[],
  runwayIndex = 0,
): Point[] {
  const components = runwayComponents(pixels).filter(
    (component) => component.length >= 2,
  );
  if (!components.length) return pixels.slice(0, 1);
  const component = components[runwayIndex % components.length];
  const seed = component.reduce((first, point) =>
    pixelKey(point) < pixelKey(first) ? point : first,
  );
  const firstSweep = farthestPath(component, seed);
  return farthestPath(component, firstSweep.endpoint).path.reverse();
}

function distanceSquared(left: Point, right: Point) {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function nearestPixel(source: Point[], target: Point, fallback: Point) {
  return source.reduce(
    (closest, point) =>
      distanceSquared(point, target) < distanceSquared(closest, target)
        ? point
        : closest,
    fallback,
  );
}

function offMapPoint(
  runwayStart: Point,
  runwayEnd: Point,
  resolution: number,
  direction: 1 | -1,
  variant: number,
): Point {
  const dx = runwayEnd[0] - runwayStart[0];
  const dy = runwayEnd[1] - runwayStart[1];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sign = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
  const offset = direction * sign;
  const drift = ((variant % 5) - 2) * Math.max(7, Math.round(resolution * 0.018));
  if (horizontal) {
    return [
      offset > 0 ? resolution + 32 : -32,
      Math.round(runwayEnd[1] + drift),
    ];
  }
  return [
    Math.round(runwayEnd[0] + drift),
    offset > 0 ? resolution + 32 : -32,
  ];
}

function airportActivityProfile(area: AirportArea) {
  const name = area.name.toLowerCase();
  const id = area.id.toLowerCase();
  if (name.includes("changi") || id.includes("changi")) {
    return { flights: 10, idle: 38 };
  }
  if (name.includes("pulau") || id.includes("sudong")) {
    return { flights: 1, idle: 420 };
  }
  if (name.includes("seletar") || id.includes("seletar")) {
    return { flights: 2, idle: 145 };
  }
  return { flights: 2, idle: 190 };
}

function buildAirportJourney(
  area: AirportArea,
  resolution: number,
  airportFlightIndex: number,
): AircraftJourney | null {
  const runway = continuousRunwayPath(
    area.runway_pixels,
    airportFlightIndex,
  );
  if (runway.length < 2) return null;
  const flip = airportFlightIndex % 2 === 1;
  const operation: AircraftJourney["operation"] =
    airportFlightIndex % 3 === 1 ? "arrival" : "departure";
  const runwayPath = flip ? runway.slice().reverse() : runway;
  const runwayStart = runwayPath[0];
  const runwayEnd = runwayPath[runwayPath.length - 1];
  const taxiFallback = area.pixel;
  const taxiPixels = area.taxiway_pixels.length
    ? area.taxiway_pixels
    : area.terminal_spans.length
      ? [area.pixel]
      : runwayPath;
  const taxiStart = nearestPixel(
    taxiPixels,
    runwayStart,
    taxiFallback,
  );
  const taxiEnd = nearestPixel(taxiPixels, runwayEnd, taxiFallback);
  const farStart = offMapPoint(
    runwayEnd,
    runwayStart,
    resolution,
    -1,
    airportFlightIndex,
  );
  const farEnd = offMapPoint(
    runwayStart,
    runwayEnd,
    resolution,
    1,
    airportFlightIndex + 2,
  );
  const path: Point[] = [];
  let taxiEndIndex = 0;
  let runwayEndIndex = 0;

  if (operation === "departure") {
    appendPath(path, linePath(taxiStart, runwayStart));
    taxiEndIndex = Math.max(0, path.length - 1);
    appendPath(path, runwayPath);
    runwayEndIndex = Math.max(taxiEndIndex + 1, path.length - 1);
    appendPath(path, linePath(runwayEnd, farEnd));
  } else {
    appendPath(path, linePath(farStart, runwayStart));
    taxiEndIndex = Math.max(0, path.length - 1);
    appendPath(path, runwayPath);
    runwayEndIndex = Math.max(taxiEndIndex + 1, path.length - 1);
    appendPath(path, linePath(runwayEnd, taxiEnd));
  }

  const profile = airportActivityProfile(area);
  return {
    id: `${area.id}-${operation}-${airportFlightIndex}`,
    airport_id: area.id,
    airport_name: area.name,
    operation,
    path,
    taxi_end_index: taxiEndIndex,
    runway_end_index: runwayEndIndex,
    idle_seconds:
      profile.idle + airportFlightIndex * 17 + (operation === "arrival" ? 24 : 0),
    phase_offset: airportFlightIndex * 29 + area.id.length * 11,
  };
}

export function prepareAircraftJourneys(
  network: NetworkPayload,
): AircraftJourney[] {
  const areas = network.environment_overlay.airports.airport_areas;
  const journeys = areas.flatMap((area) => {
    const profile = airportActivityProfile(area);
    return Array.from({ length: profile.flights }, (_, index) =>
      buildAirportJourney(area, network.resolution, index),
    ).filter((journey): journey is AircraftJourney => journey !== null);
  });
  if (journeys.length) return journeys;
  return network.environment_overlay.airports.aircraft_journeys
    .slice(0, 8)
    .map((journey, index) => ({
      ...journey,
      id: `legacy-aircraft-${index}`,
      airport_id: "legacy-airfield",
      airport_name: "Singapore airfield",
      operation: index % 3 === 1 ? "arrival" : "departure",
      idle_seconds: 90 + index * 17,
      phase_offset: index * 31,
    }));
}

function journeyIndexAt(
  journey: AircraftJourney,
  seconds: number,
  flightIndex: number,
) {
  const route = journey.path;
  const taxiLength = Math.max(1, journey.taxi_end_index);
  const runwayLength = Math.max(
    1,
    journey.runway_end_index - journey.taxi_end_index,
  );
  const airborneLength = Math.max(
    1,
    route.length - 1 - journey.runway_end_index,
  );
  const firstDuration =
    journey.operation === "arrival"
      ? taxiLength / (4.2 + (flightIndex % 3) * 0.45)
      : taxiLength / (0.76 + (flightIndex % 3) * 0.08);
  const runwayDuration = runwayLength / 2.8;
  const finalDuration =
    journey.operation === "arrival"
      ? airborneLength / (0.82 + (flightIndex % 3) * 0.08)
      : airborneLength / (4.8 + (flightIndex % 3) * 0.5);
  const lifetime = firstDuration + runwayDuration + finalDuration;
  const local =
    (seconds + journey.phase_offset + flightIndex * 41) %
    (lifetime + journey.idle_seconds);
  if (local >= lifetime) return null;

  if (local < firstDuration) {
    return Math.floor((local / firstDuration) * taxiLength);
  }
  if (local < firstDuration + runwayDuration) {
    const runwayProgress = (local - firstDuration) / runwayDuration;
    return (
      journey.taxi_end_index +
      Math.floor(runwayProgress * runwayLength)
    );
  }
  const airborneProgress =
    (local - firstDuration - runwayDuration) / finalDuration;
  return (
    journey.runway_end_index +
    Math.floor(airborneProgress * airborneLength)
  );
}

export function aircraftPositionAt(
  journey: AircraftJourney,
  seconds: number,
  flightIndex: number,
): Point | null {
  const route = journey.path;
  if (!route.length) return null;
  const rawStep = journeyIndexAt(journey, seconds, flightIndex);
  if (rawStep === null) return null;
  return route[Math.max(0, Math.min(route.length - 1, rawStep))] ?? null;
}

interface AircraftPixel {
  x: number;
  y: number;
  scale: number;
  colour: string;
  alpha: number;
}

interface AircraftLight {
  x: number;
  y: number;
  scale: number;
  colour: string;
  alpha: number;
  blur: number;
}

function directionAt(route: Point[], step: number) {
  for (let offset = 1; offset <= 5; offset += 1) {
    const before = route[Math.max(0, step - offset)];
    const after = route[Math.min(route.length - 1, step + offset)];
    if (!before || !after) continue;
    const rawDx = after[0] - before[0];
    const rawDy = after[1] - before[1];
    if (Math.abs(rawDx) >= Math.abs(rawDy) && rawDx) {
      return { dx: Math.sign(rawDx), dy: 0 };
    }
    if (rawDy) return { dx: 0, dy: Math.sign(rawDy) };
  }
  return { dx: 1, dy: 0 };
}

function offsetPoint(
  origin: Point,
  forward: number,
  sideways: number,
  dx: number,
  dy: number,
) {
  return {
    x: origin[0] + dx * forward - dy * sideways,
    y: origin[1] + dy * forward + dx * sideways,
  };
}

function beaconAlpha(seconds: number, phase: number) {
  return Math.sin(seconds * 7.1 + phase) > 0.78 ? 0.95 : 0.16;
}

function strobeAlpha(seconds: number, phase: number) {
  return Math.sin(seconds * 5.4 + phase) > 0.9 ? 1 : 0.18;
}

function aircraftSprite(
  route: Point[],
  step: number,
  seconds: number,
  flightIndex: number,
) {
  const origin = route[Math.max(0, Math.min(route.length - 1, step))];
  const { dx, dy } = directionAt(route, step);
  const baseColour = flightIndex % 3 === 0 ? "#f3dca5" : "#b9dce5";
  const shadowColour = flightIndex % 3 === 0 ? "#9f8e63" : "#6f98a8";
  const phase = flightIndex * 1.913;

  const pixels: AircraftPixel[] = [
    { ...offsetPoint(origin, 1, 0, dx, dy), scale: 0.5, colour: "#fff4d4", alpha: 0.9 },
    { ...offsetPoint(origin, 0, 0, dx, dy), scale: 0.56, colour: baseColour, alpha: 0.86 },
    { ...offsetPoint(origin, -1, 0, dx, dy), scale: 0.52, colour: baseColour, alpha: 0.82 },
    { ...offsetPoint(origin, -1, -1, dx, dy), scale: 0.42, colour: baseColour, alpha: 0.72 },
    { ...offsetPoint(origin, -1, 1, dx, dy), scale: 0.42, colour: baseColour, alpha: 0.72 },
    { ...offsetPoint(origin, -2, 0, dx, dy), scale: 0.42, colour: shadowColour, alpha: 0.64 },
  ];

  const leftWing = offsetPoint(origin, -1, -1, dx, dy);
  const rightWing = offsetPoint(origin, -1, 1, dx, dy);
  const tail = offsetPoint(origin, -2, 0, dx, dy);
  const beacon = offsetPoint(origin, -1, 0, dx, dy);
  const lights: AircraftLight[] = [
    { ...leftWing, scale: 0.36, colour: "#ff4c5f", alpha: 0.88, blur: 1.4 },
    { ...rightWing, scale: 0.36, colour: "#43ff9b", alpha: 0.88, blur: 1.4 },
    { ...tail, scale: 0.34, colour: "#f4fbff", alpha: strobeAlpha(seconds, phase), blur: 2 },
    { ...beacon, scale: 0.32, colour: "#ff3546", alpha: beaconAlpha(seconds, phase), blur: 1.8 },
  ];

  return { pixels, lights };
}

function fillPixel(
  context: CanvasRenderingContext2D,
  resolution: number,
  x: number,
  y: number,
  scale: number,
) {
  if (x < 0 || y < 0 || x >= resolution || y >= resolution) return false;
  const unit = 1 / resolution;
  const inset = (1 - scale) / 2;
  context.fillRect(
    (x + inset) * unit,
    (y + inset) * unit,
    scale * unit,
    scale * unit,
  );
  return true;
}

export function drawAircraft(
  context: CanvasRenderingContext2D,
  journeys: AircraftJourney[],
  resolution: number,
  seconds: number,
) {
  journeys.forEach((journey, flightIndex) => {
    const route = journey.path;
    if (route.length < 5) return;
    const rawStep = journeyIndexAt(journey, seconds, flightIndex);
    if (rawStep === null) return;
    const step = Math.max(0, Math.min(route.length - 1, rawStep));
    const sprite = aircraftSprite(route, step, seconds, flightIndex);
    sprite.pixels.forEach((pixel) => {
      context.fillStyle = pixel.colour;
      context.globalAlpha = pixel.alpha;
      fillPixel(
        context,
        resolution,
        pixel.x,
        pixel.y,
        pixel.scale,
      );
    });
    sprite.lights.forEach((light) => {
      context.save();
      context.globalCompositeOperation = "lighter";
      context.shadowColor = light.colour;
      context.shadowBlur = light.blur;
      context.fillStyle = light.colour;
      context.globalAlpha = light.alpha;
      fillPixel(context, resolution, light.x, light.y, light.scale);
      context.restore();
    });
  });
  context.globalAlpha = 1;
}
