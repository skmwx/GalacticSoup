# MVP UI review 01 implementation plan

Status: in progress; UIR1-01 complete.

Source review: `human-input/MVP-review-01.md`. Context: `00_GameDesignBrief.md`, `01_FunctionalSpecification.md`, `02_TechnicalSpecification.md`, `human-input/CurrentState.md`, and the implemented MVP.

## 1. Objective and delivery model

Address every finding in the human review while retaining the playable MVP combat, upgrade, and recovery loop. Deliver ten phases in the order below. Each phase is one coding-agent session, including its focused verification and handoff. The final phase integrates and verifies the completed changes.

Phase IDs use **UIR1** to distinguish this work from the completed original MVP phases. All phases start as pending. Implementation agents should update the status table and write a completion note when their phase is finished.

| Phase | Session deliverable | Depends on | Status |
|---|---|---|---|
| UIR1-01 | Compact action controls and accessible disabled-reason tooltips | — | Complete (`agent-comm/status/uir1-01-completion.md`) |
| UIR1-02 | One campaign header, icon game menu, consolidated settings | 01 | Pending |
| UIR1-03 | Buy/sell market modes, slot labels, ammunition compatibility | 01 | Pending |
| UIR1-04 | Hangar/hold columns and one/all/custom transfers | 01 | Pending |
| UIR1-05 | One compact fitting surface with inline editing | 01 | Pending |
| UIR1-06 | Station overview cleanup and inline priced services | 01, 02 | Pending |
| UIR1-07 | Destination selection in space and Harbor return destination | 02, 06 | Pending |
| UIR1-08 | Empty-radar context menu for setting a course | 01, 07 | Pending |
| UIR1-09 | Compact combined equipment panel and navigation columns | 07, 08 | Pending |
| UIR1-10 | Integrated UI acceptance, release checks, human review handoff | All preceding phases | Pending |

This order gives each session a working application to leave behind. Dependencies describe required foundations; they are not a request to run agents concurrently.

## 2. Interpretation and constraints

These implementation decisions make the review concrete without requiring another design round:

- **One header:** one compact persistent campaign header containing the existing icon, pilot, system/location context, credits, simulation clock, pause control, save status, and icon game-menu trigger. Retain required site/danger information without repeating it in stacked banners. Local screen headings may remain, but must not recreate the three large header bands. Allow wrapping at narrow widths or larger text scales.
- **Game menu:** reuse the current settings icon as an icon-only trigger with an accessible name. Preserve existing game-menu functions, including guidance, saving, campaign management, and reset confirmation. Add Settings to this menu; retain the current settings controls and add sound/alert configuration there.
- **Tooltips:** move explanations of disabled controls out of normal layout. They must remain available on hover and keyboard focus. This does not remove transaction errors, fitting violations, undock warnings, travel blockers, danger notices, or save failures: these explain game state and still need appropriate visible presentation.
- **Market:** Buy and Sell are player-perspective modes. Buy displays what the player pays; Sell displays what the player receives and only locally owned goods. Ownership means local hangar or active ship cargo, excluding fitted modules and loaded magazines. Retain recovery-grant restrictions and explain unsellable owned goods. A compatibility marker means ammunition is supported by at least one currently fitted weapon; it does not imply that weapon is online, loaded, or presently able to fire.
- **Transfers:** All means the entire selected source stack, One means one unit, and the quantity field applies to a separate custom transfer. All must never silently become a partial transfer when cargo is full. Preserve the specification's Maximum that fits option as a distinct operation.
- **Fitting:** the compact surface is both the view and editor. Opening a module picker or changing ammunition starts/reuses the existing engine-side draft. Apply and Revert remain explicit. Selecting a module must not immediately mutate the committed ship.
- **Services on the main screen:** put repair, ammunition resupply, and the existing insurance operation on the docked Overview. Repair armor, Repair hull, and Repair all show their engine-quoted prices. Resupply shows its quoted total and retains its current meaning: refill the chosen loaded ammunition types, using local inventory and purchases as the engine currently does. Buying a reserve cargo stock is outside this request.
- **Prices and confirmation:** a displayed price streamlines entry to the existing confirmation flow. Every priced operation still requires confirmation of its exact total, including zero-credit repair. Functional Specification §§10 and 20 require this; the review does not explicitly remove confirmations.
- **Repair variants:** armor-only restores armor; hull-only restores hull; Repair all restores both. Retain free shield restoration and capacitor recharge with repair service, including a usable Repair all action when only shield/capacitor needs restoring. Apply the existing formula to the selected paid layers, with one final rounding step. Record this extension in Functional Specification §10 during phase 06.
- **Departure:** retain undock readiness and warning confirmation, but move encounter/wreck selection and briefing into space. Undocking requires no selected site and still arrives at the station site. Update the older docked-selection wording in `MVPScope.md` during phase 07.
- **Harbor:** use the station's localized authored name (currently Borrell Harbour), not a hard-coded label. Offer it with encounters and wreck bookmarks in the destination chooser. Returning is ordinary warp followed by the existing Dock command, with the same travel rules as today. Remove the separate visible Retreat button; preserve a useful return shortcut through the shared return action.
- **Set course:** right-clicking empty radar space opens a menu at that location. Set course issues Move to point only when activated. Object right-click continues to open object commands. Provide an equivalent keyboard path using the radar's current point or center, with an announced destination and a remappable action; no coordinate-entry disclosure is needed.
- **Space layout:** radar above two columns: Navigation in one, combined weapons/equipment in the other. At narrow widths, stack them in reading order. Filter Your ship from the object list only; retain the player on the radar and in all authoritative projections, movement calculations, status displays, and camera behavior.

