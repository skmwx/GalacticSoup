/**
 * The browser and accessibility cases the release gate requires by name
 * (Test Suite Optimization Plan phase 5; Technical Specification 15.1).
 *
 * The gate already requires every case Playwright discovers for a required
 * project to have run and passed. Discovery can be narrowed, though: by a
 * changed `testMatch`, a renamed file, a `grep`, or a case that was deleted.
 * This list says which journeys and accessibility variants the release
 * evidence rests on, independently of discovery, so a narrowed discovery
 * cannot yield a green gate. Each witness must be discovered, run and pass in
 * every project of its level - Chromium and Firefox alike.
 *
 * A witness is named by its stable identity: the repository path of its spec
 * and its full title (describe blocks joined with " > "), without the
 * requirement ids in brackets at the end, which traceability reads and which
 * may change without changing the case. When a witness is renamed, moved or
 * replaced, change it here in the same commit; `npm run test:discover` checks
 * that every witness is discovered exactly once in each of its projects.
 */

/** The required projects of each test level: the Chromium and Firefox engines. */
export const WITNESS_LEVEL_PROJECTS = {
  browser: ['browser', 'browser-firefox'],
  accessibility: ['accessibility', 'accessibility-firefox'],
};

/**
 * @typedef {object} ReleaseWitness
 * @property {string} id
 * @property {string} evidence what the case is evidence of
 * @property {'browser' | 'accessibility'} level
 * @property {string} file repository-relative spec path
 * @property {string} title full title without the trailing requirement ids
 */

