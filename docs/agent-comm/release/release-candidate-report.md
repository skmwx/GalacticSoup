# Release-candidate report - Galactic Soup MVP

**Candidate 0.1.0-rc.2, 2026-11-11.** It replaces rc.1 (2026-10-08). The difference is the MVP UI
review 01 rework, phases UIR1-01 to UIR1-10; `uir1-10-review-summary.md` in this folder maps each
finding of the review to its evidence.

- **Automated gate (MVP Scope 9.1 and 9.2): green.**
- **Product acceptance (MVP Scope 9.3): not yet done.** It needs a human playtest. The script is
  `playtest-script.md` in this folder, and its last section is where the result is recorded. The MVP
  is not complete until it is.

The machine-written evidence behind this report is `reports/release-gate.md`. `reports/` is not
tracked; `npm run release:report` writes it again.

## The candidate

| | |
|---|---|
| Application and engine version | 0.1.0 |
| Protocol version | 18 (rc.1: 14) |
| Save format and campaign state version | 10 (unchanged) |
| Replay log version | 1 |
| Content version | 0.1.0+8f13b5394f04 |
| Tuning digest | `b17ca616a2922d4a` (unchanged) |
| Source digest | `58c0fae5e2a29c70`... |
| Build fingerprint | `7fe9069ea92abaeb`... |

- The versions are frozen in `config/release-candidate.json`, which is written only from a green
  gate. The protocol moved from 14 to 18 across the UI review: the market metadata (UIR1-03), the
  repair scopes (UIR1-06), the station destination (UIR1-07) and the header's system name
  (UIR1-02). Saves did not change format.
- The source digest covers every file in the repository except documents. It does not depend on
  git, so committing leaves it as it is.
- The build is reproducible: the gate builds twice and the two bundles are the same byte for byte.
- Any change to the sources makes the candidate stale. The gate then says so, and must pass again
  before a new candidate is recorded.

## Automated results

| Step | Result | Tests | Took |
|---|---|---|---|
| Type check, architecture check, content validation | passed | - | 2 s |
| Unit suite | passed | 1,404 | 14 s |
| Integration suite: headless loops, golden replay, property runs, balance careers | passed | 135 | 2.7 min |
| Balance report against its candidate | passed, nothing moved | - | 1 s |
| Performance suite | passed | 5 | 9 s |
| Component suite | passed | 143 | 36 s |
| Traceability | passed | 117 of 117 included requirements covered | 0.4 s |
| Production build, twice, and its audit | passed, reproducible, no audit finding | - | 4 s |
| Browser suite, Chromium | passed | 31 | 15.4 min |
| Accessibility suite, Chromium | passed | 38 | 1.5 min |
| Browser suite, Firefox | passed, **one test on its retry** | 30 + 1 | 14.6 min |
| Accessibility suite, Firefox | passed | 38 | 1.6 min |
| Start, save and offline flows, Chrome | passed | 15 | 2.5 min |
| Start, save and offline flows, Edge | passed | 15 | 2.6 min |

The whole gate took 42 minutes. Every step ran against the source digest and the bundle above.

The retried test is the offline flow in Firefox. Its first attempt waited 30 seconds for the
Pirate Scout to show as Locked after the lock was ordered, and failed; the second attempt passed.
The failed attempt's trace was removed with its passing retry, so the cause is not confirmed. It
happened after arrival, well after the one interface change made since UIR1-09 that touches this
flow (warp records the offered destination; this test had already chosen it), and the same flow
passed in Chromium, Chrome and Edge.

Browsers: Chromium 153.0.8010.12 and Firefox 155.0 (the builds Playwright 1.63 pins), Chrome 157.0.8103.39 and Edge 157.0.4341.46 (installed on this machine).

## MVP Scope 9.1 - the playable loop

Each criterion is played in the browser against the production bundle, in Chromium and in Firefox,
and held headlessly as well.

