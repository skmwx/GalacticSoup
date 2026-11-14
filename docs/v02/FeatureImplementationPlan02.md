# Galactic Soup v0.2 Phased Implementation Plan

## 1. Purpose and implementation contract

**Release:** v0.2, Combat Progression Alpha. **Status:** proposed plan, prepared 2026-11-14.

This plan implements [FeatureSpec02](../v02/FeatureSpec02.md). Its location in `docs/v01` is intentional, following the requested output path. It does not describe another v0.1 release.

The MVP is reported complete in [CurrentState](../human-input/CurrentState.md). The baseline is the existing layered engine, worker gateway, content pipeline, station/space UI, local persistence, and regression suite. Do not reimplement that foundation or introduce deferred complete-game systems as prerequisites.

The [Functional Specification](../01_FunctionalSpecification.md) and [Technical Specification](../02_TechnicalSpecification.md) remain unchanged by this planning task. Phase 0 below contains the amendments needed during implementation. Content quantities stay in the feature specification and release validation, rather than being copied into the complete-game specifications.

Implement phases in dependency order. Each phase must leave the previous playable loop working and include its own contract/schema, engine, projection/UI, persistence, and relevant verification work. Do not postpone all persistence or UI integration until the end. A completion record must name changed behavior, acceptance IDs, checks run, unresolved findings, and the next dependency; record only observed results.

## 2. Decisions adopted for this plan

| Topic | Delivery decision |
|---|---|
| Catalog | Three player hulls; 26 combat modules; at least 16 ammunition definitions; six reference fits |
| Combat | Projectile/hybrid turrets and guided launchers; small/medium compatibility; targeted speed-reduction web |
| Enemies | Five archetypes, at least ten profiles; no warp disruption or broader electronic warfare |
| Ladder | Twelve freely accessible repeatable encounters in three bands, within the current system |
| Progression | Credits and equipment, with all ordinary combat gear purchasable/restockable; no skill system prerequisite |
| Compatibility | Explicit v0.1 save rejection is allowed; current-v0.2 save integrity remains mandatory |
| UI | Extend the reviewed station/space surfaces; preserve compact equipment rows and expandable explanations |
| Deferred | Other careers, larger universe, saved fits, extra time rates, manual save/import/export UI, hull resale |

These choices resolve the source brief's approximate counts and optional electronic-warfare suggestion. They can be revised with a recorded design/balance reason, updating this plan, the feature specification, and affected acceptance checks together. Do not silently drop a weapon family, hull, counter-fit requirement, or safe-save behavior to meet a date.

## 3. Repository starting points

Verify names and behavior at phase entry; the paths below are current extension points, not instructions to force unrelated code into one file.

| Concern | Existing production/data locations | Verification locations |
|---|---|---|
| Definitions/content compilation | `src/engine/ports/content`, `src/adapters/content`, `content/catalog`, `schemas/content`, `scripts/lib/content` | `tests/unit/content` |
| Inventory and multi-ship state | `src/engine/domain/assets`, `src/engine/application/inventoryCommands.ts`, `src/engine/application/economyCommands.ts` | asset, inventory, economy, recovery unit/integration suites |
| Fitting and attributes | `src/engine/domain/fitting`, `src/engine/domain/attributes`, `src/engine/projections/ship.ts` | fitting/attribute/formula tests |
| Commands and worker contracts | `src/protocol`, `schemas/protocol`, `src/engine/application`, `src/adapters/worker`, `src/gateway` | protocol schema parity and `tests/integration/transportParity.test.ts` |
| Combat and AI | `src/engine/domain/combat`, `src/engine/simulation/combat.ts`, `src/engine/domain/encounter`, `src/engine/simulation/encounter.ts` | combat, NPC behavior, encounter, replay tests |
| Sites, drops, market | `content/encounters`, `content/universe`, `content/economy`, `content/localization/en.json` | shipped content, economy, encounter, balance fixtures |
| Persistence | `src/engine/application/saves`, `src/engine/ports/persistence`, `src/adapters/persistence`, `schemas/save` | save/load, encounter/combat persistence, save-resume, golden fixtures |
| Player surfaces | `src/ui/station`, `src/ui/space`, existing action registry and guidance surfaces | `tests/component`, `tests/browser`, `tests/accessibility` |
| Release evidence | `config/requirements.json`, `scripts/traceability.mjs`, balance/release scripts, `config/release-candidate.json` | traceability/release-gate tests and balance reports |

