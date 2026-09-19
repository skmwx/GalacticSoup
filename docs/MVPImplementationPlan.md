# Galactic Soup MVP Implementation Plan

## 1. Purpose

This document sequences implementation of `MVPScope.md`. It does not redefine the MVP or restate game rules. The authority order and interpretation rules in the MVP scope continue to apply; each phase below points to the authoritative sections that its implementation must satisfy.

The plan is intentionally divided into work packages that one coding agent can complete in one focused session. A phase is complete only when its production code, data, contracts, persistence changes, projections, and tests are integrated and its exit gate passes. If investigation shows that a phase cannot fit in one session, it must be split at an internal integration boundary before implementation rather than handed off half-finished.

## 2. Delivery rules for every phase

1. Start from a green repository and run the narrowest existing checks that cover the area before editing.
2. Preserve the layer direction in Technical Specification section 4. No phase may place authoritative state or rules in React, bypass commands, or couple the engine to browser APIs.
3. Add only contracts and abstractions required by the current or already-completed phases. Deferred systems are not prebuilt.
4. Put tunable values and authored definitions in validated content; keep algorithms in the engine.
5. Treat a phase as a vertical change through every affected layer. A command without its query/projection, schema, persistence coverage, and tests is incomplete.
6. When authoritative state or a protocol changes, update its version, schema, pure migration where applicable, golden fixture, and compatibility tests in the same phase. After the first snapshot is introduced, no phase may defer save-shape work.
7. Add stable Functional Specification and MVP acceptance IDs to tests as soon as behavior is implemented. Keep the traceability source current rather than reconstructing it at the end.
8. Finish with targeted tests and the repository-wide unit/integration suite. Run browser tests when the phase changes a player flow, and run the production build when it changes bundling, workers, content loading, or persistence.
9. Record any deliberate technical-specification exception as an architecture decision and obtain the corresponding document change before relying on it. Do not encode an undocumented exception as a temporary shortcut.

Phase 1 establishes these stable entry points, which later phases use consistently: `npm run validate:content`, `npm run test:unit`, `npm run test:integration`, `npm run test:component`, `npm run test:browser`, `npm run test:accessibility`, `npm run traceability`, and `npm run build`.

## 3. Milestone path

| Milestone | Phase | Integrated result |
|---|---:|---|
| Executable architecture | 1 | React client and worker-hosted headless engine communicate through the target gateway. |
| Resumable campaign shell | 4 | A local campaign can be created, closed, and reopened through versioned persistence. |
| Runnable traversal slice | 10 | The player can prepare at the station, undock, travel to a selected site, retreat, return, and dock. |
| First end-to-end MVP vertical slice | 14 | The easiest encounter supports the complete prepare, fight, reward, return, sell/repair/resupply, and improve loop. |
| Gameplay-complete MVP | 17 | All scoped encounters, progression, loss, insurance, recovery, repeatability, and baseline balance are integrated. |
| UX-complete MVP | 19 | Onboarding, explanations, notifications, audio, input, and accessibility are integrated. |
| Release candidate | 21 | The full automated gate is green and the build is ready for the required human product playtest. |

## 4. Implementation phases

### Phase 1 - Application, worker, and test spine

**Outcome:** A production-shaped application boots, reaches a dedicated worker through a transport-independent gateway, and can run the same no-op engine host directly in tests.

**Implement:**

- Create the Vite, strict TypeScript, React, CSS-module, and SVG-capable application skeleton and the stable source boundaries from Technical Specification section 4.3.
- Add the protocol envelope, shared error model, worker dispatcher, client gateway interface, worker gateway, and direct test gateway under `src/protocol`, `src/adapters/worker`, and `src/gateway`.
- Add a minimal application shell and compatibility failure surface. The UI must not yet contain gameplay state.
- Establish localization-key lookup and named-parameter formatting so later UI and content do not embed player-visible strings in rules or authoritative data.
- Configure Vitest, React Testing Library, and Playwright, including scripts for the checks named in section 2 of this plan.
- Pin dependencies and add boundary/circular-import enforcement.

