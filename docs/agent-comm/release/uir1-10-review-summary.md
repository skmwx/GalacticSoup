# MVP UI review 01 - review summary

**For:** the human operator, before reviewing the reworked UI.
**Date:** 2026-11-11 (phase UIR1-10 of `docs/MVPUIReview01ImplementationPlan.md`).
**Source review:** `docs/human-input/MVP-review-01.md`.

## Where this stands

| Layer | State |
|---|---|
| Implementation | **Complete.** Phases UIR1-01 to UIR1-09 delivered every finding; UIR1-10 fixed three integration gaps (below). |
| Automated verification | **Green.** `npm run release:gate` passed every step; candidate 0.1.0-rc.2 is recorded. One Firefox test needed its retry (below). |
| Human acceptance | **Not yet done.** It is your result. `playtest-script.md` has a new checklist group for these screens. |

## Every finding, its phase and the final evidence

"Played" means I checked it in the production bundle at 1440x900 during UIR1-10. The screenshots
are in `uir1-10-review/`.

| Review finding | Phase | Automated evidence | Played in UIR1-10 |
|---|---|---|---|
| Collapse three headers into one; keep icon, pilot, system; remove the title and "Engine ready" | 02 | AppShell and CampaignPanel component tests; shell and presentation accessibility | One header, docked and in space; the title and engine status stay in the page for screen readers only (`02-overview.png`, `10-space.png`) |
| The settings icon becomes the game menu; keep its entries; add Settings | 02 | Settings component tests; `tests/support/cockpit.ts` menu helper used by every browser flow | Menu opens from the icon; Escape returns focus to it (`04-menu.png`) |
| Sound and alerts move into Settings | 02 | Notifications and Settings component tests; guidance accessibility audit with Settings open | `18-settings.png` |
| Disabled reasons go into tooltips, in every view | 01, then each phase | ActionButton and TooltipButton tests; accessibility suites check hover and focus | Repair with nothing to repair shows its reason on hover (`03-tooltip.png`) |
| Remove the Overview's duplicate navigation buttons | 06 | StationScreen component tests | `02-overview.png` |
| Market Buy/Sell switch; one price per mode; only owned goods in Sell | 03 | Economy projection and protocol tests; StationScreen tests; station browser flow | Sell lists the same item twice, from hangar and from hold (`05-market-buy.png`) |
| Which weapon a charge suits; mark charges that fit the current fit | 03 | Market projection tests, including the refit case | "For 200mm Autocannon / Fits a weapon you have fitted" |
| Icon-only Buy, Inspect and Sell; show module slots | 01, 03 | Accessible-name assertions in StationScreen tests | Icons with item-specific names; "Engineering slot", "Weapon slot, turret hardpoint" |
| Hangar and hold columns; move one, all or a typed amount | 04 | Station component and browser tests; inventory integration tests | Moved a whole stack to the hold (`06-hangar.png`) |
| One fitting screen; per-slot change control; ammunition dropdown | 05 | Fitting component and integration tests | Pickers open by mouse and by keyboard (`07-fitting.png`) |
| Ship information above the fit; weapon statistics below | 05 | Same | `07-fitting.png` |
| Services on the main screen; priced repair armour, hull and all; resupply | 06 | Repair formula, economy and integration tests; protocol parity | After a fight: "Repair all · 0 ISK", "Resupply ammunition · 0 ISK" |
| Choose the site in space, not at departure | 07 | Navigation and guidance integration tests; space, guidance and loss browser flows | Undocked with no destination (`09-departure.png`); read briefings in space |
| Harbour as a destination; no separate Retreat button | 07 | SpaceScreen tests; space browser flow | Warped home through Borrell Harbour, docked with X |
| Right-click empty radar for Set course; remove the coordinate fields | 08 | SpaceScreen and camera tests; space browser and accessibility flows | `11-setcourse.png` |
| Remove "Your ship" from the object list | 09 | SpaceScreen test checks the list, the projection and the radar marker | Only the station, then the pirate, are listed |
| Combine weapons and equipment; two columns with Navigation under the radar | 09 | Cockpit browser test: layout at 1440, stacking at 390, no overflow at 1920, 1024 or 390 | `10-space.png`, `13-fight.png`, `21-narrow.png` |
| End-to-end, visual, keyboard, save and recovery regression | 10 | The release gate below | This review |