The current module definition union supports turret, propulsion, repair, resistance, and capacitor categories; guided projectiles and web behavior require real domain/contract expansion. Loot already permits module IDs, and hull purchasing already exists for starter recovery. Extend those mechanisms. The asset map's ability to hold multiple ships does not by itself deliver safe switching or inactive-ship fitting.

`scripts/lib/content/floor.mjs` enforces MVP-only limits, including exactly one player hull. `config/requirements.json` marks several newly included capabilities deferred. Both must be updated for the release. Do not leave a stale MVP validator active or remove validation altogether.

## 4. Phase 0 — Rules, compatibility policy, and release scaffolding

**Depends on:** the completed MVP. **Traceability:** all V02 acceptance IDs, especially AC-02 and AC-13.

### Work

1. Record the v0.2 slice, reference-fit coverage, encounter matrix, and stable `V02-AC-*` IDs in the traceability setup. Preserve the applicable MVP regression coverage while changing superseded quantity assumptions.
2. Make the governing-document amendments in section 5 of this plan. Record the early-release save exception as a decision with its scope and safe-rejection behavior. Do this before implementing behavior that relies on the exception.
3. Inventory current assumptions about the active ship, turret-only weapons, a single NPC ammunition choice, three destinations, module category switches, and content counts. Identify affected protocol/save schemas, command registries, projections, and validators.
4. Specify explicit application/engine/protocol/content/state/save versions for the release as appropriate. Existing baseline versions must be inspected, not copied from this plan. Use an explicit compatibility boundary; bumping the application string alone does not make old saves safe.
5. Implement old-save rejection and the compatibility message without destructive reset. Reject v0.1 data before any migration or content fallback can make it appear compatible. Preserve bounded parsing, current-save checksums, unsupported-future rejection, and the existing reset confirmation.
6. Define the v0.2 content-compatibility allowlist/policy. The current loader's acceptance of a changed hash merely because IDs resolve must not admit incompatible content or old rules.
7. Extend content-floor validation to the planned release quantities and coverage. During incremental work, use an explicit development milestone profile or expected incomplete-content diagnostics; the production release profile must never claim that placeholder content meets the final floor.

### Exit gate

The amendment/exception record, dependency audit, traceability entries, and version/compatibility policy exist. A representative v0.1 save is rejected without alteration; a current baseline of v0.2 state can save/reopen; newer unsupported data is rejected. Resetting still requires confirmation. The existing playable loop and focused regression checks pass. Full new-content counts become mandatory when the final catalog/ladder phases complete.

## 5. Governing-document amendments scheduled in Phase 0

These are implementation tasks, not edits performed while preparing this plan.

| Document and section | Required amendment or review | Reason |
|---|---|---|
| Functional 6.3, 8.4-8.5 | Clarify local ship switching, inactive-ship fitting/cargo access, draft ownership, and explicit module-size compatibility. Keep cargo/fitting/condition attached to their ship. | Makes multi-hull behavior and size constraints unambiguous; most ownership rules already exist. |
| Functional 9.4, 9.6 | Clarify guided launch versus impact, projectile persistence after lock/source loss, target departure/destruction, expiry/contact ties, and launch-parameter snapshot semantics. Keep existing accuracy and damage formulas. | The formulas are specified, but lifecycle edges need a common contract. |
| Functional 9.7-9.9 | Clarify the new passive modifier attributes, buffer-removal condition behavior, web start/application checks, refresh, multiple sources, source attribution, movement response, and effect expiry. | Avoids UI/engine disagreement and free-repair or permanent-effect exploits. |
| Functional 3.4 | Include active-ship switching as an autosave trigger; hull purchasing remains covered by market transactions. | A resumed campaign must not unexpectedly select the previous ship. |
| Technical 6.2, 8.2-8.3, 10.2-10.3 | Document size/family metadata, modifier operators, ship-bound drafts/previews, projectile/effect ownership and serialization, NPC loadout/per-weapon ammunition support, and AI inputs for guided/control use. | Extends the existing architecture without introducing a UI authority path. |
| Technical 9.2, 10.1, 15.3 | Resolve projectile impacts/control refresh in the existing deterministic order; define valid retained source attribution, departed targets, inactive ships, attempt identities, and invariant checks. | Prevents order-dependent damage, dangling references, and duplicate rewards. |
| Technical 5.1, 11.4, 18, 19.6 | State the explicitly permitted v0.1 -> v0.2 compatibility break and safe rejection; retain versioned schemas and integrity checks. Bound the migration-guarantee exception to the early alpha transition. | The current text requires migration paths for every released version. The feature brief explicitly waives this work for the alpha. |
| Technical 11.4 | Require declared compatible content transitions rather than reference resolution alone; document current-v0.2 fixture requirements. | Aligns loader behavior with the existing content-compatibility contract. |
| Functional 9.10-9.11, 18-20; Technical 12, 15 | Review that new archetype, loot, comparison, explanation, accessibility, and testing behavior fits existing rules. Amend only if implementation introduces a new rule. | Content expansion alone does not require rewriting the full-game specification. |