**Contracts and persistence:** Protocol version 1 contains only worker health/capability requests. There is no campaign snapshot yet.

**Tests and exit gate:** Direct and worker transports return the same response contract; malformed messages return stable errors; the headless engine imports without DOM globals; component smoke, browser boot, and production build pass.

**Traceability:** Technical Specification sections 2, 3.1, 4, 5.4, 7.1, 12.1, 15.1, and 18. No MVP acceptance criterion closes in this phase.

### Phase 2 - Content compilation and shared primitives

**Outcome:** The build consumes a canonical, validated MVP content bundle through an engine-facing repository port.

**Implement:**

- Add branded identifiers, canonical numeric/unit guards, stable collection ordering, and canonical JSON utilities under `src/shared`.
- Add JSON Schemas under `schemas/content`, semantic validation and content indexing under `src/adapters/content`, and the read-only content port under `src/engine/ports`.
- Define only the content shapes needed by the MVP slice: shared rules, hulls, modules, ammunition, items, the scoped world/station, listings, NPC profiles, loot, encounters, and their localization keys.
- Seed only the minimal valid bootstrap definitions needed to exercise compilation, using stable IDs and provisional tuning values. Each later gameplay phase adds the definitions it owns; final balance remains Phase 17 work.
- Produce a deterministic `contentVersion` and content hash during build.

**Contracts and persistence:** Add content-bundle and content-error contracts. There is no campaign migration.

**Tests and exit gate:** Schema failures identify file and JSON path; semantic fixtures cover duplicate/unresolved IDs and MVP catalog relationships; canonical output is stable across input order; development startup, test startup, and production build all reject invalid content.

**Traceability:** Functional Specification section 4 and the included content portions selected by MVP Scope sections 3-4; Technical Specification sections 5, 6, 14, 15.1, and 18.

### Phase 3 - Transactional engine and deterministic simulation kernel

**Outcome:** A headless campaign aggregate processes versioned commands and queries on an authoritative pause/1x simulation clock with deterministic scheduling and randomness.

**Implement:**

- Add the application command/query pipeline, transaction-local drafts, revision checks, request deduplication, domain events, projection invalidation, and invariant hooks.
- Add the initial `CampaignState`, stable entity/event ordinals, deterministic random streams, fixed-quantum clock, stable scheduler, and elapsed-delta driver.
- Add campaign create/reset commands and minimal session/frame projections without implementing gameplay systems.
- Add canonical authoritative-state hashing and a replay harness accepting a starting state, deltas, and commands.

**Contracts and persistence:** Extend protocol schemas for campaign/session, time control, and projection frames. Define the in-memory authoritative state schema that Phase 4 will persist.

**Tests and exit gate:** Failed and stale commands leave state, revision, ordinals, and random streams unchanged; duplicates are idempotent; pause and 1x advance correctly; scheduler ties are stable; replay checkpoints produce identical hashes through both gateways.

**Traceability:** MVP-AC-01 (foundation); Functional Specification sections 3.3, 4.2-4.3, and applicable section 22 invariants; Technical Specification sections 7, 8.1, 9.1-9.5, 15, and 18.

### Phase 4 - One-slot save, close, and resume

**Outcome:** The campaign shell is durable and earns the first resumable-build milestone.

**Implement:**

- Add the persistence port, in-memory adapter, IndexedDB adapter, one-slot manifest, immutable snapshot envelope, canonical checksum, load validation pipeline, and versioned migration registry.
- Add create, reset, close, resume, and save-status flows to the application shell.
- Coordinate snapshot capture in the worker and ordered writes in the main-thread adapter without making persistence authoritative.
- Add the applicable periodic autosave request, internal autosave rotation, suspension-baseline reset, quota/integrity reporting, and safe recovery to the last valid snapshot. The MVP UI resumes the newest valid snapshot and does not expose deferred save-management controls.

**Contracts and persistence:** Introduce save format version 1, its JSON Schema, a golden snapshot, and the no-op migration baseline. Store content compatibility metadata with the snapshot.

