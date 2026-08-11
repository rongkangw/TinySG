"""Build categorized, island-clipped land-use sectors and outlines."""

from __future__ import annotations

from collections import defaultdict
from typing import AbstractSet, Any

from .common import (
    Pixel,
    Projector,
    boundary_geometry,
    fill_geometry,
    spans,
)


LAND_USE_GROUPS = {
    "residential": {
        "residential",
        "garages",
    },
    "commercial": {
        "commercial",
        "retail",
    },
    "industrial": {
        "industrial",
        "quarry",
    },
    "civic": {
        "education",
        "healthcare",
        "religious",
        "cemetery",
    },
    "recreation": {
        "grass",
        "forest",
        "meadow",
        "recreation_ground",
        "village_green",
        "flowerbed",
    },
    "development": {
        "construction",
        "greenfield",
        "brownfield",
    },
    "agriculture": {
        "plant_nursery",
        "allotments",
        "farmland",
        "farmyard",
        "aquaculture",
        "greenhouse_horticulture",
    },
    "military": {"military"},
    "water": {"basin", "reservoir", "salt_pond"},
    "transport": {"railway"},
}

LAND_USE_PREVIEW_COLOURS = {
    "residential": (48, 62, 75),
    "commercial": (71, 56, 77),
    "industrial": (67, 69, 72),
    "civic": (55, 66, 82),
    "recreation": (37, 67, 52),
    "development": (78, 64, 47),
    "agriculture": (59, 70, 48),
    "military": (72, 54, 62),
    "water": (36, 60, 75),
    "transport": (59, 62, 68),
}


def _category(properties: dict[str, Any]) -> str | None:
    land_use = str(properties.get("landuse") or "").strip().casefold()
    for category, values in LAND_USE_GROUPS.items():
        if land_use in values:
            return category
    if properties.get("military"):
        return "military"
    natural = str(properties.get("natural") or "").strip().casefold()
    if natural in {"water", "bay", "strait"}:
        return "water"
    if natural in {
        "wood",
        "scrub",
        "grassland",
        "wetland",
        "beach",
        "sand",
        "heath",
    }:
        return "recreation"
    leisure = str(properties.get("leisure") or "").strip().casefold()
    if leisure in {
        "park",
        "garden",
        "golf_course",
        "sports_centre",
        "stadium",
        "nature_reserve",
    }:
        return "recreation"
    aeroway = str(properties.get("aeroway") or "").strip().casefold()
    if aeroway in {"apron", "terminal", "hangar"}:
        return "transport"
    return None


def build_land_use_layer(
    collection: dict[str, Any],
    project: Projector,
    resolution: int,
    land_mask: AbstractSet[Pixel] | None = None,
) -> dict[str, Any]:
    sector_pixels: dict[str, set[Pixel]] = defaultdict(set)
    sector_boundaries: dict[str, set[Pixel]] = defaultdict(set)
    for feature in collection.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        category = _category(feature.get("properties") or {})
        if not category:
            continue
        sector_pixels[category].update(
            fill_geometry(geometry, project, resolution)
        )
        sector_boundaries[category].update(
            boundary_geometry(geometry, project, resolution)
        )

    if land_mask is not None:
        land_pixels = set(land_mask)
        open_water = {
            (x, y)
            for y in range(resolution)
            for x in range(resolution)
            if (x, y) not in land_pixels
        }
        sector_pixels["water"].update(open_water)
        sector_boundaries["water"].update(
            {
                (x, y)
                for x, y in open_water
                if any(
                    (x + dx, y + dy) in land_pixels
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                )
            }
        )
        for category in list(sector_pixels):
            if category == "water":
                sector_boundaries[category].intersection_update(
                    sector_pixels[category]
                )
                continue
            sector_pixels[category].intersection_update(land_pixels)
            sector_boundaries[category].intersection_update(land_pixels)

    return {
        "sectors": [
            {
                "category": category,
                "spans": spans(sector_pixels[category]),
                "outline_spans": spans(sector_boundaries[category]),
            }
            for category in LAND_USE_GROUPS
            if sector_pixels.get(category)
        ],
    }