## Fixed in UIR1-10

- **"Choose a site" stayed open through the whole sortie.** Destinations opens on the first site
  without recording it. A player who warped without clicking it never completed the step. Flight
  school then said "Choose a site" all through the fight and after docking. Warp now records the
  offered encounter or wreck first, as a click would. This is a UI-only change; every headless flow
  already selected before warping. New component test: *counts warping to the destination offered
  first as choosing it* (`20-warp-fixed.png`).
- **The header's Pause button showed a play icon.** The registry gives the time toggle a single
  icon. ActionButton now accepts an icon override, and the header passes pause or play to match
  its label.
- **Texts still sent the player to "Services".** Three messages pointed there: the post-sortie
  advice and two departure warnings. They now say "on the Overview".

I tried keeping the hangar's quantity box and Move button on one line, but the hold column then
overflowed at 1440 px. I reverted it; the controls wrap as before.

## Observed and left for you to judge

- **Docking after a return takes one more step.** At the station's site, Destinations offers the
  next sortie first. You dock by choosing Borrell Harbour or pressing X.
- **Radar labels overlap at close range.** Beside the station, "Borrell Harbour" and "Your ship"
  draw over each other. This is cosmetic and older than this review.
- **Hangar transfer controls are tall.** In the two narrow columns, One, All, Max, Qty and Move
  wrap into a stack.
- **A transfer is not an autosave point.** Functional Specification §3 lists the autosave
  triggers, and a hangar/hold move is not one. A transfer followed at once by a page reload was
  lost in my run. This is by specification, so it is not a defect; it is listed in the playtest
  script.
- **One fitting picker did not open, once.** The first mouse click on a fitting picker, right after
  a transfer, did nothing. Five later attempts, including from a cold start, all opened it. It is
  not reproduced.
- **From earlier phases:** long action words break mid-word at 1.5x text in the Navigation column.
  At 1024 px the notifications stack above the screen and push the radar down.

## Inherited, not changed

- **Q12, stale confirmations during regeneration.** Its answer in
  `docs/agent-comm/requests/questions-and-answes.md` is still blank. A priced confirmation taken
  while the shield or capacitor regenerates can still say "Something changed while you were
  deciding". The Overview's live prices make this easier to meet. Pausing avoids it.
- **Q11, no Content Security Policy.** Unchanged.

## Gate results

`npm run release:gate`, run once over the final sources (source digest `58c0fae5e2a29c70`), was
**green**. Candidate **0.1.0-rc.2** is recorded in `config/release-candidate.json`.

| Step | Result | Tests |
|---|---|---|
| Type check, architecture, content validation | passed | - |
| Unit suite | passed | 1,404 |
| Integration suite (loops, golden replay, properties, balance careers) | passed | 135 |
| Balance report against its candidate | passed, nothing moved | - |
| Performance suite | passed | 5 |
| Component suite | passed | 143 |
| Traceability | passed, 117 of 117 covered | - |
| Production build twice, and its audit | passed, reproducible | - |
| Browser suite, Chromium | passed | 31 |
| Accessibility suite, Chromium | passed | 38 |
| Browser suite, Firefox | passed, **one test on its retry** | 30 + 1 |
| Accessibility suite, Firefox | passed | 38 |
| Start, save and offline flows, Chrome and Edge | passed | 15 each |

The Firefox retry was the offline flow. Its first attempt waited 30 s for the Pirate Scout to show
as Locked and failed; the retry passed. The trace was removed with the passing retry, so the cause
is not confirmed. That flow chooses its destination before warping, so the UIR1-10 warp change
sends it no new command.

I did not run `npm run verify` as a separate command. The gate runs each of its steps (type
check, architecture, content, unit, integration, performance, component, traceability, build)
against the same sources. The golden replay and the contract lock were not refreshed, and the balance figures did
not move.
