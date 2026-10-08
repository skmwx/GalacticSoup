# Phase 21 completion note - Release-candidate and product-playtest gate

Status: automated gate green, candidate 0.1.0-rc.1 recorded; **the MVP is not complete until the
human playtest is recorded**. Date: 2026-10-08.

Implements Phase 21 of `docs/MVPImplementationPlan.md`. Two documents carry the result:

- `docs/agent-comm/release/release-candidate-report.md` - the candidate, the automated results,
  the known issues;
- `docs/agent-comm/release/playtest-script.md` - the playtest of MVP Scope 9.3, with the place to
  record its result.

This note says what the phase built and what it found.

## What was built

- **The release gate.** `npm run release:gate` runs every automated check against one set of
  sources and one built bundle, and writes `reports/release-gate.md`. Its verdict is green only when
  every required step passed against what is there now.
- **Firefox, Chrome and Edge.** The browser and accessibility suites now run in Firefox as well as
  Chromium. The start, save and offline flows also run in the Chrome and Edge installed here.
- **An offline flow.** A browser test plays a whole loop with the network switched off and fails if
  the game asks for anything.
- **Reopen checkpoints in the mastery flow.** The new-campaign-to-mastery flow now closes, reloads
  and resumes four times along the way.
- **A bundle audit.** The gate fails a build whose scripts could reach the network or evaluate
  text.
- **The candidate record.** `config/release-candidate.json`, written only from a green gate.

No protocol, save, state or content change. The versions Phase 20 closed are the candidate's.

## Defects found and fixed

| Found by | Defect | Fix |
|---|---|---|
| The start flow in Chrome and Edge | **Every start logged an error.** The page declared no icon, so the browser asked for `/favicon.ico`, which the build does not hold, and got a 404. The Chromium build Playwright ships does not ask, so no earlier phase saw it. With an icon in a file instead, Chrome fetched it some seconds after the page loaded - after the offline flow had switched the network off - and logged a failed request. | The icon is written into `index.html` as a data address. No browser asks for anything. |
| The bundle audit | The shipped interface script held one `fetch`: Vite's preload polyfill, for browsers without module preload. It never ran in a release browser. | Switched off in `vite.config.ts`. The shipped scripts now hold no network call. |
| The boot flow in Firefox | A test opened the build-details panel while the start screen was still rendering above it, and about one time in six its click missed. A test race, not a game defect. | The test waits for the start screen first. |

None of these touched a contract, so Phase 20's verification stands (plan section 4, phase 21).

## Defect found and not fixed

**A station confirmation can go stale while the ship regenerates.** In the gate the guidance flow
failed once in Firefox, at the repair confirmation, and passed on its retry. The cause is in the
game:

- natural shield and capacitor regeneration adds one to `assets.version` on every quantum, and
  every economic preview is bound to that version;
- so, docked with the clock running and the ship still regenerating, a Confirm is refused as stale
  whenever a quantum lands between the newest preview and the press. The player is shown the new
  figures and presses again.

It is not release-blocking: nothing is charged wrongly, the screen says what happened, and a second
press works. The fix changes how authoritative state counts, so every golden state hash moves. The
plan sends that to a remediation phase and a new gate run, not into the candidate. Q12 has the
cause, the proposed fix and the choice of doing it before or after the playtest.

## The release gate (`scripts/release-gate.mjs`, `scripts/lib/release.mjs`)

### Steps

| Step | What it runs |
|---|---|
| `typecheck`, `architecture`, `content` | As in `npm run verify`. |
| `unit`, `integration`, `performance`, `component` | The four Vitest levels. The integration level holds the headless loops, the golden replay, the property runs and the balance careers. |
| `balance` | The balance report. It must find nothing moved since the balance candidate was recorded. |
| `traceability` | The requirement coverage report. |
| `build` | The production build, twice. The two must be the same byte for byte, and the result must pass the audit. |
| `browser`, `accessibility` | Both Playwright suites in Chromium, served the bundle the build step made. |
| `browser-firefox`, `accessibility-firefox` | The same suites in Firefox. |
| `browser-chrome`, `browser-edge` | The boot, campaign, save-integrity and offline flows in the installed Chrome and Edge. Skipped, without failing, where a browser is not installed. |

### How it decides

- **Each step leaves a record** in `reports/release/steps/` with its result, its test counts and
  two identities: a digest of the sources, and for a browser suite the fingerprint of the bundle
  it was served.
- **The verdict counts only current records.** A pass recorded against sources that have since
  changed is stale. So is a browser pass against a bundle other than the one built now.
- **Documents are not part of the candidate.** `docs/`, every `.md` file and the candidate record
  are left out of the source digest; everything else in the repository is in it. That is why this
  note can be written after the gate has passed.
- **The digest does not depend on git.** It is over file contents, with line endings normalised,
  so committing the phase does not change it.
- **One retry in the browser suites.** Firefox under Playwright occasionally fails to close its own
  browser context after a test has passed (1 of 40 runs of the boot tests here). A test that needed
  the retry passes the step and is named in the evidence. A retry is a prompt to look, not a
  pardon: the one retry in this gate was the defect above, not the browser.

`--only=<steps>`, `--from=<step>` and `--pending` run part of the gate. `npm run release:report`
rewrites the evidence from the records. `npm run release:record` writes the candidate and is
refused unless the verdict is green.

