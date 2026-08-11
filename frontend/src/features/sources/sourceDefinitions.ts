import type {
  CityDataPayload,
  ControllableSource,
  SourceMode,
} from "../../types";

export interface SourceDefinition {
  source: ControllableSource;
  label: string;
}

export const SOURCE_CONTROLS: readonly SourceDefinition[] = [
  { source: "incidents", label: "INCIDENTS" },
  { source: "buses", label: "BUSES" },
  { source: "rainfall", label: "RAIN" },
  { source: "lightning", label: "LIGHTNING" },
  { source: "roadworks", label: "WORKS" },
  { source: "traffic_speed_bands", label: "BACKGROUND TRAFFIC" },
];

export type ApiSource = keyof CityDataPayload["api_calls"];

export const API_CLOCKS: readonly {
  source: ApiSource;
  label: string;
}[] = [
  { source: "buses", label: "BUS ARRIVALS" },
  { source: "rainfall", label: "RAINFALL" },
  { source: "lightning", label: "LIGHTNING" },
  { source: "roadworks", label: "ROAD WORKS" },
  { source: "traffic_speed_bands", label: "SPEED BANDS" },
  { source: "wind_direction", label: "WIND DIRECTION" },
  { source: "wind_speed", label: "WIND SPEED" },
];

export const nextMode = (
  mode: SourceMode,
  supportsLive = true,
): SourceMode => {
  if (!supportsLive) return mode === "simulated" ? "off" : "simulated";
  if (mode === "live") return "simulated";
  if (mode === "simulated") return "off";
  return "live";
};
