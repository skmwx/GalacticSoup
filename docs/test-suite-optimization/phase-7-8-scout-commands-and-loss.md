# Phases 7 and 8: Scout commands and combat audits from checkpoints, and a shorter loss recovery

This is the handoff for Phases 7 and 8 of the [test suite optimization plan](../TestSuiteOptimizationPlan.md). It builds on the checkpoint helper from [Phases 2-3](phase-2-3-feature-verification.md) and [Phase 4](phase-4-progression-checkpoint.md), and on the named release evidence from [Phases 5-6](phase-5-6-release-evidence-and-patrol.md). Both phases were done in one session on top of `62e2ccf`. Phase 7a is not part of this change.

## New checkpoints

[tests/support/checkpoint/scenarios.ts](../../tests/support/checkpoint/scenarios.ts) has three new checkpoints. Like the others, each one is reached only through protocol requests, from the fixed checkpoint seed.

| Checkpoint | State | Script |
|---|---|---|
| `scout-arrived` | Paused at the Pirate Scout site the moment the warp ends, 10 km out. Nothing is selected, ordered or locked. | `arriveAtScout` |
| `loss-granted` | Docked and paused after the starter ship was destroyed idling at the Pirate Base, with a spare autocannon in the hangar. The loss was reported and insured, a recovery-grant Wayfarer was supplied, and the wreck holds what survived. | `buyOne(autocannon)`, then `loseShipAtBase('granted')` |
| `loss-shipless` | Docked and paused with no ship. The autocannon was taken off and sold, and the rest was destroyed at the Pirate Base. The payout is enough to buy a starter ship back, so none was supplied. | `sellFittedAutocannon`, then `loseShipAtBase('noShip')` |

`loseShipAtBase` refuses to make the checkpoint unless the ship is destroyed within 300 s and recovered as expected.

The station facts changed as follows:
- `activeShipId` may now be `null`. A pilot with no ship has no fit and no hold.
- A new `loss` fact gives the most recent loss: hull, site and encounter names, the recovery outcome, credits after recovery, payout, the wreck's presence and stack count, and every item with its name, quantity, origin and survival.
- `verifyCheckpoint` therefore also compares the loss report after a fresh resume.

The browser shown-check ([browser.ts](../../tests/support/checkpoint/browser.ts)) now also checks:
- the "lost" Last-sortie wording;
- the open loss report: `data-recovery`, the "destroyed at … fighting …" line, and every line of the Lost and Surviving item lists, in order. The new export `lossItemLine` builds each line.

[tests/integration/checkpoints.test.ts](../../tests/integration/checkpoints.test.ts) is in the fast selection and adds these cases:
- byte-identical generation for each new checkpoint;
- `scout-arrived` is at Verge Belt, unlocked and not firing, with the booster off and the scout more than 5 km away;
- `loss-granted` has the exact loss: 3,600 ISK paid out, 11,600 ISK after, these four item lines, a wreck with 2 stacks, and the spare gun in the hangar;
- `loss-shipless` has no ship, fit or hold, recovery `noShip`, and a wallet equal to the credits after recovery;
- a loss checkpoint whose recovery differs from the save is refused.

## Phase 7: Scout commands and combat audits

**[tests/accessibility/combat.spec.ts](../../tests/accessibility/combat.spec.ts).** All four cases start in the middle of a fight, so `inAFight` now opens `scout-fight`. In that state the scout is locked, the autocannon is firing and the booster is running, all paused. The file's own `freshCampaign` and the flight are gone, and so are the 3-minute timeouts.

The assertions are unchanged:
- every equipment entry and explanation is expanded before the audit;
- the context menu is opened with Shift+F10 and audited, Escape closes it, and focus returns to the scout entry;
- "Hostile" and "Locked" are shown in words, and the hostile and locked markers are shown as shapes;
- at doubled scale there is no overflow.

The checkpoint helper adds the shown-check: the site, "Paused", the lock and "Firing at Pirate Scout".

