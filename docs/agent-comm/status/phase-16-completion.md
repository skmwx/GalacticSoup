# Phase 16 completion note - Full encounter set and progression content

Status: complete. Date: 2026-09-25.

Implements Phase 16 of `docs/MVPImplementationPlan.md`. All scoped content is in place and each
step of progression has been demonstrated:

- the starter fit clears the Pirate Scout;
- a second autocannon, bought from the starting credits, clears the multi-opponent Pirate Patrol;
- the patrol's bounties pay for the upgrades that clear the Pirate Base;
- a railgun fit clears the Pirate Base as well, so the catalog supports a second approach.

Every site stays open throughout. The demonstrations run headlessly over several seeds and repeated
sorties, and once in a real browser at 1x. Content diagnostics explain every one of these outcomes
from the authored numbers.

## Content

All ids are stable, and every change is a value change or an addition.

### Encounters

| Site | Opponents | What it presses the player with | Bounty |
|---|---|---|---|
| Pirate Scout (tier 1) | 1 scout (skirmisher, orbits at 3 km, no reserve rounds) | Selection, locking, weapons, looting. | 3,000 |
| Pirate Patrol (tier 2) | 2 **cutters** (new profile: skirmishers with two autocannons, an afterburner and phased rounds) and 1 marksman (sniper, holds about 13 km) | Target priority and damage type. The cutters are shield-tanked and hit hard up close. The marksman will not close and outpaces an unboosted ship. | 21,000 |
| Pirate Base (tier 3) | 2 gunners (brawlers), 1 warden (brawler with a capacitor-starved armour repairer), 1 marksman | Range management. The gunners outrun an unboosted light hull (0.36 against 0.32 km/s) but not an afterburning one (0.56). The warden repairs itself until its 60-unit capacitor runs out. | 37,000 |

Across the set: a single-opponent site and two multi-opponent sites, and all three movement
behaviours (orbit, keep range, approach).

### Hulls, modules and loadouts

- **Weapons hit harder.** The autocannon damage multiplier is now 1.5 and the railgun's is 1.7, so
  fights last minutes rather than tens of minutes at 1x. Opponents use the same turrets, so their
  pressure scaled with them.
- **Railguns are capacitor-light.** A cycle now costs 1.5 capacitor (it was 4), so a railgun fit
  can still run a booster. Without that change the long-range approach starved and lost almost
  every fight.
- **The raider hull was retuned:**
  - hit points 150/180/120 (they were 420/520/380, which two guns needed minutes to break);
  - capacitor 60 over 300 s, so the warden's repairer runs dry;
  - speed 0.36 km/s.
- **The warden** carries one autocannon, the armour repairer and two platings.
- **Reserve rounds:** cutter 120, marksman 80, gunner 120, warden 120. The scout still carries none.

### Loot and text

- Every loot table can be sold at the harbour, or fitted and loaded. There are two new tables:
  - `loot.pirate.cutter`: alloy, phased rounds, sometimes an afterburner;
  - `loot.pirate.gunner`: alloy, circuitry, sometimes plating.
- The marksman's table now carries circuitry, iron charges and sometimes plating.
- **Encounter and hull text** describes the pressures above.
- **Reward summaries no longer state figures.** The departure panel already shows the authored
  total beside them, and the new validation rule below keeps any figure a summary does state equal
  to that total.

### Economy

The balance pass owns every value; these are the relationships the tests hold today.

- The starting 20,000 buys the intermediate fit (16,774) but not the mastery fit (40,198).
- The starting credits plus one patrol's bounties (41,000) buy the mastery fit before any loot is
  sold.
- The railgun fit (52,997) is a further investment, not a shortcut.

## Representative fits and headless scenarios

`tests/fixtures/scenarios/progression.json` is data: four fits and six scenarios. A fit names only
definitions and quantities. Tactics use only the range and arrival distances the interface offers.

| Fit | What it is |
|---|---|
| `starter` | What a new campaign owns. |
| `intermediate` | Twin autocannons on phased plasma, shield booster. |
| `mastery` | Twin phased autocannons, booster, afterburner, plating, capacitor battery. |
| `lancer` | Twin railguns on iron, booster, plating, battery. |

`tests/support/progression/` holds the harness:

- **`assemble.ts`** puts a fit on a new campaign through the station's own flow: market purchases,
  a fitting draft, resupply, and moving rounds into the hold. A fit that needs something the
  harbour does not sell fails there, so a fit is also proof of market availability. Only the wallet
  is set directly; the cost is reported.
- **`session.ts`** writes that state as a snapshot and resumes it in an engine host. Everything after
  that is protocol requests.
