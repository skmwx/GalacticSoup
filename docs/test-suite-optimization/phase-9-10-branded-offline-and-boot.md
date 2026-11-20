# Phases 9 and 10: a short branded offline flow, and consolidated boot and setup

This is the handoff for Phases 9 and 10 of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It follows [Phases 7-8](phase-7-8-scout-commands-and-loss.md). Both phases were done in one session on top of `7a24c8b`.

**Phase 7a is still not done.** Phase 10 lists it as a dependency. This change does not touch the files 7a owns ([accessibility/progression.spec.ts](../../tests/accessibility/progression.spec.ts) and its setup), so 7a can still be done separately.

## Phase 9: the short branded offline flow

**New case.** [tests/browser/offlineSmoke.spec.ts](../../tests/browser/offlineSmoke.spec.ts) has the title "a branded build without a network > loads the production bundle, then starts, buys, saves, closes and resumes a campaign offline" `[MVP-AC-06, TECH-2, TECH-3.1, TECH-3.2]`. The case runs these steps:
1. It loads the production bundle from a clean profile and waits until the worker is ready.
2. It switches the network off.
3. It starts a campaign and buys Small Armour Plating, then waits for "Saved at revision N."
4. It closes and resumes the campaign in the same page. The wallet and the plating in the hangar are both restored.

While the network is off, the case requires that no request is made and no console or page error occurs. The same-origin check for the startup requests belongs to the boot case (see Phase 10), which also runs in the branded projects.

**Selection.** [config/testSelections.mjs](../../config/testSelections.mjs) changes as follows:
- A new `BRANDED_ONLY_SPECS` names the short flow.
- A new `FULL_OFFLINE_SPEC` names the whole sortie.
- `BRANDED_SMOKE_SPECS` now runs the short flow in place of `offline.spec.ts`.

[playwright.config.ts](../../playwright.config.ts) adds `testIgnore` for the branded-only specs to the `browser` and `browser-firefox` projects. The required projects therefore run only the whole offline sortie, which is unchanged and is still the `full-offline` witness.

**Discovery.** [scripts/test-discovery.mjs](../../scripts/test-discovery.mjs) has a new check: "the full offline sortie runs in Chromium and Firefox, the short offline flow in Chrome and Edge only". It passes. The release gate's step titles and its project list did not change. The README and the gate's header comment now describe the short flow.

### Timings

Both sides used the same conditions:
- the same machine and the served production build (`RELEASE_GATE_SERVE_BUILT=1`, `engineWorker-BE2OioxZ.js`);
- 8 workers (the default) and `--retries=0`;
- one project per invocation, as the gate runs them;
- 3 rounds, alternating before and after;
- Playwright 1.65.1 and Node 24.21.0;
- Chrome 157.0.8103.79 and Edge 158.0.4370.33, both installed.

The "before" side is the old spec list (`boot`, `campaign`, `persistence`, `offline`). The "after" side is the same list with `offlineSmoke` in place of `offline`. Every run passed 17 of 17 cases. Each value below is the median of 3 Playwright run durations.

| Project | Before | After | Old full offline case | Short flow |
|---|---:|---:|---:|---:|
| browser-chrome | 145.4 s | **10.1 s** | 139.4 s | 2.8 s |
| browser-edge | 146.7 s | **11.5 s** | 139.9 s | 2.8 s |

The branded steps fall from about 4.9 minutes to about 22 seconds. They are optional, so they are not part of the 35-minute comparable gate, but they do run on this machine. After the change, the slowest branded case is the suspension case, at about 7 s.

## Phase 10: boot checks, same-origin evidence and shared setup

### Boot

[tests/browser/boot.spec.ts](../../tests/browser/boot.spec.ts) is now one case, with one startup and one opening of the diagnostics. Its title is "application boot > boots from its own origin, reaches the engine through the dedicated worker and serves it the content bundle" `[TECH-2, TECH-3.1, TECH-3.2, TECH-4.2, TECH-6.3, FUNC-22.14]`, and it is tagged `@feature`.

| Old case | Its assertions now |
|---|---|
| reaches the engine through the dedicated worker `@feature` | All kept: the h1, "Engine ready over a dedicated worker.", the absolutely positioned status, no tagline, the game menu, "worker" and "N request types" in the build details, and no console errors |
| serves the compiled content bundle to the worker `@feature` | Kept: the content version with its digest, and "N definitions in N kinds", read from the same open diagnostics panel |
| makes no request outside its own origin | **Strengthened.** See "Same-origin evidence" below |
| does not show the compatibility failure on a supported browser | Kept: no `alertdialog` after the engine is ready. The case where the worker is unavailable stays in the component tests ([CompatibilityFailure.test.tsx](../../tests/component/CompatibilityFailure.test.tsx)) |

