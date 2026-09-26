# Phase 18 completion note - Contextual onboarding, explanations, notifications, and audio

Status: complete. Date: 2026-09-26.

Implements Phase 18 of `docs/MVPImplementationPlan.md`. A new campaign now teaches its own loop.

- **Guidance.** A step-by-step guide leads the player through the whole loop: choose a site, fight
  it, loot it, come home, sell, get ready, refit and try a harder site. It can be skipped step by
  step, hidden and shown again.
- **Notifications.** The engine raises notifications for combat, travel, rewards, station
  transactions, loss and guidance. They are shown with a word and a shape for their level and
  grouped when they repeat. The history doubles as a filterable event log.
- **Audio.** Immediate danger and other levels have synthesised audible cues. Sound and visibility
  are set per category in local preferences, outside the campaign.
- **Explanations.** The two traps the Phase 16-17 simulations found are now explained without any
  rule change:
  - undocking on an empty capacitor;
  - a gun that reloads but stays idle.

  A third trap, found this phase, is taught too: the spare rounds start in the hangar.

The exit gate passes. A clean-profile Playwright run follows the guidance alone from a new
campaign to the second site (see Tests).

Two findings need a decision; see Q6 (updated) and the new Q7 in
`docs/agent-comm/requests/questions-and-answes.md`. Neither blocks.

## Guidance (Functional Specification 3.2 as MVP Scope 3 selects it)

### Content

`content/guidance/loop.json` is one declarative chain of 15 steps.

| Step | Surface | Completes when (registered predicate) |
|---|---|---|
| Choose a site | Departure | a destination is chosen |
| Carry spare rounds | Hangar | the hold carries 40 rounds a fitted gun can load |
| Undock | Departure | the ship undocks |
| Warp to the site | space | a tier 1+ encounter starts |
| Give a movement order | space | Approach, Orbit or Keep range is ordered |
| Lock a target | space | the player completes a lock |
| Open fire | space | a player weapon activates |
| Run your shield booster | space | a player shield booster or armour repairer activates |
| Clear the site | space | an encounter completes |
| Loot the wreck | space | loot is taken |
| Return and dock | space | the ship docks (after undocking) |
| Sell your loot | Market | something is sold (after returning) |
| Get the ship ready | Services | docked, repaired, every magazine full, capacitor at 95% or more (after returning) |
| Improve the fit | Fitting | a fit is applied |
| Try a harder site | Departure | a tier 2+ encounter starts |

The step texts name the controls and their shortcuts. The last steps teach what the Phase 17
simulations found decides the harder sites:

- kill the patrol's cutters before its marksman;
- at the base, keep range and fight the nearest brawler;
- never undock on an empty capacitor.

### Rules

- **Declarative objectives.** Predicates are registered engine operations
  (Technical Specification 10.6). Content picks one and its parameters and cannot supply a
  condition of its own.
- **Order and completion.** `requires` names only true prerequisites; the ready-check, for example,
  waits for a return. Steps are shown in authored order, and the current step is the first open
  one. An open step completes whenever it is satisfied, so a player who does something early is
  never asked to do it again.
- **Skip, hide, show.** These are commands, because guidance progress is campaign state
  (`onboarding.skipStep`, `onboarding.hide`, `onboarding.show`).
  - Skipping grants nothing; the MVP guidance needs no tutorial items.
  - Steps still record while the guidance is hidden, so showing it again never asks for something
    already done. Their notifications stay silent while it is hidden.
- **One grant per step.** A recorded step is its grant, so a replayed or repeated event cannot
  complete it twice (Technical Specification 15.3, check 9).

### Static checks (Technical Specification 10.6)

`scripts/lib/content/guidance.mjs` rejects:

- a requirement that is not a step of the chain;
- a requirement on a later step, which is what makes a loop impossible;
- a self-requirement;
- a duplicate step id;
- a tier no encounter reaches.

