"""Traffic-speed-band matching and local/live payload construction."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Protocol

from .road_names import road_key

_ALIASES = {
    "PAN ISLAND EXPRESSWAY": "PIE",
    "AYER RAJAH EXPRESSWAY": "AYE",
    "EAST COAST PARKWAY": "ECP",
    "MARINA COASTAL EXPRESSWAY": "MCE",
    "CENTRAL EXPRESSWAY": "CTE",
    "KALLANG PAYA LEBAR EXPRESSWAY": "KPE",
    "TAMPINES EXPRESSWAY": "TPE",
    "BUKIT TIMAH EXPRESSWAY": "BKE",
    "KRANJI EXPRESSWAY": "KJE",
    "SELETAR EXPRESSWAY": "SLE",
}


class IncidentLocator(Protocol):
    edges: Mapping[int, Mapping[str, Any]]

    def locate(self, latitude: float, longitude: float) -> dict[str, Any]: ...


class TrafficSpeedBandsLayer:
    def __init__(self, mapper: IncidentLocator) -> None:
        self.mapper = mapper

    @staticmethod
    def empty_payload(source: str) -> dict[str, Any]:
        return {
            "bands": [],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "matched_edges": 0,
            "records_received": 0,
            "source": source,
        }

    def payload(
        self,
        records: list[dict[str, Any]],
        timestamp: str | None = None,
    ) -> dict[str, Any]:
        by_edge: dict[int, dict[str, Any]] = {}
        for record in records:
            try:
                latitude = (
                    float(record["StartLat"]) + float(record["EndLat"])
                ) / 2
                longitude = (
                    float(record["StartLon"]) + float(record["EndLon"])
                ) / 2
                speed_band = max(1, min(8, int(record["SpeedBand"])))
            except (KeyError, TypeError, ValueError):
                continue
            hit = self.mapper.locate(latitude, longitude)
            edge = self.mapper.edges[hit["edge_id"]]
            normalized_source = road_key(str(record.get("RoadName") or ""))
            source_name = _ALIASES.get(normalized_source, normalized_source)
            mapped_name = road_key(str(edge.get("road") or ""))
            if source_name != mapped_name and hit["distance_metres"] > 40:
                continue
            existing = by_edge.get(hit["edge_id"])
            if existing and int(existing["speed_band"]) <= speed_band:
                continue
            by_edge[hit["edge_id"]] = {
                "edge_id": hit["edge_id"],
                "road": edge["road"],
                "speed_band": speed_band,
                "minimum_speed": int(float(record.get("MinimumSpeed") or 0)),
                "maximum_speed": int(float(record.get("MaximumSpeed") or 0)),
            }
        return {
            "bands": list(by_edge.values()),
            "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
            "matched_edges": len(by_edge),
            "records_received": len(records),
            "source": "live",
        }
