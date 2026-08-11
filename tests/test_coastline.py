from __future__ import annotations

import json
import unittest
from pathlib import Path

from preprocess.environment_layers.coastline import (
    build_coastline_layer,
    extract_coastline_polygons,
)
from preprocess.projection import create_world_projector


def _feature(geometry_type: str, coordinates: list) -> dict:
    return {
        "type": "Feature",
        "properties": {"natural": "coastline"},
        "geometry": {"type": geometry_type, "coordinates": coordinates},
    }


def _pixels(spans: list[list[int]]) -> set[tuple[int, int]]:
    return {
        (x, y)
        for y, start, end in spans
        for x in range(start, end + 1)
    }


def _fixture_project(longitude: float, latitude: float) -> list[float]:
    return [longitude - 103.0, latitude - 1.0]


class CoastlineTests(unittest.TestCase):
    def test_disconnected_island_does_not_fill_intervening_sea(self) -> None:
        collection = {
            "features": [
                _feature(
                    "Polygon",
                    [
                        [
                            [103.10, 1.10],
                            [103.40, 1.10],
                            [103.40, 1.40],
                            [103.10, 1.40],
                            [103.10, 1.10],
                        ]
                    ],
                ),
                _feature(
                    "Polygon",
                    [
                        [
                            [103.70, 1.10],
                            [103.80, 1.10],
                            [103.80, 1.20],
                            [103.70, 1.20],
                            [103.70, 1.10],
                        ]
                    ],
                ),
            ]
        }

        payload, land = build_coastline_layer(
            collection,
            _fixture_project,
            resolution=101,
        )

        self.assertIn((20, 20), land)
        self.assertIn((75, 15), land)
        self.assertNotIn((55, 15), land)
        self.assertEqual(_pixels(payload["land_spans"]), land)
        self.assertTrue(payload["coastline_pixels"])
        self.assertTrue(
            all(0 <= x < 101 and 0 <= y < 101 for x, y in payload["coastline_pixels"])
        )

    def test_near_gap_is_closed_deterministically(self) -> None:
        features = [
            _feature("LineString", [[103.10, 1.10], [103.40, 1.10]]),
            _feature("LineString", [[103.40, 1.10], [103.40, 1.40]]),
            _feature("LineString", [[103.40, 1.40], [103.10, 1.40]]),
            # About 44 metres from the first endpoint at Singapore's latitude.
            _feature("LineString", [[103.10, 1.40], [103.1004, 1.10]]),
        ]

        forward = extract_coastline_polygons({"features": features})
        reverse = extract_coastline_polygons({"features": list(reversed(features))})

        self.assertEqual(forward, reverse)
        self.assertEqual(len(forward), 1)
        self.assertEqual(forward[0][0][0], forward[0][0][-1])

    def test_large_open_gap_is_rejected(self) -> None:
        collection = {
            "features": [
                _feature("LineString", [[103.10, 1.10], [103.40, 1.10]]),
                _feature("LineString", [[103.40, 1.10], [103.40, 1.40]]),
                _feature("LineString", [[103.40, 1.40], [103.10, 1.40]]),
                # More than 200 metres from the first endpoint.
                _feature("LineString", [[103.10, 1.40], [103.102, 1.10]]),
            ]
        }

        self.assertEqual(extract_coastline_polygons(collection), [])

    def test_polygon_holes_remain_water(self) -> None:
        collection = {
            "features": [
                _feature(
                    "Polygon",
                    [
                        [
                            [103.10, 1.10],
                            [103.50, 1.10],
                            [103.50, 1.50],
                            [103.10, 1.50],
                            [103.10, 1.10],
                        ],
                        [
                            [103.20, 1.20],
                            [103.30, 1.20],
                            [103.30, 1.30],
                            [103.20, 1.30],
                            [103.20, 1.20],
                        ],
                    ],
                )
            ]
        }

        _, land = build_coastline_layer(
            collection,
            _fixture_project,
            resolution=101,
        )

        self.assertIn((15, 15), land)
        self.assertNotIn((25, 25), land)

    def test_supplied_coastline_separates_mainland_from_open_sea(self) -> None:
        collection = json.loads(
            Path("data/landuse.geojson").read_text(encoding="utf-8")
        )
        layout = json.loads(
            Path("output/map_layout.json").read_text(encoding="utf-8")
        )
        resolution = 256
        project = create_world_projector(
            layout["bounds"],
            float(layout.get("physical_aspect_ratio", 50 / 27)),
        )
        _, land = build_coastline_layer(collection, project, resolution)

        def pixel(longitude: float, latitude: float) -> tuple[int, int]:
            x, y = project(longitude, latitude)
            return round(x * (resolution - 1)), round(y * (resolution - 1))

        # Central Singapore and an unambiguous open-sea point south-east of it.
        self.assertIn(pixel(103.8198, 1.3521), land)
        self.assertNotIn(pixel(103.9000, 1.1800), land)


if __name__ == "__main__":
    unittest.main()
