import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  type AssetsData,
  type CombatData,
  type EncounterData,
  type SiteData,
} from '@protocol';
import type { LocalizationIssue } from '@shared';
import { GameRoot, LocalizationProvider } from '@ui';

import {
  arriveAtScout,
  closeSortie,
  destroyOpponent,
  loadAmmunition,
  lockOpponent,
  reachWreck,
  returnHome,
  startSortie,
  type Sortie,
} from '../support/sortie.ts';

/**
 * The combat interface over a real engine
 * (MVP-AC-03, MVP-AC-04, MVP-AC-06; Functional Specification 9, 19.1-19.3;
 * Technical Specification 12.1-12.3).
 *
 * Each case drives a campaign headlessly to the moment it tests - arrived at
 * the scout site, in the middle of the fight, beside the wreck, home again -
 * closes it, and then opens the shipped interface on the same engine and
 * resumes. Every value asserted is therefore one the engine projected, and
 * every command the interface sends is checked in the engine afterwards.
 */

interface Harness {
  readonly sortie: Sortie;
  readonly gateway: ReturnType<typeof createDirectGateway>;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly issues: LocalizationIssue[];
}

async function resume(sortie: Sortie, heading: string): Promise<Harness> {
  const issues: LocalizationIssue[] = [];
  const gateway = createDirectGateway({ host: sortie.host, defaultTimeoutMs: 5_000 });
  render(
    <LocalizationProvider onIssue={(issue) => issues.push(issue)}>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Resume campaign' }));
  await screen.findByRole('heading', { level: 2, name: heading });
  return { sortie, gateway, user, issues };
}

async function combat(harness: Harness): Promise<CombatData> {
  const response = await harness.gateway.request('combat.state', EMPTY_PAYLOAD);
  if (!response.ok) throw new Error('combat.state was refused.');
  return response.data;
}

/** Waits for the opponent to come within lock range, then closes. */
async function arrivedAndLockable(): Promise<{ sortie: Sortie; opponent: string }> {
  const sortie = await startSortie();
  const opponent = await arriveAtScout(sortie);
  await sortie.until(async () => {
    const state = await sortie.data<CombatData>('combat.state');
    return state.lockCommands.some(
      (entry) =>
        entry.objectId === opponent &&
        entry.commands.some((command) => command.command === 'targeting.lock' && command.available),
    );
  }, 60);
  await closeSortie(sortie);
  return { sortie, opponent };
}

/** The entry for one object in the site list, which is how selection works. */
function objectEntry(name: RegExp): HTMLElement {
  return within(panel('In this site')).getByRole('button', { name });
}

function panel(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const section = heading.closest('section');
  if (section === null) throw new Error(`No panel is headed ${name}.`);
  return section;
}

describe('a fight in progress', () => {
  async function midFight(): Promise<{ harness: Harness; opponent: string }> {
    const sortie = await startSortie();
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await sortie.data('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponent });
    await sortie.data('module.activate', { slotKind: 'system', slotIndex: 0 });
    // Long enough for shots and a repair to land and for the scout to lock back.
    await sortie.until(async () => false, 12);
    await closeSortie(sortie);
    return { harness: await resume(sortie, 'Verge Belt'), opponent };
  }

  it('marks the opponent hostile and locked in words and in the drawing [FUNC-9.1, FUNC-19.2, TECH-12.2]', async () => {
    const { harness, opponent } = await midFight();

    const entry = objectEntry(/Pirate Scout/);
    expect(entry).toHaveAttribute('data-attitude', 'hostile');
    expect(within(entry).getByText(/Hostile · Locked/)).toBeInTheDocument();

    const view = screen.getByRole('img', { name: /Schematic view of Verge Belt/ });
    const drawn = view.querySelector(`[data-layer="objects"] [data-attitude="hostile"]`);
    expect(drawn?.querySelector('[data-hostile="true"]')).not.toBeNull();
    expect(drawn?.querySelector('[data-lock-marker="locked"]')).not.toBeNull();
    expect(drawn?.getAttribute('data-locked')).toBe('locked');
    // The weapon's cycle is drawn as a line to the target.
    expect(view.querySelector('[data-layer="effects"] [data-effect="fire"]')).not.toBeNull();
    expect(view.querySelector(`[data-object-id="${opponent}"]`)).not.toBeNull();

    harness.gateway.dispose();
  });

  it('shows hit chance, its limiting factor and the substituted formula [FUNC-9.5, FUNC-19.3, FUNC-19.6, MVP-AC-04]', async () => {
    const { harness } = await midFight();
    const weapons = panel('Weapons');

    expect(within(weapons).getByText('Aimed at Pirate Scout')).toBeInTheDocument();
    const state = await combat(harness);
    const effect = state.weapons[0]?.effects[0];
    if (effect === undefined) throw new Error('No weapon effect was projected.');

    const chance = within(weapons).getByText(/to hit Pirate Scout$/);
    expect(chance.textContent).toMatch(/^\d+% to hit Pirate Scout$/);
    const limiting = weapons.querySelector('[data-limiting]');
    expect(limiting?.getAttribute('data-limiting')).toBe(effect.limitingFactor);
    expect(
      within(weapons).getByText(effect.limitingFactor === 'none' ? /Nothing limits/ : /^Main limit:/),
    ).toBeInTheDocument();

    await harness.user.click(within(weapons).getByText('Show the hit-chance calculation'));
    const formula = within(weapons).getByText(/^Hit chance = 0\.5 \^/);
    // Every placeholder was substituted with the engine's operands.
    expect(formula.textContent).not.toMatch(/[{}]/);
    expect(within(weapons).getByText('Tracking strain')).toBeInTheDocument();
    expect(within(weapons).getByText('Range strain')).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  });

  it('reports layers, capacitor, running modules and who has locked the ship [FUNC-9.7, FUNC-9.8, FUNC-19.1, MVP-AC-04]', async () => {
    const { harness } = await midFight();
    const status = panel('Your ship');

    expect(status.querySelector('[data-layer-name="shield"]')?.textContent).toMatch(/^Shield\d+ \/ 350/);
    expect(within(status).getAllByText('Capacitor').length).toBeGreaterThan(0);
    expect(status.querySelector('[data-capacitor-outlook]')).not.toBeNull();
    const state = await combat(harness);
    expect(state.hostileLocks.length).toBeGreaterThan(0);
    expect(within(status).getByText(/Pirate Scout (has you locked|is locking you)/)).toBeInTheDocument();

    const modules = panel('Modules');
    const booster = within(modules).getByRole('button', { name: /Deactivate Small Shield Booster/ });
    expect(booster).toHaveAttribute('aria-pressed', 'true');
    expect(within(modules).getByText(/per second\) for 15 capacitor a cycle/)).toBeInTheDocument();

    // The persistent frame carries the same condition while undocked.
    expect(document.querySelector('[data-readout="defenses"]')?.textContent).toMatch(/Shield \d+%/);
    expect(document.querySelector('[data-readout="threats"]')?.textContent).toBe('1 hostile');
    expect(document.querySelector('[data-readout="locks"]')?.textContent).toBe('1 of 3');

    harness.gateway.dispose();
  });

  it('explains the selected opponent: role, bounty, relative motion and defences [FUNC-9.3, FUNC-19.3, MVP-AC-04]', async () => {
    const { harness } = await midFight();
    await harness.user.click(objectEntry(/Pirate Scout/));
    const selected = panel('Selected');

    expect(within(selected).getByText('Hostile')).toBeInTheDocument();
    expect(within(selected).getByText('Skirmisher')).toBeInTheDocument();
    expect(within(selected).getByText('3,000 ISK')).toBeInTheDocument();
    expect(within(selected).getByText('Transverse speed')).toBeInTheDocument();
    expect(within(selected).getByText('Angular velocity')).toBeInTheDocument();
    expect(within(selected).getByText('Locked')).toBeInTheDocument();
    // Its layers are known from the tactical view, so they are not "unknown".
    expect(selected.querySelector('[data-defenses]')).not.toBeNull();
    expect(within(selected).queryByText('Unknown')).not.toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('summarises combat events and filters them [FUNC-19.3, FUNC-20]', async () => {
    const { harness } = await midFight();
    const log = panel('Combat log');

    expect(log.querySelectorAll('[data-event]').length).toBeGreaterThan(0);
    await harness.user.selectOptions(within(log).getByLabelText('Show'), 'repair');
    await waitFor(() => {
      const kinds = [...log.querySelectorAll('[data-event]')].map((entry) => entry.getAttribute('data-event'));
      expect(kinds.every((kind) => kind === 'repair')).toBe(true);
    });

    harness.gateway.dispose();
  });
});

describe('combat commands', () => {
  it('locks, unlocks and toggles a module through registry actions [MVP-AC-03, TECH-12.3]', async () => {
    const { sortie, opponent } = await arrivedAndLockable();
    const harness = await resume(sortie, 'Verge Belt');

    expect(within(panel('Weapons')).getByRole('button', { name: /^Fire\s?E$/ })).toBeDisabled();
    expect(within(panel('Weapons')).getAllByText('Lock a target and select it to aim the weapons.').length)
      .toBeGreaterThan(0);

    await harness.user.click(objectEntry(/Pirate Scout/));
    await harness.user.click(within(panel('Selected')).getByRole('button', { name: /^Lock target/ }));
    await waitFor(async () => {
      expect((await combat(harness)).locks.map((lock) => lock.targetId)).toEqual([opponent]);
    });
    const locks = panel('Locks');
    expect(await within(locks).findByText(/^Locking - \d/)).toBeInTheDocument();
    await harness.user.click(within(locks).getByText('Show the lock-time calculation'));
    expect(within(locks).getByText(/^Lock time = clamp/).textContent).not.toMatch(/[{}]/);

    await harness.user.click(within(locks).getByRole('button', { name: /^Unlock Pirate Scout/ }));
    await waitFor(async () => {
      expect((await combat(harness)).locks).toEqual([]);
    });

    const modules = panel('Modules');
    await harness.user.click(within(modules).getByRole('button', { name: /^Activate Small Shield Booster/ }));
    await waitFor(async () => {
      expect((await combat(harness)).modules[0]?.repeating).toBe(true);
    });
    expect(
      await within(modules).findByRole('button', { name: /^Deactivate Small Shield Booster/ }),
    ).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('gives the same commands from the keyboard [MVP-AC-03, FUNC-20, TECH-12.3]', async () => {
    const { sortie, opponent } = await arrivedAndLockable();
    const harness = await resume(sortie, 'Verge Belt');

    // ] steps the selection through the site; the player's ship is skipped.
    const entries = () => screen.getAllByRole('button', { pressed: true });
    await harness.user.keyboard(']');
    await waitFor(() => {
      expect(entries().some((entry) => entry.getAttribute('data-object-entry') !== null)).toBe(true);
    });
    const site = (await harness.gateway.request('navigation.site', EMPTY_PAYLOAD)) as { ok: true; data: SiteData };
    const order = site.data.site?.objects.filter((object) => !object.player).map((object) => object.id) ?? [];
    while (
      !(objectEntry(/Pirate Scout/).getAttribute('aria-pressed') === 'true')
    ) {
      await harness.user.keyboard(']');
      if (order.length === 0) break;
    }

    await harness.user.keyboard('l');
    await waitFor(async () => {
      expect((await combat(harness)).locks.map((lock) => lock.targetId)).toEqual([opponent]);
    });

    await harness.user.keyboard('1');
    await waitFor(async () => {
      expect((await combat(harness)).modules[0]?.repeating).toBe(true);
    });

    await harness.user.keyboard('n');
    await waitFor(async () => {
      expect((await combat(harness)).locks).toEqual([]);
    });

    await harness.user.keyboard('b');
    const view = screen.getByRole('img', { name: /Schematic view/ });
    await waitFor(() => {
      expect(view.querySelector('[data-range="lock"]')).not.toBeNull();
      expect(view.querySelector('[data-range="optimal"]')).not.toBeNull();
    });

    harness.gateway.dispose();
  });

  it('opens contextual commands on a secondary click and gives the order [FUNC-19.2, MVP-AC-03]', async () => {
    const { sortie, opponent } = await arrivedAndLockable();
    const harness = await resume(sortie, 'Verge Belt');

    const view = screen.getByRole('img', { name: /Schematic view/ });
    const target = view.querySelector(`[data-object-id="${opponent}"]`);
    if (target === null) throw new Error('The opponent has no hit target.');
    fireEvent.contextMenu(target);

    const menu = await screen.findByRole('group', { name: 'Commands for Pirate Scout' });
    expect(within(menu).getByRole('button', { name: /^Lock target/ })).toHaveFocus();
    await harness.user.click(within(menu).getByRole('button', { name: /^Orbit at/ }));

    await waitFor(async () => {
      const response = await harness.gateway.request('navigation.site', EMPTY_PAYLOAD);
      expect(response.ok && response.data.movementOrder).toMatchObject({ kind: 'orbit', targetId: opponent });
    });
    expect(screen.queryByRole('group', { name: 'Commands for Pirate Scout' })).not.toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('opens the same menu from the keyboard and returns focus on Escape [FUNC-20, TECH-12.3]', async () => {
    const { sortie } = await arrivedAndLockable();
    const harness = await resume(sortie, 'Verge Belt');

    const entry = objectEntry(/Pirate Scout/);
    entry.focus();
    await harness.user.keyboard('{Shift>}{F10}{/Shift}');
    const menu = await screen.findByRole('group', { name: 'Commands for Pirate Scout' });
    expect(menu.contains(document.activeElement)).toBe(true);

    await harness.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Commands for Pirate Scout' })).not.toBeInTheDocument();
    });
    expect(entry).toHaveFocus();

    harness.gateway.dispose();
  });
});

describe('wrecks and loot', () => {
  it('opens a reachable wreck and takes everything the hold accepts [FUNC-9.11, FUNC-6.2, MVP-AC-06]', async () => {
    const sortie = await startSortie();
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await destroyOpponent(sortie, opponent);
    const wreckId = await reachWreck(sortie);
    await closeSortie(sortie);
    const harness = await resume(sortie, 'Verge Belt');

    expect(within(panel('Encounter')).getByText(/^Site cleared: 3,000 ISK paid/)).toBeInTheDocument();

    await harness.user.click(objectEntry(/Wreck/));
    const loot = panel('Wreck');
    expect(loot).toHaveAttribute('data-wreck', wreckId);
    expect(await within(loot).findByRole('button', { name: 'Take 2 x Burned Alloy Plate' })).toBeEnabled();

    await harness.user.click(within(loot).getByRole('button', { name: /^Take all/ }));
    expect(await within(loot).findByText('The wreck is empty.')).toBeInTheDocument();

    const assets = await harness.gateway.request('assets.list', EMPTY_PAYLOAD);
    const cargo = assets.ok
      ? (assets.data as AssetsData).inventories.find(
          (inventory) => inventory.location.kind === 'cargo' && inventory.location.shipId === assets.data.activeShipId,
        )
      : undefined;
    expect(cargo?.stacks.find((stack) => stack.item.definitionId === 'item.salvage.alloy')?.quantity).toBe(2);

    harness.gateway.dispose();
  });

  it('explains why a distant wreck cannot be opened and offers the approach [FUNC-9.11, FUNC-22.10]', async () => {
    const sortie = await startSortie();
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await destroyOpponent(sortie, opponent);
    // Stand off before closing, so the wreck is out of reach.
    const encounter = await sortie.data<EncounterData>('encounter.state');
    const wreck = encounter.wrecks[0];
    if (wreck === undefined) throw new Error('No wreck.');
    await sortie.data('movement.keepRange', { targetId: wreck.wreckId, distanceKm: 5 });
    await sortie.until(async () => {
      const current = await sortie.data<EncounterData>('encounter.state');
      return (current.wrecks[0]?.rangeFromPlayerKm ?? 0) > 3;
    }, 120);
    await closeSortie(sortie);
    const harness = await resume(sortie, 'Verge Belt');

    await harness.user.click(objectEntry(/Wreck/));
    const loot = panel('Wreck');
    expect(within(loot).getByText('Move within 1 km of the wreck to take its contents.')).toBeInTheDocument();
    expect(within(loot).queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();

    await harness.user.click(within(loot).getByRole('button', { name: /^Approach to open/ }));
    await waitFor(async () => {
      const response = await harness.gateway.request('navigation.site', EMPTY_PAYLOAD);
      expect(response.ok && response.data.movementOrder).toMatchObject({
        kind: 'approach',
        targetId: wreck.wreckId,
        distanceKm: response.ok ? response.data.rangePresetsKm[0] : -1,
      });
    });

    harness.gateway.dispose();
  });
});

describe('home again', () => {
  it('shows what the sortie earned and what the hold carries [FUNC-9.11, MVP-AC-06, MVP-AC-09]', async () => {
    const sortie = await startSortie();
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await destroyOpponent(sortie, opponent);
    const wreckId = await reachWreck(sortie);
    const contents = await sortie.data<{ stacks: readonly { id: string; quantity: number }[] }>('loot.contents', { wreckId });
    for (const stack of contents.stacks) {
      await sortie.data('loot.take', { wreckId, stackId: stack.id, quantity: stack.quantity });
    }
    await returnHome(sortie);
    await closeSortie(sortie);
    const harness = await resume(sortie, 'Borrell Harbour');

    const summary = panel('Last sortie');
    expect(
      within(summary).getByText('Pirate Scout cleared: 1 of 1 opponents destroyed, 3,000 ISK in bounties.'),
    ).toBeInTheDocument();
    expect(within(summary).getByText('2 x Burned Alloy Plate')).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
    const scout = document.querySelector('[data-disclosure="encounter.borrell.pirate-scout"]');
    if (!(scout instanceof HTMLElement)) throw new Error('The scout site discloses nothing.');
    expect(within(scout).getByText('1 x Pirate Scout (Skirmisher), 3,000 ISK each')).toBeInTheDocument();
    expect(within(scout).getByText('Total bounty 3,000 ISK')).toBeInTheDocument();
    expect(within(scout).getByText('Possible loot: Fusion S, Burned Alloy Plate')).toBeInTheDocument();
    expect(within(scout).getByText('Cleared 1 times')).toBeInTheDocument();

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  });
});

describe('before leaving', () => {
  it('warns before undocking with an unloaded weapon, without blocking it [FUNC-10, MVP-AC-02]', async () => {
    const sortie = await startSortie();
    const assets = await sortie.data<AssetsData>('assets.list');
    await sortie.data('fitting.begin', { shipId: assets.activeShipId });
    // The same gun, fitted with no charge in its magazine.
    await sortie.data('fitting.set', {
      slotKind: 'weapon',
      slotIndex: 0,
      moduleId: 'module.turret.autocannon.small',
      online: true,
    });
    await sortie.data('fitting.commit');
    await closeSortie(sortie);
    const harness = await resume(sortie, 'Borrell Harbour');

    await harness.user.click(screen.getByRole('button', { name: 'Departure' }));
    const warnings = await screen.findByRole('list', { name: 'Before you undock' });
    expect(
      within(warnings).getByText('Weapon 1: This weapon has no ammunition loaded. Load a charge under Fitting.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Undock/ })).toBeEnabled();

    harness.gateway.dispose();
  });
});

describe('returning to a reopened campaign', () => {
  it('reads the market again on docking after the campaign was reopened in space [MVP-AC-06, FUNC-11.3, TECH-7.3]', async () => {
    const sortie = await startSortie();
    await loadAmmunition(sortie);
    await sortie.data('ship.undock');
    await closeSortie(sortie);
    const harness = await resume(sortie, 'Borrell Harbour');
    await screen.findByRole('heading', { name: 'Commands' });

    // Docking takes simulation time, so the clock runs through the frame.
    await harness.user.click(screen.getByRole('button', { name: /^Resume/ }));
    await harness.user.click(screen.getByRole('button', { name: /^Dock/ }));
    expect(await screen.findByText('Docked at Borrell Harbour', {}, { timeout: 20_000 })).toBeInTheDocument();
    await harness.user.click(screen.getByRole('button', { name: /^Pause/ }));

    await harness.user.click(screen.getByRole('button', { name: 'Market' }));
    expect(await screen.findByRole('button', { name: 'Sell Fusion S' })).toBeEnabled();

    harness.gateway.dispose();
  }, 30_000);
});

describe('text', () => {
  it('resolves every key the combat surfaces ask for [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const sortie = await startSortie();
    const opponent = await arriveAtScout(sortie);
    await lockOpponent(sortie, opponent);
    await sortie.data('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponent });
    await sortie.data('module.activate', { slotKind: 'system', slotIndex: 0 });
    await sortie.until(async () => false, 8);
    await closeSortie(sortie);
    const harness = await resume(sortie, 'Verge Belt');
    void onIssue;

    await harness.user.click(objectEntry(/Pirate Scout/));
    for (const summary of document.querySelectorAll('summary')) {
      await harness.user.click(summary);
    }
    await harness.user.keyboard('b');

    expect(harness.issues).toEqual([]);
    harness.gateway.dispose();
  });
});
