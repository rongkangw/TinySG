"""Build a topology graph by clustering coincident road endpoints."""

from __future__ import annotations

import math
from collections import defaultdict

from .simplify import sample_polyline


class _EndpointClusters:
    def __init__(self, tolerance: float):
        self.tolerance = tolerance
        self.buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.sums: list[list[float]] = []
        self.counts: list[int] = []

    def _cell(self, point: list[float]) -> tuple[int, int]:
        return (round(point[0] / self.tolerance), round(point[1] / self.tolerance))

    def add(self, point: list[float]) -> int:
        cell = self._cell(point)
        candidate = None
        best = self.tolerance
        for x in range(cell[0] - 1, cell[0] + 2):
            for y in range(cell[1] - 1, cell[1] + 2):
                for node_id in self.buckets.get((x, y), []):
                    centre = [
                        self.sums[node_id][0] / self.counts[node_id],
                        self.sums[node_id][1] / self.counts[node_id],
                    ]
                    distance = math.hypot(point[0] - centre[0], point[1] - centre[1])
                    if distance < best:
                        candidate, best = node_id, distance
        if candidate is None:
            candidate = len(self.sums)
            self.sums.append(point[:])
            self.counts.append(1)
            self.buckets[cell].append(candidate)
        else:
            self.sums[candidate][0] += point[0]
            self.sums[candidate][1] += point[1]
            self.counts[candidate] += 1
        return candidate

    def nodes(self) -> list[dict]:
        return [
            {
                "id": index,
                "longitude": total[0] / self.counts[index],
                "latitude": total[1] / self.counts[index],
            }
            for index, total in enumerate(self.sums)
        ]


def build_graph(
    original_roads: list[dict],
    simplified_roads: list[dict],
    merge_tolerance: float = 0.00012,
    sample_spacing: float = 0.00025,
) -> dict:
    """Create graph edges from source ways and merge only near-coincident endpoints."""
    clusters = _EndpointClusters(merge_tolerance)
    edges = []
    for edge_id, (original, simplified) in enumerate(zip(original_roads, simplified_roads)):
        start_node = clusters.add(original["coordinates"][0])
        end_node = clusters.add(original["coordinates"][-1])
        edges.append(
            {
                "id": edge_id,
                "road": original["road"],
                "highway_class": original["highway_class"],
                "source_id": original.get("source_id"),
                "node_ids": [start_node, end_node],
                "geometry": original["coordinates"],
                "simplified_geometry": simplified["coordinates"],
                "sampled_coordinates": sample_polyline(original["coordinates"], sample_spacing),
            }
        )
    nodes = clusters.nodes()
    degrees = [0] * len(nodes)
    for edge in edges:
        for node_id in set(edge["node_ids"]):
            degrees[node_id] += 1
    for node, degree in zip(nodes, degrees):
        node["degree"] = degree
        node["kind"] = "terminal" if degree == 1 else ("interchange" if degree > 2 else "junction")
    return {"schema_version": 1, "nodes": nodes, "edges": edges}
