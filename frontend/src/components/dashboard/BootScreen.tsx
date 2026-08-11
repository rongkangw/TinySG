import type { BootstrapProgress, BootstrapStageStatus } from "../../api";
import type {
  CityDataPayload,
  NetworkPayload,
  ControllableSource,
} from "../../types";

type BootVisualStatus =
  | BootstrapStageStatus
  | "simulated"
  | "off";

interface BootItem {
  name: string;
  detail: string;
  status: BootVisualStatus;
  kind: "CORE" | "LAYER" | "API";
}

interface BootScreenProps {
  boot: BootstrapProgress;
  network: NetworkPayload | null;
  cityData: CityDataPayload | null;
  incidentCount: number;
  error: string;
}

const terminalStatuses = new Set<BootVisualStatus>([
  "ready",
  "failed",
  "simulated",
  "off",
]);

const statusLabels: Record<BootVisualStatus, string> = {
  waiting: "WAIT",
  loading: "LOAD",
  ready: "OK",
  failed: "FAIL",
  simulated: "SIM",
  off: "OFF",
};

const statusIcons: Record<BootVisualStatus, string> = {
  waiting: "·",
  loading: "↻",
  ready: "✓",
  failed: "×",
  simulated: "◇",
  off: "–",
};

const formatCount = (value: number) => value.toLocaleString("en-SG");

function sourceStatus(
  cityData: CityDataPayload | null,
  source: keyof CityDataPayload["source_status"],
  modeSource?: ControllableSource,
): BootVisualStatus {
  if (!cityData) return "waiting";
  const mode = modeSource ? cityData.source_modes[modeSource] : undefined;
  if (mode === "off") return "off";
  if (mode === "simulated") return "simulated";
  const status = cityData.source_status[source];
  if (status === "live") return "ready";
  if (status === "simulated") return "simulated";
  if (status === "off" || status === "inactive") return "off";
  if (status === "loading") return "loading";
  return "waiting";
}

function BootRow({ item }: { item: BootItem }) {
  return (
    <li className={`boot-row is-${item.status}`}>
      <span className="boot-row-signal" aria-hidden="true">
        {statusIcons[item.status]}
      </span>
      <div className="boot-row-copy">
        <span>{item.name}</span>
        <small>{item.detail}</small>
      </div>
      <em>{item.kind}</em>
      <strong>{statusLabels[item.status]}</strong>
    </li>
  );
}

