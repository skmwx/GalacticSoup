import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';

import { it, vi } from 'vitest';

import type { EngineHost } from '@engine';

import { careerFixture, runCareer } from '../support/balance/career.ts';
import { measureCell } from '../support/balance/matrix.ts';
import { careerSummary, writeBalanceSection } from '../support/balance/report.ts';
import { shippedContent } from '../support/content.ts';
import { MATRIX } from '../support/balance/matrix.ts';

/**
 * Where one headless release workload spends its time (Test Suite
 * Optimization Plan phase 13). Run through `vitest.profile.config.ts`; it
 * asserts nothing and belongs to no test project.
 *
 * Every engine host the drivers open is wrapped, so each request is timed by
 * its type. Time outside the host is the drivers' own work: the pilot's
 * decisions, record keeping and the cell or career arithmetic. Report
 * serialization is timed separately, into a temporary directory.
 *
 * `PROFILE_CHECKS=lightweight` opens the hosts with the production commit
 * check instead of complete invariant validation, to measure what complete
 * validation costs. The result JSON is written either way, so two runs can
 * be compared figure for figure.
 */

interface Bucket {
  count: number;
  ms: number;
}

const timing = vi.hoisted(() => ({
  byType: new Map<string, { count: number; ms: number }>(),
  hosts: 0,
}));

vi.mock('@engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@engine')>();
  const checks = process.env['PROFILE_CHECKS'];
  return {
    ...original,
    createEngineHost: (options: Parameters<typeof original.createEngineHost>[0]): EngineHost => {
      timing.hosts += 1;
      const host = original.createEngineHost(
        checks === 'lightweight' || checks === 'complete' ? { ...options, invariantChecks: checks } : options,
      );
      return {
        ...host,
        handle: async (message: unknown) => {
          const type = typeof message === 'object' && message !== null && 'type' in message
            ? String((message as { type: unknown }).type)
            : '?';
          const started = performance.now();
          try {
            return await host.handle(message);
          } finally {
            const bucket = timing.byType.get(type) ?? { count: 0, ms: 0 };
            bucket.count += 1;
            bucket.ms += performance.now() - started;
            timing.byType.set(type, bucket);
          }
        },
      } as EngineHost;
    },
  };
});

/** The pilot's per-decision reads during a fight, and the reads around it. */
const FIGHT_QUERIES = new Set(['navigation.site', 'encounter.state', 'combat.state']);

function parseTarget(raw: string): { kind: 'cell' | 'career'; id: string; seeds: number | null } {
  const [spec, count] = raw.split('#');
  const colon = (spec ?? '').indexOf(':');
  const kind = (spec ?? '').slice(0, colon);
  if (kind !== 'cell' && kind !== 'career') throw new Error(`PROFILE_TARGET must be cell:<fit>@<site> or career:<id>, not "${raw}".`);
  return { kind, id: (spec ?? '').slice(colon + 1), seeds: count === undefined ? null : Number(count) };
}