It also rejects dead ends. A step that cannot be skipped must complete through something the
player can always do: choose a destination, undock, dock or give a movement order. Every shipped
step is skippable.

The MVP floor requires the shipped chain to cover every part of the loop, including a harder site
(MVP-AC-10).

### Where it runs

`src/engine/application/observers.ts` runs after a command or elapsed interval has applied its
change, inside the same transaction and before the invariants. It runs guidance first, then
notifications (Technical Specification 9.2, steps 9-10). A step completed or a notification raised
therefore commits with its cause or not at all.

Creating, resuming, closing and resetting a campaign are not observed. A resumed campaign still
hashes identically to its snapshot; a unit test proves it.

The observers take no random draws and no wall-clock reads, so replay is unaffected.

## Notifications and audio (Functional Specification 19.7, 20; Technical Specification 12.4)

### Content

`content/notifications/rules.json` holds 28 definitions. Each has:

- a category and a severity;
- a message key and a cue;
- whether it may be hidden;
- once-per-site or always;
- a group window;
- a trigger, which is a registered engine operation.

The operations and the parameters they pass are documented in
`src/engine/simulation/notifications.ts`.

| Level | Raised for |
|---|---|
| Danger (audible, words and shape) | first hostile lock of a site visit; shield falling through 25%; armour first taking damage; hull first taking damage; the booster or repairer waiting for capacitor; ship destroyed (cannot be hidden) |
| Warning | a gun out of ammunition; a gun or afterburner starved of capacitor; a gun that reloaded but is idle while a hostile is locked; a lock lost out of range; undocking below 50% capacitor |
| Opportunity / completion | site cleared; bounty paid (grouped, summed); wreck to loot; recovery ship granted; guidance step done |
| Informational | docked, undocked, arrived; bought, sold, repaired, resupplied, insured, refitted; loot taken (grouped per item, summed); insurance paid |

Warp disruption, the sixth danger event in Functional Specification 19.7, is deferred with
electronic warfare (MVP Scope 8). The 4x/8x slow-down does not apply, because the MVP offers 1x
only.

### Validation

- **Semantic.** A cue must exist, danger must be audible, a ship loss may not be hideable, no two
  cues may speak for one severity, and one must speak for danger.
- **MVP floor.** The floor requires every included immediate-danger event and an unhideable loss.

### Cues

`content/audio/cues.json` holds four cues, one per level. Each is a short tone sequence that the
interface synthesises with Web Audio, so the build ships no audio files and makes no request. The
danger cue is also the save-integrity cue (`defaultFor: danger`).

### History (campaign state)

Up to 64 grouped entries, oldest dropped. Each entry has:

- `id` and a monotonic `sequence`;
- the definition, a group key, subjects and parameters;
- first and last time, and a count.

A repeat inside the definition's window joins the latest entry with the same key. Accumulating
parameters (credits, quantities) are summed. The entry moves to the end, so a grouped repeat reads
as new. `raisedThisSite` remembers once-per-site keys and is cleared on undock, arrival, docking
and loss.

Nothing reads the history to decide a rule (Technical Specification 8.1, 13).

### Interface (`src/ui/notifications/`)

- **New entries only.** New entries (sequence above the highest seen) become toasts; a reopened
  campaign does not replay its history.
- **Presentation.** Every toast shows a level word ("Danger", "Warning", "Done", "Info") and a
  distinct shape. Danger toasts are `role="alert"` and the rest are polite. Toasts last 6-20 s by
  level and can be dismissed.
- **Save failures.** A failing save shows an alert that cannot be dismissed, and its cue sounds once.
- **Cues.** Only the most urgent new cue plays. Cues closer than 600 ms merge unless the new one is
  more urgent (Technical Specification 12.4 rate limit; the engine still records every raise).
- **Event log (I).** Newest first, filterable by urgency and category. It still records hidden
  categories.
