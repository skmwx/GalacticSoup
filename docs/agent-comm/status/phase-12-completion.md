# Phase 12 completion note - Damage, defenses, capacitor, and module operation

Status: complete. Date: 2026-09-21.

Implements Phase 12 of `docs/MVPImplementationPlan.md`. The complete included player combat model
now runs headlessly: turret hits apply four-component damage through shield, armour, and hull;
shield and capacitor regenerate continuously; active modules pay, wait, cycle, and stop under the
same lifecycle; passive resistance and capacitor support remain derived fitting effects; and hull
depletion becomes deterministic destruction only after every committed completion at that
timestamp has resolved.

This remains an engine phase. The Phase 14 combat interface can consume the expanded
`combat.state` contract without reproducing combat arithmetic in the UI.

## Delivered

### Damage, defenses, and regeneration

- `src/engine/domain/combat/damage.ts` contains pure formulas for layered damage, repair,
  regeneration, and all-or-nothing capacitor payment. All four damage components cross a depleted
  layer in the same proportion, then meet the next layer's own resistances. Resistances and pools
  are clamped at their specified bounds.
- Resolved shots now update authoritative ship condition, publish `combat.damageApplied`, and add a
  significant damage record. Hull reaching zero is detected after the entire same-time completion
  batch, so simultaneous ships can destroy each other without entity iteration order deciding the
  exchange.
- Shield and capacitor regenerate linearly in simulation time, including in warp. Armour and hull
  do not regenerate naturally. Capacitor payments and regeneration update a persisted recent trend
  used by the tactical projection.
- The scheduler now gives the simulation an explicit zero-length pass after the last completion at
  a timestamp. Combat uses it to finalize destruction and start eligible next cycles after every
  already-committed completion has resolved. Continuous systems are not re-run between entries at
  the same timestamp.

### Common active-module lifecycle

- `module.activate` and `module.deactivate` operate the selected propulsion, shield-booster, and
  armour-repairer modules. Cycle cost is committed at the start; a paid cycle completes after
  deactivation; and a repeating module that cannot pay waits without partial payment until recharge
  reaches the full cost.
- Propulsion contributes its derived movement modifier only while a paid cycle is active. Repair
  modules restore their listed layer at cycle completion without exceeding its maximum. Repair
  completion has stable priority before damage due at the same timestamp.
- Destroyed ships cannot accept combat commands. Destruction cancels their pending locks, reloads,
  weapon cycles, and module cycles, and drops locks held on them only after the committed batch.
- Passive armour resistance and capacitor batteries continue through the shared attribute pipeline;
  the tactical projection identifies them as passive and exposes their derived effects and traces
  without activation commands or capacitor use.

### Tactical projection and recorder

- `combat.state` now publishes the player's and known target defensive layers, current and maximum
  hit points, all twelve resistances, destruction state, and calculation traces.
- Capacitor data includes current charge, capacity, recharge, recent net change, projected repeating
  use, projected net change, stability, endurance, and explanation traces.
- Every fitted non-weapon module has status, cycle progress, committed capacitor, stop reason,
  command availability, and a category-specific effectiveness record. Weapon effectiveness remains
  alongside it.
- `src/engine/domain/combat/recorder.ts` keeps at most 128 significant events. Repeated damage and
  repairs within the aggregation window are grouped while every individual completion still emits
  its deterministic semantic domain event. Destruction is retained explicitly for later loss and
  notification work.

## Contracts and persistence

Protocol version is **9**. The request catalogue and JSON schema add `module.activate` and
`module.deactivate`; combat response types and schema add defenses, capacitor, modules, target
defenses, and significant events. Capabilities and health schemas report version 9, and new refusal
reasons have localized messages.

Campaign state and save format are **7**. Ship combat runtime now persists active-module cycles,
waiting state, destruction time, and capacitor trend; combat state persists its event buffer.
`tests/fixtures/saves/format-7.json` is the new sealed golden artifact. No pre-release format has
shipped, so the development policy remains deliberate rejection of older saves rather than a
production migration; the generic ordered migration runner is still tested through the new 6 to 7
boundary.

## Tests and exit gate

- `tests/unit/engine/combatDamage.test.ts` covers proportional spillover, per-component conservation
  across 100 generated samples, clamping, recharge, repair, capacitor payment, event aggregation,
  and recorder bounds.
- `tests/unit/engine/combatModules.test.ts` covers activation, committed cost, repair completion,
  waiting and recharge wake-up timing, deactivation, propulsion lifetime, passive module
  projections, repair-before-damage ordering, applied shot damage, and simultaneous mutual
  destruction.
- `tests/unit/engine/combatPersistence.test.ts` round-trips and resumes an active module in the
  middle of a paid cycle, preserving its boundary, condition, trend, and event result.
- Protocol integration tests operate the starter shield booster and verify the expanded tactical
  state and capability catalogue. Save and schema parity suites cover version 7/9 artifacts.
- `npm run verify` passes: type checking, architecture checks, content validation, **974 unit
  tests**, **80 integration tests**, **61 component tests**, traceability, and the production build.
- `npx playwright test` passes all **36** browser and accessibility tests.
- Traceability reports **99 requirement ids**, all covered by tests.

## Decisions worth retaining

**Destruction is a post-batch transition.** Shot and repair resolvers update condition in stable
completion order, but no resolver immediately destroys a ship. The final continuous-system pass at
that timestamp marks destruction and stops future work. This preserves Technical Specification 9.2
without requiring a second clock or allowing one same-time shot to cancel another.

**Regeneration does not need stored tick boundaries.** It integrates the exact elapsed simulation
interval between scheduler boundaries and fixed quanta. A waiting module starts at the end of the
interval in which full payment becomes available, and its persisted module boundary is sufficient
to resume the paid cycle exactly after reload.

**Development saves remain intentionally unmigrated.** Versions were bumped because the persisted
shape changed, but no public save format exists yet. Format 6 fixtures remain to prove rejection and
format identification; format 7 is the current golden shape.

## Handoff to Phase 13

- NPC ships already use ordinary owned ship state, fits, locks, weapons, defenses, capacitor, and
  module operations. The Phase 13 AI adapter should call the exported simulation operations rather
  than introduce an NPC-only combat path.
- `destroyedAtMs`, `combat.shipDestroyed`, and the significant event buffer are the transition
  inputs for encounter resolution, bounties, loot, loss recovery, and autosave triggers. Phase 12
  deliberately leaves destroyed site objects in place until Phase 13 owns those transactions.
- The bounded recorder has the incoming damage, repair, and destruction foundation needed by later
  notification and loss-report phases. Equipment survival and recovery outcomes belong to their
  owning later phases.
- The authored NPC profiles, encounters, loot tables, and spawn limits were validated in Phase 2
  and remain unchanged. Phase 13 can connect them to this shared lifecycle.

No open questions block Phase 13.
