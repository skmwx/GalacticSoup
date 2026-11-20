#!/usr/bin/env node
/**
 * Summarises a V8 CPU profile written by the headless profiler
 * (`PROFILE_CPU=<dir>`, Test Suite Optimization Plan phase 13).
 *
 *   node tests/profiling/cpuProfileSummary.mjs <file.cpuprofile> [--json]
 *
 * Prints self time by area (engine simulation, projections, domain,
 * application, protocol, shared helpers, test drivers, Node and V8), and the
 * inclusive time of the functions that copy, validate and freeze campaign
 * state on every commit. Inclusive time counts a sample once however deeply a
 * named function recurses.
 */
import fs from 'node:fs';
import process from 'node:process';

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('usage: node tests/profiling/cpuProfileSummary.mjs <file.cpuprofile> [--json]\n');
  process.exit(2);
}
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));

/** Functions whose inclusive time the plan asks about, by name. */
const INCLUSIVE = {
  'transaction copy (draftOf)': ['draftOf'],
  'commit validation (validateCampaign)': ['validateCampaign'],
  'boundary validation (validateCampaignBoundary)': ['validateCampaignBoundary'],
  'freeze (deepFreeze)': ['deepFreeze'],
  'deepClone (projections)': ['deepClone'],
  'request validation (validateClientRequest)': ['validateClientRequest'],
  'response check (findTransportViolation)': ['findTransportViolation'],
  'simulation (advanceSimulation/handleAdvanceTime)': ['handleAdvanceTime'],
  'projections (query)': ['query'],
  'ship attribute derivation (deriveShipAttributes)': ['deriveShipAttributes'],
  'inventory scans (stacksIn, usedVolume)': ['stacksIn', 'usedVolume'],
  'pilot (fightEncounter self+children)': ['fightEncounter'],
  'save service (save)': ['save'],
};

function area(url) {
  const normal = url.replaceAll('\\', '/');
  const src = normal.match(/\/src\/([^/]+)\/([^/]+)/);
  if (src !== null) {
    if (src[1] === 'engine') return `src/engine/${src[2]}`;
    return `src/${src[1]}`;
  }
  if (normal.includes('/tests/support/')) return 'tests/support';
  if (normal.includes('/tests/')) return 'tests (other)';
  if (normal.includes('node_modules')) return 'node_modules';
  if (normal.startsWith('node:') || normal === '') return 'node/v8 (native, GC, idle)';
  return 'other';
}

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);

// Sample weights: timeDeltas give the time to each sample.
const weight = new Map();
const deltas = profile.timeDeltas ?? [];
for (let index = 0; index < profile.samples.length; index += 1) {
  const id = profile.samples[index];
  const delta = Math.max(0, deltas[index + 1] ?? deltas[index] ?? 0);
  weight.set(id, (weight.get(id) ?? 0) + delta);
}

const byArea = new Map();
const inclusive = new Map(Object.keys(INCLUSIVE).map((key) => [key, 0]));
let total = 0;
let idle = 0;
for (const [id, us] of weight) {
  const node = nodes.get(id);
  const name = node.callFrame.functionName;
  total += us;
  if (name === '(idle)' || name === '(program)') idle += us;
  const key = area(node.callFrame.url);
  byArea.set(key, (byArea.get(key) ?? 0) + us);
  const stack = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) stack.add(nodes.get(at).callFrame.functionName);
  for (const [label, names] of Object.entries(INCLUSIVE)) {
    if (names.some((wanted) => stack.has(wanted))) inclusive.set(label, inclusive.get(label) + us);
  }
}

const ms = (us) => Math.round(us / 1000);
const pct = (us) => `${((us / total) * 100).toFixed(1)}%`;
const summary = {
  file,
  totalMs: ms(total),
  idleOrProgramMs: ms(idle),
  selfByArea: Object.fromEntries([...byArea].sort((a, b) => b[1] - a[1]).map(([key, us]) => [key, { ms: ms(us), share: pct(us) }])),
  inclusive: Object.fromEntries([...inclusive].map(([key, us]) => [key, { ms: ms(us), share: pct(us) }])),
};

// The hottest functions by self time, for a closer look.
const selfByFunction = new Map();
for (const [id, us] of weight) {
  const frame = nodes.get(id).callFrame;
  const key = `${frame.functionName || '(anonymous)'} ${frame.url.replace(/.*\/(src|tests)\//, '$1/')}:${String(frame.lineNumber + 1)}`;
  selfByFunction.set(key, (selfByFunction.get(key) ?? 0) + us);
}
summary.topSelf = [...selfByFunction].sort((a, b) => b[1] - a[1]).slice(0, 25)
  .map(([key, us]) => ({ fn: key, ms: ms(us), share: pct(us) }));

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(`${file}\ntotal ${String(summary.totalMs)} ms (idle/program ${String(summary.idleOrProgramMs)} ms)\n\nself time by area\n`);
  for (const [key, value] of Object.entries(summary.selfByArea)) process.stdout.write(`  ${String(value.ms).padStart(8)} ms ${value.share.padStart(6)}  ${key}\n`);
  process.stdout.write('\ninclusive time\n');
  for (const [key, value] of Object.entries(summary.inclusive)) process.stdout.write(`  ${String(value.ms).padStart(8)} ms ${value.share.padStart(6)}  ${key}\n`);
  process.stdout.write('\nhottest functions (self)\n');
  for (const row of summary.topSelf) process.stdout.write(`  ${String(row.ms).padStart(8)} ms ${row.share.padStart(6)}  ${row.fn}\n`);
}
