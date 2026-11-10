# UIR1-09 completion note - Compact space equipment and navigation

Status: complete. Date: 2026-11-10.

Implements phase UIR1-09 of `docs/MVPUIReview01ImplementationPlan.md`. It covers these review
findings (In Space):

- "Remove 'Your ship' from the list of objects present in the sector."
- "Combine weapons panel and equipment panel (where the shield booster is), and make it more
  compact. This combined panel and navigation panel should each be a column under the radar view,
  sharing the vertical space."

## What changed

Only the UI changed. There are no engine, protocol, schema, content, save or fixture changes.

### One equipment panel

- **`EquipmentPanel.tsx` (new):** a single section, `data-panel="equipment"`. Its heading is
  "Equipment", visually hidden.
  - It composes `WeaponsPanel` and `ModulesPanel` unchanged in logic. Target choice, Fire/Cease
    fire/Reload all, per-weapon fire/cease/reload, charge choice, module toggles, the `e`/`q`/`v`
    and `1`-`4` shortcuts, and the hit-chance and module-effect explanations are all kept.
  - It is focusable (`tabIndex=0`), so its internal scrolling also works from the keyboard.
- **`WeaponsPanel.tsx`:** now a subsection (`equipmentGroup`, h4 "Weapons", still
  `data-panel="weapons"` and still a named region).
  - The aim line sits beside the heading.
  - Weapon group headings are h5.
  - Each weapon's status and magazine share one line.
- **`ModulesPanel.tsx`:** now a subsection (h4 "Modules", still `data-panel="modules"`). Each
  active module's toggle sits on its name line, and its effect is shown under it.

### Navigation and equipment beneath the radar

- **`SpaceScreen.tsx`:** the command bar and the equipment panel share one `work` row beneath the
  radar. The combat log is a full-width disclosure below that row (the `log` grid area). It was in
  the old `tactical` area.
- **`CommandBar.tsx`:** it is the Navigation column, with `data-panel="navigation"` and
  `tabIndex=0`. Its visually hidden heading is renamed from "Commands" to **"Navigation"**
  (`space.commands.heading`).
- **`Space.module.css`:**
  - The radar height is one variable, `--space-view-height: clamp(13rem, 28vh, 22rem)`. This
    replaces three stacked `.view` height overrides.
  - The columns share `--space-work-height: max(16rem, 100dvh - radar - 10rem)`. Each column
    scrolls inside itself beyond that (`overscroll-behavior: contain`).
  - The destination chooser stacks its list over its briefing when the Navigation column is
    narrower than 30rem (a container query).
  - Below 60rem the columns stack (Navigation, then Equipment), without internal scrolling.
  - The weapon command row wraps as a flex row instead of a fixed 3-column grid. The grid was
    there for inline disabled reasons, which have been tooltips since UIR1-01.
  - The `.tactical` area is gone.

### Object list

- **`ObjectList.tsx`:** the player's own ship is filtered out of the list. Nothing else changes:
  - the radar marker, selection by clicking that marker, and the context menu;
  - camera following, the ship rail, `SiteData` and every projection;
  - the `]`/`[` selection cycle (it already skipped the player).

### Localization

- Added `tactical.equipment.heading` ("Equipment").
- Changed `space.commands.heading` from "Commands" to "Navigation".

I first named the panel "Weapons and equipment". The existing non-exact
`getByRole('region', { name: 'Weapons' })` locators then matched two regions. I renamed the panel
rather than loosening those tests.

### Documentation

- `README.md`, "The combat interface": the layout paragraph.
- `docs/agent-comm/release/playtest-script.md`: the hit-chance item names the Weapons section of
  the Equipment panel.
- Functional Specification §19.2 needs no change. It requires the player's ship on the radar, and
  it is still there.

## Tests

- **Component** (`SpaceScreen.test.tsx`): the object-list test now expects one entry (the
  station) and no "Your ship". It also checks that the engine still projects the player in the site
  and that exactly one player marker is drawn on the radar.
- **Browser** (`cockpit.spec.ts`):
  - At 1440×900, there is exactly one equipment panel containing both weapons and modules.
  - Navigation starts below the radar. Equipment is at the same top and to its right.
  - There is one player marker on the radar, and no "Your ship" button in the object list.
  - At 390 px, Equipment is stacked below Navigation.
  - The existing checks are unchanged: pause, stop, fire and module 1 within 900 px; no overflow at
    1920, 1024 and 390; the panels visible.
- **Heading selectors:** 18 `heading 'Commands'` waits in component, browser, accessibility and
  support files were renamed to `'Navigation'`. None was weakened.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (289 files, no violations) |
| `npm run test:component` (all 11 files) | 142 tests pass |
| `npm run traceability` | 117/117 covered |
| `npm run build` | pass |
| Playwright Chromium: browser `cockpit`, `space`, `combat`; accessibility `space`, `combat`, `presentation` | 27 passed (the combat runs complete fights using fire, reload, movement and the shield booster) |
| Playwright Chromium: browser `guidance`, `loss`, `offline`, `station`; accessibility `guidance`, `loss`, `station` | 20 passed |

Not run in this phase:

- unit and integration tests, content validation, and contract/golden checks (no engine, protocol
  or content change);
- `progression.spec.ts` (only its heading wait changed);
- Firefox and the release gate (phase 10).

## Visual verification

Script-driven Chromium against `vite preview`. The screenshots were inspected during the session
and not committed.

- **1440×900, docked start:**
  - Fire ends at y≈432, Stop at 471 and the module toggle at 760.
  - Both columns run from y=365 to 841. The combat log is at about 855.
  - Before this phase, Fire was at 763 and the module toggle at 856.
- **1920:** both columns are 429 px high and need no scrolling.
- **1024:** two columns. The notifications stack above the screen at this width, so the content
  starts lower, but there is no horizontal overflow.
- **390:** stacked in reading order: ship rail, radar, Navigation, Equipment, combat log, the
  object panels. There is no horizontal overflow.
- **Aligning for warp:** the travel banner adds about 40 px, and the combat log goes just below the
  fold.
- **Arrived at Pirate Scout, running:** the list shows only the scout. The player marker stays on
  the radar. The shield booster toggled to Deactivate.
- **Forced colours with reduced motion:** borders, focus rings and controls remain distinct.
- **Text scale 1.5:** no page overflow. The Equipment column scrolls internally. With focus on the
  column, PageDown scrolls it (scrollTop 0 → 399).

## Remaining issues and guidance for phase 10

- **Long words at 1.5× text:** some action labels break mid-word in the Navigation column
  ("Approac/h"). This comes from the shared ActionButton wrapping. It is cosmetic and was not
  introduced here.
- **Notifications at 1024 px:** below the play layout's breakpoint, notifications stack above the
  activity and push the radar down. That layout belongs to `PlayScreen`/frame, not this phase.
- **Build environment:** running `vite build` from Git Bash with the lowercase `/d/` working
  directory bundles React twice, and the app fails at start with "reading 'useMemo'". Build and
  run Playwright from PowerShell in `D:\`.
- **Q12** (stale previews during regeneration) is inherited unchanged.
