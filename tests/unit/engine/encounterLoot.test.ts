import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../../config/aliases.mjs';

import {
  attributeValue,
  combatantOf,
  inventoryService,
  possibleLoot,
  replaceSiteObject,
  rollLoot,
  setDestroyedAt,
  stacksIn,
  validateCampaign,
  wrecksInSite,
  wreckAccessRefusal,
  type CampaignState,
  type MutableRandomStreams,
} from '@engine/domain';
import { advanceEncounter, takeLoot } from '@engine/simulation';
import { wreckContentsProjection } from '@engine/projections';
import type { DefinitionId } from '@shared';

import { advance, encounterFixture, opponentIds, SCOUT_SITE_ID } from '../../support/encounter.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * Wrecks, loot ownership and cargo transfer
 * (Functional Specification 5.4, 9.11, 22.2).
 */

const content = shippedContent();

/**
 * The published wreck-contents contract, which a future Java engine reads
 * (Technical Specification 17).
 */
const AjvConstructor = (Ajv2020 as unknown as { default: typeof Ajv2020 }).default;
const validateContents = (() => {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  const load = (name: string): object =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, 'schemas', 'protocol', name), 'utf8')) as object;
  ajv.addSchema(load('assets.common.schema.json'));
  return ajv.compile(load('loot.contents.data.schema.json'));
})();

type Fixture = ReturnType<typeof encounterFixture>;

/** Destroys one opponent and settles the batch, exactly as combat does. */
function destroy(fixture: Fixture, shipId: string): void {
  const combatant = combatantOf(fixture.draft, fixture.content, shipId);
  const ship = fixture.draft.assets.ships[shipId];
  if (combatant === null || ship === undefined) throw new Error(`No opponent ${shipId}.`);
  ship.condition.damage.hull = attributeValue(combatant.derived, 'hullHitPoints');
  setDestroyedAt(fixture.draft, shipId, fixture.draft.time.simulationTimeMs);
  advanceEncounter(fixture.context, fixture.draft.time.simulationTimeMs, fixture.draft.time.simulationTimeMs);
}

/** Moves the player next to the first wreck so it may be opened. */
function closeIn(fixture: Fixture): string {
  const wreck = wrecksInSite(fixture.draft as CampaignState, SCOUT_SITE_ID)[0];
  if (wreck === undefined) throw new Error('No wreck.');
  const player = fixture.draft.navigation.currentSite?.objects[fixture.playerId];
  if (player === undefined) throw new Error('No player object.');
  replaceSiteObject(fixture.draft, { ...player, position: { ...wreck.position } });
  return wreck.id;
}

describe('loot rolls', () => {
  it('takes one chance draw and one quantity draw per authored entry [FUNC-9.11, TECH-9.4]', () => {
    const fixture = encounterFixture();
    const table = content.requireLootTable('loot.pirate.scout' as never);
    const streams = fixture.draft.random as MutableRandomStreams;
    const before = streams.loot.drawIndex;

    const rolled = rollLoot(table, streams);

    // Two entries: each consumes its chance draw, and a hit adds one more.
    expect(streams.loot.drawIndex - before).toBe(table.entries.length + rolled.length);
    for (const entry of rolled) {
      const authored = table.entries.find((candidate) => candidate.itemId === entry.definitionId);
      expect(entry.quantity).toBeGreaterThanOrEqual(authored?.quantityMinimum ?? 0);
      expect(entry.quantity).toBeLessThanOrEqual(authored?.quantityMaximum ?? 0);
    }
  });

  it('discloses every item a table can drop without rolling [MVP-AC-06]', () => {
    const table = content.requireLootTable('loot.pirate.base' as never);
    expect(possibleLoot(table)).toEqual([
      'item.salvage.circuitry',
      'module.capacitor.battery.small',
      'module.turret.railgun.small',
    ]);
  });
});

