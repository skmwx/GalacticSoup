# Phase 14: acceptance run and timing comparison

This is the final handoff of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It follows [Phase 13](phase-13-headless-profile.md). The runs used `9293702`, plus the Phase 13 profiler (`tests/profiling/`, which no suite runs) and the one-line component fix described [below](#a-fix-made-during-this-phase).

**Results:**

- **The release gate is GREEN.** It completed with every required step and all 58 required witness results passing in both engines.
- **The feature target is met narrowly.** The `verify:feature` median is 116.9 s against 2 minutes. The smoke median is 11.6 s against 1 minute.
- **The gate target is missed narrowly.** The gate took 36m 43s against the 35-minute target, down from 54m 41s.
- **The bottleneck is the integration step,** whose cost Phase 13 explains. The recommended follow-up is Phase 13a.

## Scope note: phases not done

Phases **7a, 10a and 11a** were never started. Each earlier handoff says so, and this session did not do them either.

- **7a** would move the guided and web accessibility setup to checkpoints.
- **10a** would consolidate the station and presentation audits.
- **11a** would consolidate duplicate assertions across layers.

Each one would shorten the suite or remove duplicate assertions. None removes evidence that exists today, and the gate passes with every case they would touch still in place. Phase 13a (one headless improvement) is also not done; Phase 13 records the decision. The timings below are therefore the suite without 7a, 10a, 11a and 13a.

## 1. Traceability and evidence review

- **Traceability.** `npm run traceability` reports 168 requirements: 134 included, 134 covered, 1 planned and 33 deferred. The gate's own traceability step passed with 0 uncovered.
- **Removed assertions.** Every removal has a retained owner recorded in the phase that made it:
  - [Phase 4](phase-4-progression-checkpoint.md#assertion-map-for-phase-6) and [Phase 6](phase-5-6-release-evidence-and-patrol.md#assertion-map): Patrol-to-Base, assertion by assertion;
  - [Phase 8](phase-7-8-scout-commands-and-loss.md): loss recovery;
  - [Phase 10](phase-9-10-branded-offline-and-boot.md): boot and same-origin;
  - [Phase 11](phase-11-12-docking-and-balance-inputs.md): the docking component case, which is now controlled frames, with the real-clock dock kept in `browser/space.spec.ts`.

  The retained browser owners that are named witnesses ran and passed in both engines in this gate (below). The headless owners are in the integration step, which passed 333 of 333. Phases 13 and 14 removed nothing.
- **Played loops.** These are retained and passed in this gate in Chromium and Firefox:
  - the guided journey;
  - the destroyer journey;
  - real-clock navigation;
  - suspension, closed time and pause;
  - starter/refit;
  - the guided first-user loop;
  - loss and recovery, and the loss wreck;
  - the full offline sortie;
  - the played multi-opponent case;
  - mastery continue;
  - the checkpoint command and rewards;
  - mouse-only and keyboard-only command input;
  - damaged, future and v0.1 saves.

  The accessibility witnesses for loss, combat, standard and enlarged presentation, and the V02 hangar, market, destination, guided-fire and web cases also passed in both engines.
- **V02-AC-14.** The **whole** Firefox browser suite ran: `browser-firefox` discovered 36 cases, ran 36 and passed 36 with no retry, with 20 of 20 witnesses. `accessibility-firefox` ran 43 of 43, with 9 of 9 witnesses.
- **Isolated regressions from earlier phases.** Each failed in the intended retained case:
  - Phase 3: a broken lock command, and missing accessible combat status;
  - Phase 4: an incorrect restored fit;
  - Phase 5: unit checks that a partial report, an omitted case and a skipped witness each fail the gate;
  - Phase 11: the market refresh dropped on docking;
  - Phase 12: stale, duplicate, wrong-identity and missing balance sections.

  Phase 6 ran none, as its handoff records; the plan's Phase 6 exit does not ask for them.

## 2. Feature verification

`npm run verify:feature` was run three times in sequence from PowerShell on `D:\`. The conditions match the Phase 0 baseline machine:

- i7-10700KF, 8 cores and 16 threads, on an otherwise idle desktop;
- Node v24.21.0, Vitest 5.0.1 and Playwright 1.63.0, with Chromium 153.0.8010.12;
- 8 Playwright workers, retries 0 (the script's setting), and a fresh build each run.

| Run | Result | Total (report) | Smoke (incl. preview start) | Unit + component | Fast integration | Typecheck, architecture, content, traceability, build |
|---|---|---:|---:|---:|---:|---:|
| 1 | passed | 116.9 s | 11.5 s | 43.9 s | 58.1 s | 3.5 s |
| 2 | passed | 118.6 s | 11.6 s | 44.0 s | 59.5 s | 3.5 s |
| 3 | passed | 116.0 s | 12.2 s | 43.1 s | 57.4 s | 3.4 s |
| **Median** | | **116.9 s** | **11.6 s** | 43.9 s | 58.1 s | 3.5 s |

- **Overall: 116.9 s, under the 2-minute target by 3 s.** The PowerShell stopwatch around `npm run` read 117.4 s for the same run.
- **Smoke: 11.6 s, under the 1-minute target.** It ran 8 cases on 8 workers. The Playwright time inside it was 11.1 s.
- Each run passed 1,660 unit and component cases in 94 files, 211 fast-integration cases in 37 files, and 8 smoke cases.
- The margin is small. Fast integration (58 s) and unit with component (44 s) are 87% of the run, and both are bound by CPU. Any growth in them takes the run over the target.

These are the first three passing runs. Phase 2 left this measurement open because a loaded machine timed out component cases. The cause turned out to be [below](#a-fix-made-during-this-phase), not the load alone.

### A fix made during this phase

The first three runs on the idle machine all **failed** after about 47 s in the same case: `StationScreen.test.tsx` "shows the slot a module fits and which charges suit the current fit", with `Test timed out in 5000ms`. The case is a purchase, a refit and two market reads. It takes about 2.9 s in the component project alone, as in the gate, and about 5.3 s when `verify:feature` runs the component and unit projects together. It was the only multi-step flow there without its own limit; the case at `StationScreen.test.tsx:729` and others declare one. It now declares `30_000` like them, with a comment saying why. No assertion changed. The three runs above were taken after the fix.

## 3. The release gate

`npm run release:gate` was run once to completion from PowerShell on `D:\`, with no source edits during the run; only `docs/` changed. The report is `reports/release-gate.md`. Copies are in [baseline/release-gate-2026-11-20.md](baseline/release-gate-2026-11-20.md) and [.json](baseline/release-gate-2026-11-20.json), next to the November baseline.

**Automated gate: GREEN.** Every required step passed against these sources and this bundle:

- **Source digest:** `c8f94c20b0cff2a9b76fdbb0f633e6805817cf52128f0e399b24beb85186edd4`
- **Build fingerprint:** `c75b1d09cdeb18db0f4e3a868f4c605f73a7066a2c6647dca9c2f5ff8d438e5e`. Both builds were identical byte for byte, and the audit passed.
- **Commit:** `9293702` with uncommitted changes, namely this session's.
- **Content:** `0.2.0+d168547388ff`, tuning `5da105a5d78a`.

The report says the recorded candidate is still `0.2.0-rc.1`: the sources changed since it was recorded. Recording a new candidate with `npm run release:record` is the operator's release decision. This session did not record one.

### Results

| Step | Result | Took | 17 Nov baseline |
|---|---|---:|---:|
| Type check, architecture, content, balance, traceability, build ×2 and audit | passed | 9.8 s together | 8.4 s |
| Unit | 1,509 passed | 15.7 s | 14.8 s |
| Integration: fast 211 in 37 files, plus release-only 122 in 26 files | 333 passed | **14m 51s** (890.5 s) | 14m 23s (317 cases) |
| Balance report | 15 scenarios, 8 careers, 12 matrix sites; **identical to the recorded balance candidate** | 1.4 s | (included above) |
| Performance, isolated | 8 passed, all within budget (one 50 ms quantum: p95 1.657 ms against a 4 ms budget) | 1m 36s | 1m 35s |
| Component | 151 passed | 36.9 s | 35.4 s |
| Browser, Chromium | 36 of 36; **1 passed on a retry** | 9m 06s | 15m 04s |
| Accessibility, Chromium | 43 of 43 | 59.2 s | 1m 15s |
| Browser, Firefox | 36 of 36 | 7m 27s | 15m 05s |
| Accessibility, Firefox | 43 of 43 | 1m 07s | 1m 28s |
| Chrome (optional) | 14 of 14, the short offline flow | 13.0 s | 2m 26s (17 cases) |
| Edge (optional) | 14 of 14 | 14.5 s | 2m 27s (17 cases) |
| **Sequential gate** (stopwatch around `npm run release:gate`) | | **36m 43s** (2,202.7 s) | **54m 41s** |
| Playwright, all six projects | | 19m 07s | 37m 45s |

**Conditions.** The machine, Node v24.21.0, Vitest 5.0.1 and Playwright 1.63.0 were the same as in November. So were Chromium 153.0.8010.12, Firefox 155.0 and Chrome 157.0.8103.79. Edge updated itself from 157.0.4341.60 to 158.0.4370.33. Playwright used 8 workers with `--retries=1`, as in November, and both branded channels were available, as in November. The branded projects now run the short offline flow (Phase 9) by design. The comparison is otherwise like for like.

**The retry.** In Chromium, the played multi-opponent case (`browser/progression.spec.ts:367`, witness `multi-opponent-rewards`) failed its first attempt 46 s in. After the reopen at the station (line 396), the Modules list held one `200mm Autocannon` instead of two. The wallet assertion just before it had passed. The retry passed (415 s), and Firefox passed on its first attempt (397 s). The trace was not kept: the next project clears `test-results/`. This spec is known to be timing-sensitive, and nothing in this session touched it, the browser support or `src/`. Still, a fit missing after a reopen is the kind of fault the case exists to catch. **Treat it as open** until it is reproduced or explained (see [Open items](#open-items)). The retry cost the gate 46 s.

### Against the 35-minute target

**Missed by 1m 43s.** Without the retry's 46 s it would still be about 35m 57s, so the miss is not the retry alone.

| Where the 36m 43s went | Time | Share |
|---|---:|---:|
| Integration, of which release-only simulations are almost all | 14m 51s | 40% |
| Browser projects, Chromium and Firefox | 16m 33s | 45% |
| Everything else | 5m 19s | 15% |

- **Browser.** The Chromium and Firefox browser projects fell from 30m 09s to 16m 33s. The played multi-opponent case (about 7 min) now sets each project's length, as Phase 6 expected.
- **Integration.** This is now the largest single step. The longest case is `careerNoModuleDrops` at 704.1 s. The longest file is `matrix/screened-battery` at 838.9 s. Summed case time is 11,508 s over 16 workers, so the step is bound by total CPU work ([Phase 13](phase-13-headless-profile.md#longest-case-against-summed-time)).

**The measured follow-up is Phase 13a, candidate A:** cache derived ship attributes. Derivation was 37-46% of the profiled headless CPU, and the evidence would stay identical. If the integration step shrinks in proportion to its CPU work, the gate would drop to about 30-31 minutes. That is an estimate from the profile, not a measurement. The test-only fallback, candidate B (lightweight commit checks in the release-only simulations), measured 18-21% on single workloads, which would be roughly 2.5-3 minutes of the step. Either would meet the target with margin. Neither is applied here.

## Human playtest

**V02-AC-15 (Q13) is still pending,** separately from this gate. It is the human playtest of fit and hull progression in [questions-and-answes.md](../agent-comm/requests/questions-and-answes.md). Its traceability row has no automated evidence by design. Release acceptance needs it in addition to this evidence.

## Changed files

| File | Change |
|---|---|
| `tests/profiling/vitest.profile.config.ts`, `headless.profile.ts`, `cpuProfileSummary.mjs` | New: the Phase 13 profiler. No project, script or gate step includes it, and discovery is unchanged. |
| `tests/component/StationScreen.test.tsx` | One case declares a 30 s limit (above). |
| `docs/test-suite-optimization/phase-13-headless-profile.md`, `phase-14-acceptance.md` | New handoffs. |
| `docs/test-suite-optimization/baseline/release-gate-2026-11-20.{md,json}` | A copy of this gate's report. |

These checks passed:

- `tsc --noEmit`;
- `check:architecture`: 301 files, no violations;
- `npm run test:discover`: every check `ok`;
- `npm run traceability`: 134 of 134.

The gate itself re-ran all of them.

## Open items

1. **The 35-minute gate target is missed by 1m 43s.** The measured follow-up is Phase 13a candidate A. It touches `src/engine`, so the operator should agree to it first; candidate B is the test-only fallback.
2. **The Chromium retry of `progression.spec.ts:367`.** It found one autocannon instead of two after a reopen. Reproduce it with `npx playwright test --project=browser tests/browser/progression.spec.ts:367 --repeat-each=5 --retries=0 --trace=on` against the served build, and compare with `HEAD` before calling it a regression. If it is a race between `applyFit` and the close, the test needs a firmer wait. If the saved fit is really lost, it is a product defect.
3. **The `verify:feature` margin is 3 s.** Unit with component and fast integration are CPU-bound. Phase 11a (removing duplicate assertions) and the profile's findings (the per-commit cost inside the golden and property runs) are the levers.
4. **Phases 7a, 10a and 11a** are not done (above).
5. **Not recorded as a candidate.** This gate's sources are not committed, and `0.2.0-rc.1` stays the recorded candidate until the operator commits and runs `npm run release:record`.
