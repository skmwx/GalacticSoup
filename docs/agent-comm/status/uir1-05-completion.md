# UIR1-05 completion note - One compact fitting screen

Status: complete. Date: 2026-11-10.

Implements phase UIR1-05 of `docs/MVPUIReview01ImplementationPlan.md`. It covers these review
findings:

- Merge the fitting display and editor.
- Give each slot a small Change module control with a pop-up of possible modules.
- Make weapon ammunition a drop-down.
- Put the ship's general information on top and the weapon statistics at the bottom.

## What changed

### One fitting surface (`src/ui/station/FittingPanel.tsx`)

The old read-only table (`FittedSlots`), the **Change fit** button and the separate editor
(`OpenDraft` / `SlotEditor` with a ship summary repeated underneath) are gone. One screen is both
the view and the editor, from top to bottom:

1. **State line** (`role="status"`, `data-fitting-state`):
   - "This is the fit your ship is wearing…" when no draft is open.
   - "No changes planned yet…" when a draft is open but unchanged.
   - A highlighted "Previewing changes that are not applied yet…" notice once the draft differs.
2. **Ship** (`ShipOverview`): identity, insurance, power, processing, capacitor, endurance and the
   layer table. While the draft differs, the heading becomes "The ship this draft would produce"
   and the figures are the engine's `draft.preview`.
