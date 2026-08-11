"""Canonical road-name matching shared by LTA-derived layers."""

from __future__ import annotations

import re

_SUFFIXES = {
    "RD": "ROAD",
    "AVE": "AVENUE",
    "ST": "STREET",
    "DR": "DRIVE",
}


def road_key(value: str) -> str:
    words = re.sub(r"[^A-Z0-9]+", " ", value.upper()).split()
    return " ".join(_SUFFIXES.get(word, word) for word in words)
