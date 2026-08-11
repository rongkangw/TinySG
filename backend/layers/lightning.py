"""Live parsing and simulation payloads for lightning events."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

Projector = Callable[[float, float], list[float] | None]
PointFactory = Callable[[], list[float]]


class LightningLayer:
    def __init__(
        self,
        random_source: random.Random,
        project: Projector,
        point_factory: PointFactory,
    ) -> None:
        self.random = random_source
        self.project = project
        self.point_factory = point_factory
        self.seen: set[str] = set()

    def live_events(self, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        fresh = []
        records = (payload.get("data") or {}).get("records") or []
        for record in records[-3:]:
            for reading in (record.get("item") or {}).get("readings") or []:
                location = reading.get("location") or {}
                point = self.project(
                    float(location["longitude"]),
                    float(location["latitude"]),
                )
                if point is None:
                    continue
                identifier = "|".join(
                    [
                        str(reading.get("datetime") or record.get("datetime")),
                        str(location.get("longitude")),
                        str(location.get("latitude")),
                        str(reading.get("type")),
                    ]
                )
                if identifier in self.seen:
                    continue
                self.seen.add(identifier)
                fresh.append(
                    {
                        "id": uuid.uuid4().hex[:12],
                        "x": point[0],
                        "y": point[1],
                        "kind": reading.get("type") or "G",
                        "text": reading.get("text") or "Lightning",
                        "timestamp": reading.get("datetime")
                        or record.get("datetime")
                        or datetime.now(timezone.utc).isoformat(),
                        "simulated": False,
                    }
                )
        return fresh

    def simulated_event(self) -> dict[str, Any]:
        point = self.point_factory()
        return {
            "id": uuid.uuid4().hex[:12],
            "x": point[0],
            "y": point[1],
            "kind": self.random.choice(["C", "G"]),
            "text": "Tiny simulated lightning",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "simulated": True,
        }
