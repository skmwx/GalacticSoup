# UIR1-10 completion note - Integrated acceptance and review handoff

Status: complete (implementation and automated verification; human acceptance pending). Date: 2026-11-11.

Implements phase UIR1-10 of `docs/MVPUIReview01ImplementationPlan.md`. The human-facing summary
is `docs/agent-comm/release/uir1-10-review-summary.md`. It has the finding-by-finding evidence
table, the screenshots in `docs/agent-comm/release/uir1-10-review/`, and what is left for human
judgement.

## What I did

1. Checked every finding in `human-input/MVP-review-01.md` against plan section 5 and against the
   production bundle.
2. Played the loop by hand in Chromium at 1440x900: new campaign → buy → transfer → fitting pickers
   → undock without a destination → set course from the radar → warp → fight with lock, approach,
   fire and the hit-chance explanation → loot → Harbour return → dock with X → priced services →
   Settings from the game menu. I also checked a resume after reload, 390 px width, tooltips on
   hover, and focus return from the game menu.
3. Played loss, recovery purchase or grant, and the return to the player's wreck only through the
   automated loss flows (`loss.spec.ts` in Chromium and Firefox, and the loss integration suite). I
   did not play them by hand.
4. Fixed three small integration gaps, listed below.
5. Ran the full release gate.

## Code changes

| File | Change |
|---|---|
| `src/ui/space/DestinationChooser.tsx` | Warp records the offered encounter or wreck as the destination (`navigation.selectDestination` / `selectBookmark`) before warping, unless it is already recorded. Clicking a row uses the same `record` helper. Without this, a player who warped to the preselected site never completed the "Choose a site" guidance step. |
| `src/ui/actions/ActionButton.tsx` | New optional `icon` prop that overrides the registry icon. |
| `src/ui/frame/CampaignFrame.tsx` | The time toggle draws a pause icon while running and a play icon while paused. It drew play in both states. |
| `src/ui/localization/messages/en.json` | `sortie.next`, `departure.damaged` and `departure.capacitor.charging` say "on the Overview" instead of pointing at the removed Services screen. |
| `tests/component/Guidance.test.tsx` | New test: *counts warping to the destination offered first as choosing it*. Also, one expected string follows the message change. |

There are no engine, protocol, schema, content, save or fixture changes. I did not refresh any
balance or golden baseline.

I tried and reverted one more change. Keeping the hangar's quantity box and its Move button on one
line made the hold table overflow at 1440 px.

## Documentation

- `docs/agent-comm/release/playtest-script.md`:
  - a checklist group for the reworked screens;
  - two "known before you start" items: docking after a return, and transfers not being autosave
    points.
- `docs/agent-comm/release/uir1-10-review-summary.md` and its screenshots: new.
- `docs/agent-comm/release/release-candidate-report.md`: rewritten for rc.2: identity, results, performance, the UIR1-10 fixes and the new usability notes. The rc.1 history is kept where it still applies.
- The plan's status table.

`human-input/CurrentState.md` is left for the operator.

## Commands and results

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

During the session I also ran these, before the final gate:

- `npm run typecheck`;
- `vitest --project component` on `Guidance.test.tsx` and `SpaceScreen.test.tsx` (28 passed).

An earlier partial gate run was invalidated by "the sources changed while the step ran". The cause
was my edits, and the Playwright MCP screenshots in the untracked `.playwright-mcp/` folder,
which the source digest counts. Delete that folder before running the gate.

## Remaining issues

These are all recorded in the review summary.

- Q12 (stale confirmations during regeneration) is unanswered and inherited.
- Docking from the station's own site takes a list choice or X.
- Radar labels overlap at close range.
- The hangar transfer controls are tall.
- A transfer is not an autosave point (by Functional Specification §3).
- One unreproduced instance of a fitting picker not opening.
- From UIR1-09: mid-word breaks at 1.5x text, and notifications stacking at 1024 px.

None needed a new rule or engine session. If the playtest asks for any of these, each is a small
UI phase.