| Criterion | Played in the browser by | Held headlessly by |
|---|---|---|
| AC-01 Start and resume | Campaign and save-integrity flows; a reopen inside the first-slice, loss and mastery flows | Save and resume, golden campaign reload at six states |
| AC-02 Prepare | Station flow: inspect, compare, buy, sell, fit, repair, resupply, insure | Economy, fitting and inventory suites |
| AC-03 Command | Traversal flow; a fight by mouse alone and one by keyboard alone | Navigation suite |
| AC-04 Understand combat | First-slice and station flows: hit chance, limiting factor, formulas | Progression scenarios |
| AC-05 Varied pressure | Mastery flow: the multi-opponent Pirate Patrol | Encounter suite, careers |
| AC-06 Earn and convert | First-slice, mastery and offline flows: bounty, loot, sale, refit | Economy, encounter, property runs |
| AC-07 Progress | Mastery flow: starter fit to a cleared Pirate Base | Careers on three seeds each |
| AC-08 Retreat and recover | Traversal flow (Harbour return); loss flow (destruction, insurance, report, wreck, grant) | Loss suite, loss-recovery career |
| AC-09 Continue | Mastery flow: every site still offered after the Pirate Base | Careers, golden campaign |
| AC-10 Learn in game | Guidance flow: a new player follows only the in-game guidance | Guidance suite |

Phase 21 asked for three things in particular, against a clean browser profile:

- **New campaign to mastery:** `progression.spec.ts`, now with four close-reload-resume
  checkpoints: prepared at the station, in space beside the patrol's wrecks, after the rewards
  were converted, and after the Pirate Base.
- **Destruction and recovery:** `loss.spec.ts`, which reloads on the autosave taken at the
  destruction, recovers the wreck and clears the Pirate Scout again.
- **Close and reopen:** also in the middle of a fight (`combat.spec.ts`) and in space
  (`space.spec.ts`).

## MVP Scope 9.2 - technical acceptance

| # | Requirement | Evidence |
|---|---|---|
| 1 | Every included behaviour is traceable | 153 requirements: 117 included, 117 covered, 36 deferred. The gate fails on an uncovered one. |
| 2 | The loop passes headless and browser tests, with save/reopen and recovery | The integration suite and the browser flows above. |
| 3 | Formula, inventory, credit, fitting, scheduler, replay and save-integrity tests | The unit and integration suites; the golden campaign replays through both transports; 20,000 random-pilot steps under the invariants. |
| 4 | No gameplay network request; content validates | See "Offline" below. Content validation is a gate step. |
| 5 | Keyboard-only, mouse-only, scale, contrast, reduced motion, focus, non-colour cues | The accessibility suite, in Chromium and in Firefox. |

### Offline

- **What the scripts can do.** The gate audits the built bundle. No shipped script contains a call
  that reaches the network or evaluates text, and no markup or style refers outside the build.
- **What they did.** `offline.spec.ts` starts from a clean profile, confirms that starting asked
  only for the build's own files, switches the network off and plays a whole loop, a save and a
  resume. No request is attempted. It passes in Chromium, Firefox, Chrome and Edge.
- **The limit.** The installable package and its service worker are deferred (MVP Scope 7).
  Loading the page again needs the files to be served on the machine, which `npm run preview` does.

### Performance

Measured at the Pirate Base with every opponent alive, the largest authored encounter.

| Target (Technical Specification 13) | Budget | Measured |
|---|---|---|
| One 50 ms quantum, 95th percentile, production checks | 4 ms | 1.7 ms (median 0.7 ms) |
| A non-advancing command or query, 95th percentile | 100 ms | 1.3 ms |
| Snapshot capture, 95th percentile | 16.7 ms | 6.4 ms |
| Open a validated campaign, 95th percentile | 2 s | 5.1 ms |

The quantum has about 2.3 times headroom at rc.2 (1.3 at rc.1). With the complete checks that tests and development
builds run at every commit, the same quantum measured 2.3 ms; that depth is recorded, not
asserted (Q10).

The gate times the engine, not the drawing. How smoothly the space view runs is a playtest
observation.

## Balance fixtures

The balance report is identical to the recorded balance candidate
(`tests/fixtures/balance/candidate.json`): tuning digest `b17ca616a2922d4a`, six fixture seeds,
every figure deterministic. The full report is `reports/balance.md`.

| MVP Scope 4.3 objective | Evidence |
|---|---|
| 1. Enter the easy site immediately | The starter fit clears the Pirate Scout 6/6 with nothing bought. |
| 2. A meaningful choice, not every upgrade | The starting credits buy the intermediate fit or the poor purchase, not both, and neither the mastery nor the long-range fit. |
| 3. A new decision within a few encounters | One Pirate Patrol clear between the intermediate and the mastery fit; one or two Pirate Base clears before the long-range fit. |
| 4. An upgrade materially improves the next tier | Pirate Patrol: starter 0/3, intermediate 6/6. Pirate Base: intermediate 4/6 losing 58% of its hit points, mastery 6/6 losing 7%. |
| 5. Replay recovers from poor purchases and losses | Three or four Pirate Scout sorties from the poor purchase back to the intermediate fit; one from a lost ship. |
| 6. The hard site through the intended loop | From a new campaign to two Pirate Base clears in 5 sorties and 32-34 simulated minutes, every credit earned in play. |

