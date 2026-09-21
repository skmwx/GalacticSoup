# Phase 10 completion note — Schematic space view and traversal integration

Status: complete. Date: 2026-09-21.

Implements Phase 10 of `docs/MVPImplementationPlan.md`. The runnable traversal milestone is now
playable through mouse and keyboard in the shipped build: the player prepares at the station,
chooses an encounter, undocks, commands the ship in a two-dimensional schematic site, warps to the
encounter, retreats, returns and docks — and finds all of it after closing and reopening.

## Delivered

### Engine — projected command availability

Technical Specification 12.3 requires the interface to take an action's availability from a
projection rather than deciding it. Phase 9 had the commands but no availability, so this phase
added it.

- `src/engine/domain/navigation/availability.ts` holds one predicate per navigation command. Each
  returns the refusal the corresponding command would return, or `null`.
- `src/engine/application/navigationCommands.ts` now asks those predicates instead of repeating the
  preconditions, so the command bar cannot offer an order the engine would refuse, or hide one it
  would accept. A test drives each projected refusal and checks the command answers with the same
  message key.
- The domain may not import the protocol, so the refusal vocabulary is declared in the domain and
  turned into an error or a message key by the application and projection layers. A unit test checks
  the two vocabularies name the same things, and the projection's use of
  `ruleViolationMessageKey` makes it a compile error to drift.

`navigation.site` now carries site-scoped availability (`ship.undock`, `movement.moveToPoint`,
`movement.stop`, `navigation.retreat`), per-object availability (`movement.approach`,
`movement.orbit`, `movement.keepRange`, `navigation.dock`) and the authored distances the orders
offer. `navigation.destinations` carries per-destination availability for
`navigation.selectDestination` and `navigation.warp`, replacing the single `available` flag that
conflated choosing a destination with flying to one.

### Content

`content/rules/navigation.json` gains `rangePresetsKm`, the distances an approach, orbit or
keep-range order offers. The interface offers exactly what the projection carries, so no distance is
chosen in React. The arrival distances were already authored and are now projected alongside.

### Interface

- `src/ui/space/` is the new schematic view: a pure camera transform (`camera.ts`), camera
  presentation state (`useCamera.ts`), presentational interpolation (`useSiteMotion.ts`), the SVG
  renderer (`SiteView.tsx`), the object list, the selected-object panel, the command bar, the travel
  status and the screen that composes them.
- Layers are drawn in the Technical Specification 12.2 order. The effects layer has nothing to draw
  until damage events exist and is not emitted yet; the layers around it already sit where it will
  go.
- The drawing is one labelled image; the object list beside it is the control surface. That is what
  keeps selection reachable by keyboard without focusable shapes inside an SVG, and it is why the
  accessibility audit passes on the space surfaces.
- `src/ui/station/DeparturePanel.tsx` is the station's sixth surface: the three authored sites with
  their tier and reward summary, the destination choice and the undock action.
- The persistent frame now reports the site, the system and its danger rating, the ship's speed and
  the order it is carrying out while undocked.
- `src/ui/frame/usePlayData.ts` replaces `useStationData`. It is the same store generalised: one
  refresh policy, one command path and one autosave answer for both surfaces, with the location the
  engine reports deciding which projections are worth asking for. Reads are now coalesced, because
  the tactical topics are invalidated every simulation step.
- The action registry gained the flight and view actions, their icons and their shortcuts
  (`a`, `o`, `k`, `s`, `w`, `x`, `d`, `u`, `=`, `-`, `c`). No shortcut collides with a station one.

Nothing authoritative moved into React. Selection, camera, zoom and the destination-point draft are
presentation; every order is a command and every number is a projection.

## Contracts and persistence

Protocol version is **7**: the two navigation queries carry command availability and the authored
range and arrival distances. Their published JSON Schemas, the request envelope and the health and
capability schemas moved with it.

Campaign state and save format are unchanged at **5**. This phase added no authoritative state, so
there is no snapshot change and no migration to write.

## Exit gate

- `npm run verify` passes: type checking, architecture checks, content validation, **864 unit
  tests**, **73 integration tests**, **60 component tests**, traceability and the production build.
- `npx playwright test` passes **36** browser and accessibility tests, including the full traversal
  flow against the shipped build — choose, undock, order, warp, retreat, return, dock, reopen — and
  a second flow that resumes inside a site with its order intact.
- Traceability reports **93 requirement ids**, all covered by tests.
- Component tests cover the camera transform, selection, layer order, the non-colour semantic
  states, availability taken from the projection, and that every message key the surfaces ask for
  resolves.

### One pre-existing failure fixed

`tests/browser/campaign.spec.ts` asserted the literal save format `4`, which Phase 9 had moved to
`5`. `npm run verify` does not run Playwright, so the break was not visible at the Phase 9 gate. The
test now reads `SAVE_FORMAT_VERSION` from the engine, so the next format change fails in the phase
that makes it.

## Handoff to Phase 11

- Targeting, weapon, lock and module availability belong in
  `src/engine/domain/navigation/availability.ts` or a sibling beside it, and in the same projected
  `commands` arrays, so the command bar keeps taking availability from one place.
- `SelectedObjectPanel` deliberately shows only identity, kind, range and speed, and marks defences
  unknown. Relative motion, hit chance, defensive layers, cycle timers and warp-disruption state are
  Functional Specification 19.3 items that need the Phase 11 engine functions and their calculation
  traces; do not reconstruct them in React.
- The effects layer belongs between `objects` and `labels` in `SiteView`; `tests/component/
  SpaceScreen.test.tsx` pins the current layer order and will need that one entry added.
- `useSiteMotion` is the only place a drawn position differs from a published one. Anything that
  must be measured — range, tracking, angular velocity — reads the projection, never the
  interpolated position.
- Market listings are not re-read on docking because nothing can change them while the player is
  away. A phase that makes the market move must invalidate the `market` topic.

No open questions.
