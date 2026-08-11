from __future__ import annotations

import unittest

from backend.road_state import RoadStateEngine


class WebBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.road_state = RoadStateEngine(seed=11)
        cls.road_state.update(0.0)

    def setUp(self) -> None:
        # Preserve live incidents while clearing simulator changes between tests.
        simulated = [
            event_id
            for event_id, event in self.road_state.events.items()
            if event.simulated
        ]
        for event_id in simulated:
            del self.road_state.events[event_id]
        self.road_state.config["simulation"]["enabled"] = True
        self.road_state.config["simulation"]["maximum_simulated_incidents"] = 18

    def test_network_payload_uses_existing_layout(self) -> None:
        payload = self.road_state.network_payload()
        self.assertEqual(payload["resolution"], 992)
        self.assertLess(len(payload["edges"]), len(self.road_state.map_layout["edges"]))
        self.assertEqual(
            {layer["highway_class"] for layer in payload["road_layers"]},
            {edge["highway_class"] for edge in self.road_state.map_layout["edges"]},
        )
        self.assertGreater(
            sum(len(layer["pixels"]) for layer in payload["road_layers"]),
            10_000,
        )
        road_pixels = {
            tuple(pixel)
            for pixels in self.road_state.road_pixels.values()
            for pixel in pixels
        }
        self.assertTrue(payload["traffic_routes"])
        self.assertTrue(
            all(
                tuple(pixel) in road_pixels
                for route in payload["traffic_routes"]
                for pixel in route
            )
        )
        self.assertGreater(len(payload["land_polygon"]), 20)
        self.assertIn("land_spans", payload["environment_overlay"])
        self.assertIn("coastline_pixels", payload["environment_overlay"])
        airport_areas = payload["environment_overlay"]["airports"]["airport_areas"]
        self.assertTrue(airport_areas)
        self.assertIn(
            "Singapore Changi Airport",
            {area["name"] for area in airport_areas},
        )
        for area in airport_areas:
            self.assertTrue(area["ground_spans"] or area["runway_pixels"])
        self.assertTrue(all(edge["pixels"] for edge in payload["edges"]))
        self.assertGreaterEqual(len(payload["rail"]["lines"]), 8)
        self.assertGreater(len(payload["rail"]["stations"]), 100)
        for line in payload["rail"]["lines"]:
            self.assertTrue(line["paths"])
            line_pixels = {tuple(pixel) for pixel in line["pixels"]}
            self.assertTrue(
                all(
                    tuple(pixel) in line_pixels
                    for path in line["paths"]
                    for pixel in path
                )
            )
        station_lines = {
            reference
            for station in payload["rail"]["stations"]
            for reference in station["lines"]
        }
        trainable = [
            line
            for line in payload["rail"]["lines"]
            if not line["future"]
            and line["ref"] in station_lines
            and len(line["paths"][0]) >= 5
        ]
        self.assertGreaterEqual(
            len(trainable),
            6,
            f"trainable refs: {[line['ref'] for line in trainable]}",
        )

    def test_simulation_adds_to_live_events(self) -> None:
        live_before = sum(not event.simulated for event in self.road_state.events.values())
        simulated = self.road_state.spawn_simulated()
        self.assertIsNotNone(simulated)
        self.assertEqual(
            sum(not event.simulated for event in self.road_state.events.values()),
            live_before,
        )

    def test_additive_intensity_is_capped(self) -> None:
        edge_id = next(iter(self.road_state.edges))
        for _ in range(5):
            self.road_state.add_incident(
                edge_id,
                "Crash",
                "test",
                0.5,
                simulated=False,
                lifetime_seconds=3600,
            )
        self.road_state.update(0.0)
        maximum = self.road_state.config["animation"]["maximum_intensity"]
        self.assertEqual(
            self.road_state.current_road_state[edge_id]["intensity"],
            maximum,
        )

    def test_control_updates_are_applied(self) -> None:
        self.road_state.apply_command(
            {
                "type": "simulation_config",
                "payload": {
                    "enabled": False,
                    "spawn_interval": 7.5,
                    "maximum_incidents": 9,
                },
            }
        )
        simulation = self.road_state.config["simulation"]
        self.assertFalse(simulation["enabled"])
        self.assertEqual(simulation["spawn_interval_seconds"], 7.5)
        self.assertEqual(simulation["maximum_simulated_incidents"], 9)

    def test_incident_modes_are_exclusive(self) -> None:
        self.road_state.set_incident_mode("simulated")
        self.assertTrue(self.road_state.config["simulation"]["enabled"])
        self.assertFalse(any(not event.simulated for event in self.road_state.events.values()))
        self.road_state.set_incident_mode("off")
        self.assertFalse(self.road_state.config["simulation"]["display_enabled"])
        self.assertFalse(self.road_state.events)
        self.road_state.set_incident_mode("live")
        self.assertTrue(self.road_state.config["simulation"]["display_enabled"])
        self.assertTrue(all(not event.simulated for event in self.road_state.events.values()))
        self.road_state.apply_command(
            {"type": "time_control", "payload": {"paused": True, "speed": 5}}
        )
        self.assertTrue(self.road_state.paused)
        self.assertEqual(self.road_state.time_scale, 5)


if __name__ == "__main__":
    unittest.main()
