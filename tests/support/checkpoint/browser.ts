import { expect, type Locator, type Page } from '@playwright/test';

import { SAVE_DATABASE_NAME, SAVE_DATABASE_VERSION } from '@adapters/persistence';
import type { SaveEnvelope, SlotManifest } from '@engine';

import {
  prepareCheckpoint,
  type Checkpoint,
  type CheckpointName,
  type SiteCheckpointFacts,
  type StationCheckpointFacts,
} from './scenarios.ts';
import { servedContent } from './servedContent.ts';

/**
 * Opens a browser test at a saved checkpoint (Test Suite Optimization Plan
 * phases 3 and 4; Technical Specification 11.1, 15.1).
 *
 * 1. The checkpoint is generated headlessly from the content compiled into
 *    the served build, and verified: save format, content identity, checksum,
 *    and the projection a resume answers with (`scenarios.ts`). It is made
 *    once per Playwright worker and reused.
 * 2. In the test's own fresh browser context, an inert same-origin page - a
 *    document the test serves itself, which loads no application code and so
 *    starts no worker - creates the save database exactly as the IndexedDB
 *    store does and writes the slot manifest and the snapshot. It refuses an
 *    origin that already has a save database, so a checkpoint never lands on
 *    state left by anything else.
 * 3. The test then loads the application and resumes the campaign through
 *    the real start screen and engine worker, and the helper checks the
 *    interface shows the promised state before handing over.
 *
 * Only this test tooling touches storage: the production bundle has no seeding
 * entry and no test control.
 */

/** A path the served build does not have; the test answers it itself. */
const SETUP_PATH = '/__checkpoint-setup__';
const SETUP_DOCUMENT = '<!doctype html><html lang="en"><head><title>Checkpoint setup</title></head><body></body></html>';

/** Site names the interface shows for the sites checkpoints are taken in. */
const SITE_HEADINGS: Readonly<Record<string, string>> = {
  'site.borrell.verge': 'Verge Belt',
};

const checkpoints = new Map<string, Promise<Checkpoint>>();

/** The named checkpoint against the served build's content, made once per worker. */
export async function checkpointFor(name: CheckpointName, baseURL: string): Promise<Checkpoint> {
  const content = await servedContent(baseURL);
  const key = `${name}:${content.contentHash}`;
  let found = checkpoints.get(key);
  if (found === undefined) {
    found = prepareCheckpoint(name, content);
    checkpoints.set(key, found);
  }
  return found;
}

interface SeedResult {
  readonly fresh: boolean;
  readonly storedSaveId: string | null;
  readonly storedChecksum: string | null;
  readonly manifestSaveIds: readonly string[];
}

/**
 * Writes the checkpoint's manifest and snapshot into the page's origin from
 * the inert setup page, the way `createIndexedDbSaveStore` lays them out.
 */
