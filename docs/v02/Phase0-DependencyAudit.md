# v0.2 phase 0: dependency audit

**Prepared:** 2026-11-14, v0.2 implementation plan phase 0 item 3. **Audience:** agents implementing phases 1-7.

This lists the MVP assumptions that the v0.2 slice (FeatureSpec02) invalidates, where each one lives, and the phase that removes it. Paths are current as of this audit; check them again when you start a phase.

## 1. One active ship

| Assumption | Where | Status |
|---|---|---|
| Station surfaces show and act on the active ship only | `src/ui/station/FittingPanel.tsx`, `HangarPanel.tsx`, `ShipPanel.tsx`, `ServicesPanel.tsx`, `MarketPanel.tsx` (buy destination, sell sources) | **Phase 1, done:** fitting and hangar choose any local ship; ships list and comparison added (`ShipsPanel.tsx`); services name their ship. The market still sells from the hangar and the active ship's hold only, which is intended. |
| `usePlayData` reads ship projections for the active ship only | `src/ui/frame/usePlayData.ts` | **Phase 1, done:** `ships` (`ships.list`) and `fittingShip` added. |
| No command switches ships, so the active ship changed only through recovery or a shipless purchase | `src/engine/application/economyCommands.ts` (`addPurchasedHull`), `src/engine/simulation/loss.ts` | **Phase 1, done:** `ship.activate` (`src/engine/application/shipCommands.ts`). |
| Service previews accept any ship ID | `src/engine/projections/economy.ts` (`requireShip`) | **Phase 1, done:** player ships only; a switch makes previews stale through the asset version. |
| Combat, navigation, encounter, guidance, and notifications read `assets.activeShipId` | `src/engine/simulation/{encounter,guidance,loss,navigation,notifications}.ts`, `src/engine/domain/{combat/state,encounter/*,navigation/*}.ts` | **Correct as is:** only the active ship is ever in space. No change needed. |
| The ammunition suitability in the market reflects the active ship's committed fit | `src/engine/projections/economy.ts` (`suitabilityOf`) | **Keep.** It is about the ship the player flies. Phase 2 adds family/size compatibility. |

## 2. Turret-only weapons

The module union (`src/engine/ports/content/definitions.ts`, `MODULE_CATEGORIES`) has `turret` as the only weapon category. Code that branches on `category === 'turret'` or treats "weapon" as "turret":

- attributes: `src/engine/domain/attributes/shipAttributes.ts`;
- combat: `src/engine/domain/combat/{availability,state}.ts`, `src/engine/simulation/combat.ts` (instant damage at cycle end);
- fitting: `src/engine/domain/fitting/{apply,fit,summary,validity}.ts`;
- recovery: `src/engine/domain/recovery/{grant,report,rules}.ts` (starter value counts turret magazines only);
- projections: `src/engine/projections/{combat,comparison,economy,ship}.ts`;
- encounter AI and guidance: `src/engine/simulation/{encounter,guidance}.ts`;
- UI: `src/ui/station/FittingPanel.tsx`, `src/ui/space/WeaponsPanel.tsx`.

**Phase 3** adds a `launcher` category with its own magazine, reservation and projectile path. Every branch above must either handle launchers or deliberately exclude them. Hardpoints already distinguish `turret` and `launcher` (`HARDPOINT_KINDS`), and phase 1 gave every player hull launcher hardpoints.

## 3. A single NPC ammunition choice

`NpcProfileDefinition.loadout` has one optional `ammunitionId` and one `reserveRounds` (`definitions.ts`; `schemas/content/npc.profiles.schema.json`). The encounter installer loads that one charge into every weapon (`src/engine/simulation/encounter.ts`), and semantic validation checks reserve rounds against that one charge (`scripts/lib/content/semantic.mjs`, `checkReserveRounds`). **Phase 3** must allow ammunition per weapon group (turret and launcher groups differ) and validate each group's reserve.

## 4. Three destinations

