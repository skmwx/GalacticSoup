# UIR1-06 completion note - Overview and priced station services

Status: complete. Date: 2026-11-10.

Implements phase UIR1-06 of `docs/MVPUIReview01ImplementationPlan.md`. It covers these review
findings:

- Overview: "the overview main section has buttons that are duplicates of left hand menu. Remove
  them."
- Services: "Move everything to main screen. Repair is a simple operation with a price, just show
  the 'repair armor', 'repair hull' and 'repair all' button with a price. Similar with resupply
  ammunition."

## What changed

### Repair scopes, end to end (protocol 16 → 17)

- **Contract (`src/protocol/economy.ts`, `requests.ts`):**
  - `REPAIR_SCOPES = ['armor', 'hull', 'all']` and `RepairScope`.
  - `repair.preview` now takes `RepairPreviewPayload { shipId, scope? }`. An omitted scope is the
    whole repair, exactly as before.
  - `RepairPreviewData` gains a required `scope`, the scope it priced.
- **Validation (`validation.ts`):** `repair.preview` has its own case: `shipId` plus an optional
  `scope` from the enum. Anything else is refused. Resupply and insurance still take `shipId` only.
- **Schemas:**
  - `client-request.schema.json`: a separate `repair.preview` conditional and a new
    `repairPreviewPayload` def.
  - `transaction-preview.data.schema.json`: `repairPreview` requires `scope`.
  - The protocol `const` in `client-request`, `system.health` and `system.capabilities` is now 17.
  - `contractClosure.test.ts` lists `/$defs/repairPreviewPayload#scope` as optional by
    specification (Functional Specification 10).
- **Projection (`src/engine/projections/economy.ts` `repairPreview`):**
  - The price applies the existing formula to the selected paid layers only, rounded up once:
    `ceil(ref × (armorTerm? + hullTerm?) × station modifier × standing multiplier)`.
  - Each scope's trace has its own formula key: `repair.armorPrice`, `repair.hullPrice`, or the
    existing `repair.totalPrice`. It lists only the operands of the layers it prices.
  - Availability:
    - Armour needs armour damage. Otherwise it is refused with the new
      `repair.unavailable.noArmorDamage`.
    - Hull needs hull damage. Otherwise it is refused with the new
      `repair.unavailable.noHullDamage`.
    - All is available whenever any layer is damaged or the capacitor is not full, as before.
    - Every scope still checks the service and that the wallet covers its total.
  - The token binds `{shipId, scope}` as canonical parameters. Its relevant versions are unchanged.
- **Confirmation (`economyCommands.ts` `applyRepair`):**
  - It re-projects from the token's parameters, as every economic confirmation does. Any change in
    paid damage, wallet, service or values therefore answers `STALE_PREVIEW` with the
    replacement, and nothing is charged.
  - It restores only the scope's paid layers. **Every scope also restores the shield and recharges
    the capacitor, free.** I chose this so that a cheaper partial repair never leaves the free part
    undone, which would push the player to a paid Repair all just for the shield.
- **Functional Specification:**
  - §10 now describes the three repair choices, their availability, the free shield and capacitor
    with every choice, and the once-per-choice rounding. Because each choice rounds on its own,
    armour + hull may cost one credit more than all.
  - §10 also says each choice shows its price before it is chosen and is still confirmed and
    re-checked.
  - §19.5 now says the overview does not repeat the navigation list, and that routine single-price
    operations are offered on it with their prices.
- **`README.md`:** protocol 17, the rail and Overview services, and the repair choices. The
  "Closed contracts" sentence still says "version 14", as it did before this phase. It records the
  MVP closure, so I left it.

### Overview (`StationScreen.tsx`, `ServicesPanel.tsx`, `panels.ts`)

- **Removed:**
  - the Overview's duplicate navigation tiles (and the `.tiles` / `.tileDetail` CSS);
  - the separate Services surface and its rail entry: `STATION_PANELS` no longer contains
    `station.services`.
