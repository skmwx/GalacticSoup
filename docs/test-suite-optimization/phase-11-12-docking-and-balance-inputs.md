# Phases 11 and 12: a deterministic docking regression, and isolated balance report inputs

This is the handoff for Phases 11 and 12 of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It follows [Phases 9-10](phase-9-10-branded-offline-and-boot.md). Both phases were done in one session on top of `288605b`. Phase 11a (duplicate assertions) was not part of this session. No file under `src/` changed.

## Phase 11: the docking component regression

### What changed

The case is "returning to a reopened campaign > reads the market again on docking after the campaign was reopened in space" in [CombatScreen.test.tsx](../../tests/component/CombatScreen.test.tsx). Before this change, it undocked headlessly, reopened in space, clicked through the dock and then waited up to 20 s of real time for the frame clock to finish docking.

It now has two parts:

1. **A prepared docking state.** The headless sortie undocks, orders the dock and runs until the order reaches `travelStatus { kind: 'dock', phase: 'preparing' }`, which means the ship is in dock range and the 3-second dock timer is running. The campaign is then closed in space.
2. **Controlled frames.** [tests/support/controlledFrames.ts](../../tests/support/controlledFrames.ts) replaces `requestAnimationFrame`, `cancelAnimationFrame` and `performance.now`, so no frame runs until the test steps one. `observe(gateway)` wraps the gateway so that each step waits for its `time.advance` to be answered. The test resumes the campaign, presses Resume, and steps 250 ms frames until "Docked at Borrell Harbour" appears (at most 40 frames). It then pauses, opens the Market, switches to Sell, and requires every `Sell Fusion S` offer to be available. Before docking, it also asserts that no Market button is shown.

The shipped frame driver, `useSimulationClock` and `usePlayData` are unchanged. The dock completes in an advance that the interface itself sent, and its invalidations reach the market through the normal path. `resume()` in the same file takes an optional gateway wrapper. The other cases do not use it.

The real-clock dock through the shipped worker remains in [browser/space.spec.ts](../../tests/browser/space.spec.ts) ("undock, warp, dock, resume"). That spec was not touched.

### The case fails when the refresh is broken

These checks used temporary edits to [usePlayData.ts](../../src/ui/frame/usePlayData.ts). Each edit was reverted, and `git status` confirmed that `src/` was clean afterwards.

| Mutation | Result |
|---|---|
| `applyInvalidations` drops `market` from every invalidation's targets | **Fails** at `Unable to find role="button" and name /^Sell Fusion S \((Hangar\|Hold)\)$/` |
| Only the `station` topic stops mapping to `market` | Passes. The same dock also invalidates `assets` and `inventory`, and both of those also map to `market`. The old real-clock version shares this redundancy. Removing one of three paths is not a broken refresh. |

### Timing

The measurements used the same machine and PowerShell, with `npx vitest run --project component <file> -t "reads the market again" --reporter=verbose`. There were 3 alternating rounds. The "before" side is the `HEAD` version of the file, run from a temporary copy.

| Run | Before | After |
|---|---:|---:|
| 1 | 14,092 ms | 1,846 ms |
| 2 | 14,081 ms | 1,924 ms |
| 3 | 14,123 ms | 1,870 ms |
| **Median** | **14.09 s** | **1.87 s** |

The whole component project passed 151 of 151 in 34.5 s.

## Phase 12: isolated and validated balance inputs

### The run directory

- **Integration step.** In [release-gate.mjs](../../scripts/release-gate.mjs), the `integration` step now creates a fresh `reports/release/balance-run/` before Vitest starts. It deletes whatever was there and writes `run.json`, which contains the `runId` (a UUID), the `sourceDigest`, `contentVersion`, `contentHash` and `tuningDigest`, and `createdAt`. Vitest then runs with `BALANCE_SECTIONS_DIR` and `BALANCE_RUN_ID` set to that directory and run. The step record carries `balanceRun`.
- **Balance step.** The `balance` step reads the manifest. It fails in these cases:
  - there is no run ("run the integration step first");
  - the run measured other sources (`manifest.sourceDigest` differs from the current digest).

  Otherwise it runs `scripts/balance-report.mjs --run-dir=reports/release/balance-run`, records `balanceRun`, and compares the result with the candidate as before.
- **Section writer.** `writeBalanceSection` in [tests/support/balance/report.ts](../../tests/support/balance/report.ts) writes to `BALANCE_SECTIONS_DIR` when it is set. Otherwise it writes to `reports/balance/`. It stamps every section JSON with `run: { runId, contentVersion, contentHash }`. The `runId` is `null` outside the gate, and the content identity comes from the shipped bundle.

### The rules

