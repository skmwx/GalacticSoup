# Galactic Soup: UI layout proposals

31 October 2026 · Based on the running game at localhost:5173 and the current UI source.

## Recommendation

Use **Option 1, Persistent cockpit**, as the desktop direction. It makes productive use of both sides of the screen and keeps the information needed for an action near its controls. Borrow Option 2's inspectors for long explanations, ammunition management, and comparisons. Option 3 is a useful alternative if making the preparation loop easier to learn is the priority.

These are proposals, not changes to the game. The HTML files use sample data and never call the engine or read/write campaign storage. Each offers station and space previews; the space preview illustrates an encounter rather than reproducing a recorded combat session. Sample prices outside the inspected departure data are illustrative.

**[Open the mockup gallery](index.html)**. With the existing development server running, visit [the browser gallery](http://localhost:5173/docs/ui-proposals/index.html). The folder also works offline by opening `index.html`; it has no external dependencies.

## What is causing the current problem?

At a 1440 × 900 viewport, default scale, with a fresh review campaign and guidance visible:

| Observation | Effect during play |
|---|---|
| The shell is capped at 78rem, including its padding. On a 1920px display that leaves about 672px outside it. | Available desktop width cannot relieve the vertical stack. |
| Branding, campaign readouts, a full control row, campaign details, and save status precede gameplay. | Persistent information consumes the space that should support the current decision. |
| Resume, guidance, Save, Close, and Reset share one row and similar emphasis. | Routine actions compete with campaign management. Reset already has confirmation; its placement is the issue. |
| Notifications reserve 5.5rem even when there are none, with log/settings controls below. | Empty state still pushes the game down. The reservation prevents jumping, so removing it alone would introduce another problem. |
| Full-width flight school repeats its hide action and puts substantial text before the activity. | Help becomes an obstacle between a player and the controls it explains. |
| Station services appear as large navigation buttons and again as hub tiles. | Repeated navigation consumes vertical space without adding capability. |
| Departure expands all site descriptions, enemy compositions, bounties, and possible loot simultaneously. | Comparing three sites requires reading and scrolling through a tall table. |
| Space puts commands below the map, then ship/weapons/modules, then locks/encounter/log. | Seeing a target, choosing a command, and checking its consequences involve separate scroll positions. |

Measured examples: the station heading begins around y=757 and Departure creates a 2,165px document. After choosing Pirate Scout and undocking while paused, the document is 2,906px tall; the space section starts near y=805, commands near y=1,443, weapons near y=1,770, and locks near y=2,633. These are illustrative measurements of those states, not universal limits. They change with text size, guidance and content.

Sources in this repository: [shell layout](../../src/ui/shell/AppShell.module.css), [campaign frame](../../src/ui/frame/CampaignFrame.tsx), [notifications](../../src/ui/notifications/Notifications.module.css), [space layout](../../src/ui/space/Space.module.css), [station screen](../../src/ui/station/StationScreen.tsx). The proposals preserve the intent of [Functional Specification §§19–20](../01_FunctionalSpecification.md): command-driven play, readable context, persistent flight instruments, pause, previews, explanations and accessibility. They do not add the full game's deferred systems to the MVP.

## Improvements shared by all three options

- **A compact persistent header:** small game identity, current system/site/danger, wallet, simulation time, pause/resume, save status, Events and Menu. Add experience when supported. Keep time controls immediately available. The prototypes illustrate pause/resume; existing rate controls should retain their current availability rules.
- **Separate management:** Menu → Save now, Settings, Flight school, Campaign management. Put Close, Reset, campaign metadata and diagnostics in campaign management. Reset keeps an explicit, non-optional destructive confirmation. Save errors remain visible outside the menu and take precedence over the routine saved indicator.
- **Stable notification placement:** bounded corner notifications and an Events badge rather than a reserved full-width empty block. Immediate danger also appears beside the affected ship/target state, with text/icon and existing sound cues. Ship destruction and save-integrity failures remain prominent and cannot disappear behind a drawer. Never cover the pause button, targeting or weapon controls.
- **Progressive detail:** keep actionable summaries visible; reveal formulas, full briefings and per-weapon controls in an inspector. Do not hide range, ammo, active effects, hostile locks, capacitor trouble or reasons a primary action is unavailable.
- **Master/detail departure:** retain tier, opponent count and bounty on every site card; expand one selected briefing alongside the list. Keep high-risk warnings visible before commitment. Choosing a site, undocking and warping remain distinct commands.
- **One station navigation system:** compact service navigation plus distinct overview actions where useful. Large hub tiles need not be duplicated above every service.
- **Preserve interaction context:** switching services retains filters, selected stacks, quantities and uncommitted fitting edits. Returning from an inspector restores focus and the previous working position. The simple mockups do not implement all this persistence.

## Option 1 — Persistent cockpit

**[HTML mockup](01-cockpit.html)** · Recommended for desktop play.

### Layout

`Compact header / [navigation + ship] [current activity] [guidance + context]`

Use a fluid three-column grid: roughly 236px left and 290px right at 1440px, with the remaining width for the activity. Increase useful panel width on large displays rather than extending short text lines across the whole screen.

At the station, the left column contains service navigation and ship readiness. The centre holds the chosen service; Departure uses a short site list and a selected briefing. The right column holds a compact flight-school hint and departure checklist. Undock sits immediately after the destination decision.

In space, the left column retains ship instruments. The centre contains the tactical view, nearby objects/selection, adjacent movement commands, and compact weapons/modules and encounter panels. Guidance occupies the right column. Do not repeat the same defence bars in the header and lower panels. Locked-target information belongs with selection and must remain visible as combat grows.

### Why it helps

The side areas become working surfaces, help stops consuming the top of the page, and ship state is available while making a decision. It best addresses the user's three complaints together.

### Tradeoffs

The centre becomes narrower, so market/fitting should be allowed to temporarily expand across the help column. At about 1200px, turn the right column into on-demand help/context. At smaller widths, fold the service rail into compact navigation and reflow panels. Avoid three cramped columns on a laptop. Long encounter lists need a bounded, keyboard-accessible list rather than making the entire interface taller.

### Implementation scope

Medium: restructure AppShell/CampaignFrame/PlayScreen; move guidance into a side region; rearrange SpaceScreen grid areas; replace expanded departure rows with master/detail. Reuse the current panels, action registry, engine availability reasons and dialogs. This is a layout change, not a simulation change.

## Option 2 — Focused workspace

**[HTML mockup](02-workspace.html)** · Best conservative change and best fit for data-heavy station work.

### Layout

`Compact header / [narrow service rail] [one wide workspace]`

A narrow, labelled service rail replaces the repeated station tiles. A one-line readiness strip sits above the workspace. Help, ship inspection and full calculations open on demand. Departure still uses master/detail, while Market and Fitting get more horizontal room for item lists and side-by-side inspection.

The space workspace keeps map and selected-object information together, with movement immediately below and a compact instrument/weapon strip after it. Routine equipment detail opens in an inspector, keeping the default space view focused on commands and live status.

### Why it helps

It removes most of the vertical shell overhead while retaining recognizable screen-based navigation. It has fewer simultaneous regions and provides the widest service workspace of the three options.

### Tradeoffs

More details require an extra click, and opening several inspectors in succession can become tedious. Keep critical live flight status outside inspectors, allow a pinned comparison in production, and avoid modal chains. An inspector should close with Escape and return focus to its trigger; pause must remain easy to reach. At narrow widths, show the inspector as a full-width surface with a clear back path. The prototypes use native dialogs for simplicity; a production side inspector could preserve more context.

### Implementation scope

Low to medium for the station shell; medium for the space HUD. Preserve current service components initially, then compact their default detail. This is a sensible incremental route if minimizing navigation changes matters most.

## Option 3 — Sortie flow

**[HTML mockup](03-sortie-flow.html)** · Best when learning and preparation are the main concerns.

### Layout

`Compact header / Review → Prepare → Depart / [current task] [readiness + guidance]`

Organize station activity around the outing: Review shows the last sortie and cargo; Prepare groups ship, fitting, services and supplies; Depart shows opportunities and readiness. Keep direct Market/Hangar/Fitting/Services/Ship shortcuts so experienced players can jump freely. The phases are navigation, not mandatory steps or unlock gates.

Undocking transitions to a dedicated flight console: broad tactical map, selected object at the right, movement strip and instruments/weapons directly below. The station task navigation disappears in space; returning to station restores the appropriate preparation context and surfaces recent loss or sortie results.

### Why it helps

It aligns the screen with the player's intent and makes the relationship between loot, resupply, fitting and the next destination clearer. It reduces the need to interpret several independent panels when learning the game.

### Tradeoffs

It is the largest navigation change. A sortie metaphor fits the present combat loop well but could become restrictive as trade, exploration and industry grow. Do not force an itinerary, choose targets or purchases for the player, or mark a dangerous fit as universally “ready.” Maintain direct service access and allow choosing any available site despite warnings.

### Implementation scope

Medium to high: add a presentation-level task-navigation layer over existing station services and redesign the station-to-flight transition. Reuse authoritative engine data and commands. No new readiness score, combat automation or enforced workflow is needed.

## Comparison

| Criterion | 1 · Cockpit | 2 · Workspace | 3 · Sortie flow |
|---|---|---|---|
| Use of spare width | Persistent useful side panels | Wider main workspace | Task area plus readiness column |
| Live information visibility | Highest | Essential summaries; details on demand | High in flight; task-specific at station |
| Station data work | Good; expand centre when needed | Best | Good; cross-task work needs shortcuts |
| Learning the loop | Contextual guidance | Familiar screens, fewer distractions | Strongest explicit sequence |
| Navigation disruption | Moderate | Lowest | Highest |
| Main risk | Too many panels on smaller screens | Excessive inspector opening | Overfitting the UI to combat sorties |

## Suggested delivery sequence

1. Compact the header, move campaign management into Menu, and remove empty notification height using a stable notification surface. Keep save failures and danger visible.
2. Move guidance beside the activity; consolidate station navigation. Convert Departure to master/detail and place Undock near the chosen destination.
3. Reorganize space around a map/selection/commands/instruments workspace. Start with compact existing components; retain full explanations and advanced controls in inspectors.
4. Validate under actual play: resupply → inspect fitting → select site → undock → warp → lock/fire → retreat → repair/sell. Include loss recovery, no-ship states, active repair, low capacitor and save failures.

## Validation and limits

Prototype checks cover the three station and space previews at 1920, 1440, 1024 and 390px widths, navigation, site selection, market filtering, menu/reset separation, flight preview, locking/fire, module activation, dialogs and Escape. Screenshots were visually reviewed for all three desktop layouts and the narrow-screen reflow. No production game files were changed.

For implementation, use these acceptance targets:

- At 1440 × 900 and default UI scale, pause, selected target, movement, weapons, defensive layers and capacitor should be reachable without scrolling between them in the normal encounter. Do not shrink text to meet this target.
- Station destination choice and Undock should share a working view. Market price, quantity, total cost and resulting balance must be visible together before confirmation.
- At 1024px and at 200% text size, reflow and permit ordinary document scrolling. On narrow screens prioritize readable panels over a desktop-style fixed cockpit. No horizontal page overflow or clipped controls.
- Verify maximum supported locks/modules/hostiles, translated text, high contrast, remapped shortcuts, keyboard focus and screen-reader order. Urgent effects and failures must not be hidden by tabs or inspectors.

The mockups are small presentation prototypes. They do not implement the real map, simulation, engine validation, transactions, all flight instruments, or every empty/error state. Production must use existing engine projections and action availability, preserve current shortcuts and confirmations, and test those states. A short page in the mockup is evidence of layout feasibility, not proof that every production encounter fits in one viewport.
