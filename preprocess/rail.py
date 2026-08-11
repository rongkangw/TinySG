"""Build a compact octilinear pixel overlay for Singapore rail lines and stations."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from .map_layout import route_octilinear
from .preview import Canvas
from .projection import create_world_projector
from .rasterize import bresenham
from .simplify import douglas_peucker


FALLBACK_COLOURS = {
    "EWL": "#009645",
    "NSL": "#DC241F",
    "NEL": "#9016B2",
    "CCL": "#FA9E0D",
    "DTL": "#0354A6",
    "TEL": "#9D5B25",
    "JRL": "#0099AA",
    "SKLRT": "#A8C6BD",
    "BPLRT": "#A8C6BD",
    "PGLRT": "#A8C6BD",
}

PREFIX_LINES = {
    "NS": "NSL",
    "EW": "EWL",
    "CG": "EWL",
    "NE": "NEL",
    "CC": "CCL",
    "CE": "CCL",
    "DT": "DTL",
    "TE": "TEL",
    "JS": "JRL",
    "JE": "JRL",
    "JW": "JRL",
    "BP": "BPLRT",
    "SE": "SKLRT",
    "SW": "SKLRT",
    "PE": "PGLRT",
    "PW": "PGLRT",
}


def _geometry_paths(geometry: dict[str, Any]) -> list[list[list[float]]]:
    if geometry.get("type") == "LineString":
        return [geometry.get("coordinates") or []]
    if geometry.get("type") == "MultiLineString":
        return list(geometry.get("coordinates") or [])
    return []


def _coordinate_count(feature: dict[str, Any]) -> int:
    return sum(
        len(path) for path in _geometry_paths(feature.get("geometry") or {})
    )


def _canonical_route_features(
    reference: str, features: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Keep one physical centerline for reciprocal service relations."""
    if reference == "CCL":
        loops = [
            feature
            for feature in features
            if str((feature.get("properties") or {}).get("from") or "").casefold()
            == str((feature.get("properties") or {}).get("to") or "").casefold()
        ]
        extensions = [
            feature
            for feature in features
            if "prince edward"
            in (
                str((feature.get("properties") or {}).get("from") or "")
                + " "
                + str((feature.get("properties") or {}).get("to") or "")
            ).casefold()
        ]
        selected = []
        if loops:
            selected.append(max(loops, key=_coordinate_count))
        if extensions:
            selected.append(max(extensions, key=_coordinate_count))
        return selected or [max(features, key=_coordinate_count)]

    grouped: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        properties = feature.get("properties") or {}
        origin = str(properties.get("from") or "").strip().casefold()
        destination = str(properties.get("to") or "").strip().casefold()
        if origin and destination:
            key = ("endpoints", *sorted((origin, destination)))
        else:
            name = str(properties.get("name") or reference).casefold()
            if "east loop" in name:
                key = ("loop", "east")
            elif "west loop" in name:
                key = ("loop", "west")
            else:
                key = (
                    "name",
                    re.sub(r"\b(clockwise|anticlockwise)\b|[↺↻]", "", name),
                )
        grouped[key].append(feature)
    return [
        max(group, key=_coordinate_count)
        for _key, group in sorted(grouped.items())
    ]


def _station_lines(reference: str, network: str = "") -> list[str]:
    result = []
    for token in re.split(r"[;/,\s]+", reference.upper()):
        match = re.match(r"([A-Z]+)", token)
        if not match:
            continue
        prefix = match.group(1)
        line = prefix if prefix in FALLBACK_COLOURS else PREFIX_LINES.get(prefix)
        if line and line not in result:
            result.append(line)
    network_text = network.upper()
    for line in FALLBACK_COLOURS:
        if (
            re.search(
                rf"(?<![A-Z0-9]){re.escape(line)}(?![A-Z0-9])",
                network_text,
            )
            and line not in result
        ):
            result.append(line)
    return result