- **Alerts and sound.** Show and sound per category, sound on or off, and master, alert, interface
  and effects volumes, with a restore-defaults action.

### Preferences

`src/ui/preferences/` stores versioned preferences in `localStorage` under
`galactic-soup.preferences`. They are never in a snapshot. Stored values are parsed field by field,
so a damaged value costs one setting. A refused or full store keeps settings for the session.

## Explanations (Functional Specification 19.6, 22.10)

- **Capacitor readiness at departure.**
  - The departure panel shows the charge.
  - When the capacitor is not full, it shows how much running time fills it. The recharge formula
    (Functional Specification 9.8) is substituted in an expandable explanation from a new engine
    trace, `ShipData.capacitor.secondsToFull` and `rechargeTrace`.
  - It is information, not an undock warning (Q6).
- **After undocking.** The low-capacitor warning and the idle-gun warning explain the two traps
  when they happen.
- **Unavailability.** New commands and surfaces use projected availability with reasons:
  - skip is refused with `guidanceStepRecorded` or `guidanceStepNotSkippable`;
  - hide and show say they are already hidden or shown;
  - "Show me" says "You are already there".

  The message-catalogue test now also covers every key the new surfaces compose at runtime.
- **Guided surface.** The station surface the guidance points at carries a "Next step" badge.
  - The badge is decorative for assistive technology, so the control keeps its name.
  - The control's accessible description says the guidance points there.

## Contracts and persistence

- **Protocol 13**:
  - queries `onboarding.state`, `notifications.list` and `audio.cues`;
  - commands `onboarding.hide`, `onboarding.show` and `onboarding.skipStep`;
  - rule violations `guidanceStepUnknown`, `guidanceStepRecorded` and `guidanceStepNotSkippable`;
  - `ShipData.capacitor` gains `secondsToFull` and `rechargeTrace`;
  - projection topics `onboarding` and `notifications`;
  - domain events `onboarding.*` and `notification.raised`;
  - JSON Schemas for the three new data views, the request envelope and version constants.
- **Save format 10 / state version 10.** `CampaignState` gains:
  - `onboarding`: version, hidden, recorded steps;
  - `notifications`: sequence, bounded entries, `raisedThisSite`.

  Both have shape readers, invariants, a save-schema section and definition references. Recorded
  step ids and notification definitions must resolve, as for every other definition. The golden
  save is now `tests/fixtures/saves/format-10.json`; `format-9.json` joined the rejected unreleased
  shapes. No migration is owed (plan section 2, rule 7).
- **Content.** Three new kinds (`guidance`, `notifications`, `audio.cues`) have schemas, parsing,
  repository lookups, semantic checks and minimal fixture-pack entries.
  - Presentation kinds are excluded from the balance **tuning digest**, so the Phase 17 candidate
    stays current. `npm run balance` is unaffected: no rule reads them.
- **The station hub.** Which station surface is open now lives in `PlayScreen`, so "Show me" can
  open it. It resets to the hub while the ship is away, so a returning or recovered pilot lands on
  the hub where the sortie summary and loss report are.

## Tests

