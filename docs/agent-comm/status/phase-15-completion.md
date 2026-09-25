# Phase 15 completion note - Destruction, insurance settlement, and recovery

Status: complete. Date: 2026-09-25.

Implements Phase 15 of `docs/MVPImplementationPlan.md`. Losing a ship now has the consequences
Functional Specification 9.12 gives it: a wreck with independent survival rolls, recovery at the
most recently docked station, immediate insurance, a loss report and an autosave. The campaign
always keeps the scoped route back to a usable ship, including the restricted last-resort
starter grant. The shipped build demonstrates the full cycle: the player is destroyed, reloads,
recovers the wreck and clears the easiest site again.

## Delivered

### The destruction transaction

`src/engine/simulation/loss.ts` (`advanceLoss`) is a continuous system installed after
`advanceEncounter`, so it resolves in Technical Specification 9.2 step 6. A pilot who destroys the
last opponent in the instant they die still has that completion and bounty settled first. When the
active ship is destroyed in a site, one transaction:

1. freezes the loss report from the combat recorder and the ship's own state: every attacker since
   the encounter began, with hits, damage by type and damage by layer; the last burst that removed
   hit points; and disabling conditions (an active module the capacitor could not pay for, a
   turret with nothing left to load);
2. turns the hull into the player's wreck. Each fitted module and each cargo stack draws one
   survival roll from the `loot` stream (`destructionItemSurvivalChance`, 0.5), in slot order and
   then stack-id order. Loaded ammunition never survives. The wreck lasts
   `playerWreckLifetimeSeconds` (two hours) on its own expiry boundary;
3. abandons the encounter with outcome `lost` (opponents do not follow). It then removes the ship,
   its stores, its combat runtime and every boundary it owned, and unloads the site;
4. docks the pilot at `assets.lastDockedStationId`, the most recently docked accessible station;
5. pays insurance: `floor(hull reference value × 0.30)` basic or `× 0.70` enhanced, which the loss
   consumes. A recovery-grant hull pays 0;
6. checks recovery: it grants a restricted starter ship when one is owed, activates another ship
   already waiting at the station, or leaves the pilot shipless. It records the outcome, publishes
   `recovery.*` events and requests an autosave.

### Recovery and restricted assets

- `src/engine/domain/recovery/` holds the rules as pure functions (`insuranceSettlement`,
  `isFlightReady`, `recoveryGrantDue`, `replacementShipAt`), the grant (`grantRecoveryShip`,
  `ensureRecoveryRoute`), the report builders and validation.
- The grant is the starter hull wearing `rules.economy.startingFit`, with a full magazine in each
  weapon. The hull (`ShipIdentity.recoveryGrant`) and every granted unit (`ItemStack.recoveryGrant`)
  carry the mark.
- The mark travels with the units through split, transfer, fit, unfit, reload, ammunition change,
  looting and a later loss. A marked plain stack merges only with a marked one. A loaded magazine
  is one physical charge, so rounds of either kind loaded into it share a stack, and the result is
  marked. The restriction can spread but never wash out.
- Marked stacks are refused at sale (`market.unavailable.recoveryGrant`). A marked hull is refused
  enhanced cover (`insurance.unavailable.recoveryGrant`) and pays nothing on destruction.
- The pilot may be **shipless** (`AssetState.activeShipId: EntityId | null`), which Functional
  Specification 9.12 requires when they can afford a hull. Buying a hull while shipless makes it
  active.
- A new invariant allows a shipless campaign only while docked, only with no player ship waiting
  at that station, and only while the pilot owns a flight-ready ship elsewhere or holds at least the
  starter hull's reference value. A purchase that would leave a shipless pilot below that value
  triggers the grant then (`ensureRecoveryRoute`), so no committed transaction can strand the
  campaign.

### The player's wreck as a bookmark

- The player's own wreck (`WreckState.owner: 'player'`) is the MVP's automatic bookmark
  (Functional Specification 5.4). Its id is the bookmark id.
- `navigation.selectBookmark` chooses it at the station in place of an encounter; `selectedEncounterId`
  and `selectedBookmarkId` are mutually exclusive.
