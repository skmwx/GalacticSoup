# Lettered phases: 6a, 7a, 10a, 11a and 13a

This is the handoff for the lettered phases of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It was done on top of `105c654`, which holds Phases 13 and 14 ([profile](phase-13-headless-profile.md), [acceptance](phase-14-acceptance.md)). Phase 14 had left these phases open.

| Phase | Outcome |
|---|---|
| 6a | **Not built.** The decision to keep the real clock is recorded below. |
| 7a | Done. The guided and web audits open prepared checkpoints. |
| 10a | Done. One presentation matrix now owns the station-surface and purchase audits. |
| 11a | Done. Duplicate compile, capability, shortcut and authored-shape assertions are consolidated into their owners. |
| 13a | Done, candidate A. Derived ship attributes are cached exactly, with identical evidence. The headless work is 41-52% faster. |

The acceptance re-run after these changes is in [Acceptance after the lettered phases](#acceptance-after-the-lettered-phases).

## 6a: manual time stepping

The plan says 6a should be built only if Phase 6 identified "one expensive transition that a checkpoint cannot cover". [Phase 6](phase-5-6-release-evidence-and-patrol.md) found none to step through. The played multi-opponent case is the only long browser case left, and the slow parts it keeps are its evidence:

- the Patrol fight;
- the approach to the wrecks;
- the warps.

They are exactly what the plan says must stay on the real clock. Manual stepping would also need a test-only entry and an audit of the production bundle for test controls.

The gate's critical step is now the integration step, not the browser (Phase 14), and 13a reduced that step. **Decision: keep the real-clock execution, as 6a's exit allows.** If the browser projects become the critical path again, measure the wreck approaches and the reopen in space first, as Phase 6 suggested.

## 7a: guided and web accessibility from checkpoints

Changes:

- **Two new checkpoints** in [scenarios.ts](../../tests/support/checkpoint/scenarios.ts):
  - `guided-incoming`: paused at the Missile Picket 10 km out, the Pirate Lancer locked and one of its guided volleys in flight at the ship.
  - `web-held`: paused at the Range Check after a warp 10 km out, the ship held still until the Pirate Binder webbed it.

  Both are reached headlessly over the protocol, like the others.
- **New site facts.** `incomingProjectiles` and `incomingWebs` are now part of every site checkpoint's facts. `verifyCheckpoint` therefore refuses a save that resumes without the volley or the web.
- **[checkpoints.test.ts](../../tests/integration/checkpoints.test.ts).** The determinism loop covers both new checkpoints, and a new case checks each one is paused with what it promises.
- **[browser.ts](../../tests/support/checkpoint/browser.ts).** It knows the two site headings, and `openCheckpoint` takes the first opponent's name. The default is still `Pirate Scout`.
- **[accessibility/progression.spec.ts](../../tests/accessibility/progression.spec.ts).** The guided-fire and web audits open these checkpoints through the real start screen and worker. They keep these assertions:
  - reduced motion;
  - the diamond projectile marker with its text title;
  - the speed limit in words;
  - the effect naming the binder;
  - the web marker's title;
  - the expanded audit.

  The three other cases still start a fresh campaign, now inside each case, because a checkpoint can only be seeded into an empty context. Titles are unchanged, so the `v02-guided-fire` and `v02-web` witnesses still match.
- **What stays elsewhere.** Launch, flight and reopening in flight stay in the guided browser journey. Timing and expiry stay in the headless guided-weapon and web tests.

**Timings** were taken on the same machine with retries 0. "Before" is from the 20 November gate. "After" is the median of 3 runs with `--repeat-each=3` against the served build.

| Case | Chromium before / after | Firefox before / after |
|---|---:|---:|
| Guided fire | 24 s / **4.8 s** | 26 s / **6.7 s** |
| Web | 35 s / **5.6 s** | 28 s / **6.5 s** |

They no longer wait up to 90 s and 120 s of real time for the volley or the web.

**Checks:**

- All 10 progression accessibility cases pass in both engines.
- The headless checkpoints pass 17 of 17.
- Discovery finds both witnesses once in each accessibility project.

## 10a: station and presentation audits

**Shared tags.** [tests/support/axe.ts](../../tests/support/axe.ts) holds the common axe tags: WCAG 2.1 A and AA plus WCAG 2.2 AA. It also holds `audit()` and the sideways-scroll check. The station, presentation and combat specs all use it. The combat audits, including the expanded equipment and context-menu audits, now also run the WCAG 2.2 rules, and they pass.

**[presentation.spec.ts](../../tests/accessibility/presentation.spec.ts).** The matrix is now "audits every station surface and a confirmation at {standard | enlarged}". It covers the six surfaces, the purchase dialog and Settings at both presentations, with no sideways scroll. The fight moved out of the matrix:

- **Enlarged fight.** A new case, "audits a fight at doubled size, high contrast and reduced motion", opens the `scout-fight` checkpoint with that display already set. It no longer flies there in real time.
- **Standard fight.** This is now owned by `combat.spec.ts` "passes an automated audit in the middle of a fight". That case expands every entry and now uses the same tags.

**[station.spec.ts](../../tests/accessibility/station.spec.ts).** These cases were removed, each with its retained owner:

| Removed | Retained owner |
|---|---|
| Audit on every station surface | The standard matrix, with more surfaces and the WCAG 2.2 tags |
| Audit inside a confirmation | The purchase dialog audit in both matrix cases |
| Focus trap and return in the purchase confirmation | presentation "traps focus in every confirmation and returns it…": purchase, sale, item details twice, insurance and the undock warning |
| Doubled interface scale | The enlarged matrix: doubled interface and text, through the real setting, on every surface, with no sideways scroll |
| The Buy-mode audit before the Sell switch | The matrix's Market audit |

The station spec keeps the Sell audit and radio-key switch, the typed quantity and its refusal, the keyboard-only purchase (`@feature`), and the refusal explained without colour. Each accessibility project goes from 43 cases to 40.

**Witnesses.** In [config/releaseWitnesses.mjs](../../config/releaseWitnesses.mjs), `presentation-standard` and `presentation-enlarged` carry the new titles. The new `presentation-enlarged-fight` is the enlarged fight; the standard-size fight is the existing `combat-audit`. Discovery finds every witness once in each project.

**Isolated regression.** `Dialog.tsx` was changed temporarily so that it no longer returned focus to its opener. The retained owner, "traps focus in every confirmation and returns it…", failed in both engines at `expect(opener).toBeFocused()`. The change was reverted, and `git status` showed `src/` clean.

**Timings** (one run, retries 0):

| Case | Chromium before / after | Firefox before / after |
|---|---:|---:|
| Matrix, standard | 37 s / 24.5 s | 51 s / 29.2 s |
| Matrix, enlarged | 37 s / 24.6 s | 51 s / 26.9 s |
| Enlarged fight (new) | - / 5.3 s | - / 4.1 s |

The four station cases removed ran 1-4 s each. The 32 cases of the three specs pass in both engines.

## 11a: duplicate assertions across layers

These are the targets the [proposal](../proposals/test-suite-optimization.md) names.

| Removed or changed | Retained owner |
|---|---|
| `buildIntegration.test.ts` "compiles the shipped content": `result.ok` after `compileContentOrThrow` and a definition count | `compileContentOrThrow` throws on failure, and every test project compiles the shipped content at startup. What the bundle holds belongs to `shippedContent.test.ts` and the compiler tests. The invalid build-start, refusal and virtual-module cases stay. |
| `contentPort.test.ts` "lists the content request among the engine capabilities" | `engineHost.test.ts` "reports the request types it accepts", which compares the whole list with `REQUEST_TYPES`. The supplied-content and both-transport cases stay. |
| `actionRunner.test.tsx` "gives every action a label, an icon and a remapping category" (non-empty strings) | Labels: `messageCatalog.test.ts` checks every `ACTION_MESSAGE_KEYS` entry in the catalogue, and those keys come from the registry. Categories: a new `bindings.test.ts` case requires every remappable action's category to be one the settings list. Icons and categories are also typed unions. |
| `actionRunner.test.tsx` shortcut uniqueness | `bindings.test.ts` "binds every default shortcut to exactly one action". It now also asserts `defaultShortcuts()`, which nothing else covered. Action-id uniqueness stays in `actionRunner.test.tsx`, along with action submission and UI wiring. |
| `dataDriven.test.ts`: the exact resistance keys of every hull layer, and the exact damage keys of every charge | The schemas (`damageProfile` and `resistanceProfile`, both requiring all four keys with no others). A new negative case in `schemaValidation.test.ts` shows a missing and an unknown damage type each refused at the file and path. The positive damage total stays, as "gives every shot some damage". |

Protocol schema parity, adversarial validation, migrations, golden saves, replay hashes, boundary rows and the balance checks were not touched.

**Isolated regressions.** Each was made in the working tree and reverted with `git checkout`, and `src/` and `schemas/` were clean afterwards.

- **`damageProfile` with `additionalProperties: true`.** The new schema case fails ("expected true to be false"), and the remaining `dataDriven` cases still pass. The schema guard has an owner that notices.
- **Two actions given the shortcut `h`.** `bindings.test.ts` "binds every default shortcut to exactly one action" fails.

## 13a: cache derived ship attributes (candidate A)

**The change.** [shipAttributes.ts](../../src/engine/domain/attributes/shipAttributes.ts) is this plan's first change under `src/`.

`deriveShipAttributes` is a pure function of five things:

- the hull;
- the online modules in fitted order;
- the content;
- the activation assumptions, which are only ever tested for membership;
- the speed effects.

It now keeps each result, keyed exactly on those inputs:

- **Scope.** Results are held per content repository and hull object, in `WeakMap`s, so nothing outlives its content.
- **Freezing.** Each result is deep-frozen, so a caller cannot change what the next caller receives. Every unit, integration and component test still passes with frozen results, so no caller mutates one.
- **Bound.** A cache that passes 4,096 entries for one hull is emptied. That costs a recomputation and changes no result.
- **Callers.** No caller changed. The game's worker benefits in the same way.

**Identical evidence.**

- The profiler's results are **byte-identical** to the Phase 13 runs before the change, for the matrix cell and for the career (`CellSummary` and `CareerSeedRun[]` compared as JSON).
- Unit (1,509) and fast integration (213) pass. That includes the golden campaign record and byte comparison, the in-process and worker replays, the canonical replay hashes, the property runs and the persistence reopen.
- The component project passes 150 of 150.
- The gate re-run below reports the balance figures against the recorded candidate.

**Measured on the same workloads**, alone, in one fork with complete checks:

| Workload | Before (Phase 13) | After | Change |
|---|---:|---:|---:|
| Matrix cell `fit.cruiser.railgun` at `screened-battery`, 10 seeds | 154.5 s | **74.8 s** (median of 74.5, 75.3, 74.8) | **-52%** |
| Career `v02-no-module-drops`, 3 seeds | 199.1 s | **117.6 s** | **-41%** |
| Within the cell: `time.advance` | 124.5 s | 57.1 s | -54% |
| Within the cell: `combat.state` reads | 19.7 s | 9.4 s | -52% |

Candidate B (lightweight commit checks) and the others in Phase 13 were not applied. Each phase changes one thing.

## Acceptance after the lettered phases

The conditions were the same as in [Phase 14](phase-14-acceptance.md#2-feature-verification):

- the same machine, from PowerShell on `D:\`, otherwise idle;
- Node v24.21.0, Chromium 153.0.8010.12, Firefox 155.0, Chrome 157.0.8103.79 and Edge 158.0.4370.33;
- 8 Playwright workers, retries 1 in the gate, both branded channels available.

**Traceability:** 134 of 134 included requirements covered. **Discovery:** every check passes, with `accessibility` and `accessibility-firefox` at 40 cases each.

### `verify:feature`, three runs

| Run | Total (report) | Smoke | Unit + component | Fast integration |
|---|---:|---:|---:|---:|
| 1 | 94.7 s | 11.4 s | 42.3 s | 37.7 s |
| 2 | 93.3 s | 11.3 s | 42.2 s | 36.3 s |
| 3 | 92.8 s | 11.6 s | 41.9 s | 35.9 s |
| **Median** | **93.3 s** (Phase 14: 116.9 s) | **11.4 s** (11.6 s) | 42.2 s (43.9 s) | **36.3 s** (58.1 s) |

The run is now **under the 2-minute target by 27 s**, against 3 s before; the margin came from 13a's effect on the golden and property runs. Each run passed 1,509 unit, 150 component, 213 fast-integration and 8 smoke cases. These runs came before the timeout fix below, which touches only an accessibility case that is not in the smoke.

### The release gate

The gate was run twice. **The first run** (27m 06s) was green, but two of the new presentation matrix cases passed only on a retry in Firefox. They had exceeded Playwright's default 30 s test timeout, at 35-36 s. 10a had removed the flight from those cases and, with it, their `test.setTimeout(4 * 60_000)`, but their eight audits still take 25-30 s in Firefox. They now declare 2 minutes, and they passed 12 of 12 (three repeats in both engines, retries 0).

**The second run is the evidence for these sources.** It ran to completion with no source edits during the run; only `docs/` changed.

- **Report:** `reports/release-gate.md`, with a copy in [baseline/release-gate-2026-11-20-lettered.md](baseline/release-gate-2026-11-20-lettered.md) and [.json](baseline/release-gate-2026-11-20-lettered.json).
- **Result:** GREEN.
- **Source digest:** `af4b7b4becf585df12a0824d09fa753401b086080450c91935982b765184437f`.
- **Build fingerprint:** `b31dc2c57daf826f05148c7db5b45616b9806507fa62937c773f37c81285ecbe`. Both builds were identical, and the audit passed.
- **Balance:** **identical to the recorded balance candidate**, which is the gate's check that 13a changed no figure.
- **Witnesses:** all required witnesses passed in both engines: 20 browser and 10 accessibility per engine.

| Step | 20 Nov (Phase 14) | Now | 17 Nov baseline |
|---|---:|---:|---:|
| Integration | 14m 51s (333 cases) | **7m 22s** (335 cases) | 14m 23s |
| Performance | 1m 36s | 1m 02s | 1m 35s |
| Component | 36.9 s | 36.4 s | 35.4 s |
| Browser, Chromium | 9m 06s, one retry | 8m 03s, one retry (below) | 15m 04s |
| Accessibility, Chromium | 59.2 s | 35.7 s | 1m 15s |
| Browser, Firefox | 7m 27s | 7m 55s | 15m 05s |
| Accessibility, Firefox | 1m 07s | 55.7 s | 1m 28s |
| Chrome, Edge (optional) | 13.0 s, 14.5 s | 17.0 s, 15.9 s | 2m 26s, 2m 27s |
| **Sequential gate** | **36m 43s** | **27m 32s** (1,651.5 s) | **54m 41s** |

- **Against the target:** the gate is **under the 35-minute target by 7m 28s**. The first run, with its two retries, took 27m 06s.
- **Integration:** summed case time halved, from 11,508 s to 5,668 s. The longest case, `careerNoModuleDrops`, fell from 704 s to 363 s.
- **Performance budgets:** one 50 ms quantum now takes 0.805 ms at the 95th percentile with production checks, against 1.657 ms on 20 November, with the same 4 ms budget.
- **The critical path is now the browser.** The Chromium and Firefox browser projects are 15m 58s of the 27m 32s. Each is as long as the played multi-opponent case (about 7 minutes) plus server start; see 6a for how to shorten it if that is ever needed.

**The retry in this run.** In Chromium, `browser/persistence.spec.ts:185` "keeps five rolling autosaves and one manual save, each written whole" failed its first attempt after 39 s with `Tearing down "context" exceeded the test timeout of 30000ms`. The retry passed, and so did Firefox. No file under `tests/browser`, `src/adapters` or `src/gateway` changed in this work. It is a slow browser-context close, not an assertion. It is recorded as an open flake, like the Phase 14 retry of `progression.spec.ts:367`, which did not recur in either run here.

### What is still open

1. **Two retries, one in each gate run of this session.** The first was `progression.spec.ts:367` in Phase 14. The second is the context teardown in `persistence.spec.ts:185`. Neither has been reproduced on demand. Phase 14 gives a command for the first; for the second, run `npx playwright test --project=browser tests/browser/persistence.spec.ts:185 --repeat-each=10 --retries=0`.
2. **Not recorded as a candidate.** `0.2.0-rc.1` stays the recorded candidate until the operator commits these sources and runs `npm run release:record`.
3. **V02-AC-15**, the human playtest (Q13), is still pending.
4. **Phase 13's other candidates** are not applied:
   - B, lightweight commit checks in the simulations;
   - C, a pilot that leaves when out of rounds, which is a balance decision;
   - D, sharing the duplicated career prefix.

   With the gate now under target, none is needed for timing.

## Changed files

| File | Phase |
|---|---|
| `src/engine/domain/attributes/shipAttributes.ts` | 13a |
| `tests/support/checkpoint/scenarios.ts`, `browser.ts`; `tests/integration/checkpoints.test.ts`; `tests/accessibility/progression.spec.ts` | 7a |
| `tests/support/axe.ts` (new); `tests/accessibility/presentation.spec.ts`, `station.spec.ts`, `combat.spec.ts`; `config/releaseWitnesses.mjs` | 10a |
| `tests/unit/content/buildIntegration.test.ts`, `dataDriven.test.ts`, `schemaValidation.test.ts`; `tests/integration/contentPort.test.ts`; `tests/component/actionRunner.test.tsx`; `tests/unit/ui/bindings.test.ts` | 11a |