### Same-origin evidence

The boot case is now the one owner of this evidence. It uses [tests/support/origin.ts](../../tests/support/origin.ts) to record every request the context makes. It then requires:
- exactly one document request, for `${origin}/`;
- at least one request for the `engineWorker-*.js` script, from exactly that origin;
- no request whose `URL.origin` differs.

Before, the check used `startsWith(baseURL)`, which a host such as `localhost:4173.example` would pass, and an empty list of requests would also have passed. Both Chromium and Firefox report the worker script request, so the check observes a matching request in both engines.

Other cases changed as a result:
- **"makes no network request while saving"** in `campaign.spec.ts` no longer repeats the origin filter. It now requires that **no request at all** is made between Save now and the saved revision, which is what its title says.
- **The full offline sortie** keeps its startup check, because its title is "starts from its own files". It now compares exact origins through `originOf`.

### Shared setup in the checkpoint migration specs

[tests/support/freshCampaign.ts](../../tests/support/freshCampaign.ts) provides three helpers:
- `fixSeed(page, seed = JOURNEY_SEED)` fixes the seed. It uses the same bytes as `CHECKPOINT_SEED`.
- `freshCampaign(page, pilot)` uses **one navigation**. The test context is fresh, so the old navigate, delete the database, navigate again sequence was redundant. The helper asserts that there is nothing to resume.
- `confirmDialog(dialog)` waits for pricing to finish and for an **enabled** Confirm, confirms, and waits for the dialog to close.

[browser/combat.spec.ts](../../tests/browser/combat.spec.ts), [browser/loss.spec.ts](../../tests/browser/loss.spec.ts) and [browser/progression.spec.ts](../../tests/browser/progression.spec.ts) now use these helpers. This replaced three copies each of `fixSeed` and `freshCampaign`, and seven confirmation sequences. Two of those sequences in `combat.spec.ts` (the sale and the gun purchase) had not waited for pricing before. The accessibility combat and loss specs open checkpoints only, so they needed no change. Setup that deliberately exercises storage was left in its owning tests: `campaign.spec.ts` `clearSaves`, `persistence.spec.ts`, and the checkpoint seeding page.

## Evidence

- **Both engines.** The changed cases passed:
  - `boot`, `campaign` and `offline`: 20 of 20, in 2.7 min;
  - `combat`, `loss` and `progression` with 6 workers: 18 of 18, in 7.6 min.

  No run used retries.
- **Branded.** The whole branded selection passed 28 of 28 in 19.4 s, in Chrome and Edge.
- **`npm run test:discover`** exits 0 with every check passing. The new branded offline check is included. The case counts changed as follows:
  - `browser` and `browser-firefox`: 36 (was 39; three boot cases merged into the remaining one);
  - `accessibility`: 43, unchanged;
  - `browser-chrome` and `browser-edge`: 14 (was 17);
  - `feature-smoke`: 8 (was 9).

  All 29 witnesses are still found once in each of their projects.
- **`npm run traceability`** covers 134 of 134. Requirements are counted by file, and the merged boot case carries the union of the old ids.
- **Other checks:**
  - `tsc --noEmit` passes.
  - `check:architecture` reports 301 files and no violations.
  - The release-gate unit checks (`tests/unit/config`) pass, 59 cases.
- **No file under `src/` changed.**

## Open items

- **Phase 7a** has not started. It is a declared dependency of Phase 10. Its files were left alone.
- **Other duplicates.** `space.spec.ts`, `station.spec.ts`, `guided.spec.ts`, `ladder.spec.ts`, `guidance.spec.ts`, `offline.spec.ts` and three accessibility specs still have their own copies of `fixSeed` and two-navigation `freshCampaign`. They are not boot or checkpoint migration specs. They can move to `tests/support/freshCampaign.ts` when they are next touched.
- **No branded short flow in the required projects.** The short flow runs only where Chrome or Edge is installed. Its steps are a subset of the whole offline sortie, which the required projects run.

## Next

- Phase 7a, then Phase 10a (station and presentation audits).
- Phase 11 and 11a are independent of this change.
