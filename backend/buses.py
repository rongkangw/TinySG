"""LTA bus metadata cache and sampled real-time vehicle observations."""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from .clients import fetch_json


def _records(payload: dict) -> list[dict]:
    return list(payload.get("value") or payload.get("Services") or [])


def _frequency_minutes(value: object) -> float:
    values = [
        float(match)
        for match in re.findall(r"\d+(?:\.\d+)?", str(value or ""))
    ]
    return sum(values) / len(values) if values else 15.0


class BusEngine:
    """Caches static bus topology daily and samples arrivals across the island."""

    def __init__(
        self,
        config: dict[str, Any],
        route_builder: Callable[[list[tuple[float, float]]], list[list[float]]],
        cache_path: str | Path = "data/bus_network_cache.json",
    ):
        self.config = config
        self.route_builder = route_builder
        self.cache_path = Path(cache_path)
        self.account_key = os.getenv("LTA_DATAMALL_ACCOUNT_KEY")
        self.stops: dict[str, dict[str, Any]] = {}
        self.routes: dict[tuple[str, int], list[dict[str, Any]]] = {}
        self.route_stop_indexes: dict[tuple[str, int], dict[str, int]] = {}
        self.service_frequencies: dict[tuple[str, int], dict[str, float]] = {}
        self.stop_labels: dict[str, str] = {}
        self.sample_codes: list[str] = []
        self.sample_cursor = 0
        self.cache_timestamp = 0.0
        self.tracked: dict[str, dict[str, Any]] = {}
        self._load_cache()

    def _load_cache(self) -> None:
        if not self.cache_path.exists():
            return
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self.cache_timestamp = float(payload.get("cached_at_epoch") or 0)
            self._index(
                payload.get("bus_stops") or [],
                payload.get("bus_routes") or [],
                payload.get("bus_services") or [],
            )
        except (OSError, ValueError, TypeError):
            return

    def _index(
        self, stops: list[dict], routes: list[dict], services: list[dict]
    ) -> None:
        self.stops = {
            str(stop.get("BusStopCode")): stop
            for stop in stops
            if stop.get("BusStopCode")
        }
        grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
        for item in routes:
            key = (str(item.get("ServiceNo")), int(item.get("Direction") or 1))
            grouped.setdefault(key, []).append(item)
        self.routes = {
            key: sorted(items, key=lambda item: int(item.get("StopSequence") or 0))
            for key, items in grouped.items()
        }
        self.route_stop_indexes = {}
        for key, route in self.routes.items():
            indexes: dict[str, int] = {}
            for index, item in enumerate(route):
                indexes.setdefault(str(item.get("BusStopCode")), index)
            self.route_stop_indexes[key] = indexes
        frequency_fields = (
            "AM_Peak_Freq",
            "AM_Offpeak_Freq",
            "PM_Peak_Freq",
            "PM_Offpeak_Freq",
        )
        self.service_frequencies = {
            (str(item.get("ServiceNo")), int(item.get("Direction") or 1)): {
                field: _frequency_minutes(item.get(field))
                for field in frequency_fields
            }
            for item in services
        }
        self.stop_labels = {
            code: str(
                stop.get("Description")
                or stop.get("RoadName")
                or stop.get("BusStopCode")
                or code
            )
            for code, stop in self.stops.items()
        }
        candidates = sorted(
            {
                str(item.get("BusStopCode"))
                for item in routes
                if str(item.get("BusStopCode")) in self.stops
            }
        )
        maximum = max(1, int(self.config["bus_sample_stops"]))
        if len(candidates) > maximum:
            step = len(candidates) / maximum
            candidates = [candidates[int(index * step)] for index in range(maximum)]
        self.sample_codes = candidates

    async def _all_pages(self, url: str) -> list[dict]:
        if not self.account_key:
            raise RuntimeError("LTA_DATAMALL_ACCOUNT_KEY is not configured")
        records: list[dict] = []
        skip = 0
        while True:
            payload = await asyncio.to_thread(
                fetch_json,
                url,
                self.account_key,
                timeout=15.0,
                account_key=True,
                params={"$skip": str(skip)},
            )
            page = _records(payload)
            records.extend(page)
            if len(page) < 500:
                break
            skip += 500
        return records

    async def refresh_static(self, force: bool = False) -> bool:
        maximum_age = float(self.config["bus_static_refresh_seconds"])
        if (
            not force
            and self.stops
            and time.time() - self.cache_timestamp < maximum_age
        ):
            return True
        if not self.account_key:
            return bool(self.stops)
        stops, routes, services = await asyncio.gather(
            self._all_pages(self.config["bus_stops_endpoint"]),
            self._all_pages(self.config["bus_routes_endpoint"]),
            self._all_pages(self.config["bus_services_endpoint"]),
        )
        self.cache_timestamp = time.time()
        self._index(stops, routes, services)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(
                {
                    "cached_at_epoch": self.cache_timestamp,
                    "bus_stops": stops,
                    "bus_routes": routes,
                    "bus_services": services,
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        return True

    def _route_to_stop(
        self,
        service: str,
        origin: str,
        destination: str,
        queried_stop: str,
        longitude: float,
        latitude: float,
    ) -> tuple[list[tuple[float, float]], float]:
        for direction in (1, 2):
            key = (service, direction)
            route = self.routes.get(key) or []
            indexes = self.route_stop_indexes.get(key) or {}
            target_index = indexes.get(queried_stop)
            if target_index is None:
                continue
            if origin and destination:
                origin_index = indexes.get(origin)
                destination_index = indexes.get(destination)
                if (
                    origin_index is not None
                    and destination_index is not None
                    and origin_index > destination_index
                ):
                    continue
            candidates = []
            for index, item in enumerate(route[: target_index + 1]):
                stop = self.stops.get(str(item.get("BusStopCode")))
                if not stop:
                    continue
                distance = (float(stop["Longitude"]) - longitude) ** 2 + (
                    float(stop["Latitude"]) - latitude
                ) ** 2
                candidates.append((distance, index))
            start_index = min(candidates)[1] if candidates else max(0, target_index - 1)
            waypoints = [(longitude, latitude)]
            for item in route[start_index + 1 : target_index + 1]:
                stop = self.stops.get(str(item.get("BusStopCode")))
                if stop:
                    waypoints.append(
                        (float(stop["Longitude"]), float(stop["Latitude"]))
                    )
            start_distance = float(route[start_index].get("Distance") or 0)
            target_distance = float(route[target_index].get("Distance") or 0)
            return waypoints, max(0.05, target_distance - start_distance)
        stop = self.stops.get(queried_stop)
        if stop:
            target = (float(stop["Longitude"]), float(stop["Latitude"]))
            kilometres = (
                math.hypot(target[0] - longitude, target[1] - latitude) * 111.32
            )
            return [(longitude, latitude), target], max(0.05, kilometres)
        return [(longitude, latitude)], 0.05

    def service_frequency_minutes(self, service: str, direction: int) -> float:
        """Return the midpoint of the current published dispatch range."""
        hour = datetime.now(timezone(timedelta(hours=8))).hour
        if 6 <= hour < 9:
            field = "AM_Peak_Freq"
        elif 9 <= hour < 17:
            field = "AM_Offpeak_Freq"
        elif 17 <= hour < 20:
            field = "PM_Peak_Freq"
        else:
            field = "PM_Offpeak_Freq"
        frequencies = self.service_frequencies.get((service, direction)) or {}
        return frequencies.get(field, 15.0)

    def stop_label(self, stop_code: str) -> str:
        code = str(stop_code)
        return self.stop_labels.get(code, code)

    async def refresh(self) -> dict[str, Any]:
        if not self.account_key:
            raise RuntimeError("LTA_DATAMALL_ACCOUNT_KEY is not configured")
        await self.refresh_static()
        if not self.sample_codes:
            raise RuntimeError("No cached bus stops are available")
        batch_size = min(
            len(self.sample_codes), max(1, int(self.config["bus_arrival_batch_size"]))
        )
        codes = [
            self.sample_codes[(self.sample_cursor + offset) % len(self.sample_codes)]
            for offset in range(batch_size)
        ]
        self.sample_cursor = (self.sample_cursor + batch_size) % len(self.sample_codes)
        endpoint = self.config["bus_arrival_endpoint"]
        payloads = await asyncio.gather(
            *[
                asyncio.to_thread(
                    fetch_json,
                    endpoint,
                    self.account_key,
                    timeout=15.0,
                    account_key=True,
                    params={"BusStopCode": code},
                )
                for code in codes
            ]
        )
        now = datetime.now(timezone.utc)
        observed: dict[str, dict[str, Any]] = {}
        seen: set[tuple] = set()
        for stop_code, payload in zip(codes, payloads):
            for service in _records(payload):
                service_no = str(service.get("ServiceNo") or "")
                for rank, bus in enumerate(
                    (
                        service.get("NextBus") or {},
                        service.get("NextBus2") or {},
                        service.get("NextBus3") or {},
                    ),
                    start=1,
                ):
                    try:
                        latitude = float(bus.get("Latitude") or 0)
                        longitude = float(bus.get("Longitude") or 0)
                    except (TypeError, ValueError):
                        continue
                    if not latitude or not longitude:
                        continue
                    estimated = str(bus.get("EstimatedArrival") or "")
                    try:
                        eta = max(
                            1.0,
                            (
                                datetime.fromisoformat(estimated.replace("Z", "+00:00"))
                                - now
                            ).total_seconds(),
                        )
                    except ValueError:
                        eta = 120.0
                    key = (
                        service_no,
                        round(latitude, 4),
                        round(longitude, 4),
                        round(eta / 20),
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    waypoints, route_distance = self._route_to_stop(
                        service_no,
                        str(bus.get("OriginCode") or ""),
                        str(bus.get("DestinationCode") or ""),
                        stop_code,
                        longitude,
                        latitude,
                    )
                    identifier = f"{service_no}-{stop_code}-{rank}"
                    next_stop_name = self.stop_label(stop_code)
                    observed[identifier] = {
                        "id": identifier,
                        "service": service_no,
                        "load": str(bus.get("Load") or "SEA"),
                        "monitored": int(bus.get("Monitored") or 0) == 1,
                        "route": self.route_builder(waypoints),
                        "road_pixels": True,
                        "next_stop_code": stop_code,
                        "next_stop_name": next_stop_name,
                        "next_stop_eta_seconds": round(eta, 1),
                        "route_stops": [
                            {
                                "code": stop_code,
                                "name": next_stop_name,
                                "phase": 1.0,
                            }
                        ],
                        "route_distance_km": round(route_distance, 3),
                        "estimated_speed_kmh": round(
                            min(80.0, route_distance / max(eta, 1) * 3600), 1
                        ),
                        "duration_seconds": eta,
                        "started_at": now.isoformat(),
                        "expires_at_epoch": time.time() + eta + 45,
                        "simulated": False,
                    }
        self.tracked.update(observed)
        current_epoch = time.time()
        self.tracked = {
            identifier: vehicle
            for identifier, vehicle in self.tracked.items()
            if float(vehicle.get("expires_at_epoch") or 0) > current_epoch
        }
        maximum = int(self.config["maximum_rendered_buses"])
        vehicles = sorted(
            self.tracked.values(),
            key=lambda vehicle: float(vehicle.get("expires_at_epoch") or 0),
            reverse=True,
        )[:maximum]
        return {
            "vehicles": vehicles,
            "vehicle_count": len(self.tracked),
            "timestamp": now.isoformat(),
            "simulated": False,
            "sampled_stops": len(codes),
            "cached_stops": len(self.stops),
            "cached_routes": len(self.routes),
        }