- **Kept on the Overview:**
  - the no-ship notice;
  - the recent loss report;
  - the sortie summary;
  - the older collapsed loss report.

  The left rail, Ship readiness and the guidance markers are unchanged.
- **New Services section** (`region` named "Services", `data-services`), one row per service:
  - **Repair:** Repair armour · N ISK, Repair hull · N ISK, Repair all · N ISK.
  - **Ammunition:** Resupply ammunition · N ISK.
  - **Insurance:** Improve insurance · N ISK.
- **Previews and prices:**
  - Each button is an `ActionButton` whose name carries the engine's previewed total.
  - The five previews (`useTransactionPreview`) are requested while the Overview is shown. They are
    refreshed on every assets revision, as the dialog preview always was.
  - While the first preview is in flight, a button reads "… (pricing…)" and is unavailable with
    "The price is still being worked out."
- **Unavailable buttons:**
  - An unavailable operation shows the engine's reason in the shared tooltip: no armour damage,
    already fully repaired, fully supplied, already enhanced, insufficient credits, no ship.
  - It names its price only when there is something to pay for. Insufficient credits therefore
    still shows the price; "nothing to do" shows none.
  - A station that does not offer a service is not previewed. A shipless pilot sees every button
    unavailable with "You have no ship to service…".
- **Confirmation:**
  - Clicking a button opens the shared `TransactionDialog` with that hook's preview, so the dialog
    shows exactly the figure on the button, with no second request.
  - Titles: "Confirm armour repair" / "Confirm hull repair" / "Confirm full repair" /
    "Confirm resupply" / "Confirm insurance".
  - Zero-credit repairs are still confirmed.
- **Repair dialog (`TransactionDialog.tsx` `RepairDetails`):**
  - A subject line names the scope, for example "Repair the armour only, restore the shield and
    recharge the capacitor. The hull is not repaired.".
  - The shield reads "N points, restored for free".
  - A damaged layer the scope leaves alone is listed as "… - not repaired by this choice".
  - Resupply (lines, from-hold, purchased) and insurance (coverage, payouts) details are unchanged.
- **Registry:**
  - New `repair.armor` / `repair.hull` / `repair.all` entries (icon `repair`, no shortcut) for the
    three openers. The dialog's Confirm still runs `repair.confirm`.
  - `station.services` stays in the registry with its remappable `R` key. Pressing it now opens the
    Overview and moves focus to the Services heading, so existing bindings stay useful. Its
    description is reworded.

### Guidance redirect (`src/ui/guidance/GuidancePanel.tsx`)

`presentedSurface()` maps `station.services` to `station.hub`. It is applied to:

- `guidedSurface` (the rail marker);
- the "Where:" label;
- whether Show me is offered;
- where Show me goes.

Authored content and saved onboarding still say `station.services`, so no content, guidance schema
or save changes. The "Get the ship ready" step now reads "Where: Overview", and Show me opens it.
`presentedSurface` and `surfaceLabelKey` are also exported from `@ui`.

### Localization (`en.json`)

- **Added:**
  - `action.repair.{armor,all,hull}` (+ `.detail`) and `formula.repair.{armorPrice,hullPrice}`;
  - `repair.{damageKept, scope.all, scope.armor, scope.hull, shieldDetail}` and
    `repair.unavailable.{noArmorDamage,noHullDamage}`;
  - `services.{ammunition, insurance, priceLoading, priced, pricing, repair, repair.all,
    repair.armor, repair.hull, repairDialog.all, repairDialog.armor, repairDialog.hull}`.
- **Changed:** `services.heading` is now "Services"; `action.station.services.detail`.
- **Removed:** `services.detail`, `services.openRepair`, `services.repairDialog`.

## Fixtures re-recorded (reviewed)

`npm run contracts:record` and `npm run golden:record`. I reviewed the diff:

- `lock.json`: protocol 17, and the digests of the four changed schemas.
- `golden-campaign.json`:
  - `protocolVersion` is 17.
  - The three recorded `repair.confirm` tokens have a new `valuesHash`, because the preview now
    contains `scope: "all"`. Their `canonicalParameters` are unchanged (`{shipId}`, omitted scope).
  - **No checkpoint state hash moved.**
- Six golden saves: only `protocolVersion` and the envelope `checksum`, which covers it. The state
  is identical. There is no save-format, campaign-state or content change.

## Tests

- **`tests/unit/engine/economy.test.ts`** (3 new cases):
  - Armour, hull and all scopes priced with one `ceil`; an omitted scope equals all; scope-specific
    traces.
  - Each confirmation restores exactly its layers plus shield and capacitor, and charges exactly its
    total. The hull price is unchanged after an armour repair, and armour then has nothing left.
  - Stale paid damage is refused as `STALE_PREVIEW` with a higher replacement. The same token
    cannot be used twice. An unaffordable scope is unavailable with the credits reason and its
    price.
  - With shield and capacitor only: armour and hull are refused with their reasons, and all is
    available at 0.
- **`tests/unit/protocol/validation.test.ts`:** `repair.preview` with no scope and with each
  scope, and refusal of an unknown scope, a null scope and an unexpected field. Resupply still
  refuses `scope`.
- **`tests/component/StationScreen.test.tsx`** (`services`, rewritten, 4 cases):
  - **Overview:** no Services rail entry; each surface button appears once; whole-ship repair
    buttons are unavailable with reasons and Repair all names no price; Improve insurance is named
    with the engine's quoted premium; `R` from Market returns focus to the Services heading.
  - **Insurance:** commits from the Overview, and then becomes unavailable.
  - **Armour repair:** the three button prices equal the engine's quotes. The dialog states the
    scope, the hull left damaged and the total. The charge equals the quote. Afterwards the layers
    are missing 0/0/30, armour is unavailable, and the hull price is unchanged.
  - **Shield and capacitor only:** armour and hull are unavailable, "Repair all · 0 ISK", the free
    shield is stated, the confirmation is made, and credits are unchanged.

  The damaged cases resume a sealed `testCampaign()` save from a memory store, with the clock
  paused. The golden fixtures need Node file APIs that jsdom lacks.
- **`tests/component/LossScreen.test.tsx`:** shipless: all five Overview service buttons are
  unavailable with the no-ship description.
- **`tests/component/Guidance.test.tsx`:** the `station.services` → Overview redirect and its
  label.
- **New `tests/support/services.ts`:**
  - `servicesRegion`, `openServices`, `serviceButton` (waits until priced), `openService`;
  - `takeService`, which confirms the quoted total. On a stale-price replacement it confirms the
    shown figures again and never bypasses them.