**Tests and exit gate:** Create/close/reopen and reset pass in Chromium; checksum, incompatible version, interrupted write, and quota fixtures preserve the prior valid state; simulated closure, suspension, and wall-clock changes add no simulation progress.

**Traceability:** MVP-AC-01; Functional Specification sections 3.1, 3.3-3.4 as selected by MVP Scope section 6, plus Functional section 22.12; Technical Specification sections 9.1, 11, 14, and 15.

### Phase 5 - Wallet, assets, and inventory domain

**Outcome:** The campaign owns its wallet, starter hull, station hangar, ship cargo, and physical items through one invariant-protected inventory service.

**Implement:**

- Add item-stack, inventory, ship-identity, and asset-location domain modules.
- Add atomic split, merge, transfer, reserve/release, capacity, and maximum-that-fits operations; route every physical-item mutation through the inventory service.
- Add the MVP starting wallet and unfitted asset state plus the minimal hull/item definitions those assets reference. The valid starter fit is assembled in Phase 6.
- Add assets, hangar, cargo, wallet, and item-inspection projections without building station screens.

**Contracts and persistence:** Add inventory transfer and asset query schemas. Migrate snapshots for credits, ships, stacks, inventories, provenance, capacities, locations, and active-ship identity.

**Tests and exit gate:** Property tests prove conservation, one location per physical item, capacity, non-negative values, stable split/merge provenance, and atomic failure; save round-trips preserve ownership and quantities exactly.

**Traceability:** MVP-AC-02 and MVP-AC-06 (foundation); Functional Specification sections 3.1, 4.1, 6.1-6.2, and applicable section 22 inventory/credit invariants; Technical Specification sections 8.1-8.3, 11, and 15.

### Phase 6 - Starter fit and derived-attribute domain

**Outcome:** The headless engine can assemble the valid starting fit and preview or commit every scoped fitting choice.

**Implement:**

- Add fitted-module instances, fitting drafts, compatibility/resource validation, and the dependency-aware derived-attribute pipeline.
- Add fit planning/commit/revert commands, undock-validity query, and calculation traces.
- Populate the MVP player catalog sufficiently to exercise every selected fitting category; leave tuning provisional.
- Add ship, fitting, item-comparison, derived-stat, and formula-explanation projections without building station screens.

**Contracts and persistence:** Add fitting command/query schemas. Migrate fitted instances, online state, ammunition state, base damage/capacitor state, and fitting-draft recovery fields that are authoritative.

**Tests and exit gate:** Formula tests cover modifier ordering and trace output; state-machine tests cover draft commit/revert, fitting constraints, and invalid undock conditions; the authored starting fit validates and survives save/reload.

**Traceability:** MVP-AC-02 and MVP-AC-04 (partial); Functional Specification sections 4.4, 8.2-8.5, and 19.6; Technical Specification sections 10.2, 11, and 15.

### Phase 7 - Local market, repair, resupply, and insurance domain

**Outcome:** Every station-side economic mutation needed by the MVP loop works headlessly as an atomic preview/confirm transaction.

**Implement:**

- Add the local station-economy aggregate and market quote/stock services for the selected listings.
- Add buy, sell, repair, resupply, and insurance preview/confirm commands using state-bound preview tokens.
- Connect transactions to wallet, station hangar, ship cargo, fitted/loaded ammunition, ship condition, and insurance state.
- Add station-service, listing, transaction-preview, repair, resupply, and insurance projections with calculation traces and unavailability reasons.
- Add the applicable economic scheduler boundaries without exposing deferred remote/history/trade-progression features.
- Emit the required autosave request after a committed market transaction.

**Contracts and persistence:** Add station transaction schemas. Migrate listing stock, service state, acquisition provenance needed by included selling, insurance, and accepted preview-relevant entity versions.

**Tests and exit gate:** Formula and property tests cover quote totals, stock movement, credit/item conservation, capacity failures, and bulk equivalence; stale previews refresh; duplicate confirmations do not transact twice; save/reload preserves the same quotes and ownership.

