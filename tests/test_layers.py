from __future__ import annotations

import random
import unittest

from backend.layers import (
    LightningLayer,
    RainfallLayer,
    RoadworksLayer,
    TrafficSpeedBandsLayer,
    WindLayer,
)
from backend.layers.road_names import road_key


class RainfallLayerTests(unittest.TestCase):
    def test_live_payload_projects_known_stations_and_preserves_timestamp(self) -> None:
        layer = RainfallLayer(
            {"simulated_rain_clouds": 2},
            random.Random(2),
            lambda longitude, latitude: (
                [longitude / 200, latitude / 2] if longitude < 104 else None
            ),
        )
        payload = layer.live_payload(
            {
                "data": {
                    "stations": [
                        {
                            "id": "S1",
                            "name": "West",
                            "location": {"longitude": 103.8, "latitude": 1.3},
                        },
                        {
                            "id": "S2",
                            "name": "Outside",
                            "location": {"longitude": 105.0, "latitude": 1.4},
                        },
                    ],
                    "readings": [
                        {
                            "timestamp": "2026-07-29T12:00:00+08:00",
                            "data": [
                                {"stationId": "S1", "value": 2.5},
                                {"stationId": "S2", "value": 8.0},
                            ],
                        }
                    ],
                }
            }
        )
        self.assertEqual(payload["timestamp"], "2026-07-29T12:00:00+08:00")
        self.assertEqual(payload["maximum_mm"], 2.5)
        self.assertEqual([station["id"] for station in payload["stations"]], ["S1"])
        self.assertFalse(payload["simulated"])

    def test_simulated_payload_evolves_existing_cells_without_replacing_them(self) -> None:
        layer = RainfallLayer(
            {"simulated_rain_clouds": 3},
            random.Random(7),
            lambda _longitude, _latitude: None,
        )
        first = layer.simulated_payload()
        second = layer.simulated_payload(first)
        self.assertEqual(
            [station["id"] for station in first["stations"]],
            [station["id"] for station in second["stations"]],
        )
        self.assertTrue(
            all(
                after["x"] > before["x"]
                for before, after in zip(first["stations"], second["stations"])
            )
        )


class LightningLayerTests(unittest.TestCase):
    def test_live_events_are_projected_and_deduplicated(self) -> None:
        layer = LightningLayer(
            random.Random(5),
            lambda longitude, latitude: [longitude / 200, latitude / 2],
            lambda: [0.4, 0.5],
        )
        payload = {
            "data": {
                "records": [
                    {
                        "datetime": "2026-07-29T12:00:00+08:00",
                        "item": {
                            "readings": [
                                {
                                    "datetime": "2026-07-29T12:00:00+08:00",
                                    "location": {
                                        "longitude": "103.8",
                                        "latitude": "1.3",
                                    },
                                    "type": "G",
                                    "text": "Cloud to Ground",
                                }
                            ]
                        },
                    }
                ]
            }
        }
        first = layer.live_events(payload)
        second = layer.live_events(payload)
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(first[0]["kind"], "G")
        self.assertFalse(first[0]["simulated"])

    def test_simulated_event_uses_supplied_world_point(self) -> None:
        layer = LightningLayer(
            random.Random(5),
            lambda _longitude, _latitude: None,
            lambda: [0.25, 0.75],
        )
        event = layer.simulated_event()
        self.assertEqual((event["x"], event["y"]), (0.25, 0.75))
        self.assertIn(event["kind"], {"C", "G"})
        self.assertTrue(event["simulated"])


