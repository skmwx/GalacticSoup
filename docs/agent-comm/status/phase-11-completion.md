# Phase 11 completion note — Targeting, turret, ammunition and reload engine

Status: complete. Date: 2026-09-21.

Implements Phase 11 of `docs/MVPImplementationPlan.md`. The headless engine can now lock a target,
open fire under the authoritative turret formulas, commit and release the costs a cycle takes,
reload or change ammunition, and give up a lock cleanly when the target leaves or the range opens.
Two ships in one site can do all of it at once and exchange fire.

This is an engine phase. Nothing in `src/ui` changed: the combat surfaces are Phase 14, and Phase 10
left a handoff naming exactly which Functional Specification 19.3 values needed the engine functions
this phase adds. They are now published by `combat.state`.

## Delivered

### Domain — `src/engine/domain/combat/`

- `formulas.ts` holds lock time, relative motion, turret accuracy and shot variation as pure
  functions of plain numbers. They read no state, take no draw and reach no content lookup, and each
  returns the `FormulaTrace` that produced it, so a projection can explain a hit chance rather than
  assert one. `FormulaOperand`/`FormulaTrace` moved to `src/engine/domain/formula.ts` so combat and
  the economy quotes share one declaration.
- `types.ts` declares the runtime: a lock, a weapon cycle, a reload and the pending reload a cycle
  defers. Every one of them names the scheduler entry that will resolve it, so cancelling an action
  cancels its own boundary and nothing else the ship has queued.
- `state.ts` reads and changes that runtime. `combatantOf(state, content, shipId)` resolves any ship
  present in the loaded site; `activeCombatant` is that function applied to the player's ship. The
  runtime is pruned whenever it stops saying anything, so a docked campaign stores no combat state
  and hashes like one that has never fired.
- `availability.ts` holds one predicate per command, in the shape Phase 10 established for
  navigation: each returns the refusal the command itself would return, or `null`.
- `validation.ts` checks shape and consistency: locks belong to ships in the site, name objects that
  exist and are not the ship itself, and agree with their boundaries; a cycle names a locked target;
  a weapon is never cycling and reloading at once; every ammunition id resolves.

### Simulation — `src/engine/simulation/combat.ts`

Three boundary kinds — `combat.lockComplete`, `combat.weaponCycle`, `combat.reloadComplete` — and
one continuous system that evaluates lock range and target presence after movement is integrated.
Priorities order a cycle before a lock completion and a reload after both, so two actions due at the
same millisecond always resolve in the same order.

Every operation names the ship it acts on rather than assuming the player, because Technical
Specification 10.3 requires an opponent to issue the same module commands through an AI adapter. The
Phase 13 adapter calls `beginLock`, `activateWeapon` and the rest directly, exactly as the command
handlers do.

Behaviour worth naming:

- A cycle start spends its capacitor and reserves one round; the shot consumes the round at the end
  of the cycle. A lost lock or a vanished target between the two leaves the round loaded and does
  not refund the capacitor (Functional Specification 9.4, 22.11).
- Re-aiming a weapon that is mid-cycle abandons that cycle on the same terms. Deactivating does not:
  the running cycle finishes and no further one starts (Functional Specification 9.4).
- A lock attempt recomputes its lock time when its boundary fires and reschedules the remainder if
  the current scan resolution or target signature says it is not finished, which is what
  "the lock-time preview updates if either changes" asks for.
- A lock is dropped after two consecutive seconds beyond maximum lock range, and immediately if the
  target leaves the site. Weapons aimed at it stop and say why.
- An empty magazine reloads itself from cargo while compatible rounds remain, and reports
  `ammunitionExhausted` only when none do. A reload asked for during a cycle is recorded and begins
  when that cycle completes.
- One shot draws from the `combat` stream in a fixed order: the hit roll, then the critical roll,
  then the variation a critical replaces. A miss takes one draw. A refused command takes none,
  because the transaction discards the draft it would have drawn from.

Warp departure and docking clear the ship's combat runtime and its queued boundaries, so a campaign
never carries a lock out of the site it was made in.

### Application, protocol and projections

- `src/engine/application/combatCommands.ts` handles `targeting.lock`, `targeting.unlock`,
  `weapon.activate`, `weapon.deactivate`, `weapon.reload` and `weapon.changeAmmunition`. Each asks
  the shared predicate first, so the projection and the handler cannot disagree.
