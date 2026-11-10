# UIR1-02 completion note - One header, game menu and settings

Status: complete. Date: 2026-11-10.

Implements phase UIR1-02 of `docs/MVPUIReview01ImplementationPlan.md`. The review findings it
covers:

- collapse the three headers into one;
- keep the icon, player and system, and remove the game title and "Engine ready…";
- make the settings icon the game menu, keep its entries and add Settings;
- move sound and alerts into Settings.

## What changed

### One header

- **`AppShell`** (`src/ui/shell/AppShell.tsx`, CSS) no longer draws a header band.
  - While the engine connects, it shows the mark and "Connecting to the engine…".
  - Once the engine is ready, the readiness text is only announced. It stays in the `Engine status`
    live region, which is visually hidden.
  - "Galactic Soup" is a visually hidden `h1`, and the tagline is gone.
  - A failed start still shows the compatibility failure.
  - Build and engine details moved into Settings as a collapsed section (`EngineDiagnostics`, passed
    through `GameRoot`'s `settingsExtras`).
- **`CampaignFrame`** (`src/ui/frame/CampaignFrame.tsx`, CSS) is the one compact header. In one
  wrapping row it holds:
  - the mark;
  - the pilot, with the location below it;
  - wallet, simulation time and clock;
  - Pause/Resume;
  - the save status;
  - the game-menu icon.

  At 45rem and narrower, the mark, pilot and menu share the first row and the rest wraps below. It
  measures about 55 px at 1440 wide, where the two bands it replaces took about 140 px.
- **Location when docked** now names the system and its danger: "Docked at Borrell Harbour ·
  Borrell — danger 1".
  - The two parts are separate spans, so `getByText('Docked at Borrell Harbour')` still matches.
  - In space it is unchanged: "{site}, {system} — danger {n}", or "In warp".
- **Local headings.** The station heading (`Borrell Harbour` and "Your ship is docked…") and the
  space heading (site name and system/danger) repeated the header as a second band. They are now
  visually hidden.
  - They remain `h2` landmarks' names for assistive technology and for heading navigation, and the
    tests that look them up still work.
  - The space travel status (warp/dock progress) stays visible. Its row collapses when nothing is in
    transit.
- **Start screen** (`GameRoot`): a slim bar with the mark and the same game menu, above the campaign
  panel. Settings is the only menu entry there.

### Game menu

- **New `src/ui/frame/GameMenu.tsx`** (CSS). The trigger is an icon-only `ActionButton` for the new
  registry action `game.menu`.
  - It uses the settings icon and has the accessible name "Game menu".
  - Its tooltip reads "Game menu" (UIR1-01 treatment).
  - It sets `aria-expanded` and `aria-controls`.
  - The panel is a non-modal `role="group"` named "Game menu". It follows the trigger in the
    reading order.
  - Escape closes it and returns focus to the trigger. A pointer press outside closes it without
    moving focus.
- **`ActionButton`** gained `expanded`, `controls` and `buttonRef`, for disclosure triggers.
- **Entries, all of which were in the previous menu:**
  - Hide/Show guidance;
  - Save now;
  - the Campaign management disclosure, containing:
    - Close campaign;
    - Reset campaign, which keeps its confirm/cancel step and warning;
    - Campaign details (identity and save format).

  Settings is the new last entry.
  - Closing the menu in any way drops a half-finished reset confirmation.
  - The menu body is rendered only while open. A closed `<details>` no longer leaves its buttons in
    the DOM.

### Settings

- **`SettingsPanel`** now contains an "Alerts and sound" group, which is the embedded
  `NotificationSettings`.
  - It also accepts extra sections (`children`, used for the diagnostics).
  - When opened from the menu, it focuses its heading.
  - Escape and Close settings return focus to the game-menu trigger.
  - In play, it opens at the top of the working column, above the station or space screen. The
    screen is not unmounted, so station selections and drafts survive.
  - Before a campaign it opens under the start bar.
- **`NotificationSettings`** no longer takes a runner. Its restore button, "Restore alert and sound
  defaults", resets only notifications and audio, in line with the other groups.
  - Before this change it called `restoreDefaults()`, which also reset display, confirmations and
    key bindings.
- **`NotificationCenter`** lost the "Alerts and sound" toolbar button and panel. The event log and
  notification delivery are unchanged.
- **Registry:**
  - `game.menu` added;
  - `notifications.settings` and the now-unused `preferences.restoreDefaults` removed.

  Neither removed action had a shortcut, so stored bindings are unaffected.

### Preference ownership

- **`PreferencesProvider`:** a nested provider now always defers to the outermost one, even when it
  is given storage. Only the outermost provider reads and writes storage and applies display
  preferences to the document. Before this change, a nested provider with injected storage became
  an independent second state.
- **`GameRoot` owns the campaign-level provider.**
  - It is outermost in component tests and passes through under `AppShell` in the app.
  - It takes an optional `preferenceStorage`.
  - `PlayScreen` no longer creates a provider, and its `preferenceStorage` prop is gone. No caller
    used it.
  - `AppShell` takes an optional `preferenceStorage` too.
- **Result:** Settings, opened before or during a campaign, edits the same state that the play
  view's shortcuts, audio cues and notification visibility read. Changes apply immediately.

## Contract change

The header needed the docked system name, and the station projection did not carry it. Importing
content into the UI is not allowed, so:

- **Protocol 14 → 15.** `StationServicesData` gains `systemNameKey` and `dangerRating`, filled
  in by `stationServicesProjection` from the station's system.
- **Updated together:**
  - `src/protocol/economy.ts`;
  - `src/protocol/version.ts`;
  - `schemas/protocol/station.services.data.schema.json`;
  - the `protocolVersion` const in the `client-request`, `system.health` and `system.capabilities`
    schemas;
  - README.
- **Lock re-recorded** with `npm run contracts:record`.
- **Golden fixtures re-recorded** with `npm run golden:record`, after confirming that the only
  failure was the recorded protocol version. The fixture diff is exactly:
  - `protocolVersion` 14 → 15 in the replay log and the six golden save envelopes;
  - each envelope checksum;
  - the five schema digests and the version in `lock.json`.

  The simulation state is unchanged.
- **No save-format, campaign-state or content change.** Old campaigns resume.

## Tests

- **Helpers.**
  - `tests/support/cockpit.ts` (browser): `gameMenuButton`, `openGameMenu` (now the icon button,
    by `aria-expanded`), and `openSettings`.
  - New `tests/support/gameMenu.ts` (component): `openGameMenu` and `openSettings`.
- **New component tests** (`CampaignPanel.test.tsx` › "game menu and settings"):
  - Settings from the icon-only menu before a campaign: heading focus, the Alerts-and-sound group,
    and focus return on Escape.
  - Every previous menu entry is present. Escape returns focus. An outside press closes the menu.
    A pending reset is dropped and nothing is deleted.
  - The docked system and danger come from the projection.
  - In play: a text-scale change applies to the document; a binding changed in Settings is the one
    the station dispatches; audio, display and bindings are stored together and read back after
    reopening.
  - Nested providers share one state and only the outer storage is written.
- **Moved:** the alerts-settings storage/restore test moved from `Notifications.test.tsx` to
  `Settings.test.tsx`, which now also checks that restoring alerts leaves the display untouched.
  `Notifications.test.tsx` asserts that the toolbar keeps only the event log.
- **`AppShell.test.tsx`:**
  - no tagline;
  - no Settings button outside the menu;
  - the trigger's `aria-expanded`;
  - diagnostics opened through menu → Settings.
- **`economy.test.ts`:** the services projection carries `systemNameKey` / `dangerRating`.
- **Updated to the menu flow, with no assertion weakened:**
  - `CampaignPanel` close/reset/save;
  - `Guidance` "Show guidance from the frame";
  - `boot.spec.ts`. The h1 now asserts presence, and the spec also checks that the readiness text
    is visually hidden, that the tagline is gone and that the menu is visible.
  - `cockpit.spec.ts`;
  - `presentation.spec.ts`, including a keyboard-only path through the menu with a heading-focus
    check;
  - `guidance.spec.ts` (alerts via Settings).

## Commands and results

| Command | Result |
|---|---|
| `npm run verify` (typecheck, architecture, content, unit, integration, performance, component, traceability, build) | pass: unit 1376, integration 134, performance 5, component 128; traceability 117/117 |
| `npm run contracts:record`, `npm run golden:record` | written; diff reviewed as above |
| `playwright --project=browser --project=accessibility` (Chromium), full | 61 passed, 3 failed, 16.0 min (see below) |
| Rerun after the fixes: presentation, shell and campaign accessibility; boot, cockpit and campaign browser | 27/27 pass |
| `npm run typecheck`, `check:architecture`, `build`, component tests, after the last change | pass; component 128/128 |

All three failures in the full run were in `presentation.spec.ts`:

- Two tests still opened Settings with a direct `/^Settings/` button selector, which the first
  pass missed. They now go through `openSettings`. The keyboard test now expects focus to return
  to the game-menu trigger.
- The doubled-scale audit found a real bug. Under the tall, wrapped sticky header, the menu panel
  (`max-height: 70vh`) extended below the viewport, so Settings could not be reached.
  `GameMenu` now caps the panel to the room left below the trigger (at least 160 px) when it
  opens, and again on resize. The test is unchanged and passes.

Every other browser and accessibility flow passed in the full run, including combat, loss,
guidance, persistence, offline, progression, space and station.

Firefox suites were not run; they belong to phase 10's gate.

## Visual verification

These checks were made against the Vite dev server. The screenshots were inspected during the
session and not committed.

- **1440×900, station:**
  - one header row, with "Docked at Borrell Harbour · Borrell — danger 1";
  - content begins at y≈95, where it began at ≈170 before;
  - the menu shows guidance, save, campaign management and Settings.
- **1440×900, space:** one header row ("Borrell Harbour, Borrell — danger 1"), with no repeated
  site band above the radar.
- **Start screen:** the mark and the menu. Settings shows Display, Confirmations, Alerts and sound,
  Keyboard shortcuts and Build details.
- **390 px wide:**
  - the header wraps to three rows, with the menu on the first;
  - the open menu sits within the viewport (16–342 px);
  - there is no page-level horizontal overflow.
- **1024 px, high contrast, 1.5× text:** the header wraps legibly. The focus ring on the trigger
  is visible, and hover shows the "Game menu" tooltip.

## Remaining issues and guidance for the next sessions

- **Pre-existing, not addressed:**
  - **Save status after resume.** The header's save status reads "Nothing saved yet." after a
    resume, until the next save, although the slot holds one. The start screen's panel shows the
    same message under a resumable save.
  - **Mid-word breaks.** At 1.5× text scale, labels in the space command bar ("Approac h") break
    mid-word. Phase 09 rebuilds that area.
- **Visually hidden headings.** The station and space `h2`s are now visually hidden. Phase 06 and
  phase 09 can treat the header as the screen title and need not reintroduce a visible title band.
- **Menu items in component tests.** Menu entries exist only while the menu is open. Open the menu
  with `tests/support/gameMenu.ts` in component tests and `tests/support/cockpit.ts` in browser
  tests.
- **Preference storage in tests.** Inject it at the outermost provider: `GameRoot` or `AppShell`
  `preferenceStorage`, or a wrapping `PreferencesProvider`. A nested provider ignores its storage
  by design.
- **For phase 10's release gate.** The contract-lock and golden digests changed with protocol 15,
  so the gate's recorded identity will differ from the last candidate.
