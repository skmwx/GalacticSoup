# Phase 3 completion note — Transactional engine and deterministic simulation kernel

Status: complete. Date: 2026-09-19.

This note records what the next session inherits. It does not define the game; see
`docs/MVPImplementationPlan.md` §4 Phase 3 for the scope this implements.

## Exit gate

All of the following pass from a clean checkout after `npm install`:

- `npm run typecheck`, `npm run check:architecture`, `npm run validate:content`
- `npm run test:unit` (445 tests), `npm run test:integration` (28), `npm run test:component` (10)
- `npm run traceability` (59 requirement ids, all covered), `npm run build`
- `npm run test:browser` (4) and `npm run test:accessibility` (3), after
  `npx playwright install chromium`

`npm run verify` chains everything except the two Playwright suites.

The specific gate items:

- **Failed and stale commands leave state, revision, ordinals and random streams unchanged.**
  `tests/unit/engine/commandPipeline.test.ts` covers a rejected command, a stale
  `expectedRevision`, an invariant failure and a transaction abandoned after taking random draws;
  each case compares the campaign's canonical state hash before and after.
- **Duplicates are idempotent.** The host keeps a bounded recent-request cache of committed
  state-changing commands and returns the original response for a repeated request id
  (`tests/unit/engine/engineHost.test.ts`). Queries are never served from it.
- **Pause and 1x advance correctly.** `tests/unit/engine/clock.test.ts` covers pause, whole quanta,
  the sub-quantum remainder, rate scaling and the per-delta cap.
- **Scheduler ties are stable.** `tests/unit/engine/scheduler.test.ts` covers ordering by due time,
  priority and insertion ordinal, and the invariants reject a queue stored out of order.
- **Replay checkpoints produce identical hashes through both gateways.**
  `tests/integration/replay.test.ts` runs the same script through the direct gateway and through
  the channel gateway, which uses the production worker dispatcher and structured-clone messaging,
  and compares a state hash at every step.

## What exists now

- **Three new engine packages**, declared in `config/packages.mjs` with matching tsconfig paths:
  `@engine/domain` (campaign aggregate, identity, ordinals, randomness, invariants),
  `@engine/simulation` (clock, scheduler, boundary resolution) and `@engine/projections`
  (view-model builders). The architecture check enforces their direction and the headless rule.
- **`CampaignState` version 1** with campaign identity, display name, seed, creation metadata,
  revision, entity and event ordinals, time state, five random streams and the scheduler queue.
  `schemas/save/campaign-state.schema.json` is its published contract; Phase 4 adds the snapshot
  envelope around it.
- **The command pipeline**: transaction-local deep-copy drafts, revision verification, the
  duplicate-request cache, domain events with campaign-owned ordinals, projection invalidation
  topics, invariant validation before commit, and a single revision increment per committed
  command.
- **The authoritative clock**: `time.advance` caps one real delta at `maxFrameDeltaMs`, scales it
  by the selected rate and accumulates fixed `simulationQuantumMs` quanta. Undelivered time is
  discarded, never replayed. `createFrameDriver` in `@gateway` is the main-thread half: it
  measures frame intervals, keeps one advance in flight and resets its baseline on a visibility
  change.
- **The scheduler**: a queue kept sorted by due time, priority and insertion ordinal, with
  schedule, cancel, cancel-by-owner and take-when-due operations. No gameplay boundary kind exists
  yet; a queued boundary with no installed resolver publishes `scheduler.boundaryUnhandled`
  instead of being dropped.
- **Deterministic randomness**: xoshiro128** over unsigned 32-bit operations, five named streams
  seeded from the campaign seed, plus unit-interval, integer-in-range (rejection sampled, so no
  modulo bias) and chance draws, each recording stream, draw index, bounds and outcome.
  `tests/fixtures/random/xoshiro128starstar.json` was produced by an independent implementation
  and is the corpus a second engine must reproduce.
- **Protocol version 1 grew by seven request types**: `campaign.create`, `campaign.reset`,
  `campaign.session`, `campaign.frame`, `time.set`, `time.advance` and `diagnostics.stateHash`,
  each with a hand-written payload validator and a published JSON Schema.
- **Campaign invariants** covering Technical Specification 15.3 checks 1, 7, 11 and 12 — the ones
  whose subject exists. Each later phase adds the checks for the state it introduces.

## Decisions a later phase may want to revisit

