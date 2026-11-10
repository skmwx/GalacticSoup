# UIR1-08 completion note - Set course from the radar

Status: complete. Date: 2026-11-10.

Implements phase UIR1-08 of `docs/MVPUIReview01ImplementationPlan.md`. It covers this review finding:

- In Space: "Remove 'Coordinates & point navigation' drop down, and make it a right click in the
  radar view and if it happens to be on an empty space, have 'Set course' menu."

## What changed

Only the UI changed. There are no engine, protocol, schema, content, save or fixture changes. The
existing `movement.moveToPoint` command and its projected availability are reused unchanged.

### Point menu on empty space

- **`SiteView.tsx`:**
  - A secondary click on empty space calls the new `onPointMenu(pointKm, pagePoint)`. The world
    point is computed with the existing `clickedPoint` conversion (SVG screen CTM, then camera), at
    the moment of the click. A secondary click on an object still opens that object's menu, and
    returns before any point is computed, so an object click can never become a course.
  - The browser's own context menu is suppressed only when one of the two menus opens.
  - The new optional `coursePoint` prop draws a crosshair (`data-course-marker`) in the intent
    layer while a point menu is open. The SVG has `data-course="true|false"`.
  - The view now has an accessible description: "Right-click empty space to set a course."
  - Removed: `choosingPoint`, `onChoosePoint`, `data-choosing`, and the arm-then-left-click
    branch. A left click on empty space now only clears the selection, as it did when unarmed.
- **`SpaceScreen.tsx`:**
  - `MenuState` is now a union:
    - `{ kind: 'object', objectId, position }`;
    - `{ kind: 'point', pointKm, position }`.
  - The point is stored in world kilometres when the menu opens, rounded to 0.1 km (what is
    announced is exactly what is sent). Camera following or panning while the menu is open does not
    change it.
  - The point menu opens 16 px beside the point, so the crosshair stays visible.
  - It closes when the site instance changes (warp, dock). The object menu still closes when its
    object leaves.
  - Removed the `choosingPoint` and `point` state.
- **`CourseCommands.tsx` (new):** the point menu's content.
  - A polite live status: "Course point: x 4 km, y 10 km, 10 km from your ship." It carries
    `data-course-point="x,y"` for tests.
  - **Set course** is an `ActionButton` for `movement.moveToPoint`, with the projection's
    availability and reason (tooltip when unavailable). The action runner prevents a duplicate
    send. The menu closes after the send.
  - A hint about the arrow keys.
- **`ObjectContextMenu.tsx`** is now shared by both menus:
  - new `kind` prop: `data-context-menu="object|point"` (was `"true"`; nothing used it);
  - optional `onKeyDown` for keys other than Escape;
  - **clamping:** after layout it keeps the menu inside its stage, so a click near the right or
    bottom edge opens it to the left or above. The menu has `width: max-content`, so a clamped menu
    no longer shrinks to a sliver;
  - when every command is unavailable, focus falls back to the first button.

  Escape, an outside pointer-down, Close menu and focus return are unchanged.

### Keyboard equivalent

- **New registry action `space.setCourse`:**
  - label "Set course on the radar", icon `moveTo`, category `flight`;
  - **default key `.`** (mnemonic: point), remappable in Settings.

  `z` was the only free letter, but several existing tests (Settings, CampaignPanel,
  presentation) use `z` as the "unbound key" in remapping scenarios. `.` keeps them meaningful.
- **Pressing it** opens the same point menu on the camera's centre. Focus goes to Set course, and
  the point is announced.
  - **Arrow keys** move the point 24 screen px (2 km at the default zoom). Shift moves five steps.
    The announcement and the crosshair follow it.
  - **Enter** sends the course. **Escape** cancels and returns focus.
  - **In warp** there is no site: the key answers with the engine's own reason through the
    shortcut notice ("Movement orders require a ship in a tactical site.").
- **Discoverable hint:**
  - an icon-only **Set course on the radar** button in the radar's view controls (`aria-expanded`
    while the point menu is open);
  - the view's accessible description;
  - the shortcut, in the button's tooltip and in Settings.

### Removed

- The `Coordinates & point navigation` disclosure in `CommandBar.tsx`: the Pick a point toggle, the
  X/Y number fields, the Set course button, and the hint line.
- The CSS: `.pointControls` and `.view[data-choosing]`.
- The message keys: `cockpit.coordinates` and `space.commands.point{Arm,Cancel,Hint,Invalid,Submit,X,Y}`.

