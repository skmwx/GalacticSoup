# UIR1-01 completion note - Compact action controls and disabled-reason tooltips

Status: complete. Date: 2026-11-09.

Implements phase UIR1-01 of `docs/MVPUIReview01ImplementationPlan.md` (review finding: "When a
button is disabled for some reason in any view, don't write the reason next to it ... Make the reason
appear in the tooltip"; groundwork for icon-only Buy/Inspect/Sell).

## What changed

- **Shared tooltip** - `src/ui/common/Tooltip.tsx` (`useTooltip`, `describedBy`) and
  `Tooltip.module.css`.
  - Opens on pointer hover and keyboard focus, and stays open while the pointer crosses onto it
    (WCAG 1.4.13).
  - Drawn in a portal with `position: fixed`, so it never moves adjacent content. It is clamped to
    the viewport and flips above the anchor when there is no room below.
  - Escape dismisses it without moving focus. The key is not consumed, so it still closes a
    surrounding dialog or menu in one press, as before.
  - Only one tooltip is open at a time. Hovering one control closes the tooltip that keyboard focus
    opened on another.
  - Assistive technology hears the reason through `aria-describedby`, which points at a visually
    hidden element that is always present. The visual popup is `aria-hidden`, so the reason is not
    read twice. Native `title` is not used.
- **`ActionButton`** (`src/ui/actions/ActionButton.tsx`, CSS):
  - Unavailable and pending buttons are now `aria-disabled` rather than natively `disabled`. They
    stay keyboard-focusable, and `onClick` refuses pointer, Enter and Space activation. The runner's
    duplicate-start guard is unchanged.
  - The inline `.reason` span is gone. The reason is shown in the tooltip. An unavailable action
    whose projection gave no reason falls back to `shortcut.unavailable` ("Not available right
    now.") instead of saying nothing.
  - New `display="icon"` presentation: icon only, a square control of at least
    `--gs-target-min`, no visible label or shortcut badge.
    - Its accessible name is the full label, including a contextual `label` such as
      "Buy Fusion S".
    - `aria-keyshortcuts` is kept.
    - The tooltip shows the name and key, plus the reason or "working…" when relevant.
    - Phase 03 is expected to be the first caller.
- **`TooltipButton`** - `src/ui/common/TooltipButton.tsx`. A plain button with the same
  aria-disabled, refused-activation and tooltip rule, for controls that are not registry actions.
  Applied to:
  - station rail tabs (which previously had **no** reason at all) and Overview tiles (whose inline
    reason text is removed) - `StationScreen.tsx`;
  - campaign Resume / Start (new reasons `campaign.busy`, `campaign.start.needsName`). The form
    handler now also refuses implicit Enter submission while busy, because an aria-disabled submit
    button no longer blocks it - `CampaignPanel.tsx`;
  - key-binding Remove (new reason `settings.keys.clearNone`) - `KeyBindings.tsx`;
  - the "Pick a point" arm button - `CommandBar.tsx`. Phase 08 removes this control, but it is
    consistent until then.
- **Missing reasons filled in.** Approach / Orbit / Keep range with nothing selected now say
  `shortcut.noSelection` ("Select something in the view or the list first.") instead of nothing.
- **Selectors updated for aria-disabled.**
  - The dashed/muted unavailable styling now also matches `[aria-disabled='true']` in the
    Station, Settings, CampaignPanel and Space CSS.
  - `ObjectContextMenu` focuses the first *available* command.

### Audit of other inline explanations

Left visible on purpose, because these explain game state rather than a disabled control
(plan §2):

- loot access status (`LootPanel`);
- undock validity (`ShipPanel`);
- fitting draft blocked/missing items (`FittingPanel`);
- transaction errors, notifications and save failures.

The Departure, Market, Hangar, Services, Fitting, Space, Locks, Loot, Weapons, Modules, Guidance
and Transaction dialog controls are all `ActionButton`s and inherit the tooltip treatment.

The warp destination `<select>` stays natively disabled when there are no destinations. Its
placeholder option already says "No destination", and phase 07 replaces this chooser.

## Tests

- New test matcher `toBeUnavailable()` in `tests/component/setup.ts`. It passes for native
  `disabled` *or* `aria-disabled="true"`, and its negation requires neither. Component-test
  `toBeDisabled` / `toBeEnabled` assertions were migrated to it. This is not a weakening: jest-dom's
  `toBeEnabled` would wrongly pass an aria-disabled button. Playwright's `toBeDisabled` /
  `toBeEnabled` / `isEnabled` already honour `aria-disabled`, so browser specs were not changed.
- New component tests (`tests/component/actionRunner.test.tsx`, "a disabled-reason tooltip"):
  - pointer, Enter and Space are refused while unavailable;
  - keyboard focus reaches the control and shows the reason, which is announced once;
  - hover shows the reason in a portal outside the component's DOM;
  - Escape dismisses the tooltip, keeps focus, and still reaches document listeners;
  - only one tooltip is open at a time;
  - icon-only name, `aria-keyshortcuts` and tooltip heading;
  - an icon-only control can be unavailable.
- `CampaignPanel.test.tsx`: Start campaign has its reason as an accessible description, and
  neither a click nor implicit submission starts a nameless campaign.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (281 files) |
| `npm run build` | pass |
| `vitest --project component` | 11 files, 121 tests pass |
| `vitest --project unit` | 76 files, 1376 tests pass |
| `npm run traceability` | 117/117 included requirements covered |
| `playwright --project=browser --project=accessibility` (Chromium), full | 63 passed, 1 failed (see below), 15.4 min |
| Rerun after the fix: presentation, space, station, campaign and shell accessibility specs; space, station and campaign browser specs | 39/39 pass |

In the full Chromium run, the single failure was `presentation.spec.ts` › "traps focus in every
confirmation...". Tab reached a dialog's aria-disabled Confirm, its tooltip opened, and the tooltip
then swallowed the Escape that should have closed the dialog.

That was a behaviour regression introduced in this phase, and it is fixed: Escape now dismisses the
tooltip and also propagates. The test was not changed. Every combat, loss, guidance, progression,
cockpit and offline browser flow passed in the full run. Their `toBeEnabled` / `isEnabled` checks
honour `aria-disabled`.

Firefox suites were not run in this session; they belong to phase 10's gate.

No protocol, schema, save or content change. Three message keys were added to the UI catalogue.

## Visual verification

These checks were made against the Vite dev server. The screenshots were inspected during the
session and not committed.

- **1440×900, Departure:** hovering the unavailable "Show me" guidance control floats "You are
  already there." over the neighbouring Skip step button without moving it.
- **1440×900, space:**
  - keyboard focus on unavailable Orbit shows its reason;
  - Enter sent no command;
  - every unavailable control on the screen has a specific reason (Approach, Orbit, Keep range,
    Retreat, Fire, Cease fire, Reload all, and the per-weapon controls).
- **390 px wide:** the tooltip is clamped to the viewport (left edge at 8 px) and there is no
  page-level horizontal overflow.
- **1024 px, high contrast, 1.5× text scale:** the tooltip is legible, with warning colour on a
  black surface.

## Remaining issues and guidance for the next session

- **Pre-existing, not caused here:** at 1.5× text scale the Weapons toolbar (`commandRow`, a grid
  with equal columns in the combat CSS) breaks long labels mid-word ("Ceas e fire"). Phase 09
  rebuilds this panel and should fix it there.
- **For phase 03:** use `<ActionButton display="icon" label={translate('...', { item })} ... />`
  for Buy/Sell/Inspect. The `label` becomes the accessible name and the tooltip heading.
- **For other raw buttons** that can be unavailable, use `TooltipButton` with a translated
  `reason`, not native `disabled`.
- **In browser tests,** a reason is no longer visible text beside a control.
  - Assert it with `toHaveAccessibleDescription` / `aria-describedby`.
  - Or hover/focus the control and read `[data-tooltip]`.
  - `getByText(reason)` still finds the hidden description in the DOM.
- **Focus and dialogs:** unavailable controls, such as a dialog's Confirm button while its preview
  is stale, are now in the Tab order and in the dialog focus trap.
  - This is intentional: it is how keyboard users reach the reason.
  - Escape still closes the dialog in one press.
  - An early run where the tooltip swallowed Escape failed the presentation accessibility
    dialog-focus test. That is why Escape now propagates.
