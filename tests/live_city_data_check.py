"""Manual smoke check for Mini Singapore's configured live sources."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.settings import load_dotenv

load_dotenv()

from backend.city_data import CityDataEngine


async def main() -> None:
    map_layout = json.loads(
        Path("output/map_layout.json").read_text(encoding="utf-8")
    )
    road_graph = json.loads(
        Path("output/road_graph.json").read_text(encoding="utf-8")
    )
    config = json.loads(
        Path("config/dashboard.json").read_text(encoding="utf-8")
    )
    city_data = CityDataEngine(map_layout, road_graph, config, seed=29)
    buses, rainfall, lightning, roadworks, wind, speed_bands = await asyncio.gather(
        city_data.refresh_buses(),
        city_data.refresh_rainfall(),
        city_data.refresh_lightning(),
        city_data.refresh_roadworks(),
        city_data.refresh_wind(),
        city_data.refresh_traffic_speed_bands(),
    )
    print(
        json.dumps(
            {
                "sources": city_data.source_status,
                "observed_buses": buses["vehicle_count"],
                "rendered_buses": len(buses["vehicles"]),
                "cached_bus_stops": buses["cached_stops"],
                "rain_stations": len(rainfall["stations"]),
                "maximum_rain_mm": rainfall["maximum_mm"],
                "new_lightning": len(lightning),
                "roadworks": roadworks["count"],
                "wind_stations": len(wind["stations"]),
                "wind_direction_degrees": wind["direction_degrees"],
                "wind_speed_knots": wind["speed_knots"],
                "speed_band_records": len(speed_bands["bands"]),
                "matched_speed_band_edges": speed_bands["matched_edges"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
