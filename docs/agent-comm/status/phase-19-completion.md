# Phase 19 completion note - Accessibility, input, and presentation hardening

Status: complete. Date: 2026-09-26.

Implements Phase 19 of `docs/MVPImplementationPlan.md`. The player can now set how the game looks
and which keys drive it, and every included surface has been re-audited at the settings the MVP
must support.

- **Settings.** A Settings control in the application header opens a panel before and during a
  campaign. It holds:
  - interface size and text size, each 100-200% and independent of each other;
  - contrast and motion, each following the browser or overriding it;
  - the optional confirmations;
  - the keyboard shortcuts, remappable one key per action.
- **Shortcuts.** One dispatcher reads the player's bindings. Buttons, station tabs and the
  guidance text show the player's own key. A key that cannot act now says why.
- **Confirmations.** Undocking with an undock warning now asks first. The question can be switched
  off; the price confirmations cannot.
- **Presentation.** A real high-contrast theme, reduced motion that the player can choose, larger
  pointer targets, and shapes beside the colours of fit errors, warnings and "ready to undock".
- **Focus.** A notification that holds the focus stays until the focus leaves; dismissing it hands
  the focus to the event log control.

The exit gate passes: see Tests. One decision was taken without a specification change and is
recorded as Q8 in `docs/agent-comm/requests/questions-and-answes.md`; it does not block.

## Preferences (Functional Specification 20; Technical Specification 3.1, 12.3)

`src/ui/preferences/` stores **version 2** under the same `localStorage` key. Nothing here is in a
snapshot, and the campaign save format is unchanged.

| Group | Values | Default |
|---|---|---|
| Display | interface size, text size (100, 125, 150, 175, 200%); contrast (system, standard, high); motion (system, full, reduced) | 100%, 100%, system, system |
| Confirmations | ask before undocking with a warning | on |
| Bindings | overrides of the registry's default keys, or "no key" | none |
| Audio, notifications | as in Phase 18 | as in Phase 18 |

- **Migration.** The reader is field by field, as in Phase 18. A version 1 value keeps its sound
  and alert settings, and the new groups start at their defaults. A unit test proves it.
- **Damaged values** cost one setting: an unknown scale, mode, action or key is dropped.
- **Restore defaults.** Each settings group has its own restore action; the Phase 18 "Restore
  defaults" still restores everything.
- **Where they apply.** The application shell now owns the preferences, so the campaign start
  screen is scaled too. The outermost provider writes the display settings on the root element
  before paint:
  - `--gs-ui-scale` and `--gs-text-scale`;
  - `data-contrast` and `data-motion`.

  A value at its default is removed rather than written, so the stylesheet stays in charge.
  `tokens.css` and `global.css` read the attributes and fall back to `prefers-contrast` and
  `prefers-reduced-motion` only when no choice was made.
- **Reduced motion** now also comes from the setting: `useReducedMotion()` feeds the space view's
  interpolation. Simulation timing never reads it.

## Shortcuts (Functional Specification 19.2, 20; Technical Specification 12.3)

### Bindings (`src/ui/actions/bindings.ts`)

