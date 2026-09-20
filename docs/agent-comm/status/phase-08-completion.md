# Phase 8 completion note — Integrated station interface

Status: complete. Date: 2026-09-20.

Implements Phase 8 of `docs/MVPImplementationPlan.md`. A player can now complete every
pre-combat preparation through the shipped interface: read the market, inspect and compare items,
buy and sell, move stacks between the hangar and the hold, change and apply a fit, repair, resupply
and insure the ship, watch the clock, and close and reopen the campaign to find all of it intact.

## Delivered

### The persistent frame and the station hub

`GameRoot` owns the campaign session. Before a campaign is open the screen offers exactly start and
resume; once one is open the persistent frame takes over and carries the pilot, the station, the
wallet, the simulation clock and its pause/resume control, the save status, the campaign controls
and a collapsed campaign-details disclosure.

The station hub presents each service as its own tile with its own icon and its own explanation,
plus a tab strip, rather than one dense table. A surface the station does not provide stays visible
and says why.

Simulation time now advances in the shipped application. `useSimulationClock` starts the frame
driver while a campaign is open, republishes the clock the engine answered with (throttled to a
quarter of a second, because simulation time moves every 50 ms quantum), forwards the projection
topics an elapsed delta invalidated, and feeds unpaused real time to the interval autosave. A new
campaign still starts paused, so nothing moves until the player asks.

### Station surfaces

| Surface | What it does |
|---|---|
| Market | Both quote sides, stock and supply kind per listing; buy with a quantity and a destination; sell from the hangar or the hold; inspect an item and compare it with another; an expandable explanation of each price. |
| Hangar | The station hangar and the docked ship's hold side by side with their capacity, a move control per stack, and the same inspection and comparison. |
| Fitting | The worn fit, then a draft: every slot the hull offers, the modules the player owns that may occupy it, the ammunition each turret accepts, online state, what the draft is missing, and the ship committing it would produce. |
| Services | Repair, resupply and insurance, each through the same preview-and-confirm path as a market transaction. |
| Ship | Layered defences and resistances, capacitor and endurance, fitted weapons, undock validity, and every derived statistic with the calculation that produced it. |

### The action registry, previews and pending commands

`src/ui/actions/registry.ts` defines each action once — id, label key, icon, default shortcut,
remapping category. Buttons, the hub tiles, the tab strip and the keyboard handler all read the
same entry, and availability comes from a projection rather than from the interface. An unavailable
action stays visible, is disabled, and carries its reason as its accessible description.

`useActionRunner` refuses a second start of an action whose command is still in flight, so no
control can submit a command twice. `useActionShortcuts` binds the registry's defaults as discrete
commands; it ignores modifiers, key repeat, text entry and anything inside a modal.

`useTransactionPreview` asks the engine for a preview, keeps the returned token untouched and hands
it straight back on confirmation. On `STALE_PREVIEW` it shows the engine's replacement, says that
something changed, and requires a fresh confirmation — the player is never charged a price they
were not shown.

`useStationData` is the only store, and it holds nothing authoritative. It re-reads exactly the
projections a command's invalidation topics cover, drops a read a newer one has overtaken, and
routes an `autosaveRequested` result through the campaign session's save policy.

### Contract changes (protocol version 5)

Three read-only additions, no new domain authority and no change to campaign state:

- `content.messages` returns one locale's authored message catalogue. Projections carry message
  keys and the keys for an item's name or a station's title are authored beside the content, so the
  interface — which may not read the content bundle — asks the engine for the text.
  `ContentTextProvider` layers it under the interface's own messages.
- `fitting.draft` now carries `options`: every slot the hull offers with the modules the player owns
  locally that may occupy it, each with its fitting cost, how many are available and the ammunition
  it accepts. Which module fits which slot is a content rule, so the engine answers it.
- `ResupplyLineData` carries `ammunitionNameKey`, so a resupply line names its charge without the
  interface deriving a message key from an identifier.

Protocol version is **5**. Campaign-state and save-format versions are unchanged at **4**, and
`tests/fixtures/saves/format-4.json` remains the golden save. A save records the protocol version
for diagnostics but is not gated on it, so existing development campaigns keep working.

### Save reporting

Capture is synchronous but the write is not, so `campaign.save` always answers `pending`. The
session now follows the write with a bounded re-read until it settles, instead of leaving the
interface reporting "Saving…" indefinitely. This was a latent reporting bug that the busier station
screen made visible.

## Exit gate

All checks passed:

- `npm run verify`: type checking, architecture boundaries, content validation, **788 unit tests**,
  **65 integration tests**, **47 component tests**, traceability and the production build.
- `npm run test:browser`: **15 tests**, including the full station preparation flow against the
  shipped build, the real worker and IndexedDB.
- `npm run test:accessibility`: **13 tests**, including an axe audit of every station surface and of
  an open confirmation, keyboard-only purchase, focus trapping and return, and a doubled interface
  scale.
- Traceability: **80 requirement ids**, all covered by tests.
- The three Playwright runs were repeated to check for flakiness; all passed.

Component coverage includes projection rendering, a stale preview and its replacement, focus return
after a dialog, duplicate-submit prevention, refusal reasons, content-name resolution and the
keyboard shortcut path.

## Deliberately not done

- **Location beyond the station.** Functional Specification 19.1 also asks the frame for the current
  system, site and danger rating. Site definitions, current-site runtime state and the world
  projections that carry them are Phase 9's declared deliverables, so the frame shows the station
  name the station projection supplies and gains the rest in Phase 9-10. Undocked readouts — layers,
  capacitor, speed, movement command, locked targets — belong to the combat phases.
- **Notifications.** Functional Specification 19.7 and the notification levels are Phase 18.
- **Full accessibility verification.** Phase 8 establishes the focus, keyboard and reason patterns
  and audits the surfaces that exist; the complete pass is Phase 19.
- Deferred trade surfaces (remote quotes, price history, routes) and every screen belonging only to
  a deferred system are absent rather than shown empty.

## Handoff to Phase 9

- The station screens read `useStationData`; add site, travel and destination projections to its
  topic map rather than introducing a second store.
- Undock belongs beside the ship's undock validity, which `ShipPanel` already reports. The command
  itself, and the encounter-destination selection in front of it, arrive with Phase 9.
- New actions go in `src/ui/actions/registry.ts` with a label key, an icon and, if they are frequent,
  a shortcut that does not collide with the six the station already uses (h, m, g, f, r, y, p).
- The frame driver's `onResult` is how the interface learns what simulation time invalidated; a
  tactical projection should be refreshed from those topics, not by polling.

No open questions.
