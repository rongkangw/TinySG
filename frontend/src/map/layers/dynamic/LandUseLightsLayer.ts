import type { NetworkPayload } from "../../../types";
import { singaporeHourAt } from "../../core/time";
import { LAND_USE_LIGHTS } from "../landUseStyles";

export interface LandUseLight {
  x: number;
  y: number;
  category: string;
  seed: number;
  phase: number;
  size: number;
}

export function prepareLandUseLights(
  network: NetworkPayload,
): LandUseLight[] {
  const resolution = network.resolution;
  const roadCells = new Set<number>();
  network.road_layers.forEach((layer) => {
    layer.pixels.forEach(([x, y]) => roadCells.add(y * resolution + x));
  });
  const occupied = new Set<number>();
  const lights: LandUseLight[] = [];
  network.environment_overlay.land_use.sectors.forEach(
    (sector, sectorIndex) => {
      const settings = LAND_USE_LIGHTS[sector.category];
      if (!settings) return;
      sector.spans.forEach(([y, start, end]) => {
        for (let x = start; x <= end; x += 1) {
          const cell = y * resolution + x;
          if (roadCells.has(cell) || occupied.has(cell)) continue;
          let hash =
            Math.imul(x + 17, 374761393) ^
            Math.imul(y + 29, 668265263) ^
            Math.imul(sectorIndex + 1, 2246822519);
          hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
          if (hash % 1000 >= settings.density) continue;
          occupied.add(cell);
          lights.push({
            x,
            y,
            category: sector.category,
            seed: hash,
            phase: ((hash >>> 8) % 6283) / 1000,
            size:
              settings.size *
              (0.82 + ((hash >>> 20) % 31) / 100),
          });
        }
      });
    },
  );
  return lights;
}

function smooth(start: number, end: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

function overnightWindowAlpha(
  singaporeHour: number,
  switchOn: number,
  switchOff: number,
  fadeHours = 0.45,
) {
  const active =
    switchOn <= switchOff
      ? singaporeHour >= switchOn && singaporeHour < switchOff
      : singaporeHour >= switchOn || singaporeHour < switchOff;
  if (!active) return 0;
  const sinceOn =
    singaporeHour >= switchOn
      ? singaporeHour - switchOn
      : singaporeHour + 24 - switchOn;
  const untilOff =
    singaporeHour < switchOff
      ? switchOff - singaporeHour
      : switchOff + 24 - singaporeHour;
  return Math.min(1, sinceOn / fadeHours, untilOff / fadeHours);
}

function blink(
  seconds: number,
  phase: number,
  speed: number,
  threshold: number,
  low: number,
  high: number,
) {
  return Math.sin(seconds * speed + phase) > threshold ? high : low;
}

function lightAlpha(
  light: LandUseLight,
  singaporeHour: number,
  seconds: number,
) {
  if (light.category === "residential") {
    const switchOn = 16.75 + (light.seed % 551) / 100;
    const switchOff = 4.7 + ((light.seed >>> 9) % 421) / 100;
    const scheduleFade = overnightWindowAlpha(
      singaporeHour,
      switchOn,
      switchOff,
      0.55,
    );
    if (!scheduleFade) return 0;
    const occupancy =
      singaporeHour >= 19 && singaporeHour < 23.5
        ? 0.9
        : singaporeHour >= 23.5 || singaporeHour < 5
          ? 0.46
          : 0.68;
    const period = 1500 + (light.seed % 5400);
    const activityWave =
      0.5 +
      0.5 * Math.sin((seconds / period) * Math.PI * 2 + light.phase);
    return (
      scheduleFade *
      (0.08 +
        0.84 *
          smooth(
            1 - occupancy - 0.16,
            1 - occupancy + 0.16,
            activityWave,
          ))
    );
  }

  const strictNight = overnightWindowAlpha(singaporeHour, 19, 7);
  switch (light.category) {
    case "commercial": {
      const evening = overnightWindowAlpha(singaporeHour, 18, 2.5, 0.6);
      const cleaningShift = overnightWindowAlpha(
        singaporeHour,
        2.5,
        6.4,
        0.45,
      );
      if (!evening && !cleaningShift) return 0;
      return (
        evening * (0.72 + 0.15 * Math.sin(seconds * 0.13 + light.phase)) +
        cleaningShift * 0.28
      );
    }
    case "industrial":
      if (!strictNight) return 0;
      return light.seed % 5 === 0
        ? blink(seconds, light.phase, 1.5, 0.7, 0.18, 0.9)
        : strictNight * (0.48 + 0.14 * Math.sin(seconds * 0.06 + light.phase));
    case "civic": {
      const evening = overnightWindowAlpha(singaporeHour, 18, 23.7, 0.5);
      const dawn = overnightWindowAlpha(singaporeHour, 5.4, 7, 0.35);
      return (
        evening * (0.42 + 0.2 * Math.sin(seconds * 0.09 + light.phase)) +
        dawn * 0.24
      );
    }
    case "recreation": {
      const parkHours = overnightWindowAlpha(singaporeHour, 18.5, 23.4, 0.5);
      const dawn = overnightWindowAlpha(singaporeHour, 5.2, 6.9, 0.4);
      if (!parkHours && !dawn) return 0;
      return (
        (parkHours * 0.28 + dawn * 0.16) *
        (0.56 + 0.44 * Math.max(0, Math.sin(seconds * 0.31 + light.phase)))
      );
    }
    case "development":
      if (!strictNight) return 0;
      return blink(seconds, light.phase, 0.82, 0.08, 0.1, 0.76);
    case "agriculture":
      if (!strictNight) return 0;
      return light.seed % 3 === 0
        ? 0.18 + 0.18 * Math.sin(seconds * 0.05 + light.phase)
        : 0;
    case "military":
      if (!strictNight) return 0;
      return blink(seconds, light.phase, 1.1, 0.76, 0.06, 0.66);
    case "transport":
      if (!strictNight) return 0;
      return (Math.floor(seconds * 2.4) + light.seed) % 11 < 3
        ? 0.92
        : 0.3;
    default:
      return strictNight * 0.42;
  }
}

export function drawLandUseLights(
  context: CanvasRenderingContext2D,
  lights: LandUseLight[],
  resolution: number,
  epochMs: number,
  seconds: number,
) {
  const unit = 1 / resolution;
  const singaporeHour = singaporeHourAt(epochMs);
  lights.forEach((light) => {
    const settings = LAND_USE_LIGHTS[light.category];
    const alpha = lightAlpha(light, singaporeHour, seconds);
    if (!settings || alpha <= 0) return;
    context.fillStyle =
      settings.colours[light.seed % settings.colours.length];
    context.globalAlpha = Math.max(0, Math.min(0.94, alpha));
    const inset = (1 - light.size) / 2;
    context.fillRect(
      (light.x + inset) * unit,
      (light.y + inset) * unit,
      light.size * unit,
      light.size * unit,
    );
  });
  context.globalAlpha = 1;
}
