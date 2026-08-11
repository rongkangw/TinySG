from __future__ import annotations

import asyncio
import unittest

from backend import app as app_module


class AppContractTests(unittest.TestCase):
    def test_city_data_route_replaces_environment_route(self) -> None:
        paths = {route.path for route in app_module.app.routes}
        self.assertIn("/api/city-data", paths)
        self.assertNotIn("/api/environment", paths)

    def test_state_and_city_data_keep_mode_and_status_separate(self) -> None:
        state = asyncio.run(app_module.state())
        city_data = asyncio.run(app_module.city_data_state())
        self.assertIn("city_data", state)
        self.assertNotIn("environment", state)
        self.assertIn("source_modes", city_data)
        self.assertIn("source_status", city_data)
        self.assertNotIn("modes", city_data)
        self.assertEqual(
            set(city_data["source_modes"]),
            {
                "incidents",
                "buses",
                "rainfall",
                "lightning",
                "roadworks",
                "traffic_speed_bands",
            },
        )


if __name__ == "__main__":
    unittest.main()
