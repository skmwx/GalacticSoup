# Persistent cockpit implementation

Implemented on 31 October 2026 from the accepted first proposal in [proposals.md](proposals.md).

## Delivered layout

- The game uses the available window width. A compact campaign header keeps location, wallet, clock, pause/resume and save status visible; it stays at the top while scrolling on desktop.
- Station navigation and actual ship readiness occupy the left column. The active service occupies the centre; notifications and flight school occupy the right column.
- Departure uses compact site cards and one inspected briefing. Inspecting a card does not choose a destination. The existing Choose action still goes through the engine, and choosing, undocking and warping remain separate commands. Wreck bookmarks and undock warnings/confirmations remain available.
- In space, defensive layers, capacitor outlook, speed, movement order, locks and running-module counts occupy the ship rail. Movement/travel, weapons and modules sit immediately below the map. Objects, selection, locks and encounter information use the shared right context column.
- Per-weapon management/ammunition, coordinate navigation, capacitor rate details and the combat log expand on demand. Live weapon status, magazine, target, hit chance and limiting factors remain in the main panels. Encounter results remain visible rather than being hidden behind a disclosure.
- Save, guidance and campaign management are in **Game menu**. Close, Reset and campaign metadata are under **Campaign management**. Reset retains its explicit confirmation; closing the menu cancels the pending reset confirmation. Build/engine diagnostics are under **Settings**.
- Notifications no longer reserve empty space above gameplay. They remain mounted across docking/undocking, retain their announcements and sounds, and show save failures persistently. Bounded scroll regions support keyboard access.
- Narrow windows reflow into readable sections. The schematic adapts its drawing viewport to its displayed dimensions; pointer placement and panning use the SVG transform so resizing does not change which point receives an order.

No engine rules, command contracts, authored game content or save formats changed. Existing registry actions, remapped shortcuts, previews, stale-price reconfirmation and availability reasons remain in use.

## Observed layout change

At 1440 × 900, default scale, guidance enabled:

| Measure | Previous layout | Cockpit layout |
|---|---:|---:|
| Station heading position | approximately y=757 | y=169 |
| Departure document height | 2,165px in the reviewed starting state | 900px in the reviewed ready/selected state |
| Ordinary flight controls | below the map on a 2,906px page | pause, movement, fire and shield booster within the initial 900px view |

The states differ slightly because the review campaign has docked again. These measurements demonstrate normal-state layout; expanded explanations, longer fits, translations and larger text can require scrolling. The aim is to keep frequent decisions together, not to clip content into a fixed screen.

[Station screenshot](implemented-station.png) · [Space screenshot](implemented-space.png)

## Validation

The new browser checks cover management separation, reset cancellation, briefing inspection versus destination selection, desktop control positions, and reflow at 1920, 1024 and 390px widths. Existing accessibility checks exercise station services, confirmations, combat, keyboard commands, large text, high contrast, reduced motion and loss recovery.

Build, type checking, architecture checks and whitespace checks pass. All 34 accessibility cases pass. All 114 component cases have passed across the suite and an isolated retry of one case that exceeded its five-second timeout during concurrent browser testing. A docking case logged React update-depth warnings during concurrent bulk testing; isolated runs of that case against both the original checkout and this implementation pass without warnings.

Browser checks follow the new menu and disclosure paths. The guided-loop helper explicitly reconfirms refreshed transaction quotes when the running clock changes a preview, as the existing stale-price prompt requires.

29 unique Chromium browser cases pass across the main run and targeted reruns, including station trading/fitting, mouse and keyboard combat, offline play, save integrity, traversal, onboarding, and destruction/recovery. The optional long multi-site progression scenario was stopped after clearing the three-opponent Pirate Patrol and entering the loot phase; its final mastery-site completion is not verified here. Its shield-health reader now uses the live ship-layer percentage instead of the removed header summary.