- **`pilot.ts`** is a scripted pilot. Once per simulated second it reads the encounter, site and
  combat projections and issues ordinary commands:
  - picks a target by priority and keeps it until it dies;
  - holds a movement order against it and keeps it locked;
  - keeps every gun on it;
  - runs propulsion and repair as the tactics say.
- **`scenario.ts`** flies whole sorties: select, undock, warp, fight, loot, return, dock, repair,
  resupply. Each sortie returns a record of who died when, hit rates on both sides, damage by
  attacker and layer, repairs, rounds fired, loot and the completion count.

The exit gate is `tests/integration/progression.test.ts` for the first two steps and the tier gap,
plus `progressionMastery.test.ts` for the mastery site; the two files run side by side. Each
scenario uses three seeds and two consecutive sorties per seed:

- **scout / starter**, **patrol / intermediate** (cutters must die before the marksman) and
  **base / mastery** each complete every sortie. Every sortie meets a fresh instance, the station
  counts each completion, and the full bounty is paid.
- **base / lancer** is a band: at least 60% of sorties complete. It is the second approach.
- **patrol / starter** and **base / starter** complete nothing. Tier means something without being
  a gate.
- A cost check holds the economy relationships listed above.

A failing scenario prints every sortie record together with the content diagnosis for the same fit
and encounter (`tests/support/progression/expectations.ts`).

## Content diagnostics

`npm run diagnose:content` (`tests/integration/contentDiagnostics.test.ts`) writes
`reports/content-diagnostics.md` and `.json`.

`tests/support/progression/diagnostics.ts` sets each representative fit against its encounter using
the engine's own functions: the attribute pipeline, the fit summary, the turret formula, the
behaviour selector's preferred range and the NPC fit planner. It reports for each opponent:

- the range it prefers and the range it is fought at;
- the player's hit chance and damage there;
- its own repair on its capacitor;
- time to destroy;
- the damage it applies to the player's shield;
- how long its rounds last.

It then follows the player's hit points second by second in priority order and reports findings with
causes:

| Finding | Severity |
|---|---|
| unreachable, out-repaired | blocking |
| ammunition, overwhelmed | warning |
| outpaced, capacitor | note |

The test requires the diagnosis to agree with the expectations. A must-win scenario may have no
warning; the lancer band may have warnings but nothing blocking. A must-lose scenario must be given a
cause: the starter at the patrol and at the base breaks at about 64 s and 69 s, and runs short of
rounds.

The model ignores the time a brawler spends closing on a ship that holds range, so kiting fits look
more exposed in it than they play. It says so, and the scenarios decide.

## Content validation

Two new tiers of rules.

**Game rules for every pack** (`scripts/lib/content/semantic.mjs`):

- no gap between tier 1 and the highest tier;
- every encounter is reachable from the starting station by warp: same system, at least the warp
  minimum away;
- no two encounters differ only in how many opponents they spawn (Functional Specification 21);
- any credit figure in a reward summary equals the authored total bounty, in every locale;
- every loot item is sold at some station, or can be fitted or loaded by a player-usable hull;
- the starting fit arms an online turret with a charge (starter reachability, Technical
  Specification 6.2).

**MVP content floor for the shipped bundle only** (`scripts/lib/content/floor.mjs`, MVP Scope
4.1-4.2). It applies wherever `content/` is compiled: the development server, the test run,
`validate:content` and the production build. Fixture packs are held to the game's rules alone.

- Exactly one player-usable hull.
- The starting station sells all of the following:
  - turret choices whose optimal ranges differ by at least 2x;
  - ammunition of at least two dominant damage types;
  - ammunition for every turret on sale;
  - an active defence, a passive resistance module, propulsion and capacitor support.
- One repeatable encounter at each of tiers 1, 2 and 3.
- Single- and multiple-opponent pressure.
- At least two range or movement behaviours.

`compileContent(files, { floor })` carries the switch, and `compilePack(files, { floor })` exposes
it to tests.

## Contracts and persistence

Protocol, campaign state and save format are unchanged: protocol 12, save format 9. No authoritative
field was added.

`tests/integration/contentCompatibility.test.ts` saves a campaign in the middle of the patrol, the
point at which it names the most encounter content, and checks both sides of the plan's rule:

