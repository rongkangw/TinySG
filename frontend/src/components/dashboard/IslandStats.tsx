import type { CityDataPayload } from "../../types";

interface Props {
  cityData: CityDataPayload | null;
}

export function IslandStats({ cityData }: Props) {
  return (
    <section className="ambient-sense">
      <div>
        <span>BUSES MOVING</span>
        <strong>{cityData?.buses.vehicle_count.toLocaleString() ?? "—"}</strong>
      </div>
      <div>
        <span>RAIN NOW</span>
        <strong>
          {cityData
            ? `${cityData.rainfall.maximum_mm.toFixed(1)} MM`
            : "—"}
        </strong>
      </div>
      <div>
        <span>ROAD WORKS</span>
        <strong>{cityData?.roadworks.count ?? 0}</strong>
      </div>
    </section>
  );
}
