"""Live parsing and simulation payloads for the rainfall layer."""

from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

Projector = Callable[[float, float], list[float] | None]


class RainfallLayer:
    def __init__(
        self,
        config: Mapping[str, Any],
        random_source: random.Random,
        project: Projector,
    ) -> None:
        self.config = config
        self.random = random_source
        self.project = project

    @staticmethod
    def off_payload() -> dict[str, Any]:
        return {
            "stations": [],
            "maximum_mm": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "simulated": False,
        }

    def simulated_payload(
        self,
        previous: Mapping[str, Any] | None = None,
        wind: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        previous = previous or {}
        wind = wind or {"motion_x": 1.0, "motion_y": 0.0, "speed_knots": 5.0}
        motion_x = float(wind.get("motion_x") or 0.0)
        motion_y = float(wind.get("motion_y") or 0.0)
        drift = 0.0035 + min(25.0, float(wind.get("speed_knots") or 0.0)) * 0.00035
        previous_stations = (
            previous.get("stations") or [] if previous.get("simulated") else []
        )
        if previous_stations:
            stations = []
            for prior in previous_stations:
                station = dict(prior)
                forming = bool(station.get("forming", False))
                value = float(station.get("value") or 0)
                if forming:
                    value += self.random.uniform(0.25, 0.85)
                    if value >= float(station.get("peak", 5.0)):
                        forming = False
                else:
                    value += self.random.uniform(-0.7, 0.4)
                station["x"] = float(station["x"]) + motion_x * drift
                station["y"] = max(
                    0.24,
                    min(
                        0.76,
                        float(station["y"]) + motion_y * drift,
                    ),
                )
                outside = not (0.08 <= station["x"] <= 0.92) or not (
                    0.24 <= station["y"] <= 0.76
                )
                if value <= 0.05 or outside:
                    station["x"] = 0.12 if motion_x >= 0 else 0.88
                    station["y"] = self.random.uniform(0.34, 0.66)
                    station["value"] = 0.0
                    station["peak"] = self.random.uniform(3.0, 7.5)
                    station["forming"] = True
                else:
                    station["value"] = round(max(0.0, min(8.0, value)), 1)
                    station["forming"] = forming
                stations.append(station)
        else:
            stations = [
                {
                    "id": f"SIM-{index}",
                    "name": "Passing rain",
                    "x": self.random.uniform(0.12, 0.72),
                    "y": self.random.uniform(0.34, 0.66),
                    "value": round(self.random.uniform(1.5, 5.0), 1),
                    "peak": self.random.uniform(3.0, 7.5),
                    "forming": self.random.choice((True, False)),
                    "simulated": True,
                }
                for index in range(int(self.config["simulated_rain_clouds"]))
            ]
        return {
            "stations": stations,
            "maximum_mm": max((item["value"] for item in stations), default=0),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "simulated": True,
        }

    def live_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        data = payload.get("data") or {}
        station_lookup = {
            station["id"]: station for station in data.get("stations") or []
        }
        latest = (data.get("readings") or [])[-1]
        stations = []
        for reading in latest.get("data") or []:
            station = station_lookup.get(reading.get("stationId"))
            if not station:
                continue
            location = station.get("location") or {}
            point = self.project(
                float(location["longitude"]),
                float(location["latitude"]),
            )
            if point is None:
                continue
            stations.append(
                {
                    "id": station["id"],
                    "name": station.get("name") or station["id"],
                    "x": point[0],
                    "y": point[1],
                    "value": max(0.0, float(reading.get("value") or 0)),
                    "simulated": False,
                }
            )
        return {
            "stations": stations,
            "maximum_mm": max((item["value"] for item in stations), default=0),
            "timestamp": latest.get("timestamp")
            or datetime.now(timezone.utc).isoformat(),
            "simulated": False,
        }