Architectural rules apply throughout: gameplay changes go through the gateway; the engine supplies legality, compatibility, prices, and previews. UI state holds presentation only. Reuse the action registry, localization, preferences, and existing components. Keep the MVP's current content and deferred-feature boundaries.

Do not edit `human-input` files, read `ai-ignore`, or consult the archive for routine implementation. Preserve unrelated local changes.

## 3. Session contract

At the start of each phase, read root `AGENTS.md`, the applicable folder instructions, this plan, the human review, and the previous phase's completion note. Read the relevant specification sections and current implementation before editing. Do not assume paths and interfaces in this plan remain unchanged after earlier phases.

Each session must:

1. Implement its complete vertical slice, including necessary projection/protocol/schema updates and affected test helpers.
2. Preserve existing behavior outside its scope and leave intermediate flows usable.
3. Update relevant automated scenarios and traceability. Test behavior and failure boundaries, not CSS implementation details. Pure layout changes need visual verification rather than new mirror-image unit tests.
4. Run `npm run typecheck`, `npm run check:architecture`, and `npm run build`, plus the relevant focused tests identified below. Run content validation when content changes and protocol/schema parity checks when contracts change.
5. Visually inspect affected screens at desktop size and a narrow layout; capture useful screenshots for the completion note. Check hover/focus tooltips, keyboard operation, text scaling, and high contrast where the phase changes interaction.
6. Write `docs/agent-comm/status/uir1-XX-completion.md`: implemented changes, actual files, commands/results, visual evidence, contract/version changes, remaining issues, and guidance for the next session. Mark this plan's phase complete only when its acceptance criteria pass.

Protocol changes must update TypeScript contracts, JSON schemas, validation, handlers, projections, gateway callers, and relevant fixtures together; increment the protocol version and follow the repository's compatibility rules. A protocol version change alone is not a reason to change the save format. If persisted data actually changes, supply its migration and regression coverage in that phase. Preserve stable IDs and old campaigns wherever the implementation can avoid persisted changes.

Test selectors and support helpers must migrate with the UI that changes them. Do not leave all broken browser tests for phase 10. Re-record golden/contract fixtures only after explaining and verifying the intended semantic difference; never to conceal a failure.

## 4. Phases

### UIR1-01 — Compact actions and disabled-reason tooltips

**Outcome:** shared controls support the denser screens, and disabled reasons stop consuming layout space across the application.

**Work:**

