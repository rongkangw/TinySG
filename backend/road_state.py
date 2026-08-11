"""Incident state, simulation, propagation, and delta generation."""

from __future__ import annotations

import json
import random
import time
import uuid
from collections import defaultdict, deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .routing import IncidentMapper, RoadNetworkIndex, RoadRouter


DURATION_RANGES = {
    "roadwork": (2 * 60 * 60, 3 * 60 * 60),
    "crash": (60 * 60, 2 * 60 * 60),
    "accident": (60 * 60, 2 * 60 * 60),
    "vehicle breakdown": (20 * 60, 45 * 60),
    "breakdown": (20 * 60, 45 * 60),
    "obstacle": (10 * 60, 25 * 60),
    "heavy traffic": (5 * 60, 15 * 60),
}


@dataclass
class Incident:
    id: str
    edge_id: int
    road: str
    incident_type: str
    message: str
    timestamp: str
    lifetime_seconds: float
    age_seconds: float = 0.0
    phase: float = 0.5
    simulated: bool = False

    def public(self) -> dict[str, Any]:
        data = asdict(self)
        data["remaining_intensity"] = self.intensity
        return data

    @property
    def intensity(self) -> float:
        if self.lifetime_seconds <= 0:
            return 0.0
        return max(0.0, 1.0 - self.age_seconds / self.lifetime_seconds)