**Traceability:** MVP-AC-02 and MVP-AC-06 (partial); Functional Specification sections 9.12, 10, 11.1-11.3, 19.5-19.6, and applicable section 22 invariants; Technical Specification sections 7.4, 8.2-8.3, 10.4, and 15.

### Phase 8 - Integrated station interface

**Outcome:** A player can understand and complete all pre-combat preparation through the actual UI.

**Implement:**

- Build the applicable persistent frame and station hub, hangar, market, fitting, repair, resupply, and insurance views.
- Add a central UI action registry, shared item inspection/comparison, preview/confirmation dialogs, pending-command handling, and visible error/unavailability reasons.
- Keep UI stores limited to presentation state and immutable projections.
- Establish reusable focus and keyboard interaction patterns for station surfaces; full accessibility verification remains Phase 19.

**Contracts and persistence:** No new domain authority. Persist only campaign fields introduced by a discovered integration need, with a same-phase schema/migration/fixture update. Presentation preferences are not campaign data.

**Tests and exit gate:** Component tests cover projection rendering, stale previews, focus return, duplicate-submit prevention, and failure reasons; a browser flow creates a campaign, inspects and compares items, transacts, changes a fit, repairs/resupplies, insures, and reopens to the same state.

**Traceability:** MVP-AC-01, MVP-AC-02, and MVP-AC-04 (explanation foundation); Functional Specification sections 19.1, 19.5-19.7 and the applicable parts of section 20; Technical Specification sections 7.3-7.4 and 12.

### Phase 9 - Site, movement, warp, and dock engine

**Outcome:** The headless engine can perform the complete station-to-encounter-and-back journey required by the selected slice.

**Implement:**

- Add authored site definitions and current-site runtime state for the scoped system.
- Add encounter-destination selection, undock, movement orders, warp, retreat, and dock commands and their state machines.
- Add geometry utilities, constrained movement integration, deterministic separation, spatial transitions, and command cancellation reasons.
- Add site, object, movement-order, travel-status, and destination projections.
- Connect docking/undocking and encounter transitions to the applicable autosave requests.

**Contracts and persistence:** Add navigation command/query schemas. Migrate location, positions, velocities, facing, movement/travel state, current site instance, known destinations, and transition scheduler entries.

**Tests and exit gate:** Formula/property tests cover geometry edge cases; state-machine tests cover every selected order, warp and dock preconditions/cancellation, retreat, target disappearance, and save during stable travel states; replay hashes remain stable.

**Traceability:** MVP-AC-03 and MVP-AC-08 (retreat foundation); Functional Specification sections 5.2-5.3, 7.1-7.4 as selected by the MVP, and applicable sections 22.5 and 22.10-22.11; Technical Specification sections 9.2-9.3, 10.1, 11, and 15.

### Phase 10 - Schematic space view and traversal integration

**Outcome:** The runnable traversal milestone is available through mouse and keyboard in the shipped UI.

**Implement:**

- Build the SVG site renderer, camera transform, semantic icon layers, object selection, range/intent overlays, movement vectors, labels, and off-screen markers needed by the selected slice.
- Build selected-object and command-bar surfaces from engine-projected availability, using the shared action registry.
- Add undocked persistent-frame data, pause/1x controls, encounter selection at the station, and travel/dock feedback.
- Keep interpolation presentational and ensure reduced motion can disable it later without affecting simulation.

**Contracts and persistence:** Add only tactical projection topics and presentation-state types; no new authoritative UI state.

**Tests and exit gate:** Component tests cover camera/selection/action mapping and non-color semantic states; a Playwright flow selects a destination, undocks, moves, warps, retreats, returns, docks, and resumes after reopen. Verify that all state changes traverse the gateway.

**Traceability:** MVP-AC-03 and MVP-AC-08 (retreat path); Functional Specification sections 19.1-19.3 and applicable section 20 behavior; Technical Specification sections 7.3, 12.1-12.3, and 15.1.

