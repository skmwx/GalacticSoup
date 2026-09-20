import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { captureSnapshot, createSaveService, loadSave } from '@engine';
import { createMemorySaveStore } from '@adapters/persistence';
import { inventoryService, readCampaignState, validateCampaign, entityIdOf, type InventoryId } from '@engine/domain';
import { runCommand } from '@engine/application';
import { canonicalJson, type DefinitionId, type StationId } from '@shared';
import { testDraft } from '../../support/campaign';
import { shippedContent } from '../../support/content';

const content = shippedContent();
function prepared() {
  const draft = testDraft();
  const ship = draft.assets.ships[draft.assets.activeShipId]!;
  const service = inventoryService(draft, content);
  const ammo = Object.values(draft.assets.stacks).find((s) => s.definitionId.startsWith('ammo.'))!;
  service.add(ammo.inventoryId, ammo.definitionId, 7, { grantedQuantity: 0, purchasedQuantity: 7, purchaseCostCredits: 31 });
  const moved = service.transfer(ammo.id, ship.cargoInventoryId, 19);
  service.reserve(moved, 4, ship.id);
  return draft;
}
function envelope(draft = prepared()) {
  return captureSnapshot({ campaign: draft, content, engineVersion: 'test', protocolVersion: 2,
    slotId: 'slot-1', kind: 'auto', sequence: 1, savedAtRealMs: 1 });
}
const Constructor = (Ajv2020 as unknown as { default: typeof Ajv2020 }).default;
const validateSchema = new Constructor({ strict: true, allErrors: true }).compile(
  JSON.parse(readFileSync('schemas/save/campaign-state.schema.json', 'utf8')),
);
describe('asset persistence and ownership', () => {
  it('round-trips ships, ownership, reservations and rational acquisition cost exactly [TECH-11.2, TECH-11.4, TECH-8.3, MVP-AC-06]', () => {
    const draft = prepared();
    const saved = envelope(draft);
    const result = loadSave(JSON.parse(JSON.stringify(saved)), { content });
    expect(result.ok).toBe(true);
    expect(result.ok && result.state).toEqual(draft);
    expect(validateSchema(draft), JSON.stringify(validateSchema.errors)).toBe(true);
  });
  it.each([
    ['negative wallet', (d: ReturnType<typeof prepared>) => { d.assets.credits = -1; }],
    ['missing active ship', (d: ReturnType<typeof prepared>) => { d.assets.activeShipId = entityIdOf(d.campaignId, 999); }],
    ['duplicated identity', (d: ReturnType<typeof prepared>) => { const s = Object.values(d.assets.stacks)[0]!; d.assets.stacks[entityIdOf(d.campaignId, 999)] = s; }],
    ['missing location', (d: ReturnType<typeof prepared>) => { Object.values(d.assets.stacks)[0]!.inventoryId = entityIdOf(d.campaignId, 999) as InventoryId; }],
    ['unaccounted provenance', (d: ReturnType<typeof prepared>) => { Object.values(d.assets.stacks)[0]!.provenance.grantedQuantity += 1; }],
    ['missing hull', (d: ReturnType<typeof prepared>) => { Object.values(d.assets.ships)[0]!.hullId = 'hull.missing' as typeof d.assets.ships[string]['hullId']; }],
    ['wrong cargo owner', (d: ReturnType<typeof prepared>) => { const i = Object.values(d.assets.inventories).find((i) => i.location.kind === 'cargo')!; i.location = { kind: 'cargo', shipId: entityIdOf(d.campaignId, 999) }; }],
    ['overfull cargo', (d: ReturnType<typeof prepared>) => { const i = Object.values(d.assets.inventories).find((i) => i.location.kind === 'cargo')!; i.capacity = { kind: 'limited', volumeCubicDecimetres: 0 }; }],
    ['foreign campaign id', (d: ReturnType<typeof prepared>) => { d.campaignId = 'c000000000000000000000000' as typeof d.campaignId; }],
    ['reserve cycle', (d: ReturnType<typeof prepared>) => { const i = Object.values(d.assets.inventories).find((i) => i.location.kind === 'reserve')!; i.capacity = { kind: 'shared', inventoryId: i.id }; }],
    ['missing reserve owner', (d: ReturnType<typeof prepared>) => { const i = Object.values(d.assets.inventories).find((i) => i.location.kind === 'reserve')!; if (i.location.kind === 'reserve') i.location.ownerId = entityIdOf(d.campaignId, 999); }],
    ['wrong campaign location', (d: ReturnType<typeof prepared>) => { d.assets.location.stationId = 'station.other' as StationId; }],
  ])('refuses %s without changing stored bytes [TECH-15.3, FUNC-22.3, TECH-11.4]', (_name, mutate) => {
    const draft = prepared(); mutate(draft);
    expect(validateCampaign(draft, content).length).toBeGreaterThan(0);
    const save = envelope(draft), before = canonicalJson(save);
    expect(loadSave(save, { content }).ok).toBe(false);
    expect(canonicalJson(save)).toBe(before);
  });
  it('checks item references even when the content hash is unchanged [TECH-11.4]', () => {
    const draft = prepared(); Object.values(draft.assets.stacks)[0]!.definitionId = 'item.missing' as DefinitionId;
    const result = loadSave(envelope(draft), { content });
    expect(!result.ok && result.error.messageKey).toBe('error.saveLoad.contentIncompatible');
    expect(!result.ok && result.error.params!['firstMissing']).toBe('item.missing');
  });
  it('rejects the unreleased previous save shape with no migration obligation [TECH-11.4]', () => {
    const old = JSON.parse(readFileSync('tests/fixtures/saves/format-1.json', 'utf8')) as unknown;
    const before = canonicalJson(old);
    expect(loadSave(old, { content }).ok).toBe(false);
    expect(canonicalJson(old)).toBe(before);
  });
  it('matches the save schema when nested fields are missing, unexpected or malformed [TECH-11.2, TECH-14]', () => {
    for (const field of ['ships', 'inventories', 'stacks'] as const) {
      for (const bad of [null, [], 1]) {
        const state = { ...prepared(), assets: { ...prepared().assets, [field]: bad } };
        expect(readCampaignState(state).ok).toBe(false);
        expect(validateSchema(state)).toBe(false);
      }
    }
    const state = prepared();
    const stack = Object.values(state.assets.stacks)[0]!;
    Object.assign(stack, { unexpected: true });
    expect(readCampaignState(state).ok).toBe(false);
    expect(validateSchema(state)).toBe(false);
  });
  it('prevents remote use and access to reserved goods without consuming an ordinal [FUNC-6.1, FUNC-22.3, TECH-7.2]', () => {
    const draft = prepared();
    const reserved = Object.values(draft.assets.inventories).find((i) => i.location.kind === 'reserve')!;
    const stack = Object.values(draft.assets.stacks).find((s) => s.inventoryId === reserved.id)!;
    const before = canonicalJson(draft);
    const result = runCommand({ campaign: draft, content, type: 'inventory.transfer', payload: {
      stackId: stack.id, destinationInventoryId: draft.assets.ships[draft.assets.activeShipId]!.cargoInventoryId, quantity: 1,
    } });
    expect(result.kind === 'failed' && result.error.messageKey).toBe('error.ruleViolation.inventoryUnavailable');
    expect(canonicalJson(draft)).toBe(before);
    const hangar = Object.values(draft.assets.inventories).find((i) => i.location.kind === 'hangar')!;
    hangar.location = { kind: 'hangar', stationId: 'station.remote' as StationId };
    const remote = Object.values(draft.assets.stacks).find((s) => s.inventoryId === hangar.id)!;
    const split = runCommand({ campaign: draft, content, type: 'inventory.split', payload: { stackId: remote.id, quantity: 1 } });
    expect(split.kind === 'failed' && split.error.messageKey).toBe('error.ruleViolation.inventoryUnavailable');
  });
  it('refuses to persist an invariant violation and preserves the last valid save [TECH-11.3, TECH-15.3]', async () => {
    const store = createMemorySaveStore();
    const service = createSaveService({ store, content, engineVersion: 'test', protocolVersion: 2 });
    const draft = prepared();
    await service.save(draft, 'auto', 1); await service.drain();
    const before = store.saveIds();
    draft.assets.credits = -1;
    expect((await service.save(draft, 'auto', 2)).state).toBe('failed');
    expect(store.saveIds()).toEqual(before);
  });
});
