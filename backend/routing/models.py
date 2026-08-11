"""Small immutable value objects shared by vehicle route planners."""

from __future__ import annotations

from dataclasses import dataclass

Pixel = tuple[int, int]
EdgeHit = tuple[int, float]
EdgePathStep = tuple[int, int, int]


@dataclass(frozen=True)
class EdgePath:
    """A graph path between the endpoint sets of two road edges."""

    start_node: int
    end_node: int
    steps: tuple[EdgePathStep, ...]
