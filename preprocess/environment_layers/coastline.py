"""Build an authoritative pixel land mask from GeoJSON coastline features."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from .common import (
    Pixel,
    Projector,
    Span,
    boundary_geometry,
    fill_geometry,
    spans,
)

Coordinate = tuple[float, float]
Ring = list[list[float]]
Polygon = list[Ring]

# The supplied mainland coastline is one otherwise-complete chain whose endpoints
# are about 49 metres apart. A 75 metre ceiling closes that source-data seam while
# remaining too small to bridge Singapore's meaningful channels or nearby islands.
DEFAULT_MAX_CLOSURE_GAP_METRES = 75.0
_EARTH_RADIUS_METRES = 6_371_008.8


def _coordinate(value: Any) -> Coordinate | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        return float(value[0]), float(value[1])
    except (TypeError, ValueError):
        return None


def _normalise_line(coordinates: Iterable[Any]) -> list[Coordinate]:
    result: list[Coordinate] = []
    for value in coordinates:
        point = _coordinate(value)
        if point is not None and (not result or point != result[-1]):
            result.append(point)
    return result


def _distance_metres(left: Coordinate, right: Coordinate) -> float:
    """Return the short equirectangular distance between two WGS84 coordinates."""

    longitude_delta = math.radians(right[0] - left[0])
    latitude_delta = math.radians(right[1] - left[1])
    mean_latitude = math.radians((left[1] + right[1]) / 2)
    x = longitude_delta * math.cos(mean_latitude)
    return math.hypot(x, latitude_delta) * _EARTH_RADIUS_METRES


def _closed_ring(coordinates: Iterable[Any]) -> Ring | None:
    line = _normalise_line(coordinates)
    if len(line) < 3:
        return None
    if line[0] != line[-1]:
        line.append(line[0])
    if len(set(line[:-1])) < 3:
        return None
    return [[longitude, latitude] for longitude, latitude in line]


def _polygon_parts(geometry: dict[str, Any]) -> list[Polygon]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    source_parts = [coordinates] if geometry_type == "Polygon" else coordinates
    if geometry_type not in {"Polygon", "MultiPolygon"}:
        return []

    result: list[Polygon] = []
    for source_polygon in source_parts:
        polygon = [
            ring
            for source_ring in source_polygon
            if (ring := _closed_ring(source_ring)) is not None
        ]
        if polygon:
            result.append(polygon)
    return result


def _line_sort_key(line: list[Coordinate]) -> tuple[Any, ...]:
    endpoints = sorted((line[0], line[-1]))
    return endpoints[0], endpoints[1], tuple(line)


def _stitch_component(
    lines: list[list[Coordinate]],
    component: set[int],
    endpoint_edges: dict[Coordinate, list[int]],
    max_closure_gap_metres: float,
) -> Ring | None:
    component_degrees: dict[Coordinate, int] = defaultdict(int)
    for index in component:
        component_degrees[lines[index][0]] += 1
        component_degrees[lines[index][-1]] += 1

    endpoints = sorted(
        point for point, degree in component_degrees.items() if degree == 1
    )
    if len(endpoints) not in {0, 2}:
        return None
    if any(degree > 2 for degree in component_degrees.values()):
        return None

    current = endpoints[0] if endpoints else min(component_degrees)
    start = current
    used: set[int] = set()
    stitched: list[Coordinate] = []
    while True:
        candidates = sorted(
            index
            for index in endpoint_edges[current]
            if index in component and index not in used
        )
        if not candidates:
            break
        index = candidates[0]
        used.add(index)
        line = lines[index]
        oriented = line if line[0] == current else list(reversed(line))
        stitched.extend(oriented if not stitched else oriented[1:])
        current = oriented[-1]

    if used != component or len(stitched) < 3:
        return None
    if current != start:
        if _distance_metres(current, start) > max_closure_gap_metres:
            return None
        stitched.append(start)
    if len(set(stitched[:-1])) < 3:
        return None
    return [[longitude, latitude] for longitude, latitude in stitched]


def _stitched_line_rings(
    source_lines: Iterable[Iterable[Any]],
    max_closure_gap_metres: float,
) -> list[Ring]:
    closed: list[Ring] = []
    open_lines: list[list[Coordinate]] = []
    for coordinates in source_lines:
        line = _normalise_line(coordinates)
        if len(line) < 2:
            continue
        if line[0] == line[-1]:
            ring = _closed_ring(line)
            if ring is not None:
                closed.append(ring)
        else:
            open_lines.append(line)

    open_lines.sort(key=_line_sort_key)
    endpoint_edges: dict[Coordinate, list[int]] = defaultdict(list)
    for index, line in enumerate(open_lines):
        endpoint_edges[line[0]].append(index)
        endpoint_edges[line[-1]].append(index)

    remaining = set(range(len(open_lines)))
    while remaining:
        seed = min(remaining)
        component: set[int] = set()
        stack = [seed]
        while stack:
            index = stack.pop()
            if index in component:
                continue
            component.add(index)
            line = open_lines[index]
            for endpoint in (line[0], line[-1]):
                stack.extend(endpoint_edges[endpoint])
        remaining.difference_update(component)
        ring = _stitch_component(
            open_lines,
            component,
            endpoint_edges,
            max_closure_gap_metres,
        )
        if ring is not None:
            closed.append(ring)
    return closed


def extract_coastline_polygons(
    collection: dict[str, Any],
    max_closure_gap_metres: float = DEFAULT_MAX_CLOSURE_GAP_METRES,
) -> list[Polygon]:
    """Extract deterministic land polygons from ``natural=coastline`` features.

    Polygon and MultiPolygon holes are retained. Connected LineStrings are
    stitched at exact shared endpoints; an otherwise-complete open chain is only
    closed when its final endpoint gap is within ``max_closure_gap_metres``.
    Ambiguous branches and larger open chains are ignored.
    """

    polygons: list[Polygon] = []
    source_lines: list[Iterable[Any]] = []
    for feature in collection.get("features", []):
        properties = feature.get("properties") or {}
        if str(properties.get("natural") or "").strip().casefold() != "coastline":
            continue
        geometry = feature.get("geometry") or {}
        geometry_type = geometry.get("type")
        if geometry_type in {"Polygon", "MultiPolygon"}:
            polygons.extend(_polygon_parts(geometry))
        elif geometry_type == "LineString":
            source_lines.append(geometry.get("coordinates") or [])

    polygons.extend(
        [ring]
        for ring in _stitched_line_rings(
            source_lines,
            max(0.0, float(max_closure_gap_metres)),
        )
    )
    polygons.sort(
        key=lambda polygon: (
            min(point[0] for point in polygon[0]),
            min(point[1] for point in polygon[0]),
            max(point[0] for point in polygon[0]),
            max(point[1] for point in polygon[0]),
            len(polygon[0]),
        )
    )
    return polygons


def build_coastline_layer(
    collection: dict[str, Any],
    project: Projector,
    resolution: int,
    max_closure_gap_metres: float = DEFAULT_MAX_CLOSURE_GAP_METRES,
) -> tuple[dict[str, list[Span] | list[list[int]]], set[Pixel]]:
    """Rasterize disconnected coastline polygons into a land mask and boundary."""

    land_pixels: set[Pixel] = set()
    boundary_pixels: set[Pixel] = set()
    for polygon in extract_coastline_polygons(
        collection,
        max_closure_gap_metres,
    ):
        geometry = {"type": "Polygon", "coordinates": polygon}
        land_pixels.update(fill_geometry(geometry, project, resolution))
        boundary_pixels.update(boundary_geometry(geometry, project, resolution))

    # Boundary rounding can place a cell just outside the filled scanline mask.
    # Keeping only occupied land cells also removes clamped artifacts from remote
    # coastline features that lie wholly beyond the configured map bounds.
    boundary_pixels.intersection_update(land_pixels)
    payload: dict[str, list[Span] | list[list[int]]] = {
        "land_spans": spans(land_pixels),
        "coastline_pixels": [
            [x, y] for x, y in sorted(boundary_pixels, key=lambda pixel: (pixel[1], pixel[0]))
        ],
    }
    return payload, land_pixels
