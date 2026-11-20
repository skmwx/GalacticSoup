# Phases 2 and 3: Feature verification and a Scout combat checkpoint

This is the handoff for Phases 2 and 3 of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It builds on [Phase 0](phase-0-inventory.md) and [Phase 1](phase-1-integration-split.md).

> **Timing caveat.** During this session, another application was using 85-93% of the CPU. Under that load, `verify:feature` stopped at the unit and component step in all three runs. The cause was component cases exceeding Vitest's 5 s timeout. The same cases also time out on the unchanged sources at HEAD. **The three runs Phase 2 requires as a starting point are therefore still open.** Run them on an idle machine (see [Open items](#open-items)). The before/after browser timings below are fair, because both sides ran under the same load. They are not comparable with the November evidence.

## Phase 2: `npm run verify:feature` and the Chromium smoke

### What changed

- **[scripts/verify-feature.mjs](../../scripts/verify-feature.mjs)** (`npm run verify:feature`) runs these steps in order and stops at the first failure:
  1. Port check.
  2. `tsc --noEmit`, once.
  3. Architecture check.
  4. Content validation.
  5. Vitest `unit` + `component`.
  6. Vitest `integration-fast`.
  7. Traceability.
  8. `vite build`, with no second typecheck.
  9. Playwright `feature-smoke`, with `--retries=0`.

  The script prints a step table and writes `reports/verify-feature.json`, which holds the step durations, node version and port.
- **Managed preview.** Before any step runs, the script probes port 4173 over IPv4 and IPv6. If anything answers, the run fails at once and names the port. During the smoke, Playwright's web server serves the fresh `dist/` with `--strictPort`. `reuseExistingServer` is false when `FEATURE_VERIFY_SERVE_BUILT=1`, so a stale server is never reused.
- **Vitest invocations.** The plan asks to combine the Vitest projects "where practical". The first attempt ran `unit`, `integration-fast` and `component` in one invocation. Component cases then timed out at 5 s, because the CPU-bound property and golden-replay files took the processors. The work is the same either way, so the script now makes two invocations: `FEATURE_VITEST_GROUPS = [['unit','component'], ['integration-fast']]`.
- **[config/testSelections.mjs](../../config/testSelections.mjs)** adds:
  - `FEATURE_VITEST_PROJECTS` and `FEATURE_VITEST_GROUPS`;
  - `FEATURE_SMOKE_PROJECT` (`feature-smoke`);
  - `FEATURE_TAG` (`@feature`);
  - `PREVIEW_PORT` (4173).
- **[playwright.config.ts](../../playwright.config.ts)** adds the `feature-smoke` project. It is Desktop Chrome, `testDir: tests`, matches `browser/**` and `accessibility/**`, and filters with `grep: /@feature/`. The config also adds the `FEATURE_VERIFY_SERVE_BUILT` switch, and reads the port from `PREVIEW_PORT`.
- **Tagged cases.** The 8 Phase 0 cases are tagged with Playwright's `tag` option, so titles, identity and traceability are unchanged:
  - `browser/boot.spec.ts` "reaches the engine…" and "serves the compiled content…"
  - `browser/campaign.spec.ts` "creates, closes and reopens…" and "persists the starting fit…"
  - `browser/station.spec.ts` "prepares a ship end to end…"
  - `accessibility/campaign.spec.ts` "starts and closes a campaign with the keyboard alone"
  - `accessibility/station.spec.ts` "reaches a surface and a purchase with the keyboard alone"
  - `accessibility/shell.spec.ts` "has no automatically detectable violations"

  Phase 3 adds a ninth tagged case: the combat command witness.
- **[package.json](../../package.json)** adds `verify:feature` and `test:smoke`. `verify`, `test` and the other scripts are unchanged. [README.md](../../README.md) lists the new commands.
- **[scripts/test-discovery.mjs](../../scripts/test-discovery.mjs)** lists the `feature-smoke` project and the files across the `verify:feature` Vitest invocations, and adds these checks:
  - the smoke selects only tagged cases;
  - every tagged case is in the smoke exactly once;
  - each smoke case runs exactly once in each release project of its level (`browser` and `browser-firefox`, or `accessibility` and `accessibility-firefox`);
  - the smoke is not a required or branded project;
  - the release gate's `playwright('…')` calls name exactly the four required and two branded projects;
  - `verify:feature` runs every unit, fast-integration and component file once, and no release-only file.

  The Playwright JSON listing gives tags without the leading `@`, so the checks normalise the tag before comparing.

### Evidence

- **Discovery.** `npm run test:discover` exits 0. Playwright cases per project are `browser` 36, `accessibility` 43, `browser-firefox` 36, `accessibility-firefox` 43, `browser-chrome` 17, `browser-edge` 17 and `feature-smoke` 9. Browser rises by one case for the Phase 3 witness. All checks pass, including the six new ones.
- **The smoke alone** (`--project=feature-smoke`, 8 cases before Phase 3, 8 workers, loaded machine): 8 passed in **12.9 s** wall, including preview start. The slowest case was `station.spec.ts:42` at 5.3 s.
- **Occupied port.** A stray HTTP server was started on `localhost:4173`.
  - `npm run verify:feature` failed in 0.0 s with: `port 4173 is already in use. verify:feature serves the build it has just made and will not reuse another server; …`
  - `playwright test --project=feature-smoke` with `FEATURE_VERIFY_SERVE_BUILT=1` failed with: `Error: http://localhost:4173 is already used, make sure that nothing is running on the port/url …`
