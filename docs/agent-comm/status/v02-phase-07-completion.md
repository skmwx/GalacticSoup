# v0.2 phase 7: completion record

**Source:** `docs/v02/FeatureImplementationPlan02.md`, phase 7 (regression, persistence hardening and release handoff). **Date:** 2026-11-17. **Next dependency:** the human review of V02-AC-15 (Q13), and the operator's update of `docs/human-input/CurrentState.md` (Q14). **Human review (V02-AC-15): pending.**

## Outcome in brief

- **Automated gate: green.** 0.2.0-rc.1, recorded 2026-11-17 from a green `npm run release:gate` (commit f3b79e8 plus the uncommitted phase 7 changes).
- **Acceptance IDs.** Every V02 acceptance ID except V02-AC-15 is `included`, and traceability covers it. V02-AC-15 stays `planned` until the playtest.
- **Release.**
  - App and engine are at version 0.2.0, with content at 0.2.0.
  - Player notes: `docs/v02/ReleaseNotes-v0.2.md`.
  - Handoff: `docs/agent-comm/release/v02-release-handoff.md`.
- **Behaviour.** No game behaviour changed in this phase. The changes are tests, release tooling and metadata.

## What changed

### Tests
- **New: `tests/integration/v02Persistence.test.ts`.**
  - **Three ladder fights reopened.** Each fight is flown twice by a scripted pilot: once straight through, once reopened through `captureSnapshot` → JSON → `loadSave` every 3.7 s. The runs match hash for hash at every reopen and exactly at the end. The fights:
    - Bombardment Line, guided volleys from both sides with at least 3 in flight at once;
    - Range Check, both sides' webs and kills;
    - Command Group, a mixed medium cruiser, with reserved rounds and each bounty paid exactly once.
  - **Station state reopened** through the save service:
    - a damaged, insured stored destroyer;
    - an open fitting draft for it.

    Activating a ship is refused while the draft is open, and committing the draft changes only the destroyer.
- **`tests/browser/persistence.spec.ts`.**
  - A v0.1 save (format 10, engine 0.1.0) is explained and offers no Resume. Choosing "Keep the saved campaign" leaves it byte-identical.
  - Confirming the replacement starts a new campaign in the current format.
- **`tests/browser/campaign.spec.ts`** (also in the Chrome and Edge smoke runs).
  - Under Playwright's clock:
    - two hours paused add nothing;
    - a two-hour suspension while running adds one capped step;
    - a system clock set years ahead adds nothing;
    - eight hours closed add nothing.
  - The checks allow one second, because the readout shows whole seconds and can lag the last step after a pause.
- **New: `tests/accessibility/progression.spec.ts`** (Chromium and Firefox). Five audited, keyboard-operated surfaces:
  - a hangar of three ships and its comparison, including switching ship and a doubled scale;
  - the market's purpose, size and fit filters;
  - twelve destinations in bands, with a filter;
  - a fight under guided fire with reduced motion;
  - a fight under a web.
- **New: `tests/support/funding.ts`.** The fresh-campaign, funding and purchase helpers, shared by `ladder.spec.ts`, which now imports them.
- **`tests/performance/engine.test.ts`.** Two new cases:
  - webs held on both sides;
  - a long repeat session: 20 looted Pirate Base sorties across a three-ship hangar, with saves at 0, 1, 10 and 20.

  Both assert history caps, save size, and request, snapshot and quantum p95. Both are reported.
- **`tests/accessibility/combat.spec.ts`.** It now clicks only visible `summary` elements. The test timed out in both browsers on a "Drop chances" disclosure inside a view that was not shown. This is a test defect, not a product one.

### Release tooling and metadata
- **`package.json` / `package-lock.json`.** Version 0.2.0; the description names the v0.2 Combat Progression Alpha.
- **`scripts/lib/release.mjs`.**
  - The report covers V02 acceptance IDs as well as MVP ones.
  - New performance rows: the guided volley, webs, and the long session.
  - The header names v0.2 phase 7.
- **`scripts/release-gate.mjs`.** The candidate comment names v0.2 phase 7.
- **`config/requirements.json`.** V02-AC-13 and V02-AC-14 gain phase 7 and the evidence above.
- **`config/release-candidate.json`.** Recorded from the green gate: 0.2.0-rc.1.

