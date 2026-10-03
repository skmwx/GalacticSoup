import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { SaveEnvelope } from '@engine';

import { REPO_ROOT } from '../../../config/aliases.mjs';

import { GOLDEN_STATES, type GoldenRun, type GoldenState } from './campaign.ts';
import type { ReplayLog } from './recording.ts';

/**
 * The recorded golden campaign on disk (Technical Specification 11.4, 15.1).
 *
 * `tests/fixtures/replays/golden-campaign.json` is the replay log and
 * `tests/fixtures/saves/golden/<state>.json` are the saves captured along it.
 * They are written only by `npm run golden:record`.
 */

export const GOLDEN_REPLAY_FILE = path.join(REPO_ROOT, 'tests', 'fixtures', 'replays', 'golden-campaign.json');
export const GOLDEN_SAVE_DIRECTORY = path.join(REPO_ROOT, 'tests', 'fixtures', 'saves', 'golden');

export function goldenSaveFile(state: GoldenState): string {
  return path.join(GOLDEN_SAVE_DIRECTORY, `${state}.json`);
}

export function goldenFixturesExist(): boolean {
  return existsSync(GOLDEN_REPLAY_FILE) && GOLDEN_STATES.every((state) => existsSync(goldenSaveFile(state)));
}

export function readGoldenLog(): ReplayLog {
  return JSON.parse(readFileSync(GOLDEN_REPLAY_FILE, 'utf8')) as ReplayLog;
}

export function readGoldenSave(state: GoldenState): SaveEnvelope {
  return JSON.parse(readFileSync(goldenSaveFile(state), 'utf8')) as SaveEnvelope;
}

export function readGoldenSaves(): Record<GoldenState, SaveEnvelope> {
  return Object.fromEntries(GOLDEN_STATES.map((state) => [state, readGoldenSave(state)])) as Record<
    GoldenState,
    SaveEnvelope
  >;
}

export function writeGoldenRun(run: GoldenRun): void {
  mkdirSync(path.dirname(GOLDEN_REPLAY_FILE), { recursive: true });
  mkdirSync(GOLDEN_SAVE_DIRECTORY, { recursive: true });
  writeFileSync(GOLDEN_REPLAY_FILE, renderLog(run.log), 'utf8');
  for (const state of GOLDEN_STATES) {
    writeFileSync(goldenSaveFile(state), `${JSON.stringify(run.saves[state], null, 1)}\n`, 'utf8');
  }
}

/** One step and one checkpoint per line: the log is long, and a diff of it should read. */
export function renderLog(log: ReplayLog): string {
  const { steps, checkpoints, ...header } = log;
  const head = JSON.stringify(header, null, 2).replace(/\n\}$/, ',');
  const lines = (entries: readonly unknown[]): string =>
    entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  return `${head}\n  "steps": [\n${lines(steps)}\n  ],\n  "checkpoints": [\n${lines(checkpoints)}\n  ]\n}\n`;
}