The rules live in [scripts/lib/balanceInputs.mjs](../../scripts/lib/balanceInputs.mjs) (`readBalanceRun`). [balance-report.mjs](../../scripts/balance-report.mjs) uses it in place of its old loop, which kept the last section found for each id. The report exits 1 and lists every problem in these cases:

- **Stale input:**
  - a section has no run stamp, for example one written before this change;
  - a section measured another `contentVersion` or `contentHash`;
  - with `--run-dir`, a section's `runId` is not the manifest's;
  - the manifest is missing, or it was started for other content or tuning.
- **Duplicate:**
  - a scenario, career or matrix site appears in two sections;
  - a seed, sortie, fit or claim repeats within a section.
- **Incomplete coverage or exploratory subset:** each of the following must match its fixture exactly, with nothing missing and nothing extra:
  - **Scenarios:** the outcomes are exactly the fixture's `seeds × sorties` (as `seed#sortie`), `planned` matches, and the fit and encounter match.
  - **Careers:** the run seeds are exactly the fixture seeds.
  - **Matrix sites:** the cells are exactly the fixture's fits; each cell's outcome seeds are exactly `matrix.seeds` and its `seeds` count matches; the verdicts are exactly the claims declared at that site.

  Any measurement that no fixture declares is also refused.

`figures` sections, such as `selective-kills`, need only a valid stamp. Assembly, the headline, `reports/balance.json`, the Markdown and the candidate comparison are all unchanged.

### Standalone workflows

`npm run balance` and `npm run balance:record` have not changed. They still write to `reports/balance/` and run the report without `--run-dir`, and every rule except the run id still applies. **Sections written before this change carry no stamp.** The first `node scripts/balance-report.mjs` against them now fails with "carries no run stamp … Run the balance simulations again." This was verified on this machine. Running `npm run balance` once rewrites them. The standalone scripts themselves were not run end to end in this session (about 14 minutes). The unit checks cover the unstamped-run-id path. Performance is untouched. It is still its own gate step, and no balance input reads it.

### Evidence

- **Unit checks.** [tests/unit/config/balanceInputs.test.ts](../../tests/unit/config/balanceInputs.test.ts) has 16 cases:
  - a fresh run empties its directory and writes the manifest;
  - a complete run passes, with and without a required run id;
  - it refuses another run's section, an unstamped section, a directory with no manifest, other content in a section or in the manifest, a scenario duplicated across sections, a repeated career seed, a repeated matrix fit, a missing section, an exploratory seed subset, a missing fit or claim, wrong scenario seeds, a missing career seed, and an undeclared career.

  The whole unit project passes 1509 of 1509.
- **Gate run.** `npm run release:gate -- --only=integration,balance` was run from PowerShell on `D:\`, with 880 s of wall time. Both steps passed against run `077d95ce-3c8b-442b-96d8-944186dfe4a1`:
  - **integration:** 333 of 333 passed (`integration-fast` 211 in 37 files, `integration-release` 122 in 26 files), in 877.5 s. The 17 November baseline was 862 s.
  - **balance:** "Balance report for run 077d95ce…: 15 scenarios, 8 careers, 12 matrix sites, tuning 5da105a5d78a, 0 differences from the candidate", in 1.1 s. The directory held 23 section JSON files, their Markdown files and the manifest.
- **Real sections, tampered.** Copies of that run directory were each changed in one way and then assembled with `--run-dir`:

  | Copy | Exit | First reason |
  |---|---|---|
  | unchanged | 0 | same figures, 0 differences |
  | `career-scout-first` stamped with another run id | 1 | belongs to run an-earlier-run … it is stale; no measurement for scout-first |
  | `scenarios-mastery.json` copied | 1 | scenario base.mastery was measured twice |
  | `matrix-crossfire` with another content hash | 1 | measured content … (000000000000), not the current … it is stale |
  | `matrix-pirate-base.json` deleted | 1 | no measurement for matrix encounter.borrell.pirate-base |
  | `matrix-pirate-scout` cut to 2 seeds | 1 | counts 2 seeds, not the fixture's 10; is missing seeds … |

- **Other checks:**
  - `tsc --noEmit` passes.
  - `check:architecture` reports 301 files and no violations.
  - `npm run traceability` covers 134 of 134.

## Open items

- **The standalone run has not been confirmed.** Run `npm run balance` once to restamp `reports/balance/` and confirm that it ends with 0 differences.
- **The station-topic redundancy in Phase 11.** No component case would notice if only the `station` mapping dropped the market. The case does notice when the market refresh is lost entirely.
- **Reusing controlled frames.** Other component tests that wait for travel could use `controlFrames()`, as the proposal suggests. None were changed here.

## Next

- Phase 7a, then Phase 10a. Phase 11a can also run now.
- Phase 13, which profiles the headless release work, can now start. It depends on Phase 12, and its batching follow-up (13a) can rely on these checks for deterministic merge and full fixture coverage.
