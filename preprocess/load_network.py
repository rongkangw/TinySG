"""Load supported road classes from the supplied GeoJSON."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ALLOWED_HIGHWAY_CLASSES = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
}


def road_label(properties: dict[str, Any]) -> str:
    """Choose a useful stable label without using it for incident positioning."""
    highway_class = str(properties.get("highway") or "road")
    ref = str(properties.get("ref") or "").strip()
    name = str(properties.get("name") or "").strip()
    if ref:
        return ref
    if name:
        return name
    return highway_class.replace("_", " ").title()


def load_roads(path: str | Path) -> list[dict[str, Any]]:
    """Read LineStrings belonging to the configured road classes."""
    with Path(path).open(encoding="utf-8") as handle:
        collection = json.load(handle)

    roads: list[dict[str, Any]] = []
    for source_index, feature in enumerate(collection.get("features", [])):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        properties = feature.get("properties") or {}
        highway_class = str(properties.get("highway") or "")
        coordinates = geometry.get("coordinates") or []
        if highway_class not in ALLOWED_HIGHWAY_CLASSES or len(coordinates) < 2:
            continue
        roads.append(
            {
                "source_index": source_index,
                "source_id": properties.get("@id"),
                "road": road_label(properties),
                "highway_class": highway_class,
                "coordinates": [[float(lon), float(lat)] for lon, lat, *_ in coordinates],
            }
        )
    return roads
