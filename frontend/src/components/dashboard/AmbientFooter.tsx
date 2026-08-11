import type { CityDataPayload, Statistics } from "../../types";

const timeLabel = (timestamp: string) =>
  new Intl.DateTimeFormat("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));

interface Props {
  clock: Date;
  cityData: CityDataPayload | null;
  statistics: Statistics | null;
}

export function AmbientFooter({ clock, cityData, statistics }: Props) {
  return (
    <footer className="ambient-footer">
      <span>{timeLabel(clock.toISOString())} SGT</span>
      <i />
      <span>{statistics?.most_active_road ?? "ROADS RESTING"}</span>
      <i />
      <span>
        BUS {cityData?.source_status.buses?.toUpperCase() ?? "WAKING"}
        {" · "}RAIN{" "}
        {cityData?.source_status.rainfall?.toUpperCase() ?? "WAKING"}
        {" · "}LIGHTNING{" "}
        {cityData?.source_status.lightning?.toUpperCase() ?? "WAKING"}
        {" · "}WORKS{" "}
        {cityData?.source_status.roadworks?.toUpperCase() ?? "WAKING"}
      </span>
      <i />
      <span>SCROLL TO ZOOM · DRAG TO PAN · DOUBLE-CLICK TO RESET</span>
    </footer>
  );
}
