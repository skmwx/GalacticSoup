# Phase 14 completion note - Combat UI and first end-to-end vertical slice

Status: complete. Date: 2026-09-24.

Implements Phase 14 of `docs/MVPImplementationPlan.md`. The first complete MVP loop is playable in
the shipped build against the easiest encounter: prepare at the station, fly to the Pirate Scout,
lock and fight it with the ordinary commands, loot the wreck, come home, sell the loot, buy and fit
a second gun, and clear the site again with it. This is the first end-to-end MVP vertical slice.

## Delivered

### Space view

- **Hostility, locks and effects in the drawing.** Hostility is the engine's answer (see below) and
  is drawn as a shape: a hostile ship wears a dashed diamond, a completed lock is a ringed crosshair,
  a lock in progress a broken ring. The effects layer, which Phase 10 reserved between objects and
  labels, now draws each weapon cycle as a line to its target, every ship that has locked the player,
  and recent damage (burst and number) and repairs (plus and number) beside the ship they happened
  to, for three seconds of simulation time.
- **Ranges on demand.** `b` or the view control draws lock range and each distinct weapon's optimal
  and optimal-plus-falloff around the ship.
- **Contextual commands.** A secondary click on an object - or the context-menu key or Shift+F10 on
  its list entry - opens a small non-modal menu holding the same `ObjectCommands` list the
  selected-object panel renders: lock or unlock, fire, approach, orbit, keep range, dock. It takes
  focus, closes on Escape, a command or a click elsewhere, and returns focus where it came from.

### Tactical panels (`src/ui/space/`)

| Panel | What it shows |
|---|---|
| Your ship | Shield, armour and hull with values, a bar and a "low" word; resistances by layer and type; capacitor with recent change, repeating use, recharge and, when unstable, endurance with the substituted formula; who is locking or has locked the ship. |
| Weapons | Weapons grouped by turret and charge. Each group: its ranges and tracking, hit chance against the aimed target, which half of the formula limits it and what to do about it, expected damage before resistances, and the hit-chance formula with the engine's operands written in. Each weapon: firing, finishing, reloading or stopped with the reason; magazine and hold rounds; fire, cease, reload; every charge it could change to with that charge's damage profile and ranges. |
| Modules | Active modules as toggles (with `1`-`4`), their state, cycle cost and effect (repair rate with its calculation, speed gain); passive modules with the effect they already contribute. |
| Locks | Locks held and in progress, time left, the lock-time formula, out-of-range warning, unlock; choosing a lock selects its target. |
| Encounter | Objective progress, each opponent's role, bounty and range, bounty paid, and a "site cleared" line that says what to do next. |
| Combat log | The engine's aggregated significant events as sentences (who hit whom, how often, how much survived resistances, by type), newest first, filterable to damage taken, dealt, repairs or losses. |
| Wreck | Range, expiry, item count and hold space; contents once in reach, each stack with the most the hold accepts, `Take` per stack and `Take all` (`t`); further out, the engine's reason and "Approach to open". |

The selected-object panel now shows attitude, role and bounty, relative motion (closing,
transverse, angular, signature), lock state, whether the ship is targeting the player, its visible
running modules and its defensive layers. The persistent frame adds layers, capacitor, locks,
running modules and the number of ships that have locked the player while undocked
(Functional Specification 19.1).

The weapons aim at the selected object when it is locked, otherwise at the first completed lock;
selecting a lock is how the player chooses a target. Selecting a wreck opens it.

### Station side

- The hub shows the last sortie - outcome, opponents destroyed, bounty - and what the hold
  carries, with the next steps (sell, repair, resupply, refit).
- The departure panel discloses each site's opponents with role and bounty, the total bounty, the
  named possible loot and how often it has been cleared (MVP Scope 4.2).
- The warp control defaults to the site chosen at the station.
- Before the undock control, the departure panel warns - without blocking - about a weapon with no
  ammunition, a fit with nothing that shoots, and unrepaired armour or hull (Functional
  Specification 10), from the fit's own warnings and the ship's layers.

### Registry and shortcuts

New registry actions, all with icons and labels, none colliding with an existing key:
`l` lock, `n` unlock, `e` fire, `q` cease fire, `v` reload all, `1`-`4` module toggles, `t` take all,
`]` / `[` step the selection, `b` ranges; plus per-weapon fire, cease, reload and load-charge
controls and `loot.take`, which have no shortcut. `commandAvailability` in `src/ui/actions` is now
the one reader of projected availability.

## Engine and contracts

Protocol version is **11**. Request types are unchanged; the views the interface reads widen:

- `SiteObjectData.attitude` - `own`, `hostile` or `neutral`, from `objectAttitude` in
  `src/engine/domain/encounter/attitude.ts`. With no factions in the MVP, an encounter role is the
  only thing that makes a ship hostile (Functional Specification 9.1).
- `SiteObjectData.nameKey` names an opponent as the encounter does ("Pirate Scout") rather than by
  its hull ("Cutlass"), so the view, the roster and the log agree. Stored state is unchanged.
- `CombatData.hostileLocks` - ships locking or locked onto the player.
- `DefenseStateData.activeEffects` - the modules a ship has in a paid cycle, for the player and
  every opponent.
- `WeaponEffectData.limitingFactor` - `none`, `range` or `tracking`, from the pure
  `turretLimitingFactor`: the larger squared strain, range beyond absolute range, range on a tie.
- `WeaponRuntimeData.ammunitionNameKey` and `ammunitionOptions` - the loaded charge and every
  accepted charge in the hold, with its damage, ranges, tracking and change availability.
- `DestinationData.possibleLoot` - the disclosed loot with name keys.