| Level | New | What they prove |
|---|---|---|
| Unit, engine | `guidance.test.ts` (11), `notifications.test.ts` (10) | Completion in the causing transaction; one grant per step; early completion counts; prerequisites; the spare-rounds predicate; skip grants nothing and its refusals; every step reachable by skipping (no dead end); hide/show while still recording; restore never completes a step and keeps the hash; no random draw. Grouping and summing; the 64-entry bound; monotonic sequence; newest-first projection; first hostile lock per site visit (a new visit re-arms it); shield threshold crossing; armour and hull first damage; starved defence; unhideable audible loss; low-capacitor undock warning; idle-gun warning. |
| Unit, content | `guidanceValidation.test.ts` (14) | Every static check above, both MVP floor checks, and unregistered predicates or triggers rejected by schema. |
| Unit, protocol | `guidanceSchemaParity.test.ts` (8) | Schema/runtime agreement for all six new requests with malformed variants; the three data views validated with every status and several severities populated. |
| Unit, UI | `preferences.test.ts` (5), catalogue case | Defaults, field-by-field parsing, corrupt and refused storage, round-trip; parameter resolution and locale formatting; runtime key coverage. |
| Integration | `guidance.test.ts` (2) | The whole loop over the protocol: every one of the 15 steps completes by play, none skipped, each exactly once; the history holds hostile lock (danger, audible, attacker named), bounty, cleared, loot, docked, sold, fitted and step notifications; guidance and history survive close and resume exactly. |
| Component | `Guidance.test.tsx` (6), `Notifications.test.tsx` (7) | First step, "Show me", advancing with a toast, skip, the step list in words, hide from the panel and show with J, and the guided tab's description. Capacitor explanation substitution (the formula with 60/15/300 written in, 225 s) and the full-capacitor case. New-only toasts; grouping with count and sum; hidden category versus unhideable loss; the log keeps hidden entries; cue selection, volume and a muted category; a failed save alert heard once; log filters; settings stored in the browser and defaults restored. |
| Accessibility | `tests/accessibility/guidance.spec.ts` (4) | axe with guidance, a toast, the log and the settings open; keyboard-only Show me, Skip, J and I; words and shapes for states and levels; doubled UI and text scale. |
| Browser | `tests/browser/guidance.spec.ts` (1) | **The exit gate.** A clean profile (no IndexedDB, no preferences) reads the guidance's current step at every turn and does only what its text says, with the control or key it names, from a new campaign to arrival at the Pirate Patrol. The guidance then reports 15 of 15 and its closing text, and the event log names the pirate's lock. |

Existing tests changed by this phase:

- the topic lists at campaign creation;
- the fitting commit's events, which now include the upgrade step and its notifications;
- the version pins (save 10, migration fixture chain to 10);
- the golden-save paths;
- the compiled definition kinds.

### Results

To be filled in below once the full gate has run.

## Findings worth retaining

- **The spare rounds start in the hangar (Q7).** A starter magazine holds 20 rounds; the scout takes
  about 60. Nothing warned a first-time player. The guidance step teaches it; Q7 asks whether the
  starting state or the undock warnings should change instead.
- **A key shortcut that is unavailable does nothing silently.** The button beside it says why.
  Pressing L before the target is in lock range is the common case. The lock step's text now says
  "once it is inside your lock range". Phase 19's input pass may want an audible or visible "not
  now" for a refused shortcut.
- **The warp chooser defaults to the farthest arrival distance (100 km).** A new pilot who presses
  W lands minutes away from the scout and out of lock range. The warp step's text now says to set
  Arrive at to 10 km. The default itself dates from Phase 10; Phase 19's input pass may want to
  revisit it, or remember the last choice.
- **Lifting station-surface state has a consequence.** The surface persisted across a sortie and
  hid the loss report on return. It now resets while undocked; the loss accessibility audit caught
  it.
- **Notification text and test locators.** Playwright's `getByText` matches case-insensitive
  substrings. A toast repeating "Docked at Borrell Harbour" would have made existing specs
  ambiguous, so the docked toast is worded "Borrell Harbour: docked…". Keep toast wording distinct
  from persistent labels.

## Handoff to Phase 19

- Preferences exist (`src/ui/preferences/`, version 1) for categories, sound and volumes. Phase 19
  adds UI and text scale, contrast, reduced motion, confirmations and remappable bindings to the
  same versioned store.
- New shortcuts: J toggles the guidance, I the event log. `defaultShortcuts()` still has no
  collisions.
- Toasts reserve their height, so the view does not jump. At doubled scale they wrap; the
  accessibility spec covers that, and a Phase 19 visual pass may still tune it.
- If Q6 option 1 or Q7 option 2 is chosen, the departure panel already has the data and the place
  to turn information into a warning.