- `navigation.warpToBookmark` warps to it. The warp stores the wreck's position as an `anchor` and
  arrives the chosen distance short of the wreck rather than the site's centre. At 0 km the ship is
  within wreck access range.
- A wreck that expires clears the selection; a warp already under way keeps its anchor.
- Retreat now heads to `lastDockedStationId`, and docking updates it.
- No system map is introduced. The departure panel and the space warp chooser simply list the
  wreck beside the encounters. Visiting its site meets a fresh instance of whatever is authored there.

### Station and space interface

- **Loss report** (`src/ui/station/LossReport.tsx`): the "Ship lost" region on the hub while the
  loss is the latest outcome; afterwards it stays reachable, collapsed, as "Last ship lost". It shows:
  - where and when the ship was lost;
  - an attacker table with hits, damage types and the layers each attacker broke, and the final
    damage;
  - what had stopped working;
  - lost and surviving items with their origin, and the wreck's live state (stacks left, time
    left, expired);
  - the insurance payout with its substituted formula (Functional Specification 19.6);
  - the recovery outcome with the next step, and a control to choose the wreck as the destination.
- **No-ship notice** (`src/ui/station/NoShipNotice.tsx`): the hub says the pilot has no ship,
  lists the hulls for sale and opens the market. Every panel that needs a ship says so: undock is
  disabled with `error.ruleViolation.noActiveShip`, and fitting, services and the ship panel
  explain why they are empty.
- Other interface changes:
  - the departure panel lists the pilot's wrecks with what waits at their site;
  - the warp chooser offers "Your wreck at <site>";
  - travel status names a bookmark warp;
  - the sortie summary reports `lost`;
  - hangar, cargo, market-sell and ship rows label recovery grants in words.

### Autosave

Autosave requests raised while time advanced were never answered by the client (see Defects). The
play store's `requestAutosave()` now answers them for commands and clock advances alike, with at
most one follow-up save while a write is in flight. A destruction is therefore durable the moment
it resolves.

## Engine and contracts

**Protocol version is 12:**
- the new query is `loss.report` → `LossReportData` (`src/protocol/loss.ts`);
- the new commands are `navigation.selectBookmark` and `navigation.warpToBookmark`;
- `AssetsData.activeShipId` is nullable, and `AssetsData` gains `lastDockedStationId`;
- `ShipAssetData`, `StackData` and `ShipData` carry `recoveryGrant`, and `ShipData` also carries
  `insuranceCoverage`;
- `DestinationsData` gains `bookmarks` and `selectedBookmarkId`;
- warp `TravelStatusData` gains `bookmarkId`;
- `WreckData` gains `owner`, and the sortie outcome gains `lost`;
- the damage events in `combat.state` gain `layerDamage`;
- there are new rule-violation reasons, `bookmarkUnknown` and `noActiveShip`;
- there is a new projection topic, `loss`, and `encounter.abandoned` carries an `outcome` of
  `abandoned` or `lost`.

`schemas/protocol/loss.report.data.schema.json` is new. Every affected protocol schema has moved
with it, and the schema-parity suite holds `loss.report` before and after a real destruction,
destinations with a bookmark, a shipless `assets.list` and a recovery-grant ship to their schemas.

**Campaign state and save format are 9:**
- new top-level `recovery` (the loss count and the last `LossRecord`);
- `assets.activeShipId` is nullable, with a new `assets.lastDockedStationId`;
- `recoveryGrant` on ships and stacks;
- `navigation.selectedBookmarkId`, and warp `bookmarkId` and `anchor`;
- `owner` on wrecks and the `lost` outcome;
- `layerDamage` on recorded damage events.

`tests/fixtures/saves/format-9.json` is the new sealed golden artefact. `format-8.json` joins the
rejected pre-release shapes (MVP plan section 2, rule 7).

## Content

- **Opponents reload.** NPC loadouts accept an optional `reserveRounds`, loaded into the
  opponent's hold at spawn. The Pirate Patrol and Pirate Base profiles now carry 50-80 rounds; the
  Pirate Scout carries none, so the easiest site and the Phase 14 flows are unchanged. The new
  semantic check `checkReserveRounds` requires turrets, a named charge and hold space. The reason:
  every opponent had one magazine and no reload rounds, so no site could destroy even an idle
  starter ship. The Pirate Base left it at worst with 0 armour and 122 hull after ten minutes, and
  the Patrol never broke its shield. Destruction, the subject of this phase, was unreachable in
  play. With reserves, an idle starter ship dies at the Pirate Base about 80 simulated seconds after
  arriving.
