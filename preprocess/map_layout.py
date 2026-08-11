"""Convert geographic road geometry into a normalized octilinear map layout."""

from __future__ import annotations

import math


def _quantize(value: float, steps: int) -> float:
    return round(value * steps) / steps


def route_octilinear(start: list[float], end: list[float]) -> list[list[float]]:
    """Route with at most one diagonal and one axis-aligned section."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    diagonal = min(abs(dx), abs(dy))
    if diagonal == 0 or abs(abs(dx) - abs(dy)) < 1e-9:
        return [start, end]
    sx = 1.0 if dx >= 0 else -1.0
    sy = 1.0 if dy >= 0 else -1.0
    elbow = [start[0] + sx * diagonal, start[1] + sy * diagonal]
    if elbow == start or elbow == end:
        return [start, end]
    return [start, elbow, end]


def _radial_land_outline(
    points: list[list[float]], centre: list[float], bins: int = 96
) -> list[list[float]]:
    """Derive an ambient island silhouette from the local road-network extent."""
    radii = [0.0] * bins
    for x, y in points:
        dx, dy = x - centre[0], y - centre[1]
        angle = (math.atan2(dy, dx) + math.tau) % math.tau
        index = min(bins - 1, int(angle / math.tau * bins))
        radii[index] = max(radii[index], math.hypot(dx, dy))

    # Fill rare empty angular bins from their nearest populated neighbours.
    for index, radius in enumerate(radii):
        if radius:
            continue
        for distance in range(1, bins):
            candidates = (
                radii[(index - distance) % bins],
                radii[(index + distance) % bins],
            )
            populated = [candidate for candidate in candidates if candidate]
            if populated:
                radii[index] = sum(populated) / len(populated)
                break

    # Smooth sharp road-end spikes while retaining a small coastline margin.
    smoothed = []
    for index in range(bins):
        neighbourhood = [radii[(index + offset) % bins] for offset in range(-2, 3)]
        smoothed.append(min(0.49, sum(neighbourhood) / len(neighbourhood) * 1.045))
    return [
        [
            centre[0] + radius * math.cos((index + 0.5) / bins * math.tau),
            centre[1] + radius * math.sin((index + 0.5) / bins * math.tau),
        ]
        for index, radius in enumerate(smoothed)
    ]


def generate_map_layout(
    road_graph: dict,
    quantization: int = 96,
    padding: float = 0.04,
    physical_aspect_ratio: float = 50 / 27,
) -> dict:
    """Normalize and route the road graph without stretching it into a square."""
    longitudes = [node["longitude"] for node in road_graph["nodes"]]
    latitudes = [node["latitude"] for node in road_graph["nodes"]]
    bounds = [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]
    width = max(bounds[2] - bounds[0], 1e-12)
    height = max(bounds[3] - bounds[1], 1e-12)
    content_width = 1.0 - 2 * padding
    content_height = content_width / physical_aspect_ratio
    top_padding = (1.0 - content_height) / 2

    def project(longitude: float, latitude: float) -> list[float]:
        return [
            padding + (longitude - bounds[0]) / width * content_width,
            top_padding + (bounds[3] - latitude) / height * content_height,
        ]

    layout_nodes = []
    node_positions = {}
    for node in road_graph["nodes"]:
        x, y = project(node["longitude"], node["latitude"])
        position = [_quantize(x, quantization), _quantize(y, quantization)]
        node_positions[node["id"]] = position
        layout_nodes.append({**node, "x": position[0], "y": position[1]})

    edges = []
    for edge in road_graph["edges"]:
        start, end = (node_positions[node_id] for node_id in edge["node_ids"])
        edges.append(
            {
                "id": edge["id"],
                "road": edge["road"],
                "highway_class": edge["highway_class"],
                "node_ids": edge["node_ids"],
                "points": route_octilinear(start[:], end[:]),
            }
        )
    geographic_points = [
        project(longitude, latitude)
        for edge in road_graph["edges"]
        for longitude, latitude in edge["simplified_geometry"]
    ]
    land_polygon = _radial_land_outline(
        geographic_points,
        [0.5, top_padding + content_height / 2],
    )
    return {
        "schema_version": 1,
        "bounds": bounds,
        "physical_aspect_ratio": physical_aspect_ratio,
        "land_polygon": land_polygon,
        "nodes": layout_nodes,
        "edges": edges,
    }
