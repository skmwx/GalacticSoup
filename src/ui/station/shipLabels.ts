/**
 * Names for the player's ships (Functional Specification 6.3).
 *
 * A ship is called by its hull's name. When the player owns more than one of
 * the same hull, each gets its place among them, in the stable id order the
 * engine lists them in, so "Wayfarer 1" and "Wayfarer 2" stay the same ships
 * from one screen to the next.
 */
export function shipLabels(
  ships: readonly { readonly id: string; readonly hullId: string; readonly nameKey: string }[],
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
): ReadonlyMap<string, string> {
  const byHull = new Map<string, string[]>();
  for (const ship of ships) {
    byHull.set(ship.hullId, [...(byHull.get(ship.hullId) ?? []), ship.id]);
  }
  const labels = new Map<string, string>();
  for (const ship of ships) {
    const same = byHull.get(ship.hullId) ?? [ship.id];
    const name = translate(ship.nameKey);
    labels.set(
      ship.id,
      same.length > 1 ? translate('ships.numbered', { name, number: same.indexOf(ship.id) + 1 }) : name,
    );
  }
  return labels;
}
