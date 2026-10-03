# Phase 20 completion note - Save, replay, invariant, and traceability closure

Status: complete. Date: 2026-10-03.

Implements Phase 20 of `docs/MVPImplementationPlan.md`. The feature-complete build is now held to
its own contracts by machinery rather than by reading:

- **Golden campaign.** One whole campaign is recorded as a replay log, with a sealed save at six
  representative states. It is replayed through both transports and reloaded at every state.
- **State audit.** Every field of every golden save is checked against the published schema, the
  engine's reader, the invariants and the content-reference list.
- **Property runs.** A random pilot plays 20,000 steps of the whole loop under invariants that must
  hold at every step.
- **Traceability.** A requirement registry and a report that fails on any uncovered included
  requirement. It stands at 117 of 117.
- **Closed contracts.** Protocol 13 and save format 10 are closed and locked.
- **Performance.** The engine meets the Technical Specification 13 targets at the largest authored
  encounter.

The audit and the property runs found defects, and all are fixed. One of them would have frozen a
real game: see Defects found. Two interpretations are posted as Q9 and Q10 in
`docs/agent-comm/requests/questions-and-answes.md`; neither blocks.

## Defects found and fixed

| Found by | Defect | Fix |
|---|---|---|
| Property run | **A reload asked for in the middle of a weapon cycle froze the simulation.** Any other boundary in the site - an opponent's shot, for instance - started the waiting reload while the gun's own cycle was still running. The weapon was then both cycling and reloading, the invariant check refused the tick, and every later tick was refused the same way. In play: press Reload while a gun is firing in a fight, and the clock stops for good. Present since Phase 11. | `startNextCycle` in `src/engine/simulation/combat.ts` leaves a waiting reload alone while the cycle runs. A unit test reproduces it and fails without the fix. |
| State audit | The engine's reader accepted an unknown field inside a saved random stream; the schema refused it. | `isRandomStreams` is closed. |
| Audit of Technical Specification 15.3, check 7 | Nothing checked that a queued scheduler entry belonged to anything. A save could hold a boundary of an unknown kind, or one for work no ship was doing. | New invariant `schedulerOwnership`: every entry is named by live state, or is the one market-hour boundary. |
| Audit of the load pipeline | The envelope repeats the campaign's name, revision and simulation time for the save list, but only the campaign id was compared with the payload. | `loadSave` refuses an envelope that misstates any of the four. |
| Property run | A free repair or resupply previewed a wallet change of negative zero. It reads as "-0" once formatted. | Previews report zero. |
| Schema audit | The transaction-preview schema accepted any extra field, and the stale-preview error's replacement preview was undescribed. | Four closed preview shapes; the error refers to them. |

None of these changes the shape of a save or of a protocol message, so no version moved (plan
section 2, rule 6). A save the engine wrote before is read exactly as before.

## The golden campaign (Technical Specification 9.5, 11.2, 11.4, 17)

### What is recorded

`tests/support/golden/` records a campaign by wrapping the scripted pilot of the Phase 17 careers in
a session that writes down everything that can change state:

- the creating command;
- every later command, with the answer it got - a refusal is recorded and must be refused again,
  for the same reason;
- every elapsed delta;
- the canonical state hash at checkpoints.

Queries are not recorded, because a query changes nothing.

The campaign takes the intermediate fit to the Pirate Base too early and loses it, is granted a
recovery ship, earns the fit back on the Pirate Scout, clears the Pirate Patrol until the mastery
fit is affordable and clears the Pirate Base: 277 log entries, 8,043 revisions, 33 simulated
minutes.

| Fixture | Holds |
|---|---|
| `tests/fixtures/replays/golden-campaign.json` | The log, 34 KB, one step per line. |
| `tests/fixtures/saves/golden/station.json` | Docked after a purchase, a changed fitting draft open. |
| `.../travel.json` | In warp, with its arrival boundary queued. |
| `.../combat.json` | The Pirate Base with all four opponents alive: locks both ways, eight weapon cycles, four opponent decisions queued. |
| `.../post-destruction.json` | Recovered at the station: loss report, the player's wreck, a granted ship with marked stacks. |
| `.../wreck.json` | A cleared site beside wrecks that still hold loot. |
| `.../completed-progression.json` | Docked with all three sites cleared, twelve wrecks still pending expiry, full histories. |

