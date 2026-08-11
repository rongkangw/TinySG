"""Command-line entry point for the complete preprocessing pipeline."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from .environmental import build_environment_overlay, draw_environment_preview
from .graph_builder import build_graph
from .load_network import load_roads
from .map_layout import generate_map_layout
from .preview import draw_geo_preview, draw_map_layout_preview
from .rail import build_rail_overlay, draw_rail_preview
from .rasterize import rasterize_map_layout
from .simplify import simplify_roads


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def run(
    geojson: str | Path = "data/map.geojson",
    output: str | Path = "output",
    resolution: int = 992,
    simplify_tolerance: float = 0.00018,
    mrt_lines: str | Path = "data/mrtlines.geojson",
    mrt_stations: str | Path = "data/mrtstations.geojson",
    greenery: str | Path = "data/greenery.geojson",
    airports: str | Path = "data/airports.geojson",
    land_use: str | Path = "data/landuse.geojson",
) -> dict:
    output_path = Path(output)
    output_path.mkdir(parents=True, exist_ok=True)
    roads = load_roads(geojson)
    if not roads:
        raise ValueError("No supported road classes were found in the GeoJSON")
    simplified = simplify_roads(roads, simplify_tolerance)
    road_graph = build_graph(roads, simplified)
    map_layout = generate_map_layout(
        road_graph, quantization=max(96, resolution)
    )
    road_pixels = rasterize_map_layout(map_layout, resolution)
    rail = build_rail_overlay(mrt_lines, mrt_stations, map_layout, resolution)
    environment = build_environment_overlay(
        greenery,
        airports,
        land_use,
        map_layout,
        resolution,
    )
    _write_json(output_path / "road_graph.json", road_graph)
    _write_json(output_path / "map_layout.json", map_layout)
    _write_json(output_path / "road_pixels.json", road_pixels)
    _write_json(output_path / "rail_pixels.json", rail)
    _write_json(output_path / "environment_pixels.json", environment)

    bounds = map_layout["bounds"]
    draw_geo_preview(output_path / "network_raw.png", roads, bounds, color=(18, 98, 75))
    draw_geo_preview(
        output_path / "network_simplified.png", simplified, bounds, color=(21, 152, 109)
    )
    draw_map_layout_preview(output_path / "network_layout.png", map_layout)
    draw_rail_preview(output_path / "network_rail.png", rail)
    draw_environment_preview(output_path / "network_environment.png", environment)
    return {
        "highway_classes": dict(
            sorted(Counter(road["highway_class"] for road in roads).items())
        ),
        "nodes": len(road_graph["nodes"]),
        "edges": len(road_graph["edges"]),
        "resolution": resolution,
        "rail_lines": len(rail["lines"]),
        "rail_stations": len(rail["stations"]),
        "land_spans": len(environment["land_spans"]),
        "coastline_pixels": len(environment["coastline_pixels"]),
        "greenery_spans": len(environment["greenery_spans"]),
        "land_use_sectors": len(environment["land_use"]["sectors"]),
        "flight_paths": len(environment["airports"]["flight_paths"]),
        "output": str(output_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geojson", default="data/map.geojson")
    parser.add_argument("--output", default="output")
    parser.add_argument(
        "--resolution",
        type=int,
        default=992,
        choices=(32, 64, 96, 128, 248, 496, 992),
    )
    parser.add_argument("--simplify-tolerance", type=float, default=0.00018)
    parser.add_argument("--mrt-lines", default="data/mrtlines.geojson")
    parser.add_argument("--mrt-stations", default="data/mrtstations.geojson")
    parser.add_argument("--greenery", default="data/greenery.geojson")
    parser.add_argument("--airports", default="data/airports.geojson")
    parser.add_argument("--land-use", default="data/landuse.geojson")
    args = parser.parse_args()
    print(
        json.dumps(
            run(
                args.geojson,
                args.output,
                args.resolution,
                args.simplify_tolerance,
                args.mrt_lines,
                args.mrt_stations,
                args.greenery,
                args.airports,
                args.land_use,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
