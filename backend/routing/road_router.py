"""Topology-aware routing for buses and other road-bound vehicles."""

from __future__ import annotations

import heapq
import math
from collections import defaultdict

from .models import EdgeHit, EdgePath, EdgePathStep
from .road_network import RoadNetworkIndex


class RoadRouter:
    """Build ordered pixel routes between mapped road hits."""

    def __init__(self, network: RoadNetworkIndex) -> None:
        self.network = network
        self.path_cache: dict[tuple[int, int], EdgePath | None] = {}

    def edge_path(self, start_edge_id: int, end_edge_id: int) -> EdgePath | None:
        cache_key = (start_edge_id, end_edge_id)
        if cache_key in self.path_cache:
            return self.path_cache[cache_key]

        start_edge = self.network.road_edges.get(start_edge_id)
        end_edge = self.network.road_edges.get(end_edge_id)
        start_nodes = (start_edge or {}).get("node_ids") or []
        end_nodes = (end_edge or {}).get("node_ids") or []
        if len(start_nodes) < 2 or len(end_nodes) < 2:
            self.path_cache[cache_key] = None
            return None

        goals = {int(node_id) for node_id in end_nodes}
        target_coordinates = [
            self.network.node_coordinates[node_id]
            for node_id in goals
            if node_id in self.network.node_coordinates
        ]
        if not target_coordinates:
            self.path_cache[cache_key] = None
            return None

        def heuristic(node_id: int) -> float:
            coordinate = self.network.node_coordinates.get(node_id)
            if coordinate is None:
                return 0.0
            longitude, latitude = coordinate
            return min(
                math.hypot(longitude - target[0], latitude - target[1])
                for target in target_coordinates
            )

        distances: dict[int, float] = {}
        parents: dict[int, tuple[int, int]] = {}
        queue: list[tuple[float, float, int]] = []
        for node_id in {int(node_id) for node_id in start_nodes}:
            if node_id not in self.network.node_coordinates:
                continue
            distances[node_id] = 0.0
            heapq.heappush(queue, (heuristic(node_id), 0.0, node_id))

        goal: int | None = None
        expanded = 0
        while queue and expanded < 12_000:
            _priority, distance, node_id = heapq.heappop(queue)
            if distance != distances.get(node_id):
                continue
            if node_id in goals:
                goal = node_id
                break
            expanded += 1
            for link in self.network.node_links.get(node_id, ()):
                candidate = distance + link.cost
                if candidate >= distances.get(link.neighbour, float("inf")):
                    continue
                distances[link.neighbour] = candidate
                parents[link.neighbour] = (node_id, link.edge_id)
                heapq.heappush(
                    queue,
                    (
                        candidate + heuristic(link.neighbour),
                        candidate,
                        link.neighbour,
                    ),
                )

        if goal is None:
            self.path_cache[cache_key] = None
            return None

        steps: list[EdgePathStep] = []
        current = goal
        while current in parents:
            previous, edge_id = parents[current]
            steps.append((previous, current, edge_id))
            current = previous
        result = EdgePath(current, goal, tuple(reversed(steps)))
        self.path_cache[cache_key] = result
        return result

    def pixel_route_between_hits(
        self,
        start: EdgeHit,
        end: EdgeHit,
    ) -> list[list[int]]:
        start_id, start_phase = start
        end_id, end_phase = end
        start_pixels = self.network.road_pixels.get(start_id, ())
        end_pixels = self.network.road_pixels.get(end_id, ())
        if not start_pixels or not end_pixels:
            return []

        start_index = round(start_phase * (len(start_pixels) - 1))
        end_index = round(end_phase * (len(end_pixels) - 1))
        if start_id == end_id:
            if start_index <= end_index:
                pixels = start_pixels[start_index : end_index + 1]
            else:
                pixels = tuple(reversed(start_pixels[end_index : start_index + 1]))
            return [list(pixel) for pixel in pixels]

        path = self.edge_path(start_id, end_id)
        if path is None:
            return [list(pixel) for pixel in start_pixels[start_index:]]

        start_nodes = self.network.road_edges[start_id].get("node_ids") or []
        if path.start_node == start_nodes[0]:
            route = [
                list(pixel)
                for pixel in reversed(start_pixels[: start_index + 1])
            ]
        else:
            route = [list(pixel) for pixel in start_pixels[start_index:]]

        current_node = path.start_node
        for left, right, edge_id in path.steps:
            pixels = self.network.road_pixels.get(edge_id, ())
            nodes = self.network.road_edges[edge_id].get("node_ids") or []
            if not pixels or len(nodes) < 2:
                continue
            oriented = pixels if nodes[0] == left else tuple(reversed(pixels))
            route.extend(
                [list(pixel) for pixel in oriented[1:]]
                if route and route[-1] == list(oriented[0])
                else [list(pixel) for pixel in oriented]
            )
            current_node = right

        end_nodes = self.network.road_edges[end_id].get("node_ids") or []
        tail = (
            end_pixels[: end_index + 1]
            if current_node == end_nodes[0]
            else tuple(reversed(end_pixels[end_index:]))
        )
        route.extend(
            [list(pixel) for pixel in tail[1:]]
            if route and tail and route[-1] == list(tail[0])
            else [list(pixel) for pixel in tail]
        )
        return route

    def build_topology_routes(self, count: int) -> list[list[list[int]]]:
        """Build deterministic, connected routes for ambient road vehicles."""
        if count <= 0:
            return []

        node_edges: dict[int, list[int]] = defaultdict(list)
        by_class: dict[str, list[int]] = defaultdict(list)
        for edge in self.network.road_edges.values():
            edge_id = int(edge["id"])
            if len(self.network.road_pixels.get(edge_id, ())) < 2:
                continue
            by_class[str(edge.get("highway_class", "service"))].append(edge_id)
            for node_id in set(edge.get("node_ids") or []):
                node_edges[int(node_id)].append(edge_id)

        classes = sorted(by_class)
        if not classes:
            return []

        routes: list[list[list[int]]] = []
        for route_index in range(count):
            road_class = classes[route_index % len(classes)]
            candidates = by_class[road_class]
            start_id = candidates[(route_index * 977 + 37) % len(candidates)]
            start_edge = self.network.road_edges[start_id]
            nodes = start_edge.get("node_ids") or []
            forward = route_index % 2 == 0
            pixels = [
                [int(pixel[0]), int(pixel[1])]
                for pixel in self.network.road_pixels[start_id]
            ]
            route = pixels if forward else list(reversed(pixels))
            if len(nodes) < 2 or nodes[0] == nodes[-1]:
                routes.append(route)
                continue

            current_node = int(nodes[-1] if forward else nodes[0])
            previous_id = start_id
            visited = {start_id}
            target_length = 110 + route_index % 150
            while len(route) < target_length:
                next_edges = [
                    edge_id
                    for edge_id in node_edges.get(current_node, [])
                    if edge_id != previous_id and edge_id not in visited
                ]
                same_class = [
                    edge_id
                    for edge_id in next_edges
                    if self.network.road_edges[edge_id].get("highway_class")
                    == road_class
                ]
                if same_class:
                    next_edges = same_class
                if not next_edges:
                    break
                next_edges.sort()
                next_id = next_edges[
                    (route_index * 31 + len(visited) * 17) % len(next_edges)
                ]
                next_edge = self.network.road_edges[next_id]
                next_nodes = next_edge.get("node_ids") or []
                next_pixels = [
                    [int(pixel[0]), int(pixel[1])]
                    for pixel in self.network.road_pixels.get(next_id, ())
                ]
                if len(next_nodes) < 2 or not next_pixels:
                    break
                if next_nodes[0] == current_node and next_nodes[-1] != current_node:
                    oriented = next_pixels
                    next_node = int(next_nodes[-1])
                elif (
                    next_nodes[-1] == current_node
                    and next_nodes[0] != current_node
                ):
                    oriented = list(reversed(next_pixels))
                    next_node = int(next_nodes[0])
                else:
                    break
                route.extend(
                    oriented[1:] if route[-1] == oriented[0] else oriented
                )
                visited.add(next_id)
                previous_id = next_id
                current_node = next_node
            if len(route) >= 2:
                routes.append(route)
        return routes