### What is checked

`tests/integration/goldenCampaign.test.ts` (22 tests, about 75 s):

- **Reproduction.** The campaign is recorded again and must equal the fixtures byte for byte.
- **Full replay.** The log is replayed through the in-process gateway and through the worker
  dispatcher. Every checkpoint hash must match.
- **Reload at each golden state.** Each save must:
  - validate against both save schemas and open through `loadSave` at the recorded hash;
  - rebuild every projection the uninterrupted campaign showed at that point - more than twenty
    requests per state, refusals included - and each answer must satisfy its published protocol
    schema;
  - continue to the next golden state with the recorded hashes.

### When it goes stale

The fixtures are written against the shipped content, because only the shipped content reaches all
six states. A content change that moves a fight, or a protocol or format change, makes them stale.
The test then fails and says so. `npm run golden:record` records them again; the diff is the
review. This is the same arrangement as the balance candidate, and a tuning change will now need
both `npm run balance:record` and `npm run golden:record`.

## The state audit (plan: "audit every authoritative field and scheduled action")

`tests/unit/engine/stateAudit.test.ts` (37 tests, about 4 s) uses the golden saves as its subjects.

- **The schemas are closed.** A static audit (`tests/support/schemaAudit.ts`) walks both save
  schemas: every record refuses unnamed properties, every property is required, every map and array
  describes its contents. No finding.
- **The reader is at least as strict as the schema.** Each state is corrupted one step at a time:
  each field removed, an unknown field added to each object, each value given the wrong type. That
  is hundreds of corruptions per state. Wherever the schema refuses, the reader must refuse, and a
  value of the wrong type must be refused by both. This found the random-stream leniency above.
- **Every definition is checked on load.** Each id in a save that resolves in the installed content
  must be in the list the loader checks.
- **Every queued boundary is one the engine resolves.**
- **Coverage.** Between them the six saves hold every top-level part of the campaign in a
  non-starting form, and every boundary kind except five short-lived ones (lock, reload, module
  cycle, dock and warp preparation), which the Phase 11-15 persistence tests pin.
- **Migrations.** The shipped registry is empty (rule 7). The runner is applied to each golden save
  through a fixture registry and must reach the state the save holds.

## Property runs (Technical Specification 15.1, 15.3)

`tests/integration/campaignProperties.test.ts` (7 tests, about 60 s) flies a seeded random pilot
(`tests/support/randomPilot.ts`) for 4,000 steps in each of five runs: two new campaigns, and the
golden wreck, combat and completed-progression saves. The pilot cycles through a station visit, a
sortie, a fight and the way home, with random and deliberately illegal requests throughout: stale
tokens, targets that are not there, space orders given while docked.

At every step:

- a refusal is a rule violation, never an internal error;
- one commit moves one revision; time, ordinals, draw indices and sequence numbers never run
  backwards;
- only elapsed time draws from a random stream or moves the clock;
- the wallet changes by exactly what the preview said, and never otherwise except upwards with
  time;
- moving, fitting and looting neither create nor destroy an item;
- the notification history, site memory and combat recorder stay inside their bounds.

Every 125 steps the state must satisfy the invariants and the schema, and a snapshot of it must
load to the same hash. One run is repeated with the campaign replaced by its own loaded snapshot at
each of those points; it must end at the same hash as the run that was never reloaded.

## Traceability (Technical Specification 15.2; MVP Scope 9.2)

- **The source.** `config/requirements.json` lists 153 requirements: the ten acceptance criteria and
  every normative section of both specifications. Each says whether MVP Scope selects it and how
  much of it, and names the content and protocol requests that carry it. 117 are included; 36 are
  deferred, each with the MVP Scope 8 item that defers it.
- **The join.** `scripts/lib/traceability.mjs` joins the registry with the `@implements` claims and
  the `[ID]` test tags. Claims are now also read from `scripts/`, `config/` and the test
  configuration files.
- **The report.** `npm run traceability` writes `reports/traceability.md` and `.json`: per
  requirement, the engine modules, projections, interface code, other code, content, requests and
  tests by level.
