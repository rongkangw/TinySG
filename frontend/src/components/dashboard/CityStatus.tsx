import {
  storyDescription,
  storyKicker,
  type StoryMoment,
} from "../../features/moments/storyMoments";
import type { CityDataPayload, Statistics } from "../../types";

const timeLabel = (clock: Date) =>
  new Intl.DateTimeFormat("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(clock);

const dateLabel = (clock: Date) =>
  new Intl.DateTimeFormat("en-SG", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(clock);

function regionLabel(x: number, y: number) {
  if (x < 0.36) return "west";
  if (x > 0.66) return "east";
  if (y < 0.42) return "north";
  if (y > 0.65) return "south";
  return "central";
}

function estimatedTemperature(clock: Date, rainfallMm: number) {
  const hour = clock.getHours() + clock.getMinutes() / 60;
  const daily = Math.sin(((hour - 8) / 24) * Math.PI * 2);
  const rainCooling = Math.min(2.2, rainfallMm * 0.14);
  return Math.round(28.4 + daily * 2.1 - rainCooling);
}

function weatherSummary(cityData: CityDataPayload | null) {
  const wettest = [...(cityData?.rainfall.stations ?? [])]
    .filter((station) => station.value > 0)
    .sort((left, right) => right.value - left.value)[0];
  const lightning = cityData?.lightning.length ?? 0;
  if (lightning > 0) return "Lightning nearby";
  if (!wettest) return "Humid and calm";
  const region = regionLabel(wettest.x, wettest.y);
  if (wettest.value >= 8) return `Heavy rain in the ${region}`;
  if (wettest.value >= 2) return `Rain in the ${region}`;
  return `Light rain in the ${region}`;
}

function transportMood(
  cityData: CityDataPayload | null,
  statistics: Statistics | null,
) {
  const slowest = [...(cityData?.traffic_speed_bands.bands ?? [])].sort(
    (left, right) => left.speed_band - right.speed_band,
  )[0];
  if (slowest && slowest.speed_band <= 3) {
    return `${slowest.road} is running slow`;
  }
  if ((cityData?.roadworks.count ?? 0) > 0) {
    return "Roadworks are dotted around the island";
  }
  return statistics?.most_active_road
    ? `${statistics.most_active_road} is the busiest road`
    : "The roads are moving quietly";
}

interface Props {
  clock: Date;
  cityData: CityDataPayload | null;
  statistics: Statistics | null;
  featured: StoryMoment | null;
  onFocus: (moment: StoryMoment) => void;
}

export function CityStatus({
  clock,
  cityData,
  statistics,
  featured,
  onFocus,
}: Props) {
  const rainfall = cityData?.rainfall.maximum_mm ?? 0;
  const insightTitle = featured
    ? storyDescription(featured)
    : weatherSummary(cityData);
  const insightFact = featured
    ? `${featured.incident_type} · ${featured.road}`
    : transportMood(cityData, statistics);

  const focus = () => {
    if (featured) onFocus(featured);
  };

  return (
    <section
      className={`city-status ${featured ? "is-actionable" : ""}`}
      role={featured ? "button" : undefined}
      tabIndex={featured ? 0 : undefined}
      onClick={focus}
      onKeyDown={(event) => {
        if (!featured || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        focus();
      }}
    >
      <div className="city-clock">
        <strong>{timeLabel(clock)}</strong>
        <span>{dateLabel(clock)} · SGT</span>
      </div>

      <div className="city-weather">
        <span>{weatherSummary(cityData)}</span>
        <strong>{estimatedTemperature(clock, rainfall)}°C</strong>
      </div>

      <div className="city-insight">
        <span>{featured ? storyKicker(featured) : "CITY STATUS"}</span>
        <p>{insightTitle}</p>
        <small>{insightFact}</small>
      </div>
    </section>
  );
}