No fit dominates: the long-range fit takes less than half the damage of the mastery fit at the
Pirate Base and cannot clear the Pirate Patrol, which the mastery fit clears 3/3.

## Found and fixed by UIR1-10, for rc.2

- **Warping to the site Destinations offered first left "Choose a site" open** for the whole
  sortie, because only a click recorded the choice. Warp now records it first.
- **The header's Pause button drew a play icon** while the clock ran. It now shows pause.
- **Three texts still sent the player to "Services"**, a screen the review removed. They now say
  "on the Overview".

## Found and fixed for rc.1 (Phase 21)

- **Every start logged an error in Chrome and Edge.** The page declared no icon, so the browser
  asked for `/favicon.ico` and got a 404. The icon is now written into the page. The Chromium build
  the tests had always used does not ask for one, which is why this is the first phase to see it.
- **The interface script held one `fetch`,** a build-tool polyfill that never ran in a release
  browser. It is switched off, so the shipped scripts hold no network call.
- **One boot test raced the start screen in Firefox.** The test now waits. Not a game defect.

## Known issues, none blocking

**Found by the rc.1 gate and still not fixed**

- **A confirmation can ask to be confirmed twice.** Q12 is still unanswered; rc.2 inherits it, and
  the Overview's live prices put the player in front of it more often. While the ship is docked, the clock is running
  and its shield or capacitor is still regenerating, a station confirmation (repair, purchase,
  sale, resupply, insurance) is sometimes answered with "Something changed while you were deciding"
  and must be pressed again. Nothing is charged wrongly and the second press works. Q12 in
  `docs/agent-comm/requests/questions-and-answes.md` has the cause and a proposed fix. It is why
  the guidance flow needed its retry in Firefox at rc.1. Pausing at the station avoids it.

**Against the specifications**

- **No Content Security Policy.** Technical Specification 14 asks for one; none exists. Q11 in
  `docs/agent-comm/requests/questions-and-answes.md` gives the options. The audit and the offline
  flow show the build asks for nothing; a policy would have the browser enforce it.
- **The drawing's frame rate is not measured.** Technical Specification 13 sets rendering targets;
  the gate measures the engine only. The playtest script asks for it to be watched.

**Limits of the gate**

- **Chrome and Edge run the short flows only:** start, save, save integrity and offline. The long
  fights run in Playwright's Chromium and Firefox builds.
- **One retry in the browser suites.** Several things can make a passing flow fail once: the issue
  above, Firefox under Playwright now and then failing to close its own context after a test has
  passed, and, at rc.2, a lock that did not complete in time in the Firefox offline flow. A test that needed its retry is named in the evidence, as above.
- **The candidate record counts the retried test out.** `config/release-candidate.json` says
  "browser-firefox: passed: 30 tests" for a suite of 31. The evidence and this report say why.

**Usability, noted in earlier phases and left for the playtest to judge**

- The warp control starts at the farthest arrival distance, 100 km. The guidance says to choose
  10 km.
- Fire does not wait for a gun that is reloading. Press Fire again when the reload ends.
- A shortcut for a command that is unavailable does nothing; the button beside it says why.
- While a list box has focus the browser keeps letter and digit keys for it, so shortcuts wait
  until focus leaves.

**Usability, noted during UIR1-10 and left for the playtest to judge** (details in
`uir1-10-review-summary.md`)

- Back at the station's site, Destinations offers the next sortie first; docking needs Borrell
  Harbour chosen in the list, or X.
- Radar labels overlap when objects are close together.
- The hangar's transfer controls wrap into a tall stack in the two columns.
- A hangar/hold transfer is not an autosave trigger (Functional Specification 3), so a page reload
  straight after one can undo it.

**By scope**

- Saves written by earlier development builds are refused; start a new campaign.
- One campaign slot, no manual save list, no export or import, no map, 1x time only.

## What happens next

1. Answer Q12: fix the stale confirmation before the playtest, which makes the playtest one of
   rc.3, or playtest rc.2 as it is. I still recommend fixing it first. Q11 can wait.
2. Play `playtest-script.md` and record the result in it.
3. If the result is "accepted", the MVP is complete.
4. If not, each item becomes a session-sized tuning or usability phase. After it, the gate runs
   again and a new candidate is recorded. A failed playtest does not expand the MVP.
