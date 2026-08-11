import type { RoadEdge, TrafficSpeedBand } from "../../types";

export interface RoadSpeedSummary {
  averageBand: number;
  averageMinimumKmh: number;
  averageMaximumKmh: number;
  sections: number;
}

const clampBand = (speedBand: number) =>
  Math.max(1, Math.min(8, speedBand));

export function trafficDensityForSpeedBand(speedBand: number | null) {
  if (speedBand === null) return 0.78;
  const normalized = (clampBand(speedBand) - 1) / 7;
  return 1 - normalized * 0.78;
}

export function trafficSpeedMultiplierForBand(speedBand: number | null) {
  if (speedBand === null) return 1;
  const normalized = (clampBand(speedBand) - 1) / 7;
  return 0.55 + normalized * 0.49;
}

export function formatAverageSpeedRange(summary: RoadSpeedSummary) {
  const minimum = Math.round(summary.averageMinimumKmh);
  const maximum = Math.round(summary.averageMaximumKmh);
  if (maximum >= 100 || maximum <= minimum) return `≥${minimum} km/h`;
  return `${minimum}–${maximum} km/h`;
}

export function buildRoadSpeedSummaries(
  roadGroups: Map<string, RoadEdge[]>,
  bands: TrafficSpeedBand[],
) {
  const byEdge = new Map(bands.map((band) => [band.edge_id, band]));
  const summaries = new Map<string, RoadSpeedSummary>();
  roadGroups.forEach((edges, key) => {
    const observed = edges.flatMap((edge) => {
      const band = byEdge.get(edge.id);
      return band ? [band] : [];
    });
    if (!observed.length) return;
    const averageBand =
      observed.reduce((sum, band) => sum + band.speed_band, 0) /
      observed.length;
    const averageMinimumKmh =
      observed.reduce((sum, band) => sum + band.minimum_speed, 0) /
      observed.length;
    const averageMaximumKmh =
      observed.reduce((sum, band) => sum + band.maximum_speed, 0) /
      observed.length;
    summaries.set(key, {
      averageBand,
      averageMinimumKmh,
      averageMaximumKmh,
      sections: observed.length,
    });
  });
  return summaries;
}