1. **The client supplies the campaign seed; the engine derives everything else.** The engine is
   headless and has no entropy source, so `campaign.create` carries a 128-bit hex seed. The
   campaign id is `c` plus 96 bits of that seed's digest, and every random stream is derived from
   it. Two campaigns created from the same seed therefore have the same identity — acceptable with
   one slot, and something the multi-slot work in a later phase must confirm.
2. **Reset ends the campaign; it is not the same as closing.** MVP Scope §3 lists create, reset,
   close and reopen separately. This phase reads close as "stop playing, snapshot retained" and
   reset as "discard the campaign", so `campaign.reset` returns the session to no-campaign.
   Phase 4 owns close, resume and deleting the stored snapshot.
3. **A transaction deep-copies the whole campaign.** It makes "nothing outside a commit changes"
   true by construction, and the commit deep-freezes the result. Both are O(state) per command,
   and `time.advance` runs once per frame. That is irrelevant at this state size; when the site
   runtime and NPCs arrive, the performance work in Phases 13 and 20 should measure it and, if
   needed, move to a copy-on-write draft without changing the pipeline's contract.
4. **The sub-quantum accumulator is authoritative state.** It is saved, so a reload resumes
   mid-quantum exactly. The alternative — treating it as transient worker state — would discard
   under one quantum of simulation time across a save, which Technical Specification 9.1 would
   also permit.
5. **An accumulator-only advance still commits and consumes a revision.** It changes authoritative
   state, so it must. The consequence is that the revision moves roughly once per frame while the
   simulation runs, which is why `expectedRevision` is not a usable concurrency guard for a slow
   screen; Technical Specification 7.4 already directs previews to compare entity versions
   instead.
6. **`SessionData` deliberately omits the live clock and revision.** Session is the slow topic —
   what campaign is open, how time is configured, which build is running. The clock, the revision
   and the scheduler are in `FrameData`, so a time advance invalidates `frame` alone.
7. **The duplicate-request cache is cleared when a campaign ends.** A remembered result describes
   a campaign that no longer exists. The reset response itself is remembered after the clear, so a
   duplicated reset message stays idempotent.
8. **`MAX_DISPLAY_NAME_LENGTH` is stated in both `@protocol` and `@engine/domain`.** The protocol
   must reject an oversized payload before engine code runs and may not import the engine.
   `tests/unit/engine/campaignState.test.ts` checks that the two agree.
9. **`INSTALLED_BOUNDARY_RESOLVERS` is empty.** It is the seam each gameplay phase registers its
   boundary kinds in. Tests pass their own resolvers, so the queue is exercised without a
   speculative gameplay system.

## Content changes

`content/rules/time.json` now matches Technical Specification 9.1 rather than the provisional
values Phase 2 seeded:

- `simulationQuantumMs` is 50, the fixed quantum the specification names (it was 100);
- `maxCatchUpMs` is renamed `maxFrameDeltaMs` and set to 250, the per-delta cap the specification
  names. The old name and its value of 0 described a catch-up budget, which is not what the rule
  is: one real delta is capped, and the excess is discarded.

The rule schema, the `TimeRules` port type and both content fixture packs moved with it. This is a
correction that aligns content with the governing specification; it is neither a balance change
nor a specification exception.

## Notes for the next phase

- Phase 4 persists `CampaignState` behind the persistence port. Its schema, the canonical JSON
  profile, SHA-256 and `campaignStateHash` are in place; the snapshot envelope of Technical
  Specification 11.2 (format version, engine and protocol versions, content version and hash, save
  kind, checksum) is Phase 4's to add, along with the golden fixture and the no-op migration
  baseline.
- The session holds the campaign in the worker only. Phase 4 adds create, reset, close, resume and
  save-status flows; close and resume are the two that do not exist yet.
- Autosave requests are not emitted anywhere. Phase 4 owns the periodic request and the commit
  hook; the pipeline already returns a committed/unchanged distinction that an autosave trigger
  can key off.
- `createFrameDriver` is written and tested but nothing mounts it: no interface surface drives
  time yet. Phase 10 mounts it with the pause and 1x controls.
- Forced reduction from 4x or 8x to 1x (Functional Specification 3.3) has nothing to act on while
  the MVP offers 1x only and no hostile exists. The rate list is content-driven, so the rule
  belongs with the phase that introduces hostiles — Phase 11 or 12.

## Open questions for the human operator

None.
