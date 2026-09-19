# Galactic Soup MVP Scope

## 1. Purpose and authority

This current-state document selects the minimum delivery slice of Galactic Soup. It defines MVP content quantities, included and deferred capabilities, and completion gates so that a phased implementation plan can be produced.

It is subordinate to, and must be read with:

1. `human-input/GameConcept.md`;
2. `00_GameDesignBrief.md`;
3. `01_FunctionalSpecification.md`;
4. `02_TechnicalSpecification.md`.

`human-input/MVP-proposal.md` supplies the desired MVP loop, but it does not replace the game-defining documents. Its example names, prices, and layout are illustrative rather than normative.

This document selects functionality; it does not define alternate rules for that functionality. When a feature is included, the applicable rules, formulas, invariants, interaction requirements, and architecture in the game-defining documents apply unless this document explicitly defers an independently deliverable part of that feature. If a summary here can be read in conflict with a game-defining document, the game-defining document wins and this file must be corrected.

Terms and normative language have the meanings established in `01_FunctionalSpecification.md`. Balance values remain data-defined tuning values, not scope commitments.

## 2. Product question and outcome

The MVP must answer:

> Is it enjoyable to prepare a ship, command it through a tactical encounter, earn rewards, improve the fit, and use that improvement to overcome a harder encounter?

The required playable loop is:

> Station -> choose encounter -> fit and resupply -> enter site -> fight or retreat -> collect loot and bounties -> return to station -> sell, repair, and upgrade -> attempt a harder encounter.

The MVP is a small combat-progression slice, not a demonstration of the complete universe or every career. It must nevertheless use the target architecture and the authoritative rules for the systems it includes; it is not a disposable prototype.

## 3. Selected delivery slice

The following table is the scope boundary. The cited sections are authoritative; the middle column records only the MVP selection or content limit.

| Area | MVP selection | Governing specification |
|---|---|---|
| Campaign | One local campaign can be created, reset, closed, and reopened. Only the portions of the full starting state needed by included systems are supplied. | Functional §§3.1, 3.3-3.4; Technical §11 |
| Simulation time | Pause and 1x play are required. Additional time rates are deferred, but simulation advances only from the authoritative simulation clock and never while closed. | Functional §3.3; Technical §9.1 |
| World | One low-danger system containing one non-hostile independent station site and three authored combat sites. Galaxy travel, gates, and system-map navigation are deferred. | Functional §§5.2-5.3, 9; Technical §§8-10 |
| Station | The station exposes the local hangar, active ship, fitting, local market, repair, resupply, insurance, encounter selection, and undock/return flow needed by the loop. | Functional §§6, 8, 10-11, 19.5 |
| Market | Only local buying and selling of MVP items are exposed. Included listings use the authoritative quote, stock, transaction, and inventory rules. Remote markets, market history UI, routes, and trade progression are deferred. | Functional §§11.1-11.3; Technical §10.4 |
| Ship and fitting | One player-usable starter hull. Included modules use the full slot, hardpoint, power, processing, compatibility, preview, and undock-validity rules. Included items have no skill gate above rank 0. | Functional §§8.2-8.5; Technical §10.2 |
| Movement | Normal-space Approach, Orbit, Keep range, Move to point, and Stop, plus same-system Warp and Dock for entering, retreating from, and returning after encounters. Jump is deferred with gates. | Functional §§7.1-7.4; Technical §§9.3, 10.1 |
| Targeting and combat | Locking, turret combat, range and tracking, relative motion, four damage types, layered defenses, active and passive tanking, capacitor, ammunition, reloads, NPC behavior, retreat, victory, loot, destruction, insurance, and recovery. Guided weapons and electronic or movement-control effects are deferred. | Functional §§9.1-9.5, 9.7-9.8, 9.10-9.12; Technical §§9.2-9.4, 10.3, 10.9 |
| Inventory and rewards | Credits, local station inventory, ship cargo, fitted items, ammunition, bounties, NPC wrecks, loot transfer, sale, and fitting of compatible loot. | Functional §§6.1-6.2, 9.11; Technical §§8.3, 10.3 |
| Interface | A station hub and a two-dimensional schematic combat view, with the applicable explanations, notifications, input, accessibility, and comparison behavior. Maps and screens for deferred systems are absent. | Functional §§19.1-19.3, 19.5-19.7, 20; Technical §12 |
| Onboarding | Contextual guidance and explanations for the complete MVP loop. The full multi-activity guided introduction is deferred. | Functional §§3.2, 19.6-19.7 |

Shared numerical rules and applicable invariants in Functional §§4 and 22 apply throughout. The foundational delivery rules in Technical §18 apply from the first phase.

