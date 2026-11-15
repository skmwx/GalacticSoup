# v0.2 phases 2 and 3: completion record

**Source:** `docs/v02/FeatureImplementationPlan02.md`, phases 2 and 3. **Date:** 2026-11-15. **Next dependency:** phase 4 (web control and enemy archetypes).

## Phase 2: expanded turret fits, defence, capacitor and attribute traces

### What changed
- **Families and sizes.**
  - Every module states `size` (`small`/`medium`), or, for a non-sized support module, `suitsSizes`. Exactly one is required; weapons must state `size`.
  - Turrets carry `turret.family` (`projectile`/`hybrid`). Charges state `family` and `size` instead of the old `group` string.
  - One rule decides compatibility: `moduleAcceptsCharge` (`src/engine/ports/content/definitions.ts`).
  - Fitting refuses a size the hull does not accept, both when the slot is set and at commit (`sizeNotAccepted`). Fitting candidates leave such modules out.
- **Registered passive operators** (`src/engine/domain/attributes/operators.ts`):
  - operators: `shieldCapacity`, `shieldRechargeTime`, `capacitorRechargeTime`, `signatureRadius`, `projectileDamage`, `hybridDamage`, `turretTracking`, `guidedExplosionRadius`, `guidedExplosionVelocity`;
  - new categories: `shieldExtender`, `shieldRecharger`, `capacitorRecharger` and `weaponUpgrade`, whose whole effect is a list of operators. The registry decides the attribute, arithmetic, stage, sign and allowed categories;
  - semantic validation refuses an operator outside its categories, a category without its primary operator, a repeated operator, and a fractional reduction of 1 or more;
  - `tests/unit/engine/modifierOperators.test.ts` holds the engine registry and the validator copy (`OPERATOR_CATEGORIES`) equal;
  - `resistanceAmplifier` hardens shields with the plating shape.
- **Weapon-scoped multipliers.**
  - These are the `weapon.*` attributes, derived in the common pipeline from a base of 1. They stack, diminish and offline exactly like ship attributes, and show in the ship's derived statistics with traces.
  - One function, `weaponProfile` (`src/engine/domain/combat/weapons.ts`), turns a weapon, a charge and a ship into ranges, tracking, flight and damage. The fitting summary, the tactical view, shots, launches and opponents all read it.
  - A small weapon on a cruiser performs exactly as on a frigate (tested).
- **Content.**
  - 25 of the 26 planned modules: small artillery, small blaster, medium autocannon, medium railgun, medium booster, medium repairer, medium afterburner, medium battery, capacitor recharger, shield extender, shield recharger, shield amplifier and the four weapon upgrades.
  - Medium projectile and hybrid charges.
  - Every module and charge restocks at Borrell Harbour.
  - Localization is complete.
  - All numbers are preliminary; phase 6 tunes them.
- **Reference fits** (`content/balance/reference-fits.json`).
  - This is a new authoring-only kind, `reference.fits`. It is validated with the content but not compiled into the runtime bundle.
  - Turret fits: frigate autocannon, destroyer artillery, cruiser railgun.
  - `checkReferenceFits` checks slots, hardpoints, sizes, power, processing, loaded charges, reserves, hold volume and that everything is sold at the starting station.
- **Projections and interface.**
  - Fitting summary and ship view: guided rows; turret columns show a dash for a launcher.
  - Comparisons gain launcher, amplifier, operator and guided-charge rows.
  - Market suitability now carries:
    - purpose, size, sized or suits;
    - whether the active hull accepts it;
    - a charge's family and size.
  - The market has **Purpose**, **Size** and **Fits the active ship** filters. Clearing them restores every entry.
  - Reserve warnings and resupply are per weapon group, so a mixed turret and launcher fit is handled group by group.
- **Content floor.**
  - New development milestone profile `v0.2-phase-3`; the manifest declares it.
  - It and the release profile check family and size coverage:
    - small and medium weapons of each family;
    - 2/2/2/2/4/4 charges per group;
    - all four damage types for each guided size.
  - The release profile also requires a launcher and a medium module among the drops.

### Acceptance IDs
- **V02-AC-05** is now `included`: families, ammunition, damage type, buffer, resistance, recharge, capacitor and sizes, with traces, stacking and offline behaviour.
- **V02-AC-02** and **V02-AC-04** stay `planned`, with their extents updated: 25 of 26 modules, and five of six fits.

