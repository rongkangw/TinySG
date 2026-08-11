"""Immutable indexes derived from the preprocessed road graph."""

from __future__ import annotations

import math
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class RoadLink:
    """A traversable graph link and its geographic routing cost."""

    neighbour: int
    edge_id: int
    cost: float


class RoadNetworkIndex:
    """Precompute the lookups needed by road-bound vehicle routers."""

    def __init__(
        self,
        road_graph: Mapping[str, Any],
        map_layout: Mapping[str, Any],
        road_pixels: Mapping[int, Sequence[Sequence[int]]],
    ) -> None:
        self.road_edges = {
            int(edge["id"]): edge for edge in road_graph.get("edges", [])
        }
        self.map_edges = {
            int(edge["id"]): edge for edge in map_layout.get("edges", [])
        }
        # Keep the large preprocessed pixel arrays zero-copy. The mapping is
        # read-only; callers treat the underlying generated arrays as immutable.
        self.road_pixels: Mapping[int, Sequence[Sequence[int]]] = MappingProxyType(
            {
                int(edge_id): pixels
                for edge_id, pixels in road_pixels.items()
            }
        )
        self.node_coordinates = {
            int(node["id"]): (float(node["longitude"]), float(node["latitude"]))
            for node in road_graph.get("nodes", [])
        }

        links: dict[int, list[RoadLink]] = {}
        for edge in road_graph.get("edges", []):
            nodes = edge.get("node_ids") or []
            if len(nodes) < 2 or nodes[0] == nodes[-1]:
                continue
            start, end = int(nodes[0]), int(nodes[-1])
            coordinates = edge.get("sampled_coordinates") or []
            length = sum(
                math.hypot(
                    float(right[0]) - float(left[0]),
                    float(right[1]) - float(left[1]),
                )
                for left, right in zip(coordinates, coordinates[1:])
            )
            length = max(length, 1e-7)
            links.setdefault(start, []).append(RoadLink(end, int(edge["id"]), length))
            links.setdefault(end, []).append(RoadLink(start, int(edge["id"]), length))
        self.node_links = {
            node_id: tuple(node_links) for node_id, node_links in links.items()
        }
