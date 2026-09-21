# Phase 13 completion note - NPC behavior, encounter lifecycle, and rewards

Status: complete. Date: 2026-09-21.

Implements Phase 13 of `docs/MVPImplementationPlan.md`. The headless engine now instantiates,
resolves, abandons and repeats the authored combat encounters and commits their rewards. Arriving at
a combat site spawns its authored opponents; they fight with the ordinary player commands; destroying
one pays its bounty and leaves a wreck holding rolled loot; leaving abandons the instance and the
next arrival instantiates a fresh one.

This remains an engine phase. The Phase 14 combat interface can consume `encounter.state`,
`loot.contents` and the extended `navigation.destinations` without reproducing any encounter rule.

## Delivered

### Encounter lifecycle

- `src/engine/domain/encounter/` holds the aggregate: the running instance, its opponents, its
  declarative objective, the rewards it has already granted, every wreck the site carries, and the
  per-encounter completion counts.
- `src/engine/simulation/encounter.ts` owns the transitions. A warp arrival instantiates the
  encounter authored at that site and re-materialises the site's wrecks; a warp departure or a
  docking abandons the instance and despawns its survivors; destroying every opponent completes it,
  records the completion and requests an autosave.
- A completed or abandoned site always yields a fresh instance on the next visit, so the loop cannot
  be exhausted (MVP Scope 4.2, Functional Specification 18). Each instance takes one draw from the
  `encounter` stream for its angular offset, so two visits do not present an identical formation.
- The objective is declarative (`destroyGroup`), stored with its kind so a later predicate can be
  added without reinterpreting saved instances.

### Opponents

- An opponent is an ordinary ship. It is created through the inventory service with real modules and
  charges in a real fitting store, derives its attributes through the shared pipeline, and carries
  `owner: 'npc'` so it stays out of the player's asset, hangar, market, repair and insurance
  surfaces while using the same combat rules.
- `src/engine/domain/encounter/behavior.ts` is the pure behaviour selector. A role is a band rather
  than a distance: the preferred range is a fraction of the opponent's own best turret optimal,
  clamped to the role's authored minimum and to what its own lock range can hold. It reads only its
  role, its condition and the range to its target, so it gains nothing from the player losing.
- The adapter turns intent into `orderMovement`, `beginLock`, `activateWeapon`, `activateModule` and
  `deactivateModule` - the same operations the player's commands call. It never writes ship state.
- Decisions are scheduled boundaries (`encounter.npcDecision`), so a campaign saved mid-fight
  resumes with the same pending decisions.

### Movement belongs to the ship

- `navigation.movement` became `navigation.movementOrders`, keyed by ship entity id, because a
  movement order belongs to the ship aggregate (Technical Specification 8.2) and an opponent
  commands its ship the same way the player does (Technical Specification 10.3).
- `advanceNavigation` integrates every movable ship in the site. A destroyed ship drifts; an order
  whose target disappears stops safely.

### Rewards, wrecks and loot

- A destroyed opponent's bounty is settled against a grant id, so a replayed settlement at the same
  timestamp cannot pay twice. Its ship, stores and pending boundaries leave the campaign.
- A wreck is an ordinary unlimited inventory in a new `wreck` inventory location, holding what its
  authored loot table rolled from the `loot` stream. Every authored entry consumes exactly one
  chance draw plus one quantity draw on a hit, so a failed chance still advances the stream and
  replay is exact.
- A wreck outlives the instance that created it: it lives in `encounter.wrecks` keyed by site and is
  re-materialised when that site loads, and it expires 30 simulation minutes later on its own
  scheduled boundary whether or not the site is loaded (Functional Specification 5.4).
- `loot.take` is the ordinary physical move, so capacity is checked before anything leaves the wreck
  and a hold that is too small keeps the goods where they are.

### Projections

- `encounter.state` publishes the instance, its objective, each opponent with its role, bounty and
  current range, the wrecks in the loaded site with their remaining life and whether they may be
  opened, and the last attempt's outcome.
- `loot.contents` publishes a wreck's stacks whatever the range, together with the reason the player
  may not take them and the most of each stack the hold would accept.
- `navigation.destinations` now discloses each site's authored spawns, total bounty, possible loot
  and completion count before entry (MVP Scope 4.2).

## Content

- `content/rules/combat.json` gains the wreck access range, the opponent decision interval, the
  repair threshold, the range tolerance and the per-role movement and range bands. These are
  provisional tuning values; Phase 17 owns the balance pass.
- The NPC profiles now use modules as well as hit points to differ: the scout burns an afterburner
  to hold its orbit, the marksman plates its armour and snipes, the gunners brawl, and the warden
  brawls behind an armour repairer and a capacitor battery.