## Phase 3: guided weapons from launch through resume

### What changed
- **Launchers and guided charges.**
  - Small and medium launchers.
  - Eight guided charges: EM, thermal, kinetic and explosive for each size. Each carries flight speed and time, explosion radius and velocity.
  - The ammunition floor of 16 is met.
  - Guided application enhancer.
- **Formula.**
  - `guidedApplication` (`src/engine/domain/combat/formulas.ts`) implements Functional Specification 9.6 exactly, with the result's trace and limiting factor (signature or speed).
  - The 0.1 floor and the 0.1 km/s minimum speed are content rules in `rules.combat`.
- **Projectiles** (`src/engine/simulation/projectiles.ts`).
  - Launch:
    - a launcher cycle ends in a launch: the reserved round is consumed and a projectile is created with every launch parameter fixed;
    - no damage is applied at launch.
  - Flight and contact:
    - projectiles fly each step after ships move;
    - contact schedules a `combat.projectileImpact` boundary at that instant, resolved with the other damage in scheduler order;
    - expiry is a `combat.projectileExpiry` boundary scheduled at launch with a later priority, so contact wins a tie;
    - launch at zero distance is an immediate contact.
  - Damage:
    - on impact, the target's signature and speed at that instant decide the multiplier;
    - damage goes through the shared `applyDamageToShip`, with the retained source attribution.
  - Removal:
    - a projectile is removed without damage or refund when its target is destroyed or leaves;
    - it survives lock loss, launcher deactivation and its source's destruction;
    - unloading the site removes everything still in flight.
  - Source attribution:
    - each projectile owns its own boundaries;
    - its source is a retained entity id;
    - validation checks every projectile against the site, the scheduler and the content.
- **Opponents.**
  - NPC loadouts name ammunition per weapon group (`loadout.ammunition`). Each weapon loads the first charge it accepts, and each group carries its own finite reserve.
  - The AI counts a launcher's reach as its flight distance times `npcGuidedReachFraction` (0.7).
  - New profile `npc.pirate.lancer`, a missile boat on the raider hull. The raider gained two launcher hardpoints.
  - New tier-1 site **Missile Picket** (Signal Spire, FeatureSpec02 8.1), with the lancer and its own loot table, including a small launcher.
  - The destination list orders by tier, then by bounty, so the Scout stays first.
- **Guided reference fits:** frigate guided and cruiser guided.
- **Projections and interface.**
  - Weapon data carries:
    - the weapon kind and family;
    - flight and explosion figures.
  - Per locked target, it also carries:
    - estimated flight and whether the target is within reach;
    - the signature and speed factors, the application and the limiting factor.
  - Combat data lists projectiles in flight.
  - The weapons panel shows guided flight, explosion and application, and a guided explanation. Application is shown as a share of listed damage, never as extra damage per second.
  - The tactical view:
    - draws a dashed guided-reach ring;
    - marks each projectile as a small diamond, hollow for the player's own and filled for an inbound one, so the two differ in shape as well as colour;
    - draws them at the reported position with no tween, so reduced motion does not change what is shown or when it lands.
  - The modules panel explains passive operator modules.
- **Versions and saves.**
  - Protocol 20.
  - Save format 12 and campaign state 12; combat state gains `projectiles`.
  - `MIGRATE_11_TO_12` adds an empty list. The release boundary (formats below 11) is unchanged.
  - `tests/fixtures/saves/format-12.json` is the golden envelope; `format-11.json` is the migration's before-fixture, and a test checks it migrates field for field into `format-12.json`.
- **Traceability.** `FUNC-9.6` is now included.

### Acceptance IDs
- **V02-AC-06** is now `included`: formula boundaries; launch, impact and expiry; tie; lock loss before launch; lock loss after launch; target destroyed in flight; source destroyed; launchers keep their own charges; an opponent launches through the same commands; the Missile Picket's AI lancer; resume mid-flight.
- **V02-AC-13:** mid-flight resume reproduces the uninterrupted state hash, and the 11 to 12 migration is tested.
- **V02-AC-14:** the guided browser slice exists. The criterion stays `planned` until phase 5.