- Extend `src/ui/actions/ActionButton.tsx` and its CSS with an icon-only presentation that retains the full localized accessible name and contextual item name. Hide the visible shortcut badge in that presentation; keep shortcut semantics and discoverability in the tooltip.
- Replace the inline reason span with a shared accessible tooltip treatment. Account explicitly for native disabled buttons, which cannot receive keyboard focus: use a focusable explanation wrapper or a guarded `aria-disabled` control. Pointer and keyboard activation must both remain blocked, including while pending.
- Audit raw buttons/selects outside ActionButton for inline disabled explanations and missing reasons. Use the same treatment on affected station tabs, menus, fitting candidates, and navigation controls where practical.
- Keep tooltips outside normal document flow, within the viewport, and dismissible with Escape. Announce labels/reasons to assistive technology; do not rely solely on native `title`.

**Primary code:** `src/ui/actions/`, `src/ui/common/`, localization messages, and direct disabled-control callers.

**Acceptance and verification:** unavailable and pending controls cannot send commands; hover and keyboard focus reveal the correct reason without moving adjacent content; icon-only controls have meaningful accessible names. Exercise representative station, space, and dialog controls. Run action-runner, station, combat, and settings component tests plus affected accessibility scenarios.

### UIR1-02 — One header, game menu, and settings

**Outcome:** campaign play has one compact header, an icon game menu, and one settings destination.

**Work:**

- Reconcile header ownership across `AppShell`, `GameRoot`, `PlayScreen`, and `CampaignFrame`. Remove the game title/tagline and routine engine-ready text from the play layout while retaining the icon and necessary connecting/failure feedback.
- Compose pilot/location, wallet, clock, pause, save state, and the menu into the single header. Check docked as well as undocked system naming; expose missing context through a projection rather than importing game content into the UI.
- Move existing game-menu contents behind the settings-icon trigger and add Settings. Preserve reset safeguards, Escape/outside dismissal, focus return, guidance visibility, and save/close behavior.
- Embed `NotificationSettings` in Settings and remove the separate Sound and alerts entry from the notification toolbar. Retain event-log access and notification delivery.
- Resolve preference-provider ownership: AppShell and PlayScreen currently each create a PreferencesProvider. Ensure settings changes affect the active play view immediately through one effective preference state, including audio and category visibility. Keep settings usable before opening a campaign and respect test-injected preference storage.
- Update shared menu-opening helpers as well as direct tests that currently locate text labeled Game menu.

**Primary code:** `src/ui/shell/`, `src/ui/campaign/GameRoot.tsx`, `src/ui/frame/`, `src/ui/settings/`, `src/ui/notifications/`, `src/ui/preferences/`, `tests/support/cockpit.ts`.

**Acceptance and verification:** one header on both station and space screens; pilot and system remain readable; game-menu icon has a name/tooltip; every previous menu function is reachable; settings changes immediately affect gameplay and persist after reopening. Run AppShell, CampaignPanel, Settings, Notifications component tests and shell/campaign/presentation accessibility and browser scenarios. Verify startup, close, and resume too.

### UIR1-03 — Market modes and item suitability

**Outcome:** the market presents one transaction direction at a time and makes module slots and ammunition suitability visible before purchase.

**Work:**

- Add an accessible Buy/Sell switch, defaulting to Buy. Keep search and show only the active mode's table/actions and price column.
- Sell mode lists local owned stacks with quantities and source location, so identical items in hangar and cargo are distinguishable. Preserve unsellable/recovery-grant feedback and the shipless recovery-hull purchase flow.
- Use icon-only Buy, Sell, and Inspect controls from phase 01, with item-specific accessible names. Preserve quantities, destination inventory choice, inspection/comparison, exact totals, and confirmation handling.
- Add engine-projected market metadata for module slot category and ammunition compatibility. Current `ItemData` contains only generic item information, so this is not just rendering existing fields. Prefer a small market-specific extension to avoid changing every asset schema unnecessarily.
- Describe supported weapon families/types for each charge, and mark a match against at least one weapon in the current committed fit. Derive this from existing compatibility rules, not names or duplicated UI heuristics. Refresh after fit changes; handle no ship, no weapons, and incompatible charges.
- Apply the one-price presentation to mode-specific inspection/price explanations where relevant; retain expanded formula explanations.

