import { API_CLOCKS } from "../../features/sources/sourceDefinitions";
import type { CityDataPayload } from "../../types";

interface Props {
  apiCalls?: CityDataPayload["api_calls"];
  clock: Date;
}

export function ApiDebugPanel({ apiCalls, clock }: Props) {
  return (
    <aside className="api-debug">
      <span className="api-debug-title">API CLOCKS</span>
      {API_CLOCKS.map(({ source, label }) => {
        const call = apiCalls?.[source];
        const interval = Math.max(1, call?.interval_seconds ?? 1);
        const elapsed = call?.last_called_at
          ? Math.max(0, (clock.getTime() - Date.parse(call.last_called_at)) / 1000)
          : 0;
        const progress = Math.min(1, elapsed / interval);
        const remaining = Math.max(0, Math.ceil(interval - elapsed));
        const active = Boolean(call?.active);
        return (
          <div className={`api-clock ${active ? "" : "inactive"}`} key={source}>
            <div>
              <span>{label}</span>
              <small>{active ? `${remaining}s` : "INACTIVE"}</small>
            </div>
            <i>
              <b style={{ width: `${active ? progress * 100 : 100}%` }} />
            </i>
          </div>
        );
      })}
    </aside>
  );
}
