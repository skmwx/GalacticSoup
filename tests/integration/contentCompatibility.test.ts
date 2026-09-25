import { describe, expect, it } from 'vitest';

import { createContentRepository, parseContentBundle } from '@adapters/content';
import { DEFAULT_SLOT_ID, loadSave, type ContentRepository } from '@engine';
import type { DestinationsData, EncounterData, SiteData } from '@protocol';

import { readContentFiles } from '../../scripts/lib/content/read.mjs';
import { shippedContent } from '../support/content.ts';
import { compilePack, editDocument, type ContentFile } from '../support/contentFixtures.ts';
import { assembleFit } from '../support/progression/assemble.ts';
import { fixtureFit, fixtureScenario } from '../support/progression/fixtures.ts';
import { openSession, type ScenarioSession } from '../support/progression/session.ts';

/**
 * A campaign against changed content (MVP Implementation Plan phase 16;
 * Technical Specification 11.4).
 *
 * Content-version changes keep stable ids, so a development campaign keeps
 * opening; a balance-only edit is adopted for what happens next. A structural
 * edit that removes a definition the campaign still names makes it unopenable,
 * which is acceptable before release - but the loader must refuse it with the
 * definition it could not resolve rather than open it.
 *
 * The campaign here is saved in the middle of the multi-opponent site, the
 * point at which it names the most new content: the opponents' profiles and
 * loot tables as well as the encounter and its site.
 */

const content = shippedContent();
const PATROL = 'encounter.borrell.pirate-patrol';
const CUTTER = 'npc.pirate.cutter';

function compile(files: readonly ContentFile[]): ContentRepository {
  const result = compilePack(files, { floor: true });
  if (!result.ok || result.bundle === null) {
    throw new Error(`The edited content did not compile: ${result.issues.map((issue) => issue.detail).join('; ')}`);
  }
  return createContentRepository(parseContentBundle(result.bundle), { freeze: true });
}

/** The shipped content with the cutter bounty retuned: a balance-only change. */
function retunedContent(bountyCredits: number): ContentRepository {
  return compile(editDocument(readContentFiles() as ContentFile[], 'encounters/npcs/pirates.json', (document) => {
    const profile = (document['definitions'] as Record<string, unknown>[]).find((entry) => entry['id'] === CUTTER);
    if (profile === undefined) throw new Error('No cutter profile.');
    profile['bountyCredits'] = bountyCredits;
  }));
}

/** The shipped content with the cutter profile removed: a structural change. */
function contentWithoutCutter(): ContentRepository {
  let files = editDocument(readContentFiles() as ContentFile[], 'encounters/npcs/pirates.json', (document) => {
    document['definitions'] = (document['definitions'] as Record<string, unknown>[])
      .filter((entry) => entry['id'] !== CUTTER);
  });
  files = editDocument(files, 'encounters/templates/borrell.json', (document) => {
    const patrol = (document['definitions'] as Record<string, unknown>[]).find((entry) => entry['id'] === PATROL);
    if (patrol === undefined) throw new Error('No patrol encounter.');
    patrol['spawns'] = [
      { npcProfileId: 'npc.pirate.scout', count: 2, spawnDistanceKm: 16 },
      { npcProfileId: 'npc.pirate.marksman', count: 1, spawnDistanceKm: 30 },
    ];
  });
  return compile(files);
}

/** Flies the intermediate fit into the patrol and saves there. */
async function savedInsidePatrol(): Promise<{ session: ScenarioSession; snapshot: unknown }> {
  const scenario = fixtureScenario('patrol.intermediate');
  const assembled = assembleFit(fixtureFit(scenario.fitId), scenario.seeds[0] ?? '', content);
  const session = await openSession(assembled.state, content);
  const siteId = content.requireEncounter(PATROL as never).siteId;
  await session.data('navigation.selectDestination', { encounterId: PATROL });
  await session.data('ship.undock');
  await session.data('navigation.warp', { destinationSiteId: siteId, arrivalDistanceKm: 10 });
  await session.data('time.set', { paused: false, rate: 1 });
  for (let step = 0; step < 240; step += 1) {
    const site = await session.data<SiteData>('navigation.site');
    if (site.location.kind === 'site' && site.location.siteId === siteId) break;
    await session.advance(500);
  }
  const encounter = await session.data<EncounterData>('encounter.state');
  expect(encounter.instance?.npcs.map((npc) => npc.profileId)).toContain(CUTTER);

  await session.data('time.set', { paused: true, rate: 1 });
  await session.data('campaign.save', { kind: 'auto', savedAtRealMs: 1_700_000_200_000 });
  const manifest = await session.saves.readManifest(DEFAULT_SLOT_ID);
  const newest = manifest?.saves[0];
  if (newest === undefined) throw new Error('Nothing was saved.');
  return { session, snapshot: await session.saves.readSave(DEFAULT_SLOT_ID, newest.saveId) };
}

describe('a campaign against changed content', () => {
  it('opens after a balance-only change and adopts the installed values [TECH-11.4, TECH-18]', async () => {
    const { snapshot } = await savedInsidePatrol();
    const retuned = retunedContent(6_500);

    const loaded = loadSave(snapshot, { content: retuned });
    if (!loaded.ok) throw new Error(`A balance-only change refused the campaign: ${loaded.error.messageKey}`);
    expect(loaded.contentChanged).toBe(true);

    // What the station now discloses is the installed bounty.
    const reopened = await openSession(loaded.state, retuned);
    const destinations = await reopened.data<DestinationsData>('navigation.destinations');
    const patrol = destinations.destinations.find((entry) => entry.encounterId === PATROL);
    expect(patrol?.spawns.find((spawn) => spawn.npcProfileId === CUTTER)?.bountyCredits).toBe(6_500);
  }, 60_000);

  it('refuses to open after a structural change, naming the definition it lost [TECH-11.4, TECH-5.1]', async () => {
    const { snapshot } = await savedInsidePatrol();

    const refused = loadSave(snapshot, { content: contentWithoutCutter() });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('CONTENT_ERROR');
    expect(refused.error.messageKey).toBe('error.saveLoad.contentIncompatible');
    expect(refused.error.params?.['firstMissing']).toBe(CUTTER);
    // The shipped content still opens the same snapshot untouched.
    expect(loadSave(snapshot, { content }).ok).toBe(true);
  }, 60_000);
});
