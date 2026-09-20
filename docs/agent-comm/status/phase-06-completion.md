# Phase 6 completion note — Starter fit and derived-attribute domain

Status: complete. Date: 2026-09-20.

Implements Phase 6 of `docs/MVPImplementationPlan.md`. This establishes MVP-AC-02 and the
explanation half of MVP-AC-04; their complete player flows remain assigned to Phase 8 and later.

## Delivered

### Fitted modules are physical units, not copies

Each ship now owns a third inventory beside its cargo hold: a **fitting store**
(`{ kind: 'fitting', shipId }`, unlimited capacity). A fitted module is the same physical stack
that sat in the hangar, moved into that store and carrying what it is doing:

```
state: { kind: 'plain' }
     | { kind: 'fitted', slot: { kind, index }, online }
     | { kind: 'charge', slot: { kind, index } }
```

Two stacks merge only when their definition **and** their state match, so a module in one slot can
never be confused with the same module in another, and no unit exists in two places
(Functional Specification 22.3). Reading a fit (`shipFit`) therefore cannot disagree with the
inventory: there is nothing to keep in step.

A fitting store is not a local inventory, so `inventory.transfer/split/merge` cannot reach into a
slot; fitting changes go through the fitting commands. `inventory.split` additionally refuses a
non-plain stack (`stackNotDivisible`): a magazine belongs to its weapon.

### The fitting draft

`src/engine/domain/fitting` owns slots, fits, constraints, the summary, the planner and the
applier. `CampaignState.fitting` holds the open draft and is authoritative, so closing the game
with one open finds it waiting.

| Command | Effect |
|---|---|
| `fitting.begin` | Opens a draft copied from the fit the ship wears. Idempotent per ship. |
| `fitting.set` | Replaces one slot (module, online, optional charge). |
| `fitting.clear` | Empties one slot. |
| `fitting.revert` | Discards the draft; the ship is untouched. |
| `fitting.commit` | Performs every move at once, or refuses and changes nothing. |

The draft names **definitions, not stacks**. Which unit supplies a slot is decided by the planner
when the draft is previewed or committed, so a purchase or a transfer while the draft is open
cannot invalidate it. A preview is the commit run against a copy of the assets
(`previewDraft`), which is how Functional Specification 22.4 is satisfied without a preview token:
the draft *is* the preview, and a commit that would fail says so before it is attempted.

Committing moves what the plan wants out of the station hangar or the ship's own hold, returns
what it no longer wants to the hangar, and loads up to a magazine of charges. An item the plan
needs but the player no longer has is reported (`fittingItemsMissing`) rather than half-applied.

**Structural versus resource violations.** A change that could not physically exist — a module in a
slot the hull lacks, a launcher on a turret hardpoint, a charge in a weapon that does not take it —
is refused when it is made, with the constraint it breaks as its message key
(`fitting.violation.<code>`). A fit that merely over-commits power or processing is allowed to
exist and blocks undocking instead, because Functional Specification 8.4 expects the fitting screen
to show violated constraints on a fit the player can keep and correct. The campaign invariant
enforces the structural set only.

### The derived-attribute pipeline

`src/engine/domain/attributes` is the single pipeline of Technical Specification 10.2: hull base,
flat modifiers, fitted percentages grouped by direction and diminished at 100/87/57/28/10%,
undiminished intrinsic modifiers, clamps, trace. Ordering inside a stage is total (magnitude, then
source id), so the same fit always derives the same number and the same explanation.

Content declares modifiers, never expressions. Three reviewed operators exist: `add`, `percent`
and `resistance` (a bonus removes its share of the damage that still gets through, a penalty scales
the resistance down; both stay inside the 0-90% clamp without a special case). A module category is
a closed engine enumeration, so adding a tuning value never touches engine code and adding a
category is a deliberate change.

Every derived value carries the trace that produced it — base, each source, its stacking
multiplier, the magnitude actually applied and the running result — which is what
Functional Specification 4.4 and 19.6 require of an explanation.

### Ship condition

`ShipIdentity` gained `fittingInventoryId` and `condition`: damage **lost** per layer (not hit
points remaining, so a refit cannot silently heal or destroy a ship) and the current capacitor
charge. A commit clamps both to what the new fit derives and applies the derived cargo capacity to
the hold, refusing rather than discarding when the hold would no longer fit its contents.

### Content

