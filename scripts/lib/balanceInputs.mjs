/**
 * The balance report's inputs, and the rules they must meet
 * (Test Suite Optimization Plan phase 12).
 *
 * The balance simulations write one JSON section each. The report joins them,
 * so it is only as good as the sections it finds: a section left over from an
 * earlier run, measured on other content, flown over an exploratory subset of
 * seeds, or measured twice would otherwise be joined as if it were evidence.
 *
 * Every section is stamped by its writer with the run it belongs to and the
 * content it measured (`tests/support/balance/report.ts`). The release gate
 * gives each integration run a fresh directory with a manifest naming the
 * run, the sources and the content; the report is then assembled from that
 * directory alone. Without a manifest - `npm run balance` writing to
 * `reports/balance/` - every rule but the run's own identity still applies.
 *
 * Nothing here decides a balance figure; it decides only whether the
 * measurements are the complete, current set the fixtures declare.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The directory a balance section writer writes to, when set. */
export const BALANCE_SECTIONS_DIR_ENV = 'BALANCE_SECTIONS_DIR';
/** The run a balance section writer stamps its sections with, when set. */
export const BALANCE_RUN_ID_ENV = 'BALANCE_RUN_ID';
/** The manifest a run directory starts with. */
export const BALANCE_RUN_MANIFEST = 'run.json';

/**
 * @typedef {{ contentVersion: string, contentHash: string, tuningDigest?: string }} ContentIdentity
 * @typedef {{ runId: string, sourceDigest: string, contentVersion: string, contentHash: string, tuningDigest: string, createdAt: string }} BalanceRunManifest
 * @typedef {{
 *   progression: { scenarios: { id: string, fitId: string, encounterId: string, seeds: string[], sorties: number }[] },
 *   careers: { careers: { id: string, seeds: string[] }[] },
 *   matrix: { seeds: string[], policies: Record<string, unknown>, sites: Record<string, unknown>, claims: { id: string, encounterId: string }[] },
 * }} BalanceFixtures
 */

/**
 * Starts a run: removes whatever the directory held and writes its manifest.
 *
 * @param {string} dir
 * @param {{ runId: string, sourceDigest: string, identity: ContentIdentity & { tuningDigest: string }, createdAt?: string }} run
 * @returns {BalanceRunManifest}
 */