### Phase 11 - Targeting, turret, ammunition, and reload engine

**Outcome:** Player and test-target ships can lock and exchange scheduled turret fire under the authoritative formulas.

**Implement:**

- Add lock attempts/locks, weapon activation/deactivation, repeated cycles, committed costs, ammunition magazines, reload/change-ammunition actions, and target-loss cleanup.
- Integrate lock and weapon lifecycle with the existing warp, docking, and site-transition state machines.
- Add pure lock, relative-motion, angular-velocity, turret-accuracy, and shot-variation functions with expanded calculation traces.
- Add lock, module, ammunition, cycle, and weapon-effect projections and semantic combat events.
- Extend MVP module/ammunition content only as needed to cover the scoped turret choices.

**Contracts and persistence:** Add targeting/module command schemas. Migrate locks, scheduled cycles, reservations, magazines, reload state, and combat random-stream state.

**Tests and exit gate:** Formula fixtures cover authoritative examples and boundaries; state-machine tests cover lifecycle, range loss, cancellation, insufficient resources, target disappearance, simultaneous completions, and deterministic shot replay; failed actions consume no random draw or ammunition.

**Traceability:** MVP-AC-03 and MVP-AC-04 (partial); Functional Specification sections 4, 9.2-9.5, and applicable section 22 invariants; Technical Specification sections 9.2-9.5, 10.3, and 15.

### Phase 12 - Damage, defenses, capacitor, and module operation

**Outcome:** The complete included player combat model works headlessly, including its active/passive fitting tradeoffs.

**Implement:**

- Add four-component damage, layered application/spillover, resistances, destruction detection, shield and capacitor regeneration, and active repair cycles.
- Add the selected propulsion, active-defense, passive-defense/resistance, and capacitor-support module operators using the common module lifecycle.
- Publish defensive-layer, capacitor, active-module, projected effectiveness, endurance, and explanation data required by the combat UI.
- Add significant-event aggregation while retaining deterministic domain events for later notifications and loss reporting.

**Contracts and persistence:** Extend module and tactical projection schemas. Migrate damage, capacitor, regeneration boundaries, active effects, module cycles, and combat-event buffer state.

**Tests and exit gate:** Formula/property tests cover damage conservation, clamps, recharge, repairs, and capacitor payment; state-machine tests cover activation/wait/deactivation and save/reload mid-cycle; replay tests cover simultaneous fire/repair/destruction ordering.

**Traceability:** MVP-AC-04; Functional Specification sections 4, 9.7-9.8, and applicable sections 22.4, 22.11, and 22.13; Technical Specification sections 9.2, 10.2-10.3, 15.1, and 15.3.

### Phase 13 - NPC behavior, encounter lifecycle, and rewards

**Outcome:** The headless engine can instantiate, resolve, abandon, and repeat authored combat encounters and commit their rewards.

**Implement:**

- Add the NPC AI command adapter and only the behavior profiles needed by the scoped encounters.
- Add the declarative encounter lifecycle, destination instantiation, completion/abandonment, fresh-instance policy, and disclosed reward summary projection.
- Add bounty settlement, NPC wreck creation/expiration, loot ownership, cargo transfer, and encounter completion events.
- Author a complete easiest encounter and structurally valid provisional definitions for the remaining scoped encounters.
- Add encounter, NPC, wreck, loot, result, and station-destination projections.

**Contracts and persistence:** Add encounter and loot command/query schemas. Migrate NPC/site instance state, objective state, reward grant IDs, wrecks, loot, expiration scheduler entries, and repeatability state.

**Tests and exit gate:** State-machine tests cover NPC use of normal commands, completion versus retreat/abandonment, reward idempotence, wreck expiry, capacity-constrained looting, and fresh instances; headless integration completes the easiest encounter from the starter state and returns with rewards.

**Traceability:** MVP-AC-05, MVP-AC-06, and MVP-AC-09 (engine coverage); Functional Specification sections 5.4, 9.10-9.11, 18, and applicable section 22 invariants; Technical Specification sections 9.2-9.4, 10.3, 10.6, and 15.

