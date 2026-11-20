# Phases 5 and 6: Named release evidence and a shorter Patrol-to-Base

This is the handoff for Phases 5 and 6 of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It builds on the [Phase 0 inventory](phase-0-inventory.md), the [Phase 2-3 handoff](phase-2-3-feature-verification.md) and the [Phase 4 handoff](phase-4-progression-checkpoint.md). Both phases were done in one session on top of `0bed5bd`.

## Phase 5: The release gate requires named results

### What changed

- **[config/releaseWitnesses.mjs](../../config/releaseWitnesses.mjs)** is new. It lists 28 required witnesses, which are the journeys and accessibility variants the release rests on. Each one is named by a stable identity:
  - the spec's repository path;
  - the full title, with describe blocks joined by ` > `;
  - no trailing requirement ids. Traceability reads those ids, and they can change without changing the case. `stableTitle()` strips them.

  Each witness has a level. Browser witnesses are required in `browser` and `browser-firefox`. Accessibility witnesses are required in `accessibility` and `accessibility-firefox`. `witnessesFor(project)` returns none for the optional branded projects.

  | Plan item | Witnesses |
  |---|---|
  | Guided and destroyer journeys | `guided-journey`, `destroyer-journey` |
  | Real-clock navigation, suspension and pause | `real-clock-navigation`, `suspension`, `closed-time`, `pause` |
  | Starter/refit, guided first-user | `starter-refit`, `guided-first-user` |
  | Loss and recovery | `loss-recovery`, `loss-audit` |
  | Full offline | `full-offline` |
  | Multi-opponent progression (Phase 6) | `multi-opponent-rewards`, `mastery-continue`, `checkpoint-rewards` |
  | Commands | `checkpoint-command`, `mouse-commands`, `keyboard-commands` |
  | Saves (Phase 0 section 4) | `damaged-save`, `future-save`, `v01-save` |
  | `V02-AC-14` enlarged hangar and comparison, keyboard ship switch; market filters; destination bands and keyboard choice; guided fire with reduced motion; web states | `v02-hangar-comparison`, `v02-market-filters`, `v02-destination-bands`, `v02-guided-fire`, `v02-web` |
  | Accessibility variants | `combat-audit`, `presentation-standard`, `presentation-enlarged` |

  Requiring each witness in both engines covers the plan's "in both engines". The whole-Firefox-suite part of `V02-AC-14` is covered by the completeness check below.
- **[scripts/lib/release.mjs](../../scripts/lib/release.mjs)** has two new functions:
  - `readPlaywrightCases(report, root)` reads a run's result or a `--list` listing as cases with these fields:
    - project;
    - repository-relative file;
    - line;
    - full title;
    - tags;
    - status (`passed`, `flaky`, `failed`, `skipped`, or `listed` for a listing);
    - the highest retry.

    One source line can make two cases, so identity includes the title.
  - `checkPlaywrightEvidence({ project, discovered, executed, witnesses })` fails the run when:
    - a case ran in another project;
    - discovery lists nothing;
    - a case ran twice;
    - a discovered case did not run;
    - a case ran that discovery does not list;
    - a case was skipped or did not pass;
    - a witness was not discovered, not run, skipped or failed, or matches more than one case.

    A case that passed only on a retry still counts, and it is named.
- **The gate's Playwright step** ([scripts/release-gate.mjs](../../scripts/release-gate.mjs)) works as follows:
  1. It lists the full intended discovery first: `playwright test --list --reporter=json --forbid-only --project=<p> [branded specs]`. It keeps the listing beside the result as `reports/release/results/<project>.discovery.json`.
  2. It then runs the suite with `--forbid-only` added.
  3. The step passes only when the exit code, the counts and `checkPlaywrightEvidence` all agree.
  4. The step record carries an `evidence` object: discovered, executed, passed, the flaky names and each witness's status. Any problems go into `reason`.

  Retry reporting is unchanged: `--retries=1`, and a retried test is named in `reason` and in the failing-or-retried list. Optional branded channels that are not installed are still skipped before any listing, so they do not fail the gate. The branded projects get the completeness check but have no witnesses.