export function createBalanceRun(dir, { runId, sourceDigest, identity, createdAt = new Date().toISOString() }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    runId,
    sourceDigest,
    contentVersion: identity.contentVersion,
    contentHash: identity.contentHash,
    tuningDigest: identity.tuningDigest,
    createdAt,
  };
  fs.writeFileSync(path.join(dir, BALANCE_RUN_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

/**
 * @param {string} dir
 * @returns {BalanceRunManifest | null}
 */
export function readBalanceRunManifest(dir) {
  const file = path.join(dir, BALANCE_RUN_MANIFEST);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/**
 * Reads every section in `dir` and holds it to the fixtures.
 *
 * @param {string} dir
 * @param {{ identity: ContentIdentity, fixtures: BalanceFixtures, requireRun?: boolean }} options
 *   `requireRun` asks for a manifest, and for every section to carry its run id.
 * @returns {{
 *   problems: string[],
 *   manifest: BalanceRunManifest | null,
 *   scenarios: Map<string, any>,
 *   careers: Map<string, any>,
 *   matrix: Map<string, any>,
 *   sections: string[],
 * }}
 */
export function readBalanceRun(dir, { identity, fixtures, requireRun = false }) {
  /** @type {string[]} */
  const problems = [];
  const scenarios = new Map();
  const careers = new Map();
  const matrix = new Map();
  const where = new Map();

  const manifest = fs.existsSync(dir) ? readBalanceRunManifest(dir) : null;
  if (requireRun) {
    if (manifest === null) {
      problems.push(`${dir} has no ${BALANCE_RUN_MANIFEST}: it is not a balance run directory.`);
    } else if (manifest.contentHash !== identity.contentHash ||
      (identity.tuningDigest !== undefined && manifest.tuningDigest !== identity.tuningDigest)) {
      problems.push(`the run ${manifest.runId} was started for content ${short(manifest.contentHash)}, not the current ${short(identity.contentHash)}.`);
    }
  }

  const sections = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((file) => file.endsWith('.json') && file !== BALANCE_RUN_MANIFEST).sort()
    : [];

  for (const file of sections) {
    let section;
    try {
      section = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      problems.push(`${file} is not readable JSON: ${error instanceof Error ? error.message : String(error)}.`);
      continue;
    }
    const stamp = section?.run;
    if (stamp === undefined || stamp === null || typeof stamp !== 'object') {
      problems.push(`${file} carries no run stamp: it was written before measurements were stamped. Run the balance simulations again.`);
      continue;
    }
    if (stamp.contentHash !== identity.contentHash || stamp.contentVersion !== identity.contentVersion) {
      problems.push(`${file} measured content ${String(stamp.contentVersion)} (${short(stamp.contentHash)}), not the current ${identity.contentVersion} (${short(identity.contentHash)}): it is stale.`);
      continue;
    }
    if (requireRun && manifest !== null && stamp.runId !== manifest.runId) {
      problems.push(`${file} belongs to run ${String(stamp.runId)}, not to this run ${manifest.runId}: it is stale.`);
      continue;
    }

    const claim = (map, id, value, label) => {
      if (map.has(id)) {
        problems.push(`${label} was measured twice, in ${where.get(`${label}`)} and ${file}.`);
        return;
      }
      where.set(label, file);
      map.set(id, value);
    };

    if (section.kind === 'scenarios') {
      for (const scenario of section.scenarios ?? []) {
        const fixture = fixtures.progression.scenarios.find((entry) => entry.id === scenario.scenarioId);
        if (fixture === undefined) {
          problems.push(`${file} measured scenario ${String(scenario.scenarioId)}, which no fixture declares.`);
          continue;
        }
        problems.push(...scenarioProblems(file, scenario, fixture));
        claim(scenarios, scenario.scenarioId, scenario, `scenario ${scenario.scenarioId}`);
      }
    } else if (section.kind === 'careers') {
      for (const career of section.careers ?? []) {
        const fixture = fixtures.careers.careers.find((entry) => entry.id === career.careerId);
        if (fixture === undefined) {
          problems.push(`${file} measured career ${String(career.careerId)}, which no fixture declares.`);
          continue;
        }
        problems.push(...careerProblems(file, career, fixture));
        claim(careers, career.careerId, career, `career ${career.careerId}`);
      }
    } else if (section.kind === 'matrix') {
      if (!Object.hasOwn(fixtures.matrix.sites, section.encounterId)) {
        problems.push(`${file} measured matrix site ${String(section.encounterId)}, which the matrix fixture does not declare.`);
        continue;
      }
      problems.push(...matrixProblems(file, section, fixtures.matrix));
      claim(matrix, section.encounterId, section, `matrix ${section.encounterId}`);
    } else if (section.kind !== 'figures') {
      problems.push(`${file} is a section of unknown kind ${String(section.kind)}.`);
    }
  }

  const missing = [
    ...fixtures.progression.scenarios.map((scenario) => scenario.id).filter((id) => !scenarios.has(id)),
    ...fixtures.careers.careers.map((career) => career.id).filter((id) => !careers.has(id)),
    ...Object.keys(fixtures.matrix.sites).filter((id) => !matrix.has(id)).map((id) => `matrix ${id}`),
  ];
  if (missing.length > 0) problems.push(`no measurement for ${missing.join(', ')}.`);

  return { problems, manifest, scenarios, careers, matrix, sections };
}

/* -------------------------------------------------------------------------- */

function scenarioProblems(file, scenario, fixture) {
  const found = [];
  const at = `${file}: scenario ${fixture.id}`;
  if (scenario.fitId !== fixture.fitId || scenario.encounterId !== fixture.encounterId) {
    found.push(`${at} flew ${String(scenario.fitId)} at ${String(scenario.encounterId)}, not ${fixture.fitId} at ${fixture.encounterId}.`);
  }
  const planned = fixture.seeds.length * fixture.sorties;
  if (scenario.planned !== planned) {
    found.push(`${at} planned ${String(scenario.planned)} sorties, not the fixture's ${String(planned)}.`);
  }
  const expected = fixture.seeds.flatMap((seed) =>
    Array.from({ length: fixture.sorties }, (_, index) => `${seed}#${String(index + 1)}`));
  const measured = (scenario.outcomes ?? []).map((outcome) => `${String(outcome.seed)}#${String(outcome.sortie)}`);
  found.push(...exactly(at, 'sorties', expected, measured));
  return found;
}

function careerProblems(file, career, fixture) {
  const at = `${file}: career ${fixture.id}`;
  const found = [];
  const strays = (career.runs ?? []).filter((run) => run.careerId !== undefined && run.careerId !== fixture.id);
  if (strays.length > 0) found.push(`${at} holds runs of ${strays.map((run) => String(run.careerId)).join(', ')}.`);
  found.push(...exactly(at, 'seeds', fixture.seeds, (career.runs ?? []).map((run) => run.seed)));
  return found;
}

function matrixProblems(file, section, fixture) {
  const site = section.encounterId;
  const at = `${file}: matrix ${site}`;
  const found = [];
  const cells = section.cells ?? [];
  found.push(...exactly(at, 'fits', Object.keys(fixture.policies), cells.map((cell) => cell.fitId)));
  for (const cell of cells) {
    const where = `${at}, fit ${String(cell.fitId)}`;
    if (cell.encounterId !== undefined && cell.encounterId !== site) {
      found.push(`${where} was flown at ${String(cell.encounterId)}.`);
    }
    if (cell.seeds !== fixture.seeds.length) {
      found.push(`${where} counts ${String(cell.seeds)} seeds, not the fixture's ${String(fixture.seeds.length)}.`);
    }
    found.push(...exactly(where, 'seeds', fixture.seeds, (cell.outcomes ?? []).map((outcome) => outcome.seed)));
  }
  const claims = fixture.claims.filter((claim) => claim.encounterId === site).map((claim) => claim.id);
  found.push(...exactly(at, 'claims', claims, (section.verdicts ?? []).map((verdict) => verdict.id)));
  return found;
}

/**
 * Exactly the expected values, each once: nothing missing, nothing extra,
 * nothing repeated. An exploratory subset of seeds fails as missing ones.
 */
function exactly(at, what, expected, measured) {
  const found = [];
  const want = new Set(expected);
  const seen = new Set();
  const repeated = new Set();
  for (const value of measured) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  const missing = [...want].filter((value) => !seen.has(value));
  const extra = [...seen].filter((value) => !want.has(value));
  if (missing.length > 0) found.push(`${at} is missing ${what} ${list(missing)}.`);
  if (extra.length > 0) found.push(`${at} has ${what} the fixture does not declare: ${list(extra)}.`);
  if (repeated.size > 0) found.push(`${at} repeats ${what} ${list([...repeated])}.`);
  return found;
}

function list(values) {
  const shown = values.slice(0, 6).map((value) => String(value)).join(', ');
  return values.length > 6 ? `${shown} and ${String(values.length - 6)} more` : shown;
}

function short(hash) {
  return typeof hash === 'string' ? hash.slice(0, 12) : String(hash);
}
