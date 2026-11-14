# Galactic Soup v0.2 Feature Specification

## 1. Purpose, sources, and status

**Release:** v0.2, Combat Progression Alpha. **Status:** proposed implementation specification, prepared 2026-11-14.

This release tests whether choosing a fit, earning a larger hull, and applying the right tactics produces satisfying combat progression beyond the completed MVP. The intended loop remains station -> prepare -> travel -> fight or retreat -> collect rewards -> return -> repair, resupply, and improve.

Read this document with:

- [Game Design Brief](../00_GameDesignBrief.md);
- [Functional Specification](../01_FunctionalSpecification.md), especially sections 6-11, 18-20, and 22;
- [Technical Specification](../02_TechnicalSpecification.md), especially sections 6-11 and 15;
- [Current State](../human-input/CurrentState.md);
- [v0.2 feature request](../human-input/Features-v02.md).

The requested source name `human-input/Features-02.md` does not exist; `human-input/Features-v02.md` is the supplied Combat Progression Alpha brief. This specification selects a delivery slice and elaborates that brief. It does not replace the complete-game specifications. Proposed rule clarifications and the explicit early-release save exception must be incorporated into the governing documents during implementation, before dependent behavior ships. Neither main specification is changed by this planning task.

The feature brief leaves quantities and optional mechanics open. This proposal chooses **three player hulls, 26 combat modules in total, three weapon families, five enemy archetypes, and 12 encounters in three difficulty bands**. These are delivery decisions, not claims that the source brief prescribed exact counts. Working names below may change; required roles and coverage must remain. Numerical statistics, prices, probabilities, and balance thresholds belong in human-readable content and test fixtures.

The companion [implementation plan](../v01/FeatureImplementationPlan02.md) deliberately resides in `docs/v01`, as requested, although it implements v0.2.

## 2. Product outcomes and boundaries

The release must demonstrate all of the following:

1. Two affordable fits for the same hull require different movement, range, defense, or capacitor decisions and are both useful.
2. Buying and fitting the second and third hull creates a visible capability increase against fixed encounters that previously felt dangerous.
3. Bigger hulls retain disadvantages against small, fast enemies and in replacement cost; a hull upgrade does not eliminate fitting decisions.
4. Enemies and sites reward preparation, damage selection, target priority, and range control as well as increased damage output.
5. The player can understand these choices and their results through the existing schematic interface.

Keep the MVP's single system, single independent station, local economy, command-driven travel, pause/1x controls, contextual onboarding, autosave/resume, and loss/recovery loop. Expand those surfaces where the new combat content needs it. Encounter difficulty is separate from the system's fixed danger rating. A high-band combat destination in the starter system must carry its own clear warning.

The release does not require additional systems or stations, maps or gates, mining, exploration scanning, planetary extraction, fabrication, skills or experience spending, factions or standings, remote services, ship transport, saved fitting templates, additional time rates, campaign-slot management, manual saves, import/export, or PWA packaging. Reference fits used for verification do not introduce a saved-fit UI.

Electronic control is limited to a targeted speed-reduction module, called a **web** below. Warp disruption, capacitor warfare, signature amplification, targeting interference, support/healer NPCs, reinforcements, environmental hazards, and non-destruction objectives remain deferred. The missile ship and web specialist are included; the broader electronic-warfare system is not a prerequisite.

## 3. Existing implementation and required expansion

Inspection of the current catalog and contracts establishes this baseline; it is not a claim that the full-game specification is already implemented.

| Area | Current baseline | v0.2 requirement |
|---|---|---|
| Player hulls | One starter hull; asset state already stores multiple ships | Three hulls, purchasing, local storage, active-ship switching, and inactive-ship fitting |
| Weapons | Small autocannon and railgun; turret cycles, magazines, reloads | Projectile, hybrid, and guided families; small/medium fitting compatibility; live guided projectiles |
| Other modules | Afterburner, shield booster, armor repairer, armor resistance plating, capacitor battery | Expanded defense, capacitor, propulsion, weapon support, and targeted speed control |
| Enemies | Five profiles using brawler, skirmisher, and sniper behavior | Five distinct archetypes, at least ten authored profiles, mixed-role compositions |
| Loot | Salvage, ammunition, and some module drops already exist | Broader useful drops across the combat catalog and difficulty bands |
| Sites | Pirate Scout, Pirate Patrol, Pirate Base | Twelve total distinct templates, including revised versions of those three |
| Validation | MVP-specific floors include exactly one player hull | Release-appropriate content coverage and progression checks |