Keep release counts, prices, pacing hypotheses, and working item/site names in v0.2 scope/content. Keep the obsolete MVP scope as the completed MVP record rather than rewriting history to imply it shipped three hulls. Do not edit `docs/human-input` or read the excluded prompt log/archive for routine implementation.

## 6. Phase 1 — Multi-hull purchase, storage, fitting, and switching

**Depends on:** Phase 0. **Traceability:** AC-01, AC-03, AC-12, AC-13.

### Work

1. Add destroyer and cruiser hull definitions, listings, schematic identity, and localization. Keep the starter fit legal. Establish size metadata and proposed slot/hardpoint/resource layouts that accommodate the six planned reference fits.
2. Extend existing hull purchase transactions: create separate cargo/fitting inventories and ship identity; keep an existing ship active; activate a bought hull only when shipless. No implicit fitted equipment or free package is created.
3. Add or reuse an authoritative docked ship-selection command and local ship-list/detail projections. Enforce ownership, locality, one active ship, and station/player-location consistency. Buying, switching, and recovery must remain atomic and idempotent.
4. Allow inspect/fitting drafts for inactive local ships and explicit local cargo transfers. Bind drafts, repair/resupply/insurance operations, and readiness to the right ship. On switching, finish or discard the draft explicitly and refresh affected previews/action availability.
5. Add station ship selection and comparison to the current navigation. Buying a bare hull must explain what remains to be fitted; the player can retain and return to the old ship. Reject in-space and nonlocal switching with an actionable reason.
6. Persist all ships and active selection; autosave purchase/switch after commit. Exercise loss of the active ship when a usable stored ship exists, when only invalid ships exist, and when no ship exists. Preserve the exact recovery eligibility rule and grant provenance.

### Exit gate

A player can earn/buy a second or third hull, explicitly move equipment, fit it, switch, undock, return, switch back, and reopen with all ships intact. Switching with a pending preview cannot repair, insure, resupply, or commit a draft to the wrong ship. Failed and duplicate commands cannot lose credits or duplicate ships. This is the first new playable vertical slice: hull progression against the existing three sites, using existing turret combat while later mechanics are developed.

## 7. Phase 2 — Expanded turret fits, defense, capacitor, and attribute traces

**Depends on:** Phase 1. **Traceability:** AC-02, AC-04, AC-05, AC-12.

### Work

1. Add projectile/hybrid family and size compatibility to definitions, repositories, schemas, fitting validity, and item inspection. Implement the planned small/medium turret and ammunition variants.
2. Add reviewed attribute operators for shield capacity/recharge, capacitor recharge, turret family damage, tracking, and guided application metadata needed next. Existing categories may be extended, but unsupported operator/category combinations must fail semantic validation.
3. Add active-defense and afterburner size variants, passive shield choices, capacitor choices, and turret support from the planned roster. Keep tunable magnitudes and costs in JSON.
4. Apply all modifiers through the common pipeline, including fitted stacking by direction, offline behavior, bounds, traces, and condition/capacitor handling when capacities change. Verify repeated fitting/removal cannot heal or generate resources.
5. Extend fitting summaries, comparisons, item details, market purpose/size/compatibility filters, and mixed-ammunition resupply/undock warnings. Retain expandable calculations and compact combat rows.
6. Add obtainable turret-focused reference fits for each hull with preliminary pricing. Add semantic checks that their slot, size, hardpoint, power, processing, and ammunition relationships are legal.

### Exit gate

