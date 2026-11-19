# Phase 1: Split integration selection

This is the Phase 1 handoff of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It depends on the [Phase 0 inventory](phase-0-inventory.md).

## What changed

- **Selections declared once.** [config/testSelections.mjs](../../config/testSelections.mjs) defines `INTEGRATION_INCLUDE` (`tests/integration/**/*.test.ts`, the suite as it was) and `INTEGRATION_RELEASE_INCLUDE`: `balance/**`, `progression.test.ts`, `progressionMastery.test.ts` and `siteLadder.test.ts`. It also names the two Vitest projects, the required and branded Playwright projects, and the branded spec filter.
- **[vitest.config.ts](../../vitest.config.ts).** The `integration` project is replaced by two disjoint projects:
  - `integration-fast` includes everything and excludes the release-only globs. It keeps replay, persistence, properties, the golden campaign, loss, and the fixed-seed Scout sortie.
  - `integration-release` includes only the release-only globs.
- **[package.json](../../package.json):**
  - `test:integration` runs both projects in one invocation, so it covers the same union of files as before.
  - `test:integration:fast` and `test:integration:release` are new.
  - `diagnose:content` now names `integration-fast`; `balance` and `balance:record` name `integration-release`, with the same path filters.
  - `test`, `verify` and `test:performance` are unchanged.
  - `test:discover` is new (Phase 0).
- **[scripts/golden-record.mjs](../../scripts/golden-record.mjs)** names `integration-fast`.
- **[scripts/release-gate.mjs](../../scripts/release-gate.mjs).** *(Superseded by the follow-up below: one `integration` step now runs both selections in one invocation.)* The `integration` step is replaced by `integration-fast` and `integration-release`. Both run before `balance`, which joins the sections the release-only simulations write. Performance stays a separate step, after balance. The results go to `reports/release/results/integration-fast.json` and `integration-release.json`.
- **[tests/integration/encounter.test.ts](../../tests/integration/encounter.test.ts).** The fixed-seed Scout sortie ("completes the easiest site from the starter state and returns with rewards") already asserted the 3,000 ISK bounty and the wallet. It now also asserts conserved cargo:
  - what leaves the wreck is exactly what the hold gains, per item;
  - after retreat and docking, the hold and the wallet (start + bounty) are unchanged.
- **[README.md](../../README.md)** lists the new commands.

## The Scout sortie in the fast selection

The plan asks for this to be measured before it goes into the fast selection. The case was already in the integration suite and is not release-only, so it is in `integration-fast`.

Measured: the case took **4.0 s** median (3.99, 3.70, 4.08 s) inside three fast-selection runs. The whole file (6 cases) took 2.9 s in a run on its own. It stays in the fast selection.

## Evidence

**Discovery.** `npm run test:discover` exits 0, and every check passes:

```
Vitest files by project: {"component":13,"integration-fast":25,"integration-release":26,"performance":1,"unit":80}
  ok   the fast and release-only integration selections are disjoint
  ok   their union is every integration file
  ok   the release-only selection is the balance, progression and site-ladder files
  ok   test:integration runs the whole union
  ok   test:integration:fast runs only the fast selection
  ok   npm test runs every discovered file once
  ok   diagnose:content resolves the content diagnostics file alone
  ok   balance resolves the progression and balance simulations
  ok   balance:record resolves the progression and balance simulations
  ok   no Playwright case runs twice in a project
```

Compared file by file with [discovery-baseline.json](discovery-baseline.json), captured before the split, these resolve exactly the same files as before: `test`, `test:unit`, `test:integration`, `test:component`, `test:performance`, `diagnose:content`, `balance` and `balance:record`. The Playwright discovery is identical. The check for the release-only set uses a predicate written independently of the Vitest globs.

**Fast integration.** `vitest run --project integration-fast`, three runs in sequence on the Phase 0 machine, from PowerShell with an idle desktop:

| Run | Result | Wall |
|---|---|---:|
| 1 | 195 passed | 83.8 s |
| 2 | 195 passed | 86.4 s |
| 3 | 195 passed | 86.5 s |
| **Median** | | **86.4 s** |

