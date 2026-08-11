export type Point = [number, number];

export interface RoadEdge {
  id: number;
  road: string;
  highway_class: string;
  points: Point[];
  pixels: Point[];
}

export interface RoadLayer {
  highway_class: string;
  pixels: Point[];
}

export interface RailLine {
  ref: string;
  name: string;
  colour: string;
  future: boolean;
  route: string;
  pixels: Point[];
  paths: Point[][];
}

export interface RailStation {
  id: string;
  name: string;
  ref: string;
  lines: string[];
  colours: string[];
  pixel: Point;
  lrt: boolean;
  matched: boolean;
}

export interface AirportArea {
  id: string;
  name: string;
  ref: string;
  pixel: Point;
  ground_spans: [number, number, number][];
  terminal_spans: [number, number, number][];
  taxiway_pixels: Point[];
  runway_pixels: Point[];
  runway_light_pixels: Point[];
  runway_threshold_pixels: Point[];
}

export interface LandUseSector {
  category: string;
  spans: [number, number, number][];
  outline_spans: [number, number, number][];
}

export interface NetworkPayload {
  resolution: number;
  physical_aspect_ratio: number;
  land_polygon: Point[];
  road_layers: RoadLayer[];
  edges: RoadEdge[];
  traffic_routes: Point[][];
  rail: {
    resolution: number;
    lines: RailLine[];
    stations: RailStation[];
  };
  environment_overlay: {
    resolution: number;
    land_spans: [number, number, number][];
    coastline_pixels: Point[];
    land_use: {
      sectors: LandUseSector[];
    };
    greenery_spans: [number, number, number][];
    airports: {
      ground_spans: [number, number, number][];
      terminal_spans: [number, number, number][];
      taxiway_pixels: Point[];
      runway_pixels: Point[];
      runway_light_pixels: Point[];
      runway_threshold_pixels: Point[];
      flight_paths: Point[][];
      aircraft_journeys: Array<{
        path: Point[];
        taxi_end_index: number;
        runway_end_index: number;
      }>;
      aerodromes: Array<{
        name: string;
        ref: string;
        pixel: Point;
      }>;
      airport_areas: AirportArea[];
    };
  };
}

export interface RoadState {
  edge_id: number;
  intensity: number;
  phase: number;
  incident_type: string;
  pixels: Point[];
  highway_class: string;
}

export interface Incident {
  id: string;
  edge_id: number;
  road: string;
  incident_type: string;
  message: string;
  timestamp: string;
  lifetime_seconds: number;
  age_seconds: number;
  remaining_intensity: number;
  phase: number;
  simulated: boolean;
  pixels: Point[];
  highway_class: string;
}

export interface Statistics {
  active_incidents: number;
  simulated_incidents: number;
  average_intensity: number;
  average_lifetime_seconds: number;
  active_road_segments: number;
  most_active_road: string;
  paused: boolean;
  time_scale: number;
}

export interface DashboardConfig {
  simulation: {
    enabled: boolean;
    spawn_interval_seconds: number;
    decay_multiplier: number;
    maximum_simulated_incidents: number;
    road_selection_weights: Record<string, number>;
  };
  rendering: {
    background: string;
    island_fill: string;
    island_outline: string;
    hierarchy_grays: Record<string, string>;
    class_colours: Record<string, string>;
    ping_colours: { new: string; warm: string; cool: string };
  };
  animation: {
    maximum_intensity: number;
    neighbour_propagation_strength: number;
    neighbour_radius: number;
    update_hz: number;
  };
  camera: {
    default_zoom: number;
    minimum_zoom: number;
    maximum_zoom: number;
  };
}

export interface StatePayload {
  road_state: RoadState[];
  incidents: Incident[];
  statistics: Statistics;
  config: DashboardConfig;
  city_data?: CityDataPayload;
}

export interface BusVehicle {
  id: string;
  service: string;
  load: string;
  monitored: boolean;
  route: Point[];
  duration_seconds: number;
  started_at: string;
  route_distance_km: number;
  estimated_speed_kmh: number;
  phase_offset?: number;
  next_stop_code?: string;
  next_stop_name?: string;
  next_stop_eta_seconds?: number;
  route_stops?: Array<{
    code: string;
    name: string;
    phase: number;
  }>;
  simulated: boolean;
  road_pixels?: boolean;
}

export interface BusPayload {
  vehicles: BusVehicle[];
  vehicle_count: number;
  timestamp: string;
  simulated: boolean;
  sampled_stops: number;
  cached_stops: number;
  cached_routes: number;
}

export interface RainStation {
  id: string;
  name: string;
  x: number;
  y: number;
  value: number;
  simulated: boolean;
}

export interface RainfallPayload {
  stations: RainStation[];
  maximum_mm: number;
  timestamp: string;
  simulated: boolean;
}

export interface WindStation {
  id: string;
  name: string;
  x: number | null;
  y: number | null;
  direction_degrees: number;
  speed_knots: number;
}

export interface WindPayload {
  stations: WindStation[];
  direction_degrees: number;
  speed_knots: number;
  motion_x: number;
  motion_y: number;
  timestamp: string;
  source: SourceProvenance;
}

export interface LightningEvent {
  id: string;
  x: number;
  y: number;
  kind: string;
  text: string;
  timestamp: string;
  simulated: boolean;
  received_at?: number;
}

export interface Roadwork {
  id: string;
  edge_id: number;
  road: string;
  phase: number;
  start_date?: string;
  end_date?: string;
  department: string;
  message: string;
  simulated: boolean;
  pixels: Point[];
  highway_class: string;
}

export interface RoadworksPayload {
  works: Roadwork[];
  count: number;
  timestamp: string;
  simulated: boolean;
  source: PayloadSource;
}

export interface TrafficSpeedBand {
  edge_id: number;
  road: string;
  speed_band: number;
  minimum_speed: number;
  maximum_speed: number;
}

export interface TrafficSpeedPayload {
  bands: TrafficSpeedBand[];
  timestamp: string;
  matched_edges: number;
  records_received: number;
  source: PayloadSource;
}

export type ControllableSource =
  | "incidents"
  | "buses"
  | "rainfall"
  | "lightning"
  | "roadworks"
  | "traffic_speed_bands";
export type SourceMode = "live" | "simulated" | "off";
export type SourceStatus =
  | "live"
  | "simulated"
  | "loading"
  | "off"
  | "inactive";
export type SourceProvenance = "live" | "simulated";
export type PayloadSource = SourceProvenance | "off";
export type SourceStatusKey =
  | ControllableSource
  | "wind_direction"
  | "wind_speed";

export interface CityDataPayload {
  buses: BusPayload;
  rainfall: RainfallPayload;
  wind: WindPayload;
  lightning: LightningEvent[];
  roadworks: RoadworksPayload;
  traffic_speed_bands: TrafficSpeedPayload;
  api_calls: Record<
    | "buses"
    | "rainfall"
    | "lightning"
    | "roadworks"
    | "traffic_speed_bands"
    | "wind_direction"
    | "wind_speed",
    {
      interval_seconds: number;
      last_called_at: string | null;
      active: boolean;
    }
  >;
  source_status: Record<SourceStatusKey, SourceStatus>;
  source_modes: Record<ControllableSource, SourceMode>;
}
