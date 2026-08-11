"""NEA wind observations reduced to an ambient map-motion vector."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

Projector = Callable[[float, float], list[float] | None]


class WindLayer:
    def __init__(self, project: Projector) -> None:
        self.project = project

    @staticmethod
    def _motion(direction_degrees: float) -> tuple[float, float]:
        # NEA reports the direction wind comes from. Canvas motion needs the
        # opposite bearing, with positive Y pointing south/down the screen.
        bearing = math.radians((direction_degrees + 180.0) % 360.0)
        return math.sin(bearing), -math.cos(bearing)

    def fallback_payload(self) -> dict[str, Any]:
        direction = 65.0
        motion_x, motion_y = self._motion(direction)
        return {
            "stations": [],
            "direction_degrees": direction,
            "speed_knots": 5.0,
            "motion_x": motion_x,
            "motion_y": motion_y,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "simulated",
        }

    @staticmethod
    def _latest(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        readings = (payload.get("data") or {}).get("readings") or []
        return readings[-1] if readings else {}

    @staticmethod
    def _values(payload: Mapping[str, Any]) -> dict[str, float]:
        values: dict[str, float] = {}
        for item in WindLayer._latest(payload).get("data") or []:
            try:
                values[str(item["stationId"])] = float(item["value"])
            except (KeyError, TypeError, ValueError):
                continue
        return values

    @staticmethod
    def _stations(payload: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
        return {
            str(station.get("id")): station
            for station in (payload.get("data") or {}).get("stations") or []
            if station.get("id")
        }

    def live_payload(
        self,
        direction_payload: Mapping[str, Any],
        speed_payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        directions = self._values(direction_payload)
        speeds = self._values(speed_payload)
        if not directions:
            raise ValueError("NEA wind-direction response contained no readings")

        direction_stations = self._stations(direction_payload)
        speed_stations = self._stations(speed_payload)
        weighted_sin = 0.0
        weighted_cos = 0.0
        total_weight = 0.0
        stations = []
        for station_id, direction in directions.items():
            speed = max(0.0, speeds.get(station_id, 0.0))
            weight = max(0.1, speed)
            angle = math.radians(direction % 360.0)
            weighted_sin += math.sin(angle) * weight
            weighted_cos += math.cos(angle) * weight
            total_weight += weight

            station = direction_stations.get(station_id) or speed_stations.get(
                station_id, {}
            )
            location = station.get("labelLocation") or station.get("location") or {}
            try:
                point = self.project(
                    float(location["longitude"]),
                    float(location["latitude"]),
                )
            except (KeyError, TypeError, ValueError):
                point = None
            stations.append(
                {
                    "id": station_id,
                    "name": station.get("name") or station_id,
                    "x": point[0] if point else None,
                    "y": point[1] if point else None,
                    "direction_degrees": direction % 360.0,
                    "speed_knots": speed,
                }
            )

        direction = (
            math.degrees(math.atan2(weighted_sin, weighted_cos)) % 360.0
            if total_weight
            else 0.0
        )
        speed_values = [max(0.0, value) for value in speeds.values()]
        speed = sum(speed_values) / len(speed_values) if speed_values else 0.0
        motion_x, motion_y = self._motion(direction)
        direction_latest = self._latest(direction_payload)
        speed_latest = self._latest(speed_payload)
        return {
            "stations": stations,
            "direction_degrees": round(direction, 2),
            "speed_knots": round(speed, 2),
            "motion_x": motion_x,
            "motion_y": motion_y,
            "timestamp": speed_latest.get("timestamp")
            or direction_latest.get("timestamp")
            or datetime.now(timezone.utc).isoformat(),
            "source": "live",
        }