- `hull.pirate.scout` was reduced and the starting ammunition grant raised so the starter fit can
  complete the tier-1 site without a purchase, which MVP Scope 4.2 requires. The headless
  integration test proves it: the loop finishes in roughly 190 simulation seconds with ammunition to
  spare.

## Contracts and persistence

Protocol version is **10**. The catalogue adds `encounter.state`, `loot.contents` and `loot.take`;
`SiteObjectData.kind` accepts `wreck`; `ShipAssetData` carries `owner`; `DestinationData` carries
the disclosed reward summary and completion count. New JSON Schemas publish the encounter and
wreck-contents contracts.

Campaign state and save format are **8**. The campaign gains its `encounter` aggregate, ships gain
`owner`, inventories gain the `wreck` location and navigation stores per-ship movement orders.
`tests/fixtures/saves/format-8.json` is the new sealed golden artefact. No pre-release format has
shipped, so format 7 joins the fixtures that prove rejection, and the ordered migration runner is
still exercised through the new 7 to 8 boundary.

## Tests and exit gate

- `tests/unit/engine/encounter.test.ts` covers instantiation, authored fits, slot assignment, fresh
  formations, the adapter's use of ordinary commands, propulsion inside and outside the band,
  completion versus abandonment, reward idempotence, fresh instances and the invariants.
- `tests/unit/engine/encounterLoot.test.ts` covers loot draws, disclosure, wreck placement and
  expiry, out-of-range refusal, physical transfer and capacity-constrained looting.
- `tests/unit/engine/encounterPersistence.test.ts` round-trips an instance with a wreck and resumes
  pending decisions to the same canonical hash.
- `tests/unit/engine/npcBehavior.test.ts` holds each role to its band, its module use and its
  refusal to read anything about the player beyond range.
- `tests/integration/encounter.test.ts` is the exit gate: from the starting campaign it discloses
  the rewards, resupplies, undocks, warps in, fights the authored opponent with ordinary commands,
  collects the bounty and the wreck, retreats and docks, and finds the site still repeatable.
- `npm run verify` passes: type checking, architecture checks, content validation, **1018 unit
  tests**, **86 integration tests**, **62 component tests**, traceability and the production build.
- `npx playwright test` passes all **36** browser and accessibility tests.
- Traceability reports **104 requirement ids**, all covered by tests.

## Decisions worth retaining

**An opponent is an owned ship with an owner.** Putting opponents in `assets.ships` is what lets
them use the fitting, movement, targeting, damage and capacitor rules unchanged. The `owner` field
is what keeps them out of the player's surfaces; the alternative - a parallel NPC combat path - is
exactly what Technical Specification 10.3 forbids.

**A movement order belongs to its ship.** Generalising `navigation.movement` into a per-ship map was
unavoidable once opponents move, and it is what Technical Specification 8.2 describes anyway. The
site projection still publishes the player's order alone.

**A wreck outlives its encounter.** Functional Specification 5.4 gives a wreck 30 simulation
minutes, which is longer than an instance lasts. Wrecks therefore live in a site-keyed overlay and
are re-materialised on load, rather than being part of the instance that made them.

**Destruction is settled after the combat batch.** `advanceEncounter` runs after `advanceCombat` in
the continuous-system order, including on the zero-length post-batch pass, so an opponent that died
in the same instant it fired still contributed its shot before it became a wreck.

**Tier-1 content was retuned to be completable.** MVP Scope 4.2 requires the starter fit to finish
the easiest site without a purchase, and it could not. The change is data only - scout hull points,
its shield recharge and the starting ammunition grant - and the tests that asserted those numbers
now read them from content instead.

## Handoff to Phase 14

- `encounter.state`, `loot.contents` and the extended `navigation.destinations` and
  `navigation.site` are the contracts the combat interface consumes. Wreck access availability comes
  from the same predicate `loot.take` asks, so a control can never offer a refused take.
- Site objects now carry `kind: 'wreck'`. The schematic view draws them as a broken outline and the
  message catalogue has `space.kind.wreck`; selection, inspection and the loot panel belong to
  Phase 14.
- `encounter.*` domain events (started, opponentDestroyed, bountyPaid, completed, abandoned,
  wreckCreated, wreckExpired, lootTaken) are the semantic feed for Phase 18's notifications.
- Player destruction, the player wreck, survival rolls, insurance settlement and the loss report
  remain Phase 15. Combat already marks the player destroyed and opponents stop acting on it; the
  transaction that turns that into a loss and a recovery is not written yet.
- Balance remains provisional. Phase 17 owns bounties, hit points, drop rates and the tier-2 and
  tier-3 difficulty curve; the tier-1 values changed here only far enough to make the loop
  completable.

No open questions block Phase 14.
