from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from preprocess.rail import build_rail_overlay


class RailPreprocessingTests(unittest.TestCase):
    def test_network_metadata_resolves_station_before_nearest_line(self) -> None:
        lines = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "ref": "NEL",
                        "name": "North East Line",
                        "route": "subway",
                        "colour": "#9016B2",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[0.0, 0.50], [1.0, 0.50]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "ref": "SKLRT",
                        "name": "Sengkang LRT",
                        "route": "light_rail",
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[0.0, 0.51], [1.0, 0.51]],
                    },
                },
            ],
        }
        stations = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "name": "Sengkang",
                        "network": "North East Line (NEL)",
                        "station": "subway",
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [0.5, 0.51],
                    },
                }
            ],
        }
        layout = {
            "bounds": [0.0, 0.0, 1.0, 1.0],
            "physical_aspect_ratio": 1.0,
        }

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            line_path = root / "lines.geojson"
            station_path = root / "stations.geojson"
            line_path.write_text(json.dumps(lines), encoding="utf-8")
            station_path.write_text(json.dumps(stations), encoding="utf-8")
            overlay = build_rail_overlay(
                line_path,
                station_path,
                layout,
                resolution=128,
            )

        station = overlay["stations"][0]
        self.assertEqual(station["lines"], ["NEL"])
        self.assertEqual(station["colours"], ["#9016B2"])
        self.assertTrue(station["matched"])

    def test_generated_paths_are_unique_bounded_and_contiguous(self) -> None:
        overlay = json.loads(
            Path("output/rail_pixels.json").read_text(encoding="utf-8")
        )
        resolution = overlay["resolution"]
        self.assertTrue(overlay["lines"])

        for line in overlay["lines"]:
            line_pixels = {tuple(pixel) for pixel in line["pixels"]}
            for path in line["paths"]:
                pixels = [tuple(pixel) for pixel in path]
                self.assertGreaterEqual(len(pixels), 2, line["ref"])
                self.assertEqual(
                    len(pixels),
                    len(set(pixels)),
                    f"{line['ref']} path contains duplicate cells",
                )
                self.assertLessEqual(
                    set(pixels),
                    line_pixels,
                    f"{line['ref']} path escaped its combined pixel set",
                )
                for x, y in pixels:
                    self.assertTrue(
                        0 <= x < resolution and 0 <= y < resolution,
                        f"{line['ref']} cell {(x, y)} is out of bounds",
                    )
                for start, end in zip(pixels, pixels[1:]):
                    step = max(
                        abs(end[0] - start[0]),
                        abs(end[1] - start[1]),
                    )
                    self.assertEqual(
                        step,
                        1,
                        f"{line['ref']} path jumps from {start} to {end}",
                    )


if __name__ == "__main__":
    unittest.main()
