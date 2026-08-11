import type {
  CityDataPayload,
  Incident,
  NetworkPayload,
  Point,
} from "../../types";
import { prepareAircraftJourneys } from "../../map/layers/dynamic/vehicles/AircraftLayer";
import { cleanRoadworkMessage } from "../roadworks/roadworkCopy";

interface StoryMomentInput {
  network: NetworkPayload | null;
  cityData: CityDataPayload | null;
  incidents: Incident[];
  timestamp?: string;
}

export interface StoryMomentFocus {
  edgeId?: number;
  phase?: number;
  pixels?: Point[];
  world?: Point;
  follow?:
    | { kind: "bus"; id: string }
    | { kind: "aircraft"; index: number };
  zoom?: number;
}

export interface StoryMoment extends Incident {
  focus?: StoryMomentFocus;
}

const makeMoment = (
  timestamp: string,
  id: string,
  incidentType: string,
  road: string,
  message: string,
  pixels: Incident["pixels"],
  simulated = true,
  edgeId = -1,
  phase = 0,
  focus?: StoryMomentFocus,
): StoryMoment => ({
  id,
  edge_id: edgeId,
  road,
  incident_type: incidentType,
  message,
  timestamp,
  lifetime_seconds: 3600,
  age_seconds: 0,
  remaining_intensity: 1,
  phase,
  simulated,
  pixels,
  highway_class: "ambient",
  focus,
});

const toPixel = (point: Point, resolution: number): Point => [
  Math.round(point[0] * (resolution - 1)),
  Math.round(point[1] * (resolution - 1)),
];

export const storyDescription = (incident: Incident) => {
  const kind = incident.incident_type.toLowerCase();
  return kind.includes("crash")
    ? "Crash reported. Nearby traffic is slowing into a visible knot."
    : kind.includes("roadwork")
      ? "Roadworks are active. The road is moving a little more carefully here."
      : kind.includes("breakdown")
        ? "A stopped vehicle is interrupting the flow."
        : kind.includes("heavy") || kind.includes("congestion")
          ? "Traffic is heavy here. The background vehicles are gathering."
          : kind.includes("obstacle")
            ? "An obstacle is slowing this stretch of road."
            : kind.includes("flight") || kind.includes("aircraft")
              ? "A tiny aircraft is moving through the airfield pattern."
              : kind.includes("runway")
                ? "Runway lights are active. A departure is cycling through."
                : kind.includes("train")
                  ? "A train is moving between stations."
                  : kind.includes("bus")
                    ? "A bus is moving through its route."
                    : kind.includes("rain")
                      ? "Rain is showing up as a dark blue weather patch."
                      : kind.includes("lightning")
                        ? "A lightning strike flashed over the island."
                        : kind.includes("slow traffic")
                          ? "Speed bands suggest slower traffic on this road."
                          : "This part of Singapore is having a busier moment.";
};

export const storyKicker = (incident: Incident) => {
  const kind = incident.incident_type.toLowerCase();
  if (
    ["flight", "aircraft", "runway", "train", "bus", "rain", "lightning"].some(
      (token) => kind.includes(token),
    )
  ) {
    return "HAPPENING ON THE ISLAND";
  }
  return incident.simulated ? "A SMALL FICTION" : "A MOMENT ON THE ISLAND";
};

