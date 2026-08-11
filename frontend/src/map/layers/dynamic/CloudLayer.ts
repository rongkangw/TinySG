import type { CityDataPayload } from "../../../types";

interface CloudVariant {
  light: HTMLCanvasElement;
  storm: HTMLCanvasElement;
}

export interface CloudSprite {
  variants: CloudVariant[];
  width: number;
  height: number;
  lane: number;
  speed: number;
  offset: number;
  opacity: number;
  morphSeconds: number;
  x: number | null;
  y: number | null;
  velocityX: number;
  velocityY: number;
  currentSpeed: number;
  lastSeconds: number | null;
}

const LIGHT_PALETTES = [
  ["#dbe4e8", "#afc0ca", "#869ba9", "#c8d3da"],
  ["#cddbe1", "#9fb4c0", "#758d9d", "#b9c8d0"],
  ["#e0e5e7", "#bac5ca", "#8fa0a8", "#ccd5d8"],
];

const STORM_PALETTES = [
  ["#667889", "#3f596d", "#284b67", "#1e3448"],
  ["#71808b", "#4c6170", "#315c78", "#243d51"],
  ["#5f707d", "#394f61", "#2c536d", "#1b3043"],
];

function renderCloudVariant(
  cloudIndex: number,
  variantIndex: number,
  width: number,
  height: number,
  storm: boolean,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const palette = (storm ? STORM_PALETTES : LIGHT_PALETTES)[
    cloudIndex % LIGHT_PALETTES.length
  ];
  const seed = cloudIndex * 113 + variantIndex * 197 + 17;
  const random = (salt: number) => {
    const value = Math.sin((seed + salt * 71) * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const centre = {
    x: width * (0.42 + random(1) * 0.16),
    y: height * (0.42 + random(2) * 0.15),
  };
  const mainLobe = {
    x: centre.x,
    y: centre.y,
    rx: width * (0.2 + random(3) * 0.1),
    ry: height * (0.23 + random(4) * 0.14),
  };
  const satelliteCount = 3 + Math.floor(random(5) * 6);
  const lobes = [
    mainLobe,
    ...Array.from({ length: satelliteCount }, (_, lobeIndex) => {
      const angle = random(10 + lobeIndex * 5) * Math.PI * 2;
      const reach =
        width * (0.08 + random(11 + lobeIndex * 5) * 0.24);
      return {
        x:
          centre.x +
          Math.cos(angle) * reach +
          (random(12 + lobeIndex * 5) - 0.5) * width * 0.08,
        y:
          centre.y +
          Math.sin(angle) * reach * (height / width) * 1.7 +
          (random(13 + lobeIndex * 5) - 0.5) * height * 0.12,
        rx: width * (0.07 + random(14 + lobeIndex * 5) * 0.15),
        ry: height * (0.11 + random(15 + lobeIndex * 5) * 0.2),
      };
    }),
  ];
  const notchCount = 1 + Math.floor(random(70) * 3);
  const notches = Array.from({ length: notchCount }, (_, notchIndex) => {
    const angle = random(71 + notchIndex * 4) * Math.PI * 2;
    return {
      x:
        centre.x +
        Math.cos(angle) *
          mainLobe.rx *
          (0.75 + random(72 + notchIndex * 4) * 0.35),
      y:
        centre.y +
        Math.sin(angle) *
          mainLobe.ry *
          (0.75 + random(73 + notchIndex * 4) * 0.35),
      rx: width * (0.055 + random(74 + notchIndex * 4) * 0.07),
      ry: height * (0.07 + random(75 + notchIndex * 4) * 0.1),
    };
  });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const positiveField = Math.max(
        ...lobes.map(
          (lobe) =>
            1 -
            Math.sqrt(
              ((x - lobe.x) / lobe.rx) ** 2 +
                ((y - lobe.y) / lobe.ry) ** 2,
            ),
        ),
      );
      const notchField = Math.max(
        0,
        ...notches.map(
          (notch) =>
            1 -
            Math.sqrt(
              ((x - notch.x) / notch.rx) ** 2 +
                ((y - notch.y) / notch.ry) ** 2,
            ),
        ),
      );
      const field =
        positiveField -
        notchField * 0.62 +
        Math.sin(
          x * 0.21 +
            y * 0.14 +
            cloudIndex * 1.9 +
            variantIndex * 2.4,
        ) *
          0.035;
      const noise =
        ((x * 37 + y * 61 + cloudIndex * 83 + variantIndex * 47) % 101) /
        100;
      const boundary = field + (noise - 0.5) * 0.075;
      if (boundary < 0.035) continue;
      const edgeAlpha =
        boundary < 0.14
          ? 0.26 + ((boundary - 0.035) / 0.105) * 0.5
          : 0.82;
      const layer = Math.max(
        0,
        Math.min(
          3,
          Math.floor(
            (field * 0.58 +
              noise * 0.32 +
              (storm ? (y / height) * 0.12 : 0)) *
              4,
          ),
        ),
      );
      context.fillStyle = palette[layer];
      context.globalAlpha = edgeAlpha * (0.86 + noise * 0.14);
      context.fillRect(x, y, 1, 1);
    }
  }
  context.globalAlpha = 1;
  return canvas;
}