**Primary code:** `MarketPanel.tsx`, `ItemDetail.tsx` as needed, `src/engine/projections/economy.ts`, `src/engine/projections/items.ts`, `src/protocol/economy.ts`, market schemas and localization.

**Acceptance and verification:** Buy shows only the player purchase price; Sell shows only owned local items and their sale price; remote, fitted, and magazine goods are absent from Sell. Module slots and both matching/nonmatching charge compatibility are understandable without buying first. Tests cover one purchase, one sale from each local source, grant refusal, mode switching, and a compatibility update after refitting. Run affected economy/protocol tests, StationScreen tests, station browser/accessibility flows, and recovery purchase coverage.

### UIR1-04 — Hangar and hold transfers

**Outcome:** two inventory columns make movement direction clear and support One, All, and custom quantities.

**Work:**

- Place hangar and active hold in a responsive two-column container. Each lists its own items, quantities, and volume; show cargo capacity/free space clearly.
- Provide directional One and All actions plus the quantity field and custom-transfer action for each stack. Keep inspection available with compact controls.
- Validate custom quantities as positive whole integers within the current source quantity. Do not silently coerce blank, fractional, negative, or excessive input into an unrelated transfer amount.
- Use the existing `inventory.maximum` query for a separate Maximum that fits action and cargo-capacity feedback. The engine still validates all transfers atomically.
- Handle a stack disappearing, changing quantity, or merging after transfer; clear stale row drafts appropriately. Shipless play shows the hangar and an explanation for the absent hold.

**Primary code:** `HangarPanel.tsx`, `Station.module.css`, inventory query callers, localization.

**Acceptance and verification:** move one, a full stack, and a chosen quantity in both directions. An oversized All operation moves nothing and explains why; Maximum that fits moves the allowed quantity. No item loss, duplicate submission, stale quantity reuse, or horizontal page overflow. Run focused station component/browser/accessibility tests and inventory integration tests if command use changes.

### UIR1-05 — One compact fitting screen

**Outcome:** the initial compact fit remains the working surface throughout inspection, preview, and editing.

**Work:**

- Unify `FittedSlots` and `OpenDraft` presentation around one slot-row layout. Show committed or draft-preview ship information at the top, modules in the middle, and weapon statistics at the bottom.
- Add a small Change module control for every slot, including empty slots. Its popup/dropdown shows engine-provided candidates, local availability, restrictions, and Remove/Empty where applicable.
- Start an engine draft lazily on first edit, then reuse it. Retain online/offline control and compatible ammunition choice on each applicable weapon row. Handle a module change that invalidates the previous ammunition choice.
- Reuse the existing draft preview, commit, and revert commands. Preserve fitting-resource limits, missing items, warnings, and formula/stat explanations. Avoid duplicated full ship summaries beneath every editing state.
- Define leaving the screen with uncommitted changes: offer Apply, Discard, or Stay; never leave an invisible draft that unexpectedly blocks undocking. Account for settings/guidance navigation and shipless recovery.

**Primary code:** `FittingPanel.tsx`, `ShipPanel.tsx`, station CSS, `usePlayData.ts` and navigation integration as needed.

**Acceptance and verification:** opening fitting does not reveal a second redundant screen; changing a module or charge previews the effect before Apply; Revert restores the committed ship without inventory changes. Test empty slots, removal, offline modules, invalid fits, unavailable candidates, and navigation with a dirty draft. Run fitting component/integration tests and station, guidance, and relevant recovery browser/accessibility flows.

### UIR1-06 — Overview and priced station services

**Outcome:** Overview contains useful station operations instead of duplicate navigation tiles; repair/resupply require fewer navigation steps.

**Work:**

