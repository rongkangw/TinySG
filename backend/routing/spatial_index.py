"""Balanced two-dimensional index for sampled road coordinates."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class SpatialHit:
    longitude: float
    latitude: float
    edge_id: int
    sample_index: int
    distance_degrees: float

    @property
    def distance_metres(self) -> float:
        # Adequate local conversion for Singapore; lookup remains in degrees.
        return self.distance_degrees * 111_320.0


class _Node:
    __slots__ = ("item", "axis", "left", "right")

    def __init__(self, item: tuple[float, float, int, int], axis: int):
        self.item, self.axis = item, axis
        self.left: _Node | None = None
        self.right: _Node | None = None


class KDTree:
    """Dependency-free, immutable nearest-neighbour index."""

    def __init__(self, points: list[tuple[float, float, int, int]]):
        if not points:
            raise ValueError("KDTree requires at least one point")
        self.root = self._build(points[:], depth=0)
        self.size = len(points)

    def _build(
        self,
        points: list[tuple[float, float, int, int]],
        depth: int,
    ) -> _Node | None:
        if not points:
            return None
        axis = depth % 2
        points.sort(key=lambda point: point[axis])
        middle = len(points) // 2
        node = _Node(points[middle], axis)
        node.left = self._build(points[:middle], depth + 1)
        node.right = self._build(points[middle + 1 :], depth + 1)
        return node

    def nearest(self, longitude: float, latitude: float) -> SpatialHit:
        target = (longitude, latitude)
        best_item = self.root.item
        best_squared = float("inf")

        def search(node: _Node | None) -> None:
            nonlocal best_item, best_squared
            if node is None:
                return
            dx = target[0] - node.item[0]
            dy = target[1] - node.item[1]
            squared = dx * dx + dy * dy
            if squared < best_squared:
                best_item, best_squared = node.item, squared
            difference = target[node.axis] - node.item[node.axis]
            near, far = (
                (node.left, node.right)
                if difference < 0
                else (node.right, node.left)
            )
            search(near)
            if difference * difference < best_squared:
                search(far)

        search(self.root)
        return SpatialHit(
            longitude=best_item[0],
            latitude=best_item[1],
            edge_id=best_item[2],
            sample_index=best_item[3],
            distance_degrees=math.sqrt(best_squared),
        )
