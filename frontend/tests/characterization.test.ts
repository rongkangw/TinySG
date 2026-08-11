import {
  cellsAround,
  rasterizePixelRoute,
  roadCellScale,
  roadOutlineScale,
  roadTier,
} from "../src/map/core/geometry.ts";
import {
  blendHex,
  daylightAt,
  singaporeHourAt,
} from "../src/map/core/time.ts";
import {
  routeHeading,
  routePosition,
  timedVehicleProgress,
} from "../src/map/vehicles/motion.ts";
import {
  LAYER_Z_INDEX,
  ORDERED_LAYER_IDS,
  sortLayers,
} from "../src/map/layers/order.ts";
import {
  cameraTransform,
  screenToWorld,
  zoomCameraAt,
} from "../src/map/interaction/cameraTransform.ts";
import { isMajorRoadHoverClass } from "../src/map/interaction/hoverKey.ts";
import {
  buildTrainPhases,
  trainStateAt,
  travelDuration,
  travelledDistance,
} from "../src/map/layers/dynamic/rail/trainKinematics.ts";
import {
  createTrainWakeState,
  nearestPathIndex,
  trainPixelPlacement,
  updateTrainWake,
  TRAIN_WAKE_MAX_CELLS,
} from "../src/map/layers/dynamic/rail/trainVisualState.ts";
import {
  matchStationsToTrainPath,
  prepareTrimmedTrainRoute,
  trainStopAtDistance,
  TRAIN_STOP_MAX_PATH_DISTANCE_CELLS,
} from "../src/map/layers/dynamic/rail/trainStops.ts";
import {
  railCellOwner,
  railPaintPlan,
} from "../src/map/layers/static/railPaintPlan.ts";
import {
  buildLandUseAreaGrid,
  buildLandUseAreas,
} from "../src/map/layers/static/landUseAreas.ts";
import { continuousRunwayPath } from "../src/map/layers/dynamic/vehicles/AircraftLayer.ts";
import {
  buildRoadSpeedSummaries,
  formatAverageSpeedRange,
  trafficDensityForSpeedBand,
  trafficSpeedMultiplierForBand,
} from "../src/map/traffic/speedBandMetrics.ts";
import { cleanRoadworkMessage } from "../src/features/roadworks/roadworkCopy.ts";
import { roadworkCompletion } from "../src/features/roadworks/roadworkProgress.ts";
import type {
  Point,
  RailLine,
  RailStation,
  RoadEdge,
  TrafficSpeedBand,
} from "../src/types.ts";

type TestCase = {
  name: string;
  run: () => void;
};

const cases: TestCase[] = [];

function test(name: string, run: () => void) {
  cases.push({ name, run });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message = "values differ") {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
}

function deepEqual(actual: unknown, expected: unknown, message = "values differ") {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    `${message}: expected ${expectedJson}, received ${actualJson}`,
  );
}