export function prepareCloudSprites(): CloudSprite[] {
  return Array.from({ length: 7 }, (_, cloudIndex) => {
    const width = 68 + ((cloudIndex * 29) % 78);
    const height = 31 + ((cloudIndex * 17) % 46);
    const variants = Array.from({ length: 5 }, (_, variantIndex) => ({
      light: renderCloudVariant(
        cloudIndex,
        variantIndex,
        width,
        height,
        false,
      ),
      storm: renderCloudVariant(
        cloudIndex,
        variantIndex,
        width,
        height,
        true,
      ),
    }));
    return {
      variants,
      width,
      height,
      lane: -0.36 + (((cloudIndex * 47 + 19) % 100) / 100) * 0.72,
      speed: 0.72 + (cloudIndex % 4) * 0.16,
      offset: cloudIndex * 127,
      opacity: 0.66 + (cloudIndex % 3) * 0.07,
      morphSeconds: 14 + cloudIndex * 2,
      x: null,
      y: null,
      velocityX: 1,
      velocityY: 0,
      currentSpeed: 0.8,
      lastSeconds: null,
    };
  });
}

function cloudMotion(
  cityData: CityDataPayload,
  cloud: CloudSprite,
) {
  const rawX = Number.isFinite(cityData.wind?.motion_x)
    ? cityData.wind.motion_x
    : 1;
  const rawY = Number.isFinite(cityData.wind?.motion_y)
    ? cityData.wind.motion_y
    : 0;
  const magnitude = Math.hypot(rawX, rawY);
  const speedKnots = Math.max(
    0,
    Math.min(30, cityData.wind?.speed_knots ?? 5),
  );
  return {
    dx: magnitude > 0.001 ? rawX / magnitude : 1,
    dy: magnitude > 0.001 ? rawY / magnitude : 0,
    speed: (0.42 + speedKnots * 0.075) * (cloud.speed / 0.9),
  };
}

function resetCloud(
  cloud: CloudSprite,
  cloudIndex: number,
  resolution: number,
  margin: number,
) {
  const laneOffset = cloud.lane * resolution;
  const variation =
    Math.sin(cloudIndex * 12.73 + (cloud.lastSeconds ?? 0) * 0.013) *
    resolution *
    0.11;
  if (Math.abs(cloud.velocityX) >= Math.abs(cloud.velocityY)) {
    cloud.x = cloud.velocityX >= 0 ? -margin : resolution + margin;
    cloud.y = Math.max(
      -margin,
      Math.min(resolution + margin, resolution / 2 + laneOffset + variation),
    );
  } else {
    cloud.x = Math.max(
      -margin,
      Math.min(resolution + margin, resolution / 2 + laneOffset + variation),
    );
    cloud.y = cloud.velocityY >= 0 ? -margin : resolution + margin;
  }
}

