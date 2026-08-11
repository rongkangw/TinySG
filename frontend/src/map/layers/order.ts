/**
 * The visual hierarchy is a domain rule, not an incidental import order.
 * Static and dynamic layers may be interleaved when the composition requires it.
 */
export const LAYER_Z_INDEX = {
  baseMap: 10,
  landUseOverlay: 15,
  sectorLights: 20,
  runwayLights: 21,
  backgroundTraffic: 30,
  roadworks: 35,
  incidents: 36,
  buses: 40,
  railInfrastructure: 50,
  trains: 55,
  aircraft: 60,
  lightning: 70,
  clouds: 80,
  hoverHighlight: 90,
} as const;

export type LayerId = keyof typeof LAYER_Z_INDEX;

export const ORDERED_LAYER_IDS = (
  Object.entries(LAYER_Z_INDEX) as Array<[LayerId, number]>
)
  .sort((left, right) => left[1] - right[1])
  .map(([id]) => id);

export function sortLayers<
  T extends { readonly id: string; readonly zIndex: number },
>(
  layers: readonly T[],
): T[] {
  return [...layers].sort(
    (left, right) =>
      left.zIndex - right.zIndex || left.id.localeCompare(right.id),
  );
}