## Exit gate evidence
- `tests/integration/guidedWeapons.test.ts` (11 tests): every lifecycle boundary above, plus the real Missile Picket encounter driven by the AI, and a save/reopen in flight that matches uninterrupted play by state hash.
- `tests/integration/fittingCatalog.test.ts` (10 tests):
  - each of the five reference fits is bought and committed through the real pipeline and is undockable;
  - a medium weapon is refused on the frigate and accepted on the cruiser;
  - fitting candidates leave out sizes the hull does not accept;
  - extender, recharger and tracking traces appear in the ship view;
  - three fit and remove rounds create no capacitor and repair no armour or hull.
- `tests/unit/engine/guidedFormula.test.ts` (8 tests) and `tests/unit/engine/modifierOperators.test.ts` (11 tests): formula examples and boundaries, operator stacking by direction, offline modules, family-only damage, tracking and application, sizes.
- `tests/browser/guided.spec.ts`:
  1. buy a launcher and guided rounds;
  2. fit them beside the autocannon;
  3. fly to the Missile Picket and lock the lancer;
  4. read the guided application, then fire;
  5. see outgoing and inbound projectile marks;
  6. close and reopen in flight;
  7. warp home and dock.
- New semantic tests cover sizes, operators, NPC per-group ammunition and reference fits. A component test covers the market filters.

## Fixtures re-recorded through their scripts
- `npm run golden:record`:
  - the golden saves and replay changed only by format 12, protocol 20, content identity and the new empty `projectiles`;
  - the "completed progression" state now names the three sites the career flies, because the Missile Picket is not part of the golden career.
- `npm run contracts:record`: lock re-written for the new and changed schemas.
- `npm run balance:record`: the only difference from the candidate was the tuning digest. No scenario outcome changed.

## Tests changed
- MVP-shaped expectations moved to v0.2 shapes:
  - per-group NPC ammunition;
  - four destinations;
  - more weapons per charge;
  - the wallet check now covers modules the starter can fit, since medium gear belongs to the cruiser.
- Golden-format references moved from 11 to 12.
- The migration-runner tests pass an explicit empty registry where they test a missing path.

## Verification
Observed in this session:
- `npm run verify` passed, exit 0:
  - architecture: 298 files, no violations;
  - content: OK at `v0.2-phase-3`;
  - unit 1458, integration 171, performance 5 and component 149 tests passed;
  - traceability: 168 requirements, 125 included, 125 covered, 9 planned, 34 deferred;
  - the production build succeeded.
- `npm run balance`: 15 scenarios and 4 careers passed; the only difference was the tuning digest.
- Playwright `tests/browser/guided.spec.ts` in Chromium passed (43 s).
- Full Chromium `browser` and `accessibility` run: 69 of 70 passed.
  - The failure was `progression.spec.ts`, which hit its 30-minute test timeout during the Pirate Patrol fight under the fully parallel run.
  - Run alone on this branch it failed once (the ship was lost at the Pirate Base and the test ran out of time) and then passed (14.2 minutes).
  - The same spec on an unmodified `HEAD` worktree passed once (13.1 minutes).
  - Engine timings on the branch are within about 10% of `HEAD`: quantum median 0.794 ms against 0.725 ms, with request and snapshot timings unchanged. The headless balance outcomes for the same fits did not change.
  - So this is the spec's real-time fight being timing-sensitive, not a deterministic regression. It is still a flaky release check worth hardening.
- **Not run:** the Firefox projects, Chrome and Edge smoke runs, and `npm run release:gate`. The release gate still fails by design until the content declares `v0.2-release`.

## Unresolved / notes for the operator
- **Shield refit nuance.** The governing rule keeps damage as hit points lost, limited to a lowered maximum. So removing a shield extender from a nearly empty shield and refitting it can restore up to the extender's hit points, which a natural regeneration would give anyway. Armour, hull and capacitor cannot be gained this way, and a test checks it. If shields should also be strictly conserved, Functional Specification 9.7 needs a rule change: track excess loss.
- **Preliminary numbers.**
  - The Missile Picket's lancer outranges the starter frigate's autocannon and is faster than it. The site is beatable but slow with the starting fit, and much easier with phased rounds, a railgun or a launcher.
  - Phase 5 revisits the ladder and phase 6 the numbers.
- **Still to come.**
  - The web, the 26th module, and the web-assisted destroyer reference fit arrive in phase 4.
  - Phase 6 measures the fits and tunes them.
- **Not exercised in the browser:** the guided slice stops short of looting the lancer's wreck. Looting is covered by the existing Scout flow.
