"""Build the static greenery pixel layer."""

from __future__ import annotations

from typing import AbstractSet, Any

from .common import Pixel, Projector, Span, fill_geometry, spans


def build_greenery_layer(
    collection: dict[str, Any],
    project: Projector,
    resolution: int,
    land_mask: AbstractSet[Pixel] | None = None,
) -> list[Span]:
    greenery: set[Pixel] = set()
    for feature in collection.get("features", []):
        greenery.update(
            fill_geometry(feature.get("geometry") or {}, project, resolution)
        )
    if land_mask:
        greenery.intersection_update(land_mask)
    return spans(greenery)
