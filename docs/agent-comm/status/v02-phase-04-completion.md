# v0.2 phase 4: completion record

**Source:** `docs/v02/FeatureImplementationPlan02.md`, phase 4 (web control and enemy archetypes). **Date:** 2026-11-16. **Next dependency:** phase 5 (twelve-site ladder, useful loot and player disclosure).

## What changed

### The web (speed control)
- **Content.** `module.web.small` ("Stasis Web"), the 26th combat module:
  - system slot, small;
  - 5 capacitor per 5 s cycle, 10 km range;
  - each completed cycle removes 50% of the target's maximum speed for one cycle;
  - sold at Borrell Harbour. All numbers are preliminary; phase 6 tunes them.
- **Definition.** New `web` category (`WebModuleDefinition`): range, `speedReductionFraction`, and optional `effectDurationSeconds` (one cycle when absent). It has its own schema branch. Semantic validation also checks:
  - the web takes a system slot;
  - one application lasts at least one cycle;
  - the reduction is above 0 and below 1.
- **Rules** (`content/rules/combat.json`):
  - `speedReductionFloorFraction` (0.1);
  - the `tackler` role (orbit at 0.6 of the web's range);
  - `npcControlCapacitorReserveFraction` (0.35).
- **Cycle** (`src/engine/simulation/combat.ts`):
  - `module.activate` takes an optional `targetId`. With none, the engine uses the only locked target in reach.
  - Target, lock and range are checked when a cycle starts. If any fails, the cycle spends nothing and the web stops with `targetMissing`, `lockLost` or `outOfRange`.
  - They are checked again at completion. If that check fails, nothing is applied and the capacitor is not refunded.
  - A lock lost mid-cycle stops later cycles; the paid cycle finishes and applies nothing.
  - Re-aiming cancels the running cycle without refund.
  - The web uses the shared capacitor waiting behaviour.
- **Effects** (`src/engine/simulation/speedEffects.ts`, `src/engine/domain/combat/effects.ts`):
  - Each effect is a record in `combat.speedEffects`. It holds:
    - the target;
    - the retained source (ship, slot, module);
    - the factor;
    - the applied and expiry times;
    - its own expiry boundary.
  - The same source refreshes its record rather than adding one. A refresh at the expiry instant wins, because the expiry boundary runs after completions (priority 75 against 30).
  - Different sources multiply.
  - Effects end when the target is destroyed or leaves the site, and when the site unloads.
  - An effect survives its source's destruction or departure, with its attribution, until it expires.
- **Movement.** The attribute pipeline applies effects as undiminished temporary multipliers on `maxSpeedKmPerSecond` (`ShipAttributeInput.speedEffects`). The floor is 10% of the hull's own maximum. Each source is a trace step.
  - `combatantOf` and the navigation controller read the lowered cap, so a slowed ship brakes through its normal braking.
  - Warp alignment is measured against the same lowered cap, so a web never prevents warp.
- **Recorder and loss report.** Each application is aggregated as a `control` combat event. A loss report lists `speedReduced` for a web whose latest application was still holding the ship when it was destroyed.
- **Notification.** `notify.combat.webbed` is a warning with the warning cue, raised once per source per site visit. Refreshes are silent.

### Interface
- **Modules panel:**
  - the web's switch acts on the aimed target ("Activate Stasis Web on Pirate Scout");
  - while it cycles, the status names its target;
  - the folded detail explains the effect in words, including that it never stops warp. It lists each locked target with its range and whether the web reaches it, and shows the calculation.
- **Speed readout:** the ship status panel (own ship) and the selected-object panel (target) list each effect with its source, strength and time left, and the resulting speed limit beside the unaffected one, noting the floor. The calculation is on demand. The player's own panel says how to counter a web.
- **Tactical view:** a short-dash tether and a dashed ring around the slowed ship mark a web. It differs from a lock line by shape as well as colour, and is accent for the player's own web, danger for an incoming one.
- **Combat log:** web entries, and a "Webs" filter.
- **Item comparison:** web range, speed removed and effect duration rows.
- **Market:** the web is filed under "Propulsion and speed control" (renamed from "Propulsion").

### Enemy archetypes and AI
- **Content.** Profiles now state an `archetype`: `fastFrigate`, `artillery`, `brawler`, `missile` or `controller`. Ten profiles cover them, two each:

  | Archetype | Profiles |
  |---|---|
  | Fast frigate | scout, cutter |
  | Artillery | marksman, **gunlayer** (new) |
  | Brawler | warden, **bruiser** (new) |
  | Missile | lancer, **bombard** (new) |
  | Controller | **binder** (new), **snare** (new) |

  The gunner keeps its MVP loadout and names no archetype, so the Pirate Base is unchanged until phase 5 revises it (see the notes below).
- **Validation.** Each archetype is held to its role and its defining modules:
  - a fast frigate is a skirmisher with turret and propulsion;
  - artillery is a sniper with turrets;
  - a brawler has the brawler role, resistance and active repair;
  - a missile ship is a sniper or skirmisher with launchers;
  - a controller is a tackler with a web.

  A tackler must carry a web, and a web must cost no more than the opponent's capacitor can hold.
- **Behaviour selector** (`src/engine/domain/encounter/behavior.ts`):
  - It also reads the opponent's own web range and capacitor share.
  - A tackler orbits inside its web range.
  - Any opponent with a web runs it on a held lock within range.
  - An opponent with a web stops burning propulsion below the capacitor reserve.
  - Opponents without a web behave exactly as before.
- **Adapter.** The adapter asks the same predicate the command handler asks (`operatedModuleRefusal`) before it activates a web.

### Catalog and reference fits
- **Catalog.** 26 modules, all sold.
- **New reference fit:** `fit.destroyer.blaster-web`. It carries:
  - four small blasters;
  - web, afterburner and small armour repairer;
  - battery, plating and hybrid damage enhancer;
  - plasma and iron reserves.
- **Floor profile.** New content-floor profile `v0.2-phase-4`, which the manifest now declares. It adds the complete-catalog checks:
  - exactly 26 modules, every module and charge sold;
  - at least 10 archetype-tagged profiles, at least 2 per archetype;
  - 2 reference fits per hull, with different weapon families;
  - coverage of active shield, active armour, passive shield, web-assisted turret and guided combat.

  The twelve-site ladder and the drop coverage stay release-only.

### Versions, saves and contracts
- **Versions:**
  - protocol 21;
  - save format 13 and campaign state 13.
- **State changes:**
  - combat state gains `speedEffects`;
  - operated modules and their cycles gain `targetId`;
  - the recorder gains `control`;
  - loss records may hold `speedReduced`.
- **Migration.** `MIGRATE_12_TO_13` adds an empty effect list and `null` targets.
- **Fixtures:**
  - `tests/fixtures/saves/format-13.json` is the new golden envelope, recorded with the existing capture inputs;
  - `format-12.json` is now the 12 to 13 before-fixture;
  - a test migrates both `format-11.json` and `format-12.json` into the format-13 state.
- **Rule violations.** New `moduleOutOfRange`.

### Governing documents
- **Technical Specification:**
  - 6.2 validation list: archetype role and modules, and an affordable control module;
  - 10.3: effects as temporary pipeline multipliers with traces, module and cycle targets, start and completion checks, and the recorder's control events.
- **Functional Specification 9.9** needed no further change; phase 0 had already written the web rules.
- **`docs/v02/Phase0-DependencyAudit.md`** records the phase 4 status and versions.

## Acceptance IDs
- **V02-AC-02 is now `included`:** three hulls, all 26 modules executing their effects, the ammunition floor and the complete-catalog checks.
- **V02-AC-07 is now `included`:** player and opponent webs, refresh and expiry, sources and floor, braking, source and target loss, starvation, pause, mid-effect resume, projection, notification and loss report.
- **V02-AC-08 is now `included`:** ten profiles across five archetypes, validated and observed in small encounters.
- **V02-AC-04 stays `planned`:** all six fits are authored, validated and assembled through the pipeline. The measured preference reversals belong to phase 6.
- **V02-AC-13:** mid-effect and mid-cycle resume and the 12 to 13 migration are now covered.
- **FUNC-9.9 is now `included`,** scoped to speed reduction. Warp disruption and the other control effects stay deferred.
- **FUNC-9.10's extent** names the tackler role and the archetypes.

## Exit gate evidence
- **`tests/integration/webControl.test.ts` (15 tests):**
  - cost at start;
  - half speed at completion;
  - no-lock and out-of-range refusals that spend nothing;
  - range lost mid-cycle;
  - lock lost with the applied effect running out its time;
  - same-instant refresh without a lapse over four cycles, with one aggregated record;
  - two sources multiplying (0.25);
  - the 10% floor;
  - braking rather than an instant stop;
  - target destroyed;
  - source destroyed, with the effect keeping its attribution;
  - capacitor starvation;
  - deactivation letting the paid cycle finish;
  - the projection explaining the effect;
  - mid-effect save/reopen matching uninterrupted play by state hash;
  - no change while paused.
- **`tests/integration/npcArchetypes.test.ts` (8 tests).** Each archetype flies against the player in a one-opponent encounter:
  - the cutter burns in and orbits tight;
  - the gunlayer keeps more than 8 km;
  - the warden closes and repairs under fire;
  - the lancer and bombard launch from range;
  - the binder orbits within 10 km and webs the player;
  - the snare pays for its web cycle by cycle.

  Two further tests: a webbed player retreats by warp and leaves the effect behind, and a loss names the web that was holding the ship.
- **`tests/integration/fittingCatalog.test.ts`:**
  - the 26-module catalog is complete and on sale;
  - every module executes an effect (none is a placeholder);
  - six reference fits cover the required approaches;
  - all six, including the destroyer web fit, are bought, committed and undockable.
- **`tests/component/WebControl.test.tsx`:** buy and fit a web, lock the Scout, then in the shipped interface:
  1. aim at the Scout;
  2. switch the web on through the module control;
  3. read "Speed limited to …" and "Your Stasis Web: -50% speed, … s left" on the target with no localization issue.
- **New unit tests:**
  - behaviour: tackler band, web intent, capacitor reserve;
  - notifications: the webbed warning;
  - semantic validation: web slot, duration and fraction; archetype role and modules;
  - content floor: the phase-4 profile;
  - migration: 12 to 13, and the golden 11 and 12 to 13;
  - boundary-kind parity.

## Fixtures re-recorded through their scripts
- `npm run golden:record`. The golden saves and replay changed only by:
  - format 13 and protocol 20 to 21;
  - the empty `speedEffects`;
  - the new web market listing and the content identity and hashes that follow.
- `npm run contracts:record`: lock re-written for the changed schemas.
- `npm run balance:record`: the only difference from the candidate was the tuning digest (`bb4d86d71818` to `70c46f1cdfb4`). No scenario or career outcome changed.

## Tests changed
- **Phase 3 expectations moved to phase 4:**
  - floor profile `v0.2-phase-4`;
  - format 13;
  - two migration steps;
  - FUNC-9.9 included;
  - included V02 IDs.
- **Explicit registries.** The 11 to 12 tests now pass an explicit one-step registry.
- **Structural-change test.** The content-compatibility test that removes the cutter now declares the phase-3 floor for its edited pack, so the structural change, not the roster floor, is what it tests.
- **Fixtures and helpers:**
  - minimal and broken fixture rules gain the new combat rule fields;
  - `tests/support/combat.ts` can fit the player's system slots and give the target a system module.

## Verification
Observed in this session (all run from PowerShell, see the drive-case note in memory):

- `npx tsc --noEmit`: clean.
- `npm run validate:content`: OK at `v0.2-phase-4`. Against `v0.2-release` it reports only the phase 5 items: drops (5 of 10, no medium), the encounter counts per tier, and 4 of 12 encounters.
- Unit, integration and component suites: see the `npm run verify` result below.
- `npm run balance`: 15 scenarios and 4 careers passed; the only difference was the tuning digest, then recorded.
- `npm run traceability`: 168 requirements, 129 included, 129 covered, 6 planned, 33 deferred.
- `npm run verify` passed, exit 0:
  - architecture: 301 files, no violations;
  - content: OK at `v0.2-phase-4`;
  - unit 1473, integration 197, performance 5 and component 150 tests passed;
  - traceability: 129 of 129 included requirements covered;
  - the production build succeeded.
- **Not run:** Playwright browser, accessibility, Firefox, the Chrome and Edge smoke runs, and `npm run release:gate`. The release gate still fails by design until the content declares `v0.2-release` in phase 5.

## Unresolved / notes for the operator
- **The Pirate Gunner is not an archetype.**
  - I first gave it an armour repairer to make it a second tanky brawler. That made the Pirate Base harder: four MVP mastery and progression tests stopped clearing it.
  - Rather than retune the ladder in phase 4, the gunner keeps its MVP loadout and names no archetype. The new Pirate Bruiser (blasters, armour repairer, plating, battery) is the second brawler.
  - Phase 5 revises the Base and can give the gunner an archetype then.
- **New profiles are not placed yet.** The gunlayer, bruiser, bombard, binder and snare fly in no shipped encounter. Phase 5 places them in the twelve-site ladder. Until then they are exercised by the integration tests above, with an edited Scout template.
- **A web stops at an out-of-range cycle start.** It does not wait for range to return. The player switches it on again (the switch explains why it stopped); the opponent adapter re-issues it on its next decision.
- **Web interface not yet exercised in a browser.** The web and the speed readout were checked in the component test, not in Playwright. The browser slice for guided and web combat is part of V02-AC-14, which stays planned until phase 5.
- **Statistics are preliminary.** The web's cost, range and strength, and the new profiles' bounties and loadouts, are placeholders for phase 6.
