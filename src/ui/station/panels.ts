/** The station's surfaces, in rail order (Functional Specification 10, 19.5). */
export const STATION_PANELS = [
  'station.hub',
  'station.market',
  'station.hangar',
  'station.fitting',
  'station.services',
  'station.ship',
  'station.departure',
] as const;

export type StationPanelId = (typeof STATION_PANELS)[number];
