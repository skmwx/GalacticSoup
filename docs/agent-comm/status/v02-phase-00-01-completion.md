# v0.2 phases 0 and 1: completion record

**Source:** `docs/v02/FeatureImplementationPlan02.md`, phases 0 and 1. **Date:** 2026-11-14. **Next dependency:** phase 2 (expanded turret fits, defence, capacitor and attribute traces).

## Phase 0: rules, compatibility policy, release scaffolding

### What changed
- **Governing documents amended** (plan section 5):
  - Functional Specification:
    - 3.4: switching ships is an autosave trigger;
    - 6.3: per-ship cargo, fit, condition and insurance; local-only switching; inactive-ship fitting and cargo; drafts and previews bound to their ship; a bought hull arrives empty;
    - 8.4: explicit module sizes; slots and hardpoints are separate limits;
    - 8.5: the fitting screen names the ship being fitted;
    - 9.4: launch versus impact; per-weapon magazines;
    - 9.6: the projectile lifecycle;
    - 9.7: passive modifiers, and condition when a maximum changes;
    - 9.9: web rules.
  - Technical Specification: 5.1, 6.2 (sizes, families, operators, NPC loadouts, floor profiles), 8.2-8.3, 9.2, 10.1-10.3, 11.4 (compatibility boundary, declared content transitions), 15.3, 18, 19.
  - Functional 9.10-9.11 and 18-20 were reviewed. They needed no change.
- **Decision record:** `docs/v02/ADR-V02-01-SaveCompatibility.md`.
- **Dependency audit:** `docs/v02/Phase0-DependencyAudit.md`. It covers the active-ship, turret-only, single NPC ammunition, three-destination, category-switch and content-count assumptions, with paths and the phase that removes each.
- **Versions:**
  - engine 0.2.0, protocol 19, save format 11, campaign state 11, content 0.2.0;
  - `package.json` stays 0.1.0 until the phase 7 release metadata.
- **Old-save rejection** (`src/engine/application/saves/load.ts`):
  - formats below 11 fail with the new `earlierRelease` error before checksum, migration or content checks, and the stored bytes are unchanged;
  - `campaign.saves` reports `compatibility`, so the start screen explains a v0.1 save and offers no Resume;
  - starting a new campaign over any saved one now asks for confirmation (`CampaignPanel.tsx`);
  - the in-game reset still asks too.
- **Content-compatibility policy:** the manifest declares `compatibleContentVersions`, and the bundle always includes its own version. A different hash opens only from a declared authored version. Resolvable IDs alone are no longer enough.
- **Content-floor profiles** (`scripts/lib/content/floor.mjs`):
  - the manifest declares `contentFloor`, and the shipped content claims `v0.2-phase-1`;
  - `v0.2-release` enforces 26 modules, 16 or more charges, 10 or more NPC profiles, 4 sites per tier 1-3, 10 or more droppable modules, and everything purchasable;
  - the release gate runs `validate-content.mjs --release`, which refuses any other profile;
  - the MVP "exactly one hull" rule is replaced by the frigate/destroyer/cruiser lineup check.
- **Traceability:**
  - `V02-AC-01` to `V02-AC-15` are in `config/requirements.json`, with a new `planned` scope and `phases`;
  - V02 criteria need integration or browser evidence, like the MVP ones;
  - `FUNC-6.3` is now included; remote transport is still deferred.

### Acceptance IDs
- V02-AC-13, phases 0-1 part: v0.1, future and undeclared-content saves are refused unchanged; resetting and replacing stay explicit; a multi-ship v0.2 save resumes exactly.
- V02-AC-02 is scaffolded only: the release floor exists and correctly refuses the current content.

## Phase 1: multi-hull purchase, storage, fitting and switching

### What changed
- **Content:**
  - destroyer "Bulwark" (48,000 credits, small modules, 4 weapon / 3 system / 3 engineering slots);
  - cruiser "Citadel" (140,000 credits, small and medium modules, 5/4/4 slots);
  - both are listed at Borrell Harbour as restocking listings;
  - every hull now has `hullClass` and `moduleSizes`;
  - the starter frigate gained 2 launcher hardpoints, and its starting fit is unchanged;
  - all statistics and prices are preliminary. Phase 6 tunes them.