class WindLayerTests(unittest.TestCase):
    def test_live_payload_joins_stations_and_converts_from_direction_to_motion(self) -> None:
        layer = WindLayer(lambda longitude, latitude: [longitude / 200, latitude / 2])
        direction = {
            "data": {
                "stations": [
                    {
                        "id": "S1",
                        "name": "East station",
                        "labelLocation": {"longitude": 103.8, "latitude": 1.3},
                    }
                ],
                "readings": [
                    {
                        "timestamp": "2026-08-02T12:00:00+08:00",
                        "data": [{"stationId": "S1", "value": 90}],
                    }
                ],
            }
        }
        speed = {
            "data": {
                "stations": [
                    {
                        "id": "S1",
                        "name": "East station",
                        "location": {"longitude": 103.8, "latitude": 1.3},
                    }
                ],
                "readings": [
                    {
                        "timestamp": "2026-08-02T12:00:00+08:00",
                        "data": [{"stationId": "S1", "value": 10}],
                    }
                ],
            }
        }
        payload = layer.live_payload(direction, speed)
        self.assertEqual(payload["direction_degrees"], 90)
        self.assertEqual(payload["speed_knots"], 10)
        self.assertAlmostEqual(payload["motion_x"], -1)
        self.assertAlmostEqual(payload["motion_y"], 0)
        self.assertEqual(payload["stations"][0]["name"], "East station")
        self.assertEqual(payload["source"], "live")


class RoadworksLayerTests(unittest.TestCase):
    def test_records_rotate_across_same_named_edges_and_stay_on_road_pixels(self) -> None:
        graph = {
            "edges": [
                {"id": 1, "road": "Example Road", "highway_class": "primary"},
                {"id": 2, "road": "Example Road", "highway_class": "secondary"},
            ]
        }
        pixels = {1: [[1, 1], [2, 1]], 2: [[3, 1], [4, 1]]}
        layer = RoadworksLayer(graph, pixels, random.Random(3))
        payload = layer.payload(
            [
                {"EventID": "A", "RoadName": "Example Rd"},
                {"EventID": "B", "RoadName": "Example Road"},
                {"EventID": "C", "RoadName": "Unknown"},
            ],
            False,
        )
        self.assertEqual(payload["count"], 2)
        self.assertEqual(
            [work["edge_id"] for work in payload["works"]],
            [1, 2],
        )
        self.assertIs(payload["works"][0]["pixels"], pixels[1])
        self.assertEqual(payload["source"], "live")

    def test_road_name_normalization_is_shared(self) -> None:
        self.assertEqual(road_key("Example Rd."), road_key("example road"))
        self.assertEqual(road_key("North Ave"), "NORTH AVENUE")


class _FakeMapper:
    def __init__(self) -> None:
        self.edges = {
            7: {"id": 7, "road": "PIE"},
            8: {"id": 8, "road": "Other Road"},
        }

    def locate(self, latitude: float, longitude: float) -> dict:
        if longitude > 104:
            return {"edge_id": 8, "distance_metres": 80}
        return {"edge_id": 7, "distance_metres": 60}


class TrafficSpeedBandsLayerTests(unittest.TestCase):
    def test_alias_matching_keeps_the_slowest_band_per_edge(self) -> None:
        layer = TrafficSpeedBandsLayer(_FakeMapper())
        records = [
            {
                "RoadName": "Pan Island Expressway",
                "StartLat": 1.3,
                "EndLat": 1.31,
                "StartLon": 103.8,
                "EndLon": 103.81,
                "SpeedBand": 6,
                "MinimumSpeed": 50,
                "MaximumSpeed": 59,
            },
            {
                "RoadName": "PIE",
                "StartLat": 1.3,
                "EndLat": 1.31,
                "StartLon": 103.8,
                "EndLon": 103.81,
                "SpeedBand": 2,
                "MinimumSpeed": 10,
                "MaximumSpeed": 19,
            },
            {
                "RoadName": "PIE",
                "StartLat": 1.3,
                "EndLat": 1.31,
                "StartLon": 105.0,
                "EndLon": 105.1,
                "SpeedBand": 1,
            },
        ]
        payload = layer.payload(
            records,
            "2026-07-29T12:00:00+08:00",
        )
        self.assertEqual(payload["matched_edges"], 1)
        self.assertEqual(payload["bands"][0]["edge_id"], 7)
        self.assertEqual(payload["bands"][0]["speed_band"], 2)
        self.assertEqual(payload["source"], "live")

    def test_empty_payload_reflects_inactive_mode(self) -> None:
        payload = TrafficSpeedBandsLayer.empty_payload("off")
        self.assertEqual(payload["source"], "off")
        self.assertEqual(payload["bands"], [])


if __name__ == "__main__":
    unittest.main()
