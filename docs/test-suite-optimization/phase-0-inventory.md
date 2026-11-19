# Phase 0: Baseline and acceptance evidence inventory

This is the Phase 0 deliverable of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It records what each entry point discovers, the November baseline timings and their provenance, the acceptance evidence by named case, the assertions of the Patrol-to-Base case, and the cases to tag for feature and release verification. Later phases should start here.

## 1. Discovery

`npm run test:discover` ([scripts/test-discovery.mjs](../../scripts/test-discovery.mjs)) lists, without running anything:

- the files selected by every npm script that is a `vitest run`, together with their Vitest project;
- every Playwright case of the four required projects, and of `browser-chrome` and `browser-edge` under the release gate's branded spec filter, with file, line, title and tags.

It also checks that the integration selections are disjoint, that their union is every file under `tests/integration/`, and that the targeted scripts resolve the files they are meant to. It writes `reports/test-discovery.json` by default, or the file named by `--out=`. It takes about 12 s.

The pre-change discovery is saved as [discovery-baseline.json](discovery-baseline.json). It was captured on 19 November 2026 at `ba87332`, before the Phase 1 split.

| Entry point | Discovered |
|---|---|
| Vitest `unit` | 80 files (1,483 cases in the November run) |
| Vitest `integration` (before the split) | 51 files (317 cases) |
| Vitest `component` | 13 files (151 cases) |
| Vitest `performance` | 1 file (8 cases) |
| `npm test` (all projects) | 145 files |
| Playwright `browser` / `browser-firefox` | 35 cases each, 13 files |
| Playwright `accessibility` / `accessibility-firefox` | 43 cases each, 9 files |
| Playwright `browser-chrome` / `browser-edge` with the branded filter | 17 cases each |

The discovered counts equal the pass counts recorded in [config/release-candidate.json](../../config/release-candidate.json). No case is listed twice in any project. `accessibility/presentation.spec.ts:145` is one source line that generates two cases (standard, and enlarged with high contrast and reduced motion). Case identity must therefore include the title, not only `file:line`.

### Branded filters

The release gate's optional `browser-chrome` and `browser-edge` steps run `tests/browser/{boot,campaign,persistence,offline}.spec.ts`. That list is now `BRANDED_SMOKE_SPECS` in [config/testSelections.mjs](../../config/testSelections.mjs). Each step is reported as skipped when its channel is not installed, and a skipped optional step does not fail the gate. With 8 workers, the offline loop (139 s) sets the wall time of each branded step (about 146 s).

### Balance report producers

[scripts/balance-report.mjs](../../scripts/balance-report.mjs) joins the JSON sections in `reports/balance/`. They are written by:

| Producer | Section | Kind |
|---|---|---|
| `tests/integration/progression.test.ts` | `scenarios-early` | scenarios |
| `tests/integration/progressionMastery.test.ts` | `scenarios-mastery` | scenarios |
| `tests/integration/balance/career*.test.ts` via `tests/support/balance/expectations.ts` | `career-<id>` | careers |
| `tests/integration/balance/matrix/*.test.ts` via `tests/support/balance/matrixSuite.ts` | `matrix-<site>` | matrix |
| `tests/integration/balance/selectiveKills.test.ts` | `selective-kills` | (not read for the headline) |

`tests/integration/siteLadder.test.ts` writes `reports/ladder.json`. It is not a balance input. `BALANCE_MATRIX_SEEDS` switches the matrix to an exploratory seed count. The report checks only that each expected scenario, career and matrix site is present, so a stale or exploratory section can still satisfy it. Phase 12 addresses this.

### Commands that select integration tests

Before the split, all of these named the single `integration` project:

| Command | Selection before the split | After Phase 1 |
|---|---|---|
| `npm test` | all projects | unchanged (both integration projects) |
| `npm run test:integration` | `--project integration` | `--project integration-fast --project integration-release` |
| `npm run verify` | via `test:integration` | unchanged |
| `npm run diagnose:content` | `--project integration tests/integration/contentDiagnostics.test.ts` | `--project integration-fast …` |
| `npm run balance`, `balance:record` | `--project integration tests/integration/progression tests/integration/balance` | `--project integration-release …` |
| `npm run golden:record` ([scripts/golden-record.mjs](../../scripts/golden-record.mjs)) | `--project integration tests/integration/goldenCampaign.test.ts` | `--project integration-fast …` |
| `npm run release:gate`, step `integration` | `--project integration` | the same step, running `--project integration-fast --project integration-release` in one invocation and counting each selection apart |

