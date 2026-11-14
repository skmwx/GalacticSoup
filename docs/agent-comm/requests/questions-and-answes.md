# Questions and answers

Coding agents post questions here; the human operator answers them in place.

The questions for which the answer was provided and the resolution has been applied are archived by the human operator manually, so the numeration might not start from 1.


## Q11 - Phase 21 - The production build has no Content Security Policy

**Asked:** 2026-10-08 (Phase 21, release-candidate gate). **Blocking:** no. The candidate ships
without one; it is listed as a known issue in the release-candidate report.

Technical Specification 14 says "the production site uses a restrictive Content Security Policy
allowing only its bundled scripts, styles, media, and worker". No phase built one: `dist/index.html`
carries no policy and nothing sets a header. The traceability registry lists `TECH-14` as included
with no narrower extent, and its tests cover the rest of that section (bounds, checksums, invariant
depth), so the gap did not show there.

What the candidate has instead is evidence that it asks for nothing:

- the release gate audits the built scripts and fails if one contains a call that can reach the
  network or evaluate text (`fetch`, `XMLHttpRequest`, `WebSocket`, `eval` and the like), or if the
  markup or styles refer outside the build. The one such call the bundle held, Vite's preload
  polyfill, is switched off;
- `tests/browser/offline.spec.ts` plays a whole loop with the network off and asserts that no
  request was attempted, in Chromium, Firefox, Chrome and Edge.

A policy would add enforcement by the browser on top of that. I did not add one in this phase
because it is not release-blocking under MVP Scope 9.2, and because it comes in two parts with
different owners:

1. **A `<meta>` policy in the built `index.html`.** It travels with the files and covers the page.
   It does not cover the engine worker, which takes its policy from the response that serves it.
   This is a small build change; it changes the bundle, so the gate runs again.
2. **A response header from whatever serves the build.** This is the complete form, and it belongs
   to production packaging, which MVP Scope 8 defers.

Choices: (a) add part 1 now, as a small remediation phase before or after the playtest; (b) defer
the whole policy with production packaging, and I record that in MVP Scope 8 and in the `TECH-14`
entry of the registry; (c) leave it as it is. I would do (a) and (b) together: the meta policy now,
the header with packaging.

**Answer:**

---

## Q12 - Phase 21 - A station confirmation can go stale while the ship regenerates

**Asked:** 2026-10-08 (Phase 21, release-candidate gate). **Blocking:** no. The candidate ships with
it; it is the first known issue in the release-candidate report.

**What the player sees.** Docked, with the clock running and the shield or the capacitor still
regenerating, pressing Confirm on a repair, purchase, sale, resupply or insurance is sometimes
answered with "Something changed while you were deciding. These are the current figures; confirm
again to go ahead." Nothing has changed that matters, nothing is charged wrongly, and a second press
works. Paused, or once the ship has finished regenerating, it does not happen.

**How it was found.** In the release gate the guidance flow failed once in Firefox, at the repair
confirmation, and passed on its retry. I reproduced the cause headlessly: a repair preview taken
after a fight and confirmed one second of running clock later is refused with `STALE_PREVIEW`.

**Cause.** Two things bind a preview to more than it depends on:

1. `regenerateShips` in `src/engine/simulation/combat.ts` adds one to `assets.version` on every
   quantum in which a shield or a capacitor regenerates. That version is read in exactly one place,
   the `relevantVersions` of every economic preview, so every such quantum makes every open preview
   stale.
2. The repair preview's values hash includes the shield damage and the capacitor charge it found.
   Both are restored free and neither changes the price.

The interface hides most of it: it asks for a new preview on every such quantum, so a press is
refused only when a quantum lands between the newest preview and the press. That also means an open
dialog asks the engine for a preview up to twenty times a second.

**Why I did not fix it in Phase 21.** It is not release-blocking, and the fix changes authoritative
state: `assets.version` would count differently, so every state hash in the golden campaign moves
and the campaign must be recorded again. The plan sends that to a remediation phase with a new gate
run, rather than into the candidate.

**Proposed fix** (one small phase):

- natural regeneration no longer adds to `assets.version`;
- the repair preview's hash leaves out the shield damage and the capacitor charge;
- a headless test confirms a repair, and a purchase, one second of running clock after its preview;
- `npm run golden:record`, then `npm run release:gate` and `npm run release:record -- --label=rc.2`.

No protocol, save-format or content change, and no balance figure moves.

Choices: (a) fix it before the playtest, so the playtest is of rc.2; (b) playtest rc.1 as it is and
fix it with whatever else the playtest finds. I would do (a): it is in the loop the playtest
judges, and a first-time player meets it right after their first fight.

**Answer:**
Automatically restore shield and capacitor to full when docking.

Adjust confirmation checks so natural regeneration cannot invalidate unrelated transactions, and exclude those free restoration values from the repair check.

**Resolution applied (2026-11-14):** Completed docking now restores shield and capacitor instantly for free, preserving armor and hull damage. Natural regeneration no longer increments the asset version used by economic confirmations, and repair confirmation hashes exclude shield damage and capacitor charge. Regression tests cover docking restoration and confirming repair and purchase after one second of regeneration, including a campaign resumed docked with depleted pools.

**Validation:** Type checking, architecture, content validation, all 1,407 unit tests, 135 integration tests, 143 component tests, performance, balance, traceability, and the production build audit passed. The focused station and guidance browser suites passed all five tests in Chromium and all five in Firefox. Firefox required an elevated rerun after restricted execution failed during page creation. Golden campaign and save fixtures were refreshed. The full release gate was stopped after its Chromium progression test lost its ship and stalled waiting for a vanished target. Full release certification and a new candidate record remain pending.