export function BootScreen({
  boot,
  network,
  cityData,
  incidentCount,
  error,
}: BootScreenProps) {
  const networkStatus = boot.network.status;
  const stateStatus = boot.state.status;
  const layerStatus: BootVisualStatus = network ? "ready" : networkStatus;
  const rail = network?.rail;
  const overlay = network?.environment_overlay;
  const speedBands = cityData?.traffic_speed_bands;
  const rainfall = cityData?.rainfall;
  const wind = cityData?.wind;

  const core: BootItem[] = [
    {
      name: "Island geometry",
      detail: network
        ? `${formatCount(network.edges.length)} road segments at ${network.resolution}px`
        : boot.network.detail,
      status: networkStatus,
      kind: "CORE",
    },
    {
      name: "Runtime state",
      detail: cityData ? "Configuration and layer state received" : boot.state.detail,
      status: stateStatus,
      kind: "CORE",
    },
    {
      name: "Live channel",
      detail: boot.channel.detail,
      status: boot.channel.status,
      kind: "CORE",
    },
  ];

  const layers: BootItem[] = [
    {
      name: "Road lattice",
      detail: network
        ? `${network.road_layers.length} classes · ${formatCount(network.edges.length)} road segments`
        : "Rasterizing every road class",
      status: layerStatus,
      kind: "LAYER",
    },
    {
      name: "MRT + LRT",
      detail: rail
        ? `${rail.lines.length} lines · ${rail.stations.length} stations`
        : "Connecting lines and stations",
      status: layerStatus,
      kind: "LAYER",
    },
    {
      name: "Land-use sectors",
      detail: overlay
        ? `${formatCount(overlay.land_use.sectors.length)} mapped sectors`
        : "Partitioning the island",
      status: layerStatus,
      kind: "LAYER",
    },
    {
      name: "Greenery",
      detail: overlay
        ? `${formatCount(overlay.greenery_spans.length)} raster spans`
        : "Planting green pixels",
      status: layerStatus,
      kind: "LAYER",
    },
    {
      name: "Airports",
      detail: overlay
        ? `${overlay.airports.airport_areas.length} airport areas · ${overlay.airports.aerodromes.length} aerodromes`
        : "Lighting runways and taxiways",
      status: layerStatus,
      kind: "LAYER",
    },
  ];

  const incidentMode = cityData?.source_modes.incidents;
  const signals: BootItem[] = [
    {
      name: "Traffic incidents",
      detail: `${formatCount(incidentCount)} recent events indexed to roads`,
      status: !cityData
        ? "waiting"
        : incidentMode === "off"
          ? "off"
          : incidentMode === "simulated"
            ? "simulated"
            : "ready",
      kind: "API",
    },
    {
      name: "Bus arrivals",
      detail: cityData
        ? `${formatCount(cityData.buses.vehicle_count)} buses · ${formatCount(cityData.buses.cached_routes)} cached routes`
        : "Waiting for LTA bus state",
      status: sourceStatus(cityData, "buses", "buses"),
      kind: "API",
    },
    {
      name: "Rainfall",
      detail: rainfall
        ? `${rainfall.stations.length} stations · peak ${rainfall.maximum_mm.toFixed(1)} mm`
        : "Waiting for NEA rainfall",
      status: sourceStatus(cityData, "rainfall", "rainfall"),
      kind: "API",
    },
    {
      name: "Wind direction",
      detail: wind ? `${Math.round(wind.direction_degrees)}° island mean` : "Waiting for NEA wind",
      status: sourceStatus(cityData, "wind_direction"),
      kind: "API",
    },
    {
      name: "Wind speed",
      detail: wind ? `${wind.speed_knots.toFixed(1)} kn island mean` : "Waiting for NEA wind",
      status: sourceStatus(cityData, "wind_speed"),
      kind: "API",
    },
    {
      name: "Lightning",
      detail: cityData
        ? `${cityData.lightning.length} recent observations`
        : "Waiting for NEA lightning",
      status: sourceStatus(cityData, "lightning", "lightning"),
      kind: "API",
    },
    {
      name: "Road works",
      detail: cityData
        ? `${formatCount(cityData.roadworks.count)} works mapped to roads`
        : "Waiting for LTA road works",
      status: sourceStatus(cityData, "roadworks", "roadworks"),
      kind: "API",
    },
    {
      name: "Traffic speed bands v4",
      detail: speedBands
        ? `${formatCount(speedBands.records_received)} sampled records · ${formatCount(speedBands.matched_edges)} road edges matched`
        : "Sampling the island-wide LTA feed",
      status: sourceStatus(
        cityData,
        "traffic_speed_bands",
        "traffic_speed_bands",
      ),
      kind: "API",
    },
  ];

  const items = [...core, ...layers, ...signals];
  const completed = items.filter((item) => terminalStatuses.has(item.status)).length;
  const failed = items.filter((item) => item.status === "failed").length;
  const progress = Math.round((completed / items.length) * 100);

  return (
    <main className="boot-screen" aria-live="polite">
      <div className="boot-atmosphere" aria-hidden="true" />
      <section className="boot-container">
        <header className="boot-header">
          <div className="ambient-logo breathing">MS</div>
          <div>
            <span>MINI SINGAPORE / BOOT SEQUENCE</span>
            <h1>Waking Singapore</h1>
            <p>Assembling one small, living island.</p>
          </div>
          <time>{new Date().toLocaleTimeString("en-SG", { hour12: false })}</time>
        </header>

        <div className="boot-progress-copy">
          <span>{error ? "BOOT INTERRUPTED" : failed ? "READY WITH GAPS" : "CITY SYSTEMS"}</span>
          <strong>{progress}%</strong>
        </div>
        <div className="boot-progress" aria-label={`${progress}% loaded`}>
          <i style={{ width: `${progress}%` }} />
        </div>

        <div className="boot-columns">
          <section className="boot-group">
            <h2>Core</h2>
            <ul>{core.map((item) => <BootRow item={item} key={item.name} />)}</ul>
            <h2>Island layers</h2>
            <ul>{layers.map((item) => <BootRow item={item} key={item.name} />)}</ul>
          </section>
          <section className="boot-group">
            <h2>Live + simulated signals</h2>
            <ul>{signals.map((item) => <BootRow item={item} key={item.name} />)}</ul>
          </section>
        </div>

        <footer className="boot-footer">
          <span className={error ? "is-error" : ""}>
            {error || (failed
              ? `${failed} optional source${failed === 1 ? "" : "s"} unavailable — the island can still wake.`
              : "Optional feeds may fall back to cached or simulated life.")}
          </span>
          <b>{completed}/{items.length} checks settled</b>
        </footer>
      </section>
    </main>
  );
}
