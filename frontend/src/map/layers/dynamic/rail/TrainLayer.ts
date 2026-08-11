import type { NetworkPayload, Point } from "../../../../types";
import { blendHex } from "../../../core/time";
import {
  buildTrainPhases,
  trainStateAt,
  type TrainPhase,
} from "./trainKinematics";
import {
  matchStationsToTrainPath,
  prepareTrimmedTrainRoute,
  trainStopAtDistance,
  type TrainRouteStop,
} from "./trainStops";
import {
  createTrainWakeState,
  nearestPathIndex,
  trainPixelPlacement,
  updateTrainWake,
  type TrainWakeState,
} from "./trainVisualState";

const TRAIN_OUTLINE_COLOUR = "rgba(3, 8, 12, 0.96)";
const TRAIN_OUTLINE_SCALE = 1.16;
const TRAIN_BODY_SCALE = 0.94;
const TRAIN_FRONT_SCALE = 1.04;
const TRAIN_WAKE_SCALE = 0.7;
const STATION_HALO_SCALE = 1.86;
const STATION_GLOW_SCALE = 1.48;
const STATION_CORE_SCALE = 1.18;
const STATION_BLINK_SPEED = 2.625;

export interface TrainLineModel {
  ref: string;
  colour: string;
  route: string;
  path: Point[];
  cumulative: number[];
  stops: TrainRouteStop[];
  phases: [TrainPhase[], TrainPhase[]];
  wakeStates: [TrainWakeState, TrainWakeState];
}

export function prepareTrainLines(network: NetworkPayload): TrainLineModel[] {
  const pixelKilometres = 50 / (network.resolution * 0.92);
  return (network.rail?.lines ?? []).flatMap((line) => {
    if (line.future) return [];
    const sourcePath = [...(line.paths ?? [])].sort(
      (left, right) => right.length - left.length,
    )[0];
    if (!sourcePath || sourcePath.length < 5) return [];
    const matchedStops = matchStationsToTrainPath(
      sourcePath,
      (network.rail?.stations ?? []).filter((station) =>
        station.lines.includes(line.ref),
      ),
    );
    const preparedRoute = prepareTrimmedTrainRoute(
      sourcePath,
      matchedStops,
    );
    if (!preparedRoute) return [];
    const { path, cumulative, stops } = preparedRoute;
    const stationDistances = stops.map(
      ({ routeDistance }) => routeDistance,
    );
    const topSpeedKmh = line.route === "light_rail" ? 30 : 85;
    const maximumSpeed = topSpeedKmh / 3600 / pixelKilometres;
    return [
      {
        ref: line.ref,
        colour: line.colour,
        route: line.route,
        path,
        cumulative,
        stops,
        phases: [
          buildTrainPhases(
            stationDistances,
            false,
            maximumSpeed,
          ),
          buildTrainPhases(
            stationDistances,
            true,
            maximumSpeed,
          ),
        ],
        wakeStates: [createTrainWakeState(), createTrainWakeState()],
      },
    ];
  });
}

function lighterRailColour(colour: string, amount: number) {
  return /^#[0-9a-f]{6}$/i.test(colour)
    ? blendHex(colour, "#ffffff", amount)
    : colour;
}

function fillPixel(
  context: CanvasRenderingContext2D,
  [x, y]: Point,
  unit: number,
  scale: number,
) {
  const inset = ((1 - scale) * unit) / 2;
  context.fillRect(
    x * unit + inset,
    y * unit + inset,
    unit * scale,
    unit * scale,
  );
}

function drawActiveStation(
  context: CanvasRenderingContext2D,
  pixel: Point,
  colour: string,
  unit: number,
  activity: number,
  elapsedSeconds: number,
  trainIndex: number,
) {
  const pulse =
    0.5 +
    0.5 *
      Math.sin(elapsedSeconds * STATION_BLINK_SPEED + trainIndex * 1.9);

  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = colour;
  context.globalAlpha = activity * (0.14 + pulse * 0.16);
  context.shadowColor = colour;
  context.shadowBlur = 10;
  fillPixel(context, pixel, unit, STATION_HALO_SCALE);

  context.shadowBlur = 5;
  context.globalAlpha = activity * (0.24 + pulse * 0.2);
  fillPixel(context, pixel, unit, STATION_GLOW_SCALE);

  context.globalCompositeOperation = "source-over";
  context.shadowBlur = 0;
  context.fillStyle = lighterRailColour(colour, 0.22);
  context.globalAlpha = activity * (0.82 + pulse * 0.18);
  fillPixel(context, pixel, unit, STATION_CORE_SCALE);
  context.restore();
}

export function drawTrains(
  context: CanvasRenderingContext2D,
  lines: TrainLineModel[],
  resolution: number,
  elapsedSeconds: number,
) {
  const unit = 1 / resolution;
  lines.forEach((line) => {
    line.phases.forEach((phases, trainIndex) => {
      const train = trainStateAt(phases, elapsedSeconds);
      const head = nearestPathIndex(line.cumulative, train.distance);
      const placement = trainPixelPlacement(
        line.path.length,
        head,
        train,
      );
      const wake = updateTrainWake(
        line.wakeStates[trainIndex],
        placement.bodyIndices,
        train.direction,
        train.moving,
        elapsedSeconds,
      );
      const bodyColour = lighterRailColour(line.colour, 0.14);
      const frontColour = lighterRailColour(line.colour, 0.3);

      context.save();
      context.shadowBlur = 0;

      wake.forEach(({ pathIndex, opacity }) => {
        const pixel = line.path[pathIndex];
        if (!pixel) return;
        context.fillStyle = bodyColour;
        context.globalAlpha = opacity;
        fillPixel(context, pixel, unit, TRAIN_WAKE_SCALE);
      });

      if (
        train.stationPhase !== "moving" &&
        train.stationActivity > 0
      ) {
        const stop = trainStopAtDistance(
          line.stops,
          train.distance,
        );
        drawActiveStation(
          context,
          stop?.stationPixel ?? line.path[head],
          line.colour,
          unit,
          train.stationActivity,
          elapsedSeconds,
          trainIndex,
        );
      }

      context.fillStyle = TRAIN_OUTLINE_COLOUR;
      context.globalAlpha = 0.94;
      placement.bodyIndices.forEach((pixelIndex) => {
        fillPixel(
          context,
          line.path[pixelIndex],
          unit,
          TRAIN_OUTLINE_SCALE,
        );
      });

      context.fillStyle = bodyColour;
      context.globalAlpha = 0.98;
      placement.bodyIndices.forEach((pixelIndex) => {
        fillPixel(
          context,
          line.path[pixelIndex],
          unit,
          TRAIN_BODY_SCALE,
        );
      });

      if (placement.frontIndex !== null) {
        context.fillStyle = frontColour;
        context.globalAlpha = 1;
        fillPixel(
          context,
          line.path[placement.frontIndex],
          unit,
          TRAIN_FRONT_SCALE,
        );
      }
      context.restore();
    });
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}