- **The gate report** gains a "Browser evidence by case" section. One table gives discovered, ran, passed, on a retry and witnesses for each Playwright step. A second table gives each witness's status in each required project.
- **[scripts/test-discovery.mjs](../../scripts/test-discovery.mjs)** now uses the same `readPlaywrightCases`, so discovery and the gate share one notion of identity. It adds two checks:
  - every witness is discovered exactly once in each of its projects;
  - witness ids and cases are distinct.
- **[README.md](../../README.md)** describes the case-by-case rule under "The release gate".

### Evidence

**Unit checks** ([tests/unit/config/releaseGate.test.ts](../../tests/unit/config/releaseGate.test.ts), "required browser evidence by case", 7 new cases plus one report case):

| Situation | Result |
|---|---|
| Complete run, one case passed on a retry | passes; the retried case is named |
| Partial report: only one file ran, and everything that ran passed | fails: "2 of 4 discovered case(s) did not run", witness `variant` "was not run" |
| Discovery and run both narrowed to omit a witness | fails: "required witness journey was not discovered" |
| A required witness skipped | fails: "1 case(s) were skipped", "required witness variant was skipped" |
| Failed witness; a case discovery does not list; a case in another project | each fails with its own problem |
| Real witness list | same in Chromium and Firefox; none for branded; titles carry no ids |

The unit project passes: 80 files, 1,493 cases. `npm run test:discover` exits 0, and both witness checks are `ok`.

