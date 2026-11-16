import { describe, expect, it } from 'vitest';

import type { AssetsData } from '@protocol';

import { shippedContent } from '../../support/content.ts';
import { writeBalanceSection } from '../../support/balance/report.ts';
import { matrixScenario, MATRIX } from '../../support/balance/matrix.ts';
import { assembleFit } from '../../support/progression/assemble.ts';
import { referenceFixtureFit } from '../../support/progression/ladder.ts';
import { flySortie, refit } from '../../support/progression/scenario.ts';
import { openSession } from '../../support/progression/session.ts';
import type { FixtureScenario } from '../../support/progression/fixtures.ts';

/**
 * Selective kills followed by retreat (v0.2 Implementation Plan phase 6;
 * FeatureSpec02 8.2).
 *
 * Every arrival starts a fresh attempt, so a pilot may kill the one opponent
 * worth killing, warp out and come back to a new group. That repeatability is
 * deliberate; this file checks it is not an exploit. The railgun cruiser,
 * which clears the Command Group on every matrix seed, flies it three times
 * in a row on each seed, once clearing it and once killing only the
 * controller before retreating. Measured per simulated minute
 * from undocking to the next undocking - travel, repair and resupply included,
 * bounties only and no looting on either side -
 * clearing the site must pay at least as well as the selective raid.
 */

const content = shippedContent();
const FIT = 'fit.cruiser.railgun';
const SITE = 'encounter.borrell.command-group';
const SORTIES = 3;
const SEEDS = MATRIX.seeds.slice(0, 2);

interface Rate {
  readonly credits: number;
  readonly minutes: number;
  readonly bounties: readonly number[];
  readonly statuses: readonly string[];
}

async function fly(scenario: FixtureScenario, seed: string): Promise<Rate> {
  const fit = referenceFixtureFit(FIT, content);
  const session = await openSession(assembleFit(fit, seed, content).state, content);
  const credits = async (): Promise<number> => (await session.data<AssetsData>('assets.list')).credits;
  const startCredits = await credits();
  const startMs = session.simulationTimeMs;
  const bounties: number[] = [];
  const statuses: string[] = [];
  for (let sortie = 1; sortie <= SORTIES; sortie += 1) {
    const record = await flySortie(session, scenario, content, seed, sortie, { loot: false });
    bounties.push(record.bountyCredits);
    statuses.push(record.status);
    await refit(session, fit, content);
  }
  // Neither strategy loots: the raid cannot, and looting would add time to clearing whose value this does not count.
  return {
    credits: (await credits()) - startCredits,
    minutes: (session.simulationTimeMs - startMs) / 60_000,
    bounties,
    statuses,
  };
}

describe('selective kills and retreat', () => {
  it('pay no better than clearing the site, however often they are repeated [V02-AC-12, V02-AC-09, FUNC-9.11]', async () => {
    const full = matrixScenario(FIT, SITE, SEEDS);
    const raid: FixtureScenario = {
      ...full,
      id: `${FIT}@${SITE}:raid`,
      tactics: { ...full.tactics, leaveOnceKilled: ['npc.pirate.snare'] },
    };
    const rows = [];
    let fullRate = 0;
    let raidRate = 0;
    for (const seed of SEEDS) {
      const cleared = await fly(full, seed);
      const raided = await fly(raid, seed);
      expect(cleared.statuses.every((status) => status === 'completed'), JSON.stringify(cleared)).toBe(true);
      expect(raided.statuses.every((status) => status === 'retreated'), JSON.stringify(raided)).toBe(true);
      // Each raid met a fresh group and was paid the controller's bounty once.
      const snare = content.requireNpcProfile('npc.pirate.snare' as never).bountyCredits;
      expect(raided.bounties).toEqual(raided.bounties.map(() => snare));
      fullRate += cleared.credits / cleared.minutes;
      raidRate += raided.credits / raided.minutes;
      rows.push({ seed, cleared, raided });
    }
    const perMinute = (rate: Rate): string => `${(rate.credits / rate.minutes).toFixed(0)} credits/min (${rate.credits.toFixed(0)} in ${rate.minutes.toFixed(1)} min)`;
    writeBalanceSection('selective-kills', {
      kind: 'figures',
      title: 'Selective kills and retreat at the Command Group',
      description: `The railgun cruiser flies ${String(SORTIES)} consecutive sorties per seed, clearing the site or killing only the controller and retreating. Income per simulated minute from undocking to the next undocking, net of repair and resupply. Neither strategy loots, so both are bounty against time.`,
      rows: rows.flatMap((row) => [
        { label: `seed ${row.seed.slice(0, 6)}: clearing`, value: perMinute(row.cleared) },
        { label: `seed ${row.seed.slice(0, 6)}: controller only, then retreat`, value: perMinute(row.raided) },
      ]),
    });
    expect(
      raidRate,
      `raiding earned ${(raidRate / SEEDS.length).toFixed(0)} credits a minute against ${(fullRate / SEEDS.length).toFixed(0)} for clearing: ${JSON.stringify(rows)}`,
    ).toBeLessThanOrEqual(fullRate);
  }, 1_200_000);
});