Choosing a combat site while docked marks it as the current known destination; it does not teleport the ship. The player undocks at the station site, warps to the encounter, and later warps back and docks under Functional §§7.3-7.4. This supplies the authoritative retreat and player-wreck-recovery path without requiring a system map.

## 4. MVP content floor

### 4.1 Player content

The MVP contains exactly one player-usable hull: the starter multi-role light ship. The starting fit must be valid, immediately usable, and capable of completing the easiest encounter without a purchase.

The included catalog must be large enough to produce at least two viable combat approaches rather than one strictly ordered upgrade path. It must provide:

- short-range and longer-range turret choices, whether through weapons, ammunition, or both;
- at least two meaningfully different damage profiles;
- an active defensive option and a passive defense or resistance option;
- a propulsion option;
- a capacitor-support or capacitor-efficiency option;
- the ammunition, repair, and resupply support those choices require.

Catalog entries may have upgraded variants when each variant has a visible benefit and a cost or tradeoff. Exact item names, prices, statistics, and drop rates are tuning data to be set and revised during implementation and playtesting.

### 4.2 Encounters

The station offers these three repeatable authored sites:

| Site | Tier label | Required purpose |
|---|---|---|
| Pirate Scout | Tier 1 / Easy | Teaches selection, locking, movement, weapons, defense, wreck looting, and return to station; the starter fit can complete it. |
| Pirate Patrol | Tier 2 / Medium | Uses multiple opponents and requires target priority plus deliberate range or defensive management. |
| Pirate Base | Tier 3 / Hard | Serves as the mastery encounter and requires a stronger or better-suited fit plus competent command of the included combat systems. |

All three remain visible, and their tier and reward summary are shown before entry. Tier is guidance rather than a hidden gate. Each completion or abandonment permits a later fresh instance so the loop cannot be exhausted.

The sites must differ in composition, roles, initial positioning, or tactical pressure. Across the set, they must exercise single- and multiple-target pressure and at least two distinct NPC range or movement behaviors. Increasing only hit points and damage does not create a distinct encounter.

The displayed reward summary describes the encounter's authored NPC bounties and possible loot; it does not replace the reward timing or ownership rules in Functional §9.11.

### 4.3 Progression and recovery

Starting credits, market values, bounties, repair costs, loot tables, and statistics must be tuned so that:

1. the player can enter the easy site immediately;
2. the initial wallet permits a meaningful choice but not every desired upgrade;
3. success produces a noticeable fitting or resupply decision within a small number of encounters;
4. a suitable upgrade or changed fit materially improves the chance of defeating the next tier;
5. replaying completed sites can recover from poor purchases or losses without prolonged grinding; and
6. defeating the hard site is achievable through the intended loop, not through hidden scaling or an external guide.

Player destruction follows Functional §9.12, including wreck creation, insurance, loss reporting, and the last-resort starter recovery grant. The MVP must not substitute a consequence-free respawn rule. The recovery path and repeatable easy site must prevent an unrecoverable campaign.

## 5. Required MVP interface surfaces

The MVP includes only the following gameplay surfaces:

- the applicable subset of the persistent campaign frame;
- a station hub with encounter selection, local market and hangar, fitting, repair, resupply, and insurance;
- the schematic space view, selected-object and combat information, contextual commands, and notifications;
- the player-destruction loss report and recovery feedback; and
- contextual onboarding for the selected loop.

Functional §§19.1-19.3 and 19.5-20 and Technical §12 govern those surfaces. Their applicable information, explanation, input, notification, audio, comparison, and accessibility requirements are part of the MVP without being restated here. Screens that serve only deferred systems are not required.

## 6. Persistence boundary

The MVP persists every authoritative state needed to resume the included loop, including campaign identity, simulation time, wallet, ship and fitting, damage and capacitor state, inventories, ammunition, insurance, encounter state, instantiated wrecks and loot, rewards, and onboarding progress.

Technical §11 governs the stored representation and save-integrity behavior. The MVP may expose only one campaign slot and automatic save/resume. Multiple slots, player-managed manual saves, rolling save-history UI, and portable import/export are deferred. The applicable rules in Functional §§3.3-3.4 still govern autosave timing, simulation state, and offline progress.

## 7. Technical and quality guardrails

The applicable requirements of `02_TechnicalSpecification.md` govern the MVP. Technical §18 makes its foundational layer boundaries, command authority, identifier strategy, persistence versioning, content validation, and offline architecture mandatory from the first implementation phase. Technical §15 governs verification of the included functionality.

Only schemas, commands, projections, domain state, content, and tests needed by the selected slice must be delivered. Their boundaries must allow later game systems to be added without replacing the MVP architecture, bypassing an authoritative layer, or changing saved identities. A temporary implementation that contradicts the target architecture is not an acceptable MVP shortcut.