The active movement order display is unchanged ("Moving to a point" in the readouts, plus the
intent line). Command feedback is unchanged too: refusals go through the action runner as before.

### Localization (UI catalogue only)

Added:

- `action.space.setCourse`
- `space.course.menu` ("Commands for empty space")
- `space.course.submit`
- `space.course.point`
- `space.course.pointNoShip`
- `space.course.nudge`
- `space.view.hint`

### Documentation

- `README.md`: a paragraph on the point menu and its keyboard path.
- `docs/agent-comm/release/playtest-script.md`: the mouse-only fight item now asks for a Set course
  from the radar.
- Functional Specification §19.2/§20 needed no change. It already specifies right-click or an
  equivalent for contextual commands, with remappable shortcuts.

## Tests

- **Component** (`tests/component/SpaceScreen.test.tsx`):
  - The old "move-to-point from the keyboard-operable fields" case is replaced by four cases:
    1. The `.` key opens the point menu with Set course focused, and the point is announced. The
       arrow keys move it by exactly +2 km x and +10 km y. Nothing is sent before Set course. The
       engine then holds `moveToPoint` at exactly the announced point. The menu and marker close,
       and the coordinate fields are gone.
    2. Two secondary clicks 48 px apart on empty space give points 4 km apart, with y up. Escape
       and Close menu send nothing. Set course sends exactly that point.
    3. A secondary click on the station's hit target opens "Commands for Borrell Harbour", not the
       point menu.
    4. The radar button opens the point menu (`aria-expanded`), and Escape returns focus to it.
  - The localization-issue test now opens the point menu.
- **Browser** (`tests/browser/space.spec.ts`):
  - "Sets a course from the radar point menu after pan, zoom and resize". Each right-click checks
    that the crosshair is drawn within 2.5 px of the pointer: before and after zoom, after a
    left-drag pan, and after resizing the window to 1024 px. It also checks that cancel gives no
    order and that Set course gives "Moving to a point" with one intent line.
  - New: an object right-click opens the object's commands, not the point menu.
- **Accessibility** (`tests/accessibility/space.spec.ts`):
  - New keyboard-only case: the view's description, then `.`, focus, an axe audit with the menu
    open, the arrow keys changing the announcement, Enter → order, and the radar button with focus
    return on Escape.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (288 files, no violations) |
| `npm run test:unit` | 78 files, 1404 tests pass |
| `npm run test:component` (all 11 files) | 142 tests pass |
| `npm run traceability` | 117/117 covered |
| `npm run build` | pass |
| Playwright Chromium: browser `space`, accessibility `space` | 11 passed |
| Playwright Chromium: browser `cockpit`, `combat`, `guidance`, `loss`, `offline`; accessibility `presentation`, `combat`, `guidance`, `loss` | 24 passed (4.7 min) |
| Rerun after the final layout tweak: browser `space`, `cockpit`; accessibility `space` | 13 passed |

Not run in this phase:

- integration tests and content validation (no engine, protocol or content change);
- contract and golden recording (nothing to record);
- Firefox and the release gate (phase 10).

## Visual verification

Script-driven Chromium against `vite preview`. The screenshots were inspected during the session
and not committed.

- **1440×900:** the point menu opens beside the crosshair. Near the bottom-right corner it is
  clamped to the stage's right edge at full width. The radar stage is short (about 225 px), so a tall
  menu extends below the stage and overlays the command row.
- **Paused:** the course is set from the keyboard, and "Moving to a point" shows while paused.
- **Aligning for warp:** the menu opens. Set course is offered, because the engine projects
  `movement.moveToPoint` as available while aligning.
- **In warp:** the key gives the engine's refusal notice. No menu opens.
- **1024, 390 and forced colours (1440):** no page-level horizontal overflow. The menu stays inside
  the stage horizontally. The crosshair and the menu border remain visible in forced colours.

## Remaining issues and guidance for the next sessions

- **Phase 09:** The radar's view controls gain one icon button ("Set course on the radar"). When
  the radar is rebalanced, keep the point menu's stage `position: relative`. The menu clamps to its
  `offsetParent`.
- **Menu height vs. stage height:** clamping keeps the menu horizontally inside the stage. When the
  stage is shorter than the menu, it is pinned to the stage top and overlays the content below. If
  phase 09 makes the radar taller, this mostly disappears.
- **Old selectors:** `data-context-menu="true"` became `"object"` / `"point"`. Nothing referenced the
  old value.
- **Q12** (stale previews during regeneration) is inherited unchanged. This phase adds no previews.