## 2. Baseline timings and provenance

**Source.** The release gate run of 17 November 2026 that recorded `0.2.0-rc.1`. It is preserved as [baseline/release-gate-2026-11-17.md](baseline/release-gate-2026-11-17.md) and [.json](baseline/release-gate-2026-11-17.json), because later gate runs overwrite `reports/release-gate.md`. The per-case figures below come from `reports/release/results/*.json` of that run. They were still present on 19 November, and Phase 1 did not overwrite them.

**Conditions.** That run used commit `f3b79e8` with uncommitted changes; they were later committed as `ba87332`. The machine was Windows 10 Home 10.0.19045 with an Intel i7-10700KF (8 cores, 16 threads) and 32 GB of RAM. Software: Node v24.21.0, Vitest 5.0.1, Playwright 1.63.0, Chromium 153.0.8010.12, Firefox 155.0, Chrome 157.0.8103.79 and Edge 157.0.4341.60. Playwright used 8 workers with `--retries=1`. No test needed a retry, and both branded channels were available. The steps ran sequentially.

| Step | Cases | Took |
|---|---:|---:|
| typecheck, architecture, content, traceability, balance, build | - | 8.4 s together |
| unit | 1,483 | 14.8 s |
| integration | 317 | 14m 23s |
| performance | 8 | 1m 35s |
| component | 151 | 35.4 s |
| browser (Chromium) | 35 | 15m 04s |
| accessibility (Chromium) | 43 | 1m 15s |
| browser-firefox | 35 | 15m 05s |
| accessibility-firefox | 43 | 1m 28s |
| browser-chrome (optional) | 17 | 2m 26s |
| browser-edge (optional) | 17 | 2m 27s |
| **Sequential gate** | | **54m 41s** (Playwright 37m 45s) |

### Integration, by file (November run, the whole suite in one process pool)

Wall time per file. Summed case time was 11,332 s across 51 files, running in parallel. Files marked *release* are in the Phase 1 release-only selection.

| File | Cases | Wall | Selection |
|---|---:|---:|---|
| balance/matrix/screened-battery | 6 | 859 s | release |
| balance/matrix/pirate-patrol | 6 | 854 s | release |
| balance/matrix/bombardment-line | 7 | 853 s | release |
| balance/matrix/pirate-base | 8 | 744 s | release |
| balance/careerNoModuleDrops | 1 | 724 s | release |
| balance/matrix/range-check | 7 | 685 s | release |
| balance/careerCruiserLoss | 1 | 634 s | release |
| balance/matrix/command-group | 6 | 626 s | release |
| balance/careerHullLadder | 1 | 599 s | release |
| siteLadder | 18 | 545 s | release |
| balance/matrix/crossfire | 7 | 485 s | release |
| balance/matrix/knife-fight | 9 | 398 s | release |
| balance/careerLongRange | 1 | 392 s | release |
| balance/matrix/pirate-scout | 7 | 386 s | release |
| balance/matrix/armored-hold | 8 | 375 s | release |
| progressionMastery | 2 | 357 s | release |
| progression | 5 | 318 s | release |
| balance/matrix/longshot-picket | 8 | 302 s | release |
| balance/matrix/missile-picket | 6 | 231 s | release |
| balance/careerDestroyerLoss | 1 | 218 s | release |
| balance/careerScoutFirst | 1 | 195 s | release |
| campaignProperties | 8 | 182 s | fast |
| goldenCampaign | 22 | 90 s | fast |
| balance/careerPoorPurchase | 1 | 68 s | release |
| balance/selectiveKills | 1 | 65 s | release |
| v02Persistence | 4 | 62 s | fast |
| balance/careerLossRecovery | 1 | 48 s | release |
| loss | 1 | 9 s | fast |
| 23 other files | 163 | under 7 s each | fast (`balance/hullEconomy`, `balance/startingWallet`: release) |

### Slowest Playwright cases (November run)

