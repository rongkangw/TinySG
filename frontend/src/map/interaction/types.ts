import type { Point } from "../../types";
import type { MapCamera } from "./cameraTransform";

export interface MapFocusTarget {
  edgeId?: number;
  phase?: number;
  pixels: Point[];
  world?: Point;
  follow?:
    | { kind: "bus"; id: string }
    | { kind: "aircraft"; index: number };
  zoom?: number;
  requestId: number;
}

export type MapHoverTarget =
  | { kind: "road"; key: string; tone?: "default" | "roadwork" }
  | { kind: "rail"; ref: string }
  | { kind: "airport"; id: string }
  | { kind: "landUse"; id: string };

export interface MapHoverRow {
  label: string;
  value: string;
  progress?: number;
  icon?: "takeoff" | "landing";
  tone?: "default" | "slow" | "busy" | "clear" | "arrival" | "departure";
}

export interface MapHoverInfo {
  key: string;
  x: number;
  y: number;
  kicker: string;
  title: string;
  detail?: string;
  meta?: string;
  rows?: MapHoverRow[];
  target?: MapHoverTarget;
}

export interface CameraTween {
  startedAt: number;
  from: MapCamera;
  to: MapCamera;
}
