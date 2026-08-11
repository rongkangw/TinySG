"""Rasterize normalized map paths onto a fixed pixel grid."""

from __future__ import annotations


def bresenham(start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    x0, y0 = start
    x1, y1 = end
    dx, sx = abs(x1 - x0), 1 if x0 < x1 else -1
    dy, sy = -abs(y1 - y0), 1 if y0 < y1 else -1
    error = dx + dy
    result = []
    while True:
        result.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        doubled = 2 * error
        if doubled >= dy:
            error += dy
            x0 += sx
        if doubled <= dx:
            error += dx
            y0 += sy
    return result


def rasterize_map_layout(map_layout: dict, resolution: int = 64) -> dict:
    if resolution not in {32, 64, 96, 128, 248, 496, 992}:
        raise ValueError(
            "resolution must be one of 32, 64, 96, 128, 248, 496 or 992"
        )
    rasterized_edges = []
    for edge in map_layout["edges"]:
        points = [
            (
                max(0, min(resolution - 1, round(point[0] * (resolution - 1)))),
                max(0, min(resolution - 1, round(point[1] * (resolution - 1)))),
            )
            for point in edge["points"]
        ]
        pixels: list[tuple[int, int]] = []
        for start, end in zip(points, points[1:]):
            segment = bresenham(start, end)
            pixels.extend(segment if not pixels else segment[1:])
        # Stable de-duplication prevents elbows from being counted twice.
        pixels = list(dict.fromkeys(pixels))
        rasterized_edges.append(
            {
                "edge_id": edge["id"],
                "road": edge["road"],
                "highway_class": edge["highway_class"],
                "pixels": [list(p) for p in pixels],
            }
        )
    land_polygon = [
        [
            max(0, min(resolution - 1, round(point[0] * (resolution - 1)))),
            max(0, min(resolution - 1, round(point[1] * (resolution - 1)))),
        ]
        for point in map_layout.get("land_polygon", [])
    ]
    return {
        "schema_version": 1,
        "resolution": resolution,
        "land_polygon": land_polygon,
        "edges": rasterized_edges,
    }