- Content: `content/encounters/templates/borrell.json` (3 templates), `content/universe/systems/borrell.json` (3 combat sites).
- The floor validator required exactly tiers 1, 2 and 3, one encounter each (`scripts/lib/content/floor.mjs`). **Phase 0, done:** it now requires tiers 1-3 to be covered and no other. The release profile requires four per tier.
- Destination UI lists every destination without grouping (`src/ui/space/DestinationChooser.tsx`). **Phase 5** adds band grouping and filtering.
- Browser and balance tests name the three sites (`tests/support/encounter.ts`, `tests/support/destinations.ts`, `tests/integration/balance`, `tests/integration/progression*.test.ts`). **Phase 5** revises Scout, Patrol and Base, and these fixtures move with them.

## 5. Module category switches

Exhaustive `switch` statements over `ModuleDefinition['category']` decide each module's modifiers and behaviour:

- `src/engine/domain/attributes/shipAttributes.ts` (modifier registry);
- `src/engine/projections/comparison.ts` (comparison rows);
- `src/engine/simulation/notifications.ts` (starvation triggers).

Content schema `schemas/content/modules.schema.json` is a discriminated union over the same categories. **Phases 2-4** add the shield extender, shield recharge, capacitor recharge, damage enhancers, tracking and guided-application enhancers, launchers and the web. Each needs a schema branch, a TypeScript union member, a modifier operator registered in `shipAttributes.ts`, comparison rows, and semantic validation that rejects an unsupported operator and category combination.

## 6. Content counts and floors

| Check | Where | Status |
|---|---|---|
| Exactly one player-usable hull | `scripts/lib/content/floor.mjs` | **Phase 0, done:** replaced by the v0.2 lineup check: exactly frigate, destroyer and cruiser, each sold at the starting station. |
| Every player-usable hull fixed-price at every neutral station | `scripts/lib/content/semantic.mjs` (`checkStarterReachability`) | **Phase 1, done:** narrowed to the starter hull, the actual recovery guarantee. The other hulls restock as dynamic listings. |
| MVP floor applied unconditionally | `floor.mjs` | **Phase 0, done:** profiles. The manifest declares `contentFloor`. The shipped content declares `v0.2-phase-1`, and `npm run validate:content -- --release`, as the release gate runs it, accepts only `v0.2-release`. |
| Release quantities (26 modules, 16 ammunition, 10 NPC profiles, 12 sites with 4 per tier, 10 droppable modules, every module and charge purchasable) | `floor.mjs`, `checkReleaseFloor` | **Phase 0, done:** counts enforced by the release profile. Size, family, archetype, launcher and medium-drop coverage join that check in phases 2-5, as the fields they need exist. |
| Traceability registry: MVP IDs only | `config/requirements.json`, `scripts/lib/traceability.mjs` | **Phase 0, done:** `V02-AC-01` to `V02-AC-15` recorded. A criterion is `planned` until its phases finish, then `included`. `FUNC-6.3` is now included (local switching, with transport still deferred). |

## 7. Versions and contracts

| Contract | Before | Now | Notes |
|---|---|---|---|
| Engine | 0.1.0 | 0.2.0 | `src/engine/application/version.ts` |
| Protocol | 18 | 19 | Adds `campaign.saves` compatibility, `ship.activate`, and `ships.list`. `schemas/protocol/client-request.schema.json` and `ships.list.data.schema.json`. |
| Save format | 10 | 11 | `src/engine/ports/persistence/saves.ts`, `schemas/save/save-envelope.schema.json`. Formats below 11 are refused (ADR-V02-01). |
| Campaign state | 10 | 11 | `src/engine/domain/campaign/state.ts`, `schemas/save/campaign-state.schema.json`. |
| Content | 0.1.0 | 0.2.0 | `content/manifest.json`, with `compatibleContentVersions` and `contentFloor`. |
| Hull schema | - | `hullClass` and `moduleSizes` required | `schemas/content/hulls.schema.json`. Fitting enforcement of sizes is phase 2. |

The contract lock (`tests/fixtures/contracts/lock.json`), golden saves (`tests/fixtures/saves/golden/*`), golden replay and balance candidate are re-recorded through their scripts whenever these change.
