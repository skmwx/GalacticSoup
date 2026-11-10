# UIR1-03 completion note - Market modes and item suitability

Status: complete. Date: 2026-11-10.

Implements phase UIR1-03 of `docs/MVPUIReview01ImplementationPlan.md`. The review findings it
covers:

- a switch between Buy and Sell, one set of prices in each, and only owned items in Sell;
- which weapon a charge suits, and a mark on charges that fit a weapon in the current fit;
- icon-only Buy, Inspect and Sell controls;
- the slot each module fits.

## What changed

### Engine and protocol (protocol 15 → 16)

- **`market.listings` gained engine-projected suitability and a sell side.**
  - `MarketListingData.suitability` (`MarketSuitabilityData | null`):
    - module: `{ kind: 'module', slot, hardpoint }`, from the module definition;
    - charge: `{ kind: 'ammunition', weapons, currentFit }`.
      - `weapons` lists every module definition that accepts the charge, each with `fitted` (is it
        in the active ship's committed fit).
      - `currentFit` is `compatible`, `incompatible`, `noWeapons` or `noShip`. `compatible` means at
        least one fitted weapon accepts the charge. Offline weapons count; the mark does not claim
        the weapon is online, loaded or able to fire.
    - anything else (hulls, salvage): `null`.
  - `MarketListingsData.owned` (`MarketOwnedStackData[]`): the plain stacks in this station's
    hangar, then in the active ship's hold when it is docked here. Each carries `source`
    (`hangar`/`cargo`), quantity, item, `recoveryGrant`, `unitSalePriceCredits` (`null` when the
    station does not trade it), `sellable`, `unavailableReason` and `suitability`.
    - Fitted modules and loaded charges live in the fitting store and are never listed.
    - Remote hangars are not listed; while undocked the list is empty.
    - Unsellable stacks stay listed with the reason: the market's own unavailability, then
      `market.unavailable.listing`, then `market.unavailable.recoveryGrant`. The sale preview still
      refuses independently, with the same reasons.
- **One compatibility rule.** New `moduleAcceptsCharge` in `src/engine/domain/fitting/validity.ts`
  is used by fitting validity (ammunition mismatch) and by the market projection, so the market
  cannot disagree with what fitting accepts. Suitability reads the committed fit, never a draft.
- **Contracts updated together:**
  - `src/protocol/economy.ts`, `src/protocol/version.ts` (16), README;
  - `schemas/protocol/economy.common.schema.json` (`marketSuitability`),
    `market.listings.data.schema.json` (`suitability`, `owned`);
  - the `protocolVersion` const in the `client-request`, `system.health` and
    `system.capabilities` schemas.
- **Lock and goldens re-recorded** (`npm run contracts:record`, `npm run golden:record`) after
  confirming the only failures were the recorded protocol version and schema digests. The fixture
  diff is exactly `protocolVersion` 15 → 16, the six envelope checksums, and five schema digests
  plus the version in `lock.json`. No simulation, save-format or content change; old campaigns
  resume.

### Refresh policy (`src/ui/frame/usePlayData.ts`)

The market projection now also refreshes on the `assets`, `inventory` and `fitting` topics, so the
sell side follows transfers and sales, and the compatibility marks follow an applied refit. It is
still station-only, so nothing extra is read in space.

### Market panel (`src/ui/station/MarketPanel.tsx`, `Station.module.css`)

- **Buy/Sell switch.** A native radio group ("Market mode", visually hidden legend) drawn as a
  segmented control; Buy is the default. The checked option is marked by fill, weight and
  underline, not colour alone. Arrow keys move between modes. The search applies to the active
  mode. Mode is panel state, so it resets to Buy when the panel is reopened.
- **Buy** shows Item, Fits, You pay, Stock and icon-only Buy and Inspect. The "You receive" column
  is gone.
- **Sell** shows Item (with the recovery-grant label), Fits, Location (Hangar/Hold), Quantity, You
  receive (per unit, or "Not traded here") and icon-only Sell and Inspect.
  - Controls are named with item and place, e.g. "Sell Fusion S (Hold)", so identical items in the
    hangar and the hold are distinguishable by name as well as by row.
  - An unsellable stack's Sell control is unavailable, with the engine's reason in its tooltip and
    accessible description (UIR1-01 treatment).
  - The sale dialog gained a quantity field (whole positive numbers up to the stack size; default
    the whole stack). The preview and confirmation path is unchanged.
- **Fits column.** Modules read "Weapon slot, turret hardpoint" or "Engineering slot". Charges read
  "For 200mm Autocannon" plus a match line: "✓ Fits a weapon you have fitted" (✓ is
  `aria-hidden`, the words carry the meaning), "No fitted weapon uses it", "Your ship has no
  weapons fitted" or "You have no active ship".
- **Inspection is mode-specific.** It shows the one price of the mode it was opened from (You pay
  with the station-sell trace, or You receive with the station-buy trace), supply, Fits and, for
  charges, Your current fit. The expanded formula explanation and the comparison remain. The
  explanation label now reads "Show how this price is calculated".
- **Preserved:** the quantity and Deliver-to choice in the Buy dialog, exact totals and the
  confirmation flow, the no-ship notice, and the shipless hull purchase.
- **Layout fix found during visual checks.** A visually hidden header inside a horizontally
  scrolling table escaped the scroll box and widened the page at 390 px. `.tableWrapper` is now
  `position: relative`.
- **Localization:** new `market.mode*`, `market.fits`, `market.yourFit`, `market.source*`,
  `market.sellItemFrom`, `market.inspectItemFrom`, `market.slotFit*`, `market.chargeFor*`,
  `market.fitMatch.*`, `hardpoint.*`. Changed `market.sellCaption`, `market.nothingToSell` and
  `market.explainPrice`. Removed the unused `market.sellHeading` and `market.sellItem`.
  `market.inspectItem` is still used by the hangar.

## Tests

- **New `tests/unit/engine/marketListings.test.ts`** (engine projection):
  - module slot and hardpoint, and `null` for a hull;
  - charge weapons and match; a draft does not move the match; an applied railgun flips both
    projectile and hybrid charges; clearing the weapon gives `noWeapons`;
  - `noShip` after a loss without recovery;
  - the sell side lists the hangar and hold stacks of the same item separately, never fitted or
    loaded stacks, at the listing's sale price; one sale from each source;
  - goods at another station's hangar are absent (two-station content); nothing is listed while
    undocked;
  - a recovery-grant stack is listed, unsellable, with the reason, matching the sale preview.
- **`StationScreen.test.tsx`:**
  - Buy shows only the purchase price; Sell shows only owned local stacks with location and sale
    price, without the fitted autocannon; the filter applies to the active mode;
  - slot and charge suitability are visible before buying, and update after a refit made in the
    Fitting panel and applied; inspection repeats them with only the Buy price;
  - one-unit sales from the hangar and from the hold, each moving the wallet by the confirmed
    total.
  - A `buyThroughMarket` helper buys through the UI. Commands sent straight to the gateway do not
    notify the screen.
- **`LossScreen.test.tsx`:** the recovery-grant row is listed in Sell, its Sell control is
  unavailable with "Recovery-grant items cannot be sold." as its description, and activating it
  opens nothing. Before this change the test opened the sale dialog to read the refusal there.
- **Browser and accessibility:** new `tests/support/market.ts` `marketMode(page, 'Buy' | 'Sell')`.
  Selling flows switch to Sell (and back to Buy before buying) in `combat`, `guidance`, `offline`,
  `progression`, accessibility `loss` and `presentation`. Accessibility `station.spec.ts` gained a
  test that switches modes by keyboard, checks the worded match mark, the icon control's name and
  tooltip, and audits both modes with axe.

## Commands and results

| Command | Result |
|---|---|
| `npm run verify` (typecheck, architecture, content, unit, integration, performance, component, traceability, build) | unit 1382, integration 134, performance 5 pass; component 128/129. The one failure was `CombatScreen.test.tsx` "reads the market again on docking…", which still looked for a `Sell Fusion S` button in the default Buy mode. It now switches to Sell and checks every Fusion S offer is available. |
| After that fix: `typecheck`, `test:component`, `traceability`, `build`, `validate:content` | pass; component 129/129; traceability 117/117 |
| `npm run contracts:record`, `npm run golden:record` | written; diff reviewed as above |
| `playwright --project=browser --project=accessibility` (Chromium): browser `station`, `combat`, `offline`, `guidance`, `progression`; accessibility `station`, `loss`, `presentation` | 25 passed, 16.0 min |

The full Chromium browser and accessibility run and the Firefox suites were not repeated here.
They belong to phase 10's gate.

## Visual verification

Checked against the Vite dev server at 1440×900 and 390×844. The screenshots were inspected during
the session and not committed.

- **1440, Buy:** one price column, Fits column with slots and charge matches (Fusion S and Phased
  Plasma S marked; Iron and Plasma Charge S "No fitted weapon uses it"), icon-only + and
  magnifier controls with tooltips.
- **1440, Sell:** a fresh campaign lists one stack, Fusion S in the Hold at 7 ISK. The autocannon
  and its magazine are absent.
- **390:** the switch and search wrap; the table scrolls inside its box with no page-level
  horizontal overflow (after the `.tableWrapper` fix). The Sell inspection dialog fits and shows
  only You receive.

## Remaining issues and guidance for the next sessions

- **Guidance text.** The "Sell your loot" step still says "Open the Market ({keyStationMarket}) and
  sell salvage…". It does not mention the Sell switch, which is right next to the search. Changing
  it is a content change: it moves the content hash, and with it every golden save. It was left
  for a deliberate content pass.
- **Numeric alignment.** `.numeric` cells and headers in station tables render left-aligned,
  because `.table th, .table td { text-align: left }` is more specific. This predates the phase
  and is left for the compact-layout phases.
- **For phase 04 (hangar).** The market's sell side now follows `inventory` invalidations, so
  transfers made there are reflected in Sell without extra wiring. `QuantityField` in
  `MarketPanel.tsx` implements the strict whole-number rule phase 04 needs. It could be moved to
  a shared place there rather than written again.
- **For phase 05 (fitting).** The market marks follow the committed fit only. If the fitting
  surface wants the same "suits this weapon" answer for a draft, reuse `moduleAcceptsCharge`
  rather than comparing groups in the UI.
- **For phase 10's release gate.** The contract lock and golden digests changed again with
  protocol 16.