export function drawClouds(
  context: CanvasRenderingContext2D,
  sprites: CloudSprite[],
  cityData: CityDataPayload | null,
  resolution: number,
  seconds: number,
  currentRainDarkness: number,
) {
  if (!cityData || cityData.source_modes.rainfall === "off") return 0;
  const rainTarget =
    cityData.rainfall.maximum_mm > 0
      ? Math.min(0.94, 0.38 + cityData.rainfall.maximum_mm / 12)
      : 0;
  const transitionSeconds =
    rainTarget > currentRainDarkness ? 28 : 85;
  const rainStep = 1 / (transitionSeconds * 30);
  const rainDarkness =
    currentRainDarkness +
    Math.max(
      -rainStep,
      Math.min(rainStep, rainTarget - currentRainDarkness),
    );

  sprites.forEach((cloud, cloudIndex) => {
    const target = cloudMotion(cityData, cloud);
    const margin = Math.max(cloud.width, cloud.height) * 1.15;
    if (cloud.x === null || cloud.y === null || cloud.lastSeconds === null) {
      cloud.velocityX = target.dx;
      cloud.velocityY = target.dy;
      cloud.currentSpeed = target.speed;
      cloud.x =
        ((cloud.offset * 3.17) % (resolution + margin * 2)) - margin;
      cloud.y = Math.max(
        -margin,
        Math.min(
          resolution + margin,
          resolution / 2 + cloud.lane * resolution,
        ),
      );
      cloud.lastSeconds = seconds;
    }
    const elapsed = Math.max(0, Math.min(1, seconds - cloud.lastSeconds));
    cloud.lastSeconds = seconds;
    const steering = 1 - Math.exp(-elapsed / 24);
    cloud.velocityX += (target.dx - cloud.velocityX) * steering;
    cloud.velocityY += (target.dy - cloud.velocityY) * steering;
    const velocityMagnitude =
      Math.hypot(cloud.velocityX, cloud.velocityY) || 1;
    cloud.velocityX /= velocityMagnitude;
    cloud.velocityY /= velocityMagnitude;
    cloud.currentSpeed += (target.speed - cloud.currentSpeed) * steering;
    cloud.x += cloud.velocityX * cloud.currentSpeed * elapsed;
    cloud.y += cloud.velocityY * cloud.currentSpeed * elapsed;
    if (
      cloud.x < -margin ||
      cloud.x > resolution + margin ||
      cloud.y < -margin ||
      cloud.y > resolution + margin
    ) {
      resetCloud(cloud, cloudIndex, resolution, margin);
    }
    const perpendicularX = -cloud.velocityY;
    const perpendicularY = cloud.velocityX;
    const local = seconds + cloud.offset;
    const wobble =
      Math.sin(local * 0.018 + cloudIndex * 1.7) *
      (5 + (cloudIndex % 3));
    const pixelX = Math.round(
      cloud.x + perpendicularX * wobble,
    );
    const pixelY = Math.round(
      cloud.y + perpendicularY * wobble,
    );
    const edgeDistance = Math.min(
      cloud.x + margin,
      resolution + margin - cloud.x,
      cloud.y + margin,
      resolution + margin - cloud.y,
    );
    const lifecycle = Math.max(
      0,
      Math.min(1, edgeDistance / Math.max(1, margin * 0.52)),
    );
    const breathing =
      0.9 +
      Math.sin(local * 0.027 + cloudIndex * 1.3) * 0.09 +
      Math.sin(local * 0.011 + cloudIndex * 2.1) * 0.045;
    const width = cloud.width * breathing;
    const height =
      cloud.height *
      (0.92 + Math.cos(local * 0.023 + cloudIndex) * 0.1);
    const morph = (local / cloud.morphSeconds) % cloud.variants.length;
    const variantIndex = Math.floor(morph);
    const nextVariant = (variantIndex + 1) % cloud.variants.length;
    const morphPhase = morph - variantIndex;
    const transition =
      morphPhase > 0.65 ? (morphPhase - 0.65) / 0.35 : 0;
    const drawVariant = (
      variant: number,
      blend: number,
      storm: boolean,
    ) => {
      if (blend <= 0) return;
      context.globalAlpha =
        cloud.opacity *
        lifecycle *
        blend *
        (storm ? rainDarkness : 1 - rainDarkness);
      context.drawImage(
        storm
          ? cloud.variants[variant].storm
          : cloud.variants[variant].light,
        (Math.round(pixelX) - (width - cloud.width) / 2) / resolution,
        (pixelY - (height - cloud.height) / 2) / resolution,
        width / resolution,
        height / resolution,
      );
    };
    drawVariant(variantIndex, 1 - transition, false);
    drawVariant(variantIndex, 1 - transition, true);
    drawVariant(nextVariant, transition, false);
    drawVariant(nextVariant, transition, true);
  });
  context.globalAlpha = 1;
  return rainDarkness;
}
