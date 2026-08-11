import { useEffect, useMemo, useRef, useState } from "react";
import { AmbientHeader } from "./components/dashboard/AmbientHeader";
import { ApiDebugPanel } from "./components/dashboard/ApiDebugPanel";
import { BootScreen } from "./components/dashboard/BootScreen";
import { CityStatus } from "./components/dashboard/CityStatus";
import { MapLegend } from "./components/dashboard/MapLegend";
import { RoadCanvas } from "./components/RoadCanvas";
import { buildStoryMoments } from "./features/moments/storyMoments";
import type { StoryMoment } from "./features/moments/storyMoments";
import { useFeaturedMoment } from "./features/moments/useFeaturedMoment";
import { useRealtimeState } from "./hooks/useRealtimeState";
import type { MapFocusTarget } from "./map/interaction/types";
import type { ControllableSource } from "./types";

export default function App() {
  const realtime = useRealtimeState();
  const [debugOpen, setDebugOpen] = useState(false);
  const [landUseOverlay, setLandUseOverlay] = useState(false);
  const [focusTarget, setFocusTarget] =
    useState<MapFocusTarget | null>(null);
  const [clock, setClock] = useState(new Date());
  const [changingSource, setChangingSource] =
    useState<ControllableSource | null>(null);
  const [introVisible, setIntroVisible] = useState(true);
  const introStartedAt = useRef(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleIncidents = useMemo(
    () =>
      realtime.cityData?.source_modes.incidents === "off"
        ? []
        : realtime.incidents.filter((incident) => incident.remaining_intensity > 0),
    [realtime.cityData?.source_modes.incidents, realtime.incidents],
  );

  const storyMoments = useMemo(
    () =>
      buildStoryMoments({
        network: realtime.network,
        cityData: realtime.cityData,
        incidents: visibleIncidents,
      }),
    [realtime.cityData, realtime.network, visibleIncidents],
  );
  const featured = useFeaturedMoment(storyMoments);

  const focusMoment = (moment: StoryMoment) => {
    const focus = moment.focus;
    setFocusTarget({
      edgeId: focus?.edgeId ?? (moment.edge_id >= 0 ? moment.edge_id : undefined),
      phase: focus?.phase ?? moment.phase,
      pixels: focus?.pixels ?? moment.pixels,
      world: focus?.world,
      follow: focus?.follow,
      zoom: focus?.zoom ?? 10.4,
      requestId: Date.now(),
    });
  };

  useEffect(() => {
    setChangingSource(null);
  }, [realtime.cityData?.source_modes]);

  const apiSettled = useMemo(() => {
    const cityData = realtime.cityData;
    if (!cityData) return false;
    const sources = [
      "buses",
      "rainfall",
      "lightning",
      "roadworks",
      "traffic_speed_bands",
    ] as const;
    const mainSourcesSettled = sources.every((source) => {
      if (cityData.source_modes[source] !== "live") return true;
      const status = cityData.source_status[source];
      return Boolean(cityData.api_calls[source]?.last_called_at)
        && status !== "loading";
    });
    const windSettled = cityData.source_modes.rainfall !== "live"
      || (["wind_direction", "wind_speed"] as const).every((source) => {
        const status = cityData.source_status[source];
        return Boolean(cityData.api_calls[source]?.last_called_at)
          && status !== "loading";
      });
    return mainSourcesSettled && windSettled;
  }, [realtime.cityData]);

  const coreReady = Boolean(
    realtime.network && realtime.config && realtime.cityData,
  );
  const bootSettled = apiSettled
    && ["ready", "failed"].includes(realtime.boot.channel.status);

  useEffect(() => {
    if (!coreReady || realtime.error) return;
    const elapsed = Date.now() - introStartedAt.current;
    const delay = bootSettled ? 1_100 : Math.max(0, 14_000 - elapsed);
    const timer = window.setTimeout(() => setIntroVisible(false), delay);
    return () => window.clearTimeout(timer);
  }, [bootSettled, coreReady, realtime.error]);

  if (introVisible || realtime.error || !realtime.network || !realtime.config) {
    return (
      <BootScreen
        boot={realtime.boot}
        network={realtime.network}
        cityData={realtime.cityData}
        incidentCount={realtime.incidents.length}
        error={realtime.error}
      />
    );
  }

  return (
    <main className="ambient-shell">
      <RoadCanvas
        network={realtime.network}
        roadState={realtime.roadState}
        config={realtime.config}
        cityData={realtime.cityData}
        backgroundTraffic={
          realtime.cityData?.source_modes.traffic_speed_bands !== "off"
        }
        landUseOverlay={landUseOverlay}
        focusTarget={focusTarget}
        incidents={
          realtime.cityData?.source_modes.incidents === "off"
            ? []
            : realtime.incidents
        }
      />

      <AmbientHeader
        sourceModes={realtime.cityData?.source_modes}
        changingSource={changingSource}
        landUseOverlay={landUseOverlay}
        debugOpen={debugOpen}
        onSourceMode={(source, mode) => {
          setChangingSource(source);
          realtime.send("source_mode", { source, mode });
        }}
        onToggleLandUse={() => setLandUseOverlay((visible) => !visible)}
        onToggleDebug={() => setDebugOpen((open) => !open)}
      />

      <MapLegend
        incidentColour={realtime.config.rendering.ping_colours.new}
      />

      {debugOpen && (
        <ApiDebugPanel
          apiCalls={realtime.cityData?.api_calls}
          clock={clock}
        />
      )}

      <CityStatus
        clock={clock}
        cityData={realtime.cityData}
        statistics={realtime.statistics}
        featured={featured}
        onFocus={focusMoment}
      />
    </main>
  );
}