### Phase 14 - Combat UI and first end-to-end vertical slice

**Outcome:** The first complete MVP loop is playable against the easiest encounter.

**Implement:**

- Add lock state, grouped modules, ammunition/reload, ship defenses/capacitor, NPC state, relative motion, weapon effectiveness, limiting-factor explanations, combat events, wreck inspection, and loot transfer to the space UI.
- Add contextual combat commands through the action registry and render tactical status plus semantic combat events in their permanent panels; Phase 18 adds cross-surface notification, audible-cue, and onboarding presentation.
- Connect return, docking, selling, repair, resupply, and fitting so rewards can immediately change the next attempt.
- Complete calculation explanations needed to understand the included combat decisions.

**Contracts and persistence:** Tactical projection schemas become acceptance-test contracts. Any integration-discovered authoritative field receives the required migration and golden-save update.

**Tests and exit gate:** A browser acceptance test performs the complete easiest-site loop from campaign creation through a meaningful station-side improvement and a repeat attempt. Separate mouse and keyboard scripts cover combat commands. Save/reopen is tested once in combat and once after reward conversion. This is the first end-to-end MVP vertical slice.

**Traceability:** MVP-AC-02, MVP-AC-03, MVP-AC-04, MVP-AC-06, MVP-AC-09, and MVP-AC-10 (partial); Functional Specification sections 9 and 19.1-19.3, 19.5-19.7 as selected by the MVP; Technical Specification sections 7.3, 10.3, and 12.

### Phase 15 - Destruction, insurance settlement, and recovery

**Outcome:** Loss has its specified consequences and the campaign always retains the scoped recovery route.

**Implement:**

- Add the atomic player-destruction transaction, survival rolls, player wreck, recovery location, insurance settlement/consumption, loss-record capture, and restricted recovery-asset provenance.
- Add player-wreck access to the mapless encounter-selection flow without introducing a system map.
- Build the loss report, insurance/recovery feedback, and post-loss station state.
- Connect destruction to mandatory autosave and verify that recovery restrictions survive every included inventory/fitting operation.

**Contracts and persistence:** Add destruction/loss/recovery schemas. Migrate player wreck/bookmark-equivalent destination data, loss records, insurance consumption, recovery eligibility, and restricted provenance.

**Tests and exit gate:** Property and state-machine tests cover independent survival rolls, ownership conservation, insurance, repeated recovery, non-exploitable restricted assets, and inaccessible-state prevention; browser acceptance destroys the player, reloads, recovers, and completes the easiest encounter again.

**Traceability:** MVP-AC-08; Functional Specification sections 5.4, 9.12, and sections 22.1, 22.3, 22.7, and 22.9; Technical Specification sections 8.3, 10.9, 11, and 15.

### Phase 16 - Full encounter set and progression content

**Outcome:** All scoped content is implemented and the campaign can progress from the starting fit through the mastery encounter without hidden gating.

**Implement:**

- Finalize the MVP catalog, NPC profiles, encounter definitions, loot tables, bounties, market availability, and reward summaries required by MVP Scope section 4.
- Make the scoped encounters exercise the selected AI/movement/range pressures using existing engine capabilities; add no deferred combat mechanic to create variety.
- Add headless scenario fixtures representing starter, intermediate, and suitable mastery fits.
- Add content diagnostics that make progression failures attributable to data rather than opaque browser runs.

**Contracts and persistence:** Content-version changes retain stable IDs. Supply a content transition or migration fixture for any previously persisted definition that changes structurally; balance-only edits use installed current values for future calculations as specified.

**Tests and exit gate:** Content validation proves all MVP references and starter reachability; headless scenarios complete all three encounters with their intended representative fits and verify repeatability; browser acceptance covers the multi-opponent site and advancement to the mastery site.

**Traceability:** MVP-AC-05, MVP-AC-07, and MVP-AC-09; Functional Specification sections 8, 9.10-9.11, 18, and 21 only to the extent selected by MVP Scope sections 3-4; Technical Specification sections 6, 10.2-10.4, 15.1-15.2, and 18.