Existing physical inventory, market transactions, fitting drafts, damage and capacitor calculations, insurance, recovery restrictions, notifications, and deterministic replay must be extended rather than bypassed.

## 4. Hull progression and ownership — V02-HULL

### 4.1 Three playable hulls

| Working class | Intended role and progression | Required limitations |
|---|---|---|
| Starter frigate | Existing inexpensive entry hull; mobile small-weapon combat; remains capable of the easiest site with the starting fit | Least sustained damage, durability, and fitting capacity |
| Destroyer | First purchased upgrade; more small-weapon capacity and stronger sustained damage; can use turret or guided fits | Larger signature, slower movement/turning, higher fitting and replacement expense than the frigate |
| Cruiser | Second purchased upgrade; medium weapons and substantially stronger defense; can dominate suitable earlier encounters | Slowest and most expensive hull; medium weapons apply poorly to small fast targets without appropriate preparation |

The frigate must support a viable guided fit as well as its existing turret fit. Add launcher capability without invalidating the original starter fit. The destroyer supports small weapons; the cruiser supports small and medium weapons so an anti-frigate fit remains possible. Small weapons on a cruiser retain their own small-weapon performance and consume the usual slots; fitting a larger hull must not silently increase every weapon's damage.

Hull definitions must declare allowed module sizes, slots, hardpoints, fitting resources, cargo, movement, signature, targeting, defenses, and capacitor characteristics. Exact slot counts and bonuses are tuning decisions validated against the reference fits. Hardpoints and available weapon slots are independent limits. No hull may fit a medium module merely because its power budget happens to allow it.

Role identity may be established through base attributes and fitting layout; new executable hull-bonus logic is not required. If numerical hull bonuses are added, they must use the common attribute pipeline and appear in its traces. No unavailable skill or standing requirement may block a v0.2 hull or module.

### 4.2 Purchase, switch, and prepare

- All three hulls are sold at the existing station through the local market/dealer flow. Buying requires a price preview and confirmation under the existing transaction rules.
- A bought hull is an owned ship at that station, with its own cargo, fitting, condition, and insurance. It does not become a stack in cargo and arrives unfitted, with no implicit free modules or ammunition.
- Buying while another active ship exists leaves that ship active. Buying while shipless follows the existing recovery/purchase rule and makes the purchased hull active.
- The station shows all locally owned ships and identifies the active one. Switching is instantaneous and free while docked, accepts only a player-owned ship at the same station, and is rejected in space. A ship with an invalid fit may be selected for repair of its fit, but may not undock.
- Cargo, fitted modules, loaded ammunition, damage, and insurance remain with the old ship. Switching never transfers or clones them. The UI offers explicit local transfers, including cargo belonging to an inactive docked ship, through the authoritative inventory service.
- Any local ship can be inspected and fitted. A pending draft is tied to its ship; switching must explicitly discard or finish that draft so a commit cannot affect the wrong ship.
- Fitting and service previews identify their ship. Switching invalidates previews whose applicability depends on the active ship and refreshes readiness, combat controls, comparison, and departure projections.
- A completed purchase or ship switch requests an autosave after commit. Reopening restores the active ship and every stored ship exactly.

Hull resale and automatic trade-in are outside this release. Existing item sales remain available. Basic/enhanced insurance and last-resort recovery apply to each hull using the governing formulas. Losing a cruiser must not grant another cruiser; an existing usable stored ship must remain available for selection after recovery, and recovery grants must retain zero economic value.

## 5. Fitting and module catalog — V02-FIT

### 5.1 Required catalog

Ship **26 distinct combat module definitions total**, counting the existing seven. Ammunition, hulls, NPC profiles, and cosmetic duplicates do not count. The following roster is the planned catalog; names are working names.