3. **Modules**: one row per slot the hull offers, empty slots included (`<ul>` named "Modules").
   Each row shows:
   - the slot name, with "(changed)" when the draft differs from the fitted slot (module, charge
     or online state);
   - the module (or "Empty") and an icon-only **Change module in {slot}** control;
   - for weapons, the charge ("Fusion S (20 loaded)" while it is still the loaded one, or "No
     ammunition") and an icon-only **Change ammunition in {slot}** control;
   - for fitted modules, the existing "{slot} online" checkbox.
4. Missing items, the commit-blocking reason, and the shown ship's violations and warnings
   (`FitIssues`).
5. **Apply fit / Discard changes**, only while a draft is open. The availability rules and reasons
   are unchanged.
6. **Weapons** (`WeaponStats`) for the shown ship. Below it is a collapsed "How these figures are
   calculated" disclosure with the attribute traces (`ShipAttributes`). The formula explanations
   stay one click away, without repeating a full summary.

### Pickers (`src/ui/station/ChoicePicker.tsx`, new)

- The trigger is an icon-only `ActionButton` with `expanded`/`controls`. The choices appear in a
  small absolutely positioned group named "Modules for {slot}" or "Ammunition for {slot}". The group
  is a sibling of the trigger, so the trigger's tooltip does not cover it.
- Each choice is a button with `aria-pressed` for the current one. The current choice is marked by
  a ✓ (with empty alt text) and a heavier border, not by colour alone.
- Module choices show "{n} available · {power} power · {processing} processing". "Empty the slot"
  is offered only when the slot holds something. Ammunition choices list the engine's accepted,
  locally owned charges plus "No ammunition".
- Keyboard:
  - Opening the list focuses the current choice, or the first one.
  - Up/Down/Home/End move between choices.
  - Escape closes the list and returns focus to the trigger.
  - Choosing an option also returns focus to the trigger.
  - A pointer press outside the list closes it.
- "Loading the choices…" is shown until the draft's candidates arrive.

### Draft lifecycle

- **Lazy start, reuse:** opening any picker, or toggling online, sends `fitting.begin` only when
  no draft is open. After that the open draft is reused; the engine answers a repeated begin on the
  same ship with UNCHANGED.
- **Ordered edits:** edits run through a per-screen promise queue, so a quick second choice is
  neither dropped nor raced.
- **Commands:** `fitting.set` / `fitting.clear` / `fitting.commit` / `fitting.revert` are
  unchanged.
- **Ammunition after a module change:** a new module keeps the current charge when the engine says
  it accepts it. Otherwise it gets the first accepted owned charge, or none. If it ends up with
  none, the preview's existing "no ammunition loaded" warning says so.

### Leaving with an open draft (`src/ui/station/useStationNavigation.tsx`, new)

Every change of station surface goes through one guard: the rail, the hub tiles, Ship readiness'
"Inspect ship", and the guidance's "Show me". `PlayScreen` owns it for the play view.
`StationScreen` has its own copy, used only when it holds its own panel state.

- No draft: the surface changes.
- An unchanged draft: it is closed quietly with `fitting.revert`, which moves nothing, and the
  surface changes. Just opening a picker therefore never leaves a hidden undock block.
- A changed draft: the **Apply fitting changes?** dialog offers:
  - **Apply fit**: commits, then moves on.
  - **Discard changes**: reverts, then moves on.
  - **Stay**: Escape and × do the same.

  A refused Apply keeps the dialog open and the reason appears on the station error line. When the
  draft cannot be applied, the dialog says so and Apply shows its reason in a tooltip.

Settings and the game menu do not change the station surface, so they need no guard. Shipless
pilots see "You have no ship to fit…" and no edit controls. A loss already clears the draft in the
engine.

The undock refusal `error.ruleViolation.fittingDraftOpen` now reads: "A fitting change is still
open. Apply or discard it on the Fitting screen first." It used to say "Another ship…", which was
wrong when the open draft belonged to the active ship, for example after closing a campaign
mid-edit and resuming it.

### Shared pieces

- **`ShipPanel.tsx`:** `ShipSummary` is now made of the exported `ShipOverview`, `WeaponStats` and
  `FitIssues`. `ShipAttributes` is exported. The Ship surface looks the same as before.
- **`ActionButton.tsx`:** a compact control with `expanded={true}` no longer shows its name
  tooltip while its panel is open, because it covered the panel. Reasons still show. This also
  applies to the game-menu trigger.
- **`panels.ts`** (new) holds `STATION_PANELS` / `StationPanelId`, to avoid an import cycle.
  `StationScreen` re-exports the type.
- **Registry:** `fitting.begin` was removed from the UI action registry. The engine command
  remains. Added `fitting.changeModule` (icon `module`) and `fitting.changeAmmunition` (icon
  `ammunition`).
- **Styles:** the `.slots` / `.slot` cards were replaced by the `.slotList` / `.slotRow` flex rows,
  which wrap to stacked lines at narrow widths. Also added `.slotModule`, `.slotCharge`,
  `.slotOnline`, `.changedMark`, `.subHeading`, `.breakdown`, `.pickerAnchor`, `.picker` and
  `.pickerChoice`.
- **Localization (`en.json`):**
  - Added `action.fitting.changeModule`, `action.fitting.changeAmmunition`,
    `fitting.{loadingChoices, previewing, shipHeading, slotsHeading, weaponsHeading, breakdown,
    emptySlot, slotChanged, changeModuleFor, modulesFor, changeChargeFor, chargesFor,
    candidateDetail, unavailable.service}` and `fitting.leave.{title, body, stay, blocked}`.
  - Reworded `fitting.closed`, `fitting.unchanged` and `error.ruleViolation.fittingDraftOpen`.
  - Removed the unused `action.fitting.begin`, `fitting.{candidate, changed, chargeFor, clearSlot,
    currentCaption, moduleFor, module, state, stateOnline, stateOffline}`.

### Contracts

No protocol, schema, save-format or content change. Goldens and the contract lock are untouched.

## Tests

- **`tests/component/StationScreen.test.tsx` (`fitting`)** has four cases, replacing the single
  old one:
  - **Edits in place, previews, applies.**
    - Before any edit, the screen shows the Ship / Modules / Weapons sections, the empty slots,
      no Apply button, no Change fit button and no engine draft.
    - The empty Engineering 1 picker opens the draft and lists Small Armour Plating with its
      availability and cost, with no "Empty the slot" choice.
    - Choosing it shows the preview heading and "(changed)", and the committed ship is
      untouched.
    - Apply commits it and closes the draft.
  - **Unload, offline, empty, discard.**
    - The ammunition drop-down marks the loaded charge as current.
    - "No ammunition", offline and "Empty the slot" each produce the engine's preview warning.
    - Discard restores the row and the checkbox. Every inventory's contents and the credits match
      the pre-edit snapshot.
  - **Charge kept or loaded, and an unavailable candidate.** Putting the already-fitted autocannon
    in Weapon 2 as well loads Fusion S. The engine's shortfall is shown ("200mm Autocannon: 1
    needed, 0 available."), and Apply is unavailable with its reason.
  - **Navigation with a draft.**
    - An opened-but-unchanged draft (picker opened, then Escape, with focus back on the trigger)
      is closed silently on leaving.
    - With a changed draft, Stay keeps the screen and the draft.
    - Discard leaves for Market with the ship untouched.
    - Apply commits, then leaves.
  - The market's compatibility test now refits through the picker.
- **`tests/component/LossScreen.test.tsx`:** a shipless pilot sees no Change module controls,
  replacing the old unavailable Change fit check.
- **New `tests/support/fitting.ts`** for browser flows:
  - `chooseModule` / `chooseAmmunition` pick by definition id (`data-value`) and wait for the
    row's `data-module` / `data-charge`.
  - `fittingSlots` returns the slot rows.
  - `applyFit` waits until Apply is available, then waits for the committed state.
- **Selectors migrated** in browser `station`, `combat`, `loss`, `guidance` and `progression`,
  and in accessibility `loss` and `presentation`. The old "Change fit" + `getByLabel('Module in …')
  .selectOption` became the helpers, and `getByRole('cell', { name })` fit checks became
  `fittingSlots(page).filter({ hasText })`. The station browser flow now asserts the preview
  notice and heading.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (286 files, no violations; an initial import cycle was removed with `panels.ts`) |
| `npm run test:unit` | 78 files, 1387 tests pass |
| `npm run test:component` | 11 files, 134 tests pass (rerun after the final ActionButton change) |
| `npm run traceability` | 117/117 covered |
| `npm run build` | pass |
| Playwright Chromium, browser `station`, `combat`, `loss`, `guidance`, `progression` | 10 passed (14.3 min). This build predates two late UI tweaks: the tooltip is suppressed while a list is open, and "(changed)" moved next to the slot name. Neither tweak touches anything these flows assert, and both are covered by the component rerun. |
| Playwright Chromium, accessibility `station`, `presentation`, `loss` | 16 passed (1.4 min), built after the final changes, including axe audits of the fitting flows |

Integration tests were not rerun: no engine, protocol or command code changed. `validate:content`
was not needed: no content changed. The Firefox suites belong to phase 10's gate.

## Visual verification

Checked against the Vite dev server with script-driven Chromium at 1440×900 and 390×844. The
screenshots were inspected during the session and not committed.

- **1440, no draft:** ship figures and layers on top. Below them are six compact slot rows (module
  + icon, ammunition + icon, online), the capacitor warning, the weapons table, then the collapsed
  breakdown. There is no Apply or Discard button yet.
- **1440, module picker** (Weapon 2): a small list under the icon with "200mm Autocannon / 1
  available · 5 power · 6 processing". In the first pass the trigger's name tooltip covered the
  list; it is now suppressed while the list is open.
- **1440, ammunition picker** (Weapon 1): "✓ Fusion S" (focused) and "No ammunition".
- **1440, preview:** after choosing No ammunition, a highlighted notice and "The ship this draft
  would produce" appear. Weapon 1 is marked "(changed)", the warning reads "This weapon has no
  ammunition loaded.", Apply fit and Discard changes appear, and the weapons table shows 0 volley
  / 0 DPS.
- **1440, leaving:** clicking Market opens the modal "Apply fitting changes?" with Apply fit /
  Discard changes (danger) / Stay.
- **390:** each slot row stacks name, module, ammunition and online. The picker list stays inside
  the viewport (x 116-348). `scrollWidth` is 390 with and without the list open. The layer table
  still wraps its numbers tightly, as before this phase.

## Remaining issues and guidance for the next sessions

- **Guidance wording, deferred content change.** `content.guide.loop.upgrade.body` still says
  "open Fitting, Change fit, put it in a slot and Apply fit". There is no Change fit button now.
  The step can still be followed: the slot's Change module control and Apply fit are on the
  screen it opens. Editing it changes the content hash and every golden save, so it joins the
  deferred UIR1-03 ("Sell your loot") and UIR1-04 ("Move to hold") wording in one deliberate
  content pass. Suggested text: "…then open Fitting ({keyStationFitting}), use Change module on an
  empty weapon slot, and Apply fit."
- **Shortfall wording.** The engine reports the *additional* units a draft needs: "1 needed, 0
  available" when a second copy of the only owned module is planned. This is accurate but terse.
  A message such as "needs one more 200mm Autocannon than is here" would need an engine/protocol
  field change, so it was left alone.
- **Closing the campaign mid-edit** keeps the draft, as before. The draft is persisted engine
  state. On resume it is visible on the Fitting screen, and the reworded undock refusal points
  there. A close-time Apply/Discard prompt was not added: the game menu is outside the station
  guard, and the plan only requires the draft never to be invisible.
- **Ship figures height.** At 1440×900 the ship overview takes about 500 px before the slot rows.
  The review asked for it on top. If human review finds the slots too low, the figure grid could
  use five columns, or the layer table could become collapsible.
- **For phase 06 (Overview and services).** Station navigation now goes through
  `useStationNavigation(...).request`. Any new Overview shortcut that changes the surface should
  call it rather than `setStationPanel` directly. `ChoicePicker` can be reused for compact
  pop-up choices.