- `combat.state` publishes locks with their progress and lock-time trace, relative motion against
  every ship in the site, and per-weapon runtime: magazine, cycle, reload, stop reason, compatible
  cargo ammunition, and effectiveness against each locked target with the hit-chance trace.
- `navigation.site` object entries now also carry `targeting.lock` and `targeting.unlock`
  availability, because the object list is where a target is chosen.
- Ten semantic combat events (`combat.lockStarted` through `combat.shotResolved`) join the domain
  event kinds. A resolved shot carries its four raw damage components; applying them to the
  defensive layers is Phase 12, so nothing here writes to a target.

## Contracts and persistence

Protocol version is **8**: six commands, one query and the two extra availability entries on a site
object. `schemas/protocol/combat.state.data.schema.json` is new; the request schema gained the
payload definitions and the request-type entries.

Campaign state and save format are **6**. `CampaignState.combat` is new, the published state schema
describes it, and `tests/fixtures/saves/format-6.json` is the regenerated golden artefact. As in
Phase 9, no migration ships: nothing has been released, so a development save at format 5 is
rejected and a new campaign started. The migration runner is still exercised against a fixture
registry, which now chains through the 5 → 6 boundary.

## Content

No content change was needed. The two authored turrets and four charges already cover the scoped
short-range and long-range choices with two damage profiles, and every constant the formulas use was
already authored in `content/rules/combat.json`.

## Exit gate

- `npm run verify` passes: type checking, architecture checks, content validation, **953 unit
  tests**, **79 integration tests**, **61 component tests**, traceability and the production build.
- `npx playwright test` passes **36** browser and accessibility tests unchanged.
- Traceability reports **98 requirement ids**, all covered by tests.
- New suites: `tests/unit/engine/combatFormulas.test.ts` (19 cases against the authoritative
  expressions and their boundaries), `tests/unit/engine/combat.test.ts` (31 state-machine cases),
  `tests/unit/engine/combatPersistence.test.ts` (snapshot round trip, invariants and vocabularies),
  `tests/integration/combat.test.ts` (the contracts over the engine host).
- `tests/support/combat.ts` builds the loaded site the state-machine tests need: the player's ship
  and one test-target ship, both ordinary ships with ordinary fits, so they exercise exactly the
  code an authored opponent will.

## Decisions worth reviewing

**The magazine is the reserve location for weapon ammunition.** Technical Specification 8.3 says
committed weapon ammunition moves into an explicit reserve location rather than being flagged in
place. Loading a magazine already does that: the rounds leave cargo and become a `charge` stack in
the ship's fitting store, dedicated to one slot. The single round a cycle holds back is recorded on
the cycle as `reservedRounds` instead of being split into a second reserve inventory, because that
inventory would be created and destroyed once per shot and would allocate two entity ordinals every
2.5 seconds for no gain in safety — the cycle owns that magazine exclusively, so the round cannot be
used twice. The commitment is still explicit, which is what Technical Specification 10.3 asks for.
This is recorded as a question in `docs/agent-comm/requests/questions-and-answes.md`; it is not
blocking.

**`client-request.schema.json` was reformatted.** The file mixed one-line and expanded JSON objects;
regenerating it expanded the one-line ones. The contract is unchanged and the parity test compares
it against the runtime validator case by case.

## Handoff to Phase 12

- Damage application hangs off `combat.shotResolved`. `resolveShot` already produces the four-component
  raw vector and the outcome record (`ShotOutcome`); Phase 12 routes it into layer application
  instead of only publishing it, and adds the staging that Technical Specification 9.2 steps 4-6
  describe so a destruction at one timestamp cannot cancel another completion due at the same one.
- Capacitor is spent but never regenerates yet. `startNextCycle` already stops a weapon with
  `insufficientCapacitor`, so recharge should make that path rare rather than replace it.
- The common module lifecycle Phase 12 needs is the one in `src/engine/simulation/combat.ts`:
  `startNextCycle` and `beginReload` are written against `weaponContext`, which is turret-specific
  only in where it reads its cycle time and cost. A shield booster or an armour repairer wants the
  same cycle record with a different effect at the end of it.
- `WeaponState.stopReason` and the `combat.*` events are the input the notification and loss-report
  phases will aggregate; the bounded combat recorder of Technical Specification 10.3 is not built
  yet, deliberately.
- `combat.state` already publishes defensive-layer-free values only. Phase 12 adds layers,
  resistances and endurance to it rather than to a second projection.

No open questions that block work.
