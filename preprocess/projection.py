"""Shared geographic-to-normalized-world projection utilities."""

from __future__ import annotations

from collections.abc import Callable

WorldProjector = Callable[[float, float], list[float]]


def create_world_projector(
    bounds: list[float],
    physical_aspect_ratio: float,
    padding: float = 0.04,
) -> WorldProjector:
    left, bottom, right, top = bounds
    width = max(right - left, 1e-12)
    height = max(top - bottom, 1e-12)
    content_width = 1 - 2 * padding
    content_height = content_width / physical_aspect_ratio
    top_padding = (1 - content_height) / 2

    def project(longitude: float, latitude: float) -> list[float]:
        return [
            padding + (longitude - left) / width * content_width,
            top_padding + (top - latitude) / height * content_height,
        ]

    return project