- **The recovery station's starter hull costs 11,988 (base 11,100), down from 12,960.** Functional
  Specification 9.12 grants no ship to a pilot holding at least the starter's 12,000 reference value,
  so such a pilot must be able to buy one. At 12,960, a pilot with 12,000-12,959 credits was
  stranded. The new semantic check `checkRecoveryReach` rejects a fixed starter-hull quote above
  the reference value; the minimal fixture pack moved with it.

## Defects found and fixed

- **Autosaves triggered during simulation were lost.** Docking, warp arrival, encounter completion
  and now destruction all request an autosave from inside `time.advance`, but the frame driver's
  answer only forwarded invalidations. The client now answers them. The browser acceptance test
  reloads the page without closing the campaign and finds the post-destruction station, which only
  that autosave can provide.
- **Opponents fell silent after one magazine** (see Content).
- **The loss report could name a zero-damage "final" hit.** Shots that land in the same instant
  after the killing shot remove nothing, so `finalDamage` now reports the last burst that removed
  hit points.
- **Undock availability could stay stale after a shipless pilot bought a hull.** Gaining an active
  ship now invalidates `site`, `station` and the service topics.
- **A persistence browser test failed about one run in sixteen.** Playwright's `getByText('0s')` is
  a case-insensitive substring match, and the frame's campaign-details list reads "...<id>Save format
  N". That contains "0S" whenever the random campaign id ends in 0. The clock assertion in
  `tests/browser/campaign.spec.ts` now matches exactly. This is pre-existing and not caused by
  Phase 15; it surfaced in this phase's full run.
- A 30-simulated-minute wreck-expiry unit test now carries an explicit timeout. It takes about 2 s
  alone, but the heavier Phase 15 property tests running in parallel pushed it past the 5 s default.

## Tests and exit gate

- `tests/unit/engine/loss.test.ts` (18 cases): the transaction fires once and only for the player,
  leaves nothing of the ship behind, and docks the pilot at `lastDockedStationId`. It also covers:
  - the `lost` outcome, and an encounter won in the same instant staying completed with its bounty
    paid;
  - the wreck's position and lifetime, and loaded ammunition never surviving;
  - basic, enhanced (consumed) and restricted insurance;
  - all three recovery outcomes, the granted fit, and repeated recovery;
  - the report contents, the autosave, events, invalidations, and invariants after every case.
- `tests/unit/engine/lossProperties.test.ts` (11 cases):
  - independent survival rolls: one `loot` draw per item and no other stream touched, about 50%
    survival over 400 seeds, uncorrelated;
  - ownership conservation over 60 random ships;
  - non-exploitable restricted assets: random sequences of split, merge, transfer, refit,
    resupply, buy, sell, ammunition change, reload, loot and loss never unmark a unit, never sell or
    insure a marked one, and never merge marked with unmarked;
  - inaccessible-state prevention after any loss or purchase.

  Deliberately breaking the marking rules makes them fail.
- `tests/unit/engine/bookmark.test.ts` (8), `tests/unit/engine/lossPersistence.test.ts` (4):
  selection and warp refusals, arrival relative to the wreck, looting after a 0 km warp, expiry
  mid-warp, retreat and docking with two stations, save/load round trips at the same state hash,
  and deterministic replay through a destruction.
- `tests/integration/loss.test.ts`: the headless exit-gate loop over the engine host. The pilot is
  lost with a spare gun bought first, and the grant, autosave, close and resume are checked. The
  pilot then warps to the wreck, loots the surviving booster, fits the spare gun, clears the Pirate
  Scout, and the site stays repeatable.
- `tests/unit/content/semanticValidation.test.ts`: six cases for `checkRecoveryReach` and
  `checkReserveRounds`.