**[tests/browser/combat.spec.ts](../../tests/browser/combat.spec.ts) "combat commands".** Both cases start from `scout-arrived`, because they begin where the warp ends. Their `beforeEach` is gone: `fixSeed`, `freshCampaign` and `prepareAndUndock`. Every order is still the player's own:

- **Mouse alone:** unchanged from the first step. The case right-clicks the scout in the view, chooses Orbit at, resumes and waits for the lock to be offered. It then pauses, right-clicks Lock target and resumes. It fires, activates the booster, shows the ranges, ceases fire with "Stopped: Stopped on command.", unlocks, and warps home by mouse.
- **Keyboard alone:** the same keys, reordered.
  1. `p` now starts the clock first. The checkpoint is paused, and the case asserts "Running at 1x".
  2. `]` selects the scout. Range is typed `1`, then `o`, `l`, `e`, `1` for the booster, `q`, `v` to reload, Shift+F10 and Escape with the focus return, `n` and `x`. All of these are unchanged.
  3. Once home, Pirate Scout is chosen with Enter on its destination entry. Arrive at is typed `1` (giving `10`), then Tab and `w`, and the case asserts "Aligning for warp".

  The keyboard warp is still sent with the same keys. The change is that the case no longer waits for it to arrive at Verge Belt.

The feature-tagged checkpoint command witness and the starter/refit journey did not change.

### Steps moved out of the command cases

| Step | Was | Owner now |
|---|---|---|
| New campaign, move spare Fusion S to the hold, Departure, undock | both cases' `beforeEach` | `starter-refit` (`combat.spec.ts`, same helpers), `real-clock-navigation` (`space.spec.ts`), and the checkpoint's protocol script |
| Choose Pirate Scout by mouse and warp to it at 10 km by mouse, arriving at Verge Belt | mouse case `flyToScout` | `starter-refit` (same `flyToScout`), `real-clock-navigation`, the guided and destroyer journeys |
| Keyboard warp arriving at Verge Belt | keyboard case | The keys are still pressed and the warp is asserted as sent ("Aligning for warp"). Real-clock arrival is owned by `real-clock-navigation` and the journeys. `accessibility/space.spec.ts` also sends `w` from the keyboard |

## Phase 8: Loss recovery

**[tests/browser/loss.spec.ts](../../tests/browser/loss.spec.ts)** now has two cases.

1. **Played (witness `loss-recovery`, retitled):** "losing a ship > is destroyed with nothing supplied, reloads the shipless station, buys a hull and flies it to a fight" `[MVP-AC-08, FUNC-9.12, FUNC-3.4, FUNC-22.1, MVP-AC-01]`. This is the one browser transition through destruction. It runs as follows:
   1. Take off and sell the autocannon.
   2. Fly to the Pirate Base and wait there for the real destruction.
   3. Check the loss report: "destroyed at Outpost Cradle fighting Pirate Base", the Pirate Gunner attacker, "1 x Small Shield Booster (fitted)" lost, the 3,600 ISK insurance line, and "You have no ship. With 33,822 ISK", with the wallet at 33,822 ISK.
   4. Reopen the saved shipless station: wait for the save, reload without closing and resume. The report, the no-ship text, the wallet, "Docked" and the No ship notice are all shown again, and Undock is disabled.
   5. Make the recovery purchase: buying a Wayfarer hides the No ship notice.
   6. Relaunch with meaning: buy and fit an autocannon with Fusion S, check that Undock is enabled, undock, warp to the Pirate Scout, then select, lock and see "Locked" and "Aimed at Pirate Scout".
