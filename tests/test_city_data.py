from __future__ import annotations

import json
import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.city_data import CityDataEngine
from preprocess.rasterize import bresenham


class CityDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        map_layout = json.loads(
            Path("output/map_layout.json").read_text(encoding="utf-8")
        )
        road_graph = json.loads(
            Path("output/road_graph.json").read_text(encoding="utf-8")
        )
        road_pixels_payload = json.loads(
            Path("output/road_pixels.json").read_text(encoding="utf-8")
        )
        road_pixels = {
            edge["edge_id"]: edge["pixels"]
            for edge in road_pixels_payload["edges"]
        }
        cls.resolution = road_pixels_payload["resolution"]
        cls.road_pixels = {
            tuple(pixel)
            for pixels in road_pixels.values()
            for pixel in pixels
        }
        config = json.loads(
            Path("config/dashboard.json").read_text(encoding="utf-8")
        )
        cls.city_data = CityDataEngine(
            map_layout,
            road_graph,
            config,
            road_pixels=road_pixels,
            pixel_resolution=road_pixels_payload["resolution"],
            seed=19,
        )

    def test_coordinate_projection_stays_in_world(self) -> None:
        point = self.city_data.project(103.8198, 1.3521)
        self.assertIsNotNone(point)
        assert point is not None
        self.assertTrue(0 < point[0] < 1)
        self.assertTrue(0 < point[1] < 1)

    def test_all_user_controlled_sources_default_to_live(self) -> None:
        configured = self.city_data.config["source_modes"]
        self.assertTrue(configured)
        self.assertTrue(all(mode == "live" for mode in configured.values()))

    def test_simulated_city_data_is_available_immediately(self) -> None:
        snapshot = self.city_data.snapshot()
        self.assertGreater(snapshot["buses"]["vehicle_count"], 0)
        self.assertGreater(len(snapshot["buses"]["vehicles"]), 0)
        self.assertGreater(len(snapshot["rainfall"]["stations"]), 0)
        self.assertEqual(snapshot["source_status"]["buses"], "simulated")

    def test_bus_routes_follow_layout_edges(self) -> None:
        vehicles = self.city_data.snapshot()["buses"]["vehicles"][:12]
        self.assertTrue(vehicles)
        for vehicle in vehicles:
            route = vehicle["route"]
            self.assertGreaterEqual(len(route), 1)
            self.assertTrue(
                all(0 <= coordinate <= 1 for point in route for coordinate in point)
            )
            grid = [
                (
                    round(point[0] * (self.resolution - 1)),
                    round(point[1] * (self.resolution - 1)),
                )
                for point in route
            ]
            pixels = (
                set(grid)
                if vehicle.get("road_pixels")
                else {
                    pixel
                    for start, end in zip(grid, grid[1:])
                    for pixel in bresenham(start, end)
                }
            )
            self.assertTrue(
                pixels.issubset(self.road_pixels),
                f"{vehicle['id']} has off-road pixels: "
                f"{sorted(pixels - self.road_pixels)[:8]}",
            )
            self.assertIn("started_at", vehicle)
            self.assertGreater(vehicle["duration_seconds"], 0)

    def test_simulated_bus_journeys_do_not_reset_on_poll(self) -> None:
        before = self.city_data.snapshot()["buses"]["vehicles"][0]
        account_key = self.city_data.bus_engine.account_key
        self.city_data.bus_engine.account_key = None
        try:
            asyncio.run(self.city_data.refresh_buses())
        finally:
            self.city_data.bus_engine.account_key = account_key
        after = self.city_data.snapshot()["buses"]["vehicles"][0]
        self.assertEqual(before["started_at"], after["started_at"])
        self.assertEqual(before["route"], after["route"])
        self.assertEqual(self.city_data.source_modes["buses"], "live")
        self.assertEqual(
            self.city_data.source_status["buses"], "simulated"
        )

    def test_failed_live_weather_falls_back_without_disabling_live_retries(self) -> None:
        original_mode = self.city_data.source_modes["rainfall"]
        original_rainfall = self.city_data.rainfall
        original_status = self.city_data.source_status["rainfall"]
        try:
            self.city_data.source_modes["rainfall"] = "live"
            with patch(
                "backend.city_data.fetch_json",
                side_effect=RuntimeError("provider unavailable"),
            ):
                rainfall = asyncio.run(self.city_data.refresh_rainfall())
            self.assertTrue(rainfall["simulated"])
            self.assertEqual(
                self.city_data.source_status["rainfall"], "simulated"
            )
            self.assertEqual(self.city_data.source_modes["rainfall"], "live")
        finally:
            self.city_data.source_modes["rainfall"] = original_mode
            self.city_data.rainfall = original_rainfall
            self.city_data.source_status["rainfall"] = original_status

    def test_explicit_simulation_does_not_poll_live_weather(self) -> None:
        original_mode = self.city_data.source_modes["rainfall"]
        original_rainfall = self.city_data.rainfall
        original_wind = self.city_data.wind
        original_rain_status = self.city_data.source_status["rainfall"]
        original_direction_status = self.city_data.source_status["wind_direction"]
        original_speed_status = self.city_data.source_status["wind_speed"]
        try:
            with patch("backend.city_data.fetch_json") as fetch:
                snapshot = asyncio.run(
                    self.city_data.set_source_mode("rainfall", "simulated")
                )
            fetch.assert_not_called()
            self.assertEqual(snapshot["source_modes"]["rainfall"], "simulated")
            self.assertEqual(snapshot["source_status"]["rainfall"], "simulated")
            self.assertEqual(snapshot["source_status"]["wind_direction"], "simulated")
            self.assertTrue(snapshot["rainfall"]["simulated"])
            self.assertEqual(snapshot["wind"]["source"], "simulated")
            self.assertFalse(snapshot["api_calls"]["rainfall"]["active"])
            self.assertFalse(snapshot["api_calls"]["wind_direction"]["active"])
        finally:
            self.city_data.source_modes["rainfall"] = original_mode
            self.city_data.rainfall = original_rainfall
            self.city_data.wind = original_wind
            self.city_data.source_status["rainfall"] = original_rain_status
            self.city_data.source_status["wind_direction"] = original_direction_status
            self.city_data.source_status["wind_speed"] = original_speed_status

    def test_explicit_bus_simulation_does_not_refresh_live_metadata(self) -> None:
        original_mode = self.city_data.source_modes["buses"]
        original_buses = self.city_data.buses
        original_status = self.city_data.source_status["buses"]
        try:
            with (
                patch.object(
                    self.city_data.bus_engine,
                    "refresh",
                    new_callable=AsyncMock,
                ) as refresh,
                patch.object(
                    self.city_data.bus_engine,
                    "refresh_static",
                    new_callable=AsyncMock,
                ) as refresh_static,
            ):
                snapshot = asyncio.run(
                    self.city_data.set_source_mode("buses", "simulated")
                )
            refresh.assert_not_awaited()
            refresh_static.assert_not_awaited()
            self.assertEqual(snapshot["source_modes"]["buses"], "simulated")
            self.assertEqual(snapshot["source_status"]["buses"], "simulated")
            self.assertTrue(snapshot["buses"]["simulated"])
            self.assertFalse(snapshot["api_calls"]["buses"]["active"])
        finally:
            self.city_data.source_modes["buses"] = original_mode
            self.city_data.buses = original_buses
            self.city_data.source_status["buses"] = original_status

    def test_off_mode_disables_layer_and_api_clocks(self) -> None:
        original_mode = self.city_data.source_modes["rainfall"]
        original_rainfall = self.city_data.rainfall
        original_statuses = {
            source: self.city_data.source_status[source]
            for source in ("rainfall", "wind_direction", "wind_speed")
        }
        try:
            with patch("backend.city_data.fetch_json") as fetch:
                snapshot = asyncio.run(
                    self.city_data.set_source_mode("rainfall", "off")
                )
            fetch.assert_not_called()
            self.assertEqual(snapshot["source_modes"]["rainfall"], "off")
            self.assertEqual(snapshot["source_status"]["rainfall"], "off")
            self.assertEqual(snapshot["source_status"]["wind_direction"], "inactive")
            self.assertFalse(snapshot["api_calls"]["rainfall"]["active"])
            self.assertFalse(snapshot["api_calls"]["wind_speed"]["active"])
            self.assertFalse(snapshot["rainfall"]["simulated"])
        finally:
            self.city_data.source_modes["rainfall"] = original_mode
            self.city_data.rainfall = original_rainfall
            self.city_data.source_status.update(original_statuses)

    def test_incident_mode_and_status_are_separate_fields(self) -> None:
        original_mode = self.city_data.source_modes["incidents"]
        original_status = self.city_data.source_status["incidents"]
        try:
            self.city_data.set_incident_mode("simulated")
            snapshot = self.city_data.snapshot()
            self.assertEqual(snapshot["source_modes"]["incidents"], "simulated")
            self.assertEqual(snapshot["source_status"]["incidents"], "simulated")
        finally:
            self.city_data.source_modes["incidents"] = original_mode
            self.city_data.source_status["incidents"] = original_status

    def test_roadworks_are_matched_by_road_name(self) -> None:
        asyncio.run(self.city_data.set_source_mode("roadworks", "simulated"))
        works = self.city_data.snapshot()["roadworks"]["works"]
        self.assertGreater(len(works), 0)
        self.assertTrue(
            all(
                "edge_id" in work
                and "phase" in work
                and work["pixels"]
                and work.get("start_date")
                and work.get("end_date")
                for work in works
            )
        )

    def test_simulated_lightning_has_projected_pixel_location(self) -> None:
        self.city_data.next_simulated_lightning = 0
        strike = self.city_data.simulated_lightning(now=1)
        self.assertIsNotNone(strike)
        assert strike is not None
        self.assertTrue(0 <= strike["x"] <= 1)
        self.assertTrue(0 <= strike["y"] <= 1)
        self.assertIn(strike["kind"], {"C", "G"})

    def test_api_clock_records_each_poll(self) -> None:
        self.city_data.mark_api_call("buses")
        clock = self.city_data.snapshot()["api_calls"]["buses"]
        self.assertIsNotNone(clock["last_called_at"])
        self.assertEqual(
            clock["active"],
            self.city_data.source_modes["buses"] == "live",
        )
        wind_clock = self.city_data.snapshot()["api_calls"]["wind_direction"]
        self.assertEqual(wind_clock["interval_seconds"], 300)
        self.assertTrue(wind_clock["active"])

    def test_speed_band_endpoint_uses_the_current_v4_contract(self) -> None:
        self.assertTrue(
            self.city_data.config["traffic_speed_bands_endpoint"].endswith(
                "/v4/TrafficSpeedBands"
            )
        )
        self.assertEqual(
            self.city_data.config["traffic_speed_bands_sample_pages"], 24
        )
        self.assertIn("records_received", self.city_data.traffic_speed_bands)
        self.assertGreaterEqual(
            self.city_data.traffic_speed_bands["records_received"], 0
        )

    def test_live_speed_bands_use_bounded_strided_sampling(self) -> None:
        original_key = self.city_data.lta_key
        original_payload = self.city_data.traffic_speed_bands
        original_status = self.city_data.source_status["traffic_speed_bands"]
        original_pages = self.city_data.config["traffic_speed_bands_sample_pages"]
        original_stride = self.city_data.config[
            "traffic_speed_bands_sample_stride"
        ]
        original_parallel = self.city_data.config[
            "traffic_speed_bands_parallel_requests"
        ]
        requested_urls: list[str] = []

        def fake_fetch(url: str, *_args, **_kwargs) -> dict:
            requested_urls.append(url)
            return {
                "lastUpdatedTime": "2026-08-02 17:10:00",
                "value": [
                    {
                        "RoadName": "PIE",
                        "SpeedBand": 4,
                        "MinimumSpeed": "30",
                        "MaximumSpeed": "39",
                        "StartLon": "103.7900",
                        "StartLat": "1.3300",
                        "EndLon": "103.7902",
                        "EndLat": "1.3301",
                    }
                ],
            }

        try:
            self.city_data.lta_key = "test-key"
            self.city_data.config["traffic_speed_bands_sample_pages"] = 3
            self.city_data.config["traffic_speed_bands_sample_stride"] = 5000
            self.city_data.config["traffic_speed_bands_parallel_requests"] = 2
            with patch("backend.city_data.fetch_json", side_effect=fake_fetch):
                result = asyncio.run(
                    self.city_data.refresh_traffic_speed_bands()
                )
            self.assertEqual(len(requested_urls), 3)
            self.assertTrue(any("$skip=0" in url for url in requested_urls))
            self.assertTrue(any("$skip=5000" in url for url in requested_urls))
            self.assertTrue(any("$skip=10000" in url for url in requested_urls))
            self.assertEqual(result["records_received"], 3)
            self.assertEqual(result["source"], "live")
            self.assertEqual(
                self.city_data.source_status["traffic_speed_bands"], "live"
            )
        finally:
            self.city_data.lta_key = original_key
            self.city_data.traffic_speed_bands = original_payload
            self.city_data.source_status["traffic_speed_bands"] = original_status
            self.city_data.config["traffic_speed_bands_sample_pages"] = (
                original_pages
            )
            self.city_data.config["traffic_speed_bands_sample_stride"] = (
                original_stride
            )
            self.city_data.config["traffic_speed_bands_parallel_requests"] = (
                original_parallel
            )


if __name__ == "__main__":
    unittest.main()