export function buildStoryMoments({
  network,
  cityData,
  incidents,
  timestamp = new Date().toISOString(),
}: StoryMomentInput): StoryMoment[] {
  if (!network) return incidents;

  const resolution = network.resolution;
  const moments = [...incidents];

  (cityData?.roadworks.works ?? []).slice(0, 5).forEach((work) => {
    moments.push(
      makeMoment(
        timestamp,
        `story-work-${work.id}`,
        "Roadwork",
        work.road,
        cleanRoadworkMessage(work.message) ||
          "A small collection of cones is keeping busy.",
        work.pixels,
        work.simulated,
        work.edge_id,
        work.phase,
        {
          edgeId: work.edge_id,
          phase: work.phase,
          pixels: work.pixels,
          zoom: 10.5,
        },
      ),
    );
  });

  (cityData?.buses.vehicles ?? []).slice(0, 6).forEach((bus) => {
    if (!bus.route.length) return;
    const point = bus.route[Math.floor(bus.route.length * 0.45)];
    const pixel = toPixel(point, resolution);
    moments.push(
      makeMoment(
        timestamp,
        `story-bus-${bus.id}`,
        "Bus in motion",
        `Service ${bus.service}`,
        `Rolling at roughly ${bus.estimated_speed_kmh.toFixed(0)} km/h with ${
          bus.load === "LSD" ? "a lively crowd" : "some room left"
        }.`,
        [pixel],
        bus.simulated,
        -1,
        0,
        {
          follow: { kind: "bus", id: bus.id },
          pixels: [pixel],
          world: point,
          zoom: 11.2,
        },
      ),
    );
  });

  const wettest = [...(cityData?.rainfall.stations ?? [])]
    .filter((station) => station.value > 0)
    .sort((left, right) => right.value - left.value)[0];
  if (wettest) {
    moments.push(
      makeMoment(
        timestamp,
        `story-rain-${wettest.id}`,
        "Rain patch",
        wettest.name,
        `${wettest.value.toFixed(1)} mm has turned the passing clouds storm-blue.`,
        [toPixel([wettest.x, wettest.y], resolution)],
        wettest.simulated,
        -1,
        0,
        {
          pixels: [toPixel([wettest.x, wettest.y], resolution)],
          world: [wettest.x, wettest.y],
          zoom: 9.6,
        },
      ),
    );
  }

  (cityData?.lightning ?? []).slice(0, 3).forEach((strike) => {
    moments.push(
      makeMoment(
        timestamp,
        `story-lightning-${strike.id}`,
        "Lightning",
        strike.kind === "G" ? "Cloud to ground" : "Cloud to cloud",
        strike.text || "A quick flash over the little world.",
        [toPixel([strike.x, strike.y], resolution)],
        strike.simulated,
        -1,
        0,
        {
          pixels: [toPixel([strike.x, strike.y], resolution)],
          world: [strike.x, strike.y],
          zoom: 10.2,
        },
      ),
    );
  });

  network.rail.lines
    .filter((line) => !line.future)
    .slice(0, 6)
    .forEach((line, index) => {
      const stations = network.rail.stations.filter((station) =>
        station.lines.includes(line.ref),
      );
      const station = stations[(index * 3) % Math.max(1, stations.length)];
      const pixel =
        station?.pixel ?? line.pixels[Math.floor(line.pixels.length / 2)];
      if (!pixel) return;
      moments.push(
        makeMoment(
          timestamp,
          `story-train-${line.ref}`,
          line.route === "light_rail" ? "LRT train" : "MRT train",
          line.name,
          station
            ? `A train is making its way past ${station.name}.`
            : `Two tiny trains are working the ${line.ref}.`,
          [pixel],
          true,
          -1,
          0,
          {
            pixels: [pixel],
            world: [(pixel[0] + 0.5) / resolution, (pixel[1] + 0.5) / resolution],
            zoom: 10.2,
          },
        ),
      );
    });

  prepareAircraftJourneys(network)
    .slice(0, 4)
    .forEach((journey, index) => {
      const pixel =
        journey.path[
          Math.min(journey.taxi_end_index, journey.path.length - 1)
        ];
      moments.push(
        makeMoment(
          timestamp,
          `story-flight-${index}`,
          journey.operation === "arrival"
            ? "Flight arriving"
            : "Flight departing",
          journey.airport_name,
          journey.operation === "arrival"
            ? "A tiny aircraft is dropping into the airfield pattern."
            : "Runway lights are on and a tiny flight is preparing to leave.",
          [pixel],
          true,
          -1,
          0,
          {
            follow: { kind: "aircraft", index },
            pixels: [pixel],
            world: [(pixel[0] + 0.5) / resolution, (pixel[1] + 0.5) / resolution],
            zoom: 10.8,
          },
        ),
      );
    });

  const edgeById = new Map(network.edges.map((edge) => [edge.id, edge]));
  [...(cityData?.traffic_speed_bands.bands ?? [])]
    .sort((left, right) => left.speed_band - right.speed_band)
    .slice(0, 4)
    .forEach((band) => {
      const edge = edgeById.get(band.edge_id);
      if (!edge?.pixels.length) return;
      moments.push(
        makeMoment(
          timestamp,
          `story-speed-${band.edge_id}`,
          "Slow traffic",
          band.road,
          `Speed band ${band.speed_band}: the background traffic has gathered accordingly.`,
          edge.pixels,
          false,
          edge.id,
          0.5,
          {
            edgeId: edge.id,
            phase: 0.5,
            pixels: edge.pixels,
            zoom: 10.4,
          },
        ),
      );
    });

  return moments;
}
