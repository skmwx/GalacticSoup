# Phase 1 completion note — Application, worker and test spine

Status: complete. Date: 2026-09-19.

This note records what the next session inherits. It does not define the game; see
`docs/MVPImplementationPlan.md` §4 Phase 1 for the scope this implements.

## Exit gate

All of the following pass from a clean checkout after `npm install`:

- `npm run typecheck`, `npm run check:architecture`, `npm run validate:content`
- `npm run test:unit` (105 tests), `npm run test:integration` (12), `npm run test:component` (9)
- `npm run traceability`, `npm run build`
- `npm run test:browser` (3) and `npm run test:accessibility` (3), after
  `npx playwright install chromium`

`npm run verify` chains everything except the two Playwright suites.

The specific gate items: the direct and worker-dispatcher transports return identical responses for
the same requests and the same malformed messages; malformed messages return stable
`INVALID_REQUEST` errors instead of throwing across the boundary; the engine imports and answers in
a plain Node environment with no DOM globals; the component, browser-boot and production build
checks pass. The production build emits the engine as its own worker chunk, so no engine module is
linked into the interface bundle.

## What exists now

- Protocol version 1 with the versioned envelope, transport-value rules, error model and two
  requests: `system.health` and `system.capabilities`. There is no campaign, command or snapshot
  contract yet, by design.
- A headless engine host, its worker dispatcher, the worker gateway, and test-only in-process and
  `MessageChannel` gateways that host the same engine through the same dispatcher.
- A minimal shell that reports the engine handshake, and a blocking compatibility surface used when
  the worker cannot be hosted. No gameplay state lives in the interface.
- Localization-key lookup with named-parameter formatting, and an English catalogue that a unit test
  keeps in step with every message key the protocol and gateway can emit.
- `config/packages.mjs` as the single source of truth for package boundaries, build aliases and
  TypeScript paths, enforced by `scripts/check-architecture.mjs` and by the unit suite.

## Decisions a later phase may want to revisit

1. **Every strict TypeScript flag is on**, including `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`. The last of these means a
   dictionary-typed lookup must use bracket syntax: CSS-module classes are written
   `styles['panel']`, not `styles.panel`. Keep new interface code in that form.
   TypeScript 7 removed `baseUrl`, so the package aliases in `tsconfig.json` are declared as
   tsconfig-relative `paths` only.
2. **Runtime protocol validation is hand-written**, with the JSON Schemas in `schemas/protocol` held
   to the same verdicts by a parity test. This keeps the engine free of a validation library while
   leaving a language-independent contract for a future Java engine.
3. **The engine version is independent of the package version** (`src/engine/application/version.ts`).
   It identifies the rules implementation and will be written into campaign snapshots; bump it when
   engine behaviour changes in a way a save must know about.
4. **CSS-module class names are still not verified against the stylesheet.** A typo compiles and
   renders unstyled. Generating a declaration file per `.module.css` would make it a compile error;
   that belongs with the presentation hardening in Phase 19 unless it becomes a nuisance sooner.

## Toolchain

Node 24.21 / npm 12, with Vite 8 (Rolldown), Vitest 5, TypeScript 7, React 19 and Playwright 1.63,
all pinned to exact versions. The project was scaffolded on Node 22.4, which could not run Vite 8;
the operator upgraded Node and the toolchain was moved to the current line in the same phase, with
the full gate re-run afterwards.

## Open questions for the human operator

None.