**Focused gate invocation.** `node scripts/release-gate.mjs --only=build,browser,browser-firefox` was run from PowerShell on `D:\` with 8 workers and `--retries=1`. This is the plan's example invocation plus Chromium, which was needed for the Phase 6 timings. The verdict is INCOMPLETE, as expected: the steps left out of `--only` hold records against older sources, so they are stale. Each of the three steps passed, against the identity the report states:

| Step | Status | Took | Source digest | Build fingerprint | Discovered / ran / passed / on a retry | Witnesses |
|---|---|---:|---|---|---|---|
| build | passed | 5 s | `fc21b73da6cfdc95…` | `167c5b463178ffbf…` | - | - |
| browser (Chromium 153.0.8010.12) | passed | 7.5 min | `fc21b73da6cfdc95…` | `167c5b463178ffbf…` | 38 / 38 / 38 / 0 | 19 of 19 |
| browser-firefox (Firefox 155.0) | passed | 8.1 min | `fc21b73da6cfdc95…` | `167c5b463178ffbf…` | 38 / 38 / 38 / 0 | 19 of 19 |

`reports/release-gate.json` gives the same source digest and build fingerprint for the identity: commit `0bed5bd` with these uncommitted changes. The step records sit in `reports/release/steps/`. Beside each result is the listing it was compared with, `reports/release/results/<project>.discovery.json`.

That was the second run. **The first run** (source `c5cc3e15…`) also passed, but in Chromium two checkpoint cases needed their retry, and the evidence named both. Each first attempt timed out at Playwright's default 30 s. The first case in a worker that opens a progression checkpoint also makes it headlessly, which took 47 s and 84 s beside seven other workers; the retries took 17 s and 29 s. The Phase 4 case had the same latent problem, because it had only been timed with 1 worker. Both progression checkpoint cases now set a 2-minute timeout (`CHECKPOINT_CASE_TIMEOUT_MS`). The retry evidence did what Phase 5 wants: the step passed but named the flaky cases.

## Phase 6: The Patrol-to-Base critical path

### Decision

The November case took 844 s in Chromium and 858 s in Firefox. In Phase 4 it took 13.7 min. Two sorties at 1x drove the time. The headless scenarios put the Pirate Base fight at about 350 s and the Patrol fight at about 200 s (`reports/balance.md`, seed `bb22cc`). The plan says to keep a played segment wherever earning and spending the same reward is the assertion. That segment is the Patrol sortie followed by spending its rewards. The Pirate Base sortie adds a second, longer fight, and nothing about it is unique browser evidence. What the interface must show afterwards can be checked from a saved state.

The case is therefore split in three. All three are in [tests/browser/progression.spec.ts](../../tests/browser/progression.spec.ts).

1. **Played: "progression through the multi-opponent site > clears the multi-opponent site, loots its wrecks after a reopen beside them and spends its rewards on the mastery fit"** `[MVP-AC-01, MVP-AC-05, MVP-AC-06, MVP-AC-07, FUNC-9.10, FUNC-9.11]`. This is the old P1-P15, unchanged apart from the fight loop.
2. **New, from a checkpoint: "the mastery site from a checkpoint > finds the mastery clear after a reopen, offers the mastery site first with its completion counted and keeps every site choosable"** `[MVP-AC-01, MVP-AC-07, MVP-AC-09, FUNC-18]`. This is the old P18-P22. It opens the new `base-cleared` checkpoint, does a real close, reload and resume, and then checks:
   - the shown state again;
   - the Last sortie line;
   - "Chosen destination: Pirate Base. Space navigation offers it first.";
   - after undocking, Pirate Base pressed and "Cleared 1 times";
   - Pirate Scout and Pirate Patrol each choosable and warpable.
3. **Phase 4, unchanged:** "progression rewards from a checkpoint > sells the patrol salvage, …".

### The `base-cleared` checkpoint

[tests/support/checkpoint/scenarios.ts](../../tests/support/checkpoint/scenarios.ts) continues `patrol-salvage` through the protocol:
1. It sells every salvage stack.
2. `fitThroughStation` buys the afterburner and battery the `mastery` fixture fit lacks and fits them with the earned plating.
3. `refit` repairs, resupplies and recharges.
4. `flySortie` flies the `base.mastery` scenario: 30 km arrival, keeping 10 km from the nearest brawler, afterburner always on.
5. It docks.

The checkpoint refuses to be made if the Base is not cleared or the ship does not dock.

`fitThroughStation` now counts the reserve rounds already in the hold before moving more. A ship back from a sortie carries part of its reserve, which made the first attempt fail with "could not carry 300". A fresh campaign has an empty hold, so the existing checkpoints are unchanged, and their determinism cases still pass.

`StationCheckpointFacts` gained two fields:
- `selectedDestination`;
- `completions`: every encounter completed at least once, with its count.

`verifyCheckpoint` therefore also checks these on a fresh resume. [tests/integration/checkpointsMastery.test.ts](../../tests/integration/checkpointsMastery.test.ts) is new and in the fast selection. It checks that the checkpoint is byte-identical over two generations, and that it is docked with:
- "4 of 4" and 26,000 ISK;
- the afterburner, the plating and the battery fitted;
- no salvage left;
- Pirate Base chosen;
- Pirate Base and Pirate Patrol each completed once.

It has a file of its own, because a generation takes about 9 s on an idle machine and two or three times that under load. In `checkpoints.test.ts` it made that file the slowest of the fast selection, at 60 s.

### The fight loop

The old `press()` swallowed every error, and so did two `getAttribute(...).catch(() => null)` reads. In their place:
- `offered(control)` checks presence and enabled state with a 1 s bound. It tolerates only the control disappearing during the check.
- `attributeIfPresent(element, name)` returns `null` only once the element has gone.
- `press(control, what, log)` returns false when the control is not offered. If a click fails while the control is gone or disabled afterwards, it records a transient miss and returns false. If the control is still offered after a failed click, it rethrows.
- A stalled fight throws after 10 minutes with diagnostics:
  - the current target and its entry text;
  - the last lock status seen and the number of presses;
  - the text of In this site, Weapons and Modules;
  - the encounter summary and the clock;
  - the last ten transient misses.

The Base-only branches (nearest-first, booster below 80% shield) and their helpers are removed, because no played fight uses them now.

### Assertion map

The rows are P1-P22 from the [Phase 0 map](phase-0-inventory.md#5-patrol-to-base-assertion-map).

| # | Asserted | Now | Owner and justification |
|---|---|---|---|
| P1 | No destination needed before undocking | **kept**, played case | - |
| P2-P3 | Starting credits buy the intermediate fit; refit, resupply, ammunition to the hold | **kept**, played case | - |
| P4 | Reopen 1 at the station: wallet, two autocannons | **kept**, played case | - |
| P5-P6 | Derelict Lane, 2 cutters and 1 marksman; Patrol cleared cutters first, 13,000 ISK | **kept**, played case | The only browser multi-opponent fight |
| P7 | 3 wrecks; reopen 2 in space; wrecks persist, no hostiles | **kept**, played case | - |
| P8 | Every wreck approached, opened, emptied | **kept**, played case | - |
| P9 | Warp home, dock | **kept**, played case | Also `browser/space.spec.ts:47` (`real-clock-navigation`) |
| P10 | Last sortie "3 of 3 … 13,000 ISK"; "1 x Small Armour Plating" | **kept**, played case | Also the `checkpoint-rewards` shown-check |
| P11-P13 | Salvage sold; rewards buy afterburner, battery, 220 rounds; earned plating and bought modules fitted | **kept**, played case | The played earn-and-spend segment the plan requires |
| P14 | Resupply; repair "recharged to full for free"; capacitor 370 of 370 | **kept**, played case | - |
| P15 | Reopen 3: wallet, afterburner, plating | **kept**, played case | Also `checkpoint-rewards` (wallet to the credit, every slot) |
| P16 | Outpost Cradle at 30 km, 2 gunners | **removed from the browser** | Headless `base.mastery` (`progression.test.ts`, `progressionMastery.test.ts`, three seeds × two sorties, 6/6) and `base.lancer` (6/6); the `base-cleared` checkpoint flies the same scenario through the protocol on every generation, and `checkpointsMastery.test.ts` requires 4 of 4. Browser arrival at a site and warp: `real-clock-navigation`, `destroyer-journey`, the played case |
| P17 | Pirate Base cleared nearest-first at 10 km, booster below 80%: 26,000 ISK | **removed from the browser** | As P16. The browser's multi-opponent fight evidence is P5-P6. The interface's fight controls are exercised by the played case, `starter-refit`, `mouse-commands`, `keyboard-commands`, `checkpoint-command` and the guided and destroyer journeys |
| P18 | Dock; Last sortie "Pirate Base cleared: 4 of 4 … 26,000 ISK" | **moved**, `mastery-continue` | Shown on resume and asserted literally |
| P19 | Reopen 4: the outcome persists | **moved**, `mastery-continue` | A real close through the game menu, reload and resume after the seeded open, then the whole shown-check again (wallet, outcome, hold) |
| P20 | "Chosen destination: Pirate Base. Space navigation offers it first." | **moved**, `mastery-continue` | Same literal assertion; the checkpoint fact is checked too |
| P21 | Pirate Base pressed in space; "Cleared 1 times" | **moved**, `mastery-continue` | Same assertions; headless `encounter.test.ts` checks the completion count as well |
| P22 | Pirate Scout and Pirate Patrol choosable and warpable | **moved**, `mastery-continue` | Same assertions |

Real undock, warp and dock remain in the played case, in `real-clock-navigation` and in the guided and destroyer journeys. The dedicated [guided](../../tests/browser/guided.spec.ts) and [destroyer](../../tests/browser/ladder.spec.ts) journeys are unchanged. Traceability counts test files, so both acceptance criteria that left the played case remain covered by the same file: `MVP-AC-09` moved to the checkpoint case, and `MVP-AC-07` is on both.

### Evidence

**Both engines.** The three progression cases were run with `--project=browser --project=browser-firefox`, 6 workers, no retries and a fresh served build. All six passed in 7.7 min wall.

| Case | Chromium | Firefox |
|---|---:|---:|
| Played multi-opponent case (was Patrol-to-Base) | **445 s** (7.4 min) | **455 s** (7.6 min) |
| Mastery site from `base-cleared` (new; includes making the checkpoint) | 21.2 s | 23.4 s |
| Rewards from `patrol-salvage` (Phase 4) | 10.6 s | 17.1 s |
| *Patrol-to-Base, November gate (8 workers)* | *844 s* | *858 s* |
| *Patrol-to-Base, Phase 4 (2 workers)* | *13.7 min* | *13.7 min* |

The slowest case falls by about 6.4 min in each engine. The played case is still the slowest browser case. The next is `combat.spec.ts:185` at about 4 min in November. The case still spends about 4 min outside the Patrol fight, in purchases, two warps, wreck approaches, docking and three reopens.

**Project wall times** (the second focused gate run above, 8 workers, `--retries=1`, no retry needed):

| Project | Step wall | Playwright run | Slowest case | Next slowest |
|---|---:|---:|---|---|
| browser | 7.5 min | 448 s | played multi-opponent case, 394 s | `combat.spec.ts` starter/refit, 245 s; `loss.spec.ts`, 198 s |
| browser-firefox | 8.1 min | 484 s | played multi-opponent case, 439 s | starter/refit, 240 s; loss, 184 s |
| *November gate* | *15m 04s / 15m 05s* | *903 s / 905 s* | *Patrol-to-Base, 844 s / 858 s* | |

The two browser projects take about 15.6 min together, against 30.1 min in November: they save about 14.5 min of the sequential gate. The checkpoint cases took 92.9 s (`base-cleared`, generation included) and 42.5 s in Chromium, and 21.5 s and 15.9 s in Firefox. The 92.9 s is within the new 2-minute timeout, but not by much (see Open items).

**Other checks.**
- `tsc --noEmit` passes.
- `check-architecture` reports 301 files and no violations.
- `npm run traceability` covers 134 of 134 included requirements.
- `npm run test:discover` exits 0, with `browser` and `browser-firefox` at 38 cases each (37 before), the smoke at 9, and every check passing.
- The fast integration selection passes, 37 files and 204 cases in 57.3 s. Phase 4 recorded 36 files in 54.6 s; the new mastery checkpoint file adds about 3 s, and its slowest neighbours take about 53 s.
- The production build has the same asset hash (`index-CKQhmdzN.js`), and no file under `src/` changed.

## Open items

- **Phase 6a is not started.** The remaining played case is now the critical path, at about 7.5 min. The slow transitions it keeps (the Patrol fight, wreck approaches and warps) are its evidence, so manual time stepping would replace the real clock exactly where the plan keeps it. If the 35-minute gate target is missed in Phase 14, the candidates are the wreck approaches and the reopen in space. Measure them before choosing.
- **Checkpoint generation under gate load.** Making `base-cleared` inside a Playwright worker took most of a 92.9 s case in the Chromium gate step, against about 9 s on an idle machine. The 2-minute timeout held, but the margin is small. If it fails in Phase 14, either raise `CHECKPOINT_CASE_TIMEOUT_MS`, or make the checkpoints once per run in a Playwright global setup and write them to a file the workers read. The second option would also take that CPU work off the browser workers.
- **The Phase 2 starting-point timings** for `verify:feature` are still open (see the Phase 2-3 handoff).
- **Isolated regressions were not run for Phase 6.** The plan's Phase 6 exit does not ask for them. The Phase 5 unit checks cover the gate's refusal cases.

## Next

- **Phases 7, 7a, 8, 9, 10 and 10a** depend on Phase 5. When a case they change is a witness, they must update [config/releaseWitnesses.mjs](../../config/releaseWitnesses.mjs) in the same change. `npm run test:discover` fails until they do. Phase 9 will add the short branded flow, and Phase 10 will merge the boot checks; neither is a witness now.