- **Engine:**
  - `ship.activate` (`src/engine/application/shipCommands.ts`): docked only, the player's own ship, same station, refused while a fitting draft is open, autosaves, bumps the asset version so open previews go stale;
  - `ships.list` projection (`src/engine/projections/ships.ts`): readiness, condition, insurance, hold use, comparison figures and the switch availability reason;
  - service previews now accept only the player's own ships.
- **Interface:**
  - the station rail's "Ship" surface is now **Ships**: every owned ship, an active marker in words, a bare-hull explanation, Fly and Fit buttons, a comparison table of local ships, then the active ship's full readout;
  - Fitting has a "Ship being fitted" chooser, locked while changes are open, with a notice when the ship is not the one flown;
  - Hangar has a "Hold to load" chooser;
  - a hull purchase says it arrives empty and does not change the active ship;
  - Services name the ship they act on.

### Acceptance IDs
- **V02-AC-01:** existing evidence, now tagged: the starter fit clears Scout, and the campaign reopens without offline progress.
- **V02-AC-03:** buy, switch, fit an inactive ship, transfer cargo, previews bound to their ship, refusals.
- **V02-AC-12:** loss of a purchased hull with a usable stored ship, with only an unflyable stored ship (grant), and with none (shipless purchase); a cruiser lost with a destroyer stored.
- **V02-AC-13:** multi-ship resume.

### Exit gate evidence
`tests/integration/multiHull.test.ts` (15 tests) covers these steps through the real pipeline and the direct transport:

1. buy a hull;
2. switch to it;
3. undock in it and dock again;
4. switch back;
5. close and reopen.

It also checks that a duplicated request does not repeat, that a stale preview after a switch is refused, and that credits and items are conserved. `tests/component/ShipsPanel.test.tsx` (5 tests) covers the Ships, Fitting, Hangar and start-screen surfaces.

## Fixtures re-recorded through their scripts
- `npm run golden:record` re-recorded the golden saves and the replay. They differ only in versions, content identity, the two new hull listings and the hashes that follow from those.
- `npm run contracts:record` re-recorded the contract lock.
- `npm run balance:record` re-recorded the candidate. The only difference was the tuning digest; no scenario outcome changed.
- `tests/fixtures/saves/format-11.json` is the new golden envelope. `format-10.json` stays as the v0.1 rejection fixture.

## Tests changed
- The rail tab rename changed `'Ship'` to `'Ships'` in the component, browser and accessibility specs.
- MVP floor and one-hull assertions were replaced by lineup and profile tests.
- Migration-runner tests lower the boundary explicitly through `LoadContext.oldestSupportedFormatVersion`.

## Verification
Observed in this session:

- `npm run verify` passed, exit 0:
  - typecheck and architecture: 293 files, no violations;
  - content: OK at the `v0.2-phase-1` floor;
  - unit 1424, integration 150, performance 5 and component 148 tests passed;
  - traceability: 168 requirements, 122 included, 122 covered, 11 planned, 35 deferred;
  - the production build succeeded.
- `npm run balance`: 15 scenarios and 4 careers passed. The only difference from the candidate was the tuning digest, which was then recorded.
- Playwright `browser` and `accessibility` in Chromium: 67 of 69 passed on the full run.
  - `station.spec.ts` "prepares a ship end to end" read the wallet before the insurance charge had refreshed. Its resumed wallet was correct, so this was a test race, made more likely by the extra `ships.list` read. The test now waits for the wallet to change.
  - `persistence.spec.ts` "keeps five rolling autosaves" failed on context teardown (`browserContext.close`).
  - Both specs were re-run and passed (7 of 7).
- **Not run:** the Firefox projects, Chrome and Edge smoke runs, and `npm run release:gate`. The release gate's content step now fails by design until the content declares `v0.2-release`, after phase 5.

## Unresolved / notes for the operator
- Hull prices and statistics are preliminary placeholders for phase 6 balance work.
- Repair, resupply and insurance on the Overview act on the active ship. An inactive ship can be serviced by flying it, since switching is free. The engine accepts previews for any local player ship.
- Moving goods between two ships goes through the hangar in two explicit transfers. There is no direct ship-to-ship transfer.
- A React warning, "Maximum update depth exceeded", appeared once in stderr during the parallel full component run, in `CombatScreen.test.tsx` ("reads the market again on docking ..."). The test passed. Running the whole file, alone, on both this tree and an unmodified `HEAD` worktree did not reproduce it in either, so its origin is undetermined.