| Group | Definitions | Count | Decision supported |
|---|---|---:|---|
| Projectile turrets | Small autocannon, small artillery, medium autocannon | 3 | Tracking and close-range pressure versus range and volley damage; no weapon capacitor cost |
| Hybrid turrets | Small blaster, small railgun, medium railgun | 3 | Strong close-range or long-range damage with capacitor demand |
| Guided launchers | Small launcher, medium launcher | 2 | Flight delay and target size/speed application instead of turret tracking |
| Active defense | Small/medium shield booster, small/medium armor repairer | 4 | Immediate shield recovery versus armor sustain and capacitor consumption |
| Passive defense | Adaptive armor resistance plating, shield resistance amplifier, shield extender, shield recharge module | 4 | Resistances versus shield buffer versus sustained passive recharge |
| Propulsion/control | Small/medium afterburner, small web | 3 | Speed and capacitor versus a system slot spent reducing an enemy's speed |
| Capacitor | Small/medium battery, capacitor recharge module | 3 | Capacity/endurance versus recovery rate |
| Weapon support | Projectile damage enhancer, hybrid damage enhancer, turret tracking enhancer, guided application enhancer | 4 | More damage versus better application, at the expense of tank/capacitor engineering slots |
| **Total** | | **26** | |

Weapons occupy weapon slots and matching turret/launcher hardpoints. Active defense, propulsion, and the web occupy system slots. Passive defense, capacitor support, and weapon support occupy engineering slots. Non-sized support modules must explicitly list their compatibility rather than rely on an inferred size.

The extender adds shield capacity, the shield recharge module reduces shield recharge time, and capacitor recharge support reduces capacitor recharge time. Damage enhancers affect their named turret family only; tracking support affects turret tracking; guided application support improves explosion radius and/or explosion velocity as described in its item details. Each definition must state the affected attributes and direction of effect. Tuning must leave a viable tradeoff for occupying the slot; item count alone is not evidence of choice.

### 5.2 Shared rules and previews

All modules obey Functional Specification sections 4.4 and 8.3-8.5: slot/hardpoint/size/resource validity, online/offline state, dock-only fitting, flat-before-percentage modifiers, diminishing same-direction fitted modifiers, and calculation traces. New modifiers cannot bypass stacking by choosing a different internal group name. A category must execute its described effect; unsupported categories must fail content validation.

The fitting preview must show the consequences of the selected ammunition and activation assumptions: damage profile and output, useful ranges, turret tracking or guided application parameters, buffer and resistance changes, repair/recharge rate, speed, capacitor consumption/endurance, and fitting limits. Compare against the currently committed fit and expose base values and modifiers on demand. Situational effects such as guided application and a web's target-speed reduction must not be presented as unconditional extra DPS.

Capacity changes must retain the established condition semantics: fitting cannot create damage, free repair, capacitor, ammunition, or saleable inventory through repeated fitting/removal. Recalculate and clamp current values consistently and verify removal of buffer/capacitor modules near their limits.

### 5.3 Viable fitting choices

Maintain at least **two complete, legally obtainable reference fits for each hull**, including compatible loaded and reserve ammunition. At least one pair per hull must differ in weapon family and either tank or range-control approach. Across the six fits, cover active shield, active armor, passive shield, a web-assisted turret fit, and guided combat.

Use these initial fit concepts when establishing hull layouts and balance fixtures. They describe roles, not an automatic loadout grant; exact quantities and legal slot allocations are authored and validated during implementation.

| Hull | Reference fit A | Reference fit B |
|---|---|---|
| Frigate | Small autocannon, afterburner, active armor repair, resistance/capacitor support | Small launcher, afterburner, active shield boost, capacitor/application support |
| Destroyer | Small artillery, afterburner, passive shield buffer/recharge and tracking support | Small blasters, web, active armor repair, capacitor/resistance support |
| Cruiser | Medium railguns, afterburner, active shield boost and capacitor support | Medium launchers, afterburner, passive shield buffer/recharge and application support |

Both fits in each pair must complete appropriate content at that hull's investment band. At least two encounters must favor different fits on the same hull: changing preparation should reverse the relative advantage. A stronger module at a higher price is allowed, but purely numerical upgrades cannot supply all required variety.