### The bundle audit

The build step fails when:

- a shipped script contains `fetch(`, `XMLHttpRequest`, `new WebSocket`, `new EventSource`,
  `sendBeacon`, `importScripts`, a service-worker registration, `eval(` or `new Function(`;
- the page or a stylesheet refers to an address outside the build, or the page carries an inline
  script;
- the page declares no icon, or one that is not in the build;
- a shipped SVG file carries script, an event handler or embedded markup;
- the engine worker does not contain the content hash the other steps validated.

This is a static check of what the scripts can do. The offline flow is the played check of what
they did.

## Browser coverage

- `playwright.config.ts` gains four projects: `browser-firefox`, `accessibility-firefox`,
  `browser-chrome` and `browser-edge`. `npm run test:browser` and `npm run test:accessibility` are
  unchanged and still mean Chromium.
- **Every existing test passed in Firefox unchanged**, apart from the boot race above.
- `tests/browser/offline.spec.ts` (new):
  - starts from a clean profile and checks that starting asked only for files of the build;
  - switches the network off;
  - plays a sortie to the Pirate Scout, the fight, the wreck, the way home, a sale and an autosave,
    then closes and resumes the campaign;
  - fails if any request was attempted or any error was logged.
- `tests/browser/progression.spec.ts` now closes the campaign, reloads the page and resumes at four
  points: prepared at the station, in space beside the patrol's three wrecks, after the rewards
  were converted, and after the mastery site.
- Every Playwright test starts in a new browser context, which is a clean profile.

### What "offline" means in this candidate

The installable package and its service worker are deferred (MVP Scope 7). So:

- the build starts from files served on the same machine and asks for nothing else;
- once loaded, it plays, saves and resumes with no network at all;
- loading the page again needs the local files to be served. `npm run preview` does that.

## Tests

| Level | New or changed | What they prove |
|---|---|---|
| Unit, config | `releaseGate.test.ts` (31) | What counts as the candidate; the digest ignores line endings; the bundle audit refuses each kind of outside reference and does not mistake a method named `fetch` for one; test-runner results are read correctly; the verdict's rules for missing, failed, stale and skipped steps. |
| Browser | `offline.spec.ts` (1) | Above. |
| Browser | `progression.spec.ts` (changed) | The four reopen checkpoints. |
| Browser | `boot.spec.ts` (changed) | Waits for the start screen before opening the build details. |

## Results

The gate ran once from start to finish against the final sources, in 47 minutes, and was green:

- typecheck, the architecture check and content validation;
- **1,376 unit tests** (was 1,345), **134 integration tests**, **5 performance tests**,
  **114 component tests**;
- the balance report, with nothing moved from its candidate;
- traceability: 153 requirements, 117 included, 117 covered, 36 deferred;
- the production build, reproducible and with no audit finding;
- Chromium: **28 browser tests** (was 27) and **34 accessibility tests**;
- Firefox: the same 28 and 34, with the guidance flow passing on its retry;
- Chrome and Edge: 15 tests each.

Quantum timing at the Pirate Base: 3.1 ms at the 95th percentile against 4 ms, with production
checks. The evidence is `reports/release-gate.md`; the release-candidate report summarises it.

## Findings worth retaining

- **Test in the branded browsers.** Playwright's Chromium is a headless shell that never asks for
  an icon. The missing-icon defect existed since Phase 1 and showed only in real Chrome and Edge.
  Keep `browser-chrome` and `browser-edge` in the gate.
- **A browser fetches a page's icon when it likes.** Anything the page declares by address can be
  asked for after the game has loaded. Declare such things inline, or expect the offline flow to
  fail.
- **Firefox needed nothing of its own.** The mastery flow takes 15 minutes in either browser, and
  no game code changed for Firefox.
- **Leave the clock running in at least one station flow.** Every long flow but the guidance flow
  pauses on docking, which is why the stale confirmation above went unseen until a gate run
  happened to dock while the ship was still regenerating.
- **A source change invalidates every step.** Finish the code, then run the gate; write documents
  while it runs.
- **Recording after a tuning change now takes three commands:** `npm run balance:record`,
  `npm run golden:record`, then the gate and `npm run release:record`.

## Open questions

Both are in `docs/agent-comm/requests/questions-and-answes.md`, and neither blocks the playtest.

- **Q11:** the production build has no Content Security Policy, which Technical Specification 14
  asks for. It was not added in this phase.
- **Q12:** the stale confirmation above: fix it before the playtest or after.

## Handoff

- **To the human operator:** play `docs/agent-comm/release/playtest-script.md` and record the
  result in it. That result closes the MVP or names the tuning and usability phases that follow.
- **To the next change of `scripts/release-gate.mjs`:** the candidate record writes a suite with
  a retried test as "passed: 27 tests". Make it say "27 tests, 1 on a retry". It was left because
  changing the script would have made this candidate stale.
- **To a remediation phase, if one follows:** any change to the sources makes the candidate stale.
  Run `npm run release:gate` again, then `npm run release:record -- --label=rc.2`. A contract
  change also returns to Phase 20 verification: bump the version, then `npm run contracts:record`
  and `npm run golden:record`.