export async function seedCheckpoint(page: Page, checkpoint: Checkpoint): Promise<void> {
  await page.route(`**${SETUP_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SETUP_DOCUMENT }));
  try {
    await page.goto(SETUP_PATH);
    const result = await page.evaluate(
      async ({ databaseName, databaseVersion, manifest, envelope }: {
        databaseName: string; databaseVersion: number; manifest: SlotManifest; envelope: SaveEnvelope;
      }): Promise<SeedResult> => {
        const done = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error('The seeding transaction aborted.'));
        });
        let fresh = false;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(databaseName, databaseVersion);
          // The same stores and keys as src/adapters/persistence/indexedDbSaveStore.ts.
          // It runs only when the origin had no database at all.
          open.onupgradeneeded = (event) => {
            fresh = event.oldVersion === 0;
            const created = open.result;
            created.createObjectStore('manifests', { keyPath: 'slotId' });
            created.createObjectStore('snapshots', { keyPath: 'saveId' }).createIndex('slotId', 'slotId', { unique: false });
            created.createObjectStore('diagnostics', { keyPath: 'key' });
          };
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
          open.onblocked = () => reject(new Error('The save database is held open.'));
        });
        if (!fresh) {
          db.close();
          return { fresh, storedSaveId: null, storedChecksum: null, manifestSaveIds: [] };
        }
        const write = db.transaction(['manifests', 'snapshots'], 'readwrite');
        write.objectStore('snapshots').put({ saveId: envelope.saveId, slotId: envelope.slotId, document: envelope });
        write.objectStore('manifests').put(manifest);
        await done(write);

        const read = db.transaction(['manifests', 'snapshots'], 'readonly');
        const snapshot = read.objectStore('snapshots').get(envelope.saveId);
        const slot = read.objectStore('manifests').get(manifest.slotId);
        await done(read);
        db.close();
        const stored = snapshot.result as { saveId: string; document: { checksum: string } } | undefined;
        const storedManifest = slot.result as SlotManifest | undefined;
        return {
          fresh,
          storedSaveId: stored?.saveId ?? null,
          storedChecksum: stored?.document.checksum ?? null,
          manifestSaveIds: storedManifest?.saves.map((save) => save.saveId) ?? [],
        };
      },
      {
        databaseName: SAVE_DATABASE_NAME,
        databaseVersion: SAVE_DATABASE_VERSION,
        manifest: checkpoint.manifest,
        envelope: checkpoint.envelope,
      },
    );
    if (!result.fresh) {
      throw new Error(`Checkpoint "${checkpoint.name}": the browser context already has a save database; seed only a fresh context.`);
    }
    if (result.storedSaveId !== checkpoint.envelope.saveId || result.storedChecksum !== checkpoint.envelope.checksum) {
      throw new Error(`Checkpoint "${checkpoint.name}": the seeded snapshot did not read back intact.`);
    }
    if (JSON.stringify(result.manifestSaveIds) !== JSON.stringify([checkpoint.envelope.saveId])) {
      throw new Error(`Checkpoint "${checkpoint.name}": the seeded manifest does not name the save alone.`);
    }
  } finally {
    await page.unroute(`**${SETUP_PATH}`);
  }
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The wallet readout in the campaign frame, as "<credits> ISK". */
export function walletReadout(page: Page): Locator {
  return page.locator('dt', { hasText: /^Wallet$/ }).locator('xpath=following-sibling::dd[1]');
}

/** Whole credits or units grouped the way the interface's English locale writes them. */
export function grouped(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value);
}

/**
 * Checks that the interface shows what the checkpoint promised, in words, as
 * a player or assistive technology reads them.
 */
export async function expectCheckpointShown(page: Page, checkpoint: Checkpoint, opponent = 'Pirate Scout'): Promise<void> {
  const { facts } = checkpoint;
  if (facts.kind === 'site') await expectSiteShown(page, facts, opponent);
  else await expectStationShown(page, facts);
}

/** In a site: the site, the paused clock, the opponent, its lock state and whether the first weapon is firing. */
async function expectSiteShown(page: Page, facts: SiteCheckpointFacts, opponent: string): Promise<void> {
  const heading = SITE_HEADINGS[facts.siteId];
  if (heading === undefined) throw new Error(`No interface name is known for ${facts.siteId}.`);
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  if (facts.paused) await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  const entry = region(page, 'In this site').getByRole('button', { name: new RegExp(opponent) });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('data-object-entry', facts.opponentId);
  const locked = facts.locks.some((lock) => lock.targetId === facts.opponentId && lock.status === 'locked');
  if (locked) await expect(entry).toContainText('Locked');
  else await expect(region(page, 'In this site').locator('[data-lock]')).toHaveCount(0);
  const weapons = region(page, 'Weapons');
  if (facts.firingAt === facts.opponentId) {
    await expect(weapons.getByText(new RegExp(`^Firing at ${opponent}`)).first()).toBeVisible();
  } else {
    await expect(weapons.getByText(new RegExp(`^Firing at ${opponent}`))).toHaveCount(0);
  }
}

/**
 * Docked: the station, the paused clock, the wallet, the last sortie's outcome
 * and every loose stack the station lists in the hold.
 */
async function expectStationShown(page: Page, facts: StationCheckpointFacts): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: facts.stationName })).toBeVisible();
  if (facts.paused) await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await expect(walletReadout(page)).toHaveText(`${grouped(facts.credits)} ISK`);
  const sortie = region(page, 'Last sortie');
  const outcome = facts.lastOutcome;
  if (outcome !== null) {
    if (outcome.status !== 'completed') throw new Error(`No interface wording is checked for a ${outcome.status} sortie.`);
    await expect(sortie.getByRole('status')).toHaveText(
      `${outcome.name} cleared: ${String(outcome.npcsDestroyed)} of ${String(outcome.npcsTotal)} opponents destroyed, ` +
        `${grouped(outcome.bountyCreditsPaid)} ISK in bounties.`,
    );
  }
  const listed = sortie.locator('[data-hold-item]');
  await expect(listed).toHaveText(facts.hold.map((stack) => `${grouped(stack.quantity)} x ${stack.name}`));
}

/**
 * Seeds the named checkpoint into the test's fresh context, resumes it
 * through the start screen and the worker, and checks the interface shows it.
 */
export async function openCheckpoint(page: Page, name: CheckpointName, baseURL: string | undefined): Promise<Checkpoint> {
  if (baseURL === undefined) throw new Error('A checkpoint needs the served base URL.');
  const checkpoint = await checkpointFor(name, baseURL);
  await seedCheckpoint(page, checkpoint);
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  await page.getByRole('button', { name: 'Resume campaign' }).click();
  await expectCheckpointShown(page, checkpoint);
  return checkpoint;
}
