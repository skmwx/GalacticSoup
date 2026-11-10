# UIR1-07 completion note - Destinations in space and the Harbour return

Status: complete. Date: 2026-11-10.

Implements phase UIR1-07 of `docs/MVPUIReview01ImplementationPlan.md`. It covers these review
findings:

- Departure: "Site selection should happen in space, not at departure."
- In Space: "Harbor should be one of the destinations, no need for a separate retreat button."

## Decision: keep the engine selection, allow it in space

The plan preferred a presentation-only choice in space if that kept encounter and onboarding
semantics. It did not:

- The "Choose a site" guidance step completes on `navigation.destinationSelected`. With a
  presentation-only choice, the step could never complete.
- `selectedEncounterId` and `selectedBookmarkId` are saved. They are how an old save's chosen
  destination, and the wreck chosen from the loss report, stay useful.

So the existing `navigation.selectDestination` / `navigation.selectBookmark` commands are now
accepted anywhere in the system: docked, in a site or in warp. Choosing marks a destination and never
moves the ship, so nothing else had to change. Warp, dock and encounter entry are untouched. A warp
to a site still starts its encounter whether or not the site was chosen.

The station has no saved selection of its own. Choosing it in the chooser is presentation only.
Adding one would have changed the save format for no gain.

## What changed

### Engine and protocol (protocol 17 → 18)

- **`src/engine/domain/navigation/availability.ts`:** `selectDestinationRefusal` and
  `selectBookmarkRefusal` no longer refuse outside a station. The `destinationSelectionUnavailable`
  refusal stays in the vocabulary, as the protocol error list requires it, but nothing produces it
  now. Its message reads "A destination cannot be chosen here."
- **`DestinationsData.stations`** (`src/protocol/navigation.ts`, `StationDestinationData`): the
  system's stations as real station destinations. Each has `stationId`, `siteId`, `nameKey` and
  `descriptionKey` (authored, so "Borrell Harbour" is never hard-coded), `home` (the last docked
  station), `current` (in its site), and `commands`:
  - `navigation.warp` to its site, through the existing `warpRefusal`. In its own site this gives
    `destinationCurrent`.
  - `navigation.dock`, through the existing `dockRefusal`.

  There is no tier, opponent or reward field.
- **Projection** `destinationsProjection` → `stationDestinations()`. Docking already invalidates
  `destinations`, so `home` refreshes.
- **Schemas:** `navigation.destinations.data.schema.json` has a required `stations` array and a
  `stationDestination` def. The protocol `const` is 18 in `client-request`, `system.health` and
  `system.capabilities`. `version.ts` documents 18.
- **`navigation.retreat` is unchanged** (the ordinary warp to the last docked station at 0 km). It
  is still what the return shortcut sends.
- **No save-format, campaign-state or migration change.**

### Space navigation (`src/ui/space/DestinationChooser.tsx`, new)

Mounted in the command strip (`CommandBar`) below the movement orders. Phase 08 removes the
coordinates disclosure next to it, and phase 09 moves the strip into the Navigation column.

- **Destinations list:** the station, then the encounters by tier, then the player's wrecks. Each is
  a toggle button with a one-line summary:
  - "Station · you are here";
  - "Tier 2 · 13,000 ISK bounty";
  - "Wreck · expires in 1h 59m".

  Every encounter stays listed, including the current one and harder ones.
- **Choosing:**
  - Choosing a row shows its briefing.
  - For an encounter or wreck it also sends the select command through the action runner. It never
    moves the ship. The browser and component tests check that the order and travel state are
    unchanged.
  - The station choice is local state.
- **What is offered first:**
  1. the recorded wreck or encounter, unless the ship is already there;
  2. otherwise home;
  3. in the station's own site, the easiest encounter.

  An expired wreck disappears from the projection, and the chooser falls back to this order.
- **Briefings:**
  - Encounter: tier, description, reward summary, then the disclosed facts on one line: opponents
    with roles and bounties, total bounty, possible loot, and completions.
  - Wreck: hull and site, what waits there, stacks left and the expiry countdown, and the arrival
    rule.
  - Station: "Warp to the station's site, then dock…", or "You are at the station's site. Dock…".
- **Actions:**
  - Elsewhere: "Arrive at", plus "Warp to {name}" (for a wreck, "Warp to your wreck at {site}").
  - At the station's own site: "Dock at Borrell Harbour" instead. No warp to the current site is
    offered.
  - All availability and reasons come from the projection.
