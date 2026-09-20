# Phase 4 completion note — One-slot save, close, and resume

Status: complete. Date: 2026-09-20.

This note records what the next session inherits. It does not define the game; see
`docs/MVPImplementationPlan.md` §4 Phase 4 for the scope this implements.

## Exit gate

All of the following pass from a clean checkout after `npm install`:

- `npm run typecheck`, `npm run check:architecture`, `npm run validate:content`
- `npm run test:unit` (558 tests), `npm run test:integration` (44), `npm run test:component` (20)
- `npm run traceability` (64 requirement ids, all covered), `npm run build`
- `npm run test:browser` (10) and `npm run test:accessibility` (7), after
  `npx playwright install chromium`

`npm run verify` chains everything except the two Playwright suites.

The specific gate items:

- **Create, close, reopen and reset pass in Chromium.** `tests/browser/campaign.spec.ts` starts a
  campaign, closes it, reloads the page and resumes the same campaign id, then resets it and
  confirms nothing survives a further reload. It also asserts that the origin holds exactly one
  slot manifest and that saving makes no network request.
- **Checksum, incompatible version, interrupted write and quota fixtures preserve the prior valid
  state.** `tests/unit/engine/saveLoad.test.ts` covers a tampered checksum, a forward format
  version, a malformed envelope, a payload that fails the invariants and an over-deep document,
  and asserts the stored document is not modified. `tests/unit/engine/saveService.test.ts` and
  `tests/integration/saveResume.test.ts` cover a refused write (quota), a corrupted newest
  snapshot and a snapshot the manifest still names but the store no longer holds; each falls back
  to the previous valid snapshot.
- **Simulated closure, suspension and wall-clock changes add no simulation progress.**
  `tests/integration/saveResume.test.ts` closes a campaign, opens a second engine session over the
  same store, and finds the same simulation time and the same canonical state hash; a zero delta
  after a suspension and an hour-sized delta from a sleeping tab both add nothing beyond the cap.
  `tests/browser/campaign.spec.ts` repeats the closed-game case in Chromium.
- **A resumed campaign is the campaign that was stored.** `tests/integration/replay.test.ts` runs
  one replay script straight through and the same script split by a close and a resume, and
  compares the final canonical hash, revision and simulation time.

## What exists now

- **`@engine/ports/persistence`** declares the save-store port: the sealed `SaveEnvelope`, the slot
  manifest and its summaries, the retention policy, the structural limits a stored save is bounded
  by, and `SaveStoreError`. The engine orchestrates saving; the port only stores what it is given.
- **`@adapters/persistence`** is a new package (declared in `config/packages.mjs`, platform
  `browser`) with two stores behind that port and the pure rotation plan they share:
  - `createIndexedDbSaveStore` — one database with `manifests`, `snapshots` and `diagnostics`
    stores. A write computes its plan first and then issues every request of the rotation inside a
    single transaction, so the transaction never waits on anything and cannot commit part-way.
  - `createMemorySaveStore` — the headless store used by tests and balance runs, with the hooks a
    persistence test needs: a refused write, a corrupted document, a dropped snapshot.
  - `planWrite` — five rolling autosaves and one replaceable manual save, ordered newest first by
    the per-slot capture sequence.
- **`@engine/application/saves`** owns capture, loading and orchestration:
  - `captureSnapshot` / `envelopeChecksum` seal the envelope. Sealing happens in one place, so the
    bytes a store writes and the bytes a loader verifies come from one function.
  - `loadSave` walks Technical Specification 11.4 in order and writes nothing.
  - `migrateSave` is the ordered pure-migration runner; `SAVE_MIGRATIONS` is empty, because format
    version 1 is the baseline.
  - `createSaveService` captures synchronously, queues the write, coalesces a redundant capture of
    the same kind that has not started writing, and reports progress as a projection.
- **`readCampaignState`** in `@engine/domain` validates a stored payload field by field before the
  invariants run on it. It mirrors `schemas/save/campaign-state.schema.json`, which is what a
  future Java engine validates against.
- **Four new protocol request types** in version 1: `campaign.close`, `campaign.resume`,
  `campaign.save` and `campaign.saves`, with hand-written payload validators and published JSON
  Schemas. `CommandResultData` gained `autosaveRequested`, and `saves` joined the projection
  topics.
- **`createCampaignSession`** in `@gateway` is the client half: it makes the campaign seed, stamps
  every snapshot with the wall clock, runs the five-minute unpaused play timer, and answers an
  autosave trigger the engine could not fulfil itself.
- **`CampaignPanel`** is the first interactive surface: start, resume, close, save now, and a
  two-step reset, with the save status in a named live region and the storage warnings the player
  can act on.
- **`schemas/save/save-envelope.schema.json`** and the golden fixture
  `tests/fixtures/saves/format-1.json` pin the format. The fixture is built against a synthetic
  content identity on purpose: one built against the shipped bundle would change with every balance
  value and prove nothing about the format.

## Decisions a later phase may want to revisit

1. **The save store runs in the worker, beside the engine.** IndexedDB is available to a dedicated
   worker, so the engine reaches persistence through its port exactly as Technical Specification
   4.1 draws it, and Technical Specification 4.2's "the engine worker owns save orchestration"
   holds literally. The main thread never holds campaign data.
