import type {
  BusPayload,
  CityDataPayload,
  LightningEvent,
  RainfallPayload,
  RoadworksPayload,
} from "../../types";

type CityData = CityDataPayload | null;

const updateCityData = (
  cityData: CityData,
  update: (current: CityDataPayload) => CityDataPayload,
): CityData => (cityData ? update(cityData) : cityData);

export const applyBusUpdate = (
  cityData: CityData,
  buses: BusPayload,
): CityData => updateCityData(cityData, (current) => ({ ...current, buses }));

export const applyRainfallUpdate = (
  cityData: CityData,
  rainfall: RainfallPayload,
): CityData =>
  updateCityData(cityData, (current) => ({ ...current, rainfall }));

export const applyRoadworksUpdate = (
  cityData: CityData,
  roadworks: RoadworksPayload,
): CityData =>
  updateCityData(cityData, (current) => ({ ...current, roadworks }));

export const applyApiClockUpdate = (
  cityData: CityData,
  apiCalls: CityDataPayload["api_calls"],
): CityData =>
  updateCityData(cityData, (current) => ({
    ...current,
    api_calls: apiCalls,
  }));

const markLightningReceived = (
  strike: LightningEvent,
  receivedAt: number,
): LightningEvent => ({ ...strike, received_at: receivedAt });

export const prepareSnapshotCityData = (
  cityData: CityDataPayload,
  receivedAt: number,
): CityDataPayload => ({
  ...cityData,
  lightning: cityData.lightning
    .slice(0, 4)
    .map((strike) => markLightningReceived(strike, receivedAt)),
});

export const prependLightning = (
  cityData: CityData,
  strikes: LightningEvent[],
  receivedAt: number,
): CityData =>
  updateCityData(cityData, (current) => ({
    ...current,
    lightning: [
      ...strikes.map((strike) => markLightningReceived(strike, receivedAt)),
      ...current.lightning,
    ].slice(0, 40),
  }));

export const pruneExpiredLightning = (
  cityData: CityData,
  now: number,
  lifetimeMilliseconds = 2_800,
): CityData =>
  updateCityData(cityData, (current) => {
    const lightning = current.lightning.filter(
      (strike) => now - (strike.received_at ?? now) < lifetimeMilliseconds,
    );
    return lightning.length === current.lightning.length
      ? current
      : { ...current, lightning };
  });
