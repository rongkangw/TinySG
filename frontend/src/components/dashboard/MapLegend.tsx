const LEGEND_ITEMS = [
  ["legend-bus", "BUSES"],
  ["legend-cars", "BACKGROUND TRAFFIC"],
  ["legend-traffic", "INCIDENTS"],
  ["legend-works", "ROAD WORKS"],
  ["legend-rain", "RAIN PATCHES"],
] as const;

interface MapLegendProps {
  incidentColour: string;
}

export function MapLegend({ incidentColour }: MapLegendProps) {
  return (
    <section className="ambient-legend" aria-label="Map legend">
      {LEGEND_ITEMS.map(([className, label]) => (
        <span key={className}>
          <i
            className={className}
            style={
              className === "legend-traffic"
                ? { background: incidentColour }
                : undefined
            }
          />
          {label}
        </span>
      ))}
    </section>
  );
}
