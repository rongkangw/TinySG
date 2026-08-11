from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.buses import BusEngine


class BusEngineIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.engine = BusEngine(
            {"bus_sample_stops": 10},
            lambda waypoints: [[longitude, latitude] for longitude, latitude in waypoints],
            Path(self.temporary_directory.name) / "missing-cache.json",
        )
        self.engine._index(
            [
                {
                    "BusStopCode": "A",
                    "Description": "Alpha",
                    "Longitude": 103.80,
                    "Latitude": 1.30,
                },
                {
                    "BusStopCode": "B",
                    "Description": "Bravo",
                    "Longitude": 103.81,
                    "Latitude": 1.31,
                },
                {
                    "BusStopCode": "C",
                    "Description": "Charlie",
                    "Longitude": 103.82,
                    "Latitude": 1.32,
                },
            ],
            [
                {
                    "ServiceNo": "10",
                    "Direction": 1,
                    "StopSequence": sequence,
                    "BusStopCode": code,
                    "Distance": distance,
                }
                for sequence, code, distance in (
                    (1, "A", 0.0),
                    (2, "B", 1.0),
                    (3, "C", 2.0),
                )
            ],
            [
                {
                    "ServiceNo": "10",
                    "Direction": 1,
                    "AM_Peak_Freq": "6-10",
                    "AM_Offpeak_Freq": "6-10",
                    "PM_Peak_Freq": "6-10",
                    "PM_Offpeak_Freq": "6-10",
                }
            ],
        )

    def test_static_metadata_builds_constant_time_lookup_indexes(self) -> None:
        key = ("10", 1)
        self.assertEqual(self.engine.route_stop_indexes[key]["A"], 0)
        self.assertEqual(self.engine.route_stop_indexes[key]["C"], 2)
        self.assertEqual(self.engine.stop_label("B"), "Bravo")
        self.assertEqual(self.engine.service_frequency_minutes("10", 1), 8.0)

    def test_route_lookup_preserves_stop_order_and_distance(self) -> None:
        waypoints, distance = self.engine._route_to_stop(
            "10", "A", "C", "C", 103.80, 1.30
        )
        self.assertEqual(
            waypoints,
            [(103.80, 1.30), (103.81, 1.31), (103.82, 1.32)],
        )
        self.assertEqual(distance, 2.0)


if __name__ == "__main__":
    unittest.main()