function approximately(
  actual: number,
  expected: number,
  tolerance = 1e-9,
  message = "values differ",
) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, received ${actual}`,
  );
}

function railStation(
  id: string,
  pixel: Point,
  name = id,
): RailStation {
  return {
    id,
    name,
    ref: id,
    lines: ["TEST"],
    colours: ["#00AA88"],
    pixel,
    lrt: false,
    matched: true,
  };
}

function railLine(
  ref: string,
  route: string,
  pixels: Point[],
  future = false,
): RailLine {
  return {
    ref,
    name: ref,
    colour: ref === "NEL" ? "#9016B2" : "#A8C6BD",
    future,
    route,
    pixels,
    paths: [pixels],
  };
}

test("road hierarchy retains its visual falloff", () => {
  equal(roadTier("motorway"), "1");
  equal(roadTier("primary_link"), "3");
  equal(roadTier("living_street"), "7");
  assert(
    roadCellScale("motorway") > roadCellScale("primary"),
    "motorways should remain wider than primary roads",
  );
  assert(
    roadCellScale("primary") > roadCellScale("residential"),
    "primary roads should remain wider than residential roads",
  );
  assert(
    roadCellScale("primary_link") < roadCellScale("primary"),
    "link roads should remain narrower than their parent class",
  );
});

test("road hover applies to major through roads but not link ramps", () => {
  assert(isMajorRoadHoverClass("motorway"), "motorways should highlight");
  assert(isMajorRoadHoverClass("trunk"), "trunk roads should highlight");
  assert(isMajorRoadHoverClass("primary"), "primary roads should highlight");
  assert(
    !isMajorRoadHoverClass("motorway_link"),
    "motorway links should not highlight",
  );
  assert(
    !isMajorRoadHoverClass("primary_link"),
    "primary links should not highlight",
  );
  assert(
    !isMajorRoadHoverClass("secondary"),
    "secondary roads should not highlight",
  );
});

test("road casings keep a consistent boundary outside every road tier", () => {
  [
    "motorway",
    "motorway_link",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "living_street",
    "service",
  ].forEach((roadClass) => {
    const body = roadCellScale(roadClass);
    const outline = roadOutlineScale(roadClass);
    assert(
      outline > body,
      `${roadClass} casing must extend beyond its road body`,
    );
    approximately(
      outline - body,
      Math.min(0.2, 1.16 - body),
      1e-12,
      `${roadClass} casing thickness changed`,
    );
    assert(
      outline <= 1.16,
      `${roadClass} casing exceeded its pixel-cell cap`,
    );
  });
});

test("land-use hover areas split same-category disconnected sectors", () => {
  const areas = buildLandUseAreas(
    [
      {
        category: "residential",
        spans: [
          [0, 0, 1],
          [1, 0, 1],
          [0, 4, 4],
        ],
        outline_spans: [],
      },
    ],
    6,
  );
  equal(areas.length, 2);
  assert(
    areas.every((area) => area.category === "residential"),
    "component split should preserve land-use category",
  );
  const grid = buildLandUseAreaGrid(areas, 6);
  assert(grid[0], "first component should be addressable");
  assert(grid[4], "second component should be addressable");
  assert(
    grid[0]?.id !== grid[4]?.id,
    "disconnected areas need separate hover targets",
  );
});

test("route rasterization produces bounded contiguous pixel centres", () => {
  const resolution = 8;
  const route = rasterizePixelRoute(
    [
      [0, 0],
      [1, 1],
    ],
    resolution,
  );
  equal(route.length, resolution);
  const pixels = route.map(
    ([x, y]) =>
      [Math.floor(x * resolution), Math.floor(y * resolution)] as Point,
  );
  deepEqual(pixels[0], [0, 0]);
  deepEqual(pixels[pixels.length - 1], [7, 7]);
  pixels.forEach(([x, y], index) => {
    assert(x >= 0 && x < resolution && y >= 0 && y < resolution, "pixel escaped grid");
    if (index === 0) return;
    const previous = pixels[index - 1];
    assert(
      Math.max(Math.abs(x - previous[0]), Math.abs(y - previous[1])) === 1,
      "rasterized steps must touch their predecessor",
    );
  });
});

test("route rasterization handles one-point and out-of-range routes", () => {
  deepEqual(rasterizePixelRoute([], 16), []);
  const route = rasterizePixelRoute([[2, -1]], 16);
  equal(route.length, 1);
  deepEqual(route[0], [15.5 / 16, 0.5 / 16]);
});

test("road-event propagation stays on the source edge with symmetric falloff", () => {
  const edge: RoadEdge = {
    id: 1,
    road: "Test Road",
    highway_class: "primary",
    points: [],
    pixels: Array.from({ length: 101 }, (_, index) => [index, 9] as Point),
  };
  const cells = cellsAround(edge, 0.5, 496);
  const sourcePixels = new Set(edge.pixels.map(([x, y]) => `${x}:${y}`));
  assert(
    cells.every(({ pixel: [x, y] }) => sourcePixels.has(`${x}:${y}`)),
    "propagation created an off-road cell",
  );
  const centre = cells.find(({ pixel }) => pixel[0] === 50);
  assert(centre, "centre cell was not included");
  approximately(centre.falloff, 1);
  const left = cells.find(({ pixel }) => pixel[0] === 44);
  const right = cells.find(({ pixel }) => pixel[0] === 56);
  assert(left && right, "symmetric neighbours were not included");
  approximately(left.falloff, right.falloff);
  assert(left.falloff < centre.falloff, "falloff should decrease away from the event");
});

test("live timed vehicles travel once and clamp at the destination", () => {
  const vehicle = {
    started_at: "2026-01-01T00:00:00.000Z",
    duration_seconds: 100,
    simulated: false,
  };
  approximately(
    timedVehicleProgress(vehicle, Date.parse("2026-01-01T00:00:50.000Z")),
    0.5,
  );
  equal(
    timedVehicleProgress(vehicle, Date.parse("2026-01-01T00:02:30.000Z")),
    1,
  );
});

test("simulated timed vehicles preserve the existing reverse motion policy", () => {
  const vehicle = {
    started_at: "2026-01-01T00:00:00.000Z",
    duration_seconds: 100,
    simulated: true,
  };
  approximately(
    timedVehicleProgress(vehicle, Date.parse("2026-01-01T00:02:05.000Z")),
    0.75,
  );
  approximately(
    timedVehicleProgress(vehicle, Date.parse("2026-01-01T00:03:45.000Z")),
    0.25,
  );
});

test("route position and heading retain pixel-step semantics", () => {
  const route: Point[] = [
    [3, 4],
    [4, 4],
    [4, 5],
    [5, 5],
    [6, 5],
  ];
  deepEqual(routePosition(route, -1), [3, 4]);
  deepEqual(routePosition(route, 0.5), [4, 5]);
  deepEqual(routePosition(route, 2), [6, 5]);
  deepEqual(routeHeading(route, 2), {
    head: [4, 5],
    behind: [4, 4],
    directionX: 0,
    directionY: 1,
  });
});

test("aircraft select one continuous runway without cross-airport jumps", () => {
  const pixels: Point[] = [
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [20, 8],
    [20, 9],
    [20, 10],
  ];
  const firstRunway = continuousRunwayPath(pixels, 0);
  const secondRunway = continuousRunwayPath(pixels, 1);
  equal(firstRunway.length, 4);
  equal(secondRunway.length, 3);
  [firstRunway, secondRunway].forEach((path) => {
    path.slice(1).forEach(([x, y], index) => {
      const previous = path[index];
      assert(
        Math.max(Math.abs(x - previous[0]), Math.abs(y - previous[1])) === 1,
        "aircraft runway path contains a teleporting step",
      );
    });
  });
});

test("camera transforms round-trip and keep cursor focus while zooming", () => {
  const viewport = { width: 1200, height: 760 };
  const camera = { zoom: 1.4, x: 72, y: -31 };
  const transform = cameraTransform(camera, viewport);
  const world = { x: 0.63, y: 0.27 };
  const screen = {
    x: transform.originX + world.x * transform.scale,
    y: transform.originY + world.y * transform.scale,
  };
  const roundTrip = screenToWorld(screen.x, screen.y, transform);
  approximately(roundTrip.x, world.x);
  approximately(roundTrip.y, world.y);

  const zoomed = zoomCameraAt(
    camera,
    viewport,
    screen.x,
    screen.y,
    2.8,
  );
  const afterZoom = screenToWorld(
    screen.x,
    screen.y,
    cameraTransform(zoomed, viewport),
  );
  approximately(afterZoom.x, world.x);
  approximately(afterZoom.y, world.y);
});

test("train phases retain dwell, constant speed, and opposite starts", () => {
  const forward = buildTrainPhases([0, 20], false, 1);
  const reverse = buildTrainPhases([0, 20], true, 1);
  equal(forward[0].duration, 40);
  equal(forward[0].from, 0);
  equal(reverse[0].from, 20);
  equal(forward[1].moving, true);
  equal(forward[1].direction, 1);
  equal(reverse[1].direction, -1);

  const hiddenAtStation = trainStateAt(forward, 8);
  equal(hiddenAtStation.moving, false);
  equal(hiddenAtStation.visible, 0);
  equal(hiddenAtStation.stationPhase, "dwell");
  equal(hiddenAtStation.stationActivity, 1);
  const moving = trainStateAt(forward, 41);
  equal(moving.moving, true);
  equal(moving.stationPhase, "moving");
  equal(moving.stationActivity, 0);
  equal(moving.distance, 1);
});

test("train travel is linear and clamps identically in both directions", () => {
  equal(travelDuration(20, 2), 10);
  equal(travelledDistance(20, -3, 2), 0);
  equal(travelledDistance(20, 3, 2), 6);
  equal(travelledDistance(20, 10, 2), 20);
  equal(travelledDistance(20, 30, 2), 20);

  const forward = buildTrainPhases([0, 20], false, 2);
  const reverse = buildTrainPhases([0, 20], true, 2);
  equal(forward[1].duration, 10);
  equal(reverse[1].duration, 10);
  equal(trainStateAt(forward, 43).distance, 6);
  equal(trainStateAt(reverse, 43).distance, 14);
});

test("station activity spans every ingress, dwell, and egress boundary", () => {
  const phases = buildTrainPhases([0, 20], false, 1);
  const ingressFirst = trainStateAt(phases, 0);
  equal(ingressFirst.stationPhase, "ingress");
  equal(ingressFirst.transitionProgress, 0);
  assert(
    ingressFirst.stationActivity > 0,
    "station must activate on the first ingress frame",
  );

  const ingressLast = trainStateAt(phases, 4.999);
  equal(ingressLast.stationPhase, "ingress");
  assert(
    ingressLast.stationActivity > ingressFirst.stationActivity,
    "station activity should ramp up through ingress",
  );

  const dwellFirst = trainStateAt(phases, 5);
  equal(dwellFirst.stationPhase, "dwell");
  equal(dwellFirst.stationActivity, 1);

  const egressFirst = trainStateAt(phases, 35);
  equal(egressFirst.stationPhase, "egress");
  equal(egressFirst.transitionProgress, 0);
  equal(egressFirst.stationActivity, 1);

  const egressFinal = trainStateAt(phases, 40);
  equal(egressFinal.stationPhase, "egress");
  equal(egressFinal.transitionProgress, 1);
  assert(
    egressFinal.stationActivity > 0,
    "station must remain active on the final egress frame",
  );

  const departed = trainStateAt(phases, 40.001);
  equal(departed.stationPhase, "moving");
  equal(departed.stationActivity, 0);
});

test("train pixels remain front-to-tail in both directions and transitions", () => {
  const forward = trainPixelPlacement(30, 10, {
    direction: 1,
    moving: true,
    stationPhase: "moving",
    visible: 5,
  });
  deepEqual(forward.bodyIndices, [10, 9, 8, 7, 6]);
  equal(forward.frontIndex, 10);

  const reverse = trainPixelPlacement(30, 10, {
    direction: -1,
    moving: true,
    stationPhase: "moving",
    visible: 5,
  });
  deepEqual(reverse.bodyIndices, [10, 11, 12, 13, 14]);
  equal(reverse.frontIndex, 10);

  const forwardIngress = trainPixelPlacement(30, 10, {
    direction: 1,
    moving: false,
    stationPhase: "ingress",
    visible: 3,
  });
  deepEqual(forwardIngress.bodyIndices, [10, 9, 8]);
  equal(forwardIngress.frontIndex, 10);

  const reverseIngress = trainPixelPlacement(30, 10, {
    direction: -1,
    moving: false,
    stationPhase: "ingress",
    visible: 3,
  });
  deepEqual(reverseIngress.bodyIndices, [10, 11, 12]);
  equal(reverseIngress.frontIndex, 10);

  const forwardEgress = trainPixelPlacement(30, 10, {
    direction: 1,
    moving: false,
    stationPhase: "egress",
    visible: 3,
  });
  deepEqual(forwardEgress.bodyIndices, [12, 11, 10]);
  equal(forwardEgress.frontIndex, 12);

  const reverseEgress = trainPixelPlacement(30, 10, {
    direction: -1,
    moving: false,
    stationPhase: "egress",
    visible: 3,
  });
  deepEqual(reverseEgress.bodyIndices, [8, 9, 10]);
  equal(reverseEgress.frontIndex, 8);
});

test("train stops reject off-branch projections beyond the measured threshold", () => {
  equal(TRAIN_STOP_MAX_PATH_DISTANCE_CELLS, 2);
  const path = Array.from(
    { length: 11 },
    (_, index) => [index, 0] as Point,
  );
  const stops = matchStationsToTrainPath(path, [
    railStation("exact", [1, 0]),
    railStation("harbourfront-offset", [4, 1]),
    railStation("two-cell-offset", [6, 2]),
    railStation("esplanade-off-branch", [2, 9]),
  ]);
  deepEqual(
    stops.map(({ stationId }) => stationId),
    ["exact", "harbourfront-offset", "two-cell-offset"],
  );
  deepEqual(
    stops.map(({ pathDistance }) => pathDistance),
    [0, 1, 2],
  );
});

test("train stop dedupe prefers the closest deterministic station pixel", () => {
  const path: Point[] = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  const forward = matchStationsToTrainPath(path, [
    railStation("z-far", [1, 1.5]),
    railStation("b-tied", [1, 1]),
    railStation("a-tied", [1, -1]),
  ]);
  const reversed = matchStationsToTrainPath(path, [
    railStation("a-tied", [1, -1]),
    railStation("b-tied", [1, 1]),
    railStation("z-far", [1, 1.5]),
  ]);
  equal(forward.length, 1);
  equal(forward[0].stationId, "a-tied");
  deepEqual(forward[0].stationPixel, [1, -1]);
  deepEqual(forward, reversed, "dedupe changed with input order");
});

test("trimmed train stops retain adjusted indices, distances, and exact pixels", () => {
  const sourcePath = Array.from(
    { length: 7 },
    (_, index) => [index, 0] as Point,
  );
  const matched = matchStationsToTrainPath(sourcePath, [
    railStation("first", [1, 0]),
    railStation("offset-middle", [3, 1]),
    railStation("last", [5, 0]),
  ]);
  const prepared = prepareTrimmedTrainRoute(sourcePath, matched);
  assert(prepared, "valid matched stops did not prepare a route");
  deepEqual(prepared.path, [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  deepEqual(
    prepared.stops.map(({ routeIndex }) => routeIndex),
    [0, 2, 4],
  );
  deepEqual(
    prepared.stops.map(({ routeDistance }) => routeDistance),
    [0, 2, 4],
  );

  const stop = trainStopAtDistance(prepared.stops, 2);
  assert(stop, "kinematic stop distance did not resolve");
  equal(stop.stationId, "offset-middle");
  deepEqual(
    stop.stationPixel,
    [3, 1],
    "glow lookup lost the actual station pixel",
  );
  equal(
    trainStopAtDistance(prepared.stops, 2.1),
    undefined,
    "unmatched distance should use the renderer's safe route fallback",
  );
});

test("nearest route samples step symmetrically in both directions", () => {
  const cumulative = Array.from({ length: 11 }, (_, index) => index);
  equal(nearestPathIndex(cumulative, 4.49), 4);
  equal(nearestPathIndex(cumulative, 4.51), 5);
  equal(
    nearestPathIndex(cumulative, 4.5),
    4,
    "midpoint ties must prefer the lower route index",
  );
  [1.2, 4.49, 4.51, 8.8].forEach((distance) => {
    equal(
      nearestPathIndex(cumulative, distance) +
        nearestPathIndex(cumulative, 10 - distance),
      10,
      `mirrored distance ${distance} stepped asymmetrically`,
    );
  });
});

test("train wake samples recent cells and clears across stops or reversals", () => {
  const wake = createTrainWakeState();
  let cells = updateTrainWake(
    wake,
    [10, 9, 8, 7, 6],
    1,
    true,
    0,
  );
  equal(cells.length, 0, "the first moving frame should only seed history");

  const bodies = [
    [11, 10, 9, 8, 7],
    [12, 11, 10, 9, 8],
    [13, 12, 11, 10, 9],
    [14, 13, 12, 11, 10],
    [15, 14, 13, 12, 11],
  ];
  bodies.forEach((body, index) => {
    cells = updateTrainWake(wake, body, 1, true, (index + 1) * 0.1);
  });

  assert(
    cells.length <= TRAIN_WAKE_MAX_CELLS,
    "wake exceeded its cell cap",
  );
  const currentBody = new Set(bodies[bodies.length - 1]);
  assert(
    cells.every(({ pathIndex }) => !currentBody.has(pathIndex)),
    "wake overlapped the current train body",
  );
  assert(
    cells[0].opacity > cells[cells.length - 1].opacity,
    "older wake samples should be dimmer",
  );
  assert(
    cells.every(({ age }) => age >= 0),
    "wake sample age must remain non-negative",
  );

  cells = updateTrainWake(
    wake,
    bodies[bodies.length - 1],
    1,
    true,
    1,
  );
  assert(cells.length > 0, "recent wake samples faded too early");
  cells = updateTrainWake(
    wake,
    bodies[bodies.length - 1],
    1,
    true,
    1.5,
  );
  equal(cells.length, 0, "expired wake samples should be discarded");

  cells = updateTrainWake(wake, [], 1, false, 1.6);
  equal(cells.length, 0, "stationary trains must clear their wake");
  cells = updateTrainWake(
    wake,
    [25, 24, 23, 22, 21],
    1,
    true,
    1.7,
  );
  equal(
    cells.length,
    0,
    "movement after a station must not inherit the previous leg",
  );
  cells = updateTrainWake(
    wake,
    [20, 21, 22, 23, 24],
    -1,
    true,
    1.8,
  );
  equal(cells.length, 0, "direction changes must clear wake history");
});

test("Singapore clock and daylight transitions remain deterministic", () => {
  equal(singaporeHourAt(Date.UTC(2026, 0, 1, 0, 0, 0)), 8);
  equal(singaporeHourAt(Date.UTC(2026, 0, 1, 16, 0, 0)), 0);
  equal(daylightAt(Date.UTC(2026, 0, 1, 4, 0, 0)), 1);
  equal(daylightAt(Date.UTC(2026, 0, 1, 16, 0, 0)), 0);
  approximately(daylightAt(Date.UTC(2026, 0, 1, 22, 45, 0)), 0.5);
  equal(blendHex("#000000", "#ffffff", 0.5), "rgb(128,128,128)");
  equal(blendHex("#000000", "#ffffff", 2), "rgb(255,255,255)");
});

test("the canonical layer stack preserves the world hierarchy", () => {
  deepEqual(ORDERED_LAYER_IDS, [
    "baseMap",
    "landUseOverlay",
    "sectorLights",
    "runwayLights",
    "backgroundTraffic",
    "roadworks",
    "incidents",
    "buses",
    "railInfrastructure",
    "trains",
    "aircraft",
    "lightning",
    "clouds",
    "hoverHighlight",
  ]);
  assert(
    LAYER_Z_INDEX.baseMap < LAYER_Z_INDEX.backgroundTraffic &&
      LAYER_Z_INDEX.backgroundTraffic < LAYER_Z_INDEX.buses &&
      LAYER_Z_INDEX.buses < LAYER_Z_INDEX.railInfrastructure &&
      LAYER_Z_INDEX.railInfrastructure < LAYER_Z_INDEX.clouds &&
      LAYER_Z_INDEX.clouds < LAYER_Z_INDEX.hoverHighlight,
    "map < traffic/buses < MRT < clouds < hover must remain invariant",
  );
});

test("rail painting completes every outline before ordered colour tracks", () => {
  const shared: Point = [12, 9];
  const future = railLine("JRL", "subway", [shared], true);
  const lrt = railLine("SKLRT", "light_rail", [shared]);
  const mrt = railLine("NEL", "subway", [shared]);
  const lines = [mrt, future, lrt];
  const plan = railPaintPlan(lines);

  deepEqual(
    plan.map(({ kind, line }) => `${kind}:${line.ref}`),
    [
      "outline:JRL",
      "outline:SKLRT",
      "outline:NEL",
      "track:JRL",
      "track:SKLRT",
      "track:NEL",
    ],
  );
  equal(
    railCellOwner(lines, shared)?.ref,
    "NEL",
    "MRT should own a cell shared with LRT",
  );
  deepEqual(
    lines.map(({ ref }) => ref),
    ["NEL", "JRL", "SKLRT"],
    "rail paint planning mutated its caller",
  );
});

test("layer sorting is immutable and deterministic for equal z-index values", () => {
  const input = [
    { id: "clouds", zIndex: 80 },
    { id: "trains", zIndex: 55 },
    { id: "rail-b", zIndex: 50 },
    { id: "rail-a", zIndex: 50 },
  ] as const;
  const sorted = sortLayers(input);
  deepEqual(
    sorted.map(({ id }) => id),
    ["rail-a", "rail-b", "trains", "clouds"],
  );
  deepEqual(
    input.map(({ id }) => id),
    ["clouds", "trains", "rail-b", "rail-a"],
    "sortLayers mutated its caller",
  );
});

test("road hover averages every observed speed-band section in its road group", () => {
  const edges: RoadEdge[] = [
    {
      id: 41,
      road: "PIE",
      highway_class: "motorway",
      points: [[0, 0], [1, 0]],
      pixels: [[0, 0], [1, 0]],
    },
    {
      id: 42,
      road: "PIE",
      highway_class: "motorway",
      points: [[1, 0], [2, 0]],
      pixels: [[1, 0], [2, 0]],
    },
  ];
  const bands: TrafficSpeedBand[] = [
    {
      edge_id: 41,
      road: "PIE",
      speed_band: 2,
      minimum_speed: 10,
      maximum_speed: 19,
    },
    {
      edge_id: 42,
      road: "PIE",
      speed_band: 6,
      minimum_speed: 50,
      maximum_speed: 59,
    },
  ];
  const summaries = buildRoadSpeedSummaries(
    new Map([["PIE\u0000motorway", edges]]),
    bands,
  );
  const summary = summaries.get("PIE\u0000motorway");
  assert(summary, "PIE speed summary was not created");
  equal(summary.averageBand, 4);
  equal(summary.averageMinimumKmh, 30);
  equal(summary.averageMaximumKmh, 39);
  equal(formatAverageSpeedRange(summary), "30–39 km/h");
  equal(summary.sections, 2);
});

test("roadwork copy removes source boilerplate without losing useful detail", () => {
  equal(cleanRoadworkMessage("For all details"), "");
  equal(
    cleanRoadworkMessage("Lane 2 closed · For all details visit the portal"),
    "Lane 2 closed",
  );
});

test("roadwork progress clamps between its start and completion dates", () => {
  const start = "2026-08-01T00:00:00+08:00";
  const end = "2026-08-03T00:00:00+08:00";
  equal(
    roadworkCompletion(start, end, Date.parse("2026-08-02T00:00:00+08:00")),
    0.5,
  );
  equal(roadworkCompletion(start, end, Date.parse("2026-07-01")), 0);
  equal(roadworkCompletion(start, end, Date.parse("2026-09-01")), 1);
  equal(roadworkCompletion(start, undefined), null);
  equal(
    roadworkCompletion(
      "/Date(1785513600000+0800)/",
      "/Date(1785686400000+0800)/",
      1785600000000,
    ),
    0.5,
  );
});

test("lower speed bands create denser and slower background traffic", () => {
  for (let band = 1; band < 8; band += 1) {
    assert(
      trafficDensityForSpeedBand(band) >
        trafficDensityForSpeedBand(band + 1),
      `band ${band} should be denser than band ${band + 1}`,
    );
    assert(
      trafficSpeedMultiplierForBand(band) <
        trafficSpeedMultiplierForBand(band + 1),
      `band ${band} should move slower than band ${band + 1}`,
    );
  }
});

let failures = 0;
for (const testCase of cases) {
  try {
    testCase.run();
    console.log(`✓ ${testCase.name}`);
  } catch (reason) {
    failures += 1;
    const detail = reason instanceof Error ? reason.message : String(reason);
    console.error(`✗ ${testCase.name}\n  ${detail}`);
  }
}

if (failures > 0) {
  throw new Error(`${failures} characterization test${failures === 1 ? "" : "s"} failed`);
}

console.log(`\n${cases.length} characterization tests passed.`);
