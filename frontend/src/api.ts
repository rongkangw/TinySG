import type {
  DashboardConfig,
  CityDataPayload,
  Incident,
  LightningEvent,
  NetworkPayload,
  RainfallPayload,
  RoadState,
  StatePayload,
  Statistics,
  BusPayload,
  RoadworksPayload,
} from "./types";

const configured = import.meta.env.VITE_API_BASE as string | undefined;
const API_BASE = configured ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");
const WS_BASE = API_BASE
  ? API_BASE.replace(/^http/, "ws")
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

export type BootstrapPart = "network" | "state";
export type BootstrapStageStatus = "waiting" | "loading" | "ready" | "failed";

export interface BootstrapStage {
  status: BootstrapStageStatus;
  detail: string;
}

export type BootstrapProgress = Record<BootstrapPart | "channel", BootstrapStage>;

type ProgressReporter = (
  part: BootstrapPart,
  status: BootstrapStageStatus,
  detail: string,
) => void;

async function loadPart<T>(
  part: BootstrapPart,
  path: string,
  reporter?: ProgressReporter,
): Promise<T> {
  reporter?.(part, "loading", `Requesting ${path}`);
  try {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as T;
    reporter?.(part, "ready", `${path} loaded`);
    return payload;
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : `Unable to load ${path}`;
    reporter?.(part, "failed", detail);
    throw reason;
  }
}

export async function loadBootstrap(
  reporter?: ProgressReporter,
): Promise<{
  network: NetworkPayload;
  state: StatePayload;
}> {
  const [network, state] = await Promise.all([
    loadPart<NetworkPayload>("network", "/api/network", reporter),
    loadPart<StatePayload>("state", "/api/state", reporter),
  ]);
  return { network, state };
}

export type SocketEvent =
  | { type: "state_snapshot"; payload: StatePayload }
  | {
      type: "road_state_update";
      payload: { changes: RoadState[]; removed: number[] };
    }
  | { type: "new_incident"; payload: Incident }
  | { type: "incident_expired"; payload: { id: string } }
  | { type: "bus_update"; payload: BusPayload }
  | { type: "rainfall_update"; payload: RainfallPayload }
  | { type: "lightning_batch"; payload: LightningEvent[] }
  | { type: "lightning_event"; payload: LightningEvent }
  | { type: "roadworks_update"; payload: RoadworksPayload }
  | { type: "city_data_update"; payload: CityDataPayload }
  | {
      type: "api_clocks_update";
      payload: CityDataPayload["api_calls"];
    }
  | {
      type: "source_status_update";
      payload: CityDataPayload["source_status"];
    }
  | { type: "statistics_update"; payload: Statistics }
  | { type: "config_update"; payload: DashboardConfig }
  | { type: "pong"; payload: { client_time: number } };

export class RealtimeSocket {
  socket: WebSocket | null = null;
  reconnectTimer: number | null = null;
  manuallyClosed = false;

  constructor(
    private onEvent: (event: SocketEvent) => void,
    private onStatus: (connected: boolean) => void,
  ) {}

  connect() {
    this.manuallyClosed = false;
    this.socket = new WebSocket(`${WS_BASE}/ws`);
    this.socket.onopen = () => this.onStatus(true);
    this.socket.onmessage = (message) =>
      this.onEvent(JSON.parse(message.data) as SocketEvent);
    this.socket.onclose = () => {
      this.onStatus(false);
      if (!this.manuallyClosed) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
      }
    };
  }

  send(type: string, payload: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
