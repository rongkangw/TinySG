"""Facade for feature-specific static environmental map layers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .environment_layers import (
    LAND_USE_PREVIEW_COLOURS,
    build_airport_layer,
    build_coastline_layer,
    build_greenery_layer,
    build_land_use_layer,
)
from .preview import Canvas
from .projection import create_world_projector


def _load_collection(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def build_environment_overlay(
    greenery_path: str | Path,
    airport_path: str | Path,
    land_use_path: str | Path,
    layout: dict[str, Any],
    resolution: int,
) -> dict[str, Any]:
    """Build the stable environmental payload consumed by the web backend."""
    greenery_collection = _load_collection(greenery_path)
    airport_collection = _load_collection(airport_path)
    land_use_collection = _load_collection(land_use_path)
    project = create_world_projector(
        layout["bounds"],
        float(layout.get("physical_aspect_ratio", 50 / 27)),
    )
    coastline, land_mask = build_coastline_layer(
        land_use_collection,
        project,
        resolution,
    )
    land_use = build_land_use_layer(
        land_use_collection,
        project,
        resolution,
        land_mask,
    )
    greenery_spans = build_greenery_layer(
        greenery_collection,
        project,
        resolution,
        land_mask,
    )
    # Airport geometry intentionally remains unclipped. Runways and taxiways can
    # represent reclaimed infrastructure newer than the coastline extract, while
    # flight paths are expected to continue over water and beyond the map.
    airports = build_airport_layer(
        airport_collection,
        project,
        resolution,
    )
    return {
        "schema_version": 2,
        "resolution": resolution,
        **coastline,
        "land_use": land_use,
        "greenery_spans": greenery_spans,
        "airports": airports,
    }


def draw_environment_preview(
    path: str | Path,
    overlay: dict[str, Any],
    scale: int = 2,
) -> None:
    resolution = int(overlay["resolution"])
    canvas = Canvas(resolution * scale, resolution * scale)
    for y, start, end in overlay.get("land_spans", []):
        for x in range(start, end + 1):
            canvas.put(x * scale, y * scale, (27, 32, 37), max(0, scale // 2))
    for sector in overlay.get("land_use", {}).get("sectors", []):
        colour = LAND_USE_PREVIEW_COLOURS.get(
            sector["category"],
            (55, 58, 64),
        )
        for y, start, end in sector["spans"]:
            for x in range(start, end + 1):
                canvas.put(x * scale, y * scale, colour, max(0, scale // 2))
    for y, start, end in overlay["greenery_spans"]:
        for x in range(start, end + 1):
            canvas.put(x * scale, y * scale, (34, 71, 55), max(0, scale // 2))
    airports = overlay["airports"]
    for y, start, end in airports["ground_spans"]:
        for x in range(start, end + 1):
            canvas.put(x * scale, y * scale, (57, 68, 77), max(0, scale // 2))
    for x, y in airports["taxiway_pixels"]:
        canvas.put(x * scale, y * scale, (93, 105, 111), max(0, scale // 2))
    for x, y in airports["runway_pixels"]:
        canvas.put(x * scale, y * scale, (183, 195, 199), max(0, scale // 2))
    for x, y in overlay.get("coastline_pixels", []):
        canvas.put(x * scale, y * scale, (69, 84, 93), max(0, scale // 2))
    canvas.save(path)