- Remove Overview's duplicate service/navigation tiles, retaining the left rail. Preserve useful readiness, sortie summary, loss report, no-ship guidance, and guidance markers on the rail.
- Mount compact repair, resupply, and insurance controls on Overview. Show the exact repair and resupply totals on their buttons, including loading/unavailable states; fetch previews while the operations are visible rather than only after opening a service dialog.
- Add armor-only, hull-only, and all-layer repair intents end to end. Current `repair.preview` takes only a ship and currently repairs everything; extend its payload, token binding, preview, confirmation handler, and schemas. Keep omitted selection equivalent to existing Repair all for compatibility where supported.
- Calculate each price in the engine using the selected damage fractions and existing service/standing multipliers. Revalidate paid damage, wallet, and service state at confirmation. Retain free shield/capacitor restoration and its zero-price confirmation path.
- Reuse the existing transaction confirmation UI, with the selected repair scope and exact total clear. Resupply must still disclose inventory usage, purchases, and resulting ammunition, while insurance retains coverage/premium information.
- Remove the redundant Services navigation entry once everything is reachable on Overview. Redirect old `station.services` action/guidance targets to Overview as needed so saved onboarding and existing bindings stay useful.
- Update Functional Specification §10 for the repair variants and §19.5 if needed for the consolidated station flow. Do not edit the human review.

**Primary code:** `StationScreen.tsx`, `ServicesPanel.tsx`, `TransactionDialog.tsx`, `useTransactionPreview.ts`, `src/engine/application/economyCommands.ts`, economy projections/contracts/schemas, action registry, guidance content/projections as affected.

**Acceptance and verification:** no duplicated navigation tiles; armor-only and hull-only repair affect the intended paid layer and charge the correct rounded amount; Repair all includes both and the free restoration; resupply and insurance remain reachable. Confirmations reject genuinely stale prices and never double-charge. Cover no damage, shield/capacitor-only restoration, insufficient credits, and no active ship. Run repair/economy formula and integration tests, protocol parity, station/guidance component and browser/accessibility flows.

**Existing issue to account for:** Q12 in `agent-comm/requests/questions-and-answes.md` records overly broad preview invalidation during natural regeneration; its answer is blank. Reproduce it when validating live price previews and record whether this phase changes or inherits it. Do not silently fold the proposed asset-version/golden-replay refactor into this session. If it prevents this slice from being usable, create a separately scoped remediation session and record the dependency before declaring phase 06 complete. Otherwise carry the known issue explicitly into final acceptance.

### UIR1-07 — Choose destinations in space and return through Harbor

**Outcome:** players undock without choosing an encounter, then inspect and choose destinations in the space navigation panel.

**Work:**

- Extract undock readiness/confirmation from the encounter-selection presentation in `DeparturePanel`. Keep Departure focused on leaving safely; retain the existing warning preference and invalid-fit/draft/no-ship blocks.
- Move encounter briefings, tier, opponents, bounty/loot disclosure, and completion count to space navigation. Inspecting a briefing must not issue movement. Keep all encounters visible, including harder/current/unavailable destinations with reasons.
- Move wreck destination/recovery information too: location, threat disclosure, remaining contents, and expiration countdown. Preserve bookmark-specific arrival behavior and handle expired bookmarks safely.
- Add the station to the destination projection/chooser as a real station destination. Keep explicit station/encounter/bookmark identities; do not disguise the station as an encounter with fabricated tier or rewards. Project appropriate availability and local docking behavior.
- Current destination selection commands are docked-only. Prefer presentation-only choice in space followed by existing warp commands if this preserves encounter/onboarding semantics. If persistent selection is required, extend its engine validation/protocol deliberately. Verify `selectedEncounterId`, `selectedBookmarkId`, encounter entry, and guidance before deciding; do not merely move a disabled button.
- Route Harbor return through existing ordinary warp/dock behavior. Remove the separate Retreat button; retain a remappable return shortcut with the same legality/feedback. At the station site, offer docking rather than an invalid warp to the current site.
- Update `MVPScope.md` §§2–5, affected guidance, component comments, test helpers, and browser scripts that currently select the encounter before undocking. Preserve existing saves and old selected destinations as useful initial selections where possible.

