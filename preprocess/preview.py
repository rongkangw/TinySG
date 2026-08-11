"""Tiny dependency-free RGB canvas and PNG encoder for debug previews."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

from .rasterize import bresenham

Color = tuple[int, int, int]


def save_png(path: str | Path, width: int, height: int, pixels: bytes | bytearray) -> None:
    def chunk(name: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + name + payload + struct.pack(
            ">I", zlib.crc32(name + payload) & 0xFFFFFFFF
        )

    rows = b"".join(
        b"\x00" + bytes(pixels[y * width * 3 : (y + 1) * width * 3]) for y in range(height)
    )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )
    Path(path).write_bytes(png)


class Canvas:
    def __init__(self, width: int, height: int, background: Color = (2, 7, 16)):
        self.width, self.height = width, height
        self.pixels = bytearray(background * (width * height))

    def put(self, x: int, y: int, color: Color, radius: int = 0) -> None:
        for py in range(max(0, y - radius), min(self.height, y + radius + 1)):
            for px in range(max(0, x - radius), min(self.width, x + radius + 1)):
                if (px - x) ** 2 + (py - y) ** 2 <= radius ** 2 + radius:
                    offset = (py * self.width + px) * 3
                    self.pixels[offset : offset + 3] = bytes(color)

    def line(self, start: tuple[int, int], end: tuple[int, int], color: Color, width: int = 1) -> None:
        for x, y in bresenham(start, end):
            self.put(x, y, color, max(0, width // 2))

    def polyline(self, points: list[tuple[int, int]], color: Color, width: int = 1) -> None:
        for start, end in zip(points, points[1:]):
            self.line(start, end, color, width)

    def save(self, path: str | Path) -> None:
        save_png(path, self.width, self.height, self.pixels)


def draw_geo_preview(
    path: str | Path,
    roads: list[dict],
    bounds: list[float],
    size: int = 768,
    color: Color = (20, 150, 102),
) -> None:
    canvas = Canvas(size, size)
    left, bottom, right, top = bounds
    width, height = max(right - left, 1e-12), max(top - bottom, 1e-12)
    pad = 28
    for road in roads:
        points = [
            (
                round(pad + (lon - left) / width * (size - 2 * pad)),
                round(pad + (top - lat) / height * (size - 2 * pad)),
            )
            for lon, lat in road["coordinates"]
        ]
        canvas.polyline(points, color, 1)
    canvas.save(path)

def draw_map_layout_preview(
    path: str | Path, map_layout: dict, size: int = 768
) -> None:
    canvas = Canvas(size, size)
    for edge in map_layout["edges"]:
        points = [
            (round(point[0] * (size - 1)), round(point[1] * (size - 1)))
            for point in edge["points"]
        ]
        canvas.polyline(points, (12, 112, 78), 3)
    for node in map_layout["nodes"]:
        if node["degree"] > 2:
            canvas.put(round(node["x"] * (size - 1)), round(node["y"] * (size - 1)), (41, 196, 137), 3)
    canvas.save(path)