- **The gate.** The run fails when:
  - an included requirement has no test, or nothing implements or carries it;
  - an acceptance criterion has no integration or browser test;
  - code or a test names an id the registry lacks;
  - a deferred requirement is claimed;
  - the registry names content or a request that does not exist.

  A unit test holds the repository to the same result, so the gate also runs in `test:unit`.

Seven included requirements were uncovered when the gate first ran, and each was closed with a
claim in the file that does the work or with a real test: Functional Specification 4.3, 22.6 and
22.14, and Technical Specification 4.3, 15.1, 15.2 and 16.

## Closed contracts (plan: "close the MVP protocol and save versions")

- **Versions.** Protocol 13, save format 10, campaign state 10, replay log 1.
- **Schemas.** `tests/unit/protocol/contractClosure.test.ts` audits all 40 protocol schemas the way
  the save schemas are audited. The only optional fields are the eight the specifications make
  optional, listed in the test with their sections. Every request type has a described payload and
  a published answer.
- **The lock.** `tests/fixtures/contracts/lock.json` records the versions, the request catalogue and
  a digest of each schema's requirements (titles and descriptions excluded). A schema that changes
  without the lock changing fails the unit suite. `npm run contracts:record` records it again after
  the version it belongs to has been bumped.
- **Migrations.** The registry is empty and is expected to be; the released chain begins here.

## Bounds and performance (Technical Specification 13)

### Bounds

| Collection | Limit | Enforced by |
|---|---|---|
| Notification history | 64 entries | writer, reader, schema |
| Once-per-site memory | 64 keys | writer, reader, schema |
| Combat recorder | 128 aggregated events | writer, reader (now the same constant), schema |
| Recent-request cache | 128 responses | session state, never saved |
| Save diagnostics store | 32 records | IndexedDB adapter |
| Scheduler | one entry per running action | the new ownership invariant |

The largest golden save is 89 KB, and the property runs hold every snapshot they take under
1 MB. The save limit is 32 MB.

### Site budgets

`scripts/lib/content/budgets.mjs` gives content validation the per-site soft budgets Technical
Specification 13 asks for: 8 ships, 64 queued boundaries, 12 labels. An encounter past one still
compiles, and `npm run validate:content` prints a warning that names it. The Pirate Base, the
largest, can hold 5 ships and 39 boundaries.

### Timing

`tests/performance/engine.test.ts` measures the engine at the golden combat save, which is the
Pirate Base with every opponent alive, and writes `reports/performance.json`.

| Target (Technical Specification 13) | Budget | Measured |
|---|---|---|
| One 50 ms quantum, 95th percentile | 4 ms | 2.5 ms (median 1.3 ms) |
| A non-advancing command or query, 95th percentile | 100 ms | 1.3 ms |
| Snapshot capture and serialisation, 95th percentile | one frame, 16.7 ms | 5-7 ms |
| Open a validated campaign, 95th percentile | 2 s | 5-8 ms for the largest save, 89 KB |

Timing is its own test level, `npm run test:performance`, and `npm run verify` runs it on its own.
Run beside the integration suite the same measurement was three times slower and failed, which
measures the neighbours rather than the engine. Rendering targets belong to the browser and are not
measured here.

## The IndexedDB adapter (plan exit gate: rotation, atomic write failure, quota)

The shipped build saves through `src/adapters/persistence/indexedDbSaveStore.ts`, which had no test
of its own below the browser.

- **In a browser** (`tests/browser/persistence.spec.ts`, 3 tests), against the real worker and
  database:
  - five rolling autosaves and one manual save, the manifest naming exactly the snapshots that
    exist;
  - a damaged newest snapshot: the previous one is resumed and the damaged one is left as found;
  - a save from a newer format: refused with the reason shown, untouched, and a new campaign can
    still be started.
- **Headlessly** (`tests/unit/persistence/indexedDbSaveStore.test.ts`, 11 tests), through the
  adapter's own injectable factory (`tests/support/fakeIndexedDb.ts`):
  - one transaction per save;
  - a quota failure on the snapshot, the manifest or the diagnostic record leaves every stored save
    untouched and is reported as `quota`;
  - an interrupted write is reported as `writeFailed` with nothing changed;
  - a cleared slot, an unavailable database and the storage report.