### Phase 17 - Balance and progression pass

**Outcome:** The authored data satisfies the scoped progression and recovery goals under repeatable simulation before subjective playtesting.

**Implement:**

- Build deterministic balance simulations and concise reports for the starting wallet, upgrade cadence, resupply/repair pressure, loss recovery, and representative encounter outcomes identified by MVP Scope sections 4.3 and 9.
- Tune only authored values: prices, statistics, rewards, stock, costs, drop weights, and encounter composition/positioning.
- Fix engine or UI defects exposed by the simulations, but route any rule change back through the authoritative documents before implementation.
- Record the candidate tuning bundle and fixture seeds used for release-candidate comparison.

**Contracts and persistence:** Prefer balance-only content updates. Any structural change must carry its content compatibility fixture in this phase.

**Tests and exit gate:** Deterministic scenario bands meet every objective in MVP Scope section 4.3; poor-purchase and loss-recovery fixtures remain viable; no representative fit is universally dominant across the scoped encounters; the full headless suite and progression browser flow pass.

**Traceability:** MVP-AC-05, MVP-AC-07, MVP-AC-08, and MVP-AC-09; MVP Scope sections 4.3 and 9; Technical Specification sections 6, 9.5, 15, and 16.

### Phase 18 - Contextual onboarding, explanations, notifications, and audio

**Outcome:** A first-time player can discover the entire selected loop and understand important results without external instructions.

**Implement:**

- Add the scoped contextual guidance as declarative objective/content state, with skip/resume behavior only where selected by the MVP.
- Complete formula, comparison, failure-cause, and unavailability explanations for all included commands and station decisions.
- Add semantic notification generation/grouping and the applicable visible/audible cues for combat, opportunity/completion, warnings, danger, and save integrity.
- Add the corresponding notification, onboarding, and audio-cue content schemas and validated definitions.
- Add the event summaries needed for diagnosis without turning the interface into a raw combat log.

**Contracts and persistence:** Add onboarding, semantic-notification, and preference contracts. Migrate campaign-owned onboarding progress and bounded notification/event history; keep audio visibility/volume preferences outside campaign snapshots.

**Tests and exit gate:** Objective tests prove no onboarding dead end or duplicate grant; component tests cover explanation substitutions and notification grouping; a clean-profile Playwright flow follows in-game guidance through the easiest complete loop without test-only knowledge.

**Traceability:** MVP-AC-04 and MVP-AC-10; Functional Specification sections 3.2 as selected by the MVP, 19.3, 19.6-19.7, and applicable section 20 behavior; Technical Specification sections 10.6, 12.3-12.5, and 15.

### Phase 19 - Accessibility, input, and presentation hardening

**Outcome:** Every included flow meets the MVP's mouse, keyboard, scale, contrast, motion, focus, and non-color communication requirements.

**Implement:**

- Finish remappable action bindings and local preference storage for UI/text scale, contrast, reduced motion, audio, and confirmations needed by the selected surfaces.
- Audit and correct focus order/return, modal behavior, pointer targets, keyboard reachability, screen-reader names, semantic landmarks, and text expansion.
- Complete shape/icon/label distinctions and high-contrast treatments for selection, hostility, ownership, danger, damage, fitting validity, and notifications.
- Ensure pause and emergency controls remain available while other requests are pending.

**Contracts and persistence:** Add preference-version migration in `localStorage` if needed; campaign snapshots remain unchanged unless an authoritative defect is found.

**Tests and exit gate:** Automated accessibility checks and scripted keyboard-only and mouse-only runs cover every MVP surface at required scales/themes/motion settings; focus assertions cover all dialogs; visual-state tests verify that color is never the sole cue.

**Traceability:** MVP-AC-02, MVP-AC-03, MVP-AC-08, and MVP-AC-10; Functional Specification sections 19.1-19.7 and 20 as selected by the MVP; Technical Specification sections 12 and 15.1.

