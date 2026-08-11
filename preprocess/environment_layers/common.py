"""Shared pixel-geometry primitives for environmental preprocessing layers."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable, Iterable
from typing import Any

from ..rasterize import bresenham


Pixel = tuple[int, int]
Span = list[int]
Projector = Callable[[float, float], list[float]]


def _polygon_parts(
    geometry: dict[str, Any],
) -> list[list[list[list[float]]]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if geometry_type == "Polygon":
        return [coordinates]
    if geometry_type == "MultiPolygon":
        return list(coordinates)
    return []


def _project_ring(
    ring: Iterable[list[float]],
    project: Projector,
    resolution: int,
) -> list[tuple[float, float]]:
    result = []
    for coordinate in ring:
        if len(coordinate) < 2:
            continue
        x, y = project(float(coordinate[0]), float(coordinate[1]))
        result.append((x * (resolution - 1), y * (resolution - 1)))
    return result


def _fill_ring(
    ring: list[tuple[float, float]],
    resolution: int,
) -> set[Pixel]:
    """Fill a polygon ring using cell-centre scanlines."""
    if len(ring) < 3:
        return set()
    minimum_y = max(0, math.floor(min(point[1] for point in ring)))
    maximum_y = min(resolution - 1, math.ceil(max(point[1] for point in ring)))
    pixels: set[Pixel] = set()
    closed = ring if ring[0] == ring[-1] else [*ring, ring[0]]
    for y in range(minimum_y, maximum_y + 1):
        scan_y = y + 0.5
        intersections = []
        for (x1, y1), (x2, y2) in zip(closed, closed[1:]):
            if y1 == y2 or not (min(y1, y2) <= scan_y < max(y1, y2)):
                continue
            amount = (scan_y - y1) / (y2 - y1)
            intersections.append(x1 + (x2 - x1) * amount)
        intersections.sort()
        for left, right in zip(intersections[0::2], intersections[1::2]):
            start = max(0, math.ceil(min(left, right) - 0.5))
            end = min(resolution - 1, math.floor(max(left, right) - 0.5))
            pixels.update((x, y) for x in range(start, end + 1))
    return pixels


def fill_ring_nonzero(
    ring: list[tuple[float, float]],
    resolution: int,
) -> set[Pixel]:
    """Fill a potentially self-intersecting ring using the Canvas nonzero rule."""
    if len(ring) < 3:
        return set()
    minimum_y = max(0, math.floor(min(point[1] for point in ring)))
    maximum_y = min(resolution - 1, math.ceil(max(point[1] for point in ring)))
    closed = ring if ring[0] == ring[-1] else [*ring, ring[0]]
    pixels: set[Pixel] = set()
    for y in range(minimum_y, maximum_y + 1):
        scan_y = y + 0.5
        events: list[tuple[float, int]] = []
        for (x1, y1), (x2, y2) in zip(closed, closed[1:]):
            if y1 <= scan_y < y2:
                amount = (scan_y - y1) / (y2 - y1)
                events.append((x1 + (x2 - x1) * amount, 1))
            elif y2 <= scan_y < y1:
                amount = (scan_y - y2) / (y1 - y2)
                events.append((x2 + (x1 - x2) * amount, -1))
        events.sort()
        winding = 0
        previous_x: float | None = None
        index = 0
        while index < len(events):
            x = events[index][0]
            if previous_x is not None and winding:
                start = max(0, math.ceil(previous_x - 0.5))
                end = min(resolution - 1, math.floor(x - 0.5))
                pixels.update((column, y) for column in range(start, end + 1))
            while index < len(events) and abs(events[index][0] - x) < 1e-9:
                winding += events[index][1]
                index += 1
            previous_x = x
    return pixels


def fill_geometry(
    geometry: dict[str, Any],
    project: Projector,
    resolution: int,
) -> set[Pixel]:
    pixels: set[Pixel] = set()
    for polygon in _polygon_parts(geometry):
        if not polygon:
            continue
        exterior = _fill_ring(
            _project_ring(polygon[0], project, resolution),
            resolution,
        )
        for hole in polygon[1:]:
            exterior.difference_update(
                _fill_ring(_project_ring(hole, project, resolution), resolution)
            )
        pixels.update(exterior)
    return pixels


def boundary_geometry(
    geometry: dict[str, Any],
    project: Projector,
    resolution: int,
) -> set[Pixel]:
    pixels: set[Pixel] = set()
    for polygon in _polygon_parts(geometry):
        for ring in polygon:
            pixels.update(line_pixels(ring, project, resolution))
    return pixels


def line_pixels(
    coordinates: Iterable[list[float]],
    project: Projector,
    resolution: int,
) -> list[Pixel]:
    projected: list[Pixel] = []
    for coordinate in coordinates:
        if len(coordinate) < 2:
            continue
        x, y = project(float(coordinate[0]), float(coordinate[1]))
        projected.append(
            (
                max(0, min(resolution - 1, round(x * (resolution - 1)))),
                max(0, min(resolution - 1, round(y * (resolution - 1)))),
            )
        )
    result: list[Pixel] = []
    for start, end in zip(projected, projected[1:]):
        segment = bresenham(start, end)
        result.extend(segment if not result else segment[1:])
    return list(dict.fromkeys(result))


def spans(pixels: Iterable[Pixel]) -> list[Span]:
    rows: dict[int, list[int]] = defaultdict(list)
    for x, y in pixels:
        rows[y].append(x)
    result: list[Span] = []
    for y, columns in sorted(rows.items()):
        ordered = sorted(set(columns))
        if not ordered:
            continue
        start = previous = ordered[0]
        for x in ordered[1:]:
            if x == previous + 1:
                previous = x
                continue
            result.append([y, start, previous])
            start = previous = x
        result.append([y, start, previous])
    return result
