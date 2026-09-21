# Phase 9 completion note — Site, movement, warp, and dock engine

Status: complete. Date: 2026-09-21.

Implements Phase 9 of `docs/MVPImplementationPlan.md`. The headless engine can now select an
authored encounter, undock into a loaded site, execute each selected normal-space movement order,
warp to the encounter, retreat to the station site, and dock again. The same journey is available
through the direct and message-channel transports and is deterministic across both.

## Delivered

### Navigation authority and simulation

- Campaign state now owns known destinations, the selected encounter, the loaded site instance,
  object kinematics, the active movement order, travel state, scheduler references, and the last
  cancellation reason.
- The command pipeline supports destination selection, undock, approach, orbit, keep range, move
  to point, stop, same-system warp, retreat, and dock. Preconditions return explicit rule-violation
  reasons and failed commands leave state unchanged.
- Normal movement respects authored maximum speed, acceleration, braking, and turn rate. Approach,
  point movement, and keep range choose a braking-safe desired speed; orbit uses a tangent course
  with radial correction.
- The fixed-step simulation integrates continuous motion before completions at the same timestamp.
  Warp alignment/preparation/transit and docking approach/preparation are scheduler-backed state
  machines. Replacing a command cancels its pending boundary and a vanished target stops safely.
- Overlapping objects receive a stable, ID-ordered separation correction, including a deterministic
  fallback direction for exact overlaps.

### Content and projections

Navigation thresholds are authored in `content/rules/navigation.json` and validated as part of the
content bundle. The content repository now indexes the site definitions embedded in authored
systems, including the station site and the three encounter sites in the MVP system.

`navigation.destinations` projects encounter summaries, selection/current/known state and
availability reasons. `navigation.site` projects the current location, site and object data,
positions, velocities, facing, ranges, movement order, travel phase/completion, and cancellation
reason. Projection topics cover navigation, site, and destination changes.

Undock, encounter arrival, retreat arrival, and docking completion emit autosave requests. The
headless engine does not invent a wall-clock timestamp; the existing client session answers those
requests with an auto-save command.

### Contracts and persistence

Protocol version is **6**. It adds the two navigation queries, ten navigation commands, their
strict payload validators, published JSON Schemas, response data schemas, event kinds, invalidation
topics, and localized rule-violation messages.

Campaign-state and save-format versions are **5**. The snapshot contains the expanded
station/site/warp location union and every authoritative navigation field, including in-flight
scheduler entries. Load-time invariants reject inconsistent locations, missing site runtimes,
invalid targets, duplicate destinations, malformed phase/boundary pairs, wrong boundary ownership
or kind, and future cancellation timestamps. The golden save is
`tests/fixtures/saves/format-5.json`.

There is no 4-to-5 migration in the shipped registry. This follows MVP plan section 2, rule 7:
these are pre-release development formats, while the migration runner remains covered by fixture
registries and the first released version will begin the required chain.

## Exit gate

- Geometry and controller tests cover zero-distance behavior, relative motion, deterministic
  overlap direction, braking, acceleration, turning, and every selected movement order.
- State-machine tests cover direct and channel transports, preconditions, prepared-boundary
  cancellation, target disappearance, retreat, dock/undock/encounter autosave requests, and saving
  and resuming during warp transit.
- Navigation replay produces identical canonical state hashes through both transports.
- `npm run verify` passes type checking, architecture checks, content validation, **822 unit
  tests**, **70 integration tests**, **47 component tests**, traceability, and the production build.
- Traceability reports **89 requirement ids**, all covered by tests.

## Handoff to Phase 10

- Build the traversal UI only from `navigation.destinations` and `navigation.site`; positions and
  travel data are already transport-safe projections, not UI-owned state.
- Route every action through the Phase 9 commands and refresh from their invalidation topics.
- Answer each `autosaveRequested` navigation result through the existing campaign session.
- Add renderer selection, camera state, contextual controls, ranges, intent/vector overlays, labels,
  off-screen markers, and keyboard/mouse access without moving simulation authority into React.

No open questions.
