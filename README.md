# Galactic Soup

A single-player space trading, exploration, mining and combat game that runs entirely in the
browser. See `docs/` for the authoritative documents: the game concept, design brief, functional
specification and technical specification define the game; `docs/MVPScope.md` and
`docs/MVPImplementationPlan.md` select and sequence the current work.

## Requirements

- Node.js 22.12+ or 24+. The toolchain (Vite 8 with Rolldown, Vitest 5, TypeScript 7) requires it,
  and the project was verified on Node 24.21.
- Exact dependency versions are pinned in `package.json` and `package-lock.json`
  (`.npmrc` sets `save-exact`). Upgrading one is a deliberate change accompanied by the relevant
  test suites (Technical Specification 3.1).

## Commands

| Command | What it checks |
|---|---|
| `npm run dev` | Development server. |
| `npm run build` | Type check plus the production bundle. |
| `npm run preview` | Serves the production build. |
| `npm run typecheck` | Strict TypeScript, no emit. |
| `npm run check:architecture` | Package boundaries, dependency direction, headless-engine rule, circular imports. |
| `npm run validate:content` | Schema and semantic validation of the content bundle. |
| `npm run test:unit` | Formula, contract and rule unit tests (Node environment). |
| `npm run test:integration` | Engine and transport integration tests (Node environment). |
| `npm run test:component` | React component behaviour (jsdom). |
| `npm run test:browser` | Playwright acceptance flows against the production build. |
| `npm run test:accessibility` | Playwright accessibility flows. |
| `npm run traceability` | Requirement coverage report in `reports/`. |
| `npm run verify` | Everything above except the two Playwright suites. |

The Playwright suites need browsers: `npx playwright install chromium`.

## Architecture in one paragraph

The interface never owns game state. A player action becomes a protocol command, the client
gateway carries it to the engine host, and the engine — which runs in a dedicated worker and knows
nothing about the DOM, React or browser storage — decides the outcome and returns it. Queries
return immutable view models. The engine reaches authored content and durable storage only through
ports it declares; the adapters behind them are composed in the worker. Swapping the worker
transport for a network transport, or the TypeScript engine for a server, must not require changing
interface components.

`config/packages.mjs` declares the package boundaries and is the single source of truth for the
build aliases, the TypeScript paths and the architecture check. Cross-package imports go through a
package alias (`@protocol`, `@engine`, `@gateway`, …), which always resolves to that package's
public index.

```text
src/
  app/            bootstrap and top-level composition
  ui/             React views, SVG renderers, localization, styles
  gateway/        transport-independent client API and the frame driver
                  (plus test-only in-process gateways)
  protocol/       versioned envelope, request catalogue, error model
  engine/         headless authoritative engine
    application/  command pipeline, transactions, request dispatch
    domain/       campaign aggregate, identity, randomness, invariants
    simulation/   authoritative clock, scheduler, ordered systems
    projections/  domain-to-view-model builders
    ports/        interfaces the engine owns and adapters implement
  adapters/       worker host and message dispatch, content loading, save stores
  shared/         dependency-free primitives
content/          authored game data: rules, catalog, universe, economy, encounters
schemas/          JSON Schemas for the protocol, for content and for saved state
tests/            unit, integration, component, browser and accessibility levels
scripts/          architecture, content and traceability checks
```

## The campaign and its clock

A campaign is created from a client-supplied 128-bit seed. The engine has no clock and no entropy of
its own, so both arrive with the command: the campaign id and every named random stream are derived
from that seed, which is what makes a replay reproducible. A command changes a deep copy of
`CampaignState`, the invariants run on the result, and only then does the transaction commit and
move the revision once. A rejected command, a failed invariant and a command that decided to do
nothing all leave the campaign untouched, down to the draw index of each random stream.

Simulation time advances only because the main thread measures real elapsed time between frames and
sends it as `time.advance`. The engine caps one delta, scales it by the selected rate and
accumulates fixed quanta; a suspended tab produces no delta and therefore no progress, and nothing
is ever replayed as catch-up. Scheduled work is a queue entry ordered by due time, priority and
insertion ordinal — never a `setTimeout`.

`schemas/save/campaign-state.schema.json` is the contract for the authoritative payload a snapshot
stores, and `diagnostics.stateHash` returns its canonical SHA-256 so replay tests can compare
checkpoints across transports.

## Saving and resuming

A campaign lives in one local slot. The engine decides when a snapshot exists and what it holds;
the store decides only where the bytes go. Capture is synchronous and happens at the revision the
caller asked about, so simulation carries on while the write is still in flight, and writes for one
campaign are serialised and therefore finish in revision order.

A save is a self-describing JSON envelope: the build and content it was written against, the
campaign and revision it holds, the canonical `CampaignState` payload, and a SHA-256 over
everything else in it. `schemas/save/save-envelope.schema.json` is its published contract and
`tests/fixtures/saves/format-1.json` is the golden artefact that pins the format, its canonical
serialisation and its digest. Loading walks the steps the technical specification prescribes —
bounds, checksum, shape, migrations, content compatibility, invariants — and nothing in that path
writes, so a save that cannot be opened is left exactly as it was found and the loader falls back to
the previous valid snapshot.

The slot keeps five rolling autosaves and one replaceable manual save, rotated in a single
IndexedDB transaction. A failed or interrupted write leaves the previous manifest and every
snapshot it names intact, and is reported through the save status rather than by interrupting play.

The engine has no wall clock, so the timestamp a snapshot carries for display arrives with the
request that asks for it. That is also why the five-minute interval autosave is a main-thread play
timer: `createCampaignSession` in `@gateway` counts unpaused real time and sends `campaign.save`,
and answers any autosave trigger a command reports back.

## Content

Everything the functional specification calls a value — prices, hit points, ranges, bounties, drop
rates — is authored as JSON under `content/` and validated against `schemas/content`. Engine code
holds the algorithms and the structural enumerations (the four damage types, the slot kinds); it
does not hold balance numbers.

The build compiles `content/` into one canonical bundle: definitions sorted by stable id, authoring
comments stripped, and a SHA-256 of the canonical bytes recorded as `contentHash`, with
`contentVersion` derived from it. `config/contentPlugin.mjs` runs that compilation when the
development server starts, when the test run starts and when the production build runs, and any
content error stops all three, naming the file and the JSON path. The engine reads the bundle only
through its content port, so a future Java engine can read the same schemas and bundle.

`npm run validate:content` runs the same compiler and writes the compiled bundle to
`reports/content-bundle.json` for inspection.

Three properties keep the data portable: definition ids are authored and namespaced
(`hull.independent.starter`), authored units are converted once at the boundary (cubic metres
become whole cubic-decimetre units), and the canonical JSON profile that feeds every checksum is
pinned by cross-language fixtures in `tests/fixtures/canonical/profile.json`.

Modules under `src/shared` use explicit `.ts` import specifiers so the build tooling can import the
engine's own primitives directly. The content compiler therefore canonicalises and hashes with the
same code the engine runs, instead of a second implementation that could drift.

## Traceability

Production code claims a requirement with an `@implements TECH-7.1` comment; a test covers one by
carrying `[TECH-7.1]` in its name. `npm run traceability` builds the report and fails when code
claims a requirement that no test names. The report proves coverage; it does not replace human
playtesting.
