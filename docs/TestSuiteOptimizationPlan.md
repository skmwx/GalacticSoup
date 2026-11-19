# Test suite optimization plan

This plan implements the [test suite optimization proposal](proposals/test-suite-optimization.md). It adds a fast verification command for feature work and preserves complete acceptance evidence in the release gate. Each phase, including each lettered phase, is sized for one agentic session with its own deliverable and exit checks.

## Baseline and targets

The 17 November 2026 release evidence for `0.2.0-rc.1` records **54m 41s** for the sequential gate, including **37m 45s** for Playwright and **14m 22s** for Vitest integration. The required projects contained 35 browser and 43 accessibility cases per engine. The two-sortie Patrol-to-Base case took **14m 04s** in Chromium and **14m 18s** in Firefox, making it the first release critical path to address. These are historical measurements. [Release evidence](../reports/release-gate.md), [candidate counts](../config/release-candidate.json), [progression spec](../tests/browser/progression.spec.ts#L376)

| Workflow | Coverage | Timing target |
|---|---|---|
| Feature or pull request | `npm run verify:feature` runs typecheck, architecture and content validation, unit and component tests, fast integration, traceability, and a small Chromium smoke from one fresh production build. The smoke covers the real worker, campaign creation and IndexedDB reopen, a station transaction, a navigation or combat command from a checkpoint, and representative keyboard and axe checks. | Median under **2 minutes** end to end, with Chromium smoke under **1 minute**. |
| Combat, navigation, economy, or balance change | Run feature verification and the affected browser and headless cases. Run full balance for changes to shared combat, economy, pilot policy, or tuning semantics. | Record the targeted runtime when comparing a change. |
| Release or candidate | `npm run release:gate` runs both integration selections, full balance and site ladder, replay, persistence and properties, isolated performance, reproducible production builds and audit, and all retained Chromium and Firefox browser and accessibility cases. Branded Chrome and Edge smoke remains optional. The human playtest remains separate. | Comparable sequential gate under **35 minutes** after the critical-path work, with the same engine and branded-channel availability as the baseline. |

Keep the existing `npm run verify` behavior during rollout. Keep the release gate's double build and fingerprint checks. Apply the timing targets after verifying coverage. [Technical Specification §15.1](02_TechnicalSpecification.md#151-test-levels), [requirement extent](../config/requirements.json#L1529)

## How to run a phase

Start with the predecessor's handoff and current test discovery. Complete the stated slice, run its focused checks, and record the changed files, commands and observed results, timing where relevant, evidence moved between tests, open decisions, and the next phase. Use the existing release reports for pre-change timings where comparable. For a feature or targeted before/after benchmark, take at least three comparable runs on the same machine and report the median. Record total wall time, build and setup time, slowest case, browser versions, worker count, retries, and optional-channel availability. Use the same retry and worker settings on both sides of a comparison.

Leave each phase in a working state. If a conditional change needs more work, close the current session with the measured result and a bounded follow-up. Use focused commands and discovery during implementation. Phase 14 owns the full end-to-end acceptance run.

## Phase 0 — Inventory the baseline and acceptance evidence

**Depends on** the current repository and recorded candidate.

- Capture Vitest file discovery and Playwright case discovery for all four required projects. Inventory existing branded filters, balance report producers, and the commands that select integration.
- Map the browser and accessibility acceptance evidence to named cases, with special attention to the guided and destroyer journeys, full offline sortie, starter/refit, guided first-user loop, real destruction and recovery, and `V02-AC-14` surfaces. Map the Patrol-to-Base test's individual assertions before any replacement.
- Document a repeatable timing command and comparison conditions using the November evidence as the historical reference.

**Exit** A saved discovery and evidence inventory, baseline timings with provenance, and the list of cases to tag for feature and release verification.

## Phase 1 — Split integration selection

**Depends on** Phase 0.

- In [Vitest configuration](../vitest.config.ts), define a named fast integration selection and a disjoint release-only selection for `balance/**`, `progression.test.ts`, `progressionMastery.test.ts`, and `siteLadder.test.ts`. Keep replay, persistence, and properties in the full integration union. Measure a fixed-seed headless Scout with expected bounty and conserved cargo and credits before adding it to the fast selection.
- Update the [npm scripts](../package.json) and [release gate](../scripts/release-gate.mjs) together. Preserve the full behavior of `test`, `test:integration`, and `verify`, the targeted content diagnostics and balance commands, and the gate's integration result and balance inputs. Keep performance isolated.

**Exit** Discovery proves the fast and release-only selections are disjoint and their union matches the previous integration suite. The targeted scripts still resolve the intended files, a fast integration run passes, and the release plan still runs both selections before report assembly.

## Phase 2 — Add feature verification and Chromium smoke selection

**Depends on** Phase 1.

- Add `npm run verify:feature`. Run typecheck once, combine the selected Vitest projects where practical, and build once after typecheck. Start a managed production preview that fails if its port is already occupied. Use tags or project filters to select a small set of existing browser and accessibility cases for worker boot, campaign create and reopen, a station transaction, and keyboard and axe checks.
- Keep the smoke cases in the full release projects. Run only the four intended projects for the required release evidence so the Chromium smoke project adds no duplicate executions to the gate.

**Exit** The new command passes, the occupied-port case fails clearly, and discovery proves the feature cases also run exactly once in each applicable release engine. Record three comparable feature runs as the starting point. Phase 3 adds the checkpoint command witness and Phase 14 assesses the timing targets.

## Phase 3 — Pilot a browser checkpoint in Scout combat

**Depends on** Phase 2.

- Build one Playwright helper around the [headless scenario session](../tests/support/progression/session.ts), [golden save patterns](../tests/support/golden/campaign.ts), and [IndexedDB adapter](../src/adapters/persistence/indexedDbSaveStore.ts). Generate from the compiled content of the served build. Seed the slot manifest and snapshot in a fresh context through an inert same-origin setup page, or capture equivalent IndexedDB storage state for that run. Check save format, content identity, checksum, and the expected resumed projection. Fail clearly on a mismatch.
- Use a paused, unlocked Scout in range for a real select, lock, fire, and stop sequence, and include that command witness in feature smoke. Use a separately prepared active-fight state for the first combat accessibility audit. Open both through the real campaign UI and worker.

**Exit** The pilot passes in Chromium and Firefox, with repeatable initial state and context isolation. A broken lock command and missing accessible combat status each fail the intended case in an isolated checkout. Record before/after timings and verify that checkpoint setup is confined to test tooling.

## Phase 4 — Pilot a progression checkpoint

**Depends on** Phase 3.

- Use the shared helper for one progression UI slice that starts after Patrol with earned salvage. Perform the sale or fit and a real reopen in the UI. Assert the restored wallet and fit relevant to the chosen action.
- Reuse the headless scenario driver and save service. Keep the full Patrol-to-Base case available while evaluating coverage and timing.

**Exit** The focused case passes in both engines, fails for an incorrect restored fit in an isolated checkout, and has a recorded timing comparison and assertion mapping for Phase 6.

## Phase 5 — Require named acceptance results in the release gate

**Depends on** Phases 0 and 2.

- Extend the [Playwright result reader](../scripts/lib/release.mjs#L205) and [release step](../scripts/release-gate.mjs#L337) to verify required cases by stable identity and expected project. Compare execution with full intended discovery and keep explicit witnesses for required journeys and accessibility variants so narrowing discovery alone cannot yield a green gate.
- Require guided, destroyer, real-clock navigation and suspension, starter/refit, guided first-user, loss and recovery, and full offline evidence in the planned projects. Check the `V02-AC-14` enlarged hangar and comparison, keyboard ship switch, market filters, destination bands and keyboard choice, guided fire with reduced motion, and web states in both engines. Preserve retry reporting and the handling of unavailable optional branded channels.

**Exit** Release-gate unit checks demonstrate that a partial report with some passing tests, an omitted case, and a skipped required witness each fail the gate. A complete result passes. Run a focused gate invocation such as `npm run release:gate -- --only=build,browser-firefox` and verify the result carries the expected source and build identity.

## Phase 6 — Shorten the Patrol-to-Base critical path

**Depends on** Phases 4 and 5.

- Decide the fate of the long [Patrol-to-Base case](../tests/browser/progression.spec.ts#L376) assertion by assertion. Identify retained evidence for reward-funded advancement, multi-opponent and repeat clears, earned equipment, repair and recharge, reopened ship and wallet, wreck persistence, completion count, and destination choice. Use focused saved-state slices for browser-specific assertions whose setup can be skipped. Retain a played segment where earning and spending the same reward is the assertion.
- Keep the dedicated [guided](../tests/browser/guided.spec.ts) and [destroyer](../tests/browser/ladder.spec.ts) journeys and real undock, warp, and dock acceptance. For any fight loop that remains, replace broad catch-and-retry with explicit transient checks and diagnostics for target, weapon state, and last projection.

**Exit** A before/after assertion map justifies every removed step. The changed cases pass in Chromium and Firefox, traceability passes, and the slowest browser case and project wall times are recorded. If coverage requires a slow transition, keep its focused real-clock case and use Phase 6a only if the measured cost warrants it.

### Phase 6a — Pilot manual time stepping if needed

**Depends on** Phase 6 identifying one expensive transition that a checkpoint cannot cover.

Use a test-only entry and the [frame driver](../src/gateway/frameDriver.ts) clock and scheduler seams. Send normal `time.advance` commands sequentially in capped steps. Respect the 50 ms simulation quantum and 250 ms frame cap, and wait for command acknowledgement and the relevant projection. Stop at observable boundaries. Compare the single transition with real-clock behavior and audit the production entry, worker bundle, and public protocol for test controls. Retain real-clock pause, suspension, and representative full journeys.

**Exit** One transition with measured savings and equivalent observable behavior, or a recorded decision to retain its real-clock execution.

## Phase 7 — Migrate Scout command and combat audit setup

**Depends on** Phases 3–5.

Move the remaining Scout command and combat audit setup to shared checkpoints where the test begins in combat. Keep mouse and keyboard actions explicit and preserve the expanded equipment and explanation, context-menu, and focus checks.

**Exit** Scout command and combat audit cases pass in both engines, with the same input and accessibility assertions.

### Phase 7a — Migrate guided and web accessibility setup

**Depends on** Phases 3 and 5.

Apply prepared guided-projectile and active-web states to the corresponding [progression accessibility cases](../tests/accessibility/progression.spec.ts). Preserve visual markers, equivalent text, reduced motion, keyboard use, and attribution. Keep launch and reopen in flight in the dedicated guided journey and timing and expiry in headless tests. Use funded checkpoints where the market purchase or ship switch itself remains under test.

**Exit** The progression accessibility cases pass in both engines and their required witnesses appear in discovery and results.

## Phase 8 — Shorten loss recovery

**Depends on** Phases 3 and 5.

- Keep one browser transition through destruction. Follow it through the loss report, saved shipless reopen, recovery purchase, and a meaningful relaunch. Use prepared wreck or shipless states for isolated looting and accessibility checks where appropriate.
- Keep the completed post-recovery Scout in [headless loss integration](../tests/integration/loss.test.ts). Preserve the full starter/refit and guided first-user journeys. Keep explicit storage manipulation in tests for existing, corrupted, or incompatible saves.

**Exit** The browser loss and accessibility cases pass in both engines, headless recovery still completes a Scout, and the evidence map identifies the owner for each removed step.

## Phase 9 — Shorten branded offline smoke

**Depends on** Phase 5.

- Add a short branded scenario that loads the production bundle, goes offline, changes state, writes a save, and closes and reopens the campaign within the loaded app. Update the Chrome and Edge selection and keep the full offline sortie in both required browser projects.

**Exit** Discovery confirms the full offline case remains in Chromium and Firefox and the short flow is selected for Chrome and Edge. Run installed branded channels and record the timings or channel availability.

## Phase 10 — Consolidate boot checks and browser setup

**Depends on** Phases 5 and 7–9, including 7a.

- Merge successful boot assertions into one startup and combine the duplicate diagnostics panel setup. Give same-origin evidence one owner that observes a document or worker asset request and compares its exact origin. Keep worker-unavailable component coverage.
- In the boot and checkpoint migration specs, use one navigation for ordinary fresh-campaign setup and share repeated seed and confirmation setup when the behavior matches. Wait for an enabled confirmation or visible result before proceeding. Leave setup that intentionally exercises storage in its owning tests.

**Exit** Focused boot and changed browser cases pass in both engines. The same-origin check proves a matching request was observed and discovery and traceability reflect the merged cases.

### Phase 10a — Consolidate station and presentation audits

**Depends on** Phase 5.

Use one standard and enlarged presentation matrix for the shared station surfaces and purchase dialog, with common axe tags. Keep the Sell audit, radio keyboard operation, refusal text, distinct dialog focus and focus return, and doubled-scale layout. Retain expanded combat and context-menu audits.

**Exit** Focused station and presentation tests pass in both engines. An isolated focus-return regression fails its retained owner. Discovery and traceability confirm every retained interaction and presentation variant is still exercised.

## Phase 11 — Make the docking component regression deterministic

**Depends on** Phase 0.

Make the market-after-reopen component test deterministic. Use a prepared docking state and controlled frame or gateway update, then assert that a sell offer becomes available. Preserve the navigation browser test that docks through the shipped worker on a real clock.

**Exit** The focused component case passes using the controlled update and fails when the market refresh after docking is broken.

### Phase 11a — Consolidate duplicate assertions across test layers

**Depends on** Phase 0.

- Consolidate duplicate compile, capability, shortcut, and authored-shape assertions into their existing owners. Retain invalid build-start, virtual-module and supplied-content/transport coverage, UI action submission, a negative damage-key schema case, and independent damage-total or adapter checks. Prefer catalogue label resolution and valid action categories where metadata needs a guard. Group generated catalogue checks only if failures still identify the exact missing keys.
- Keep protocol schema parity, adversarial validation, compatibility and migrations, golden saves, canonical replay hashes, meaningful boundary rows, and balance firing and comparison checks.

**Exit** Focused suites and `npm run traceability` pass. Record the retained owner for each deletion. In an isolated checkout, verify that representative transaction and preview or schema-guard regressions fail the intended retained tests.

## Phase 12 — Isolate and validate balance report inputs

**Depends on** Phase 1.

- Have the gate write sections to a fresh run directory and pass it to [balance report assembly](../scripts/balance-report.mjs). Validate the run and source/content identity and the exact fixture-declared scenario seeds, matrix cells and seeds, and careers and seeds. Reject duplicates, stale inputs, incomplete coverage, and exploratory seed subsets. Keep deterministic assembly and the existing candidate comparison.
- Preserve the standalone `balance` and `balance:record` workflows. Keep performance separate from balance workload.

**Exit** Focused report checks reject stale, duplicate, wrong-identity, and missing measurements. A clean integration and balance gate run produces the expected figures using only that run's sections.

## Phase 13 — Profile headless release work

**Depends on** Phase 12.

- Profile one slow matrix cell and one slow career. Measure simulation advancement, transaction copying and validation, pilot queries, and report serialization. Record the longest case and distinguish it from summed case time.
- Compare prepared `base.lancer` with the long-range career, and the site ladder with the matrix. Reuse a measured sortie only if starting state, fit, site, seed, command policy, and measured outputs match, with a retained witness for each requirement. Preserve economic progression, the no-drop route, loss recovery, consecutive clears and full bounty, and fit comparisons.

**Exit** A profile and a decision for one bounded follow-up, or a measured reason to leave the simulations as they are. Prefer finishing the measurement in this session before changing the driver or parallelism.

### Phase 13a — Apply one measured headless improvement if warranted

**Depends on** Phase 13 identifying a bottleneck with a verifiable change.

Use one session per selected change, such as reducing duplicated work, introducing a faster balance runner, or distributing independent matrix batches. Compare equal workloads and tune worker count before increasing it. For a faster runner, compare checkpoints, event order, resource totals, and report figures for matching seeds and policy. Preserve ordinary protocol execution for replay and at least one complete career. For batching, verify deterministic merge and complete fixture coverage through Phase 12's checks.

**Exit** Identical required evidence and measured wall-time improvement for the same workload, or the previous execution path retained with the result recorded.

## Phase 14 — Run acceptance and publish the timing comparison

**Depends on** all required phases and any selected follow-ups.

1. Run `npm run traceability`. Review each removed assertion against its retained owner, evidence layer, and requirement IDs. Confirm all included requirements retain their required evidence, including played loops and the whole Firefox browser suite under `V02-AC-14`. Check the isolated regression results from the earlier phases.
2. Run `npm run verify:feature` at least three times under the recorded comparison conditions. Report the median overall and smoke wall times against the **2-minute** and **1-minute** targets.
3. Run `npm run release:gate` through completion. Verify the full balance and release reports, all required Playwright results, isolated performance, and the source digest and build fingerprint. Record the elapsed time and compare with the **35-minute** target under equivalent conditions. Record any outstanding human playtest separately.

**Exit** The final handoff includes observed gate status, report paths, comparable timings, and any remaining bottleneck or coverage blocker. A missed timing target stays open as a measured follow-up. Release acceptance requires the complete evidence for the fingerprinted production bundle.