A real quota failure could not be produced in the browser: the DevTools quota override is ignored
for a Playwright context. That is why the quota cases use the injected factory.

## Tests

| Level | New or changed | What they prove |
|---|---|---|
| Unit, engine | `stateAudit.test.ts` (37) | Above. |
| Unit, engine | `combat.test.ts` (+1) | The reload defect: an opponent's shot mid-cycle leaves the waiting reload waiting. |
| Unit, engine | `scheduler.test.ts` (+2, 1 changed) | Orphaned and unknown boundaries are refused; one market-hour boundary, with no owner. |
| Unit, engine | `saveLoad.test.ts` (+1) | An envelope that misstates name, revision or simulation time is refused. |
| Unit, protocol | `contractClosure.test.ts` (44) | Closed protocol schemas, payload and answer for every request type, no multiplayer or steering request, the lock. |
| Unit, persistence | `indexedDbSaveStore.test.ts` (11) | Above. |
| Unit, content | `siteBudgets.test.ts` (2) | Shipped encounters are inside their budgets; an oversized one warns and still compiles. |
| Unit, config | `traceability.test.ts` (12) | The registry, the join's rules, and no uncovered requirement in this repository. |
| Integration | `goldenCampaign.test.ts` (22) | Above. |
| Integration | `campaignProperties.test.ts` (7) | Above. |
| Performance | `engine.test.ts` (5) | Above. |
| Browser | `persistence.spec.ts` (3) | Above. |

Existing tests changed: the two protocol schema-parity tests load the preview schema before the
error schema that now refers to it, and `boot.spec.ts` carries one more requirement tag.

### Results

Run against the final code, on an otherwise idle machine:

- typecheck, the architecture check (277 files, no violations) and content validation, including
  the floor and the site budgets (no warning);
- **1331 unit tests** (was 1221);
- **134 integration tests** (was 105) in 197 s (was 139 s), including every balance career;
- **5 performance tests**;
- **113 component tests** (unchanged);
- traceability: **153 requirements, 117 included, 117 covered, 36 deferred**;
- the production build.

Playwright ran **61 tests** in one parallel run, and all passed in 18.8 minutes: the 58 existing
tests and the 3 new persistence cases. The progression flow took 18.5 minutes (Phase 19: 19.1).

The first full run of this phase failed on one test: the quantum timing, while it was still part of
the integration project (see Timing). Every other test passed in that run too.

## Findings worth retaining

- **A reload during a cycle, with a second ship firing,** is a sequence no unit test and no
  scripted career had tried. Scripted pilots are polite; the random one is not. If a later phase adds a system with waiting state, add its commands to
  `tests/support/randomPilot.ts`.
- **Module commands take a system slot only.** The protocol refuses `module.activate` for any other
  slot kind as malformed, not as a rule violation. That is the closed contract and the interface
  never sends one, but a future active engineering module needs a protocol version.
- **A new market listing makes an old campaign unopenable.** `validateEconomy` requires the stored
  listings to equal the authored ones, so adding or removing a listing refuses the save with a
  payload error (`economyReference`) rather than `contentIncompatible`. It is precise, and before
  release it costs nothing (rule 7). After release it needs a content transition.
- **The quantum budget has 1.5 times headroom.** Most of the 2.5 ms is the copy, complete validation
  and freeze of the whole campaign at every commit, not the simulation. See Q10.
- **The golden saves pin the shipped content.** They load after a balance-only change, but the
  reproduction test will fail until `npm run golden:record` is run.
- **Performance must be measured alone.** Do not move `tests/performance` back into the integration
  project.

## Handoff to Phase 21

- Candidate versions: protocol 13, save format 10, campaign state 10, content
  `0.1.0+6d2aa29cb3d4`, as recorded in `tests/fixtures/contracts/lock.json` and the golden log's
  header.
- `npm run verify` now includes `test:performance`. The release gate should run it on a quiet
  machine and attach `reports/performance.json`, `reports/traceability.md` and `reports/balance.md`.
- Phase 21 asks for Firefox and offline verification, and for the full flows against a clean
  profile. Nothing in this phase ran in Firefox.
- A release-blocking contract change fails `contractClosure.test.ts` and `goldenCampaign.test.ts`
  first. Bump the version, record both, and re-run this phase's suites.
