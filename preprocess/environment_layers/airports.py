"""Build airport grounds, infrastructure, lights, and aircraft routes."""

from __future__ import annotations

import math
from collections import deque
from typing import Any

from ..rasterize import bresenham
from .common import Pixel, Projector, fill_geometry, line_pixels, spans


def _component_sort_key(component: set[Pixel]) -> tuple[int, int, int]:
    minimum_y = min(y for _, y in component)
    minimum_x = min(x for x, _ in component)
    return -len(component), minimum_y, minimum_x


def _connected_components(pixels: set[Pixel]) -> list[set[Pixel]]:
    remaining = set(pixels)
    components: list[set[Pixel]] = []
    while remaining:
        seed = min(remaining, key=lambda pixel: (pixel[1], pixel[0]))
        remaining.remove(seed)
        component = {seed}
        queue = deque([seed])
        while queue:
            x, y = queue.popleft()
            for offset_y in (-1, 0, 1):
                for offset_x in (-1, 0, 1):
                    if not offset_x and not offset_y:
                        continue
                    neighbour = (x + offset_x, y + offset_y)
                    if neighbour not in remaining:
                        continue
                    remaining.remove(neighbour)
                    component.add(neighbour)
                    queue.append(neighbour)
        components.append(component)
    return sorted(components, key=_component_sort_key)


def _centroid(pixels: set[Pixel]) -> Pixel:
    if not pixels:
        return (0, 0)
    return (
        round(sum(x for x, _ in pixels) / len(pixels)),
        round(sum(y for _, y in pixels) / len(pixels)),
    )


def _meaningful_airport_name(name: str) -> str:
    text = name.strip()
    lowered = text.casefold()
    if not text:
        return ""
    if "changi airport" in lowered:
        return "Singapore Changi Airport"
    if "seletar airport" in lowered:
        return "Seletar Airport"
    if "airfield" in lowered or "aerodrome" in lowered:
        return text
    if "airport" in lowered:
        return text.split(" Terminal", 1)[0].strip()
    return ""


def _slug(value: str, fallback: str) -> str:
    slug = []
    previous_dash = False
    for character in value.casefold():
        if character.isalnum():
            slug.append(character)
            previous_dash = False
        elif not previous_dash:
            slug.append("-")
            previous_dash = True
    result = "".join(slug).strip("-")
    return result or fallback


def _expanded(
    pixels: set[Pixel],
    radius: int,
    resolution: int,
) -> set[Pixel]:
    result: set[Pixel] = set()
    for x, y in pixels:
        for offset_y in range(-radius, radius + 1):
            for offset_x in range(-radius, radius + 1):
                if offset_x * offset_x + offset_y * offset_y > radius * radius + 1:
                    continue
                target = (x + offset_x, y + offset_y)
                if 0 <= target[0] < resolution and 0 <= target[1] < resolution:
                    result.add(target)
    return result


def _flight_path(runway: list[Pixel], resolution: int) -> list[list[int]]:
    if len(runway) < 2:
        return []
    start, end = runway[0], runway[-1]
    dx, dy = end[0] - start[0], end[1] - start[1]
    distance = max(1.0, math.hypot(dx, dy))
    unit_x, unit_y = dx / distance, dy / distance
    extension = round(resolution * 0.15)
    approach = (
        max(0, min(resolution - 1, round(start[0] - unit_x * extension))),
        max(0, min(resolution - 1, round(start[1] - unit_y * extension))),
    )
    departure = (
        max(0, min(resolution - 1, round(end[0] + unit_x * extension))),
        max(0, min(resolution - 1, round(end[1] + unit_y * extension))),
    )
    path = bresenham(approach, start)
    path.extend(runway[1:])
    path.extend(bresenham(end, departure)[1:])
    return [list(pixel) for pixel in dict.fromkeys(path)]


def _taxi_route(
    taxiways: set[Pixel],
    runway: list[Pixel],
    journey_index: int,
) -> tuple[list[Pixel], list[Pixel]]:
    """Return a connected taxi route and runway oriented for departure."""
    if not taxiways or len(runway) < 2:
        return [], runway
    endpoints = [runway[0], runway[-1]]
    connections = [
        min(
            taxiways,
            key=lambda point: (point[0] - endpoint[0]) ** 2
            + (point[1] - endpoint[1]) ** 2,
        )
        for endpoint in endpoints
    ]
    side = journey_index % 2
    connection = connections[side]
    oriented_runway = runway if side == 0 else list(reversed(runway))

    parents: dict[Pixel, Pixel | None] = {connection: None}
    distances = {connection: 0}
    queue = deque([connection])
    while queue:
        current = queue.popleft()
        for offset_y in (-1, 0, 1):
            for offset_x in (-1, 0, 1):
                if not offset_x and not offset_y:
                    continue
                neighbour = (current[0] + offset_x, current[1] + offset_y)
                if neighbour not in taxiways or neighbour in parents:
                    continue
                parents[neighbour] = current
                distances[neighbour] = distances[current] + 1
                queue.append(neighbour)

    target_distance = 35 + (journey_index * 19) % 75
    candidates = [
        point for point, distance in distances.items() if distance >= target_distance
    ]
    if not candidates:
        candidates = list(distances)
    start = min(
        candidates,
        key=lambda point: (
            abs(distances[point] - target_distance),
            (point[0] * 37 + point[1] * 61 + journey_index * 17) % 101,
        ),
    )
    taxi_path = [start]
    while taxi_path[-1] != connection:
        parent = parents[taxi_path[-1]]
        if parent is None:
            break
        taxi_path.append(parent)
    connector = bresenham(connection, oriented_runway[0])
    taxi_path.extend(connector[1:])
    return list(dict.fromkeys(taxi_path)), oriented_runway


