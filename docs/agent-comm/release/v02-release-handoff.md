# Release handoff - Galactic Soup 0.2, Combat Progression Alpha

**Candidate:** 0.2.0-rc.1, recorded 2026-11-17 from a green `npm run release:gate` (commit f3b79e8 plus the uncommitted phase 7 changes).

- **Automated gate: green.** The machine-written evidence is `reports/release-gate.md`. `reports/` is not tracked; `npm run release:report` writes it again from the step records.
- **Human product review (V02-AC-15): pending.** The playtest route is `v02-playtest-route.md` in this folder, and the request is Q13 in `../requests/questions-and-answes.md`. v0.2 is not accepted until it is done; automated evidence does not stand in for it.
- **Player-facing notes:** `docs/v02/ReleaseNotes-v0.2.md`. They say that a fresh campaign is required and how the game asks for it.

## The candidate

| | |
|---|---|
| Application and engine version | 0.2.0 |
| Protocol version | 22 |
| Save format and campaign state version | 13 (reads 11-13) |
| Replay log version | 1 |
| Content version | 0.2.0+d168547388ff |
| Tuning digest | `5da105a5d78af0b3`... |
| Source digest | `56bd248045550597`... |
| Build fingerprint | `13ad844937248c67`... |

- The versions are frozen in `config/release-candidate.json`, which `npm run release:record` writes only from a green gate.
- The source digest covers every file in the repository except documents, so committing does not change it. Any change to the sources makes the candidate stale; the gate then says so.
- The bundle is built twice and compared: the two builds are the same byte for byte.

## What v0.2 contains

FeatureSpec02 is the authority; the phase completion records in `../status/v02-phase-*.md` give the detail.

- **Three hulls** (frigate, destroyer, cruiser), sold bare. The pilot owns several ships at one station. Each keeps its own fit, cargo, damage and insurance, and the pilot switches between them while docked (V02-AC-01 to 03).
- **26 combat modules and 16 charges**, small and medium. They include guided launchers whose damage depends on the target's size and speed, a stasis web, and active and passive defences. The market filters by purpose, size and fit (V02-AC-04 to 07).
- **Twelve combat sites in three bands**, all open from the start. Each has a briefing of threats, recommended capabilities and rewards. There are five opponent archetypes, and some sites punish a particular unsuitable fit (V02-AC-08, 09).
- **Module drops**, with every needed module also on sale, and measured fit and hull progression (V02-AC-10 to 12).
- **Saves.**
  - A v0.2 save resumes exactly, including mid-volley and mid-web.
  - A v0.1 save is explained and refused, never changed. It is replaced only after the pilot confirms (V02-AC-13).
- **Accessibility and browsers.** The enlarged surfaces pass the automated accessibility audit and work from the keyboard in Chromium and Firefox (V02-AC-14).

## Compatibility policy

- **Saves.**
  - Save format 13 is the format this release writes; it reads 11 to 13.
  - Format 10 and earlier (Galactic Soup 0.1) is reported as an earlier release before any checksum is checked. The save stays as it is until the pilot confirms a new campaign, which then replaces it.
  - Newer, corrupt and incompatible saves keep their existing refusals.
- **No migration.** Nothing converts a 0.1 save. That is the release decision recorded in FeatureSpec02; the release notes say so to the player.
- **Offline progress: zero.** Time passes only while the game is open and running. A suspended tab, a sleeping machine or a changed system clock gives at most one capped step.

## Phase 7 verification

- **Persistence and replay** (`tests/integration/v02Persistence.test.ts`).
  - Three authored ladder fights are each flown twice, once straight through and once reopened through the save envelope every 3.7 simulated seconds. The two runs match hash for hash at every reopen and exactly at the end. The fights:
    - Bombardment Line, with guided volleys in flight on both sides;
    - Range Check, under both sides' webs;
    - Command Group, with a mixed railgun, launcher and blaster cruiser.
  - Every bounty is paid once.
  - A damaged, insured stored ship with an open fitting draft resumes, and its draft still commits to that ship alone.
- **Recovery and rejection.** These were already covered by earlier phases, and were re-run in this gate:
  - quota and interrupted-write handling;
  - corrupt, newer and incompatible saves;
  - reset.

  New in the browser:
  - the v0.1 save flow (`persistence.spec.ts`);
  - pause, suspension, clock change and closed time (`campaign.spec.ts`, also run in Chrome and Edge).
- **Accessibility** (`tests/accessibility/progression.spec.ts`, Chromium and Firefox). Each surface is audited and operated from the keyboard:
  - a hangar of three ships and its comparison;
  - the market's filters;
  - twelve destinations in bands;
  - a fight under guided fire with reduced motion;
  - a fight under a web.
- **Performance** (`tests/performance/engine.test.ts`).
  - webs held on both sides;
  - the largest guided volley;
  - a long session: 20 looted Pirate Base sorties across a three-ship hangar, saving as it goes. The history stays capped, the save stays small, and request, snapshot and quantum p95 stay inside budget.

  The figures are in the performance section of `reports/release-gate.md`.
- **Gate results:**

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

## Findings carried to the human review

None of these blocks the automated release. Each is a judgement the playtest should confirm or overturn, and each is described in `../status/v02-phase-06-completion.md`.

- **A frigate clears an advanced site.** The autocannon frigate clears the Bombardment Line 10/10 because guided rounds lose damage against a small, fast hull. It is a legitimate counter, but an early shortcut to an advanced bounty.
- **The guided frigate is the thinnest fit.** It clears little beyond the entry band, and starves its capacitor under a web.
- **Larger hulls are punished by cost and failure to clear, not by danger.** No ladder site kills a properly flown destroyer or cruiser.
- **Flight school may skip the services lesson.** The first Scout sortie can bring the ship home whole and reloaded, so the "Get the ship ready" step completes without the pilot using repair or resupply.

## Known limitations

- **Scope.** There is one star system and one station. There is no skill system, no saved fits, no manual save slots, and no save import or export. Hulls cannot be resold. The only time rates are pause and 1x.
- **Inventory testing.** The long-session performance run reaches 22 stacks across three ships, because loot merges into existing stacks. There is no synthetic test with many hundreds of stacks. Save size is bounded by the save limits, which the golden saves and the long session sit far inside (under 1/32 of the limit).
- **The simulation-time readout.** It shows whole seconds and can show the last running step a moment late after pausing. The engine time is exact; only the display lags.
- **Flaky tests.** The Firefox progression test is timing-sensitive. It passed on its first attempt in the recorded gate, but needed a retry in the run before. The gate reports any retry.

## What the operator needs to do

1. Play the v0.2 route (Q13, `v02-playtest-route.md`) and record its result. Findings become tuning or usability changes, then a new gate and candidate.
2. Update `docs/human-input/CurrentState.md` for v0.2 (Q14). Agents do not edit that folder.
3. Commit the phase 7 changes; nothing has been committed by the agent.