- a balance-only edit (the cutter's bounty) opens, reports `contentChanged`, and discloses the
  installed bounty;
- removing the cutter profile is refused by the loader with `error.saveLoad.contentIncompatible`
  and `firstMissing: npc.pirate.cutter`, while the shipped content still opens the same snapshot.

## Browser acceptance

`tests/browser/progression.spec.ts` runs one campaign against the production build at 1x. The
seed's sixteen bytes are fixed as in the other browser tests. Wreck loot is rolled from its own
stream in the order opponents die, and the pilot's priority fixes that order, so the loot is the
same every run. The run:

1. Checks that all three sites are offered from the start.
2. Buys the second autocannon and 240 phased rounds, refits, resupplies and loads the hold.
3. Clears the Pirate Patrol with the controls, cutters first. For each opponent it selects it, orders
   an orbit at 1 km, locks, fires and runs the booster, until the site is cleared.
4. Loots all three wrecks, retreats and docks. The sortie summary reports 21,000 ISK, and the hold
   holds the looted Small Armour Plating.
5. Sells the salvage and iron charges, then buys the afterburner, the capacitor battery and 220 more
   phased rounds.
6. Fits the afterburner, the battery and the looted plating.
7. Clears the Pirate Base: arrives at 30 km, keeps range at 10 km with the afterburner and booster
   running, and engages the gunners, then the warden, then the marksman.
8. Returns, checks the 37,000 ISK summary and "Cleared 1 times", and confirms every site is still
   offered.

## Test changes caused by content

Tests that had hardcoded pre-phase values now read them from content:

- the patrol roster;
- the warden's slot plan;
- volley damage and listed charge damage, which now include the turret multiplier;
- the railgun capacitor cost;
- the loss report's destruction time.

The loss unit test compared recorded hull damage to the hull's hit points to six decimal places. Stored
damage is rounded to a millionth at every hit, so the comparison is now to four, with a comment.

## Results

- `npm run verify` passes:
  - type checking, architecture checks and content validation, including the floor;
  - **1136 unit tests** (was 1123);
  - **97 integration tests** (was 87);
  - **90 component tests**;
  - traceability;
  - the production build.
- The integration suite now takes about 100 s, most of it the mastery-site scenarios. Headless
  sorties run at about 1 s each.
- `npx playwright test` passes all **46** browser and accessibility tests (45 existing, 1 new) in
  about 16 minutes. The new progression test is the long pole, at about 15.7 minutes of 1x play.
- Traceability reports **110 requirement ids**, all covered by tests. New ids this phase:
  `TECH-16` and `FUNC-21`.
- `npm run diagnose:content` writes the diagnostics report. Its estimates match the scenarios, for
  example 336 s estimated against 330-410 s measured for the mastery fit at the base.

## Findings worth retaining

- **Fire does not wait for a reloading gun.** Pressing Fire starts every weapon that can fire now.
  A gun still reloading, typically one that emptied its magazine on the opponent that just died,
  stays idle until Fire is pressed again. The rules allow this (Functional Specification 9.4), and
  the headless pilot never noticed because it re-issues fire every second. The first browser run
  lost the base to it: one gun against the self-repairing warden. The browser pilot now presses Fire
  whenever it is enabled.

  A player will meet the same trap, so Phase 18's explanations or Phase 19's input pass should
  consider either telling the player or queuing the activation behind the reload. This would be a
  player-visible rule change, so it must go through the specifications first.
- **The tactics use only the range presets the interface offers** (0.5, 1, 5, 10, 20 and 30 km).
  Exploration had found 8 km kiting and 14 km sniping slightly better, but a player cannot choose
  them, so they are not used.
- **The pilot keeps its target until it dies** unless a higher-priority opponent becomes lockable.
  Re-picking the nearest equal-priority opponent every second abandoned weapon cycles.

## Handoff to Phase 17

- **Tune the bands.** Measured with the scripted pilot:
  - The intermediate fit can still clear the base 3 fights in 5 by kiting at 10 km without an
    afterburner, because a 0.04 km/s speed gap closes slowly. The naive orbit loses 4 in 5.
  - The mastery fit ends base fights at 66-100% shield. It may be comfortable enough to take a
    little more pressure.
  - The lancer is the weaker approach at about 80% at the base. At the patrol it wins about 60% with
    plasma, and the fast cutters are its counter.
  - Railguns and autocannons are not yet shown to be free of universal dominance; that is a Phase 17
    exit criterion.
- **The economy is now shaped for "one patrol funds the mastery step".**
  - Loot adds about 7,000-9,000 per patrol.
  - Ammunition is a real running cost: a base clear uses 240-300 phased rounds.
  - Repair cost is small because the tank is mostly shield.
- **Headless runs are fast.** About 1 s per sortie; the full progression gate takes about 100 s.
  The harness is the intended base for Phase 17's balance simulations and reports.
- **Recovery balance from Phase 15 still stands.** A first-sortie loss with starting credits leaves
  the pilot shipless until they buy a hull or recover the wreck (Q4).
- **The warden's short capacitor is only a content value.** It makes its repairer a burst, not a
  wall. Nothing in the behaviour selector changed.
- **The browser suite now takes about 16 minutes**, because the progression test plays two long
  fights at 1x. It runs in parallel with the other browser tests, so it sets the suite's wall time.

No new questions for the human operator. Q2-Q4 in `docs/agent-comm/requests/questions-and-answes.md`
remain open and non-blocking.