### Phase 20 - Save, replay, invariant, and traceability closure

**Outcome:** The feature-complete implementation is demonstrably deterministic, durable, and traceable across the complete loop.

**Implement:**

- Audit every authoritative field and scheduled action introduced since Phase 4 against snapshot schemas, canonical serialization, invariants, migrations, content compatibility, and projection reconstruction.
- Add golden saves at representative station, travel, combat, wreck, post-destruction, and completed-progression states.
- Complete deterministic command/delta replays and full-campaign invariant/property runs for the selected systems.
- Finalize the machine-readable traceability source and generate a report mapping every MVP acceptance ID and applicable normative section to engine modules, content, projections, and tests.
- Bound logs/history and verify performance against the authored MVP maxima.

**Contracts and persistence:** Close the MVP protocol/save versions and migration chain; no unchecked optional or unversioned fields remain.

**Tests and exit gate:** Rotation behavior used internally, atomic write failure, checksum/corruption, quota, unsupported/newer version, content mismatch, migration, reload at each golden state, and full replay all pass. The generated traceability report has no uncovered included requirement.

**Traceability:** MVP-AC-01 through MVP-AC-10; Functional Specification sections selected by `MVPScope.md`; Technical Specification sections 5, 7, 9.5, 11, 13-16, and 18.

### Phase 21 - Release-candidate and product-playtest gate

**Outcome:** A reproducible offline MVP candidate is ready for the human decision required by MVP Scope section 9.3.

**Implement:**

- Run the full content, unit, property, state-machine, replay, component, accessibility, and browser suites against the production bundle.
- Verify current Chromium-based browsers and Firefox, offline startup/play after the build is locally available, and absence of gameplay network requests.
- Run the complete new-campaign-to-mastery flow, destruction/recovery flow, and close/reopen checkpoints against a clean browser profile.
- Produce a concise release-candidate report containing build/content/save/protocol versions, automated results, known non-blocking issues, balance fixture summary, and the human playtest script tied to the product question.
- Fix only release-blocking defects that remain within one session. If more work is required, create a narrowly scoped remediation phase and rerun this gate afterward.

**Contracts and persistence:** Freeze candidate versions. A release-blocking contract change invalidates the candidate and returns to Phase 20 verification.

**Tests and exit gate:** MVP Scope sections 9.1 and 9.2 pass in full. The candidate is then handed to the human operator for the section 9.3 playtest. The MVP is not declared complete until that human result is recorded. Failed product acceptance produces one or more new session-sized tuning/usability phases; it does not silently expand the MVP.

**Traceability:** MVP-AC-01 through MVP-AC-10, MVP Scope section 9, and the applicable Technical Specification completion criteria in section 19.

## 5. Acceptance ownership

This table identifies the phases that establish each MVP acceptance criterion and the later phase that closes its release evidence.

| Acceptance ID | Establishing phases | Release closure |
|---|---|---|
| MVP-AC-01 | 3-4, 8 | 20-21 |
| MVP-AC-02 | 5-8, 14 | 19-21 |
| MVP-AC-03 | 9-12, 14 | 19-21 |
| MVP-AC-04 | 6, 11-12, 14, 18 | 20-21 |
| MVP-AC-05 | 13, 16-17 | 20-21 |
| MVP-AC-06 | 5, 7, 13-14 | 20-21 |
| MVP-AC-07 | 16-17 | 20-21 |
| MVP-AC-08 | 9-10, 15, 17 | 19-21 |
| MVP-AC-09 | 13-14, 16-17 | 20-21 |
| MVP-AC-10 | 14, 18-19 | 20-21 |

## 6. Deliberate non-work

The plan does not create placeholder screens, commands, schemas, persistence fields, or content for capabilities listed in MVP Scope section 8. General-purpose mechanisms may use extensible discriminated unions or registries where the technical specification requires them, but only MVP cases are implemented and tested. This keeps each session bounded and prevents speculative work from becoming an accidental dependency of the selected loop.