| Case | Chromium | Firefox |
|---|---:|---:|
| `browser/progression.spec.ts:376` Patrol-to-Base | 844 s | 858 s |
| `browser/combat.spec.ts:185` starter clear, refit, clear again | 247 s | 239 s |
| `browser/loss.spec.ts:132` destroyed, reload, recover, clear | 208 s | 184 s |
| `browser/guidance.spec.ts:109` guided first-user loop | 150 s | 165 s |
| `browser/offline.spec.ts:67` whole loop offline | 145 s | 138 s |
| `browser/ladder.spec.ts:69` destroyer journey | 111 s | 119 s |
| `accessibility/loss.spec.ts:69` loss report, shipless station | 66 s | 68 s |
| `browser/guided.spec.ts:78` guided journey | 49 s | 45 s |
| `accessibility/presentation.spec.ts:145` ×2 | 40 s, 38 s | 46 s, 46 s |
| `browser/space.spec.ts:47` undock, warp, dock, resume | 39 s | 30 s |
| `browser/combat.spec.ts:298`, `:355` mouse-only, keyboard-only | 36 s, 36 s | 27 s, 28 s |

The browser projects took 903 s and 905 s, which is the Patrol-to-Base case plus server start. Every other browser case fits beside it on the other 7 workers. Shortening Patrol-to-Base alone would make `combat.spec.ts:185` (about 4 min) the critical path for those projects.

## 3. Repeatable timing method

- **Release gate.** Run `npm run release:gate` from PowerShell in `D:\Playground\GalacticSoup` on an otherwise idle machine. A Git Bash shell, or a lowercase drive letter, loads React and Vitest twice. Do not change sources while it runs; `.playwright-mcp/` counts as a source. Step wall times are `durationMs` in `reports/release/steps/<step>.json`. Per-case durations, retries, worker count and browser versions are in `reports/release/results/<project>.json` and the step records. Copy `reports/release-gate.md` and `.json` aside before a later run overwrites them.
- **Targeted before/after runs.** Run each command three times in sequence and report the median, wrapped in a PowerShell stopwatch: `$sw=[Diagnostics.Stopwatch]::StartNew(); <command>; $sw.Elapsed.TotalSeconds`. For Vitest, add `--reporter=json --outputFile.json=<file>` to get per-file times. For Playwright, set `RELEASE_GATE_RESULTS=<file>` to get the JSON reporter.
- **Keep these the same on both sides of a comparison:** machine, Node and browser versions, Playwright workers (the default here is 8, half of 16 logical CPUs), retries (`--retries=1` as in the gate, or `0` locally), whether the build is fresh or served (`RELEASE_GATE_SERVE_BUILT=1`), and branded-channel availability. Record total wall time, build and setup time, the slowest case, browser versions, workers, retries, and optional-channel availability.
- **Caveat.** Integration file times measured inside the full suite are inflated by neighbouring files competing for CPU. For example, `campaignProperties` took 182 s in November but about 81 s in the fast selection alone (see the Phase 1 handoff). Compare like with like.

## 4. Acceptance evidence by named case

Every case below runs in `browser` or `accessibility`, and again in the matching Firefox project.

| Evidence | Case | Requirement IDs in the title |
|---|---|---|
| Guided journey | `browser/guided.spec.ts:78` buys and fits a launcher, trades guided volleys, reopens in flight and returns | V02-AC-06, V02-AC-13, FUNC-9.6, FUNC-19.3 |
| Destroyer journey | `browser/ladder.spec.ts:69` buys and flies a destroyer, webs and loots at a fit-sensitive site, refits and reopens at an advanced site | V02-AC-14, V02-AC-03, V02-AC-07, V02-AC-09, FUNC-19.5 |
| Full offline sortie | `browser/offline.spec.ts:67` (also the dominant branded case) | MVP-AC-01, MVP-AC-06, TECH-2, TECH-3.1, TECH-3.2 |
| Starter/refit | `browser/combat.spec.ts:185` clears the easiest site, converts the rewards and clears it again with a better fit | MVP-AC-01…04, -06, -09, V02-AC-01 |
| Guided first-user loop | `browser/guidance.spec.ts:109` | MVP-AC-10, FUNC-3.2, FUNC-19.7, TECH-12.4 |
| Real destruction and recovery | `browser/loss.spec.ts:132`; `accessibility/loss.spec.ts:69` (loss report, shipless station, recovery purchase) | MVP-AC-08, FUNC-9.12, FUNC-5.4, FUNC-3.4, FUNC-22.1 |
| Real-clock navigation | `browser/space.spec.ts:47` undocks, flies, warps, returns home, docks and resumes | MVP-AC-03, MVP-AC-08, MVP-AC-01 |
| Suspension and pause | `browser/campaign.spec.ts:98` (one capped step after suspension), `:85` (no time while closed), `browser/station.spec.ts:137` (clock only while not paused) | V02-AC-13, FUNC-22.12, TECH-9.1, FUNC-3.3 |
| Multi-opponent, mastery and reopen | `browser/progression.spec.ts:376` (section 5) | MVP-AC-01, -05, -06, -07, -09, FUNC-9.10, FUNC-9.11, FUNC-18 |
| Command input | `browser/combat.spec.ts:298` mouse alone, `:355` keyboard alone | MVP-AC-03, FUNC-19.2, FUNC-20, TECH-12.3 |
| v0.1, future and damaged saves | `browser/persistence.spec.ts:213`, `:244`, `:267` | V02-AC-13, TECH-11.4 |
| **V02-AC-14** enlarged hangar and comparison, keyboard ship switch | `accessibility/progression.spec.ts:63` | V02-AC-14, V02-AC-03 |
| **V02-AC-14** market purpose, size and compatibility filters | `accessibility/progression.spec.ts:101` | V02-AC-14, V02-AC-05 |
| **V02-AC-14** twelve destinations in bands, filter, keyboard choice | `accessibility/progression.spec.ts:135` | V02-AC-14, V02-AC-09 |
| **V02-AC-14** guided fire with reduced motion | `accessibility/progression.spec.ts:166` | V02-AC-14, V02-AC-06 |
| **V02-AC-14** fight under a web | `accessibility/progression.spec.ts:190` | V02-AC-14, V02-AC-07 |
| **V02-AC-14** whole browser suite in Firefox | all 35 `browser-firefox` cases | per [requirements.json](../../config/requirements.json) V02-AC-14 extent |

