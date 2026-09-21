import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost, type EngineHost } from '@engine';
import { EMPTY_PAYLOAD, PROTOCOL_VERSION, type CombatData, type EngineResponse } from '@protocol';

import { shippedContent } from '../support/content.ts';

/**
 * The targeting and weapon contracts over the engine host
 * (Functional Specification 9.2, 9.4; Technical Specification 7.1-7.3).
 *
 * The site the player can reach without an encounter holds no lockable ship,
 * so what the host proves here is the contract: the commands exist, they are
 * refused with an explainable reason when the rules do not permit them, and
 * the tactical view answers with what the interface needs.
 */

const content = shippedContent();
const SEED = 'aa11bb22cc33dd44ee55ff6677889900';

async function ask<TData>(
  host: EngineHost,
  type: string,
  payload: unknown,
  requestId: string,
): Promise<EngineResponse<TData>> {
  return (await host.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type,
    payload,
  })) as EngineResponse<TData>;
}

async function openCampaign(): Promise<EngineHost> {
  const host = createEngineHost({ content, saves: createMemorySaveStore() });
  await ask(host, 'campaign.create', {
    displayName: 'Vela',
    seed: SEED,
    createdAtRealMs: 1_700_000_000_000,
  }, 'req-create');
  return host;
}

function reasonOf(response: EngineResponse<unknown>): string {
  return response.ok ? '' : response.error.messageKey;
}

describe('targeting and weapon contracts', () => {
  it('refuses every combat command while docked, with a reason [FUNC-9.2, FUNC-9.4, FUNC-22.10]', async () => {
    const host = await openCampaign();
    const station = content.rules.economy.startingStationId;

    const lock = await ask(host, 'targeting.lock', { targetId: station }, 'req-lock');
    const unlock = await ask(host, 'targeting.unlock', { targetId: station }, 'req-unlock');
    const activate = await ask(host, 'weapon.activate', {
      slotKind: 'weapon',
      slotIndex: 0,
      targetId: station,
    }, 'req-activate');
    const deactivate = await ask(host, 'weapon.deactivate', {
      slotKind: 'weapon',
      slotIndex: 0,
    }, 'req-deactivate');
    const reload = await ask(host, 'weapon.reload', {
      slotKind: 'weapon',
      slotIndex: 0,
    }, 'req-reload');
    const change = await ask(host, 'weapon.changeAmmunition', {
      slotKind: 'weapon',
      slotIndex: 0,
      ammunitionId: 'ammo.projectile.small.phased',
    }, 'req-change');

    for (const response of [lock, unlock, activate, deactivate, reload, change]) {
      expect(response.ok).toBe(false);
      expect(reasonOf(response)).toBe('error.ruleViolation.combatUnavailable');
    }
  });

  it('refuses locking a station once the ship is in space [FUNC-9.1, FUNC-9.2]', async () => {
    const host = await openCampaign();
    await ask(host, 'ship.undock', EMPTY_PAYLOAD, 'req-undock');

    const refused = await ask(host, 'targeting.lock', {
      targetId: content.rules.economy.startingStationId,
    }, 'req-lock-station');

    expect(refused.ok).toBe(false);
    expect(reasonOf(refused)).toBe('error.ruleViolation.lockTargetUnavailable');
  });

  it('answers the tactical view while docked and in space [FUNC-19.3, TECH-7.3]', async () => {
    const host = await openCampaign();

    const docked = await ask<CombatData>(host, 'combat.state', EMPTY_PAYLOAD, 'req-combat-docked');
    expect(docked.ok).toBe(true);
    if (!docked.ok) return;
    expect(docked.data.shipId).toBeNull();
    expect(docked.data.weapons).toEqual([]);
    expect(docked.data.locks).toEqual([]);

    await ask(host, 'ship.undock', EMPTY_PAYLOAD, 'req-undock');
    const flying = await ask<CombatData>(host, 'combat.state', EMPTY_PAYLOAD, 'req-combat-flying');

    expect(flying.ok).toBe(true);
    if (!flying.ok) return;
    expect(flying.data.shipId).not.toBeNull();
    expect(flying.data.maxLockedTargets).toBeGreaterThan(0);
    expect(flying.data.maxLockRangeKm).toBeGreaterThan(0);
    expect(flying.data.capacitorCapacity).toBeGreaterThan(0);

    const weapon = flying.data.weapons[0];
    expect(weapon?.moduleId).toBe('module.turret.autocannon.small');
    expect(weapon?.loadedRounds).toBeGreaterThan(0);
    expect(weapon?.absoluteRangeKm).toBeGreaterThan(weapon?.optimalRangeKm ?? 0);
    // Nothing is locked, so every weapon command that needs one is refused
    // with the reason the command itself would answer with.
    const activate = weapon?.commands.find((command) => command.command === 'weapon.activate');
    expect(activate?.available).toBe(false);
    expect(activate?.unavailableReason).toBe('error.ruleViolation.lockNotHeld');
  });

  it('carries lock availability on every object in the site [TECH-12.3, FUNC-19.2]', async () => {
    const host = await openCampaign();
    await ask(host, 'ship.undock', EMPTY_PAYLOAD, 'req-undock');

    const combat = await ask<CombatData>(host, 'combat.state', EMPTY_PAYLOAD, 'req-combat');
    expect(combat.ok).toBe(true);
    if (!combat.ok) return;

    expect(combat.data.lockCommands.length).toBeGreaterThan(0);
    for (const entry of combat.data.lockCommands) {
      expect(entry.commands.map((command) => command.command)).toEqual([
        'targeting.lock',
        'targeting.unlock',
      ]);
    }
  });

  it('rejects a malformed targeting payload before any rule runs [TECH-7.1, TECH-7.2]', async () => {
    const host = await openCampaign();

    const wrongSlot = await ask(host, 'weapon.activate', {
      slotKind: 'system',
      slotIndex: 0,
      targetId: 'c000000000000000000000000-e1',
    }, 'req-bad-slot');
    const extraField = await ask(host, 'targeting.lock', {
      targetId: 'c000000000000000000000000-e1',
      force: true,
    }, 'req-bad-field');

    expect(wrongSlot.ok).toBe(false);
    expect(extraField.ok).toBe(false);
    expect(reasonOf(wrongSlot)).toBe('error.invalidRequest.payload');
    expect(reasonOf(extraField)).toBe('error.invalidRequest.payload');
  });

  it('lists the combat request types in its capabilities [TECH-7.1]', async () => {
    const host = await openCampaign();
    const capabilities = await ask<{ readonly requestTypes: readonly string[] }>(
      host,
      'system.capabilities',
      EMPTY_PAYLOAD,
      'req-capabilities',
    );

    expect(capabilities.ok).toBe(true);
    if (!capabilities.ok) return;
    for (const type of [
      'combat.state',
      'targeting.lock',
      'targeting.unlock',
      'weapon.activate',
      'weapon.changeAmmunition',
      'weapon.deactivate',
      'weapon.reload',
    ]) {
      expect(capabilities.data.requestTypes).toContain(type);
    }
  });
});