`content/rules/economy.json` gained `startingFit`, and the starter grant is now one autocannon, one
shield booster and 60 fusion rounds. Campaign creation assembles that fit through the same planner
a player uses, from the same granted items, so a starting fit that could not be built by hand
cannot be conjured either. Semantic validation refuses a starting fit that names an unknown module,
uses a slot or hardpoint the starter hull lacks, mismatches an ammunition group, exceeds the hull's
power or processing, or uses an item the starting items do not supply.

The starter hull's fitting budget was reduced from 42/145 to **24 power / 70 processing**. At 42
power nothing in the catalogue could ever exceed the grid, so the fitting constraint never bound
and the rule was untestable through content. At 24/70 a short-range fit can run everything while a
twin-railgun fit cannot, which is the trade-off MVP Scope 4.1 asks for. These remain provisional
tuning values that Phase 17 owns.

## Contracts and persistence

Protocol, campaign-state and save-format versions are all **3**. New requests:

| Request | Purpose |
|---|---|
| `ship.get` | Hull, every slot, fitting resources, derived stats with traces, condition, weapons, defence, capacitor, violations, warnings, undock validity |
| `ship.undockValidity` | Whether the ship may leave, and why not |
| `fitting.draft` | The open draft, what it is missing, and the ship it would produce |
| `fitting.begin` / `set` / `clear` / `revert` / `commit` | The draft state machine |
| `item.compare` | Two catalogue entries, grouped by purpose and direction |

Schemas (`schemas/protocol/fitting.common`, `ship.get`, `ship.undockValidity`, `fitting.draft`,
`item.compare`, plus the extended `assets.common` and `client-request`), the runtime validator,
localization keys, invariants and the golden save moved together.
`tests/fixtures/saves/format-3.json` is the new golden artefact. The format-1 and format-2 fixtures
are retained as rejection cases; no pre-release migration is owed under MVP plan section 2, rule 7,
and the migration runner stays covered by fixture registries that now chain two steps.

Campaign invariants gained Technical Specification 15.3 check 6: one module per slot, a charge only
where a weapon holds it, a fitted stack only in a fitting store, structural fitting rules, and
stored condition inside what the fit derives. No MVP item has a skill requirement, so the skill
half of check 6 is a deliberate absence rather than an assumption.

Fitting does **not** request an autosave. Functional Specification 3.4 lists the triggers and a
fitting change is not among them.

## Exit gate

All checks passed:

- `npm run verify`: type checking, architecture boundaries, content validation, **714 unit tests**,
  **60 integration tests**, **20 component tests**, traceability and production build.
- `npm run test:browser`: **11 tests**, including the starting fit persisted through the real
  worker and IndexedDB.
- `npm run test:accessibility`: **7 tests**.
- Traceability: **74 requirement IDs**, all claimed requirements covered.

Formula tests cover modifier ordering, separate bonus and penalty stacking, the sixth modifier
having no effect, intrinsic modifiers staying undiminished, clamping, final-step flooring,
conditional assumptions and trace contents. State-machine tests cover open, edit, clear, revert,
commit, re-open, an unchanged edit, every structural refusal, a storable power overrun corrected by
taking a module offline, an atomic refusal when an item is missing, and condition clamping.
Integration tests run the whole flow over both transports, through a close and reopen, with
matching replay hashes and a draft that survives the round trip.

## Handoff to Phase 7

- Economic commands must combine their wallet and item changes in **one** campaign transaction and
  publish the matching invalidations, including `ship` and `fitting` when a purchase changes what a
  draft can be committed with.
- `item.compare` already answers "which of these two is better"; a market screen can reuse it for
  quote comparison rather than adding a second comparison path.
- Repair will want `ShipCondition.damage`, which is stored as hit points lost per layer, and the
  derived maxima from `deriveShipAttributes`. Insurance will want `HullDefinition.referenceValueCredits`
  and `insuranceClass`.
- Preview tokens (Technical Specification 7.4) are **not** implemented. Fitting did not need them
  because the draft is the preview; market, repair and insurance transactions do need them, and
  Phase 7 owns introducing that mechanism.
- `createCampaignSession` in `@gateway` answers an autosave trigger only for the campaign commands
  it wraps. When Phase 8 sends gameplay commands through the gateway directly, route their results
  through the same handler so a trigger is not dropped.
- The starter hull budget and the starting grant are provisional. Phase 17 owns the balance pass.

No open questions or new dependencies.
