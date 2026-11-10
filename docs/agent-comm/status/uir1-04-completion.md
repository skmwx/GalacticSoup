# UIR1-04 completion note - Hangar and hold transfers

Status: complete. Date: 2026-11-10.

Implements phase UIR1-04 of `docs/MVPUIReview01ImplementationPlan.md`. It covers this review
finding: split the hangar into two columns, hangar and hold, each listing its own items, with
buttons to move all of an item, one of it, or the amount typed in a box.

## What changed

### Hangar panel (`src/ui/station/HangarPanel.tsx`)

- **Two columns.** Station hangar, then Ship cargo hold, in a responsive grid. The columns stack in
  that order when there is no room for both. Each column has its own heading and capacity line.
  Each table lists Item, Quantity (right-aligned), Volume, the move controls and an icon-only
  Inspect control.
  - A row's move direction is set by its column. The controls column is headed "Move to hold" or
    "Move to hangar".
  - Table captions are visually hidden because the column heading already shows the title. The
    table names ("Station hangar", "Ship cargo hold") are unchanged.
- **Capacity feedback.** The hold reads "0.198 m³ used of 135 m³ · **134.802 m³ free**", with a
  bar that repeats the words (`aria-hidden`). The hangar reads "… used, no limit".
- **One / All / Max / typed quantity** on every stack. Visible text is short; the accessible name
  and tooltip heading are full, e.g. "Move all Fusion S to the hold". Every visible word appears in
  its accessible name (WCAG 2.5.3).
  - **One** moves 1 unit. **All** moves the whole stack. **Max** appears only when moving into a
    store with a limit (the hold). It moves what the engine says fits.
  - **Typed quantity:** a field ("Units of Fusion S to move", placeholder "Qty") plus **Move**.
- **All never shrinks.** Each column asks the engine's existing `inventory.maximum` query how much
  of each stack fits in a limited destination. It asks again only when the destination's free
  space or the stacks change.
  - When the whole stack does not fit, All is unavailable. Its tooltip says: "The hold cannot take
    the whole stack. Max moves as many as fit."
  - When nothing fits, One and Max are unavailable: "The hold has no room for even one unit."
  - A typed amount that does not fit is unavailable too.
  - While the answer is still loading, nothing is blocked. The engine still validates every
    transfer atomically, and a refusal shows through the existing station error line.
- **Max re-queries when activated.** It calls `inventory.maximum` again at that moment, so a stale
  answer cannot pick the quantity.
- **Strict typed quantities.** New `src/ui/format/quantity.ts` (`readWholeQuantity`, exported from
  `@ui`) accepts only a positive whole number up to the stack size, with surrounding spaces
  ignored. Blank, fractional, negative, zero, exponent and excessive input is refused, never
  coerced.
  - When refused, Move is unavailable and its tooltip gives the reason (blank / not whole / too
    many / does not fit). The field gets `aria-invalid`.
  - The market's `QuantityField` now uses the same parser. Its behaviour is unchanged.
- **Stale drafts.** Each row's controls are keyed by stack id and quantity. After a move, split or
  merge changes a stack, its typed field starts empty. A stack that disappears takes its draft
  with it.
- **No duplicate submission.** Every transfer control uses the `inventory.transfer` action, so the
  runner blocks all of them while one transfer is in flight.
- **Shipless play.** The hangar column is shown without move controls. The hold column explains
  why there is no hold (`data-no-hold`, unchanged text).
- **Inspection** is unchanged apart from the icon-only control: item detail and comparison.

### Shared control (`src/ui/actions/ActionButton.tsx`, `.module.css`)

- New `display="short"` with `shortLabel`. It draws a short word without the icon, for a row of
  related controls that would otherwise share one icon. As with `display="icon"`, the full label
  is the accessible name and the tooltip heading (with any shortcut), the pending state goes in
  the tooltip, and the minimum target size is kept.

### Styles (`src/ui/station/Station.module.css`)

- Added `inventoryColumns`, `inventoryColumn`, `capacity`, `free`, `transferControls`,
  `transferQuantity` and `quantityInput` (with an invalid state that does not rely on colour
  alone: a dashed border plus `aria-invalid` and the tooltip).
- `.table th.numeric, .table td.numeric` now right-align as intended. UIR1-03 recorded the old
  left-alignment as a known issue. This also corrects numeric columns elsewhere in the station
  that use the class.

### Localization (`en.json`)

- Added `hangar.details`, `hangar.free`, `hangar.quantity.{blank,notWhole,tooMany}`,
  `hangar.quantityOf`, `hangar.quantityPlaceholder`, `hangar.short.{one,all,max,move}`,
  `hangar.toHold.{one,all,max,typed}`, `hangar.toHangar.{one,all,typed}`,
  `hangar.unavailable.{allDoesNotFit,noRoom,typedDoesNotFit}`.
- Removed the unused `inventory.moveQuantity`. `hangar.toCargo` and `hangar.toHangar` remain as
  column headers.