def _departure_path(
    start: Pixel,
    runway_direction: tuple[float, float],
    journey_index: int,
    resolution: int,
) -> list[Pixel]:
    angle = math.atan2(runway_direction[1], runway_direction[0])
    angle += ((journey_index * 7) % 9 - 4) * 0.075
    direction_x, direction_y = math.cos(angle), math.sin(angle)
    distances = []
    if direction_x > 0:
        distances.append((resolution - 1 - start[0]) / direction_x)
    elif direction_x < 0:
        distances.append((0 - start[0]) / direction_x)
    if direction_y > 0:
        distances.append((resolution - 1 - start[1]) / direction_y)
    elif direction_y < 0:
        distances.append((0 - start[1]) / direction_y)
    boundary = min(distance for distance in distances if distance >= 0)
    distance = boundary + 24
    endpoint = (
        round(start[0] + direction_x * distance),
        round(start[1] + direction_y * distance),
    )
    return bresenham(start, endpoint)


def _runway_lights(
    runways: list[list[Pixel]],
    resolution: int,
) -> tuple[set[Pixel], set[Pixel]]:
    edge_lights: set[Pixel] = set()
    threshold_lights: set[Pixel] = set()
    for runway in runways:
        if len(runway) < 2:
            continue
        dx = runway[-1][0] - runway[0][0]
        dy = runway[-1][1] - runway[0][1]
        distance = max(1.0, math.hypot(dx, dy))
        offset_x = round(-dy / distance * 2)
        offset_y = round(dx / distance * 2)
        if offset_x == 0 and offset_y == 0:
            offset_y = 1
        for index in range(2, len(runway) - 2, 4):
            x, y = runway[index]
            for sign in (-1, 1):
                pixel = (x + offset_x * sign, y + offset_y * sign)
                if 0 <= pixel[0] < resolution and 0 <= pixel[1] < resolution:
                    edge_lights.add(pixel)
        for endpoint in (runway[0], runway[-1]):
            for offset in range(-2, 3):
                pixel = (
                    endpoint[0] + round(offset_x * offset / 2),
                    endpoint[1] + round(offset_y * offset / 2),
                )
                if 0 <= pixel[0] < resolution and 0 <= pixel[1] < resolution:
                    threshold_lights.add(pixel)
    return edge_lights, threshold_lights