The MVP release target is desktop play in current Chromium-based browsers and Firefox using mouse and keyboard. Mobile/touch layouts, installable PWA packaging, and a bundled standalone launcher are not MVP completion requirements.

## 8. Explicitly deferred

The following complete-game capabilities are outside this delivery slice:

- galaxy and system maps, multiple systems or stations, gates, inter-system routes and travel, remote assets, and ship transport;
- additional player hulls and ship lineups;
- mining, refining, exploration, scanning, anomalies outside the three selected combat sites, planetary extraction, fabrication, recipes, and industry;
- skills, experience spending, academies, factions, standings, and faction opportunities;
- regional trade, remote quotes or purchases, market-history UI, trade routes, and trade experience;
- guided weapons, electronic warfare, movement-control effects, support NPCs, environmental hazards, reinforcements, and non-destruction encounter objectives;
- saved fitting templates and remote fitting;
- faster time rates beyond 1x;
- the full guided introduction;
- multiple campaign slots, manual save controls, rolling save-history UI, save export, and save import;
- galaxy-scale content coverage, long-duration simulation for deferred economy and production systems, production packaging, and screens belonging only to deferred systems; and
- multiplayer, PvP, alliances, diplomacy, sovereignty, sector control, three-dimensional graphics, and direct-action piloting, which remain outside the complete game as well.

Deferral means the capability is not required for MVP completion. It does not remove the capability from the complete game or authorize an incompatible substitute.

## 9. MVP completion gates

The MVP is complete only when all of the following are true.

### 9.1 Playable-loop acceptance

1. **MVP-AC-01 — Start and resume:** A new player can create the campaign, recognize the available station actions, close the game, and resume without lost or offline progress.
2. **MVP-AC-02 — Prepare:** The player can inspect market items, cargo, and fitting effects; buy or sell locally; and leave the station only with a valid, supplied fit.
3. **MVP-AC-03 — Command:** The player can use the selected movement, warp, dock, lock, weapon, and defense commands in the 2D view without direct piloting.
4. **MVP-AC-04 — Understand combat:** Range, tracking, relative motion, damage profile, resistances, layered defenses, ammunition, and capacitor visibly affect results and are explained in the interface.
5. **MVP-AC-05 — Face varied pressure:** The player can defeat a multi-opponent site by making meaningful target-priority, range, fitting, and module-use decisions.
6. **MVP-AC-06 — Earn and convert rewards:** Bounties and physical wreck loot obey their authoritative rules and can be carried, sold, resupplied, or fitted to produce a meaningful upgrade decision.
7. **MVP-AC-07 — Progress:** The player can use earned value or a better-suited fit to advance from the starter-capable encounter to the hard encounter.
8. **MVP-AC-08 — Retreat and recover:** Retreat is usable, and destruction applies the specified loss, insurance, wreck, report, and recovery behavior without making the campaign unplayable.
9. **MVP-AC-09 — Continue:** Sites remain repeatable after the hard site is defeated; the campaign has no forced ending.
10. **MVP-AC-10 — Learn in game:** A first-time player can complete the loop without external instructions and can determine the cause of important failures.

### 9.2 Technical acceptance

1. Every included behavior is traceable to the governing functional section, implementing command/query and engine module, content definition, and automated test.
2. The complete loop passes headless engine integration tests and browser-level acceptance tests, including save/reopen and destruction recovery.
3. Formula, inventory, credit, fitting, scheduler, deterministic replay, and save-integrity tests cover the applicable Technical §15 requirements.
4. The production build plays without a gameplay network request and passes content/schema validation.
5. The included UI passes keyboard-only, mouse-only, scale, contrast, reduced-motion, focus, and non-color-cue checks required by the specifications.

### 9.3 Product acceptance

A human playtest must confirm that the end-to-end loop is understandable, repeatable, and enjoyable enough to justify expanding the game. Automated completion alone cannot answer the MVP product question.

## 10. Handoff to the phased implementation plan

The next planning document must:

1. divide this scope into ordered, dependency-aware phases that end in verifiable integration gates;
2. map every phase to the relevant MVP acceptance IDs and authoritative functional and technical sections;
3. name the required production code, content, schemas, migrations, projections, and tests without designing deferred systems;
4. establish the target architectural boundaries in the first phase and keep every later phase inside them;
5. identify when the first runnable vertical slice appears and how each subsequent phase expands it;
6. leave prices, rewards, statistics, and drop rates as data-driven tuning work, with explicit balance and playtest passes; and
7. finish with save/reopen, recovery, accessibility, production-build, and human-playtest gates.

The planner may choose phase boundaries and internal task granularity. It may not omit included requirements, replace authoritative rules with temporary alternatives, or turn deferred complete-game systems into MVP prerequisites merely to prebuild future scope.
