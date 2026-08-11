import { nextMode, SOURCE_CONTROLS } from "../../features/sources/sourceDefinitions";
import type {
  CityDataPayload,
  ControllableSource,
  SourceMode,
} from "../../types";

interface Props {
  sourceModes?: CityDataPayload["source_modes"];
  changingSource: ControllableSource | null;
  landUseOverlay: boolean;
  debugOpen: boolean;
  onSourceMode: (source: ControllableSource, mode: SourceMode) => void;
  onToggleLandUse: () => void;
  onToggleDebug: () => void;
}

export function AmbientHeader({
  sourceModes,
  changingSource,
  landUseOverlay,
  debugOpen,
  onSourceMode,
  onToggleLandUse,
  onToggleDebug,
}: Props) {
  return (
    <header className="ambient-header">
      <div className="ambient-brand">
        <div className="ambient-logo">MS</div>
        <div>
          <span>MINI SINGAPORE</span>
          <small>A LIVING LITTLE ISLAND</small>
        </div>
      </div>
      <div className="ambient-actions">
        <div className="mode-toggle" aria-label="Data layer modes">
          {SOURCE_CONTROLS.map(({ source, label }) => {
            const mode = sourceModes?.[source] ?? "off";
            return (
              <div className="source-control" key={source}>
                <span>{label}</span>
                <button
                  type="button"
                  className={`source-cycle ${mode}`}
                  disabled={changingSource !== null}
                  onClick={() => onSourceMode(source, nextMode(mode))}
                  title={`${label}: click to change data mode`}
                >
                  {mode === "simulated" ? "SIM" : mode.toUpperCase()}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={`debug-toggle sector-toggle ${
            landUseOverlay ? "active" : ""
          }`}
          onClick={onToggleLandUse}
          aria-pressed={landUseOverlay}
          title="Toggle the land-use colour overlay"
        >
          LAND USE {landUseOverlay ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          className={`debug-toggle ${debugOpen ? "active" : ""}`}
          onClick={onToggleDebug}
        >
          DEBUG
        </button>
      </div>
    </header>
  );
}