2. **From `loss-granted` (new witness `loss-wreck`):** "recovering from a checkpoint after a loss > flies the granted replacement to its wreck, brings the survivors home and refits with them" `[MVP-AC-08, FUNC-9.12, FUNC-5.4, FUNC-22.1]`. The shown-check covers the wallet, the lost sortie and every lost and surviving line. The case then checks:
   - the Pirate Gunner, the insurance line, "the recovery service supplied a replacement Wayfarer" and 11,600 ISK;
   - "Recovery grant" under Ships;
   - Choose your wreck as the destination, and the Departure and space chooser offering the wreck first;
   - a real warp to the wreck at 0 km, then Take all while paused and an empty wreck;
   - warp home and dock;
   - the booster in the hold, the spare gun fitted with Fusion S, two autocannons, Fusion S in the hold, and Undock enabled.

**[tests/accessibility/loss.spec.ts](../../tests/accessibility/loss.spec.ts)** (witness `loss-audit`, title unchanged) opens `loss-shipless`. The sale, the flight and the destruction are now the checkpoint's script, and the played case in the browser plays them. Every assertion and all three audits are unchanged:
- the report table and the Lost items list;
- "You have no ship. With 33,822 ISK", with the payout calculation open, then an audit;
- the No ship notice, Undock disabled with its reason, then an audit;
- Buy Wayfarer, the notice hidden and Undock enabled, then an audit.

**[config/releaseWitnesses.mjs](../../config/releaseWitnesses.mjs)** gives `loss-recovery` its new title and adds `loss-wreck`. There are now 29 witnesses. `npm run test:discover` finds each one exactly once in each of its projects.

**Headless recovery is unchanged.** [tests/integration/loss.test.ts](../../tests/integration/loss.test.ts) still loses the ship, resumes, loots the wreck, refits with the spare and completes the Scout. It passes.

### Evidence map for the old browser loss case

The rows are the steps of the old "is destroyed, reloads, recovers and clears the easiest site again".

| Step | Now | Owner |
|---|---|---|
| Buy a spare gun, wallet 8,000 ISK | moved | `loss-granted` script (headless market purchase); browser purchases are covered by `station.spec.ts` and `starter-refit` |
| Undock, warp to the Pirate Base, wait for the real destruction, report shown, pause | **kept**, played case (shipless variant) | - |
| "destroyed at Outpost Cradle fighting Pirate Base", Pirate Gunner, insurance line | **kept** in both cases | - |
| Lost autocannon (fitted), 20 Fusion S (loaded); booster survived | **moved and strengthened**, `loss-wreck` | The shown-check asserts every lost and surviving line in order; `checkpoints.test.ts` asserts the exact list |
| "recovery service supplied a replacement Wayfarer", 11,600 ISK | **moved**, `loss-wreck` | - |
| Save, reload without closing, resume: report, wallet, docked | **kept**, played case | Now the shipless station, the state the plan names |
| "Recovery grant" under Ships | **moved**, `loss-wreck` | Also `LossScreen.test.tsx:413` |
| Choose the wreck, chosen-destination text, offered first in space | **moved**, `loss-wreck` | - |
| Warp to the wreck at 0 km, Take all while paused, wreck empty, return and dock | **moved**, `loss-wreck` | Real clock, unchanged steps |
| Booster in the hold; refit Weapon 2 with the spare gun and Fusion S; 2 guns; Fusion S to the hold | **moved**, `loss-wreck` | - |
| Undock, warp to the scout, orbit, lock, two guns firing, booster, clear for 3,000 ISK | **removed from the browser** | Headless `loss.test.ts` completes the Scout with the recovered ship. Browser two-gun fire and a Scout clear: `starter-refit`. The played case still relaunches to a fight and locks the scout |
| Dock; Last sortie "Pirate Scout cleared … 3,000 ISK" | **removed from the browser** | `loss.test.ts` (`lastOutcome` completed); the same browser wording in `starter-refit` |
| "Last ship lost" still reachable after a later sortie | **removed from the browser** | `LossScreen.test.tsx:284` |

Traceability counts test files, so each requirement on the old title is still in `browser/loss.spec.ts`. `MVP-AC-01` stays on the played case, and `FUNC-5.4` (wreck persistence) moved to the wreck case.

## Evidence

