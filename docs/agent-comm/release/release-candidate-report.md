# Release-candidate report - Galactic Soup MVP

**Candidate 0.1.0-rc.1, 2026-10-08.**

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
| Protocol version | 14 |
| Save format and campaign state version | 10 |
| Replay log version | 1 |
| Content version | 0.1.0+296facab3d13 |
| Tuning digest | `b17ca616a2922d4a` |
| Source digest | `8b8606e34e62b859`... |
| Build fingerprint | `bc6e15aae57300e9`... |

- The versions are frozen in `config/release-candidate.json`, which is written only from a green
  gate. The protocol, save and state versions are the ones Phase 20 closed; nothing in Phase 21
  changed a contract or the content.
- The source digest covers every file in the repository except documents. It does not depend on
  git, so committing this phase leaves it as it is.
- The build is reproducible: the gate builds twice and the two bundles are the same byte for byte.
  To check a build of your own, run `npm ci` and `npm run release:gate -- --only=build`, then
  compare the fingerprint in `reports/release-gate.md`.
- Any change to the sources makes the candidate stale. The gate then says so, and must pass again
  before a new candidate is recorded.

## Automated results

| Step | Result | Tests | Took |
|---|---|---|---|
| Type check, architecture check, content validation | passed | - | 3 s |
| Unit suite | passed | 1,376 | 19 s |
| Integration suite: headless loops, golden replay, property runs, balance careers | passed | 134 | 6.3 min |
| Balance report against its candidate | passed, nothing moved | - | 1 s |
| Performance suite | passed | 5 | 14 s |
| Component suite | passed | 114 | 39 s |
| Traceability | passed | 117 of 117 included requirements covered | 1 s |
| Production build, twice, and its audit | passed, reproducible, no audit finding | - | 6 s |
| Browser suite, Chromium | passed | 28 | 15.4 min |
| Accessibility suite, Chromium | passed | 34 | 1.4 min |
| Browser suite, Firefox | passed, **one test on its retry** | 27 + 1 | 15.6 min |
| Accessibility suite, Firefox | passed | 34 | 1.5 min |
| Start, save and offline flows, Chrome | passed | 15 | 2.5 min |
| Start, save and offline flows, Edge | passed | 15 | 2.5 min |

The whole gate took 47 minutes. Every step ran against the source digest and the bundle above.

The retried test is the guidance flow in Firefox. Its first attempt failed at the repair
confirmation, which stayed open; the second attempt passed. The cause is a defect in the game, not
in the test: see the first known issue below.

Browsers: Chromium 153.0.8010.12 and Firefox 155.0 (the builds Playwright 1.63 pins), Chrome 155.0.8059.39 and Edge 154.0.4258.62 (installed on this machine).

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
| AC-08 Retreat and recover | Traversal flow (retreat); loss flow (destruction, insurance, report, wreck, grant) | Loss suite, loss-recovery career |
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
| One 50 ms quantum, 95th percentile, production checks | 4 ms | 3.1 ms (median 1.1 ms) |
| A non-advancing command or query, 95th percentile | 100 ms | 2.1 ms |
| Snapshot capture, 95th percentile | 16.7 ms | 10.5 ms |
| Open a validated campaign, 95th percentile | 2 s | 9 ms |

The quantum has about 1.3 times headroom. With the complete checks that tests and development
builds run at every commit, the same quantum measured 4.1 ms; that depth is recorded, not
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

## Found and fixed in this phase

- **Every start logged an error in Chrome and Edge.** The page declared no icon, so the browser
  asked for `/favicon.ico` and got a 404. The icon is now written into the page. The Chromium build
  the tests had always used does not ask for one, which is why this is the first phase to see it.
- **The interface script held one `fetch`,** a build-tool polyfill that never ran in a release
  browser. It is switched off, so the shipped scripts hold no network call.
- **One boot test raced the start screen in Firefox.** The test now waits. Not a game defect.

## Known issues, none blocking

**Found by this gate and not fixed**

- **A confirmation can ask to be confirmed twice.** While the ship is docked, the clock is running
  and its shield or capacitor is still regenerating, a station confirmation (repair, purchase,
  sale, resupply, insurance) is sometimes answered with "Something changed while you were deciding"
  and must be pressed again. Nothing is charged wrongly and the second press works. Q12 in
  `docs/agent-comm/requests/questions-and-answes.md` has the cause and a proposed fix. It is why
  the guidance flow needed its retry in Firefox. Pausing at the station avoids it.

**Against the specifications**

- **No Content Security Policy.** Technical Specification 14 asks for one; none exists. Q11 in
  `docs/agent-comm/requests/questions-and-answes.md` gives the options. The audit and the offline
  flow show the build asks for nothing; a policy would have the browser enforce it.
- **The drawing's frame rate is not measured.** Technical Specification 13 sets rendering targets;
  the gate measures the engine only. The playtest script asks for it to be watched.

**Limits of the gate**

- **Chrome and Edge run the short flows only:** start, save, save integrity and offline. The long
  fights run in Playwright's Chromium and Firefox builds.
- **One retry in the browser suites.** Two things can make a passing flow fail once: the issue
  above, and Firefox under Playwright now and then failing to close its own context after a test
  has passed. A test that needed its retry is named in the evidence, as above.
- **The candidate record counts the retried test out.** `config/release-candidate.json` says
  "browser-firefox: passed: 27 tests" for a suite of 28. The evidence and this report say why.

**Usability, noted in earlier phases and left for the playtest to judge**

- The warp control starts at the farthest arrival distance, 100 km. The guidance says to choose
  10 km.
- Fire does not wait for a gun that is reloading. Press Fire again when the reload ends.
- A shortcut for a command that is unavailable does nothing; the button beside it says why.
- While a list box has focus the browser keeps letter and digit keys for it, so shortcuts wait
  until focus leaves.

**By scope**

- Saves written by earlier development builds are refused; start a new campaign.
- One campaign slot, no manual save list, no export or import, no map, 1x time only.

## What happens next

1. Answer Q12: fix the stale confirmation before the playtest, which makes the playtest one of
   rc.2, or playtest rc.1 as it is. I recommend fixing it first. Q11 can wait.
2. Play `playtest-script.md` and record the result in it.
3. If the result is "accepted", the MVP is complete.
4. If not, each item becomes a session-sized tuning or usability phase. After it, the gate runs
   again and a new candidate is recorded. A failed playtest does not expand the MVP.
