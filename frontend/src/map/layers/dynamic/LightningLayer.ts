import type { LightningEvent } from "../../../types";

export function drawLightning(
  context: CanvasRenderingContext2D,
  strikes: LightningEvent[],
  resolution: number,
  performanceMs: number,
) {
  const unit = 1 / resolution;
  strikes.forEach((strike) => {
    const age = (performanceMs - (strike.received_at ?? performanceMs)) / 1000;
    const progress = Math.max(0, Math.min(1, age / 2.4));
    const ring = 1 + Math.floor(progress * 9 * (resolution / 496));
    const energy = 1 - progress;
    for (let row = -ring; row <= ring; row += 1) {
      for (let column = -ring; column <= ring; column += 1) {
        if (Math.max(Math.abs(column), Math.abs(row)) !== ring) continue;
        if ((column + row + ring) % 2 !== 0) continue;
        context.beginPath();
        context.roundRect(
          strike.x + column * unit,
          strike.y + row * unit,
          unit * 0.88,
          unit * 0.88,
          unit * 0.16,
        );
        context.fillStyle =
          strike.kind === "G"
            ? `rgba(196, 118, 255, ${energy * 0.9})`
            : `rgba(139, 112, 255, ${energy * 0.78})`;
        context.fill();
      }
    }
    if (progress < 0.45) {
      context.beginPath();
      context.roundRect(
        strike.x - unit,
        strike.y - unit,
        unit * 2.4,
        unit * 2.4,
        unit * 0.32,
      );
      context.fillStyle = `rgba(239, 220, 255, ${1 - progress / 0.45})`;
      context.fill();
    }
  });
  context.globalAlpha = 1;
}