Distinct close/long-range turret and active/passive defense fits work against existing sites. Exact formula/boundary tests and meaningful conservation/stacking checks pass. New statistics have projected explanations, and size mismatches are rejected before and at commit. Reference fits and current multi-ship saves reopen correctly. Final guided/control choices and final content counts remain dependent on subsequent phases.

## 8. Phase 3 — Guided weapons from launch through resume

**Depends on:** Phase 2. **Traceability:** AC-02, AC-05, AC-06, AC-13, AC-14.

### Work

1. Extend the module/ammunition unions and schemas for small/medium launchers, magazines, compatible charges, flight speed/lifetime, explosion radius/velocity, and the guided application enhancer. Complete the sixteen-ammunition floor.
2. Implement the pure guided application formula and launch-to-impact projectile state machine under the shared scheduler. Reuse module costs, ammunition reservation, reload, inventory, damage vectors, and source attribution. Do not apply instant turret damage for launchers.
3. Resolve source death/warp, lock loss, target death/departure, lifetime expiry, zero-distance geometry, simultaneous completions, and mixed turret/projectile damage in deterministic order. Keep a launched projectile independent of a live source entity while retaining valid attribution.
4. Extend per-weapon loadout/ammunition handling where required, including NPC content validation and runtime installation. A single global ammunition ID must not force all fitted weapons to use the same group.
5. Add guided-specific weapon/ship/selected-target projections: estimated flight, theoretical reach, signature/speed factors, limiting factor, current application, and traces. Update all-weapons controls, cargo reserve displays, reload/change-ammunition, and market compatibility.
6. Add simple projectile SVG presentation and guided hit/miss explanations. Integrate ship-guided fits and a small missile-opponent fixture into the station -> combat -> loot -> return browser flow.
7. Serialize projectiles and launch parameters, remaining flight time, pending cycles, magazines/reservations, and source attribution. Update schema parity, contract locks, current golden saves, and direct/worker parity fixtures when the new contract stabilizes.

### Exit gate

Player and NPC guided weapons launch, travel, hit/miss, reload, and show correct application using the functional formula. Saving during launch/flight and reopening produces the same damage, consumption, and hash as uninterrupted play. Target/source disappearance is safe and cannot grant refunds or repeated damage. The guided vertical slice passes focused browser/keyboard and engine integration checks before more encounters are authored.

## 9. Phase 4 — Web control and enemy archetypes

**Depends on:** Phase 3. **Traceability:** AC-02, AC-04, AC-07, AC-08, AC-13.

### Work

1. Implement the web's targeted cycle, capacitor cost, range/lock checks, effect records, same-source refresh, different-source combination, expiry, and 10% speed floor. Use the common movement controller and explicit effect/source attribution.
2. Extend projections, compact module controls, target effects, availability reasons, notifications, audio mapping where applicable, and loss reports. Explain slowing without implying warp disruption. Preserve accessibility and no-color-only distinctions.
3. Extend NPC intent inputs to cover guided reach, control range, own resources, and loadout. Issue ordinary validated movement/lock/module intents through the existing AI adapter; avoid direct state mutation and hidden player-relative bonuses.
4. Author at least ten legal profiles covering fast frigate, artillery, repairing brawler, missile ship, and web controller. Ensure each has visible behavior, fitting-compatible equipment, and sufficient authored ammunition/capacitor for its intended pressure.
5. Complete the 26-module roster and all six legally obtainable reference fits. Run the final module/ammunition/fit compatibility checks even before the twelve-site floor is activated.
6. Add persistence/replay coverage for web expiry, refresh at the same timestamp, multiple sources, source destruction, target departure, pausing, and module starvation. Include NPC behavior assertions for all five archetypes.

### Exit gate

The five archetypes behave differently in small integration encounters. Player and NPC webs obey identical rules and leave no permanent/dangling effects. Each of the six reference fits is flyable and inspectable. All 26 module definitions execute their advertised effects; none is merely a catalog placeholder. Existing retreat and loss/recovery continue to work.

## 10. Phase 5 — Twelve-site ladder, useful loot, and player disclosure

**Depends on:** Phase 4. **Traceability:** AC-08, AC-09, AC-10, AC-14.

### Work