def build_airport_layer(
    collection: dict[str, Any],
    project: Projector,
    resolution: int,
) -> dict[str, Any]:
    taxiways: set[Pixel] = set()
    runway_pixels: set[Pixel] = set()
    runways: list[list[Pixel]] = []
    terminals: set[Pixel] = set()
    aerodromes = []
    fragments: list[dict[str, Any]] = []
    for feature in collection.get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        aeroway = str(properties.get("aeroway") or "")
        feature_name = _meaningful_airport_name(str(properties.get("name") or ""))
        if aeroway in {"runway", "taxiway"} and geometry.get("type") == "LineString":
            path = line_pixels(
                geometry.get("coordinates") or [],
                project,
                resolution,
            )
            if aeroway == "runway":
                runway_pixels.update(path)
                if len(path) >= 2:
                    runways.append(path)
            else:
                taxiways.update(path)
            if path:
                fragments.append(
                    {
                        "name": feature_name,
                        "ref": str(properties.get("ref") or ""),
                        "aeroway": aeroway,
                        "pixels": set(path),
                    }
                )
        elif aeroway in {"terminal", "taxiway"}:
            filled = fill_geometry(geometry, project, resolution)
            terminals.update(filled)
            if filled:
                fragments.append(
                    {
                        "name": feature_name,
                        "ref": str(properties.get("ref") or ""),
                        "aeroway": aeroway,
                        "pixels": filled,
                    }
                )
        elif aeroway == "aerodrome" and geometry.get("type") == "Point":
            coordinates = geometry.get("coordinates") or []
            if len(coordinates) >= 2:
                x, y = project(float(coordinates[0]), float(coordinates[1]))
                pixel = (
                    round(x * (resolution - 1)),
                    round(y * (resolution - 1)),
                )
                aerodromes.append(
                    {
                        "name": str(properties.get("name") or "Airport"),
                        "ref": str(properties.get("ref") or ""),
                        "pixel": [pixel[0], pixel[1]],
                    }
                )
                fragments.append(
                    {
                        "name": _meaningful_airport_name(
                            str(properties.get("name") or "")
                        ),
                        "ref": str(properties.get("ref") or ""),
                        "aeroway": aeroway,
                        "pixels": {pixel},
                    }
                )

    grounds = _expanded(taxiways, 2, resolution)
    grounds.update(_expanded(runway_pixels, 4, resolution))
    grounds.update(terminals)
    flight_paths = [
        path
        for path in (_flight_path(runway, resolution) for runway in runways)
        if len(path) >= 20
    ]
    aircraft_journeys = []
    for journey_index, runway in enumerate(sorted(runways, key=len, reverse=True)):
        taxi_path, departure_runway = _taxi_route(
            taxiways,
            runway,
            journey_index,
        )
        if not taxi_path or len(departure_runway) < 2:
            continue
        direction = (
            departure_runway[-1][0] - departure_runway[0][0],
            departure_runway[-1][1] - departure_runway[0][1],
        )
        airborne = _departure_path(
            departure_runway[-1],
            direction,
            journey_index,
            resolution,
        )
        path = [*taxi_path, *departure_runway[1:], *airborne[1:]]
        aircraft_journeys.append(
            {
                "path": [list(pixel) for pixel in path],
                "taxi_end_index": len(taxi_path) - 1,
                "runway_end_index": len(taxi_path) + len(departure_runway) - 2,
            }
        )
    runway_lights, threshold_lights = _runway_lights(runways, resolution)
    area_buckets: dict[str, dict[str, Any]] = {}
    for area_index, component in enumerate(_connected_components(grounds)):
        names = []
        refs = []
        for fragment in fragments:
            if component.intersection(fragment["pixels"]):
                if fragment["name"]:
                    names.append(fragment["name"])
                if fragment["ref"]:
                    refs.append(fragment["ref"])
        if not names and aerodromes:
            centre = _centroid(component)
            nearest = min(
                aerodromes,
                key=lambda item: (
                    (item["pixel"][0] - centre[0]) ** 2
                    + (item["pixel"][1] - centre[1]) ** 2
                ),
            )
            if (
                (nearest["pixel"][0] - centre[0]) ** 2
                + (nearest["pixel"][1] - centre[1]) ** 2
            ) <= (resolution * 0.08) ** 2:
                names.append(str(nearest["name"]))
                refs.append(str(nearest["ref"]))
        name = sorted(set(names))[0] if names else f"Airport Area {area_index + 1}"
        bucket_key = name if names else f"airport-area-{area_index + 1}"
        bucket = area_buckets.setdefault(
            bucket_key,
            {"name": name, "refs": [], "pixels": set()},
        )
        bucket["refs"].extend(refs)
        bucket["pixels"].update(component)

    airport_areas = []
    used_area_ids: set[str] = set()
    ordered_buckets = sorted(
        area_buckets.values(),
        key=lambda bucket: _component_sort_key(bucket["pixels"]),
    )
    for area_index, bucket in enumerate(ordered_buckets):
        name = str(bucket["name"])
        ref = (
            sorted(set(filter(None, bucket["refs"])))[0]
            if bucket["refs"]
            else ""
        )
        component = bucket["pixels"]
        centre = _centroid(component)
        base_id = _slug(name, f"airport-{area_index + 1}")
        area_id = base_id
        suffix = 2
        while area_id in used_area_ids:
            area_id = f"{base_id}-{suffix}"
            suffix += 1
        used_area_ids.add(area_id)
        airport_areas.append(
            {
                "id": area_id,
                "name": name,
                "ref": ref,
                "pixel": [centre[0], centre[1]],
                "ground_spans": spans(component),
                "terminal_spans": spans(terminals.intersection(component)),
                "taxiway_pixels": [
                    list(pixel) for pixel in sorted(taxiways.intersection(component))
                ],
                "runway_pixels": [
                    list(pixel) for pixel in sorted(runway_pixels.intersection(component))
                ],
                "runway_light_pixels": [
                    list(pixel) for pixel in sorted(runway_lights.intersection(component))
                ],
                "runway_threshold_pixels": [
                    list(pixel)
                    for pixel in sorted(threshold_lights.intersection(component))
                ],
            }
        )
    return {
        "ground_spans": spans(grounds),
        "terminal_spans": spans(terminals),
        "taxiway_pixels": [list(pixel) for pixel in sorted(taxiways)],
        "runway_pixels": [list(pixel) for pixel in sorted(runway_pixels)],
        "runway_light_pixels": [list(pixel) for pixel in sorted(runway_lights)],
        "runway_threshold_pixels": [
            list(pixel) for pixel in sorted(threshold_lights)
        ],
        "flight_paths": sorted(flight_paths, key=len, reverse=True),
        "aircraft_journeys": aircraft_journeys,
        "aerodromes": aerodromes,
        "airport_areas": airport_areas,
    }