**Both engines.** One pass with 6 workers ran every changed case, the unchanged checkpoint audit and the unchanged command witness: 20 of 20 passed in 1.8 min. The timing runs below passed 42 of 42 before and 48 of 48 after. All runs used no retries.

**Timings.** Both sides ran on the same machine, one after the other. Each used:
- 4 workers;
- `--repeat-each=3`;
- `--retries=0`;
- the served production build (`RELEASE_GATE_SERVE_BUILT=1`);
- Playwright 1.63.0 and Node 24.21.0;
- no branded channels.

The before side is HEAD `62e2ccf` in an isolated worktree with its own build. The after side is this change. The engine worker asset is identical on both sides (`engineWorker-BE2OioxZ.js`). Each value is the median of 3, and the first repeat in each worker includes making the checkpoint.

| Case | Chromium before | Chromium after | Firefox before | Firefox after |
|---|---:|---:|---:|---:|
| Mouse commands | 28.2 s | **18.7 s** | 29.2 s | **19.7 s** |
| Keyboard commands | 26.4 s | **18.0 s** | 27.6 s | **18.7 s** |
| Combat audit, context menu | 13.4 s | **2.8 s** | 14.9 s | **4.1 s** |
| Combat audit, words not colour | 12.2 s | **0.6 s** | 13.5 s | **0.9 s** |
| Combat audit, doubled scale | 12.1 s | **0.6 s** | 12.5 s | **0.8 s** |
| Loss, played (was destroyed, recovers, clears) | 180.2 s | **75.8 s** | 181.7 s | **78.9 s** |
| Loss wreck from `loss-granted` (new) | - | 31.6 s | - | 35.1 s |
| Loss audit | 65.2 s | **4.0 s** | 65.9 s | **5.6 s** |
| **Sum** | **337.7 s** | **152.1 s** | **345.3 s** | **163.8 s** |

The benchmark's wall time fell from 553 s (42 runs) to 277 s (48 runs). Per engine, about 3 minutes of browser and accessibility work leaves the gate, a fall of 55%. The slowest browser case is still the played multi-opponent case (about 7.5 min), so the browser project's wall time does not change. The loss case falls from third-slowest, at about 3 min, to about 76 s. `starter-refit` remains the second-slowest, at about 4 min.

**Other checks.**
- `tsc --noEmit` passes.
- `check:architecture` reports 301 files and no violations.
- `npm run traceability` covers 134 of 134.
- `npm run test:discover` exits 0, with `browser` and `browser-firefox` at 39 cases each (38 before), `accessibility` at 43, the smoke at 9, and every check passing, including both witness checks.
- `checkpoints.test.ts`, `checkpointsMastery.test.ts` and `loss.test.ts` pass, 17 cases.
- The release-gate unit checks (`tests/unit/config`) pass, 59 cases.
- The fast integration selection passes, 211 cases in 59.8 s (Phase 6: 204 in 57.3 s). The checkpoint file is not among the five slowest files.
- No file under `src/` changed, and the production build in this tree has the same asset names as Phases 3-6 (`engineWorker-BE2OioxZ.js`, `index-CKQhmdzN.js`).

## Open items

- **Phase 7a** (guided and web accessibility setup) is not started. It can reuse `checkpointAt` and add a guided-projectile and an active-web checkpoint the same way.
- **The Phase 2 starting-point timings** for `verify:feature` are still open. This change does not touch the smoke.
- **Checkpoint generation under gate load.** The two loss checkpoints each take a few seconds on an idle machine. Phase 6 records the risk of making checkpoints inside a loaded worker. If Phase 14 sees timeouts, generating the checkpoints in a global setup would also cover these two.
- **The baseline worktree built a different `index-*.js` name** (`index-B4nC-0vA.js`) from the same sources, presumably because of its path. The engine worker matched. Both sides served their own build, so the comparison holds.

## Next

- Phase 7a, then Phase 10, which depends on 7-9 and 7a.
- Phase 9 (short branded offline flow) is independent of this change.