- **Selectors migrated:**
  - browser `station` (it also checks that the premium on the button is in the dialog), `combat`,
    `guidance` and `progression`;
  - accessibility `station` (the refusal is now the button's description and focus tooltip) and
    `presentation`. The focus-trap check opens the insurance confirmation; a new ship has nothing
    to repair or resupply.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run check:architecture` | pass (286 files, no violations) |
| `npm run test:unit` | 78 files, 1403 tests pass. One run during the Playwright run timed out once at 5 s (`rejects starting cargo…`, unrelated). It passed alone and in a clean rerun. |
| `npm run test:integration` | 25 files, 134 tests pass (including the golden replay and transport parity) |
| `npm run test:component` | 11 files, 137 tests pass |
| `npm run traceability` | 117/117 covered |
| `npm run build` | pass |
| `npm run contracts:record`, `npm run golden:record` | written; diff reviewed above |
| Playwright Chromium, accessibility `station`, `presentation`, `loss` | 16 passed (1.4 min) |
| Playwright Chromium, browser `station`, `combat`, `guidance`, `progression`, `loss` | 9 of 10 passed in the combined run (30.8 min). The progression mastery flow hit its 30-min test timeout in the Pirate Patrol fight, after the services steps had passed: it was stuck 11 km from the Marksman with the booster out of capacitor. That run shared the machine with other test runs and screenshot scripts. Rerun alone: 1 passed (15.3 min). This is a load-sensitive fight timing issue in space, not touched by this phase; watch for it in the phase 10 gate. |

`validate:content` was not needed: no content changed. The Firefox suites belong to phase 10's gate.

## Visual verification

Script-driven Chromium against `vite preview`, at 1440×900 and 390×844. The screenshots were
inspected during the session and not committed.

- **1440, new campaign:**
  - The rail lists Overview, Market, Hangar, Fitting, Ship, Departure. The Overview shows Last
    sortie, then Services.
  - Services shows Repair (Repair armour / Repair hull / Repair all), Ammunition (Resupply
    ammunition) and Insurance ("Improve insurance · 1,800 ISK").
  - There are no duplicate tiles. `scrollWidth` is 1440.
- **1440, hovering Repair armour:** the tooltip "The armour is not damaged." floats over the next
  row without moving it.
- **390:** the rail wraps into a grid. Each service row wraps its label above its buttons; Repair
  all wraps to a second line. `scrollWidth` is 390.
- **Insurance confirmation:** opens from the Overview with the premium as the total.
- **Not captured as a screenshot:** a damaged ship's priced repair buttons. That needs a fight, or
  re-sealing a save inside the page. The component tests assert those names and dialogs, and the
  browser `progression`/`guidance` flows repair after real fights in Chromium.

## Q12 (stale confirmation during regeneration)

Q12 is reproduced and **inherited unchanged**. In a headless probe, the armour, hull and all
scopes were each previewed with the clock running and the shield and capacitor regenerating, then
confirmed one simulated second later. All three were refused with `STALE_PREVIEW`.

Its two causes are untouched by this phase:

- `assets.version` increments on each regeneration quantum.
- The repair hash still includes the shield damage and capacitor charge.

Stale-price protection is unchanged, and the replacement flow still lets the player confirm the
shown figures. The slice is usable, so no remediation session was created.

**One amplification to carry into final acceptance:** the Overview now holds five live previews
instead of at most one open dialog. While docked with the clock running and something regenerating,
each regeneration quantum re-requests all five. The Q12 note estimates up to about 20 quanta a
second. The buttons do not flicker, because the previous figures stay until the new ones arrive.
Still, the worker answers up to about 100 cheap previews a second until regeneration finishes, and
then nothing. The Q12 fix (regeneration no longer bumping `assets.version`) removes this as well.

## Remaining issues and guidance for the next sessions

- **Deferred guidance wording.** `content.guide.loop.ready.body` says "In Services
  ({keyStationServices}), repair and resupply…".
  - It is still followable: the `R` binding and Show me both lead to the Overview's Services
    section, and the label reads "Where: Overview".
  - Changing it changes the content hash and every golden save, so add it to the deferred content
    pass with UIR1-03, -04 and -05.
  - Suggested text: "On the Overview ({keyStationHub}), use Repair all and Resupply ammunition.
    Repairing the shield is free and recharges the capacitor with it…".
- **`sortie.next` (UI catalogue)** says "repair and refill magazines under services". It reads
  acceptably, since the section is titled Services. Reword it in phase 10 if the reviewer prefers.
- **Rounding:** armour + hull can exceed all by 1 ISK. This is specified and tested, not a bug.
- **For phase 07:** Departure is unchanged by this phase. Station surface changes still go through
  `useStationNavigation(...).request`. `STATION_PANELS` no longer has `station.services`, so any
  guidance step that names a surface must go through `presentedSurface`, already applied in the
  guidance panel.