- Every action with a default key can be moved, and none can be added to an action without one.
- **One key, one action.** Giving an action a key another action holds takes it from that action,
  which is left without a key. The settings line names it ("Lock target now uses S. Stop had it and
  now has no key.").
- **Bindable keys** are one printable character or F1-F12. Tab, Enter, Space, Escape, the arrows
  and modifiers stay with the page and are refused with the reason.
- **Conflicts in a hand-edited store** are settled in registry order.
- **Only differences are stored**; setting a key back to its default removes the override.

### Dispatch (`src/ui/actions/shortcuts.tsx`)

- `ShortcutProvider` in the play screen owns one document listener. `useActionShortcuts` registers
  a surface's handlers with it; outside a provider, the hook listens for itself as before.
- As before, no shortcut fires while typing, with a modifier, on auto-repeat, inside a modal or
  while a key is being captured in the settings.
- **Pause reaches through a list box.** Before, a focused `<select>` - the range or arrival box the
  player had just used - swallowed P. Pause now works there; other keys still do not, because a
  list box uses letters and digits to choose an option.
- **Refusals are spoken.** A handler returns the reason it cannot act, which is the same reason
  its button shows. A bound key that no mounted surface offers says "Not available here". The
  notice is a polite status line beside the notifications for five seconds. This answers the
  Phase 18 finding that L before lock range did nothing.

  The handlers that report reasons: lock, unlock, take all, fire, cease fire, reload, the module
  toggles, approach, orbit, keep range, warp, dock, and a station surface the station does not
  offer. Stop and retreat always go to the engine.

### Where the key is shown

- **Buttons.** Each action button shows the bound key and declares it with `aria-keyshortcuts`.
  The key stays part of the button's name ("Fire E"), as before.
- **Station tabs.** The station tabs gain the key, hidden from assistive technology so their names
  are unchanged, and also declared with `aria-keyshortcuts`.
- **Guidance.** Guidance texts no longer contain literal letters. `content/localization/en.json`
  uses parameters such as `{keyTargetingLock}`, and the guidance panel fills them from the
  bindings. A catalogue test forbids a literal "(L)" in any guidance text and requires every
  parameter to name a remappable action.

## Confirmations (Functional Specification 10, 19.5, 20)

Functional Specification 10 says "the game warns before undocking" without ammunition or with
damaged layers. Departure already listed those warnings. Undocking while one stands now opens a
modal confirmation:

- title "Undock with warnings?";
- the same list of warnings;
- "Undock anyway" and "Stay docked";
- a line saying where the question can be switched off.

It is the one optional confirmation, on by default. The price confirmations of every purchase,
sale and station service, and deleting the campaign, are required by Functional Specification 10,
11.2 and 19.5; the settings list them as "always asked" instead of offering a switch.

## Presentation and focus audit (Technical Specification 12.2-12.3)

- **Automated audit.** It now also runs WCAG 2.2 AA, which adds the 24 px pointer-target rule. It
  covers every station surface, the purchase confirmation, the settings and a fight, both:
  - at default size and standard contrast;
  - at doubled interface and text size in high contrast with reduced motion.

  Every surface passes with no sideways scroll.
- **High contrast** is a black-and-white palette with brighter semantic colours and a thicker
  yellow focus ring. `--gs-target-min` sets a minimum height for action and settings buttons and
  the size of check boxes.
- **Fit validity no longer relies on colour.** Before, fit errors and fit warnings were two lists
  that differed only in colour. Both are now labelled lists, and each line has a shape: a cross
  for an error, an exclamation mark for a warning, a tick for "ready to undock"
  (`src/ui/common/StatusMark.tsx`). The undock warnings and the fitting draft's problems use the
  same marks.
- **Focus.** Every dialog - purchase, sale, both inspections, repair, resupply, insurance and the
  new undock question - was checked for:
  - keyboard opening;
  - a focus trap in both directions;
  - Escape;
  - focus returned to the opener.

  The settings panel is non-modal, as Technical Specification 12.3 asks, and Escape returns focus
  to its control.
- **Emergency controls.** Pending state is per action, so pause, stop and retreat stay usable while
  another command is in flight. A component test holds a warp in flight and uses all three.
- **Landmarks and names.** These were audited without change: the header and main landmarks, named
  regions, the station tabs as navigation, and the object list as the control surface of the SVG
  view.

## Contracts and persistence

- **Protocol, save format and state version are unchanged**, as the plan requires. No authoritative
  defect was found.
- **Content:** only localized guidance text changed. It is a presentation kind, so the balance
  tuning digest and the Phase 17 candidate are unaffected.
- **Preferences** are version 2, migrated in place (above).

## Tests

| Level | New or changed | What they prove |
|---|---|---|
| Unit, UI | `bindings.test.ts` (8) | Defaults are conflict-free; bindable and reserved keys; moving to a free key; taking a held key and leaving its action keyless; overrides equal to the default are dropped; hand-edited conflicts are settled; actions without shortcuts and reserved keys are refused; guidance parameters follow bindings. |
| Unit, UI | `preferences.test.ts` (+4) | Version 1 migration; the new defaults; field-by-field parsing of display, confirmations and bindings; display values written to and removed from the root element. |
| Unit, UI | `messageCatalog.test.ts` (+1) | Every key the settings compose at runtime; guidance text names keys only through binding parameters. |
| Component | `Settings.test.tsx` (9) | Display settings apply at once and are stored; the confirmation switch and "always asked"; Escape closes the panel; key capture, with the displaced action named; Enter refused and Escape keeping the key; remove and restore keys; the remapped key drives the handler, the button label and `aria-keyshortcuts`; refusal and "not available here" notices, which expire; fields, modifiers and repeats ignored while pause reaches through a list box; pause, stop and retreat usable while a warp is pending. |
| Component | `Notifications.test.tsx` (+1) | A focused toast outlives its duration, an unfocused one does not, and dismissing it moves focus to the event log control. |
| Accessibility | `presentation.spec.ts` (7) | **The exit gate.** Audit (WCAG 2.2 AA) of every station surface, a confirmation, the settings and a fight at both presentation variants, with no sideways scroll. Keyboard-only settings before a campaign, kept after a reload. Mouse-only settings and the undock question, answered and then switched off. A keyboard remap of Lock target and Departure: the guidance names the new key, Z locks in combat, and a refused key and a key not offered here explain themselves. Focus on all eight dialogs. With every colour made the same, hostility, selection, lock, ownership, threat, damage, notification level and fit validity still read by shape or word. |

Existing tests changed:

- **The preferences version** in a Notifications component test (1 to 2).
- **Undocking in browser flows.** Flows that undock a ship with a warning on purpose now use
  `tests/support/undock.ts`, which answers "Undock anyway" when asked: the combat, guidance, loss
  and progression browser specs and the combat and loss accessibility specs. One case is the
  accessibility loss flow, which sells its gun and flies to the base.

### Results

Run against the final code:

- typecheck, the architecture check (277 files, no violations) and content validation, including
  the floor;
- **1221 unit tests** (was 1205);
- **105 integration tests** (unchanged), including every balance career;
- **113 component tests** (was 103);
- traceability: **114 requirement ids**, all covered;
- the production build.

Playwright ran **58 tests** in one parallel run, and all passed in 19.3 minutes: the 51 existing
tests and the 7 new accessibility cases. The progression flow took 19.1 minutes (Phase 18, alone:
18.4) and the guided flow 5.7 minutes.

One unit property test (`inventory.test.ts`, the generated operation sequences) timed out once at
5 s in the baseline run before any Phase 19 change, while the machine was loaded. It passes alone
and passed in every later run.

## Findings worth retaining

- **Browser flows and the undock question.** Any flow that undocks a ship with an unloaded gun or
  unrepaired armour or hull is now asked first. The shared helper answers as a player would, so a
  flow does not depend on whether its fit happens to carry a warning. If Q7 option 2 is chosen,
  the "no reserve rounds" warning would join the same question.
- **A focused list box swallowed pause.** The browser keeps letters and digits for choosing an
  option, so the other shortcuts still wait until focus leaves the box. Tab or a click on the view
  frees them.
- **The key is part of the button's name.** Five specs find the fire button as "Fire E". Hiding the
  key from the name would have been cleaner with `aria-keyshortcuts`, but screen-reader support for
  that attribute is uneven, so the visible key stays in the name.
- **Guidance text and bindings.** A guidance text that names a key must use the binding parameter.
  The catalogue test enforces it, so new guidance cannot reintroduce a stale letter.

## Handoff to Phase 20

- No protocol, save or state-version change. Phase 20 closes the versions as they stand after
  Phase 18.
- Preferences version 2 is the first migrated local shape; its reader is the migration.
- The full browser suite now includes `presentation.spec.ts` (about 2.5 minutes in total).