Accessibility audits whose setup repeats station or combat states, for Phases 7, 7a and 10a: `presentation.spec.ts:145` (×2), `:271`, `:336`, `:366`; `combat.spec.ts:75`, `:92`, `:110`, `:122`; `station.spec.ts:49`, `:62`, `:114`, `:140`.

## 5. Patrol-to-Base assertion map

[`tests/browser/progression.spec.ts:376`](../../tests/browser/progression.spec.ts#L376) uses a fixed campaign seed. Each step below is an observable assertion or an action that must succeed. The category column uses the plan's Phase 6 headings. Candidate owners are leads for Phase 6 to verify; this phase does not establish them as equivalent.

| # | Lines | Asserted | Phase 6 category | Candidate retained owner to verify |
|---|---|---|---|---|
| P1 | 385-386 | Departure says no destination is needed before undocking | destination choice | `browser/cockpit.spec.ts:12` (undocks without a destination) |
| P2 | 390-397 | Starting credits buy a second autocannon and 240 phased rounds; refit of three slots and resupply succeed | reward-funded advancement (start) | headless `progression.test.ts` fit-cost case; `browser/station.spec.ts:42` |
| P3 | 398 | Moved ammunition appears in the hold | - | `browser/station.spec.ts:110` |
| P4 | 401-405 | **Reopen 1** at the station: wallet unchanged, two autocannons fitted | reopened ship and wallet | `browser/station.spec.ts:42` (prepares and finds after a reopen) |
| P5 | 408-411 | Warp at 10 km to Derelict Lane; 2 cutters and 1 marksman present | multi-opponent | `integration` `patrol.intermediate` scenario |
| P6 | 412-418 | Pirate Patrol cleared with priority targeting and orbit at 1 km: "Cleared: 13,000 ISK paid"; booster still running | multi-opponent | headless `patrol.intermediate`, ×6 seeds; no other browser multi-opponent fight |
| P7 | 422-425 | 3 wrecks; **reopen 2** in space: 3 wrecks persist and no hostiles remain | wreck persistence | `v02Persistence.test.ts`, golden saves (headless); browser: none known |
| P8 | 426-427 | Every wreck approached, opened and emptied | earned equipment | `browser/ladder.spec.ts:69` (loots), `combat.spec.ts:185` |
| P9 | 428 | Warp home, dock, "Docked at Borrell Harbour" | real undock/warp/dock | `browser/space.spec.ts:47` |
| P10 | 430-434 | Last sortie: "Pirate Patrol cleared: 3 of 3 … 13,000 ISK"; "1 x Small Armour Plating" | earned equipment | headless loot rolls; no other browser owner for this drop |
| P11 | 438-443 | Salvage stacks each sold whole | reward-funded advancement | `browser/combat.spec.ts:185` (converts rewards) |
| P12 | 444-446 | Patrol rewards buy afterburner, capacitor battery and 220 rounds | reward-funded advancement | earning and spending the same reward: keep a played segment |
| P13 | 447-453 | Earned plating and bought modules fitted; fit shows afterburner and plating | earned equipment | keep with P12 |
| P14 | 454-457 | Resupply; repair dialog "recharged to full for free"; capacitor 370 of 370 | repair and recharge | `browser/ladder.spec.ts:69` (repair and resupply); a headless repair rule test |
| P15 | 461-466 | **Reopen 3** at the station: wallet unchanged, afterburner and plating fitted | reopened ship and wallet | checkpoint slice (Phase 4) |
| P16 | 470-472 | Warp at 30 km to Outpost Cradle; 2 gunners | multi-opponent | headless `base.mastery` |
| P17 | 473-481 | Pirate Base cleared nearest-first, keeping 10 km, booster below 80%: 26,000 ISK | multi-opponent | headless `base.mastery`, `base.lancer` (6/6) |
| P18 | 482-486 | Dock; Last sortie "Pirate Base cleared: 4 of 4 … 26,000 ISK" | completion | - |
| P19 | 490-493 | **Reopen 4**: the last-sortie outcome persists | reopened state | checkpoint slice |
| P20 | 498-499 | Departure: "Chosen destination: Pirate Base. Space navigation offers it first." | destination choice | `accessibility/progression.spec.ts:135` |
| P21 | 500-502 | In space Pirate Base is pressed; briefing "Cleared 1 times" | completion count | headless `encounter.test.ts` completionCount; browser: none known |
| P22 | 503-506 | Pirate Scout and Pirate Patrol remain choosable and warpable | destination choice | `accessibility/progression.spec.ts:135`; `browser/ladder.spec.ts:69` |

No step clears the same site twice. "Repeat clears" in the browser comes from `combat.spec.ts:185`, which clears the Scout again, and from the headless scenarios and site ladder. The fight loop's `press()` swallows every error (lines 239-247). Phase 6 replaces this.

## 6. Cases to tag

**Feature smoke (Chromium only, Phase 2).** These are small existing cases for the plan's coverage list. Times are from the November Chromium run with 8 workers in parallel.

| Purpose | Case | Nov. |
|---|---|---:|
| Worker boot and compiled content | `browser/boot.spec.ts:19`, `:48` | 0.7 s, 0.6 s |
| Campaign create and IndexedDB reopen | `browser/campaign.spec.ts:57`; `:208` (starting fit through the real worker and IndexedDB) | 1.6 s, 1.7 s |
| Station transaction | `browser/station.spec.ts:42` (prepares a ship end to end, finds it after a reopen) | 12.3 s |
| Navigation or combat command from a checkpoint | to be added in Phase 3: paused Scout, select, lock, fire, stop. No current case starts from a checkpoint | - |
| Keyboard | `accessibility/campaign.spec.ts:48` (start and close with the keyboard), `accessibility/station.spec.ts:122` (surface and purchase by keyboard) | 6.6 s, 1.4 s |
| Axe | `accessibility/shell.spec.ts:10` | 1.1 s |

That is 8 cases and about 26 s of summed case time under load.

**Release journeys and required witnesses (Phase 5).** These are all of section 4, by stable identity (project, file, full title) in each required engine. Mark the long ones too (`progression.spec.ts:376`, `combat.spec.ts:185`, `loss.spec.ts:132`, `guidance.spec.ts:109`, `offline.spec.ts:67`, `ladder.spec.ts:69`, `guided.spec.ts:78`, `space.spec.ts:47`, `accessibility/loss.spec.ts:69`) so that they can be selected or excluded explicitly. Feature-tagged cases must stay in the four release projects (Phase 2 exit).

Titles carry requirement IDs in brackets, which traceability reads. Use Playwright's `tag` option (`{ tag: '@feature' }`) rather than editing titles, so that case identity and traceability stay unchanged.

## Handoff

- **Changed files.** `scripts/test-discovery.mjs` (new), `config/testSelections.mjs` (new; the branded spec list moved here from the gate), `scripts/release-gate.mjs` (imports it), `package.json` (`test:discover`), and the saved baseline files in this folder.
- **Commands.** `npm run test:discover` (exit 0; counts as in section 1). The baseline was captured before any selection change.
- **Next.** Phase 1, which was done in the same session: see [phase-1-integration-split.md](phase-1-integration-split.md).