1. Author the twelve encounter templates in FeatureSpec02 section 8, including revised Scout, Patrol, and Base. Add site positions/destinations, compositions, spawn geometry, localization, and band/threat/recommendation/reward metadata. Keep objectives limited to hostile destruction.
2. Give every template a short decision rationale and expected fit weakness. Validate three bands with four templates each and at least three fit-sensitive sites. Keep the system danger rating independent and fixed.
3. Expand loot tables to drop at least ten modules spanning the required categories, including a launcher and medium equipment. Connect every ordinary combat module and ammunition group to local purchase/restock listings. Keep starter recovery goods unlimited/non-scarce and grant assets valueless.
4. Derive reward disclosures from actual bounty/drop definitions. Add band grouping/filtering and threat/capability summaries to destination/departure UI without hiding harder content or adding level gates. Preserve original destination selection and warp/dock behavior.
5. Verify attempt identity, completion/abandonment/repeat behavior, one-time NPC rewards, and distinction between a fresh attempt and returning to wrecks. Preserve unexpired player wrecks and loot when starting another attempt at the same site.
6. Extend contextual guidance only for new choices: ship purchase/switch, launcher application, web counterplay, and choosing difficulty. Do not expand this into the complete-game tutorial.
7. Activate the complete v0.2 production content floor and update traceability extents formerly marked deferred. Add largest authored-site budgets, including projectile/effect counts, and fixtures for high simultaneous fire.

### Exit gate

Every site is selectable, disclosed, enterable, repeatable, and completable by an appropriate test fit. Difficulty never scales to the player. All count/role/source/localization checks pass. Save/reopen and repeated abandonment cannot duplicate bounties or reroll materialized loot, and site reset cannot erase a player wreck. A complete new-campaign -> cruiser -> advanced-site path is now available for balance work.

## 11. Phase 6 — Measured fitting, hull progression, and economy tuning

**Depends on:** Phase 5. **Traceability:** AC-04, AC-09, AC-10, AC-11, AC-12, AC-15.

### Work

1. Extend existing headless progression/balance harnesses with all twelve sites, six declared reference fits, fixed seed sets, explicit movement/target/module policies, and comparable activation assumptions. Record loadout and purchase/consumable costs in each result.
2. Measure win/retreat/loss, simulation duration, incoming layer damage, capacitor starvation, ammunition, repair/resupply cost, and net credits. Use at least ten fixed seeds for the required fit/hull comparisons; include success variation rather than relying on one favorable fight.
3. Demonstrate two viable fits per hull, at least two same-hull preference reversals across sites, and at least three disclosed fit-sensitive sites. Compare complete supplied fits at declared budgets; never manufacture a counterexample with empty magazines or inactive defenses.
4. Compare the frigate/destroyer and destroyer/cruiser on fixed previously threatening encounters under the same command policy. Apply the outcome/30% metric defined in FeatureSpec02, and separately demonstrate small-target or operating-cost disadvantages of larger ships.
5. Run full careers from actual starting assets, including conservative no-module-drop income, a poor purchase, loss of each purchased hull, stored-ship reuse, and starter rebuild. Test selective kills/retreat, insurance, and recovery provenance for profitable exploits or dead ends.
6. Tune JSON statistics, prices, bounties, stock/restock, module drops, and compositions against the pacing hypotheses. Record sortie counts and simulation time to useful fit/destroyer/cruiser packages and maintain a dependable path when loot is unlucky.
7. Update balance expectations/reports deliberately after inspecting results. Do not regenerate fixtures simply to conceal a failure. Review any departure from the initial pacing/material-improvement targets and update the documented rationale.
8. Provide a human playtest route: start unaided, try contrasting fits, encounter an explainable failure, buy both hull upgrades, revisit an earlier threat, recover from a loss, and try the advanced band. Record perceived power, pacing, dominant fits, and unclear information. Implement findings, then rerun affected evidence.

### Exit gate

Recorded matrix/career evidence meets the quantitative acceptance criteria, and a human product review confirms meaningful choices and satisfying progression. No required build depends on a lucky drop or inaccessible service. Repeated easy sites remain profitable enough for recovery without making every more difficult activity economically pointless. Any human review still pending is reported as pending; automated results cannot substitute for AC-15.

## 12. Phase 7 — Regression, persistence hardening, and release handoff

**Depends on:** Phase 6. **Traceability:** all AC IDs, especially AC-01 and AC-12 through AC-15.

### Work

