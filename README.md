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
return immutable view models. Swapping the worker transport for a network transport, or the
TypeScript engine for a server, must not require changing interface components.

`config/packages.mjs` declares the package boundaries and is the single source of truth for the
build aliases, the TypeScript paths and the architecture check. Cross-package imports go through a
package alias (`@protocol`, `@engine`, `@gateway`, …), which always resolves to that package's
public index.

```text
src/
  app/        bootstrap and top-level composition
  ui/         React views, SVG renderers, localization, styles
  gateway/    transport-independent client API (plus test-only in-process gateways)
  protocol/   versioned envelope, request catalogue, error model
  engine/     headless authoritative engine
    ports/    interfaces the engine owns and adapters implement
  adapters/   worker host and message dispatch, content loading
  shared/     dependency-free primitives
content/      authored game data: rules, catalog, universe, economy, encounters
schemas/      JSON Schemas for the protocol and for content (saves follow)
tests/        unit, integration, component, browser and accessibility levels
scripts/      architecture, content and traceability checks
```

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