- **Shortcuts:**
  - The `navigation.warp` / `navigation.dock` handlers moved here from `CommandBar`.
  - `navigation.retreat` keeps its id and its remappable `x` key. It is now labelled "Return to
    station". Away from the station it sends `navigation.retreat`. At the station's site it docks.
    It answers with the projected refusal otherwise.
- **`CommandBar.tsx`:** the destination select, the arrival select, and the Warp, Dock and Retreat
  buttons are removed. The separate Retreat button is gone. Docking with a selected station object
  is still in its context menu and the selected-object panel.

### Departure (`src/ui/station/DeparturePanel.tsx`)

- **Kept:** the undock warnings, the capacitor readiness and its explanation, the warning
  confirmation (with its preference), and the engine's undock refusals (no ship, invalid fit, open
  draft).
- **Removed:** the encounter list, the briefing and the wreck table.
- A status line names an existing choice ("Chosen destination: your wreck at Outpost Cradle. Space
  navigation offers it first."). Otherwise it reads "No destination needed: you choose one in
  space." (`data-selection` is `encounter | bookmark | none`.)
- The `simulationTimeMs` prop is gone.
- Unused station CSS (`departureGrid`, `destinationList`, `destinationCard`, `briefing`,
  `disclosureList`) is removed.

The loss report's "Choose your wreck as the destination" is kept. It still works docked, and space
then offers the wreck first.

### Guidance content and wording (content hash changes)

- **`content/guidance/loop.json`:**
  - `guide.loop.choose-site` now comes after `guide.loop.undock`, with surface `space`.
  - `guide.loop.harder` has surface `space`.
  - `guide.loop.ready` has surface `station.hub` (the redirect from UIR1-06 still covers old
    `station.services` text).
  - No step ids changed, so saved onboarding is valid.
- **`content/localization/en.json`:**
  - Rewritten for the new flow: choose-site, undock, warp and return. Return names Borrell Harbour
    under Destinations, Dock (D), and Return to station (X).
  - Since the content hash was moving anyway, the wording deferred by earlier phases is folded in:
    - UIR1-03: "switch to Sell";
    - UIR1-04: "use All or Max … in the hangar column";
    - UIR1-05: "use Change module on an empty weapon slot";
    - UIR1-06: "On the Overview ({keyStationHub}), use Repair all and Resupply ammunition".
- **UI catalogue:**
  - New `destination.*` keys.
  - Removed the departure list, bookmark-table and space-select keys.
  - Reworded `departure.*`, `action.navigation.retreat` ("Return to station"),
    `action.station.departure.detail`, `loss.next.granted`, `tactical.encounter.cleared` and the
    retreat and selection refusals.

### Documentation

- `MVPScope.md` §§2-5: the loop order, the Station row, the destination paragraph (undock with no
  destination; choose in space; return is warp + dock with a return shortcut), §4.2 wording, and
  the §5 surfaces.
- `README.md`: protocol 18, Leaving the station, the departure paragraph and the wreck bookmark.
- `docs/agent-comm/release/playtest-script.md`: the retreat item and the "no map" note.

Functional Specification §§7.3-7.4 and 19.5 needed no change, since they never required docked
selection.

## Fixtures re-recorded (reviewed)

`npm run contracts:record` and `npm run golden:record`. I reviewed the diff:

- **`lock.json`:** protocol 18 and the digests of the four changed schemas.
- **`golden-campaign.json`:**
  - protocol 18 and the new content hash;
  - the progression scenario (`tests/support/progression/scenario.ts`) now undocks before choosing,
    as the interface does, so each `selectDestination` step moves one line later;
  - **revisions and simulation times are unchanged.** The four checkpoint state hashes change only
    because guidance steps now complete in the new order (undock, then choose-site).
- **Six golden saves:** protocol, content hash, checksum, and the order of guidance completions and
  their notifications. Nothing else.

## Tests

- **Unit:**
  - `bookmark.test.ts`: choosing the wreck in space is accepted, records it and moves nothing.
  - `guidance.test.ts`: the first step is Undock.
- **Integration:**
  - `navigation.test.ts`: availability now expects the selection to be offered in space, and the
    station destination at its own site to be dock-only.
  - New case: undock with no destination, choose in space without moving, warp, then the station
    destination's warp, arrival, dock-only, dock. The choice survives docking.
  - `guidance.test.ts` and `tests/support/sortie.ts` use the new order.
- **Component:**
  - `SpaceScreen.test.tsx`: helpers for the object list and the chooser.
    - New: the station and every encounter are listed; a briefing is read, recorded and moves
      nothing; the station briefing has no tier or bounty.
    - New: after warping to the scout, the current site cannot be warped to, and `x` warps home.
    - Dock is through "Dock at Borrell Harbour".
  - Migrated: `Guidance`, `LossScreen` (wreck listed and chosen in space; the chosen wreck is
    offered first and warped beside), `CombatScreen` (disclosure read in space; dock through the
    chooser) and `Settings` ("Return to station" stays usable while busy).
- **Playwright:**
  - New shared helpers in `tests/support/destinations.ts`: `chooseDestination`, `warpTo`,
    `warpHome`, `dockHome`, `destinationEntry`, `destinationBriefing` and `siteObject`. The
    chooser also names the station, so object-list clicks are scoped.
  - Migrated:
    - browser: `cockpit`, `space`, `combat`, `guidance`, `loss`, `offline`, `progression`;
    - accessibility: `space`, `combat`, `guidance`, `loss`, `presentation`.
  - Accessibility `space` adds an audit with a briefing open, and a keyboard-only
    choose/dock-offer/warp case. The refusal check now uses Approach's tooltip description.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (287 files, no violations) |
| `npm run validate:content` | pass |
| `npm run test:unit` | 78 files, 1403 tests pass |
| `npm run test:integration` | 25 files, 135 tests pass (golden replay and transport parity included) |
| `npm run test:component` | 11 files, 139 tests pass |
| `npm run traceability` | 117/117 covered |
| `npm run build` | pass |
| `npm run contracts:record`, `npm run golden:record` | written; diff reviewed above |
| Playwright Chromium: accessibility `space`, `combat`, `guidance`, `loss`, `presentation`, `station`, and browser `cockpit`, `space`, `combat`, `guidance`, `loss`, `offline`, `station` | first run 41 of 45 passed (4.1 min). The 4 failures were assertions still tied to the old flow: a disclosure read on Departure (2), a guidance step order, and the old step wording. They are fixed. |
| Rerun: those 4 plus browser `progression` | 5 passed (14.7 min), including the 30-min-budget progression mastery flow (14.6 min) |

## Visual verification

Script-driven Chromium against `vite preview`, at 1440×900, 1024 and 390. The screenshots were
inspected during the session and not committed.

- **Departure:** one row with the status line, the capacitor and Undock. Nothing else.
- **Space at 1440:**
  - Destinations sit under the movement row: the list on the left, the briefing and Warp on the
    right.
  - My first layout pushed `module.toggle.1` to 969-1046 px, past the cockpit test's 900 px
    working-view check. I compacted it with smaller rows, a small-type briefing, the disclosed facts
    on one line, an inline "Arrive at", and no 10 rem cap on the Warp label.
  - With the longest briefing (Pirate Patrol), the module toggle now ends at 888 px. This leaves
    little margin; phase 09 owns the rebalance.
- **No page-level horizontal overflow** at 1440, 1024 or 390.
- **At 390** the list rows fit on one line and the briefing stacks under them.

## Remaining issues and guidance for the next sessions

- **Phase 08:** the coordinates disclosure sits under the chooser in the same `.commands` section.
  Remove it there. The `x` (return), `w` (warp) and `d` (dock) handlers now live in
  `DestinationChooser`, not `CommandBar`.
- **Phase 09:**
  - The vertical budget at 1440×900 is tight (888/900 with the longest briefing).
  - When Navigation becomes a column beside the equipment, the chooser's two-column grid
    (`.destinations`) should probably stack inside it, or the list should become a horizontal row.
  - Chooser buttons and "Dock at Borrell Harbour" also match `/Borrell Harbour/`. Use `siteObject`
    or the object-list region when targeting the station object.
- **Selection vs. inspection:** choosing a row records the selection, which completes the "Choose a
  site" step. There is no separate inspect-only state, because choosing has no cost and moves
  nothing. If the reviewer wants pure inspection, it is a UI-only change.
- **Pre-existing:** `tests/browser/guidance.spec.ts` contains a Windows-1252 `…` byte (0x85) in
  `'Calculating…'` that predates this phase. My edits preserved it byte for byte. Fix the encoding
  in phase 10 if the gate reports it.
- **Q12** (stale previews during regeneration) is inherited unchanged. This phase adds no live
  previews.
