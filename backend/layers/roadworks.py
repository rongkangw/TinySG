"""Roadworks record matching and simulated payload construction."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from .road_names import road_key


class RoadworksLayer:
    def __init__(
        self,
        graph: Mapping[str, Any],
        pixel_edges: Mapping[int, Sequence[Sequence[int]]],
        random_source: random.Random,
    ) -> None:
        self.graph = graph
        self.pixel_edges = pixel_edges
        self.random = random_source
        self.road_edges: dict[str, list[dict[str, Any]]] = {}
        for edge in graph.get("edges", []):
            self.road_edges.setdefault(
                road_key(str(edge["road"])),
                [],
            ).append(edge)

    def payload(
        self,
        records: list[dict[str, Any]],
        simulated: bool,
    ) -> dict[str, Any]:
        works = []
        occurrence: dict[str, int] = {}
        for record in records:
            key = road_key(str(record.get("RoadName") or ""))
            edges = self.road_edges.get(key) or []
            if not edges:
                continue
            offset = occurrence.get(key, 0)
            occurrence[key] = offset + 1
            edge = edges[offset % len(edges)]
            works.append(
                {
                    "id": str(record.get("EventID") or uuid.uuid4().hex[:12]),
                    "edge_id": edge["id"],
                    "road": edge["road"],
                    "phase": ((offset * 0.381966) + 0.31) % 1,
                    "pixels": self.pixel_edges.get(edge["id"], []),
                    "highway_class": edge.get("highway_class", "primary"),
                    "start_date": record.get("StartDate"),
                    "end_date": record.get("EndDate"),
                    "department": record.get("SvcDept") or "",
                    "message": record.get("Other") or "",
                    "simulated": simulated,
                }
            )
        return {
            "works": works,
            "count": len(works),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "simulated": simulated,
            "source": "simulated" if simulated else "live",
        }

    def simulated_payload(self, count: int) -> dict[str, Any]:
        records = []
        edges = self.graph.get("edges", [])
        for index in range(count):
            edge = self.random.choice(edges)
            duration_days = self.random.uniform(2.0, 12.0)
            progress = self.random.uniform(0.08, 0.82)
            now = datetime.now(timezone.utc)
            start = now - timedelta(days=duration_days * progress)
            end = start + timedelta(days=duration_days)
            records.append(
                {
                    "EventID": f"SIM-WORK-{index}",
                    "RoadName": edge["road"],
                    "StartDate": start.isoformat(),
                    "EndDate": end.isoformat(),
                    "SvcDept": "Tiny Works Department",
                    "Other": "Simulated maintenance",
                }
            )
        return self.payload(records, True)
