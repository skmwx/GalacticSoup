import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createSaveService, ENGINE_VERSION, validateCampaign } from '@engine';
import { runCommand } from '@engine/application';
import { shipFit } from '@engine/domain';
import { PROTOCOL_VERSION } from '@protocol';
import { canonicalJson } from '@shared';

import { command } from '../support/loss.ts';
import { content, flyBoth, SEED, SITES } from '../support/persistence/reopen.ts';
import { assembleFit } from '../support/progression/assemble.ts';
import { referenceFixtureFit } from '../support/progression/ladder.ts';

/**
 * Current-v0.2 persistence across the whole combat state
 * (v0.2 Implementation Plan phase 7, work item 1; FeatureSpec02 10;
 * Technical Specification 9.5, 11.4).
 *
 * The phase 3 and phase 4 suites reopen one projectile and one web effect in
 * a two-ship fixture. This suite reopens the authored ladder fights the
 * release ships, with the reference fits and a mixed turret-and-launcher fit,
 * while both sides use everything they carry: volleys in flight on both
 * sides, speed effects from player and opponent webs, reserved rounds in
 * mixed magazines, reloads, repairs, destructions, bounties and wrecks
 * (`tests/support/persistence/reopen.ts`). The fights are spread over
 * `v02Persistence*.test.ts` so that they proceed side by side (Test Suite
 * Optimization Plan phase 1): this file holds the Bombardment Line and the
 * station state; `v02PersistenceWebs` holds Range Check and
 * `v02PersistenceMixed` the Command Group.
 */

describe('reopening the ladder fights the release ships', () => {
  it('reopens the Bombardment Line with guided volleys in flight on both sides and matches the uninterrupted fight [V02-AC-13, V02-AC-06, FUNC-9.6, TECH-9.5, TECH-11.4]', () => {
    const { coverage } = flyBoth({
      fit: referenceFixtureFit('fit.cruiser.guided', content),
      siteId: SITES.bombardmentLine,
      orbitKm: 20,
      seconds: 150,
    });
    expect(coverage.playerProjectilesAtReopen).toBeGreaterThan(0);
    expect(coverage.opponentProjectilesAtReopen).toBeGreaterThan(0);
    expect(coverage.mostProjectilesAtReopen).toBeGreaterThanOrEqual(3);
  }, 240_000);
});

describe('station state that must survive a reopen', () => {
  it('resumes a damaged, insured inactive ship and an open draft for it, which still commits to that ship alone [V02-AC-13, V02-AC-03, FUNC-6.3, FUNC-8.4, TECH-11.4]', async () => {
    // A damaged destroyer, insured and stored, beside an active frigate.
    let state = assembleFit(referenceFixtureFit('fit.destroyer.blaster-web', content), SEED, content).state;
    const destroyerId = state.assets.activeShipId!;
    const frigateId = Object.keys(state.assets.ships).find((id) => id !== destroyerId)!;
    const destroyer = state.assets.ships[destroyerId]!;
    state = {
      ...state,
      assets: {
        ...state.assets,
        ships: {
          ...state.assets.ships,
          [destroyerId]: { ...destroyer, condition: { ...destroyer.condition, damage: { ...destroyer.condition.damage, armor: 120, hull: 40 } } },
        },
      },
    };
    state = command(state, 'ship.activate', { shipId: frigateId }, content).state;
    const insured = state.assets.ships[destroyerId]!.insurance;

    // A draft open on the stored destroyer, one blaster taken out.
    state = command(state, 'fitting.begin', { shipId: destroyerId }, content).state;
    state = command(state, 'fitting.clear', { slotKind: 'weapon', slotIndex: 3 }, content).state;

    const store = createMemorySaveStore();
    const service = () => createSaveService({ store, content, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION });
    const saves = service();
    await saves.save(state, 'auto', 1_700_000_000_000);
    await saves.drain();
    const resumed = await service().resume();
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    let reopened = resumed.loaded.state;
    expect(canonicalJson(reopened)).toBe(canonicalJson(state));
    expect(reopened.assets.activeShipId).toBe(frigateId);
    expect(reopened.assets.ships[destroyerId]!.condition.damage).toMatchObject({ armor: 120, hull: 40 });
    expect(reopened.assets.ships[destroyerId]!.insurance).toEqual(insured);

    // The resumed draft is still bound to the destroyer: switching is refused
    // while it is open, and committing changes only the destroyer.
    const refused = runCommand({ campaign: reopened, content, type: 'ship.activate', payload: { shipId: destroyerId } });
    expect(refused.kind).toBe('failed');
    const frigateFit = canonicalJson(shipFit(reopened.assets, frigateId));
    reopened = command(reopened, 'fitting.commit', {}, content).state;
    expect(canonicalJson(shipFit(reopened.assets, frigateId))).toBe(frigateFit);
    expect(shipFit(reopened.assets, destroyerId).filter((slot) => slot.slot.kind === 'weapon')).toHaveLength(3);
    expect(validateCampaign(reopened, content)).toEqual([]);
  });
});
