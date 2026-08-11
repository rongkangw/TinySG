"""Polyline simplification and sampling helpers."""

from __future__ import annotations

import math
from typing import Iterable

Point = list[float]


def _point_segment_distance(point: Point, start: Point, end: Point) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0.0 and dy == 0.0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    t = max(
        0.0,
        min(
            1.0,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy)
            / (dx * dx + dy * dy),
        ),
    )
    return math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))


def douglas_peucker(points: list[Point], tolerance: float) -> list[Point]:
    """Simplify a polyline while retaining its endpoints."""
    if len(points) <= 2:
        return [point[:] for point in points]
    maximum, split = 0.0, 0
    for index in range(1, len(points) - 1):
        distance = _point_segment_distance(points[index], points[0], points[-1])
        if distance > maximum:
            maximum, split = distance, index
    if maximum <= tolerance:
        return [points[0][:], points[-1][:]]
    left = douglas_peucker(points[: split + 1], tolerance)
    right = douglas_peucker(points[split:], tolerance)
    return left[:-1] + right


def simplify_roads(roads: Iterable[dict], tolerance: float = 0.00018) -> list[dict]:
    result = []
    for road in roads:
        item = dict(road)
        item["coordinates"] = douglas_peucker(road["coordinates"], tolerance)
        result.append(item)
    return result


def sample_polyline(points: list[Point], spacing: float = 0.00025) -> list[Point]:
    """Sample all segments at roughly `spacing` degrees for nearest lookup."""
    samples: list[Point] = []
    for start, end in zip(points, points[1:]):
        distance = math.hypot(end[0] - start[0], end[1] - start[1])
        count = max(1, math.ceil(distance / spacing))
        for step in range(count):
            t = step / count
            samples.append(
                [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
            )
    samples.append(points[-1][:])
    return samples
