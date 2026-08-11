"""Map geographic incident coordinates to the nearest road edge."""

from __future__ import annotations

from typing import Any, Mapping

from .spatial_index import KDTree


class IncidentMapper:
    def __init__(self, road_graph: Mapping[str, Any]):
        samples = []
        self.edges = {edge["id"]: edge for edge in road_graph["edges"]}
        for edge in road_graph["edges"]:
            for sample_index, (longitude, latitude) in enumerate(
                edge["sampled_coordinates"]
            ):
                samples.append((longitude, latitude, edge["id"], sample_index))
        self.index = KDTree(samples)

    def locate(self, latitude: float, longitude: float) -> dict[str, Any]:
        hit = self.index.nearest(float(longitude), float(latitude))
        edge = self.edges[hit.edge_id]
        return {
            "edge_id": hit.edge_id,
            "road": edge["road"],
            "distance_metres": hit.distance_metres,
            "nearest_coordinate": [hit.latitude, hit.longitude],
            "sample_index": hit.sample_index,
        }
