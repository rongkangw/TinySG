"""Live and independently simulated ambient streams for Mini Singapore."""

from __future__ import annotations

import asyncio
import os
import random
import time
from datetime import datetime, timezone
from typing import Any, Literal, cast

from .buses import BusEngine
from .clients import fetch_json
from .layers import (
    LightningLayer,
    RainfallLayer,
    RoadworksLayer,
    TrafficSpeedBandsLayer,
    WindLayer,
)
from .routing import IncidentMapper, RoadNetworkIndex, RoadRouter


SourceMode = Literal["live", "simulated", "off"]
SourceStatus = Literal["live", "simulated", "loading", "off", "inactive"]

CONTROLLABLE_SOURCES = (
    "incidents",
    "buses",
    "rainfall",
    "lightning",
    "roadworks",
    "traffic_speed_bands",
)


class CityDataEngine:
    def __init__(
        self,
        map_layout: dict[str, Any],
        road_graph: dict[str, Any],
        config: dict[str, Any],
        road_pixels: dict[int, list[list[int]]] | None = None,
        pixel_resolution: int = 992,
        seed: int | None = None,
    ):
        self.map_layout = map_layout
        self.road_graph = road_graph
        self.road_pixels = road_pixels or {}
        self.pixel_resolution = pixel_resolution
        self.config = config["city_data"]
        configured_modes = self.config.get("source_modes") or {}
        self.source_modes: dict[str, SourceMode] = {}
        for source in CONTROLLABLE_SOURCES:
            configured = str(configured_modes.get(source, "live"))
            if configured not in {"live", "simulated", "off"}:
                configured = "live"
            self.source_modes[source] = cast(SourceMode, configured)
        self.random = random.Random(seed)
        self.api_key = os.getenv("DATA_GOV_SG_API_KEY")
        self.lta_key = os.getenv("LTA_DATAMALL_ACCOUNT_KEY")
        self.bounds = map_layout["bounds"]
        self.aspect = float(map_layout.get("physical_aspect_ratio", 50 / 27))
        self.padding = 0.04
        self.content_width = 1 - 2 * self.padding
        self.content_height = self.content_width / self.aspect
        self.top_padding = (1 - self.content_height) / 2
        self.edge_points = [
            point
            for edge in map_layout["edges"]
            if edge.get("points")
            for point in edge["points"]
        ]
        self.road_network = RoadNetworkIndex(
            road_graph, map_layout, self.road_pixels
        )
        self.road_router = RoadRouter(self.road_network)
        self.mapper = IncidentMapper(road_graph)
        self.wind_layer = WindLayer(self.project)
        self.rainfall_layer = RainfallLayer(self.config, self.random, self.project)
        self.lightning_layer = LightningLayer(
            self.random,
            self.project,
            self._road_point,
        )
        self.roadworks_layer = RoadworksLayer(
            self.road_graph,
            self.road_pixels,
            self.random,
        )
        self.traffic_speed_bands_layer = TrafficSpeedBandsLayer(self.mapper)
        self.bus_engine = BusEngine(self.config, self._bus_route)
        self.buses = self._simulated_bus_payload()
        self.wind = self.wind_layer.fallback_payload()
        self.rainfall = self._simulated_rain_payload()
        self.lightning: list[dict[str, Any]] = []
        self.roadworks = self._simulated_roadworks_payload()
        self.traffic_speed_bands = (
            self.traffic_speed_bands_layer.empty_payload("simulated")
        )
        self.api_calls = {
            "buses": {
                "interval_seconds": self.config["bus_arrival_poll_seconds"],
                "last_called_at": None,
            },
            "rainfall": {
                "interval_seconds": self.config["rainfall_poll_seconds"],
                "last_called_at": None,
            },
            "lightning": {
                "interval_seconds": self.config["lightning_poll_seconds"],
                "last_called_at": None,
            },
            "roadworks": {
                "interval_seconds": self.config["roadworks_poll_seconds"],
                "last_called_at": None,
            },
            "traffic_speed_bands": {
                "interval_seconds": self.config[
                    "traffic_speed_bands_poll_seconds"
                ],
                "last_called_at": None,
            },
            "wind_direction": {
                "interval_seconds": self.config["wind_poll_seconds"],
                "last_called_at": None,
            },
            "wind_speed": {
                "interval_seconds": self.config["wind_poll_seconds"],
                "last_called_at": None,
            },
        }
        self.source_status: dict[str, SourceStatus] = {
            source: (
                self.source_modes[source]
                if source == "incidents"
                else (
                    "off" if self.source_modes[source] == "off" else "simulated"
                )
            )
            for source in CONTROLLABLE_SOURCES
        }
        wind_status: SourceStatus = (
            "inactive" if self.source_modes["rainfall"] == "off" else "simulated"
        )
        self.source_status["wind_direction"] = wind_status
        self.source_status["wind_speed"] = wind_status
        self.next_simulated_lightning = time.monotonic() + self.random.uniform(
            self.config["simulated_lightning_min_seconds"],
            self.config["simulated_lightning_max_seconds"],
        )
        self.seen_lightning = self.lightning_layer.seen

    def mark_api_call(self, source: str) -> None:
        if source in self.api_calls:
            self.api_calls[source]["last_called_at"] = datetime.now(
                timezone.utc
            ).isoformat()

    def project(self, longitude: float, latitude: float) -> list[float] | None:
        left, bottom, right, top = self.bounds
        if not (left - 0.03 <= longitude <= right + 0.03):
            return None
        if not (bottom - 0.03 <= latitude <= top + 0.03):
            return None
        return [
            self.padding
            + (longitude - left) / max(1e-12, right - left) * self.content_width,
            self.top_padding
            + (top - latitude) / max(1e-12, top - bottom) * self.content_height,
        ]

    def _road_point(self) -> list[float]:
        point = self.random.choice(self.edge_points)
        return [float(point[0]), float(point[1])]

    def _route_on_edge(
        self,
        edge_id: int,
        phase: float,
        direction: int,
        maximum_distance: float = 0.014,
        steps: int = 20,
    ) -> list[list[float]]:
        points = self.road_network.map_edges[edge_id].get("points") or []
        if not points:
            return [self._road_point()]
        start = round(max(0.0, min(1.0, phase)) * (len(points) - 1))
        indices = range(start, len(points)) if direction > 0 else range(start, -1, -1)
        route = [[float(points[index][0]), float(points[index][1])] for index in indices]
        if len(route) < 2:
            indices = range(start, -1, -1) if direction > 0 else range(start, len(points))
            route = [[float(points[index][0]), float(points[index][1])] for index in indices]
        return self._clip_route(route[:steps], maximum_distance)

    @staticmethod
    def _clip_route(
        route: list[list[float]], maximum_distance: float
    ) -> list[list[float]]:
        if len(route) < 2:
            return route
        clipped = [route[0]]
        remaining = maximum_distance
        for target in route[1:]:
            start = clipped[-1]
            length = ((target[0] - start[0]) ** 2 + (target[1] - start[1]) ** 2) ** 0.5
            if length <= remaining:
                clipped.append(target)
                remaining -= length
                continue
            break
        if len(clipped) == 1 and len(route) > 1:
            clipped.append(route[1])
        return clipped

    def _bus_route(
        self,
        waypoints: list[tuple[float, float]],
    ) -> list[list[float]]:
        hits: list[tuple[int, float]] = []
        for longitude, latitude in waypoints:
            hit = self.mapper.locate(latitude, longitude)
            edge = self.road_graph["edges"][hit["edge_id"]]
            phase = hit["sample_index"] / max(
                1, len(edge["sampled_coordinates"]) - 1
            )
            candidate = (hit["edge_id"], phase)
            if not hits or hits[-1][0] != candidate[0] or abs(hits[-1][1] - phase) > 0.01:
                hits.append(candidate)
        pixel_route: list[list[int]] = []
        for start, end in zip(hits, hits[1:]):
            segment = self.road_router.pixel_route_between_hits(start, end)
            if segment:
                pixel_route.extend(
                    segment[1:]
                    if pixel_route and pixel_route[-1] == segment[0]
                    else segment
                )
        if len(pixel_route) >= 2:
            return [
                [
                    (pixel[0] + 0.5) / self.pixel_resolution,
                    (pixel[1] + 0.5) / self.pixel_resolution,
                ]
                for pixel in pixel_route
            ]
        if waypoints:
            longitude, latitude = waypoints[0]
            hit = self.mapper.locate(latitude, longitude)
            edge = self.road_graph["edges"][hit["edge_id"]]
            phase = hit["sample_index"] / max(
                1, len(edge["sampled_coordinates"]) - 1
            )
            direction = (
                1 if hash((round(longitude, 4), round(latitude, 4))) & 1 else -1
            )
            pixels = self.road_pixels.get(hit["edge_id"], [])
            if pixels:
                index = round(phase * (len(pixels) - 1))
                selected = (
                    pixels[index : index + 140]
                    if direction > 0
                    else list(reversed(pixels[max(0, index - 139) : index + 1]))
                )
                return [
                    [
                        (pixel[0] + 0.5) / self.pixel_resolution,
                        (pixel[1] + 0.5) / self.pixel_resolution,
                    ]
                    for pixel in selected
                ]
            return self._route_on_edge(
                hit["edge_id"], phase, direction, maximum_distance=0.012
            )
        return [self._road_point()]

    def _simulated_bus_payload(self) -> dict[str, Any]:
        vehicles = []
        cached_routes = [
            (key, stops)
            for key, stops in self.bus_engine.routes.items()
            if len(stops) >= 2
        ]
        route_weights = [
            1 / max(1.0, self.bus_engine.service_frequency_minutes(key[0], key[1]))
            for key, _stops in cached_routes
        ]
        for index in range(int(self.config["simulated_buses"])):
            route_stop_markers: list[dict[str, Any]] = []
            next_stop: dict[str, Any] | None = None
            if cached_routes:
                (service, _direction), stops = self.random.choices(
                    cached_routes, weights=route_weights, k=1
                )[0]
                start_index = self.random.randrange(len(stops) - 1)
                end_index = min(
                    len(stops) - 1, start_index + self.random.randint(2, 7)
                )
                selected_stops = [
                    self.bus_engine.stops.get(str(item.get("BusStopCode")))
                    for item in stops[start_index : end_index + 1]
                ]
                selected_stops = [stop for stop in selected_stops if stop]
            else:
                service, selected_stops = str(self.random.randint(2, 999)), []
            if len(selected_stops) >= 2:
                start_distance = float(stops[start_index].get("Distance") or 0)
                end_distance = float(stops[end_index].get("Distance") or 0)
                route_distance = max(0.2, end_distance - start_distance)
                for route_item, stop in zip(
                    stops[start_index : end_index + 1],
                    selected_stops,
                ):
                    code = str(stop.get("BusStopCode") or route_item.get("BusStopCode") or "")
                    phase = (
                        float(route_item.get("Distance") or start_distance)
                        - start_distance
                    ) / route_distance
                    marker = {
                        "code": code,
                        "name": self.bus_engine.stop_label(code),
                        "phase": max(0.0, min(1.0, phase)),
                    }
                    route_stop_markers.append(marker)
                next_stop = next(
                    (
                        marker
                        for marker in route_stop_markers
                        if float(marker.get("phase") or 0) > 0.02
                    ),
                    route_stop_markers[-1] if route_stop_markers else None,
                )
                speed = self.random.uniform(20, 34)
                duration = max(25.0, route_distance / speed * 3600)
                route = self._bus_route(
                    [
                        (float(stop["Longitude"]), float(stop["Latitude"]))
                        for stop in selected_stops
                    ],
                )
            else:
                edge = self.random.choice(self.road_graph["edges"])
                route_distance = 0.5
                speed = self.random.uniform(20, 34)
                duration = self.random.uniform(35, 75)
                route = self._route_on_edge(
                    edge["id"],
                    self.random.random(),
                    self.random.choice((-1, 1)),
                    maximum_distance=0.025,
                )
            vehicles.append(
                {
                    "id": f"SIM-BUS-{index}",
                    "service": service,
                    "load": self.random.choice(["SEA", "SDA", "LSD"]),
                    "monitored": True,
                    "route": route,
                    "road_pixels": bool(self.road_pixels),
                    "next_stop_code": (next_stop or {}).get("code", ""),
                    "next_stop_name": (next_stop or {}).get("name", ""),
                    "route_stops": route_stop_markers,
                    "duration_seconds": duration,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "route_distance_km": round(route_distance, 3),
                    "estimated_speed_kmh": round(speed, 1),
                    "phase_offset": self.random.random(),
                    "simulated": True,
                }
            )
        return {
            "vehicles": vehicles,
            "vehicle_count": len(vehicles),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "simulated": True,
            "sampled_stops": 0,
            "cached_stops": len(self.bus_engine.stops),
            "cached_routes": len(self.bus_engine.routes),
        }

    def _simulated_rain_payload(self) -> dict[str, Any]:
        return self.rainfall_layer.simulated_payload(
            getattr(self, "rainfall", {}),
            getattr(self, "wind", {}),
        )

    def _simulated_roadworks_payload(self) -> dict[str, Any]:
        return self.roadworks_layer.simulated_payload(
            int(self.config["simulated_roadworks"]),
        )

    async def refresh_buses(self) -> dict[str, Any]:
        mode = self.source_modes["buses"]
        if mode == "off":
            self.buses = {
                **self.buses,
                "vehicles": [],
                "vehicle_count": 0,
                "simulated": False,
            }
            self.source_status["buses"] = "off"
            return self.buses
        if mode == "simulated":
            if not self.buses.get("simulated", False):
                self.buses = self._simulated_bus_payload()
            else:
                self.buses["cached_stops"] = len(self.bus_engine.stops)
                self.buses["cached_routes"] = len(self.bus_engine.routes)
            self.source_status["buses"] = "simulated"
            return self.buses
        self.source_status["buses"] = "loading"
        try:
            self.buses = await self.bus_engine.refresh()
            self.source_status["buses"] = "live"
        except Exception:
            if not self.buses.get("simulated", False):
                self.buses = self._simulated_bus_payload()
            else:
                self.buses["cached_stops"] = len(self.bus_engine.stops)
                self.buses["cached_routes"] = len(self.bus_engine.routes)
            self.source_status["buses"] = "simulated"
        return self.buses

    async def refresh_roadworks(self) -> dict[str, Any]:
        mode = self.source_modes["roadworks"]
        if mode == "off":
            self.roadworks = self.roadworks_layer.payload([], False)
            self.roadworks["source"] = "off"
            self.source_status["roadworks"] = "off"
            return self.roadworks
        if mode == "simulated":
            self.roadworks = self._simulated_roadworks_payload()
            self.source_status["roadworks"] = "simulated"
            return self.roadworks
        self.source_status["roadworks"] = "loading"
        try:
            if self.lta_key:
                records: list[dict[str, Any]] = []
                skip = 0
                while True:
                    separator = "&" if "?" in self.config["roadworks_endpoint"] else "?"
                    payload = await asyncio.to_thread(
                        fetch_json,
                        f"{self.config['roadworks_endpoint']}{separator}$skip={skip}",
                        self.lta_key,
                        12.0,
                        True,
                    )
                    page = list(payload.get("value") or [])
                    records.extend(page)
                    if len(page) < 500:
                        break
                    skip += 500
                self.roadworks = self.roadworks_layer.payload(
                    records, False
                )
                self.source_status["roadworks"] = "live"
            else:
                raise RuntimeError("LTA DataMall key is not configured")
        except Exception:
            self.roadworks = self._simulated_roadworks_payload()
            self.source_status["roadworks"] = "simulated"
        return self.roadworks

    async def refresh_traffic_speed_bands(self) -> dict[str, Any]:
        mode = self.source_modes["traffic_speed_bands"]
        if mode != "live":
            self.traffic_speed_bands = (
                self.traffic_speed_bands_layer.empty_payload(mode)
            )
            self.source_status["traffic_speed_bands"] = mode
            return self.traffic_speed_bands
        self.source_status["traffic_speed_bands"] = "loading"
        try:
            if not self.lta_key:
                raise RuntimeError("LTA DataMall key is not configured")
            # The v4 feed contains well over 100,000 records. Loading every
            # 500-row page serially can take minutes and stalls the first live
            # traffic field. Evenly spaced pages give this ambient map broad
            # island coverage with a predictable request and processing cost.
            page_count = max(
                1,
                int(self.config.get("traffic_speed_bands_sample_pages", 24)),
            )
            stride = max(
                500,
                int(self.config.get("traffic_speed_bands_sample_stride", 5000)),
            )
            parallel_requests = max(
                1,
                min(
                    8,
                    int(
                        self.config.get(
                            "traffic_speed_bands_parallel_requests", 6
                        )
                    ),
                ),
            )
            endpoint = self.config["traffic_speed_bands_endpoint"]
            separator = "&" if "?" in endpoint else "?"
            offsets = [index * stride for index in range(page_count)]
            records: list[dict[str, Any]] = []
            last_updated = ""
            successful_pages = 0
            for start in range(0, len(offsets), parallel_requests):
                batch = offsets[start : start + parallel_requests]
                results = await asyncio.gather(
                    *(
                        asyncio.to_thread(
                            fetch_json,
                            f"{endpoint}{separator}$skip={skip}",
                            self.lta_key,
                            12.0,
                            True,
                        )
                        for skip in batch
                    ),
                    return_exceptions=True,
                )
                for payload in results:
                    if isinstance(payload, Exception):
                        continue
                    successful_pages += 1
                    records.extend(list(payload.get("value") or []))
                    last_updated = str(
                        payload.get("lastUpdatedTime") or last_updated
                    )
            if not successful_pages:
                raise RuntimeError("Traffic speed band sampling returned no pages")
            self.traffic_speed_bands = self.traffic_speed_bands_layer.payload(
                records, last_updated
            )
            self.traffic_speed_bands["source"] = "live"
            self.source_status["traffic_speed_bands"] = "live"
        except Exception:
            # An empty simulated band field drives the renderer's neutral
            # background-traffic pattern while the next live retry remains due.
            self.traffic_speed_bands = (
                self.traffic_speed_bands_layer.empty_payload("simulated")
            )
            self.source_status["traffic_speed_bands"] = "simulated"
        return self.traffic_speed_bands

    async def refresh_rainfall(self) -> dict[str, Any]:
        mode = self.source_modes["rainfall"]
        if mode == "off":
            self.rainfall = self.rainfall_layer.off_payload()
            self.source_status["rainfall"] = "off"
            return self.rainfall
        if mode == "simulated":
            self.rainfall = self._simulated_rain_payload()
            self.source_status["rainfall"] = "simulated"
            return self.rainfall
        self.source_status["rainfall"] = "loading"
        try:
            payload = await asyncio.to_thread(
                fetch_json, self.config["rainfall_endpoint"], self.api_key
            )
            self.rainfall = self.rainfall_layer.live_payload(payload)
            self.source_status["rainfall"] = "live"
        except Exception:
            self.rainfall = self._simulated_rain_payload()
            self.source_status["rainfall"] = "simulated"
        return self.rainfall

    async def refresh_wind(self) -> dict[str, Any]:
        rainfall_mode = self.source_modes.get("rainfall")
        if rainfall_mode == "off":
            self.source_status["wind_direction"] = "inactive"
            self.source_status["wind_speed"] = "inactive"
            return self.wind
        if rainfall_mode == "simulated":
            self.wind = self.wind_layer.fallback_payload()
            self.source_status["wind_direction"] = "simulated"
            self.source_status["wind_speed"] = "simulated"
            return self.wind
        self.source_status["wind_direction"] = "loading"
        self.source_status["wind_speed"] = "loading"
        try:
            direction_payload, speed_payload = await asyncio.gather(
                asyncio.to_thread(
                    fetch_json,
                    self.config["wind_direction_endpoint"],
                    self.api_key,
                ),
                asyncio.to_thread(
                    fetch_json,
                    self.config["wind_speed_endpoint"],
                    self.api_key,
                ),
            )
            self.wind = self.wind_layer.live_payload(
                direction_payload,
                speed_payload,
            )
            self.source_status["wind_direction"] = "live"
            self.source_status["wind_speed"] = "live"
        except Exception:
            self.wind = self.wind_layer.fallback_payload()
            self.source_status["wind_direction"] = "simulated"
            self.source_status["wind_speed"] = "simulated"
        return self.wind

    async def refresh_lightning(self) -> list[dict[str, Any]]:
        mode = self.source_modes["lightning"]
        if mode == "off":
            self.lightning = []
            self.source_status["lightning"] = "off"
            return []
        if mode == "simulated":
            self.source_status["lightning"] = "simulated"
            return []
        fresh = []
        self.source_status["lightning"] = "loading"
        try:
            payload = await asyncio.to_thread(
                fetch_json, self.config["lightning_endpoint"], self.api_key
            )
            fresh = self.lightning_layer.live_events(payload)
            self.source_status["lightning"] = "live"
        except Exception:
            self.source_status["lightning"] = "simulated"
        if fresh:
            self.lightning = (fresh + self.lightning)[:40]
        return fresh

    def simulated_lightning(self, now: float | None = None) -> dict[str, Any] | None:
        current = time.monotonic() if now is None else now
        if current < self.next_simulated_lightning:
            return None
        self.next_simulated_lightning = current + self.random.uniform(
            self.config["simulated_lightning_min_seconds"],
            self.config["simulated_lightning_max_seconds"],
        )
        event = self.lightning_layer.simulated_event()
        self.lightning = ([event] + self.lightning)[:40]
        return event

    async def set_source_mode(self, source: str, mode: str) -> dict[str, Any]:
        if source not in {
            "buses",
            "rainfall",
            "lightning",
            "roadworks",
            "traffic_speed_bands",
        }:
            raise ValueError(f"Unknown source: {source}")
        if mode not in {"live", "simulated", "off"}:
            raise ValueError(f"Unknown source mode: {mode}")
        self.source_modes[source] = cast(SourceMode, mode)
        if mode == "live":
            self.mark_api_call(source)
        if source == "buses":
            await self.refresh_buses()
        elif source == "rainfall":
            await self.refresh_rainfall()
            await self.refresh_wind()
        elif source == "lightning":
            self.lightning = []
            await self.refresh_lightning()
        elif source == "roadworks":
            await self.refresh_roadworks()
        elif source == "traffic_speed_bands":
            await self.refresh_traffic_speed_bands()
        return self.snapshot()

    def set_incident_mode(self, mode: str) -> None:
        """Mirror the road-state incident mode into the city-data source contract."""
        if mode not in {"live", "simulated", "off"}:
            raise ValueError(f"Unknown source mode: {mode}")
        source_mode = cast(SourceMode, mode)
        self.source_modes["incidents"] = source_mode
        self.source_status["incidents"] = source_mode

    def snapshot(self) -> dict[str, Any]:
        return {
            "buses": self.buses,
            "rainfall": self.rainfall,
            "wind": self.wind,
            "lightning": self.lightning,
            "roadworks": self.roadworks,
            "traffic_speed_bands": self.traffic_speed_bands,
            "api_calls": {
                source: {
                    **details,
                    "active": (
                        self.source_modes.get("rainfall") == "live"
                        if source in {"wind_direction", "wind_speed"}
                        else self.source_modes.get(source) == "live"
                    ),
                }
                for source, details in self.api_calls.items()
            },
            "source_status": self.source_status,
            "source_modes": self.source_modes,
        }
