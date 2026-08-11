import type { NetworkPayload } from "../../../types";

export function drawRunwayLights(
  context: CanvasRenderingContext2D,
  network: NetworkPayload,
  seconds: number,
  daylight: number,
) {
  const unit = 1 / network.resolution;
  const airports = network.environment_overlay.airports;
  airports.runway_light_pixels.forEach(([x, y], index) => {
    const pulse = 0.48 + 0.26 * Math.sin(seconds * 2.1 + index * 0.37);
    context.fillStyle = index % 7 === 0 ? "#8fc7ff" : "#f6e4a5";
    context.globalAlpha = pulse * (0.86 - daylight * 0.52);
    context.fillRect(
      (x + 0.3) * unit,
      (y + 0.3) * unit,
      unit * 0.4,
      unit * 0.4,
    );
  });
  airports.runway_threshold_pixels.forEach(([x, y], index) => {
    context.fillStyle = index % 3 === 0 ? "#ff7777" : "#78e0a5";
    context.globalAlpha =
      (0.72 - daylight * 0.36) *
      (0.78 + 0.22 * Math.sin(seconds * 1.4 + index));
    context.fillRect(
      (x + 0.22) * unit,
      (y + 0.22) * unit,
      unit * 0.56,
      unit * 0.56,
    );
  });
  context.globalAlpha = 1;
}
