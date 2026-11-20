# Phase 4: A progression checkpoint

This is the handoff for Phase 4 of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It builds on the Phase 3 checkpoint helper ([phase-2-3-feature-verification.md](phase-2-3-feature-verification.md)) and the Patrol-to-Base assertion map in [Phase 0](phase-0-inventory.md#5-patrol-to-base-assertion-map). Phase 3 was committed as `3f2d53a`, and this phase is on top of it.

## What changed

- **A third checkpoint, `patrol-salvage`**, is in [tests/support/checkpoint/scenarios.ts](../../tests/support/checkpoint/scenarios.ts). The ship is docked and paused at Borrell Harbour after a cleared Pirate Patrol, with every wreck looted and the salvage and the earned plating in the hold. It reuses the headless scenario driver and the save service:
  1. `campaign.create` with the fixed checkpoint seed, the same 16 bytes as the Patrol-to-Base case.
  2. The `intermediate` fixture fit is bought with the starting credits and fitted over the protocol: the second autocannon, phased plasma in both guns, and 200 reserve rounds. Nothing is set directly, so the wallet is what the purchases left.
  3. `flySortie` flies the `patrol.intermediate` scenario's sortie with `{ loot: true }`, cutters first and orbiting at 1 km, using the same driver as the progression and balance suites.
  4. It pauses, and `campaign.close` writes the save through the host's save service.

  The checkpoint refuses to be made if the sortie does not clear, brings home no salvage, or does not dock.
- **The facts are now a union of site and station facts.** Phase 3's facts became `SiteCheckpointFacts` (`kind: 'site'`). `StationCheckpointFacts` records:
  - the state hash, simulation time and paused state;
  - the station and its name;
  - the wallet and the active ship;
  - every fitted slot (module and charge);
  - the hold's and the hangar's plain stacks, with English names taken from the served content's own localization;
  - the last sortie's outcome.

  `verifyCheckpoint` resumes the save in a fresh host and compares the whole projection, wallet and fit included. `checkpointAt(checkpoint, kind)` narrows a checkpoint to one kind, or fails clearly.
- **The browser helper** ([browser.ts](../../tests/support/checkpoint/browser.ts)) gained a station variant of `expectCheckpointShown`. It checks:
  - the station heading and "Paused";
  - the wallet readout, to the credit;
  - the exact Last sortie status line;
  - every hold line, in order, such as "1 x Small Armour Plating".

  `walletReadout(page)` is exported for tests.
- **The focused case** is in [tests/browser/progression.spec.ts](../../tests/browser/progression.spec.ts): "progression rewards from a checkpoint > sells the patrol salvage, fits the earned plating and finds the wallet and fit after a reopen [MVP-AC-06, TECH-11.4]". It runs in `browser` and `browser-firefox` and is not tagged `@feature`. From `patrol-salvage` it:
  1. sells every salvage stack whole through the sale dialog, and the wallet rises;
  2. fits the earned Small Armour Plating into the first free engineering slot, Engineering 1, and the wallet stays the same;
  3. closes the campaign, reloads the page and resumes;
  4. asserts the wallet to the credit, every fitting slot's `data-module` (the plating in Engineering 1 and the rest as the checkpoint had them), and that no sold item is offered for sale again.
- **The sortie code was moved to its own module** so a Playwright worker can load it. `scenario.ts` imports `assemble.ts`, which imports `tests/support/loss.ts` and through it Vite's virtual content module, which Playwright cannot resolve.
  - `flySortie`, `refit`, `restUntilCharged`, `describeSortie` and the record types moved unchanged into [tests/support/progression/sortie.ts](../../tests/support/progression/sortie.ts). [scenario.ts](../../tests/support/progression/scenario.ts) re-exports them, so no consumer changed.
  - [session.ts](../../tests/support/progression/session.ts) splits `attachSession(host, saves, …)` out of `openSession`. `openSession` behaves as before.
  - [fixtures.ts](../../tests/support/progression/fixtures.ts) imports `progression.json` with `with { type: 'json' }`, which Playwright's ESM loader requires.
  - The Phase 3 scripts use the same session through `attachSession`. Their request prefix and quarter-second steps are unchanged, and their saves still verify.
- **[tests/integration/checkpoints.test.ts](../../tests/integration/checkpoints.test.ts)**, in the fast selection, now covers all three checkpoints:
  - Each one is made twice and must be byte-identical (`patrol-salvage` takes about 2.5 s per generation).
  - `patrol-salvage` is docked with "3 of 3" and 13,000 ISK, has two autocannons fitted, holds salvage and the plating, and has nothing in the engineering slots.
  - A docked checkpoint whose wallet or fit differs from its save is refused.

  The cases that only read a checkpoint share one generation per file. The file takes about 9 s.

## Evidence

**Both engines.** The focused case passes in `browser` and `browser-firefox`. The Phase 3 cases also still pass in both engines after the refactor: the command witness and the combat audit, 4 of 4.

**Timing.** These were measured on 20 November 2026 on the machine described in Phase 0, with about 20% background CPU load. The served build was fresh (`RELEASE_GATE_SERVE_BUILT=1`), with no retries.

| Case | Engine | Workers | Runs | Median |
|---|---|---:|---|---:|
| Rewards from `patrol-salvage` (new) | Chromium | 1 | 4.6, 4.4, 4.4 s | **4.4 s** |
| Rewards from `patrol-salvage` (new) | Firefox | 1 | 8.0, 8.0, 8.2 s | **8.0 s** |
| Patrol-to-Base, whole case | Chromium | 2 | 13.7 min (passed) | - |
| Patrol-to-Base, whole case | Firefox | 2, then 1 | timed out at 30 min in the Pirate Base fight; re-run alone, 13.7 min (passed) | - |
| Patrol-to-Base, November gate | Chromium / Firefox | 8 | 844 s / 858 s | - |

The long case's code did not change in this phase. Its Firefox run beside Chromium timed out in the second fight (`fight` at line 475). The catch-and-retry loop is timing-sensitive, and Phase 6 replaces it. Run alone, the same case passed. The new case is about 190 times faster in Chromium (4.4 s against 13.7 min) and about 100 times faster in Firefox (8.0 s against 13.7 min). This is not a like-for-like comparison: the long case covers much more (see the map below).

The first repetition in each worker includes generating the checkpoint and reading the served content. The long case's equivalent segment cannot be timed on its own, because it is reached only after the first sortie (P5-P10). The new case reaches the same point (the Patrol cleared, looted and docked) without that real-time play.

**Incorrect restored fit, in an isolated checkout.** The worktree `D:\Playground\gs-phase4-check` was at `3f2d53a` plus this phase's changes, and was rebuilt for the mutation. `loadSave` was changed to drop every module fitted in an engineering slot when a save is read. The checkpoint has nothing there, so it still generated and verified. The focused case then failed in both Chromium and Firefox at the restored-fit assertion: `slotRow('Engineering 1')` expected `data-module="module.plating.armor.small"` and received `""`. The worktree was removed afterwards: its `node_modules` junction was unlinked first, so the main `node_modules` was left untouched.

**Setup is confined to test tooling.**
- No file under `src/`, `vite.config.ts` or `config/` changed.
- The production build has the same asset hashes as in Phase 3 (`engineWorker-BE2OioxZ.js`, `index-CKQhmdzN.js`).
- The built assets contain none of `checkpoint-setup`, `Checkpoint setup`, `seedCheckpoint` or `patrol-salvage`.

**Other checks.**
- `tsc --noEmit` passes.
- `check:architecture` reports 301 files and no violations.
- `npm run traceability` covers 134 of 134.
- `npm run test:discover` exits 0, with `browser` and `browser-firefox` at 37 cases each (36 before this phase), the smoke still at 9, and every check passing.
- The fast integration selection passes, 36 files and 202 cases in 54.6 s.
- `balance/selectiveKills.test.ts`, a release-only consumer of the moved `flySortie` and `refit`, passes.

## Assertion map for Phase 6

These are the rows of the [Patrol-to-Base map](phase-0-inventory.md#5-patrol-to-base-assertion-map) that the focused case touches. "Covered" means the case asserts the same observable fact through the interface and the worker. It does not mean the earning was played in the browser.

| # | Patrol-to-Base assertion | Focused case | Notes for Phase 6 |
|---|---|---|---|
| P10 | Last sortie "Pirate Patrol cleared: 3 of 3 … 13,000 ISK"; "1 x Small Armour Plating" | **Covered** by the station shown-check: the exact status line and every hold line, in order | The outcome is earned headlessly, by the same scenario driver as `patrol.intermediate` |
| P11 | Salvage stacks each sold whole | **Covered** for the salvage (`item`) stacks, here Burned Alloy Plate | The looted ammunition (Iron Charge S, Fusion S) is not sold. With this seed's headless kills there is no Charred Circuitry |
| P12 | Patrol rewards buy afterburner, battery, 220 rounds | Not covered | Earning and spending the same reward: keep a played segment, or decide in Phase 6 |
| P13 | Earned plating and bought modules fitted; fit shows afterburner and plating | **Covered** for the earned plating | The afterburner and battery are not bought here |
| P14 | Resupply; repair dialog "recharged to full for free"; capacitor 370 of 370 | Not covered | Owners to verify: `browser/ladder.spec.ts:69` and the headless repair rule |
| P15 | **Reopen 3**: wallet unchanged, afterburner and plating fitted | **Covered** and strengthened: wallet to the credit, every slot's module, sold items gone | The plating, not the afterburner, is the fit relevant to this action |

The checkpoint's state is not the long case's state at P10:
- The headless pilot keeps the booster on below 80% shield; the browser pilot leaves it running.
- The fit carries 200 reserve rounds, where the browser buys 240.
- The wallet after docking is 17,186 ISK.

The loot matches in the facts that matter: the same seed and kill priority yield the plating. The long case stays as it was while Phase 6 decides its fate.

## Open items

- **The Phase 2 starting-point timings** for `verify:feature` are still open (see the Phase 2-3 handoff). This phase did not change the smoke.
- **Tagging.** The new case is not `@feature`. The smoke already has one checkpoint witness, and the plan does not ask for this one there.

## Next

- **Phase 5** can require the focused case by identity in `browser` and `browser-firefox`.
- **Phase 6** can use this map and the measured times to decide P10-P15. A purchase checkpoint, or a played P12 segment from `patrol-salvage`, would cover reward-funded advancement without the first sortie.