## 6. Ammunition, guided combat, and speed control — V02-COMBAT

### 6.1 Ammunition and damage selection

Provide at least **16 ammunition definitions**: two each for small projectile, medium projectile, small hybrid, and medium hybrid weapons; four each for small and medium guided weapons. Artillery/autocannon share compatible size-specific projectile ammunition; blaster/railgun share size-specific hybrid ammunition. Guided ammunition is not compatible with turrets.

Projectile choices must change damage distribution and/or engagement range. Hybrid choices must change range, tracking, or damage sufficiently to affect fitting decisions. Each guided size has electromagnetic, thermal, kinetic, and explosive ammunition, making all four damage types deliberately selectable. No random ammunition quality or hidden damage conversion is introduced.

Compatibility, exact damage vectors, range/tracking changes, volume, magazine capacity, reload time, and cargo reserve must be inspectable before purchase and fitting. Resupply, change-ammunition, automatic reload, empty-hold warnings, and all-weapons controls must work for mixed turret/launcher fits without loading incompatible charges or spending items twice.

### 6.2 Guided weapons

Use Functional Specification sections 9.4, 9.6, and 9.7 unchanged for cycle costs, ammunition reservation, flight, impact application, and layered damage. Guided weapons require a lock to start a cycle. At cycle completion they consume the reserved round and create a projectile; damage is applied on impact, not at launch. They use target signature and current target speed, not turret tracking or angular hit rolls, and do not critically hit in this release.

Clarify these lifecycle boundaries in the governing specifications during implementation:

- Once launched, a projectile does not require a continuing lock and can survive launcher deactivation or source destruction. It carries the resolved launch parameters and source attribution needed for damage and reporting.
- It follows only its original target. If that target is destroyed or leaves the site, the projectile is removed without damage or refund. It does not follow through warp or retarget.
- Expiry before contact causes a miss. A contact and expiry at the same timestamp resolve the already-in-progress contact first, following the common scheduler tie rule.
- Flight, remaining lifetime, source attribution, and launch damage must survive autosave/reopen. No launched round can hit twice or be refunded by loading a save.

Show flight range under stated assumptions, flight time, explosion radius/velocity, and current target application with the limiting factor. Maximum flight distance is guidance; a target moving away can escape before expiry. Tactical projectile marks may be simple SVG shapes and must respect reduced-motion settings without changing impact timing.

### 6.3 Targeted speed reduction

The small web uses a completed lock, finite range, capacitor, and repeating cycles. Its content defines strength, cycle duration, and effect duration. It affects maximum normal speed, not instantaneous position, armor, damage, or turret tracking directly. Movement continues through the common acceleration/braking controller. It does not prevent warp.

Check target, lock, and range at cycle start and application. A failed start spends nothing; a failed application does not refund committed capacitor. Apply on successful cycle completion and refresh the same source/target effect instead of accumulating an unbounded new bonus. Effect duration equals the cycle duration by default, with refresh resolved before expiry at a shared timestamp.

Different sources multiply their temporary speed effects, subject to the functional minimum of 10% of unmodified hull maximum. Temporary hostile effects are not fitted-module stacking bonuses. Stopping, losing the lock, or losing range prevents later applications; an already-applied effect lasts until expiry. Removing the source does not leave an invalid live-entity dependency: retain source attribution for its remaining duration. Clear effects when the target leaves the tactical site or is destroyed.

The effect display identifies source, strength, remaining duration, and current modified speed cap. A player can counter it by range, target priority, defense, or a fit whose damage application tolerates reduced mobility. No hidden permanent slowing is permitted. Active defenses, propulsion, and the web retain the shared capacitor waiting behavior; weapons retain their specified stop reason when a later cycle cannot pay its cost.

## 7. Enemy archetypes and loot — V02-NPC / V02-LOOT

### 7.1 Required behavior coverage

Deliver at least ten NPC profiles across these five archetypes, with at least two profiles per archetype using different loadout, size, or authored tactical pressure. Reuse existing role selectors where appropriate; an archetype does not require a new AI enum if its decisions are already expressible.

