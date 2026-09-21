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
                  (frame/ the persistent frame and the projection store,
                   station/ the docked surfaces, space/ the schematic view)
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
`tests/fixtures/saves/format-5.json` is the golden artefact that pins the format, its canonical
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

## Wallet and physical assets

Starting credits, hull, station, item grants and the starting fit are authored in
`content/rules/economy.json`. A campaign owns one starter ship wearing that fit, its empty cargo
hold, a station hangar with what the fit did not take, and the ship's own fitting store.

`src/engine/domain/assets` owns inventory and wallet operations. Physical stacks move only through
the inventory service, which provides atomic split, merge, transfer, reserve/release, state change
and capacity changes. Reservations occupy explicit inventories and retain their share of source
capacity. Quantities, credits and cargo volume use safe integers; acquisition quantities and credit
totals survive splitting and merging without loss.

The engine checks locality and returns immutable projections. Reservation and wallet mutations
remain domain operations for the gameplay handlers that need them.

## Fitting and derived attributes

A fitted module is not a copy of a module: it is the same physical stack, moved into the ship's
fitting store and carrying the slot it occupies. A loaded magazine is the same. That is why a
module can never be both fitted and in a hold, and why reading a fit cannot disagree with the
inventory.

Fitting happens in a draft (`src/engine/domain/fitting`). `fitting.begin` copies the fit the ship
wears, `fitting.set` and `fitting.clear` replace one slot at a time, `fitting.revert` discards the
draft and `fitting.commit` performs every move at once. The draft names definitions rather than
stacks, so a purchase or a transfer while it is open cannot invalidate it, and it is authoritative
state: closing the game with a draft open finds it waiting. A preview is the commit run against a
copy of the assets, so the player cannot be shown one result and given another.

A change that could not physically exist - a module in a slot the hull lacks, a charge in a weapon
that does not take it - is refused when it is made, naming the constraint it breaks. A fit that
merely over-commits the power grid is allowed to exist and blocks undocking instead, which is what
the functional specification asks for.

Every ship statistic comes from one pipeline (`src/engine/domain/attributes`): the hull's base
value, then flat modifiers, then fitted percentages diminished by direction at 100/87/57/28/10%,
then undiminished hull, ammunition and self-operation effects, then the clamps. Content declares
modifiers; it never declares an expression, and the three reviewed operators (`add`, `percent`,
`resistance`) are the only arithmetic a modifier can ask for. Each derived value travels with the
trace that produced it, so the interface can explain a number instead of asserting it.

Protocol version 7 exposes `ship.get`, `ship.undockValidity`, `fitting.draft`, `fitting.begin`,
`fitting.set`, `fitting.clear`, `fitting.revert`, `fitting.commit` and `item.compare` alongside the
inventory, market, repair, resupply and insurance contracts, the navigation queries and orders, and
the authored content catalogue.

Campaign state and save format are version 5. Previous development saves are rejected without
modification; start a new campaign after upgrading. No pre-release migration is required by the
MVP plan. The migration runner remains covered by fixture registries, and the older format fixtures
are retained to verify rejection. See `docs/agent-comm/status/` for the per-phase handoffs.

## The station

While docked, the persistent frame carries what is true wherever the player is - pilot, station,
wallet, the simulation clock and its pause control, the save state - and the station hub presents
each service as its own tile rather than as rows of one table: market, hangar, fitting, services and
ship.

Nothing on those screens is authoritative. A price came out of the quote service, the modules a slot
offers came out of the fitting projection, and every value travels with the calculation that
produced it, so a screen can explain a number instead of asserting it. Every economic action goes
through the same preview and confirmation: the engine binds a preview to the state it was calculated
from, the interface hands that token straight back, and a preview the campaign has moved past comes
back with its replacement and has to be confirmed again.

`src/ui/actions/registry.ts` defines each action once - id, label key, icon, default shortcut,
remapping category - and buttons, tiles, tabs and the keyboard handler all read the same entry.
Whether an action can be taken is never decided there: availability and its reason come from a
projection, and an unavailable control stays visible and says why. One runner keeps any control from
submitting its command twice.

The interface resolves authored text through the engine: projections carry message keys, and
`content.messages` hands over the locale's catalogue so the interface never reaches past the engine
into the content bundle. Simulation time advances because the main thread measures elapsed real time
and sends it; the clock the frame shows is the one the engine answered with.

## Leaving the station

Choosing a combat site marks it as the destination; it does not move the ship. The player undocks at
the station site, gives the ship orders, warps to the encounter, and warps back and docks - which is
what makes retreat mean something.

The schematic view is two-dimensional and deliberately plain. The engine publishes world coordinates
in kilometres and the renderer applies the camera; zoom changes display scale and nothing else. The
layers are fixed - background, range overlays, intent, objects, labels, off-screen markers,
interaction targets - and every semantic state carries a shape as well as a colour, so the view
reads in a high-contrast theme. Between two authoritative frames the drawing carries each object
along its published velocity for at most a quarter of a second; that is presentation, it is off
while the game is paused or reduced motion is asked for, and no number the player reads comes from
it.

The drawing is one labelled image. The list beside it is what selection actually works through, so
the site is reachable with the keyboard alone, and the selected object announces itself rather than
being implied by a highlight.

Whether an order can be given is a rule, so the engine decides it. `navigation.site` and
`navigation.destinations` carry, for each subject, which commands it offers and the message the
refused ones would answer with; the command bar pairs that with a registry entry and shows a
disabled control with its reason rather than hiding it. The same predicates run inside the command
handlers, so the two cannot disagree. The ranges and arrival distances the orders offer are authored
in `content/rules/navigation.json`.

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