**Primary code:** `DeparturePanel.tsx`, `CommandBar.tsx`, `SpaceScreen.tsx`, navigation projections/contracts/schemas, `src/engine/domain/navigation/availability.ts`, `src/engine/application/navigationCommands.ts`, guidance, shared browser helpers.

**Acceptance and verification:** start/resume, undock without a destination, inspect different encounters, choose one and warp, return through the Harbor choice and dock. Repeat with a player-wreck bookmark and after destruction/recovery. Disclosure remains available before warp. Tests also cover already-current destinations, expired wrecks, transit, and blocked commands. Run navigation/encounter/guidance integration tests, protocol checks when changed, and space/station/loss/guidance browser and accessibility flows.

### UIR1-08 — Set course from the radar

**Outcome:** empty-space context commands replace the coordinate-entry disclosure.

**Work:**

- Extend `SiteView`/`SpaceScreen` menu state to distinguish an object target from a world point. Convert pointer coordinates through the SVG transform and camera; store the world point when opening the menu so later camera motion cannot change its destination.
- Open a point menu on secondary click over empty radar space, with Set course using the existing `movement.moveToPoint` command and projected availability. Opening/dismissing the menu must not move the ship.
- Keep object hit targets, selection, right-click commands, left-drag panning, zoom, and centering working. Do not let object secondary clicks bubble into a point command.
- Add the keyboard equivalent described in section 2 and a discoverable hint. Reuse menu focus, Escape, outside-click, focus-return, and viewport-clamping behavior.
- Remove Coordinates & point navigation, numeric coordinate fields, and the obsolete arm-then-click state. Preserve command feedback and the active movement order display.

**Primary code:** `SiteView.tsx`, `SpaceScreen.tsx`, `ObjectContextMenu.tsx` or a shared context-menu component, `CommandBar.tsx`, `camera.ts`, action registry and localization.

**Acceptance and verification:** right-click at multiple points after pan, zoom, and viewport resize; Set course sends the corresponding world coordinates exactly once. Object clicks still produce object commands; menus cancel without movement; keyboard users can set a course without a pointer. Run camera tests where geometry changes, SpaceScreen tests, and space browser/accessibility flows, including paused and in-transit states.

### UIR1-09 — Compact space equipment and navigation

**Outcome:** weapons and other active equipment share a compact panel beside Navigation beneath the radar.

**Work:**

- Compose `WeaponsPanel` and `ModulesPanel` into one equipment surface, reusing row logic and action handlers. Preserve target choice, fire/deactivate, reload/charge choice, shield booster/module toggles, cycle/reload status, ammunition, capacitor requirements, and useful weapon-effectiveness details.
- Place equipment and Navigation in two columns in the same row immediately below the radar. Give both a shared vertical region; use controlled internal overflow only where necessary, with visible/focusable controls and sensible narrow-screen stacking.
- Filter the player ship from `ObjectList` while leaving its radar marker, status, camera tracking, and authoritative data untouched. Preserve selection/lock controls and stale-target handling.
- Rebalance the radar and surrounding layout so the combined header and panels improve actual working space. Retain readily reachable pause, stop, fire, defense, return, selected-object information, notifications, loot, and combat-log access.
- Update old panel selectors/helpers without weakening assertions about control visibility or functionality.

**Primary code:** `SpaceScreen.tsx`, `Space.module.css`, `WeaponsPanel.tsx`, `ModulesPanel.tsx`, `ObjectList.tsx`, and cockpit tests.

**Acceptance and verification:** one equipment panel, two desktop columns beneath the radar, no player row in the object list, and a visible player marker on the radar. Complete a fight using weapons, reload, movement, and shield booster. Check all controls while paused, running, in transit, looting, and returning. At 1440×900, frequent controls remain within the working view; at 1920, 1024, and 390 pixels wide there is no page-level horizontal overflow. Verify supported scaling, high contrast, reduced motion, and keyboard scrolling. Run combat/space component tests and cockpit/combat/space browser/accessibility tests.