The three JSON Schemas, the request envelope and the health and capability schemas moved with it.
A new parity case validates `combat.state`, `navigation.site`, `encounter.state` and
`navigation.destinations` in the middle of a fight and after it, with every optional part
populated, so the tactical schemas are acceptance-test contracts.

Campaign state and save format are unchanged at **8**. No authoritative field was added.

### Content

`content/rules/navigation.json` gains a `0.5` km range preset. An approach stops within its
tolerance of the chosen distance, and with 1 km the closest preset a wreck (1 km access range) could
not be opened with any order the interface offers. A new semantic content check,
`checkWreckReach`, rejects presets whose closest approach plus tolerance cannot reach wreck access
range.

## Defects found and fixed

- **The market was blank after a campaign reopened in space.** Station-only projections are not
  read while undocked, and docking refreshed only station services, so a player who reopened in a
  site and flew home found every item "Not traded here". Docking already invalidates the `station`
  topic; it now refreshes services, market, fitting and undock validity. A component test reopens
  in space, docks through the running clock and sells.
- **`w` did nothing.** The warp shortcut was registered in Phase 10 but never bound. It now warps to
  the chosen destination, with a component test.
- **A gun could come home empty and unresuppliable.** A repeating weapon reloads an empty magazine
  before its next cycle, but when the round that emptied it also destroyed the target there is no
  next cycle, so the gun stopped empty. Once docked an empty magazine holds no charge, so resupply
  refused it and the next sortie started with a dead gun. A weapon that stops because its target or
  lock is gone now reloads an empty magazine from the hold (Functional Specification 9.4: reload may
  be automatic when empty); `src/engine/simulation/combat.ts` `reloadIfEmpty`, with a unit test that
  fails without it. Nothing is loaded when the hold has no compatible charge. Opponents follow the
  same rule. No authoritative field changed.
- **Long button labels overflowed at a doubled scale.** Action button labels no longer refuse to
  wrap; they stay on one line while they fit (Technical Specification 12.5, text expansion).

## Tests and exit gate

- `tests/browser/combat.spec.ts`
  - the full loop from campaign creation: prepare, fly, fight, **close and reopen mid-fight**
    (lock, guns and booster come back), clear the site, loot, return, see the sortie summary and
    23,000 ISK, sell the loot, buy and fit a second autocannon, resupply, **close and reopen after
    the conversion** (wallet and fit unchanged), and clear the site again with both guns firing;
  - a **mouse-only** script: secondary click in the paused view, orders and lock from the context
    menu, fire, booster, ranges, cease fire, unlock, retreat;
  - a **keyboard-only** script: arrival distance and range chosen by typing into the fields, then
    `w`, `p`, `]`, `o`, `l`, `e`, `1`, `q`, `v`, Shift+F10 and Escape with focus return, `n`, `x`.
  The client's sixteen seed bytes are fixed in the browser so the wreck always holds the same loot;
  nothing else is changed.
- `tests/accessibility/combat.spec.ts` - axe in the middle of a fight with every explanation open,
  with the context menu open, words-and-shapes for hostility and locks, and a doubled scale.
- `tests/component/CombatScreen.test.tsx` (15 cases) drives campaigns headlessly to each moment and
  opens the real interface on the same engine: hostility and locks in words and shapes, hit chance
  with limiting factor and substituted formula, status, modules and frame readouts, the selected
  opponent, the filtered log, lock/unlock/toggle by button and by key, the context menu by pointer
  and keyboard, looting, the unreachable-wreck reason, the station summary and disclosure, the
  market after a reopen, the undock warning for an unloaded gun, and message-key coverage.
- `tests/unit/engine/tacticalProjection.test.ts` (10 cases) and new formula cases cover attitude,
  naming, hostile locks, active effects, limiting factor, ammunition options and named loot.
- `tests/support/sortie.ts` drives a sortie over the engine host for the component and parity tests.

Results:

- `npm run verify` passes: type checking, architecture checks, content validation, **1052 unit
  tests**, **86 integration tests**, **78 component tests**, traceability and the production build.
- `npx playwright test` passes all **43** browser and accessibility tests (36 existing, 3 new
  browser, 4 new accessibility). The full loop takes about six minutes at 1x; the mouse and
  keyboard scripts about forty seconds each.
- Traceability reports **105 requirement ids**, all covered by tests.

## Decisions worth retaining

**The interface decides what to show, never what is legal.** Which locked target the weapons aim
at, how weapons are grouped and what to call an id are presentation; whether anything can be done is
always a projected availability, and "fire" is enabled only when some weapon's projected activation
is.

**Hostility and limiting factor are engine answers.** Both are rules - Functional Specification 9.1
and 19.3 - so they were added to the projection rather than inferred in React from the encounter
roster or the strains.

**Contents are shown only in reach.** `loot.contents` publishes a wreck's stacks at any range; the
loot panel shows them only when the engine says the wreck may be opened, because Functional
Specification 9.11 opens a wreck within 1 km.

## Handoff to Phase 15

- Player destruction is still not turned into a loss. The status panel, frame and log already show
  the player's layers and the destruction event; Phase 15's loss report and recovery feedback
  belong beside the sortie summary on the hub.
- The station-topic refresh added here is what makes the post-loss station state current after the
  recovery transaction moves the player.
- For Phase 17: the first clear of the scout site with the starter fit takes about 160 simulated
  seconds and roughly 60 of the 120 starting rounds, and the bounty plus loot comfortably funds a
  second autocannon (the browser loop does exactly that). A two-gun ship then needs the hold
  restocked from the market before it goes out again - resupply refills magazines, not the hold - so
  the loop teaches ammunition as a running cost. The sortie summary now says so.
- Notifications, audible cues and onboarding are Phase 18. `hostileLocks`, the combat events and the
  encounter events are the inputs; the tactical panels are their permanent home.

No open questions block Phase 15.
