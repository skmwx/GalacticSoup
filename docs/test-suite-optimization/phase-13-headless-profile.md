# Phase 13: profile of the headless release work

This is the Phase 13 handoff of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It follows [Phases 11-12](phase-11-12-docking-and-balance-inputs.md) and was done on top of `9293702`. No simulation, fixture or file under `src/` changed. Phase 13 measures, and its exit is the decision recorded in [Decision](#decision-for-phase-13a). Phase 14's results are in [phase-14-acceptance.md](phase-14-acceptance.md).

## The profiler

A small profiler sits under [tests/profiling/](../../tests/profiling/). No test project, npm script or gate step picks it up, `npm run test:discover` is unchanged, and it asserts nothing.

- **[vitest.profile.config.ts](../../tests/profiling/vitest.profile.config.ts).** This is a Vitest configuration of its own, with the same aliases and content plugin as the test projects, one fork, and no parallelism.
- **[headless.profile.ts](../../tests/profiling/headless.profile.ts).** It flies one matrix cell (`PROFILE_TARGET=cell:<fitId>@<encounterId>`) or one career (`career:<id>`) with the real drivers, `measureCell` and `runCareer`. It wraps every engine host they open and times each request by type. Time outside the host is the drivers' own work. It then times `writeBalanceSection` into a temporary directory. With `#<n>` it flies only the first n seeds. With `PROFILE_CHECKS=lightweight` it opens the hosts with the production commit check; it writes the result either way, so two runs can be compared figure for figure. With `PROFILE_CPU=<dir>` it also writes a V8 CPU profile of the workload alone.
- **[cpuProfileSummary.mjs](../../tests/profiling/cpuProfileSummary.mjs).** It reports self time by area and inclusive time for the operations the plan names: copying, validation, freezing, simulation, projections, attribute derivation, inventory scans, the pilot and saving.

```powershell
# From PowerShell on D:\ (a lowercase drive or Git Bash loads Vitest twice)
$env:PROFILE_TARGET='cell:fit.cruiser.railgun@encounter.borrell.screened-battery'
$env:PROFILE_OUT='C:\temp\cell.json'
npx vitest run --config tests/profiling/vitest.profile.config.ts
node tests/profiling/cpuProfileSummary.mjs <dir>\workload.cpuprofile
```

All figures below come from the same machine as the [Phase 0 baseline](phase-0-inventory.md#2-baseline-timings-and-provenance): an i7-10700KF with 8 cores and 16 threads, Node v24.21.0 and Vitest 5.0.1. Each run used one fork on an otherwise idle desktop, from PowerShell.

## What was profiled

The two slowest units in the last full integration run (the Phase 12 gate run, `reports/release/results/integration.json`):

| Unit | In the gate (16 workers) | Alone | Ratio |
|---|---:|---:|---:|
| Matrix cell `fit.cruiser.railgun` at `screened-battery` (10 seeds) | 366.0 s, the longest matrix case | **154.5 s** | 2.4× |
| Career `v02-no-module-drops` (3 seeds, 28 sorties each) | 692.5 s, the longest case | **199.1 s** | 3.5× |

### Longest case against summed time

- **Longest case:** `careerNoModuleDrops`, at 692.5 s in the gate and 199.1 s alone.
- **Longest file:** `matrix/screened-battery`, at 825.0 s. Its six cells run one after another in one worker.
- **Summed case time:** 11,305 s across 63 files.
- **Integration step wall time:** 877.5 s.

The step is bounded by total CPU work rather than by one case. 11,305 s over 16 workers is 707 s, so even a perfect schedule would save at most about 170 s. Each case runs 2.4-3.5 times slower in the gate than alone because the 16 workers share 8 physical cores. **Making each unit cheaper is the lever. Splitting or reordering files is not.**

## Where the time goes

### By request (wall time, one fork, complete commit checks)

| | Cell | Career |
|---|---:|---:|
| Workload | 154.5 s | 199.1 s |
| Engine host, all requests | 153.9 s (99.6%) | 198.6 s (99.7%) |
| — `time.advance` (simulation advancement and its commit) | 124.5 s, 36,978 steps, 3.37 ms each | 162.1 s, 64,538 steps, 2.51 ms each |
| — pilot queries during fights (`combat.state`, `navigation.site`, `encounter.state`) | 22.7 s, 27,569 requests | 32.1 s, 32,142 requests |
| — other queries (previews, assets, wreck contents) | 0.1 s | 1.5 s |
| — other commands (movement, locks, weapons, modules, transactions) | 6.7 s | 2.9 s |
| Drivers: pilot decisions, records, cell and career arithmetic | **0.6 s** | **0.5 s** |
| Report serialization (`writeBalanceSection`) | **7 ms**, 6.6 KB | **8 ms**, 103 KB |

`combat.state` is the expensive query, at about 2.2 ms per read against 0.3 ms for `navigation.site`. The pilot reads it once per simulated second.

### By function (V8 CPU profile, 3 cell seeds and 1 career seed)

Inclusive shares of the CPU profile. The rows overlap: derivation runs inside both simulation and validation.

| Operation | Cell | Career |
|---|---:|---:|
| **Ship attribute derivation** (`deriveShipAttributes`, then `evaluateAttributes`) | **45.9%** | **37.2%** |
| Simulation advancement (`handleAdvanceTime`, including its derivation) | 51.7% | 40.7% |
| Complete commit validation (`validateCampaign`) | 16.6% | 23.6% |
| Projections answering queries | 12.8% | 14.8% |
| `deepClone` inside projections | 8.8% | 9.8% |
| Transaction copy (`draftOf`) | 8.6% | 9.4% |
| Inventory scans (`stacksIn`, `usedVolume`) | 7.8% | 9.1% |
| Freezing the committed state (`deepFreeze`) | 3.4% | 5.3% |
| Response transport check (`findTransportViolation`) | 1.5% | 1.4% |
| Request validation | 0.1% | 0.1% |
| Pilot (`fightEncounter`, test code) | 0.1% | 0.1% |

`deriveShipAttributes` is called without a cache from `combatantOf` (13.1 s of the cell's 22.8 s), `regenerateShips` (4.5 s), `movementAttributes` (3.8 s) and `validateFits` (1.0 s). Every simulation step re-derives every ship's attributes from its fit several times, although a fit does not change during a fight.

### Complete validation, measured directly

Production hosts commit with the lightweight boundary check and validate completely only when they save. Test hosts validate completely on every commit. The same workloads with `PROFILE_CHECKS=lightweight`:

| | Complete | Lightweight | Saving | Figures |
|---|---:|---:|---:|---|
| Cell (10 seeds) | 154.5 s | 126.7 s | **18.0%** | byte-identical `CellSummary` |
| Career (3 seeds) | 199.1 s | 157.1 s | **21.1%** | byte-identical `CareerSeedRun[]` |

### Fights that cannot end

The slowest cell is slow because nothing happens in it. All 10 railgun-cruiser seeds at `screened-battery` end `timedOut`. The ship fires all 300 rounds, then sits out the rest of the 900 s `FIGHT_BUDGET_SECONDS` while the pilot asks for a reload every second: 20,480 `weapon.reload` requests in the cell, all refused.

In the Phase 12 gate run's matrix sections, **53 of 720 outcomes (7%) timed out, and they account for 47,700 of 138,659 simulated fight seconds (34%)**:

| Site | Fit | Timed out | Mean rounds fired |
|---|---|---:|---:|
| `bombardment-line` | `fit.frigate.guided` | 10 of 10 | 88 |
| `pirate-patrol` | `fit.cruiser.railgun` | 10 of 10 | 300 |
| `screened-battery` | `fit.cruiser.railgun` | 10 of 10 | 300 |
| `range-check` | `fit.cruiser.railgun` | 9 of 10 | 296 |
| `pirate-scout` | `fit.cruiser.railgun` | 8 of 10 | 271 |
| `knife-fight` | `fit.cruiser.railgun` | 6 of 10 | 227 |

These outcomes are evidence. The `outcome` claims at `knife-fight` and `range-check` rest on the railgun cruiser not clearing, and the cells' damage and net-credit figures include the idle time. Stopping these fights early would change measured figures. It is a balance-policy decision, not an optimization that keeps evidence identical.

## Reuse comparisons

The plan permits reusing a measured sortie only when the starting state, fit, site, seed, command policy and measured outputs all match.

### Prepared `base.lancer` against the `long-range` career

| | `progressionMastery` "long-range approach" | `long-range` career, final step |
|---|---|---|
| Starting state | `assembleFit('lancer')` on a new campaign: starting wallet less the fit, no history | after 3+ Patrol and 2 Base sorties: earned wallet, kept loot, completion counts, advanced random streams and simulation time |
| Fit, site, tactics, seeds | `lancer`, `pirate-base`, `base.lancer`, the same 3 seeds | the same |
| Sorties | 2 per seed, refit between | until 2 completions, at most 2 |
| Measured | bands: completion share, median fight 400-600 s, hit points lost, damage taken | stall or finish, credits, running-cost share |

The starting states differ, so the sorties do not match, and the two cases measure different things. Both stay. In the gate, the prepared case took 215 s and the whole career 384 s.

### Site ladder against the matrix

Every ladder seed is a matrix seed, and 11 of the 12 ladder fits are reference fits flown with the same assembled starting state. **No ladder scenario has the matrix command policy.** None carries the shared `retreatBelowHullFraction: 0.35`, because a ladder fit must complete rather than leave. Some also differ in other ways:

- **Arrival distance:** `pirate-base` and `command-group` arrive at 50 km against the matrix's 30. Two weak fits also differ: `knife-fight.weak` and `screened-battery.weak` arrive at 10 km against 30, and `range-check.weak` at 30 against 10.
- **Hold fire:** `armored-hold` and `range-check` fly without `holdFireBeyondKm: 4`.
- **Movement:** `range-check.weak` keeps range at 15 km, where the matrix orbits at 5 km.

The ladder also flies two consecutive sorties with a refit between. No ladder sortie can therefore stand in for a matrix outcome, or the reverse. To repeat the check, compare each `tests/fixtures/scenarios/ladder.json` scenario's `tactics` with `matrixTactics(fitId, encounterId)` from `tests/fixtures/balance/matrix.json`.

### Duplicated career prefixes

`v02-cruiser-loss` repeats the first seven steps of `v02-hull-ladder` exactly:

- the same seeds;
- the same equips, with `reuse`;
- the same sites, goals and budgets;
- the same kept-loot set, `{intermediate, frigate.autocannon, destroyer.blaster-web, cruiser.railgun}`;
- the same module-drop policy.

Its prefix is therefore deterministic duplicated work, most of its 606 s in the gate. `v02-no-module-drops` uses the same plan with module drops left in the wrecks, so it diverges from the first loot and is not a duplicate.

## Retained evidence

Nothing was removed. The cases that carry these remain unchanged:

- economic progression: the hull ladder, scout-first and long-range careers;
- the no-drop route: `v02-no-module-drops`;
- loss recovery: the loss-recovery, destroyer-loss and cruiser-loss careers;
- consecutive clears and full bounty: `progression`, `progressionMastery` and `siteLadder`;
- fit comparisons: the twelve matrix files and their declared claims.

## Decision for Phase 13a

There are four measured candidates. Each would be one session.

| Candidate | Measured scope | Evidence identical? | Where |
|---|---|---|---|
| **A. Cache derived ship attributes** per fit inside a step or transaction | 37-46% of the headless CPU is derivation, most of it repeated | Yes, if exact: replay hashes, golden saves and balance figures must not move | `src/engine` (engine change) |
| B. Lightweight commit checks in the release-only simulations, with complete checks kept in one career and in the whole fast selection | 18-21% of each workload | Yes on the two profiled workloads; the in-run invariant check becomes weaker | test support |
| C. A pilot that leaves when it has no rounds left | 34% of simulated matrix fight time | **No**: outcomes change from `timedOut` to `retreated`, and the candidate figures move | balance policy |
| D. Fly the shared seven-step prefix once for `v02-hull-ladder` and `v02-cruiser-loss` | about 5% of the selection's CPU | Yes, the state is deterministic | test support |

**Recommendation: A.** It addresses the measured bottleneck and keeps the evidence identical. It also helps the shipped game, which derives attributes the same way every frame. Prove it the way 13a requires:

- the canonical replay hashes, golden campaign and `integration-fast` pass unchanged;
- `npm run release:gate -- --only=integration,balance` reports 0 differences from the candidate;
- three alone-runs of this profiler's two workloads show the saving.

It touches `src/`, which no earlier phase of this plan did, so the operator should agree to it first. **B** is the test-only fallback. **C** needs a balance decision before it is an optimization at all. **D** is small. The integration step is limited by total CPU work, so the cell and career savings should carry over roughly in proportion to gate time. Phase 14 records where the gate stands without any of them.