| Archetype | Observable behavior | Preparation or tactical answer |
|---|---|---|
| Fast close-range frigate | Closes quickly, orbits at high angular velocity, uses small short-range weapons | Small weapons, tracking, web, damage application, suitable movement |
| Slow artillery ship | Seeks long range and low transverse motion; poor close-range tracking | Close distance, manage transverse motion, force tracking pressure |
| Tanky brawler | Holds close range and uses resistance plus active repair | Appropriate damage type, sustained output, range control, capacitor endurance |
| Missile ship | Maintains useful flight range and launches visible guided volleys | Signature/speed management, resistance selection, target priority; orbit alone does not negate guided damage |
| Web controller | Applies visible short-range speed reduction while allies create damage pressure | Kill controller first or fight outside web range; keep an escape path |

NPCs use legal hulls, fitted modules, ammunition, capacitor, locks, and movement rules shared with the player. Their reserve ammunition is authored; no infinite firing or free repair is permitted. Enemy hulls need not all be player-buyable. Distinct roles must be observable in behavior rather than represented only by names or larger health pools.

AI must consider the effective range of launchers and control modules as well as turrets, and use the modules that establish its archetype. It must not receive hidden bonuses based on the player's ship, wallet, fit, or recent success. Composition and spawn geometry are authored, fixed difficulty choices.

### 7.2 Loot and rewards

Expand the existing loot-table mechanism. Across the twelve sites, at least ten of the combat module definitions must be obtainable as drops, covering weapons, defense, capacitor/weapon support, and propulsion/control. Include at least one launcher and one medium module. Possible drops must suit the site's disclosed reward band; early sites must provide useful entry-level drops rather than only cargo that cannot yet be used.

Bounties are awarded once per destroyed NPC. Loot is rolled once when materialized into a wreck, is physical inventory, and may be taken only within the governing range and cargo limits. Queries, opening a wreck, and save/reopen cannot reroll it. Module drops are ordinary usable items, identical to purchased copies, with no random affixes or quality tiers. Recovery-grant restrictions must never be converted into ordinary drops or sale value.

All ordinary combat modules and required ammunition must also have a dependable local purchase/restock path. Progression may benefit from a lucky drop, but must not require one. The reward preview must derive from the same bounty and loot definitions as the actual result, disclosing possible module categories, probability/quantity information on inspection, and that random loot is not guaranteed. Do not create an additional completion payout unless it is explicitly authored and disclosed.

## 8. Encounter ladder — V02-SITE

### 8.1 Twelve templates in three bands

Use tier labels 1, 2, and 3 for this alpha's three bands; tiers 4 and 5 remain available for later content. The following is the required decision coverage, with working names. Retain the existing Scout, Patrol, and Base identities where practical and revise their balance/compositions to fit the expanded ladder.

| Band / tier | Encounter | Primary decision and pressure |
|---|---|---|
| Entry / 1 | Pirate Scout | Existing starter-capable onboarding and reward loop |
| Entry / 1 | Knife Fight | Fast close-range frigate; small-target application and movement |
| Entry / 1 | Longshot Picket | Isolated artillery threat; closing versus exchanging at range |
| Entry / 1 | Missile Picket | Introductory guided threat; movement and damage resistance |
| Developed / 2 | Pirate Patrol | Mixed opponents; target priority and range management |
| Developed / 2 | Armored Hold | Repairing brawler; damage selection and sustained pressure |
| Developed / 2 | Range Check | Web controller plus close-range damage; range or priority counter |
| Developed / 2 | Crossfire | Separated close/long-range threats; positioning and selective engagement |
| Advanced / 3 | Pirate Base | Revised mastery encounter using several complementary roles |
| Advanced / 3 | Bombardment Line | Multiple missile ships; application-aware defense and priority |
| Advanced / 3 | Screened Battery | Artillery protected by fast frigates; small/medium weapon tradeoffs |
| Advanced / 3 | Command Group | Controller, repairing brawler, and ranged damage; combined preparation and execution |

The entry band is appropriate for the starter hull and first fitting improvements. The developed band tests improved frigate fits and the destroyer. The advanced band tests a well-prepared destroyer or cruiser, with the cruiser providing a clear power advantage in suitable engagements. These are recommendations, not hull gates or promises that every fit in a class wins every site.

