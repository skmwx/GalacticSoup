/**
 * The station's surfaces, in rail order (Functional Specification 10, 19.5).
 *
 * Repair, resupply and insurance have no surface of their own: they are on
 * the Overview (`station.hub`). Guidance that still names the old Services
 * surface is sent there by `presentedSurface` in the guidance module.
 */
export const STATION_PANELS = [
  'station.hub',
  'station.market',
  'station.hangar',
  'station.fitting',
  'station.ship',
  'station.departure',
] as const;

export type StationPanelId = (typeof STATION_PANELS)[number];