### Contracts

No protocol, schema, save-format or content change. The phase uses the existing
`inventory.maximum` and `inventory.transfer`. Goldens and the contract lock are untouched.

## Tests

- **`tests/component/StationScreen.test.tsx` (`hangar`)**, replacing the single whole-stack case:
  - **one, all and a typed quantity in both directions.** Checks both column headings, the
    free-space line and that stacks merge. The typed field is empty after its stack changes.
  - **refuses blank, `2.5`, `-3`, `0` and more than the stack**, each with the right tooltip
    reason and `aria-invalid`. Clicking Move moves nothing.
  - **All never shrinks; Max moves what fits.** The test swaps in a 0.25 m³ starter hold on the
    content repository; the compiled bundle is digest-checked and cannot be edited. With 100 spare
    rounds in the hold and 40 bought into the hangar:
    - All and a typed 30 are unavailable with reasons, and nothing moves.
    - A direct whole-stack `inventory.transfer` is refused atomically.
    - Max moves exactly 25.
    - The full hold then makes One and Max unavailable and reads "0 m³ free".
- **New `tests/unit/ui/quantity.test.ts`** covers the parser, including `1e2`, `+4`, `0x10` and
  unsafe integers. jsdom normalises `1e2` in a number field, so that case is tested here rather
  than in the component test.
- **Accessibility `station.spec.ts`:** a new keyboard test.
  - Checks the short visible text "Move", the tooltip refusal on focus and `aria-invalid` for
    `2.5`.
  - Then types 5 and moves it with Tab + Enter, checks the hangar quantity and the cleared field,
    and runs an axe audit.
- **Selectors migrated** from "Move to hold" / "Move to hangar" to the new item-specific names in
  browser `station`, `combat`, `loss` and `progression`.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (283 files, no violations) |
| `npm run test:unit` | 78 files, 1386 tests pass |
| `npm run test:integration` | 134/134. A first run made while Playwright was building in parallel failed one test once: `contentPort.test.ts` "reports the content the host was given", after 5.7 s. It passed on its own and in the full rerun. It is load-sensitive and does not involve the hangar. |
| `npm run test:component` | 11 files, 131 tests pass |
| `npm run traceability` | 117/117 covered |
| `npm run validate:content` | pass |
| `npm run build` | pass |
| Playwright Chromium, browser `station`, `combat`, `loss`, `progression` and accessibility `station`, `presentation`, `loss` | 25 passed (15.5 min). This run was built before the final CSS-only adjustments: column minimum 26rem → 20rem, no-wrap numbers, wrapping quantity group. Those were checked visually and with component tests and the build afterwards. |

The Firefox suites and the full Chromium run were not repeated here; they belong to phase 10's
gate.

## Visual verification

Checked against the Vite dev server with a script-driven Chromium at 1440×900 and 390×844, after
moving one round to the hangar and typing `2.5` into the hold row's field. The screenshots were
inspected during the session and not committed.

- **1440:** hangar and hold side by side next to the guidance panel. Each shows its capacity line,
  and the hold shows free space in bold with its bar. One / All / Max / Qty / Move wrap onto two
  lines inside the controls column. The focused Move control shows its name and the "Type a whole
  number of units, 1 or more." tooltip outside the layout. The invalid field has a dashed red
  border. `scrollWidth` equals the viewport.
  - The first attempt used a 26rem column minimum, which stacked the columns at this width. It is
    now 20rem.
- **390:** the columns stack, hangar first. All transfer controls are visible, wrapping vertically.
  Only the Inspect column needs the table's internal (focusable) horizontal scroll, the same
  treatment as the market. There is no page-level horizontal overflow (`scrollWidth` 390).

## Remaining issues and guidance for the next sessions

- **Narrow tables.** At phone width the Inspect control sits behind the table's internal scroll.
  A card layout per stack would remove it. It was left as is because the plan only requires no
  page-level overflow, and the market shares the pattern. Phase 10 may decide whether both need a
  card layout.
- **Typed-field reasons are in the Move tooltip.** The field itself carries only `aria-invalid`.
  This follows the review's tooltip rule. If human review finds it too hidden, a short
  `aria-describedby` hint on the field is a contained change.
- **For phase 05 (fitting).** `ActionButton`'s new `display="short"` suits compact rows of
  related controls that share an icon, such as Change / Remove. `readWholeQuantity` is shared in
  `src/ui/format/quantity.ts`.
- **Guidance text.** `content.guide.loop.carry-rounds.body` says "open the Hangar … and use Move to
  hold on rounds stored there". "Move to hold" is now the controls column's header, not a button,
  so the step is still followable but slightly out of date. A better wording would be "use All or
  Max in the hangar column".
  - This was not changed here. Editing it is a content change: it moves the content hash and with
    it every golden save. It belongs with the deferred "Sell your loot" wording from UIR1-03 in one
    deliberate content pass.