Every template must differ in composition, geometry, or decision pattern; changing only health, damage, or count does not satisfy twelve distinct encounters. At least three sites, including Range Check and Screened Battery, must expose a specific inappropriate-fit weakness. The preview must give enough warning to prepare, without prescribing a single compulsory fit.

### 8.2 Discovery, attempt lifecycle, and repetition

All twelve sites are visible through the existing destination/departure flow and selectable from the start. Group or filter by difficulty while retaining all entries. Before warp, show band/tier, principal threats, recommended capabilities, bounty and possible loot, and any arrival restriction. Selection alone never travels or grants rewards.

No hidden level, completed-site prerequisite, wealth check, or player-strength scaling is introduced. Easy sites remain accessible after upgrades; completing the advanced band does not end the campaign.

Objectives remain destruction of the authored hostile group. Preserve the existing repeatable-combat attempt model: each fresh attempt has a unique identity and fresh authored opponents, and completion or abandonment permits a later fresh attempt. State must distinguish returning to an existing wreck from starting a new encounter. Existing player wrecks and unexpired loot must not be overwritten by a site reset. Rewards belong to specific NPC/attempt identities and cannot be paid twice by repeated completion events or resuming.

Warp retreat and station return remain available under the governing movement rules. There is no pursuit, deadline, or warp disruptor in this release. An unfinished attempt may be abandoned; already-earned bounties and physically collected loot remain earned. This deliberate repeatability must be included in economy tests, including selective kills followed by retreat.

## 9. Progression economy and feedback — V02-PROG

Use credits and equipment investment as the v0.2 progression gates. Keep a valid, supplied starting fit and enough initial choice to make preparation meaningful, without supplying either purchased hull immediately.

Balance against complete flyable packages: hull, modules, magazines, reserve ammunition, repairs, and replacement risk. Show hull-only prices clearly; do not present a bare hull as a ready-to-fight upgrade. Maintain repeatable lower-band income so a poor purchase, a bad fit, or a lost larger ship does not stall the campaign.

Initial tuning targets, to be measured and revised with recorded reasons, are:

- a meaningful early fitting purchase within roughly 1-3 successful entry sorties;
- a usable destroyer package within roughly 6-10 profitable entry/developed sorties from a new campaign;
- a usable cruiser package after roughly 8-15 further profitable developed sorties;
- a formerly dangerous fixed encounter becoming reliably easier with the next appropriate hull/fit;
- ammunition and ordinary repair costs leaving positive net income for successful appropriately prepared play, including a conservative no-module-drop route.

These sortie counts are pacing hypotheses, not fixed prices or a mandated grind. Record simulation duration as well as sortie count so very long encounters cannot pass on count alone. Human playtesting decides whether the resulting pace is enjoyable.

The station and combat interface must make the new choices understandable: local ship selection/comparison, market filters by purpose/size/compatibility, relevant fitting limits, threat/reward disclosure for twelve destinations, guided application, and web effects. Preserve the reviewed compact weapon/module rows and expandable detail. All frequent actions remain keyboard and mouse operable, with non-color cues, scaling, focus management, reduced motion, and formula explanations.

## 10. Persistence and compatibility — V02-SAVE

The source feature brief explicitly permits old saves to be incompatible. **v0.2 does not require a v0.1-to-v0.2 migration.** This is an early-release delivery exception to the Technical Specification's released-version migration guarantee; record it in that specification and an implementation decision before enabling the compatibility break. Do not silently weaken the complete-game save-integrity requirements.

An old save must be rejected with an understandable compatibility message. Rejection must not partially load it, silently substitute content, delete it, or replace it with a new campaign. Starting over requires the existing explicit reset/overwrite confirmation. A different content hash with resolvable IDs is not sufficient evidence of compatibility.

Current v0.2 saves must resume all included state: all ships and the active selection, ship-specific inventories/fits/condition/insurance, magazines and reserved rounds, module/reload cycles, guided projectiles, active speed effects, NPC decisions, site attempts, bounties, materialized loot, player wrecks, random streams, and scheduled events. No offline progress, repeated damage, repeated rewards, rerolled loot, or stranded effects are allowed. New versions must be explicit; do not relabel structurally changed data as the old format.