it('profiles one headless workload', async () => {
  const target = parseTarget(process.env['PROFILE_TARGET'] ?? 'cell:fit.cruiser.railgun@encounter.borrell.screened-battery');
  const out = process.env['PROFILE_OUT'] ?? path.join(os.tmpdir(), 'headless-profile.json');
  const content = shippedContent();

  // A V8 CPU profile of the workload alone, through the inspector: a forked
  // worker is torn down before `--cpu-prof` would write one.
  const cpuDir = process.env['PROFILE_CPU'];
  const inspector = cpuDir === undefined ? null : new Session();
  const post = (method: string, params?: object): Promise<unknown> => new Promise((resolve, reject) => {
    inspector?.post(method, params, (error, answer) => { if (error) reject(error); else resolve(answer); });
  });
  if (inspector !== null) {
    inspector.connect();
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 500 });
    await post('Profiler.start');
  }

  const started = performance.now();
  let result: unknown;
  let section: Parameters<typeof writeBalanceSection>[1];
  if (target.kind === 'cell') {
    const at = target.id.indexOf('@');
    const seeds = target.seeds === null ? MATRIX.seeds : MATRIX.seeds.slice(0, target.seeds);
    const cell = await measureCell(target.id.slice(0, at), target.id.slice(at + 1), content, seeds);
    result = cell;
    section = { kind: 'matrix', title: 'profile', encounterId: target.id.slice(at + 1), cells: [cell], verdicts: [] };
  } else {
    const fixture = careerFixture(target.id);
    const career = target.seeds === null ? fixture : { ...fixture, seeds: fixture.seeds.slice(0, target.seeds) };
    const runs = await runCareer(career, content);
    result = runs;
    section = { kind: 'careers', title: 'profile', careers: [careerSummary(career, runs)] };
  }
  const workloadMs = performance.now() - started;
  if (inspector !== null && cpuDir !== undefined) {
    const { profile: cpu } = await post('Profiler.stop') as { profile: unknown };
    inspector.disconnect();
    fs.mkdirSync(cpuDir, { recursive: true });
    fs.writeFileSync(path.join(cpuDir, 'workload.cpuprofile'), JSON.stringify(cpu), 'utf8');
  }

  // Report serialization, as the suites do it, into a throwaway directory.
  const sections = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-sections-'));
  const previous = process.env['BALANCE_SECTIONS_DIR'];
  process.env['BALANCE_SECTIONS_DIR'] = sections;
  const serializeStarted = performance.now();
  writeBalanceSection('profile', section);
  const serializeMs = performance.now() - serializeStarted;
  if (previous === undefined) delete process.env['BALANCE_SECTIONS_DIR'];
  else process.env['BALANCE_SECTIONS_DIR'] = previous;
  const sectionBytes = fs.statSync(path.join(sections, 'profile.json')).size;
  fs.rmSync(sections, { recursive: true, force: true });

  const total = (pick: (type: string) => boolean): Bucket => {
    const sum = { count: 0, ms: 0 };
    for (const [type, bucket] of timing.byType) {
      if (!pick(type)) continue;
      sum.count += bucket.count;
      sum.ms += bucket.ms;
    }
    return sum;
  };
  const host = total(() => true);
  const advance = total((type) => type === 'time.advance');
  const fightQueries = total((type) => FIGHT_QUERIES.has(type));
  const otherQueries = total((type) => type !== 'time.advance' && !FIGHT_QUERIES.has(type) && !type.includes('.confirm') &&
    !type.startsWith('movement.') && !type.startsWith('targeting.') && !type.startsWith('weapon.') && !type.startsWith('module.'));
  const round = (bucket: Bucket): Bucket => ({ count: bucket.count, ms: Math.round(bucket.ms) });

  const profile = {
    target: process.env['PROFILE_TARGET'] ?? null,
    checks: process.env['PROFILE_CHECKS'] ?? 'complete',
    node: process.version,
    cpus: os.cpus().length,
    hostsOpened: timing.hosts,
    workloadMs: Math.round(workloadMs),
    hostMs: Math.round(host.ms),
    driverMs: Math.round(workloadMs - host.ms),
    requests: host.count,
    timeAdvance: round(advance),
    fightQueries: round(fightQueries),
    otherQueries: round(otherQueries),
    commands: round({ count: host.count - advance.count - fightQueries.count - otherQueries.count,
      ms: host.ms - advance.ms - fightQueries.ms - otherQueries.ms }),
    serialize: { ms: Math.round(serializeMs * 10) / 10, bytes: sectionBytes },
    byType: Object.fromEntries([...timing.byType].sort((a, b) => b[1].ms - a[1].ms)
      .map(([type, bucket]) => [type, round(bucket)])),
    result,
  };
  fs.writeFileSync(out, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  process.stdout.write(`PROFILE ${JSON.stringify({ ...profile, byType: undefined, result: undefined })}\n`);
});
