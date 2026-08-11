import type { DashboardConfig, NetworkPayload } from "../../../types";
import {
  appendCell,
  roadCellScale,
  roadOutlineScale,
  roadTier,
} from "../../core/geometry";
import { LAND_USE_COLOURS } from "../landUseStyles";

const DAY_ROAD_COLOURS = {
  "1": "#788691",
  "2": "#788691",
  "3": "#788691",
  "4": "#788691",
  "5": "#788691",
  "6": "#788691",
  "7": "#788691",
};

export interface MainMapLayers {
  night: HTMLCanvasElement;
  day: HTMLCanvasElement;
  landPath: Path2D;
}

function buildPaths(network: NetworkPayload) {
  const grouped = new Map<string, Path2D>();
  const outlines = new Map<string, Path2D>();
  const unit = 1 / network.resolution;
  network.road_layers.forEach((layer) => {
    const path = new Path2D();
    const outline = new Path2D();
    layer.pixels.forEach(([x, y]) => {
      appendCell(
        path,
        x,
        y,
        network.resolution,
        roadCellScale(layer.highway_class),
      );
      appendCell(
        outline,
        x,
        y,
        network.resolution,
        roadOutlineScale(layer.highway_class),
      );
    });
    grouped.set(layer.highway_class, path);
    outlines.set(layer.highway_class, outline);
  });

  const landPath = new Path2D();
  network.environment_overlay.land_spans.forEach(([y, start, end]) => {
    // Static land cells deliberately touch: the contribution-grid gap belongs
    // to roads and moving layers, not to the island silhouette.
    landPath.rect(
      start * unit,
      y * unit,
      (end - start + 1) * unit,
      unit,
    );
  });

  const coastlinePath = new Path2D();
  network.environment_overlay.coastline_pixels.forEach(([x, y]) => {
    coastlinePath.rect(x * unit, y * unit, unit, unit);
  });
  return { grouped, outlines, landPath, coastlinePath };
}

export function prepareMainMap(
  network: NetworkPayload,
  rendering: DashboardConfig["rendering"],
): MainMapLayers {
  const paths = buildPaths(network);
  const createLayer = (
    island: string,
    roads: Record<string, string>,
    outlineColour: string,
    coastlineColour: string,
    daylight: boolean,
  ) => {
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
    context.fillStyle = island;
    context.fill(paths.landPath);
    const unit = 1 / network.resolution;
    context.save();
    context.clip(paths.landPath);
    network.environment_overlay.land_use.sectors.forEach((sector) => {
      const colours =
        LAND_USE_COLOURS[sector.category] ?? LAND_USE_COLOURS.transport;
      context.fillStyle = daylight ? colours.day : colours.night;
      context.globalAlpha = daylight ? 0.46 : 0.52;
      sector.spans.forEach(([y, start, end]) => {
        context.fillRect(
          start * unit,
          y * unit,
          (end - start + 1) * unit,
          unit,
        );
      });
    });
    context.restore();

    context.fillStyle = daylight ? "#355746" : "#263f34";
    context.globalAlpha = daylight ? 0.56 : 0.62;
    network.environment_overlay.greenery_spans.forEach(([y, start, end]) => {
      context.fillRect(
        start * unit,
        y * unit,
        (end - start + 1) * unit,
        unit,
      );
    });

    context.fillStyle = coastlineColour;
    context.globalAlpha = daylight ? 0.34 : 0.42;
    context.fill(paths.coastlinePath);

    const airports = network.environment_overlay.airports;
    context.globalAlpha = 1;
    context.fillStyle = daylight ? "#344854" : "#26343d";
    airports.ground_spans.forEach(([y, start, end]) => {
      context.fillRect(
        start * unit,
        y * unit,
        (end - start + 1) * unit,
        unit,
      );
    });
    context.fillStyle = daylight ? "#4c6470" : "#3b4f5a";
    airports.terminal_spans.forEach(([y, start, end]) => {
      context.fillRect(
        start * unit,
        y * unit,
        (end - start + 1) * unit,
        unit,
      );
    });
    context.fillStyle = daylight ? "#7893a0" : "#617d8a";
    airports.taxiway_pixels.forEach(([x, y]) =>
      context.fillRect(x * unit, y * unit, unit, unit),
    );
    context.fillStyle = daylight ? "#b7c8d0" : "#93a9b4";
    airports.runway_pixels.forEach(([x, y]) =>
      context.fillRect(x * unit, y * unit, unit, unit),
    );

    [...paths.grouped.entries()]
      .sort(
        ([left], [right]) =>
          Number(roadTier(right)) - Number(roadTier(left)),
      )
      .forEach(([roadClass, path]) => {
        const outline = paths.outlines.get(roadClass);
        if (outline) {
          context.fillStyle = outlineColour;
          context.fill(outline);
        }
        context.fillStyle = roads[roadTier(roadClass)];
        context.fill(path);
      });
    context.globalAlpha = 1;
    return canvas;
  };

  return {
    night: createLayer(
      rendering.island_fill,
      rendering.hierarchy_grays,
      "rgba(7, 11, 16, 0.72)",
      rendering.island_outline,
      false,
    ),
    day: createLayer(
      "#252b30",
      DAY_ROAD_COLOURS,
      "rgba(18, 23, 28, 0.62)",
      "#607481",
      true,
    ),
    landPath: paths.landPath,
  };
}