class RoadStateEngine:
    def __init__(
        self,
        output_dir: str | Path = "output",
        config_path: str | Path = "config/dashboard.json",
        incident_path: str | Path = "data/TrafficIncidents.json",
        seed: int | None = None,
    ):
        self.output_dir = Path(output_dir)
        self.incident_path = Path(incident_path)
        self.config = json.loads(Path(config_path).read_text(encoding="utf-8"))
        self.road_graph = json.loads(
            (self.output_dir / "road_graph.json").read_text(encoding="utf-8")
        )
        self.map_layout = json.loads(
            (self.output_dir / "map_layout.json").read_text(encoding="utf-8")
        )
        road_pixels = json.loads(
            (self.output_dir / "road_pixels.json").read_text(encoding="utf-8")
        )
        self.rail = json.loads(
            (self.output_dir / "rail_pixels.json").read_text(encoding="utf-8")
        )
        self.environment_overlay = json.loads(
            (self.output_dir / "environment_pixels.json").read_text(encoding="utf-8")
        )
        self.resolution = road_pixels["resolution"]
        self.road_pixels = {
            edge["edge_id"]: edge["pixels"] for edge in road_pixels["edges"]
        }
        self.edges = {edge["id"]: edge for edge in self.road_graph["edges"]}
        self.road_network = RoadNetworkIndex(
            self.road_graph,
            self.map_layout,
            self.road_pixels,
        )
        self.road_router = RoadRouter(self.road_network)
        self._network_payload = self._build_network_payload()
        self.mapper = IncidentMapper(self.road_graph)
        self.random = random.Random(seed)
        self.events: dict[str, Incident] = {}
        self.recent: deque[dict[str, Any]] = deque(maxlen=100)
        self.pending_events: list[dict[str, Any]] = []
        self.last_road_state: dict[int, float] = {}
        self.current_road_state: dict[int, dict[str, Any]] = {}
        self.paused = False
        self.time_scale = 1.0
        self.spawn_clock = 0.0
        self._build_neighbours()
        incident_mode = str(
            self.config.get("city_data", {})
            .get("source_modes", {})
            .get("incidents", "live")
        )
        self.set_incident_mode(incident_mode)

    def _build_neighbours(self) -> None:
        node_edges: dict[int, set[int]] = defaultdict(set)
        for edge in self.road_graph["edges"]:
            for node_id in edge["node_ids"]:
                node_edges[node_id].add(edge["id"])
        self.neighbours = {}
        for edge in self.road_graph["edges"]:
            adjacent: set[int] = set()
            for node_id in edge["node_ids"]:
                adjacent.update(node_edges[node_id])
            adjacent.discard(edge["id"])
            road_class = edge.get("highway_class")
            self.neighbours[edge["id"]] = {
                neighbour_id
                for neighbour_id in adjacent
                if self.edges[neighbour_id].get("highway_class") == road_class
            }

    @staticmethod
    def duration_range(incident_type: str) -> tuple[float, float]:
        normalized = incident_type.casefold()
        for label, duration in DURATION_RANGES.items():
            if label in normalized:
                return duration
        return (5 * 60, 10 * 60)

    def _load_live_incidents(self, path: str | Path) -> bool:
        incident_file = Path(path)
        if not incident_file.exists():
            return False
        try:
            payload = json.loads(incident_file.read_text(encoding="utf-8"))
            records = payload if isinstance(payload, list) else payload.get("value", [])
            for item in records:
                latitude = float(item["Latitude"])
                longitude = float(item["Longitude"])
                edge_id, phase = self._nearest_edge(longitude, latitude)
                self.add_incident(
                    edge_id=edge_id,
                    incident_type=item.get("Type") or "Incident",
                    message=item.get("Message") or "",
                    phase=phase,
                    simulated=False,
                    announce=False,
                )
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return False
        return True

    def _nearest_edge(self, longitude: float, latitude: float) -> tuple[int, float]:
        result = self.mapper.locate(latitude, longitude)
        samples = self.edges[result["edge_id"]]["sampled_coordinates"]
        phase = result["sample_index"] / max(1, len(samples) - 1)
        return result["edge_id"], phase

    def add_incident(
        self,
        edge_id: int,
        incident_type: str,
        message: str,
        phase: float,
        simulated: bool,
        announce: bool = True,
        lifetime_seconds: float | None = None,
    ) -> Incident:
        if lifetime_seconds is None:
            low, high = self.duration_range(incident_type)
            lifetime_seconds = self.random.uniform(low, high)
        incident = Incident(
            id=uuid.uuid4().hex[:12],
            edge_id=edge_id,
            road=self.edges[edge_id]["road"],
            incident_type=incident_type,
            message=message,
            timestamp=datetime.now(timezone.utc).isoformat(),
            lifetime_seconds=lifetime_seconds,
            phase=max(0.0, min(1.0, phase)),
            simulated=simulated,
        )
        self.events[incident.id] = incident
        public = incident.public()
        public["pixels"] = self.road_pixels.get(edge_id, [])
        public["highway_class"] = self.edges[edge_id].get("highway_class", "primary")
        self.recent.appendleft(public)
        if announce:
            self.pending_events.append(public)
        return incident

    def _weighted_edge(self) -> dict[str, Any]:
        weights = self.config["simulation"]["road_selection_weights"]
        candidates = self.road_graph["edges"]
        return self.random.choices(
            candidates,
            weights=[weights.get(edge.get("highway_class", "primary"), 1.0) for edge in candidates],
            k=1,
        )[0]

    def spawn_simulated(self) -> Incident | None:
        maximum = int(self.config["simulation"]["maximum_simulated_incidents"])
        current = sum(event.simulated for event in self.events.values())
        if current >= maximum:
            return None
        edge = self._weighted_edge()
        incident_type = self.random.choices(
            ["Crash", "Roadwork", "Vehicle breakdown", "Obstacle", "Heavy traffic"],
            weights=[32, 18, 24, 14, 12],
            k=1,
        )[0]
        phase = self.random.random()
        return self.add_incident(
            edge_id=edge["id"],
            incident_type=incident_type,
            message=f"Simulated {incident_type.lower()} on {edge['road']}",
            phase=phase,
            simulated=True,
        )

    def update(self, real_delta: float) -> dict[str, Any]:
        scaled_delta = 0.0 if self.paused else real_delta * self.time_scale
        simulation = self.config["simulation"]
        if simulation["enabled"] and scaled_delta:
            self.spawn_clock += scaled_delta
            interval = max(0.25, float(simulation["spawn_interval_seconds"]))
            spawned = 0
            while self.spawn_clock >= interval and spawned < 5:
                self.spawn_clock -= interval
                self.spawn_simulated()
                spawned += 1

        expired = []
        decay_multiplier = float(simulation["decay_multiplier"])
        for event_id, event in self.events.items():
            event.age_seconds += scaled_delta * (decay_multiplier if event.simulated else 1.0)
            if event.intensity <= 0.0:
                expired.append(event_id)
        for event_id in expired:
            del self.events[event_id]

        contributions: dict[int, float] = defaultdict(float)
        phases: dict[int, float] = {}
        kinds: dict[int, str] = {}
        propagation = float(
            self.config["animation"]["neighbour_propagation_strength"]
        )
        maximum = float(self.config["animation"]["maximum_intensity"])
        if simulation.get("display_enabled", True):
            for event in self.events.values():
                intensity = event.intensity
                contributions[event.edge_id] += intensity
                phases[event.edge_id] = event.phase
                kinds[event.edge_id] = event.incident_type
                for neighbour_id in self.neighbours[event.edge_id]:
                    contributions[neighbour_id] += intensity * propagation
                    phases.setdefault(neighbour_id, 0.5)
                    kinds.setdefault(neighbour_id, event.incident_type)

        current = {
            edge_id: {
                "edge_id": edge_id,
                "intensity": round(min(maximum, intensity), 4),
                "phase": round(phases.get(edge_id, 0.5), 4),
                "incident_type": kinds.get(edge_id, "Incident"),
                "pixels": self.road_pixels.get(edge_id, []),
                "highway_class": self.edges[edge_id].get(
                    "highway_class", "primary"
                ),
            }
            for edge_id, intensity in contributions.items()
            if intensity > 0.002
        }
        changes = [
            state
            for edge_id, state in current.items()
            if abs(state["intensity"] - self.last_road_state.get(edge_id, 0.0)) >= 0.004
        ]
        removed = [
            edge_id for edge_id in self.last_road_state if edge_id not in current
        ]
        self.current_road_state = current
        self.last_road_state = {
            edge_id: state["intensity"] for edge_id, state in current.items()
        }
        return {
            "changes": changes,
            "removed": removed,
            "expired_incidents": expired,
        }

    def apply_command(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        payload = message.get("payload") or {}
        if kind == "simulation_config":
            simulation = self.config["simulation"]
            for source, target in (
                ("enabled", "enabled"),
                ("spawn_interval", "spawn_interval_seconds"),
                ("decay_multiplier", "decay_multiplier"),
                ("maximum_incidents", "maximum_simulated_incidents"),
            ):
                if source in payload:
                    simulation[target] = payload[source]
            if "road_selection_weights" in payload:
                simulation["road_selection_weights"].update(
                    payload["road_selection_weights"]
                )
        elif kind == "time_control":
            if "paused" in payload:
                self.paused = bool(payload["paused"])
            if "speed" in payload:
                self.time_scale = max(0.1, min(20.0, float(payload["speed"])))

    def set_incident_mode(self, mode: str) -> None:
        if mode not in {"live", "simulated", "off"}:
            raise ValueError(f"Unknown incident mode: {mode}")
        self.config["simulation"]["enabled"] = mode == "simulated"
        self.config["simulation"]["display_enabled"] = mode != "off"
        self.events.clear()
        self.recent.clear()
        self.pending_events.clear()
        self.spawn_clock = 0.0
        if mode == "live":
            live_available = self._load_live_incidents(self.incident_path)
            self.config["simulation"]["enabled"] = not live_available

    def statistics(self) -> dict[str, Any]:
        intensities = [event.intensity for event in self.events.values()]
        lifetimes = [event.lifetime_seconds for event in self.events.values()]
        road_totals: dict[str, float] = defaultdict(float)
        for edge_id, state in self.current_road_state.items():
            road_totals[self.edges[edge_id]["road"]] += state["intensity"]
        return {
            "active_incidents": len(self.events),
            "simulated_incidents": sum(event.simulated for event in self.events.values()),
            "average_intensity": round(sum(intensities) / max(1, len(intensities)), 3),
            "average_lifetime_seconds": round(sum(lifetimes) / max(1, len(lifetimes))),
            "active_road_segments": len(self.current_road_state),
            "most_active_road": max(road_totals, key=road_totals.get) if road_totals else "—",
            "paused": self.paused,
            "time_scale": self.time_scale,
        }

    def _build_network_payload(self) -> dict[str, Any]:
        """Collapse static minor roads into class layers to keep startup light."""
        road_layers: dict[str, set[tuple[int, int]]] = defaultdict(set)
        interactive_classes = {
            "motorway",
            "motorway_link",
            "trunk",
            "trunk_link",
            "primary",
            "primary_link",
            "secondary",
            "secondary_link",
        }
        interactive_edges = []
        for edge in self.map_layout["edges"]:
            highway_class = edge.get("highway_class", "primary")
            pixels = self.road_pixels.get(edge["id"], [])
            road_layers[highway_class].update((pixel[0], pixel[1]) for pixel in pixels)
            if highway_class in interactive_classes:
                interactive_edges.append(
                    {
                        "id": edge["id"],
                        "road": edge["road"],
                        "highway_class": highway_class,
                        "points": edge["points"],
                        "pixels": pixels,
                    }
                )
        return {
            "resolution": self.resolution,
            "physical_aspect_ratio": self.map_layout.get(
                "physical_aspect_ratio", 50 / 27
            ),
            "land_polygon": self.map_layout.get("land_polygon", []),
            "rail": self.rail,
            "environment_overlay": self.environment_overlay,
            "road_layers": [
                {
                    "highway_class": highway_class,
                    "pixels": [list(pixel) for pixel in sorted(pixels)],
                }
                for highway_class, pixels in sorted(road_layers.items())
            ],
            "edges": interactive_edges,
            "traffic_routes": self._build_traffic_routes(),
        }

    def _build_traffic_routes(self, count: int = 1400) -> list[list[list[int]]]:
        """Build deterministic, topology-connected routes from ordered edge pixels."""
        return self.road_router.build_topology_routes(count)

    def network_payload(self) -> dict[str, Any]:
        return self._network_payload

    def state_payload(self) -> dict[str, Any]:
        return {
            "road_state": list(self.current_road_state.values()),
            "incidents": [
                incident for incident in self.recent if incident["id"] in self.events
            ],
            "statistics": self.statistics(),
            "config": self.config,
        }
