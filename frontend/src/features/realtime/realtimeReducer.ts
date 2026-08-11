import type { SocketEvent } from "../../api";
import type {
  DashboardConfig,
  CityDataPayload,
  Incident,
  NetworkPayload,
  RoadState,
  StatePayload,
  Statistics,
} from "../../types";
import {
  applyApiClockUpdate,
  applyBusUpdate,
  applyRainfallUpdate,
  applyRoadworksUpdate,
  prepareSnapshotCityData,
  prependLightning,
  pruneExpiredLightning,
} from "./cityDataAdapters";

export interface RealtimeState {
  network: NetworkPayload | null;
  roadState: Map<number, RoadState>;
  incidents: Incident[];
  statistics: Statistics | null;
  config: DashboardConfig | null;
  cityData: CityDataPayload | null;
  connected: boolean;
  latency: number;
  error: string;
}

export type RealtimeAction =
  | {
      type: "bootstrap";
      payload: { network: NetworkPayload; state: StatePayload };
    }
  | { type: "socket_event"; event: SocketEvent; receivedAt: number }
  | { type: "connection_changed"; connected: boolean }
  | { type: "lightning_tick"; now: number }
  | { type: "load_failed"; message: string };

export const createInitialRealtimeState = (): RealtimeState => ({
  network: null,
  roadState: new Map(),
  incidents: [],
  statistics: null,
  config: null,
  cityData: null,
  connected: false,
  latency: 0,
  error: "",
});

const indexRoadState = (roadState: RoadState[]) =>
  new Map(roadState.map((state) => [state.edge_id, state]));

const withCityData = (
  state: RealtimeState,
  cityData: CityDataPayload | null,
): RealtimeState =>
  cityData === state.cityData ? state : { ...state, cityData };

const applyBootstrap = (
  state: RealtimeState,
  network: NetworkPayload,
  snapshot: StatePayload,
): RealtimeState => ({
  ...state,
  network,
  roadState: indexRoadState(snapshot.road_state),
  incidents: snapshot.incidents,
  statistics: snapshot.statistics,
  config: snapshot.config,
  cityData: snapshot.city_data ?? state.cityData,
});

export function applySocketEvent(
  state: RealtimeState,
  event: SocketEvent,
  receivedAt: number,
): RealtimeState {
  switch (event.type) {
    case "state_snapshot":
      return {
        ...state,
        roadState: indexRoadState(event.payload.road_state),
        incidents: event.payload.incidents,
        statistics: event.payload.statistics,
        config: event.payload.config,
        cityData: event.payload.city_data
          ? prepareSnapshotCityData(event.payload.city_data, receivedAt)
          : state.cityData,
      };

    case "road_state_update": {
      const roadState = new Map(state.roadState);
      event.payload.changes.forEach((road) =>
        roadState.set(road.edge_id, road),
      );
      event.payload.removed.forEach((edgeId) => roadState.delete(edgeId));
      return { ...state, roadState };
    }

    case "new_incident":
      return {
        ...state,
        incidents: [event.payload, ...state.incidents].slice(0, 100),
      };

    case "incident_expired":
      return {
        ...state,
        incidents: state.incidents.filter(
          (incident) => incident.id !== event.payload.id,
        ),
      };

    case "statistics_update":
      return { ...state, statistics: event.payload };

    case "bus_update":
      return withCityData(
        state,
        applyBusUpdate(state.cityData, event.payload),
      );

    case "rainfall_update":
      return withCityData(
        state,
        applyRainfallUpdate(state.cityData, event.payload),
      );

    case "lightning_batch":
      return withCityData(
        state,
        prependLightning(
          state.cityData,
          event.payload,
          receivedAt,
        ),
      );

    case "lightning_event":
      return withCityData(
        state,
        prependLightning(
          state.cityData,
          [event.payload],
          receivedAt,
        ),
      );

    case "roadworks_update":
      return withCityData(
        state,
        applyRoadworksUpdate(state.cityData, event.payload),
      );

    case "city_data_update":
      return { ...state, cityData: event.payload };

    case "api_clocks_update":
      return withCityData(
        state,
        applyApiClockUpdate(state.cityData, event.payload),
      );

    case "source_status_update":
      return withCityData(
        state,
        state.cityData
          ? { ...state.cityData, source_status: event.payload }
          : null,
      );

    case "config_update":
      return { ...state, config: event.payload };

    case "pong":
      return {
        ...state,
        latency: Math.max(
          0,
          Math.round(receivedAt - event.payload.client_time),
        ),
      };
  }
}

export function realtimeReducer(
  state: RealtimeState,
  action: RealtimeAction,
): RealtimeState {
  switch (action.type) {
    case "bootstrap":
      return applyBootstrap(
        state,
        action.payload.network,
        action.payload.state,
      );
    case "socket_event":
      return applySocketEvent(state, action.event, action.receivedAt);
    case "connection_changed":
      return { ...state, connected: action.connected };
    case "lightning_tick":
      return withCityData(
        state,
        pruneExpiredLightning(state.cityData, action.now),
      );
    case "load_failed":
      return { ...state, error: action.message };
  }
}