The slowest files (run 2) were `campaignProperties` 82.7 s, `goldenCampaign` 50.3 s, `v02Persistence` 26.8 s, `loss` 5.8 s and `npcArchetypes` 4.9 s. Every other file took under 5 s.

**Release gate plan.** `node scripts/release-gate.mjs --only=integration-fast,integration-release,balance` ran from PowerShell on the same machine, with no source edits during the run. It exited 0 after 17m 16s:

| Step | Result | Cases | Took |
|---|---|---:|---:|
| `integration-fast` | passed | 195 of 195, 25 files | 81.6 s |
| `integration-release` | passed | 122 of 122, 26 files | 15m 51s |
| `balance` | passed: 15 scenarios, 8 careers, 12 matrix sites, tuning `5da105a5d78a`, **0 differences from the candidate** | - | 1.0 s |

195 + 122 = 317, the November integration count. The two steps together took 17m 13s, against 14m 23s for the single November step. The cost is running the two selections one after the other instead of sharing one process pool, and almost all of it is the release selection. Phase 13 owns headless release time.

The gate report now says INCOMPLETE, because the other steps are stale against the changed sources, as expected for a partial run. The November report is preserved in [baseline/](baseline/).

**Other checks.** `tsc --noEmit` passes; `check-architecture` reports 301 files and no violations; `tests/unit/config` has 49 passing tests, including the gate's judge; `traceability` covers 134 of 134 included requirements.

## Follow-up after review: split slow files, one gate invocation

On 19 November 2026 the operator chose to split the slow files and to run both selections in one gate invocation (the first two open decisions below).

**The slow files, split.** Each file now holds independent cases, so Vitest runs them side by side. No assertion was dropped. The fast selection still has 195 cases.

