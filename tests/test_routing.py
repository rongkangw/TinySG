from __future__ import annotations

import unittest

from backend.routing import RoadNetworkIndex, RoadRouter


class RoadRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.road_graph = {
            "nodes": [
                {"id": 0, "longitude": 0.0, "latitude": 0.0},
                {"id": 1, "longitude": 1.0, "latitude": 0.0},
                {"id": 2, "longitude": 2.0, "latitude": 0.0},
                {"id": 3, "longitude": 3.0, "latitude": 0.0},
            ],
            "edges": [
                {
                    "id": 0,
                    "node_ids": [0, 1],
                    "sampled_coordinates": [[0.0, 0.0], [1.0, 0.0]],
                },
                {
                    "id": 1,
                    "node_ids": [1, 2],
                    "sampled_coordinates": [[1.0, 0.0], [2.0, 0.0]],
                },
                {
                    "id": 2,
                    "node_ids": [2, 3],
                    "sampled_coordinates": [[2.0, 0.0], [3.0, 0.0]],
                },
            ],
        }
        self.map_layout = {
            "edges": [
                {"id": 0, "points": [[0.0, 0.0], [0.1, 0.0], [0.2, 0.0]]},
                {"id": 1, "points": [[0.2, 0.0], [0.3, 0.0], [0.4, 0.0]]},
                {"id": 2, "points": [[0.4, 0.0], [0.5, 0.0], [0.6, 0.0]]},
            ]
        }
        self.road_pixels = {
            0: [[0, 0], [1, 0], [2, 0]],
            1: [[2, 0], [3, 0], [4, 0]],
            2: [[4, 0], [5, 0], [6, 0]],
        }
        self.network = RoadNetworkIndex(
            self.road_graph,
            self.map_layout,
            self.road_pixels,
        )
        self.router = RoadRouter(self.network)

    def test_index_builds_bidirectional_links_and_reuses_pixel_storage(self) -> None:
        self.assertEqual(
            {(link.neighbour, link.edge_id) for link in self.network.node_links[1]},
            {(0, 0), (2, 1)},
        )
        self.assertIs(self.network.road_pixels[0], self.road_pixels[0])

    def test_edge_path_is_cached_and_excludes_endpoint_edges(self) -> None:
        first = self.router.edge_path(0, 2)
        second = self.router.edge_path(0, 2)
        self.assertIs(first, second)
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual((first.start_node, first.end_node), (1, 2))
        self.assertEqual(first.steps, ((1, 2, 1),))

    def test_pixel_route_orients_every_edge_forward(self) -> None:
        route = self.router.pixel_route_between_hits((0, 0.5), (2, 0.5))
        self.assertEqual(route, [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])

    def test_pixel_route_orients_every_edge_in_reverse(self) -> None:
        route = self.router.pixel_route_between_hits((2, 0.5), (0, 0.5))
        self.assertEqual(route, [[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]])

    def test_missing_pixel_geometry_returns_an_empty_route(self) -> None:
        network = RoadNetworkIndex(self.road_graph, self.map_layout, {0: self.road_pixels[0]})
        router = RoadRouter(network)
        self.assertEqual(router.pixel_route_between_hits((0, 0.5), (2, 0.5)), [])

    def test_ambient_vehicle_routes_remain_on_connected_road_pixels(self) -> None:
        routes = self.router.build_topology_routes(6)
        road_pixels = {
            tuple(pixel) for pixels in self.road_pixels.values() for pixel in pixels
        }
        self.assertEqual(len(routes), 6)
        for route in routes:
            self.assertGreaterEqual(len(route), 2)
            self.assertTrue({tuple(pixel) for pixel in route}.issubset(road_pixels))
            self.assertTrue(
                all(
                    max(abs(right[0] - left[0]), abs(right[1] - left[1])) <= 1
                    for left, right in zip(route, route[1:])
                )
            )


if __name__ == "__main__":
    unittest.main()