- `tests/component/LossScreen.test.tsx` (12 cases): the loss report, the no-ship hub and refused
  undock, buying a hull, recovery-grant labels and the sale refusal, choosing the wreck, the warp
  chooser sending `navigation.warpToBookmark`, the `lost` sortie, and an advance's autosave
  answered exactly once.
- `tests/browser/loss.spec.ts` (the phase's browser acceptance test, 4.5 minutes at 1x). A new
  campaign buys a spare autocannon, flies the starter ship to the Pirate Base and is destroyed. It
  checks the report, the 3,600 ISK basic payout and the grant. It then reloads the page without
  closing and finds the post-loss station, confirms the grant label, chooses the wreck, warps to it
  at 0 km, takes the surviving shield booster and docks. Finally it fits the spare gun and clears
  the Pirate Scout again. The report stays reachable as "Last ship lost".
- `tests/accessibility/loss.spec.ts`: axe on the loss report (payout explanation open) and the
  shipless station, the refused undock with its reason, and buying the starter hull restoring an
  active ship.

**Results:**
- `npm run verify` passes: type checking, architecture checks, content validation, **1123 unit
  tests**, **87 integration tests**, **90 component tests**, traceability and the production build.
- `npx playwright test` passes all **45** browser and accessibility tests (43 existing, 1 new browser,
  1 new accessibility). The loss run takes about 4.5 minutes at 1x; the full suite about 6 minutes.
- Traceability reports **108 requirement ids**, all covered by tests.

## Decisions worth retaining

- **The functional specification allows a pilot with no ship.** Technical Specification 15.3
  check 5 says "exactly one active player ship exists", which contradicts Functional Specification
  9.12 for a pilot who can afford a hull. The higher authority was implemented, and the invariant was
  narrowed to keep every such state recoverable. The proposed wording change is posted as Q3 in
  `docs/agent-comm/requests/questions-and-answes.md`.
- **"Flight-ready" means "passes the undock rule".** The grant is checked at destruction and again
  after any purchase that would leave a shipless pilot below the reference value. The alternatives,
  and the unpleasant but legal "bare hull" route they would close, are posted as Q4.
- **Restriction lives on the units, not on a flag in provenance.** Technical Specification 8.3
  asks for separate stacks. Magazines are the one place two kinds of unit must share a stack, and
  there the restriction absorbs.
- **The wreck is the bookmark.** A separate bookmark entity would duplicate the wreck's site and
  position and could drift from it. The warp keeps its own copy of the point it aimed at, so a
  bookmark expiring mid-warp changes nothing about the arrival.
- **The report is frozen, the wreck is live.** Everything the report explains is copied at the
  moment of destruction. Only the wreck's presence, contents and remaining time are read live, so the
  report can say what is still recoverable.

## Handoff to Phase 16

- **Balance of loss recovery is Phase 17 work, and it is harsh today.** A first-sortie loss with
  starting credits leaves 23,600 ISK and no ship. The pilot is not owed a grant, but a hull (11,988)
  plus an autocannon (12,960) costs more than that, so they must recover their wreck in a bare hull
  or be destroyed again to qualify for a grant. The mechanics are as specified (Q4 asks whether
  "flight-ready" should mean armed); the numbers belong to MVP Scope 4.3's "recover from poor
  purchases or losses without prolonged grinding".
- **Opponent reserves are provisional.** The Pirate Patrol still cannot kill an idle starter ship
  (its scouts carry no reserve and orbit, and the marksman misses at range), while the Base kills
  one in about 80 s. Phase 16 owns the final encounter set and should tune reserves with the rest of
  each profile.
- The events `recovery.shipLost`, `recovery.insurancePaid`, `recovery.shipGranted`,
  `recovery.activeShipChanged` and `encounter.abandoned` (with `outcome: 'lost'`) are the inputs for
  Phase 18's ship-destruction notification. Functional Specification 19.7 says it cannot be fully
  hidden.
- A player wreck has no special drawing in the space view beyond the "own" attitude; Phase 19's
  shape and icon pass may want one.
- Unrelated and pre-existing: `market.previewSell` throws, rather than answering unavailable, for an
  item the station does not list.

Open, non-blocking questions for the human operator: Q3 and Q4 in
`docs/agent-comm/requests/questions-and-answes.md`.