| Before | After | Notes |
|---|---|---|
| `campaignProperties.test.ts` (8 cases) | `campaignProperties` (run 1 and the reopen comparison, which reuses run 1), `…NewCampaign`, `…Wreck`, `…Combat`, `…Progression`, `…Loss` | The run machinery moved unchanged to [tests/support/properties/campaign.ts](../../tests/support/properties/campaign.ts). Two cross-run checks had to be reassigned (below). |
| `goldenCampaign.test.ts` (22 cases) | `goldenCampaign` (record and byte-for-byte compare; still the file `golden:record` runs), `…Replay` (in-process replay with the open and rebuild checks for each state, which need the replay's projections), `…Worker` (worker-dispatcher replay), `…Continue` (each save continued to the next state) | The gateway and projection helpers moved to [tests/support/golden/gateways.ts](../../tests/support/golden/gateways.ts). Describe and test titles are unchanged. |
| `v02Persistence.test.ts` (4 cases) | `v02Persistence` (Bombardment Line and station state), `…Webs` (Range Check), `…Mixed` (Command Group) | The flight machinery moved to [tests/support/persistence/reopen.ts](../../tests/support/persistence/reopen.ts). |

The cross-run checks in `campaignProperties` were reassigned as follows:
- **"Exercised the whole loop".** This was asserted over the union of all six runs. It is now asserted of the golden wreck run alone, in `campaignPropertiesWreck.test.ts` under the same title. A probe of the current runs showed that this run alone commits all 15 command families, visits the station, warp and 6 sites, and has 25 refusal kinds. The check is now stricter than the union was, and it still passes.
- **"A ship was lost".** This is now asserted of run 6, in `campaignPropertiesLoss.test.ts`. That run was the only one that lost a ship.
- **The snapshot-size bound.** This is asserted in every run, which is equivalent to the maximum over all runs.

Per-run coverage from the probe:

| Run | Families missing | Sites | Refusal kinds | Lost a ship | Largest snapshot |
|---|---|---:|---:|---|---:|
| a new campaign | repair.confirm, loot.take | 5 | 22 | no | 84,591 B |
| another new campaign | repair.confirm, loot.take | 6 | 19 | no | 82,193 B |
| the golden wreck save | none | 6 | 25 | no | 108,462 B |
| the golden combat save | loot.take | 5 | 24 | no | 97,508 B |
| the golden completed-progression save | repair.confirm, loot.take | 5 | 23 | no | 118,286 B |
| the golden combat save, fought to a loss | loot.take | 7 | 24 | **yes** | 99,761 B |

**The fast selection after the split.** `vitest run --project integration-fast`, three runs: 54.2, 52.0 and 53.6 s, a **median of 53.6 s** (it was 86.4 s), 195 of 195 passing each time. With 16 logical CPUs Vitest starts up to 16 workers, so the ten heavy files run together. Each case then takes about three times as long as alone; for example, property run 1 took 31 s instead of about 12 s. The selection is now limited by its total CPU work, not by one file. Splitting further will not help much. Fewer property steps or fewer golden replays in feature runs would, but that reduces evidence and is not proposed.

**One gate invocation.** The gate's `integration` step is back, with the November id. It runs `vitest run --project integration-fast --project integration-release` once and writes `reports/release/results/integration.json`. The step record carries the overall counts in `tests` and, under `selections`, one set of counts for each selection. The step fails unless each selection passed tests of its own, so a run that silently loses one selection cannot pass.
- Vitest's JSON result does not name each file's project. The gate classifies files with `isIntegrationReleaseFile` from `config/testSelections.mjs`, which is unit-tested in `tests/unit/config/releaseGate.test.ts` together with the new `readVitestSelections` in `scripts/lib/release.mjs`.
- `npm run test:discover` also checks that this predicate agrees with the Vitest projects.
- `--only=integration` works again, and the recorded candidate's `gate.integration` key is valid again.

**Gate check of the follow-up.** I ran `node scripts/release-gate.mjs --only=integration,balance` from PowerShell on the same machine, with no source edits during the run. It exited 0.

| Step | Result | Cases | Took |
|---|---|---:|---:|
| `integration` | passed | 317 of 317, 61 files; `integration-fast` 195 of 195 (35 files), `integration-release` 122 of 122 (26 files) | **15m 41s** |
| `balance` | passed: 15 scenarios, 8 careers, 12 matrix sites, tuning `5da105a5d78a`, 0 differences from the candidate | - | 1.3 s |

The integration step took 15m 41s. Two sequential steps had taken 17m 13s, and the single November step 14m 23s. The remaining 1m 18s over November is one run, not a median. The likely cause is that the split fast files now run alongside the long matrix files and compete with them for CPU. The release-only simulations are the critical path, and Phase 13 owns them.

## Open decisions for Phase 2

The first two decisions below were resolved by the follow-up above, and are kept as the record of what was decided.

- **The fast selection alone is about 86 s, and `campaignProperties.test.ts` sets that time.** Its seven property cases take 8-16 s each (run 2: 12.7, 7.9, 12.9, 13.3, 15.7, 11.8, 8.4 s), and Vitest runs the cases of one file in sequence. `goldenCampaign` (three cases of about 15 s) and `v02Persistence` (10.6, 6.1, 10.1 s) behave the same way. With typecheck, unit (about 15 s), component (about 35 s), build and the Chromium smoke, `verify:feature` is unlikely to meet the 2-minute target unless one of these is done:
  - Split these files so their cases run in parallel. This changes no coverage, and the wall time would fall to about the longest case, around 16 s.
  - Shorten the property runs for feature runs, keeping the full count in the release gate.
  - Move them to the release-only selection.

  The plan keeps replay, persistence and properties in the full union, so any of these is allowed. Splitting the files is the lowest-risk option. It needs a decision, and Phase 14 assesses the target.
- **Running the two selections in sequence adds about 2m 50s to the gate.** If this matters before Phase 13, the gate could run both projects in one Vitest invocation (`--project integration-fast --project integration-release`) and split the JSON result by project into the two step records. That would bring back the shared process pool. Otherwise the fast step could run while the release step runs, though not alongside performance.
- *(Superseded by the follow-up: the step is `integration` again.)* **Release gate step ids changed.** `integration` is now `integration-fast` plus `integration-release`. The recorded candidate's `gate` map in `config/release-candidate.json` still names `integration`, and it is rewritten by the next `release:record`. `--only=integration` is now refused with the list of valid steps.
- **Balance inputs are not isolated yet.** `npm run balance` still joins whatever sections are in `reports/balance/` (Phase 12).

## Next

Phase 2: add `npm run verify:feature` and the Chromium smoke selection, using the feature cases listed in [Phase 0 section 6](phase-0-inventory.md#6-cases-to-tag).