### UIR1-10 — Integrated acceptance and review handoff

**Outcome:** the full review is covered by passing evidence and a coherent human-review build.

**Work:**

- Review every source finding against section 5 below and the final application. Fix small integration gaps; a substantial new rule/engine issue gets a clearly scoped follow-up session instead of being hidden inside release work.
- Play the full loop: start/resume → buy → transfer → fit/apply → repair/resupply → undock → inspect/select encounter in space → warp → fight → loot → Harbor return → dock → sell/upgrade → close/reopen. Also verify loss, recovery purchase/grant, and return to the player's wreck.
- Verify the header/menu/settings in both docked and undocked states, immediate preference effects, notification delivery, disabled reasons, focus return, keyboard-only paths, and all new compact controls.
- Run `npm run verify`, the Chromium and Firefox browser/accessibility suites, and `npm run release:gate`. Use the gate's actual records to report failures, retries, or unavailable installed-browser checks. Review any new balance/golden differences; do not blindly refresh baselines.
- Update `docs/agent-comm/release/playtest-script.md` for the revised flows and write a review summary with screenshots, checks, and any inherited issues. Update release evidence using the existing workflow; record a candidate only after the gate passes. Human acceptance remains a human result.

**Acceptance:** each review finding has a phase and final evidence; applicable automated checks pass; the revised loop and recovery path work; no regression is concealed by changed selectors or weakened checks. The handoff distinguishes implementation completion, automated verification, and human approval. Leave `human-input/CurrentState.md` for the operator to update.

## 5. Coverage of the human review

| Review finding | Owner |
|---|---|
| Collapse three headers; retain icon, player, and system; remove title/engine-ready copy | 02 |
| Settings icon becomes the game menu; preserve menu entries and add Settings | 02 |
| Move sound/alert controls into Settings | 02 |
| Disabled reasons in tooltips across views | 01, verified by each later phase |
| Remove docked Overview's duplicate navigation buttons | 06 |
| Buy/Sell market switch, one price side, owned goods in Sell | 03 |
| Charge-to-weapon suitability and current-fit compatibility indication | 03 |
| Icon-only Buy/Inspect/Sell; visible module slot categories | 01, 03 |
| Two-column hangar/hold, transfer One/All/custom | 04 |
| Merge fitting display/editor; per-slot module picker and weapon ammunition dropdown | 05 |
| General ship information above fitting; weapon statistics below | 05 |
| Services on main screen; armor/hull/all repair with prices; ammunition resupply | 06 |
| Select a site in space rather than at departure | 07 |
| Harbor as destination; remove separate Retreat button | 07 |
| Empty-space radar context menu with Set course; remove coordinate disclosure | 08 |
| Remove Your ship from the object list | 09 |
| Combine weapons/equipment; two columns with Navigation below radar | 09 |
| End-to-end, visual, keyboard, save/recovery regression verification | 10 |

## 6. Risks to retain in handoffs

- **Navigation and onboarding:** existing scope text, commands, guidance, and many browser helpers encode docked destination selection. Phase 07 must change the whole flow together.
- **Contract propagation:** generic item data and the repair command lack the new information/intent. Phase 03 and phase 06 need complete schema/contract updates; phase 07 may also need a destination-contract extension.
- **Hidden fitting drafts:** inline editing must not strand an unseen draft that blocks departure. The exit behavior belongs in phase 05, not final polish.
- **Settings synchronization:** moving controls alone is insufficient while multiple preference providers can hold independent state. Phase 02 owns immediate synchronization.
- **Existing stale confirmations:** Q12 is documented but unanswered. Track its actual status explicitly; do not claim this plan has already fixed it or weaken stale-price protection to hide it.
- **Compact accessibility:** icon controls, disabled controls, context menus, and internal panel scrolling need keyboard/focus verification. Density must not remove critical feedback or usable hit targets.
- **Session size:** if a phase discovers required work beyond its one-session boundary, finish a coherent verified slice, document the exact remainder, and amend the plan with a dedicated follow-up before marking the original phase complete. No handoff may rely on an unrecorded partial implementation.