- **Full runs on the loaded machine.** Three sequential runs from PowerShell on `D:\` each failed at the Vitest `unit+component` step after 61-75 s. Typecheck took 1.3 s, architecture 0.5 s and content 1.0 s. There were 19 component timeouts at 5000 ms across 10 cases in `CombatScreen`, `StationScreen`, `ShipsPanel` and `CampaignPanel`. Running `vitest --project component` alone on the unchanged sources (HEAD, `git stash`) also failed 2 cases by timeout, in 48.9 s. In November the same project took 35.4 s. The failures come from machine load, not from this change. The later steps were each verified on their own:
  - fast integration;
  - build;
  - the smoke, which passed;
  - traceability, which covers 134 of 134 included requirements.

## Phase 3: A browser checkpoint in Scout combat

### What changed

- **[tests/support/checkpoint/scenarios.ts](../../tests/support/checkpoint/scenarios.ts)** is a pure engine module with no Playwright dependency. `prepareCheckpoint(name, content)` creates a campaign with a fixed seed, pilot and wall-clock stamps. It plays a script over `createEngineHost` with protocol requests only, in whole 250 ms steps, then pauses, closes the campaign and keeps the save the engine wrote. The manifest comes from the IndexedDB store's own `planWrite`, with this save alone in the slot. The two checkpoints are:
  - `scout-in-range`: undock, warp to the Pirate Scout site at 10 km, then orbit the scout at 1 km. This stops once the scout is lockable, in lock range and inside the autocannon's optimal range. Nothing is locked and no weapon is running.
  - `scout-fight`: as above, then lock the scout, fire, run the booster and wait for hits both ways.

  `verifyCheckpoint` checks:
  - the save format and the current `SAVE_FORMAT_VERSION`;
  - content version and hash against the content in use;
  - `isSealed` (the checksum);
  - that the manifest names the save alone;
  - a resume in a fresh host from a store holding only that manifest and save, which must answer with exactly the promised facts.

  The facts are: state hash, simulation time, paused, site, opponent, lock range, locks, which target the first weapon is firing at, and booster state. Any difference throws a `CheckpointMismatch` that names it.
- **[tests/support/checkpoint/servedContent.ts](../../tests/support/checkpoint/servedContent.ts)** produces content from the served build, as the plan requires. It fetches `/`, finds the entry script and from it the `engineWorker-*.js` asset. It extracts the inlined bundle object literal that starts `{contentHash:`, using a brace scanner that is aware of strings. It serialises the literal to JSON inside an empty `vm` context and parses it with the shipped `parseContentBundle`, which recomputes the digest and refuses a mismatch. The result is cached per worker process and base URL.
  - It imports `parseBundle.ts` and `repository.ts` by path. The `@adapters/content` index also exports the bundled loader, which imports Vite's virtual module, and Playwright cannot resolve that. This is the one place a test bypasses a package index, and the file explains why. The architecture check covers `src/` only.
- **[tests/support/checkpoint/browser.ts](../../tests/support/checkpoint/browser.ts)** provides:
  - `checkpointFor`: generates the checkpoint once per worker against the served content.
  - `seedCheckpoint`: in the test's own fresh context, routes `/__checkpoint-setup__` to an inert document with no application script and no worker. In that page it creates the database with the IndexedDB store's stores and keys, writes the manifest and snapshot, and reads them back. It refuses an origin that already has a save database, detected by `oldVersion !== 0`, so it never seeds over other state.
  - `openCheckpoint`: loads `/`, waits for "Engine ready" and clicks **Resume campaign**, so the real start screen and worker open the save.
  - `expectCheckpointShown`: checks that the interface shows the promised state in words. The site heading, "Paused", the opponent entry with the expected object id, the lock state, and "Firing at Pirate Scout" or its absence.
- **Command witness.** `browser/combat.spec.ts` has a new case, "combat from a checkpoint > selects, locks, fires at and stops firing on the scout from a saved checkpoint [MVP-AC-03, FUNC-20]", tagged `@feature`. Starting from `scout-in-range`, it:
  - selects the scout;
  - checks Lock target is enabled at once while paused, then locks;
  - resumes the clock and waits for "Locked";
  - checks "Aimed at", fires, and checks "Firing at";
  - ceases fire and checks for "Stopped: Stopped on command."

  It runs in `browser`, `browser-firefox` and `feature-smoke`. The branded projects do not run `combat.spec.ts`.
- **Combat audit.** `accessibility/combat.spec.ts` "passes an automated audit in the middle of a fight" now opens `scout-fight` and checks the shown state before expanding the equipment and running axe. The other three combat audits still fly there. The `beforeEach` became a `freshCampaign` call inside `inAFight`, and titles are unchanged.
- **[tests/integration/checkpoints.test.ts](../../tests/integration/checkpoints.test.ts)** is in the fast selection and takes about 5 s. It checks that:
  - each checkpoint is the same envelope and the same facts on two generations;
  - the in-range checkpoint has no locks and no fire;
  - the fight checkpoint is locked, firing and boosted;
  - `verifyCheckpoint` refuses a foreign content hash, a broken checksum, an older format version and a projection that differs.

### Evidence

**Chromium and Firefox.** Both changed cases passed in `browser`, `browser-firefox`, `accessibility` and `accessibility-firefox`. All four cases of `accessibility/combat.spec.ts` passed in both engines (8 of 8).

**Repeatable initial state and context isolation.** Running a case three times in one worker seeded three fresh contexts, and each passed the "fresh origin" check, so the seed reached each new context. The cached checkpoint was reused, so every repeat started from the same save. The integration test shows that a regenerated checkpoint is byte-identical, compared by checksum.

**Before/after timings.** These were taken on one machine under the same background load. Runs were sequential, with `--workers=1`, `--repeat-each=3` and no retries, against the served production build. The "before" side is HEAD `aaa841e` in an isolated worktree, and the "after" side is the same worktree with these changes. Medians:

| Case | Engine | Before | After |
|---|---|---:|---:|
| Combat audit in the middle of a fight | Chromium | 14.1 s (14.1, 14.2, 14.1) | **4.1 s** (3.9, 4.1, 4.4) |
| Combat audit in the middle of a fight | Firefox | 18.2 s (16.5, 18.2, 18.3) | **5.5 s** (6.8, 5.5, 5.4) |
| Command witness from `scout-in-range` (new) | Chromium | - | **6.3 s** (6.4, 6.3, 6.3) |
| Command witness from `scout-in-range` (new) | Firefox | - | **7.9 s** (7.9, 7.9, 8.2) |

For reference, the November gate recorded 17.4 s and 20.8 s for the audit, with 8 workers. The nearest flown command cases were `combat.spec.ts:298` (mouse) at 35.7 s and 26.9 s, and `:355` (keyboard) at 36.1 s and 27.6 s. Those cases keep their own coverage: orbit, ranges, reload, the context menu and the warp home.

**Isolated regressions.** These ran in a separate worktree, `D:\Playground\gs-phase3-check`, with a rebuild for each.
- **A broken lock command.** The Navigation bar's "Lock target" `onRun` no longer sends `targeting.lock`. The witness failed at `getByText('Locked')`, element not found. The audit case still passed, because its checkpoint locks headlessly, so the failure stayed in the intended case.
- **Missing accessible combat status.** The weapon status line was rendered without its words (colour only). The audit case failed in both Chromium and Firefox at `Weapons … getByText(/^Firing at Pirate Scout/)`, element not found.

**Setup is confined to test tooling.**
- The change touches nothing under `src/`, `vite.config.ts` or `config/` except the test selections.
- The production build after the change has the same asset hashes as the build before it (`engineWorker-BE2OioxZ.js`, `index-CKQhmdzN.js`).
- The built assets contain none of `checkpoint-setup`, `Checkpoint setup` or `seedCheckpoint`.
- The production entry and protocol gained no test controls.

**Other checks.** `tsc --noEmit` passes. `check-architecture` reports 301 files and no violations. Traceability covers 134 of 134.

## Evidence moved between tests

- **The combat audit no longer exercises flying, warping or locking through the interface.** Real undock and warp remain in `browser/space.spec.ts:47` and the long journeys. Locking and firing through the interface now live in the new witness, and in the mouse and keyboard command cases.
- **No assertion was removed.** The audit still expands every equipment entry and explanation and runs the same axe tags. It adds explicit checks that the fight state is shown in words.

## Open items

1. **The Phase 2 starting-point timings are not recorded.** On an idle machine, run `npm run verify:feature` three times from PowerShell in `D:\Playground\GalacticSoup`. Record the median total wall time and the smoke step, which includes preview start, from `reports/verify-feature.json` and the printed table. Also record:
   - the browser versions, from `npx playwright --version` and the gate's probe;
   - 8 workers and 0 retries;
   - that the branded channels are not used.

   If the component timeouts persist on an idle machine, they are a pre-existing component-suite issue. Report them; do not raise the timeouts silently.
2. **Expected target pressure.** The CPU-bound work in `verify:feature` is about 15 s for unit, 35 s for component, 54 s for fast integration and about 15 s for the smoke, measured on an idle machine in November or in Phase 1. That adds up to about 2 minutes before build and typecheck. Phase 14 assesses the 2-minute target.
3. **The isolated worktree is gone.** `D:\Playground\gs-phase3-check` was used for the before-timings and the mutation runs. It was removed after them: its `node_modules` junction was unlinked first, so the main `node_modules` was left untouched.

## Next

- **Phase 4:** pilot a progression checkpoint with the same helper. Add a checkpoint script in `scenarios.ts`, starting after Patrol with earned salvage, plus a matching site heading or a station variant of `expectCheckpointShown`.
- **Phase 5** can now require the witness and audit cases by identity in both engines.