2. **A snapshot's real timestamp arrives with the request that asks for it.** The engine has no
   wall clock and may not acquire one. `campaign.create`, `campaign.close` and `campaign.save` all
   carry `savedAtRealMs`, and the engine fulfils an autosave trigger itself only when the
   triggering request supplied one. Every other trigger is reported as
   `CommandResultData.autosaveRequested` and answered by the client with `campaign.save`. When a
   later phase adds the Functional Specification 3.4 triggers (docking, a market transaction, a
   destruction), it calls `transaction.requestAutosave()` and the path already exists.
3. **Resume consumes no revision, no event ordinal and publishes no event.** A restored campaign
   must be indistinguishable from the snapshot it came from, down to its canonical state hash, or
   a replay from a snapshot would diverge from a live run. `Transaction.restoreCampaign` marks the
   transaction as a restore and `commit` skips the increment. The consequence is that a resume is
   invisible to the event log; if notifications later need to announce one, it belongs in the
   session projection rather than as a domain event.
4. **The host now serialises requests.** Reaching persistence made request handling asynchronous,
   and two commands must never interleave over one campaign, so `createEngineHost` queues them.
   The guarantee is the host's rather than the transport's, so it holds however messages arrive.
5. **Captures are serialised too.** `SaveService.save` chains on the previous capture, so captures
   happen in call order and the write queue is therefore in revision order. Without it, two
   overlapping callers could capture out of order, because the first capture waits for the
   manifest read.
6. **Content compatibility is settled by reference resolution, not by hash equality.** A save whose
   content hash differs is accepted when every definition id its state names still resolves in the
   installed bundle, and rejected with a precise error when one does not. This is how Technical
   Specification 11.4's "compatible balance-only changes retain entity and definition IDs and adopt
   the installed values" and its cross-reference step are implemented together. This phase's state
   names no definitions, so the check is vacuous today; `campaignDefinitionReferences` in
   `@engine/domain` is the seam each later phase extends as it adds referencing state. A declared
   content-ID transition registry is not built, because nothing has been released to need one.
7. **`campaign.reset` deletes the stored snapshots; `campaign.close` keeps them.** This completes
   the reading Phase 3 recorded: close means "stop playing, snapshot retained", reset means
   "discard the campaign".
8. **`campaign.save` is neither a command nor a query.** It reaches durable storage without
   changing campaign state, so it takes no revision and does not run through the command pipeline,
   but it is covered by the duplicate-request cache. `PERSISTENCE_TYPES` names that third category.
9. **Closing and creating wait for their write; an interval autosave does not.** Closing must leave
   a durable campaign behind and a new campaign must be resumable at once, so both drain the queue.
   A periodic save returns `pending` and completes behind the response, which is what Technical
   Specification 11.3 asks for.
10. **The structural-bounds traversal moved to `@shared`.** Content and saves are both untrusted
    input; they now share one traversal with different limits. `src/adapters/content/limits.ts`
    keeps the content bounds and no imports, because the build tooling loads it by path.

## Content changes

None. No balance value, definition or rule moved in this phase.

## Notes for the next phase

- `CampaignState` is still version 1. Phase 5 adds the wallet, ships, inventories and item stacks
  to it. When it does, it must move `schemas/save/campaign-state.schema.json`, `readCampaignState`
  in `@engine/domain/campaign/snapshot.ts`, the campaign invariants and the golden fixture in
  `tests/fixtures/saves/format-1.json`, all in the same phase. It owes no migration: nothing has
  been released, so a development campaign that the shape change invalidates is discarded and a new
  one started (`MVPImplementationPlan.md` section 2, rules 6-7). `migrateSave` and its tests
  already prove the runner for the first released change.
- `campaignDefinitionReferences` returns nothing yet. Every later phase that stores a definition id
  must extend it, or a content change that removes that definition will be accepted instead of
  rejected. Rejecting is the correct outcome and needs no transition fixture before release: the
  development campaign is simply restarted.
- `createFrameDriver` is still not mounted. Phase 10 mounts it with the pause and 1x controls, and
  should call `CampaignSession.notePlayTime(elapsed, paused)` from its `onAdvance` so the
  five-minute interval autosave starts running. Until then the interval timer is implemented and
  unit-tested but nothing feeds it.
- The campaign panel shows simulation time from the frame projection as it stood at the last
  refresh. Once the frame driver runs, that value belongs to a live frame subscription rather than
  to the session coordinator's occasional read.
- Save-management surfaces stay deferred: several slots, a rolling save-history UI, export and
  import. The manifest, the retention plan and the slot projection already carry what those
  surfaces would need.

## Open questions for the human operator

None outstanding.

One was asked and answered during this phase. It concerned what a content change should do to an
existing campaign; the operator's answer was that saves are not important at this stage of
development and save compatibility need not be worried about. That answer is now recorded as
delivery rule 7 in `MVPImplementationPlan.md` section 2, and the phases that had assumed a
migration or a content-transition fixture (8, 14, 16, 17 and 20) were corrected to match. The
implemented behaviour is unchanged: an incompatible save is still refused with a precise error and
left untouched, and the interface offers a new campaign. What the rule removes is the obligation on
later phases to carry a pre-release save or content set forward.
