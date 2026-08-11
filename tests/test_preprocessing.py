from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.routing import KDTree
from preprocess.pipeline import run


class PreprocessingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temporary.name)
        cls.summary = run("tests/fixtures/roads.geojson", cls.output, 64)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def test_expected_highway_classes_only(self) -> None:
        allowed = {
            "motorway",
            "motorway_link",
            "trunk",
            "trunk_link",
            "primary",
            "primary_link",
            "secondary",
            "secondary_link",
            "tertiary",
            "tertiary_link",
            "unclassified",
            "residential",
            "living_street",
            "service",
        }
        self.assertLessEqual(set(self.summary["highway_classes"]), allowed)
        self.assertTrue({"motorway", "trunk", "primary"}.issubset(self.summary["highway_classes"]))

    def test_every_edge_has_pixels_and_nodes(self) -> None:
        road_graph = json.loads(
            (self.output / "road_graph.json").read_text(encoding="utf-8")
        )
        map_layout = json.loads(
            (self.output / "map_layout.json").read_text(encoding="utf-8")
        )
        road_pixels = json.loads(
            (self.output / "road_pixels.json").read_text(encoding="utf-8")
        )
        self.assertEqual(len(road_graph["edges"]), len(road_pixels["edges"]))
        self.assertEqual(
            [(edge["id"], edge["node_ids"]) for edge in road_graph["edges"]],
            [(edge["id"], edge["node_ids"]) for edge in map_layout["edges"]],
        )
        self.assertTrue(
            all(len(edge["node_ids"]) == 2 for edge in road_graph["edges"])
        )
        self.assertTrue(all(edge["pixels"] for edge in road_pixels["edges"]))
        self.assertGreater(len(map_layout["land_polygon"]), 20)
        self.assertEqual(
            len(map_layout["land_polygon"]), len(road_pixels["land_polygon"])
        )

    def test_environmental_overlay_contains_greenery_and_airports(self) -> None:
        environment = json.loads(
            (self.output / "environment_pixels.json").read_text(encoding="utf-8")
        )
        self.assertEqual(environment["schema_version"], 2)
        self.assertTrue(environment["land_spans"])
        self.assertTrue(environment["coastline_pixels"])
        self.assertTrue(environment["greenery_spans"])
        self.assertEqual(len(environment["land_use"]["sectors"]), 10)
        self.assertTrue(
            all(
                sector["spans"] and sector["outline_spans"]
                for sector in environment["land_use"]["sectors"]
            )
        )
        self.assertTrue(environment["airports"]["ground_spans"])
        self.assertTrue(environment["airports"]["runway_pixels"])
        self.assertTrue(environment["airports"]["flight_paths"])
        self.assertTrue(environment["airports"]["runway_light_pixels"])
        self.assertTrue(environment["airports"]["runway_threshold_pixels"])
        self.assertTrue(environment["airports"]["aircraft_journeys"])
        resolution = environment["resolution"]
        land_pixels = {
            (x, y)
            for y, start, end in environment["land_spans"]
            for x in range(start, end + 1)
        }
        self.assertTrue(
            all(
                (x, y) in land_pixels
                for y, start, end in environment["greenery_spans"]
                for x in range(start, end + 1)
            )
        )
        water_pixels = {
            (x, y)
            for sector in environment["land_use"]["sectors"]
            if sector["category"] == "water"
            for y, start, end in sector["spans"]
            for x in range(start, end + 1)
        }
        open_water_pixels = {
            (x, y)
            for y in range(resolution)
            for x in range(resolution)
            if (x, y) not in land_pixels
        }
        self.assertLessEqual(open_water_pixels, water_pixels)
        self.assertTrue(
            all(
                0 <= x < resolution and 0 <= y < resolution
                for path in environment["airports"]["flight_paths"]
                for x, y in path
            )
        )
        taxiways = {
            tuple(pixel) for pixel in environment["airports"]["taxiway_pixels"]
        }
        for journey in environment["airports"]["aircraft_journeys"]:
            self.assertIn(tuple(journey["path"][0]), taxiways)
            self.assertLess(journey["taxi_end_index"], journey["runway_end_index"])
            end_x, end_y = journey["path"][-1]
            self.assertTrue(
                end_x < 0
                or end_y < 0
                or end_x >= resolution
                or end_y >= resolution
            )

    def test_layout_is_octilinear(self) -> None:
        map_layout = json.loads(
            (self.output / "map_layout.json").read_text(encoding="utf-8")
        )
        x_values = [node["x"] for node in map_layout["nodes"]]
        y_values = [node["y"] for node in map_layout["nodes"]]
        displayed_ratio = (max(x_values) - min(x_values)) / (
            max(y_values) - min(y_values)
        )
        self.assertAlmostEqual(displayed_ratio, 50 / 27, delta=0.05)
        for edge in map_layout["edges"]:
            for start, end in zip(edge["points"], edge["points"][1:]):
                dx, dy = abs(end[0] - start[0]), abs(end[1] - start[1])
                self.assertTrue(dx == 0 or dy == 0 or abs(dx - dy) < 1e-9)

    def test_kdtree(self) -> None:
        tree = KDTree([(0.0, 0.0, 1, 0), (5.0, 5.0, 2, 0), (9.0, 9.0, 3, 0)])
        self.assertEqual(tree.nearest(4.8, 5.1).edge_id, 2)


if __name__ == "__main__":
    unittest.main()