def _hex_to_rgb(colour: str) -> tuple[int, int, int]:
    value = colour.lstrip("#")
    if len(value) != 6:
        return (130, 140, 150)
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def _split_simple_pixel_paths(
    pixels: list[tuple[int, int]],
) -> list[list[tuple[int, int]]]:
    """Split a raster route when it revisits a cell.

    Removing repeats from the complete list can join cells that were never
    neighbours in the source walk. Splitting at the repeated cell keeps every
    returned path unique and contiguous while preserving the combined cell set.
    """
    paths: list[list[tuple[int, int]]] = []
    current: list[tuple[int, int]] = []
    visited: set[tuple[int, int]] = set()
    for pixel in pixels:
        if pixel in visited:
            if len(current) >= 2:
                paths.append(current)
            current = [pixel]
            visited = {pixel}
            continue
        current.append(pixel)
        visited.add(pixel)
    if len(current) >= 2:
        paths.append(current)
    return paths


def build_rail_overlay(
    line_path: str | Path,
    station_path: str | Path,
    layout: dict[str, Any],
    resolution: int,
) -> dict[str, Any]:
    line_collection = json.loads(Path(line_path).read_text(encoding="utf-8"))
    station_collection = json.loads(Path(station_path).read_text(encoding="utf-8"))
    project = create_world_projector(
        layout["bounds"],
        float(layout.get("physical_aspect_ratio", 50 / 27)),
    )

    route_features: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in line_collection.get("features", []):
        properties = feature.get("properties") or {}
        reference = str(properties.get("ref") or "").strip().upper()
        if reference and _geometry_paths(feature.get("geometry") or {}):
            route_features[reference].append(feature)

    selected_features = [
        feature
        for reference, features in sorted(route_features.items())
        for feature in _canonical_route_features(reference, features)
    ]

    line_pixels: dict[str, set[tuple[int, int]]] = defaultdict(set)
    line_paths: dict[str, list[list[tuple[int, int]]]] = defaultdict(list)
    line_meta: dict[str, dict[str, Any]] = {}
    for feature in selected_features:
        geometry = feature.get("geometry") or {}
        paths = _geometry_paths(geometry)
        if not paths:
            continue
        properties = feature.get("properties") or {}
        reference = str(properties.get("ref") or "").strip().upper()
        if not reference:
            continue
        route_type = properties.get("route") or "subway"
        colour = str(
            FALLBACK_COLOURS.get(reference, "#A8C6BD")
            if route_type == "light_rail"
            else properties.get("colour")
            or FALLBACK_COLOURS.get(reference, "#8A8D8F")
        )
        line_meta[reference] = {
            "ref": reference,
            "name": re.sub(r"\s*\([^)]*\)\s*$", "", str(properties.get("name") or reference)),
            "colour": colour.upper(),
            "future": reference == "JRL",
            "route": route_type,
        }
        for raw_path in paths:
            coordinates = [
                [float(point[0]), float(point[1])]
                for point in raw_path
                if len(point) >= 2
            ]
            if len(coordinates) < 2:
                continue
            simplified = douglas_peucker(coordinates, 0.00012)
            projected = [project(longitude, latitude) for longitude, latitude in simplified]
            routed: list[list[float]] = [projected[0]]
            for start, end in zip(projected, projected[1:]):
                routed.extend(route_octilinear(start, end)[1:])
            grid = [
                (
                    max(0, min(resolution - 1, round(point[0] * (resolution - 1)))),
                    max(0, min(resolution - 1, round(point[1] * (resolution - 1)))),
                )
                for point in routed
            ]
            existing = line_pixels[reference]
            if existing:
                snapped = []
                for x, y in grid:
                    nearby = [
                        (x + dx, y + dy)
                        for dy in range(-2, 3)
                        for dx in range(-2, 3)
                        if (x + dx, y + dy) in existing
                    ]
                    snapped.append(
                        min(
                            nearby,
                            key=lambda point: (point[0] - x) ** 2
                            + (point[1] - y) ** 2,
                        )
                        if nearby
                        else (x, y)
                    )
                grid = snapped
            path_pixels: list[tuple[int, int]] = []
            for start, end in zip(grid, grid[1:]):
                segment = bresenham(start, end)
                path_pixels.extend(segment if not path_pixels else segment[1:])
            line_pixels[reference].update(path_pixels)
            line_paths[reference].extend(_split_simple_pixel_paths(path_pixels))

    lines = []
    for reference, metadata in sorted(line_meta.items()):
        pixels = sorted(line_pixels[reference], key=lambda point: (point[1], point[0]))
        paths = sorted(line_paths[reference], key=len, reverse=True)
        lines.append(
            {
                **metadata,
                "pixels": [list(point) for point in pixels],
                "paths": [
                    [list(point) for point in path]
                    for path in paths
                ],
            }
        )

    station_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in station_collection.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            continue
        properties = feature.get("properties") or {}
        name = str(properties.get("name:en") or properties.get("name") or "Station").strip()
        station_groups[name.casefold()].append(
            {
                "name": name,
                "longitude": float(coordinates[0]),
                "latitude": float(coordinates[1]),
                "ref": str(properties.get("ref") or ""),
                "ref_colour": str(properties.get("ref:colour") or ""),
                "network": str(properties.get("network") or ""),
                "station": str(properties.get("station") or ""),
            }
        )

    available = {line["ref"] for line in lines}
    line_pixel_lists = {
        reference: list(pixels) for reference, pixels in line_pixels.items()
    }
    stations = []
    for records in station_groups.values():
        name = records[0]["name"]
        longitude = sum(record["longitude"] for record in records) / len(records)
        latitude = sum(record["latitude"] for record in records) / len(records)
        projected = project(longitude, latitude)
        raw_pixel = (
            round(projected[0] * (resolution - 1)),
            round(projected[1] * (resolution - 1)),
        )
        references = ";".join(record["ref"] for record in records if record["ref"])
        networks = ";".join(
            record["network"] for record in records if record["network"]
        )
        station_lines = _station_lines(references, networks)

        if not station_lines:
            nearest_ref = None
            nearest_distance = float("inf")
            for reference, pixels in line_pixel_lists.items():
                if not pixels:
                    continue
                pixel = min(
                    pixels,
                    key=lambda point: (point[0] - raw_pixel[0]) ** 2
                    + (point[1] - raw_pixel[1]) ** 2,
                )
                distance = math.hypot(pixel[0] - raw_pixel[0], pixel[1] - raw_pixel[1])
                if distance < nearest_distance:
                    nearest_ref, nearest_distance = reference, distance
            if nearest_ref and nearest_distance <= 5:
                station_lines = [nearest_ref]

        matched_lines = [reference for reference in station_lines if reference in available]
        if len(matched_lines) == 1 and line_pixel_lists.get(matched_lines[0]):
            pixels = line_pixel_lists[matched_lines[0]]
            pixel = min(
                pixels,
                key=lambda point: (point[0] - raw_pixel[0]) ** 2
                + (point[1] - raw_pixel[1]) ** 2,
            )
        else:
            pixel = raw_pixel

        supplied_colours = [
            colour.strip().upper()
            for record in records
            for colour in record["ref_colour"].split(";")
            if colour.strip()
        ]
        colours = [
            str(line_meta.get(reference, {}).get("colour") or FALLBACK_COLOURS.get(reference, "#8A8D8F")).upper()
            for reference in station_lines
        ]
        if not station_lines and supplied_colours:
            colours = supplied_colours
        if not colours:
            colours = ["#747B84"]
        stations.append(
            {
                "id": re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-"),
                "name": name,
                "ref": references,
                "lines": station_lines,
                "colours": list(dict.fromkeys(colours)),
                "pixel": [int(pixel[0]), int(pixel[1])],
                "lrt": any(record["station"] == "light_rail" for record in records),
                "matched": bool(matched_lines),
            }
        )

    return {
        "schema_version": 1,
        "resolution": resolution,
        "lines": lines,
        "stations": sorted(stations, key=lambda station: station["name"]),
    }


def draw_rail_preview(path: str | Path, rail: dict[str, Any], scale: int = 2) -> None:
    resolution = int(rail["resolution"])
    canvas = Canvas(resolution * scale, resolution * scale)
    lines = sorted(
        rail["lines"],
        key=lambda line: (
            0
            if line.get("future")
            else 1
            if line.get("route") == "light_rail"
            else 2,
            str(line.get("ref") or ""),
        ),
    )
    for line in lines:
        colour = _hex_to_rgb(line["colour"])
        if line.get("future"):
            colour = tuple(round(channel * 0.58) for channel in colour)
        for x, y in line["pixels"]:
            canvas.put(x * scale, y * scale, colour, max(0, scale // 2))
    for station in rail["stations"]:
        x, y = station["pixel"]
        canvas.put(
            x * scale,
            y * scale,
            _hex_to_rgb(station["colours"][0]),
            max(1, scale),
        )
    canvas.save(path)
