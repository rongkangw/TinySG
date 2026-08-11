import type { NetworkPayload } from "../../../types";
import { LAND_USE_COLOURS } from "../landUseStyles";

export function prepareLandUseOverlay(
  network: NetworkPayload,
  landPath: Path2D,
) {
  const canvas = document.createElement("canvas");
  canvas.width = network.resolution;
  canvas.height = network.resolution;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const unit = 1 / network.resolution;
  context.setTransform(
    network.resolution,
    0,
    0,
    network.resolution,
    0,
    0,
  );
  context.clip(landPath);
  network.environment_overlay.land_use.sectors.forEach((sector) => {
    context.fillStyle =
      (LAND_USE_COLOURS[sector.category] ?? LAND_USE_COLOURS.transport).day;
    context.globalAlpha = 0.2;
    sector.spans.forEach(([y, start, end]) => {
      context.fillRect(
        start * unit,
        y * unit,
        (end - start + 1) * unit,
        unit,
      );
    });
  });
  context.globalAlpha = 1;
  return canvas;
}
