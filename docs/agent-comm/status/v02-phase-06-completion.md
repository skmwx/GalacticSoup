# v0.2 phase 6: completion record

**Source:** `docs/v02/FeatureImplementationPlan02.md`, phase 6 (measured fitting, hull progression and economy tuning). **Date:** 2026-11-17. **Next dependency:** phase 7 (regression, persistence hardening and release handoff). **Human review (V02-AC-15): pending**; see Q13.

## Outcome in brief

- **Automated evidence: met.** Over ten fixed seeds, every reference fit was flown at all twelve sites. All thirteen comparisons declared in advance hold:
  - a same-hull reversal on each hull;
  - both hull steps;
  - the small-target disadvantage of the cruiser;
  - its operating-cost disadvantage.
- **Careers.** Careers from a new campaign buy and fly both upgrades, inside the pacing hypotheses; the route that leaves every module drop behind takes one sortie more. Both purchased hulls are lost in careers and the campaign carries on.
- **What it took.**
  - four tuning changes;
  - one rule change;
  - one engine defect fixed (a wreck expiring under a ship's approach broke a campaign invariant).
- **Still open.** Phase 6's exit gate also needs the human product review. It has not happened: V02-AC-15 stays `planned`.

## What changed

### Balance harness (`tests/support/progression`, `tests/support/balance`)
- **Sortie record (`scenario.ts`, `pilot.ts`).**
  - Rounds now count guided launches as well as turret shots.
  - New: seconds of capacitor starvation (a module waiting for capacitor, or a weapon stopped for want of it) and the lowest capacitor share.
  - New tactic `leaveOnceKilled`: retreat once the named opponents are dead, for selective-kill raids.
  - New option `lootModules: false`: leaves module drops in the wrecks.
- **Death while retreating.** A ship destroyed while aligning to warp after a retreat is now a loss. Before, the harness waited for the station site forever.
- **Failures name the broken rule.** A failed request's error now carries its parameters, so a failure names the rule and path it broke.
- **The fit matrix.**
  - Files: `tests/fixtures/balance/matrix.json`, `tests/support/balance/matrix.ts`, `matrixSuite.ts`, and one file per site in `tests/integration/balance/matrix/`.
  - What it flies: each reference fit at each site over ten fixed seeds. Every seed is a new campaign that buys the complete fit: loaded magazines, reserve rounds and active defences.
  - Command policy:
    - one per fit: arrival distance, movement, propulsion, repair and web;
    - one target priority per site, shared by every fit;
    - one shared retreat rule (hull below 35%).
  - Each cell records:
    - win, retreat, loss or time-out;
    - median fight;
    - damage taken by layer;
    - capacitor starvation;
    - rounds;
    - the repair bill and the bill for rounds;
    - loot sale value;
    - net credits; a loss counts the whole package, less the insurance paid.
  - Claims are declared in the fixture with their metric:
    - `outcome`: at least 90% cleared, and 30 points more than the other fit;
    - `medianFightSeconds` or `repairBurden`: at least 30% lower, with both fits clearing reliably;
    - `runningCost`: lower.
  - `BALANCE_MATRIX_SEEDS=n` runs an exploratory pass and writes no evidence.
- **Careers (`career.ts`).**
  - A fit may be a progression fit, a reference fit, or a career fit authored in `careers.json`.
  - A fit for another hull switches to a stored ship of that hull, or buys one.
  - `reuse` moves the modules the new fit needs off the pilot's other local ships first, as a player would.
  - Quotes include the hull and launcher magazines.
  - `ignoreModuleDrops` gives the conservative income.
  - Scenarios may be progression, ladder, weak-fit or career-authored scenarios, or `<fit>@<site>` with the matrix policy.
- **Report.**
  - `report.ts` renders the new `matrix` and `figures` sections.
  - `scripts/balance-report.mjs` adds:
    - the matrix to its required sections, seeds and headline figures;
    - a "v0.2 fit and hull progression" section: the claims, the reversals, and pacing per career seed against the FeatureSpec02 9 hypotheses.

### Tuning (content JSON)

| Change | Where | Why |
|---|---|---|
| Skirmisher minimum orbit 3 km to 1.5 km | `content/rules/combat.json` | The fast-frigate archetype must "orbit at high angular velocity". At 3 km a scout or cutter reached its band, switched its afterburner off and circled at about 0.14 rad/s, slow enough for tracking-enhanced artillery to hit it like a sniper. A light hull cannot hold 1.5 km at afterburner speed, so it now settles near 3 km with the afterburner lit, at about 0.18 rad/s. That is a deliberate use of the existing band rule, documented in the file's `$comment`. |
| Small blaster damage multiplier 2.0 to 2.4 | `content/catalog/modules/weapons.json` | The blaster-and-web destroyer cleared Armored Hold only 26% faster than artillery, short of the 30% bar. The repairing brawlers are exactly where its sustained damage should tell. |
| Small artillery damage multiplier 2.6 to 2.4 | same | Artillery was the fastest destroyer fit almost everywhere. |
| Small guided launcher cycle 6 s to 5 s | same | The guided frigate was the weakest fit, and was only 26% faster than autocannons at Longshot Picket, the long-range site it should own. |
| Cruiser 140,000 to 110,000; medium railgun 52k to 30k, medium launcher 48k to 28k, medium autocannon 38k to 24k, medium afterburner 28k to 18k, medium booster 27k to 18k, medium repairer 26k to 17k, medium battery 17k to 11k | listings and catalog reference values | The railgun cruiser package cost about 506,000 credits: about 20 developed sorties after the destroyer, and a stall on one seed. It now costs about 347,000 (railguns) or 313,000 (guided). |

**Unchanged and why.** Small modules, the starter and destroyer hulls, bounties, loot tables and stock are unchanged: the measured pacing did not call for them. Medium guided rounds keep their price; that is the cruiser's operating-cost disadvantage.

**Tried and reverted.** Giving the warden a capacitor battery made the MVP Pirate Base unwinnable for the MVP frigate fits: every fight timed out on ammunition. Its loadout is as it was.

### Engine defect fixed
- **The defect.** A wreck that expired while a ship held an approach or orbit order on it left the order aimed at nothing. The next step failed the `navigationConsistency` invariant (`time.advance failed: error.internalError.invariant`), which stalls a campaign.
- **How it was found.** The MVP long-range career looted a wreck as it expired.
- **The fix.** `removeWreck` (`src/engine/simulation/encounter.ts`) now stops any order aimed at the wreck, as ship removal already did (Functional Specification 22.5).
- **Regression test.** `tests/unit/engine/bookmark.test.ts` ("stops a ship that is approaching the wreck when it expires"). It reproduced the invariant failure without the fix and passes with it.

### Documents
- **`docs/v02/FeatureSpec02.md` 9:** measured pacing against the hypotheses, and why the no-drop route's one extra sortie is accepted.
- **`docs/v02/Phase0-DependencyAudit.md`:**
  - the phase 6 note on the Scout, Patrol and Base;
  - no contract change.
- **`docs/agent-comm/release/v02-playtest-route.md`:** the human playtest route for V02-AC-15.
- **`docs/agent-comm/requests/questions-and-answes.md`:** Q13 asks for it.

## Acceptance IDs
- **Now `included`:**
  - V02-AC-04;
  - V02-AC-10 (adds the no-module-drop route);
  - V02-AC-11.
- **Extents updated:**
  - V02-AC-05 (the tuned magnitudes);
  - V02-AC-12 (career-level loss and recovery, selective kills, insurance).
- **V02-AC-15 stays `planned`.** The route is prepared and the human review is pending. Automated results do not substitute for it.

## Exit gate evidence

All from `npm run balance:record` (`reports/balance.md`, sections in `reports/balance/`).

### Declared comparisons (10 seeds each; all hold)

| Claim | Site | Result |
|---|---|---|
| Frigate: autocannons over guided | Knife Fight | 60 s against 124 s (52% faster) |
| Frigate: guided over autocannons | Longshot Picket | 103 s against 153 s (33% faster) |
| Destroyer: blaster-web over artillery | Armored Hold | 59 s against 92 s (36% faster) |
| Destroyer: artillery over blaster-web | Longshot Picket | 40 s against 349 s (89% faster) |
| Cruiser: guided over railguns | Knife Fight | cleared 10/10 against 4/10 |
| Cruiser: railguns over guided | Crossfire | 53 s against 160 s (67% faster) |
| Hull step frigate to destroyer | Armored Hold | best frigate fit 0/10 (4 retreats, 6 losses); blaster destroyer 10/10 |
| Hull step destroyer to cruiser | Pirate Base | railgun cruiser 78 s against 361 s for the blaster destroyer |
| Hull step destroyer to cruiser (repairs) | Pirate Base | cruiser 10/10 unhurt; artillery destroyer clears 7/10 (2 retreats, 1 loss) |
| Small target | Knife Fight | autocannon frigate 10/10, railgun cruiser 4/10 |
| Small target | Range Check | blaster destroyer 10/10, railgun cruiser 1/10 |
| Operating cost | Pirate Scout | frigate 378 credits of rounds and repairs against 6,115 for the guided cruiser |
| Operating cost | Bombardment Line | artillery destroyer 1,472 against 3,864 for the railgun cruiser |

Also from the matrix: the cruiser fields for about 313,000-347,000 credits against 156,000-174,000 for a destroyer and 45,000-63,000 for a frigate.

### Careers (three seeds each; all finish)

| Career | Destroyer package | Cruiser package | Simulated time to the cruiser | Then |
|---|---|---|---|---|
| Hull ladder (ordinary loot) | after 9 sorties | after 22-23 (13-14 further) | 62-72 min | Pirate Base cleared twice in the cruiser |
| No module drops | after 10-11 | after 26 (15-16 further) | 75-80 min | as above, every module bought |
| Destroyer loss | bare hull after 3-4 Patrol clears | - | - | lost at Command Group; stored frigate active, no grant |
| Cruiser loss | after 9 | after 22-23 | - | lost to a brawling mistake; stored destroyer flies on |

- **The first purchases** in both hull-ladder careers:
  - the starting credits buy the second autocannon at once;
  - the reference autocannon frigate follows after 1-2 Pirate Patrol clears.
- **FeatureSpec02 9 hypotheses:**
  - a meaningful purchase within 1-3 sorties: met;
  - the destroyer within 6-10 sorties: met (no-drop route: 10-11);
  - the cruiser within 8-15 further sorties: met (no-drop route: 15-16).
- **Costs and bands.**
  - Running costs (repairs and rounds) were 3-5% of income in the hull careers.
  - The bands sit one or two sorties above the slowest seed, so a pacing regression fails them: Patrol 3, Crossfire 10, Armored Hold 18.
- **The destroyer-loss career.**
  - Insurance paid 14,400 credits.
  - The stripped stored frigate, rebuilt with one autocannon, cleared the Pirate Scout.
  - The pilot bought the intermediate fit back and cleared the Patrol twice, after 7-9 sorties in all.
- **The cruiser-loss career.** Insurance paid 33,000 credits and no cruiser was granted. The stored destroyer took back its damage enhancer and cleared Armored Hold three times, with credits rising every sortie.

### Exploits and dead ends
- **Selective kills** (`selectiveKills.test.ts`). The railgun cruiser flew the Command Group three times per seed, two seeds, once clearing it and once killing only the controller and leaving. Clearing earned 8,953-10,026 credits per simulated minute; raiding earned 3,543-6,164. Every raid met a fresh group and was paid the controller's bounty once.
  - The first version of this check also counted the time spent looting while ignoring what the loot was worth. That biased it against clearing, and it failed. It now compares bounty against time with no looting on either side.
- **Hull economy** (`hullEconomy.test.ts`):
  - each larger hull fields for more than every package below it;
  - each loses more after basic insurance;
  - enhanced insurance net of its premium never buys the hull back.

## Tests changed
- **`tests/unit/engine/encounter.test.ts`.**
  - The opponent's orbit is read from the skirmisher rule instead of a literal 3 km.
  - The propulsion test checks that the scout burns while far outside its band and switches off once inside it. It no longer expects it to settle there: at 1.5 km it cannot.
- **`tests/unit/config/traceability.test.ts`:** V02-AC-04, 10 and 11 are now included.
- **`tests/integration/guidance.test.ts`.** The flight-school test expected the "ready" step to be open after the first Scout sortie. That held only because the fight used to leave 3 of 20 rounds in the magazine. Now the magazine empties on the killing shot and reloads on the way home, so the ship docks ready. The test now expects the step to be completed exactly when the ship came home whole with full magazines, and open otherwise.
- **`tests/browser/guidance.spec.ts`.** Same cause as the guidance integration test. If the ship docks ready, guidance moves past "Get the ship ready"; the spec now runs the services only when that step is shown, as it already did for "Carry spare rounds".
- **`tests/integration/campaignProperties.test.ts`.** The property runs must include a ship loss. Before this phase that rested on one loss at step 2,895 of 4,000 in the wreck run, and the orbit change removed it; I probed the committed and current content to confirm. A sixth run (golden combat save, pilot 6) loses its ship by step 415 and says why it exists.
- **`tests/unit/content/balanceFixtures.test.ts`.**
  - Careers may use reference and career fits and scenarios.
  - New check: the matrix claims are declared in advance. That means:
    - every reference fit has a policy and every site a priority;
    - at least ten seeds;
    - at least two same-hull reversals;
    - both hull steps;
    - a larger-hull disadvantage.
  - The candidate's seeds include the matrix's.
- **New files:**
  - `tests/integration/balance/matrix/*.test.ts` (12);
  - `careerHullLadder`, `careerNoModuleDrops`, `careerDestroyerLoss`, `careerCruiserLoss`;
  - `hullEconomy`;
  - `selectiveKills`.

## Fixtures re-recorded through their scripts
- **`npm run balance:record`:** the candidate tuning bundle, with the matrix seeds added to its seed list.
- **`npm run golden:record`:**
  - four golden saves changed only by content identity and checksum;
  - the replay, `completed-progression` and `wreck` changed by fight timing and entity ordinals, because the scout and cutters now orbit with their afterburners lit;
  - the same ten checkpoints in the same order; 188 commands against 192.
- **No contract change,** so the contract lock was not re-recorded.

## Verification
All run from PowerShell.

- **`npm run balance:record`:** 25 files, 104 tests passed (841 s); report written, candidate recorded.
- **`npm run verify` passed, exit 0 (963 s):**
  - architecture: 301 files, no violations;
  - content: OK;
  - unit 1483, integration 313, performance 6 and component 151 tests passed;
  - traceability: 168 requirements, 134 included, 134 covered, 1 planned (V02-AC-15), 33 deferred;
  - the production build succeeded.
- **Earlier verify runs** failed on the two NPC-behaviour unit tests, the guidance integration test and the property-run loss coverage described under "Tests changed". Each was diagnosed with a probe (and, for the property runs, against the committed content) before the test was changed.
- **Playwright, Chromium (`browser` project):** `boot.spec.ts`, `guidance.spec.ts` and `ladder.spec.ts` passed. `guidance.spec.ts` first failed for the same reason as the guidance integration test, and passed after the change below.
- **Not run:**
  - the rest of the Chromium suite;
  - the accessibility suites;
  - Firefox;
  - Chrome and Edge smoke;
  - `npm run release:gate`.

  These belong to phase 7.

## Unresolved / notes for the operator
- **V02-AC-15 (human playtest) is pending.** Phase 6's exit gate asks for it; please see Q13 and the route.
- **A frigate clears an advanced site.** The autocannon frigate clears the Bombardment Line 10/10, because small guided rounds lose most of their damage to a small, fast, afterburning hull. That is a legitimate counter, but it lets a frigate earn an advanced bounty (20,500) early. The careers did not use it; a human may find it a shortcut.
- **Each destroyer fit has a cost.** Artillery is the faster destroyer fit at most sites, but unreliable where it is crowded:
  - Screened Battery 6/10;
  - Pirate Base 7/10;
  - Patrol and Command Group 9/10.

  Blaster-web clears every site 10/10, slowly.
- **The guided frigate is weak beyond the entry band:**
  - Patrol 0/10;
  - Armored Hold and every advanced site except the Screened Battery: 0/10;
  - the Screened Battery: 9 of 10 losses.

  Under the binder's web at Range Check it starves its capacitor (about 22 s a sortie on all ten seeds). That is a deliberate weakness, but it is the thinnest of the six fits.
- **No ladder site kills a properly flown destroyer or cruiser** within the 900 s budget; the matrix shows no destroyer or cruiser loss except one artillery destroyer at the Pirate Base. Both loss careers therefore lose their hull to a recorded mistake:
  - a bare destroyer carrying frigate guns, never boosting;
  - a railgun cruiser brawling at 1 km, never boosting.

  Larger hulls are punished by failure to clear and by cost rather than by danger. Phase 7 or the playtest may want more lethal advanced content.
- **Onboarding side effect.** After the orbit change, the first Scout sortie can leave the starter ship whole, with a magazine that reloaded on the way home. The flight school's "Get the ship ready" step then completes on docking, without the player using the repair and resupply services. That is correct by the step's own rule, but the player may never be taught those services on the first loop. Worth watching in the playtest.
- **Net credits per sortie barely depend on the hull at a given site;** bounties dominate. Larger hulls earn by clearing harder sites faster and more reliably, not by earning more at the same one.
- **Runtime.** The balance suite (now inside `npm run verify`'s integration level) takes about 14 minutes; the twelve matrix files run side by side.

## Questions
Q13 (human playtest) is posted. Nothing else is needed.
