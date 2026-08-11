import type { NetworkPayload } from "../../../types";
import { appendCell } from "../../core/geometry";
import { railPaintPlan } from "./railPaintPlan";

export function prepareRailInfrastructure(network: NetworkPayload) {
  const canvas = document.createElement("canvas");
  canvas.width = network.resolution;
  canvas.height = network.resolution;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.setTransform(
    network.resolution,
    0,
    0,
    network.resolution,
    0,
    0,
  );
  const unit = 1 / network.resolution;
  railPaintPlan(network.rail?.lines ?? []).forEach(({ kind, line }) => {
    const path = new Path2D();
    const scale =
      kind === "outline"
        ? 1.22
        : line.route === "light_rail"
          ? 0.82
          : 0.72;
    line.pixels.forEach(([x, y]) =>
      appendCell(path, x, y, network.resolution, scale),
    );
    if (kind === "outline") {
      context.fillStyle = "rgba(5, 11, 16, 0.88)";
      context.globalAlpha = line.future ? 0.36 : 0.9;
    } else {
      context.fillStyle = line.colour;
      context.globalAlpha = line.future
        ? 0.42
        : line.route === "light_rail"
          ? 0.96
          : 0.92;
    }
    context.fill(path);
  });

  context.globalAlpha = 1;
  network.rail?.stations.forEach((station) => {
    const [pixelX, pixelY] = station.pixel;
    const size = unit * (station.lrt ? 1.08 : 0.94);
    const left = (pixelX + 0.5) * unit - size / 2;
    const top = (pixelY + 0.5) * unit - size / 2;
    const colours = station.colours.length ? station.colours : ["#747B84"];
    context.fillStyle = "rgba(4, 9, 14, 0.96)";
    context.globalAlpha = 1;
    context.fillRect(
      (pixelX + 0.5) * unit - unit * 0.59,
      (pixelY + 0.5) * unit - unit * 0.59,
      unit * 1.18,
      unit * 1.18,
    );
    context.fillStyle = station.lrt ? "#A8C6BD" : colours[0];
    context.globalAlpha = station.matched ? 1 : 0.64;
    context.fillRect(left, top, size, size);
  });
  context.globalAlpha = 1;
  return canvas;
}