describe('wrecks', () => {
  it('leaves an owned wreck at the opponent it came from [FUNC-9.11]', () => {
    const fixture = encounterFixture();
    const shipId = opponentIds(fixture)[0] ?? '';
    const position = { ...(fixture.draft.navigation.currentSite?.objects[shipId]?.position ?? { x: 0, y: 0 }) };

    destroy(fixture, shipId);

    const wrecks = wrecksInSite(fixture.draft as CampaignState, SCOUT_SITE_ID);
    expect(wrecks).toHaveLength(1);
    expect(wrecks[0]?.position).toEqual(position);
    expect(wrecks[0]?.hullId).toBe('hull.pirate.scout');
    expect(fixture.draft.navigation.currentSite?.objects[wrecks[0]?.id ?? '']?.kind).toBe('wreck');
    // 30 simulation minutes (Functional Specification 5.4).
    expect((wrecks[0]?.expiresAtMs ?? 0) - (wrecks[0]?.createdAtMs ?? 0)).toBe(1_800_000);
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  });

  // Thirty simulated minutes at 1x are 36,000 quanta, which a busy parallel
  // run can take longer than the default five seconds to integrate.
  it('expires on its own boundary and takes its contents with it [FUNC-5.4]', () => {
    const fixture = encounterFixture();
    destroy(fixture, opponentIds(fixture)[0] ?? '');
    const wreckId = wrecksInSite(fixture.draft as CampaignState, SCOUT_SITE_ID)[0]?.id ?? '';
    const inventoryId = fixture.draft.encounter.wrecks[wreckId]?.inventoryId ?? '';

    advance(fixture, 1_800_000);

    expect(fixture.draft.encounter.wrecks[wreckId]).toBeUndefined();
    expect(fixture.draft.navigation.currentSite?.objects[wreckId]).toBeUndefined();
    expect(fixture.draft.assets.inventories[inventoryId]).toBeUndefined();
    expect(stacksIn(fixture.draft.assets, inventoryId)).toEqual([]);
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  }, 30_000);

  it('refuses to open a wreck beyond the authored range and explains why [FUNC-9.11, FUNC-22.10, TECH-17]', () => {
    const fixture = encounterFixture({ playerPositionKm: { x: 40, y: 0 } });
    destroy(fixture, opponentIds(fixture)[0] ?? '');
    const wreckId = wrecksInSite(fixture.draft as CampaignState, SCOUT_SITE_ID)[0]?.id ?? '';
    const rules = { state: fixture.draft as CampaignState, content };

    expect(wreckAccessRefusal(rules, wreckId)).toBe('wreckOutOfRange');
    expect(wreckAccessRefusal(rules, 'c000000000000000000000000-e9')).toBe('wreckNotFound');

    const view = wreckContentsProjection(fixture.draft as CampaignState, content, wreckId);
    expect(validateContents(view), JSON.stringify(validateContents.errors)).toBe(true);
    expect(view.accessible).toBe(false);
    expect(view.unavailableReason).toBe('error.ruleViolation.wreckOutOfRange');
    // Contents are still described, so the interface explains rather than
    // showing an empty container.
    expect(view.maximumQuantities.every((entry) => entry.maximumQuantity === 0)).toBe(true);
  });
});

describe('taking loot', () => {
  it('moves physical units into cargo without creating any [FUNC-9.11, FUNC-22.3, MVP-AC-06]', () => {
    const fixture = encounterFixture();
    destroy(fixture, opponentIds(fixture)[0] ?? '');
    const wreckId = closeIn(fixture);
    const wreck = fixture.draft.encounter.wrecks[wreckId];
    if (wreck === undefined) throw new Error('No wreck.');
    const stack = stacksIn(fixture.draft.assets, wreck.inventoryId)[0];
    if (stack === undefined) throw new Error('The wreck rolled nothing to take.');

    const cargoId = fixture.draft.assets.ships[fixture.playerId]?.cargoInventoryId ?? '';
    const definitionId = stack.definitionId;
    const quantity = stack.quantity;

    expect(takeLoot(fixture.context, wreckId, stack.id, quantity)).toBe(true);

    expect(stacksIn(fixture.draft.assets, wreck.inventoryId).some((s) => s.id === stack.id)).toBe(false);
    const moved = stacksIn(fixture.draft.assets, cargoId).find((s) => s.definitionId === definitionId);
    expect(moved?.quantity).toBe(quantity);
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  });

  it('keeps goods in the wreck when the hold cannot take them [FUNC-22.2, FUNC-22.6]', () => {
    const fixture = encounterFixture();
    destroy(fixture, opponentIds(fixture)[0] ?? '');
    const wreckId = closeIn(fixture);
    const wreck = fixture.draft.encounter.wrecks[wreckId];
    if (wreck === undefined) throw new Error('No wreck.');

    // A bulky item the starter hold has no room for.
    const service = inventoryService(fixture.draft, content);
    service.add(wreck.inventoryId, 'item.commodity.coolant' as DefinitionId, 100_000, {
      grantedQuantity: 100_000,
      purchasedQuantity: 0,
      purchaseCostCredits: 0,
    });
    const bulky = stacksIn(fixture.draft.assets, wreck.inventoryId).find(
      (stack) => stack.definitionId === 'item.commodity.coolant',
    );
    if (bulky === undefined) throw new Error('The bulky stack did not land in the wreck.');

    expect(() => takeLoot(fixture.context, wreckId, bulky.id, bulky.quantity)).toThrowError(
      /insufficientCapacity/,
    );
    expect(stacksIn(fixture.draft.assets, wreck.inventoryId).some((s) => s.id === bulky.id)).toBe(true);

    // What does fit still transfers, so a full hold is a limit rather than a
    // loss (Functional Specification 22.2).
    const view = wreckContentsProjection(fixture.draft as CampaignState, content, wreckId);
    expect(validateContents(view), JSON.stringify(validateContents.errors)).toBe(true);
    const allowed = view.maximumQuantities.find((entry) => entry.stackId === bulky.id);
    expect(allowed?.maximumQuantity).toBeGreaterThan(0);
    expect(allowed?.maximumQuantity).toBeLessThan(bulky.quantity);
    expect(takeLoot(fixture.context, wreckId, bulky.id, allowed?.maximumQuantity ?? 0)).toBe(true);
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  });

  it('refuses a stack that is not in that wreck [FUNC-22.3]', () => {
    const fixture = encounterFixture();
    destroy(fixture, opponentIds(fixture)[0] ?? '');
    const wreckId = closeIn(fixture);
    const cargoId = fixture.draft.assets.ships[fixture.playerId]?.cargoInventoryId ?? '';
    const foreign = stacksIn(fixture.draft.assets, cargoId)[0]?.id ?? 'c000000000000000000000000-e9';

    expect(takeLoot(fixture.context, wreckId, foreign, 1)).toBe(false);
  });
});