/** @type {readonly ReleaseWitness[]} */
export const RELEASE_WITNESSES = [
  // Journeys played in real time through the shipped worker.
  {
    id: 'guided-journey',
    evidence: 'Guided journey: buy and fit a launcher, guided volleys, reopen in flight',
    level: 'browser',
    file: 'tests/browser/guided.spec.ts',
    title: 'the guided vertical slice > buys and fits a launcher, trades guided volleys with the missile boat, reopens in flight and returns',
  },
  {
    id: 'destroyer-journey',
    evidence: 'Destroyer journey: buy, web, loot, refit and reopen at an advanced site',
    level: 'browser',
    file: 'tests/browser/ladder.spec.ts',
    title: 'the v0.2 progression loop > buys and flies a destroyer, webs and loots at a fit-sensitive site, refits and reopens at an advanced site',
  },
  {
    id: 'real-clock-navigation',
    evidence: 'Real-clock undock, warp, return, dock and resume',
    level: 'browser',
    file: 'tests/browser/space.spec.ts',
    title: 'traversal > undocks, chooses in space, flies, warps, returns home, docks and resumes',
  },
  {
    id: 'suspension',
    evidence: 'One capped step after a suspension or clock change',
    level: 'browser',
    file: 'tests/browser/campaign.spec.ts',
    title: 'campaign persistence > adds one capped step, never the missing hours, after a suspension or a clock change',
  },
  {
    id: 'closed-time',
    evidence: 'No simulation time while the game is closed',
    level: 'browser',
    file: 'tests/browser/campaign.spec.ts',
    title: 'campaign persistence > adds no simulation time while the game is closed',
  },
  {
    id: 'pause',
    evidence: 'The clock runs only while not paused',
    level: 'browser',
    file: 'tests/browser/station.spec.ts',
    title: 'station interface > runs the simulation clock only while it is not paused',
  },
  {
    id: 'starter-refit',
    evidence: 'Starter clear, reward conversion, refit and repeat clear',
    level: 'browser',
    file: 'tests/browser/combat.spec.ts',
    title: 'the first vertical slice > clears the easiest site, converts the rewards and clears it again with a better fit',
  },
  {
    id: 'guided-first-user',
    evidence: 'Guided first-user loop from a new campaign',
    level: 'browser',
    file: 'tests/browser/guidance.spec.ts',
    title: 'guided first loop > follows the in-game guidance from a new campaign through the easiest complete loop',
  },
  {
    id: 'loss-recovery',
    evidence: 'Real destruction, loss report, saved shipless reload, recovery purchase and relaunch to a fight',
    level: 'browser',
    file: 'tests/browser/loss.spec.ts',
    title: 'losing a ship > is destroyed with nothing supplied, reloads the shipless station, buys a hull and flies it to a fight',
  },
  {
    id: 'loss-wreck',
    evidence: 'Granted replacement, wreck chosen and looted, survivors refitted (from a loss checkpoint)',
    level: 'browser',
    file: 'tests/browser/loss.spec.ts',
    title: 'recovering from a checkpoint after a loss > flies the granted replacement to its wreck, brings the survivors home and refits with them',
  },
  {
    id: 'full-offline',
    evidence: 'A whole loop with the network switched off',
    level: 'browser',
    file: 'tests/browser/offline.spec.ts',
    title: 'playing without a network > starts from its own files and plays a whole loop with the network switched off',
  },
  {
    id: 'multi-opponent-rewards',
    evidence: 'Multi-opponent clear, wreck persistence, looting and spending its rewards',
    level: 'browser',
    file: 'tests/browser/progression.spec.ts',
    title: 'progression through the multi-opponent site > clears the multi-opponent site, loots its wrecks after a reopen beside them and spends its rewards on the mastery fit',
  },
  {
    id: 'mastery-continue',
    evidence: 'Mastery clear reopened, chosen destination, completion count, every site choosable',
    level: 'browser',
    file: 'tests/browser/progression.spec.ts',
    title: 'the mastery site from a checkpoint > finds the mastery clear after a reopen, offers the mastery site first with its completion counted and keeps every site choosable',
  },
  {
    id: 'checkpoint-rewards',
    evidence: 'Patrol salvage sold, earned plating fitted, wallet and fit after a reopen',
    level: 'browser',
    file: 'tests/browser/progression.spec.ts',
    title: 'progression rewards from a checkpoint > sells the patrol salvage, fits the earned plating and finds the wallet and fit after a reopen',
  },
  {
    id: 'checkpoint-command',
    evidence: 'Select, lock, fire and stop from a combat checkpoint',
    level: 'browser',
    file: 'tests/browser/combat.spec.ts',
    title: 'combat from a checkpoint > selects, locks, fires at and stops firing on the scout from a saved checkpoint',
  },
  {
    id: 'mouse-commands',
    evidence: 'A fight commanded with the mouse alone',
    level: 'browser',
    file: 'tests/browser/combat.spec.ts',
    title: 'combat commands > commands a fight with the mouse alone',
  },
  {
    id: 'keyboard-commands',
    evidence: 'A fight commanded from the keyboard alone',
    level: 'browser',
    file: 'tests/browser/combat.spec.ts',
    title: 'combat commands > commands a fight from the keyboard alone',
  },
  {
    id: 'damaged-save',
    evidence: 'Fallback from a damaged save',
    level: 'browser',
    file: 'tests/browser/persistence.spec.ts',
    title: 'save integrity in the browser > falls back to the last valid snapshot when the newest is damaged, and leaves the damaged one alone',
  },
  {
    id: 'future-save',
    evidence: 'A save from a newer format refused',
    level: 'browser',
    file: 'tests/browser/persistence.spec.ts',
    title: 'save integrity in the browser > refuses a save written by a newer format, says why, and does not touch it',
  },
  {
    id: 'v01-save',
    evidence: 'A v0.1 save explained and replaced only on confirmation',
    level: 'browser',
    file: 'tests/browser/persistence.spec.ts',
    title: 'save integrity in the browser > explains that a v0.1 save cannot continue, keeps it untouched, and replaces it only on confirmation',
  },

  // Accessibility variants.
  {
    id: 'loss-audit',
    evidence: 'Loss report, shipless station and recovery purchase audited',
    level: 'accessibility',
    file: 'tests/accessibility/loss.spec.ts',
    title: 'loss accessibility > audits the loss report and the shipless station, then buys a way back',
  },
  {
    id: 'combat-audit',
    evidence: 'Combat audit in the middle of a fight',
    level: 'accessibility',
    file: 'tests/accessibility/combat.spec.ts',
    title: 'combat accessibility > passes an automated audit in the middle of a fight',
  },
  // Phase 10a: one presentation matrix owns the station-surface and purchase
  // audits; the standard-size fight audit is `combat-audit`.
  {
    id: 'presentation-standard',
    evidence: 'Station surfaces and a confirmation at standard size and contrast',
    level: 'accessibility',
    file: 'tests/accessibility/presentation.spec.ts',
    title: 'presentation settings and accessibility > audits every station surface and a confirmation at standard size and contrast',
  },
  {
    id: 'presentation-enlarged',
    evidence: 'The same at doubled size, high contrast and reduced motion',
    level: 'accessibility',
    file: 'tests/accessibility/presentation.spec.ts',
    title: 'presentation settings and accessibility > audits every station surface and a confirmation at doubled size, high contrast and reduced motion',
  },
  {
    id: 'presentation-enlarged-fight',
    evidence: 'A fight at doubled size, high contrast and reduced motion',
    level: 'accessibility',
    file: 'tests/accessibility/presentation.spec.ts',
    title: 'presentation settings and accessibility > audits a fight at doubled size, high contrast and reduced motion',
  },
  {
    id: 'v02-hangar-comparison',
    evidence: 'V02-AC-14: enlarged hangar and comparison, keyboard ship switch',
    level: 'accessibility',
    file: 'tests/accessibility/progression.spec.ts',
    title: 'v0.2 surfaces: accessibility > audits a hangar of three ships and their comparison, and switches ship from the keyboard',
  },
  {
    id: 'v02-market-filters',
    evidence: 'V02-AC-14: market purpose, size and compatibility filters',
    level: 'accessibility',
    file: 'tests/accessibility/progression.spec.ts',
    title: 'v0.2 surfaces: accessibility > audits the market under its purpose, size and compatibility filters, operated from the keyboard',
  },
  {
    id: 'v02-destination-bands',
    evidence: 'V02-AC-14: destination bands, filter and keyboard choice',
    level: 'accessibility',
    file: 'tests/accessibility/progression.spec.ts',
    title: 'v0.2 surfaces: accessibility > audits twelve destinations in bands, filters them and chooses one from the keyboard',
  },
  {
    id: 'v02-guided-fire',
    evidence: 'V02-AC-14: guided fire, also with reduced motion',
    level: 'accessibility',
    file: 'tests/accessibility/progression.spec.ts',
    title: 'v0.2 surfaces: accessibility > audits a fight under guided fire: volleys are marked by shape and described in words, also with reduced motion',
  },
  {
    id: 'v02-web',
    evidence: 'V02-AC-14: a fight under a web',
    level: 'accessibility',
    file: 'tests/accessibility/progression.spec.ts',
    title: 'v0.2 surfaces: accessibility > audits a fight under a web: the slowing is named with its source, strength, time and the speed left',
  },
];

/**
 * A case title without the requirement ids in brackets at its end: the part
 * of its identity that does not change when traceability tags do.
 *
 * @param {string} title
 */
export function stableTitle(title) {
  return title.replace(/\s*\[[^\]]*\]\s*$/, '');
}

/**
 * The witnesses a project must run: those of its level, for a required
 * project; none for any other project.
 *
 * @param {string} project
 * @returns {readonly ReleaseWitness[]}
 */
export function witnessesFor(project) {
  return RELEASE_WITNESSES.filter((witness) => WITNESS_LEVEL_PROJECTS[witness.level].includes(project));
}