### Documents
- `docs/v02/ReleaseNotes-v0.2.md` (player notes);
- `docs/agent-comm/release/v02-release-handoff.md`;
- Q14 in `docs/agent-comm/requests/questions-and-answes.md`.

## Acceptance IDs

- **V02-AC-01 to V02-AC-14:** `included`, with traceability evidence. Phase 7 added evidence to:
  - V02-AC-13 (persistence and compatibility);
  - V02-AC-14 (Firefox and accessibility).
- **V02-AC-15: `planned`, pending the human playtest (Q13).**

## Verification

All run from PowerShell.

- **The first full `npm run release:gate`** was red on three steps:
  - accessibility, Chromium and Firefox: the `combat.spec.ts` disclosure defect above;
  - Edge smoke: the new clock test read the time one second after pausing.

  Every other step passed, including the Firefox browser suite with one retry (the known timing-sensitive `progression.spec.ts`).
- **The fixes, run on their own:**
  - the combat audit passed in Chromium and Firefox;
  - the clock test passed 12 of 12: Chromium, Firefox, Chrome and Edge, three times each.
- **The second full gate: green, every step on its first attempt.** `npm run release:record -- --label=rc.1` then recorded 0.2.0-rc.1.

| Step | Result | Tests | Took |
|---|---|---|---|
| Type check, architecture check, content validation | passed | - | 3 s |
| Unit suite | passed | 1,483 | 15 s |
| Integration suite: loops, replay, properties, balance | passed | 317 | 14.4 min |
| Balance report against its candidate | passed | - | 1 s |
| Performance suite | passed | 8 | 1.6 min |
| Component suite | passed | 151 | 35 s |
| Traceability | passed | 168 requirements; 134 included, all covered; 1 planned (V02-AC-15); 33 deferred | 0.4 s |
| Production build, twice, and its audit | passed, reproducible, no finding | - | 5 s |
| Browser suite, Chromium | passed | 35 | 15.1 min |
| Accessibility suite, Chromium | passed | 43 | 75 s |
| Browser suite, Firefox | passed, no retry | 35 | 15.1 min |
| Accessibility suite, Firefox | passed | 43 | 88 s |
| Start, save and offline flows, Chrome | passed | 17 | 2.4 min |
| Start, save and offline flows, Edge | passed | 17 | 2.4 min |

Performance against Technical Specification 13 (95th percentiles):

| Measure | Budget | Measured |
|---|---|---|
| One quantum | 4 ms | 1.66 ms |
| A command or query | 100 ms | 1.67 ms |
| Snapshot capture / open | 16.7 / 2000 ms | 6.6 / 7.1 ms |
| A quantum with 18 guided volleys in flight | 4 ms | 1.72 ms |
| A quantum with webs held on both sides | 4 ms | 1.54 ms |
| After 20 looted sorties in 3 ships: command / capture / open | 100 / 16.7 / 2000 ms | 1.05 / 6.5 / 7.8 ms |
| The same session: a quantum at the largest site | 4 ms | 2.88 ms |

- **Before the gate:**
  - the new persistence suite: 4 tests passed;
  - the performance suite: all passed. The long session cleared 20 of 20 sorties with 22 stacks, and saved 22,771 to 107,037 bytes. Request p95 was 1.1 ms, capture 6.9 ms, open 7.7 ms, quantum 2.9 ms.
  - config unit tests, traceability, architecture and `tsc`: clean.

## Unresolved / notes for the operator

- **V02-AC-15 is pending.** It is the human playtest, Q13. The exit gate's "human review findings resolved or accepted" cannot be met until it is done.
- **Findings from phase 6 carried to the playtest** (detail in the handoff):
  - the frigate shortcut to the Bombardment Line;
  - the weak guided frigate;
  - larger hulls are not endangered by the content;
  - the flight-school services lesson can be skipped.
- **The "enlarged inventory" is modest.** The played session reaches 22 stacks, because loot merges into existing stacks.
- **The simulation-time readout can lag** by one second after pausing. It is cosmetic; the engine clock is exact.
- **Nothing is committed.**

## Questions
- Q13 (playtest) is still open.
- Q14 asks the operator to update `docs/human-input/CurrentState.md` for v0.2.