1. Run complete current-v0.2 persistence/replay coverage: multi-ship inventories, inactive-ship condition/insurance, draft invalidation, mixed magazines and reservations, projectiles in flight, simultaneous impact/destruction, web refresh/expiry, partial encounters, completed rewards, NPC/player wrecks, and destruction recovery.
2. Exercise quota/interrupted-write/corrupt-save recovery, old/future/incompatible rejection, explicit reset, pause, browser suspension, clock changes, and close/reopen with zero offline progress. Preserve the last valid snapshot on failures.
3. Complete Chromium and Firefox browser/accessibility flows for the enlarged station/catalog/destination surfaces and guided/control combat. Include keyboard-only and mouse-only operation, focus return, scale, contrast, non-color effects, reduced motion, and meaningful explanations. Check Chrome/Edge smoke coverage according to the release gate's existing target matrix.
4. Run performance scenarios for the largest real authored encounter plus simultaneous guided volleys and effects, long repeat sessions, and enlarged inventories. Meet the governing targets for the delivered pause/1x scope; deferred extra rates do not become a v0.2 prerequisite.
5. Run the standard release checks below. Resolve failures and rerun affected checks before the final aggregate gate. Regenerate contract locks, golden recordings, balance expectations, and release evidence only through their existing scripts after review.
6. Set application/content release metadata to v0.2, refresh the generated candidate report through release tooling, and ensure traceability covers every acceptance ID. Explain the fresh-campaign requirement in player-facing release notes.
7. Produce a release handoff summarizing implemented content, verification, balance/playtest findings, remaining known limitations, and compatibility policy. Request that the human operator update `docs/human-input/CurrentState.md`; agents must not edit that protected human-input folder.

### Exit gate

All V02 acceptance IDs have evidence; the full verification/release gate is green; required human review findings are resolved or explicitly accepted as nonblocking. Main specifications and implementation agree. Ship counts, module effects, site decisions, progression evidence, save integrity, and compatibility communication are complete. No implementation phase is complete solely because a test file or report exists.

## 13. Verification commands and evidence discipline

Use targeted tests while developing each phase. At integration/release boundaries, the repository currently provides:

```powershell
npm run verify
npm run balance
npm run test:browser
npm run test:accessibility
npm run test:browser:firefox
npm run test:accessibility:firefox
npm run release:gate
```

`verify` includes type checking, architecture, content, unit/integration/performance/component tests, traceability, and production build; it does not replace browser/accessibility or human playtests. Inspect the release-gate definition before execution so its candidate/version prerequisites and Chrome/Edge checks are satisfied. Adapt stale MVP-only assertions to the new requirements while retaining the invariants they protected.

Expected evidence consists of current-v0.2 save/replay fixtures, protocol/schema parity results, content/fit/ladder coverage, the seeded balance matrix, career/rebuild reports, browser/accessibility results, performance measurements, and a human playtest record. Old-save fixtures may remain as rejection tests; writing a migration chain for them is not a release prerequisite.

## 14. Principal risks and handling

| Risk | Planned handling and gate |
|---|---|
| A larger hull is only a bigger health pool, or dominates every fit | Phase 6 fixed-site power comparisons plus small-target/cost disadvantages and same-hull preference reversals |
| Catalog grows without real choices | Phase 2/4 effect execution and six legal reference fits; Phase 6 measured counter-fit outcomes |
| Guided combat becomes an instant-hit reskin or breaks on source death | Phase 3 separate persisted projectiles, impact-only damage, exact boundary tests and current-save replay |
| Web effects leak, stack without bound, or make retreat impossible | Phase 4 source-aware refresh/expiry and speed floor; explicit no-warp-disruption scope and retreat regression |
| Switching duplicates equipment or targets the wrong ship | Phase 1 transactional identity, inventory conservation, ship-bound drafts/previews and autosave/reopen |
| New content is blocked by MVP assumptions or counted as complete too early | Phase 0 audit/profiles, Phase 5 mandatory production floor and updated traceability extents |
| Players must grind indefinitely or wait for a rare drop | Phase 5 purchase/restock guarantees; Phase 6 complete-package income and no-lucky-drop career |
| Twelve destinations and 26 modules overwhelm reviewed UI | Incremental UI work in each phase, Phase 5 grouping and disclosure, Phase 7 accessibility/browser review |
| Old saves appear loadable because IDs happen to resolve | Phase 0 explicit version/compatibility boundary and non-destructive rejection tests |
| Human enjoyment remains unverified | Phase 6 scheduled human review; keep product acceptance visibly pending until observed |