The exception removes the requirement to write old-save migrations. It does not remove schema validation, checksums, transaction safety, autosave recovery, bounded parsing, current-version replay fixtures, or unsupported-future-version rejection. Same-release compatible content changes need an explicit compatibility policy rather than blanket acceptance.

## 11. Acceptance and evidence

Stable IDs below must be carried into the implementation traceability registry and test names/metadata. They supplement, rather than replace, applicable functional and technical requirements.

| ID | Required evidence |
|---|---|
| V02-AC-01 | A fresh campaign completes Scout with the original valid starting fit, returns, and reopens without offline progress. |
| V02-AC-02 | Exactly three player hulls and 26 functional combat modules ship; ammunition meets section 6.1; all definitions pass schema, reference, localization, compatibility, and availability checks. |
| V02-AC-03 | Buying each hull, switching locally, fitting an inactive ship, and explicitly transferring cargo preserve credits/items and ship-specific condition/insurance; invalid or remote/in-space operations are rejected. |
| V02-AC-04 | Six obtainable reference fits establish two viable approaches per hull; at least two same-hull site comparisons reverse which approach is preferable. |
| V02-AC-05 | Turret family, ammunition, damage type, buffer/resistance, repair/recharge, capacitor, and module-size choices produce their described effects and correct traces, including stacking and offline modules. |
| V02-AC-06 | Guided weapons pass exact formula and flight-boundary scenarios, including target escape, expiry, lock loss, source destruction, simultaneous events, and mixed-weapon ammunition/resupply. |
| V02-AC-07 | Player and NPC webs obey lock/range/capacitor, refresh/expiry, source attribution, speed floor, and movement rules; the UI explains current effects and causes. |
| V02-AC-08 | At least ten profiles cover all five archetypes with observable tactics and legal loadouts; their resource and movement rules match player rules. |
| V02-AC-09 | Twelve distinct templates cover the three bands; all disclose threats/rewards and remain freely selectable/repeatable, with at least three fit-sensitive encounters. |
| V02-AC-10 | At least ten modules drop across the ladder; one-time bounty/loot materialization, range/capacity, expiry, provenance, and save/reopen are correct. A no-lucky-drop progression route is viable. |
| V02-AC-11 | Recorded career runs buy and use both upgrades through ordinary play; fixed earlier encounters become materially easier while small-target/expense disadvantages remain observable. |
| V02-AC-12 | Retreat, loss of either purchased hull, stored-ship reuse, shipless purchases, and starter recovery preserve a viable campaign without grant-value exploits. |
| V02-AC-13 | v0.2 saves resume mid-flight/mid-cycle/mid-effect and multi-ship states deterministically; old/future/incompatible saves fail safely and resetting remains explicit. |
| V02-AC-14 | Browser play covers purchase -> switch -> fit -> guided/web combat -> loot -> repair/resupply -> harder site -> save/reopen, including keyboard/mouse accessibility and offline operation. |
| V02-AC-15 | Human playtesting confirms distinct fit decisions and satisfying hull progression, and can explain at least one failure and its counter using in-game information. |

Balance evidence must include a seeded fit-versus-site matrix, a new-campaign career, poor-purchase recovery, and loss/rebuild runs. Use the same site definitions, command policy, and declared activation assumptions when comparing fits. Record victories, retreats/losses, completion time, incoming layer damage, ammunition, capacitor starvation, repair/resupply cost, and net credits.

As an initial measurable definition of material improvement, require either a consistent win/retreat outcome improvement or at least a 30% reduction in median completion time or repair burden over ten fixed seeds for the relevant comparison. Record which metric applies in advance; an unsupplied or intentionally inactive fit is not a valid comparator. Use this threshold as a tuning starting point, with human review of the actual experience. Larger-hull strength must be demonstrated on a fixed previously threatening encounter and its limitations on a small-target or cost comparison.

Release completion requires all automated gates and a recorded human product review. Passing content counts or scripted combat alone does not establish that progression is enjoyable.
