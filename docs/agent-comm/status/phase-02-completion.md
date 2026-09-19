# Phase 2 completion note — Content compilation and shared primitives

Status: complete. Date: 2026-09-19.

This note records what the next session inherits. It does not define the game; see
`docs/MVPImplementationPlan.md` §4 Phase 2 for the scope this implements.

## Exit gate

All of the following pass from a clean checkout after `npm install`:

- `npm run typecheck`, `npm run check:architecture`, `npm run validate:content`
- `npm run test:unit` (300 tests), `npm run test:integration` (16), `npm run test:component` (10)
- `npm run traceability` (42 requirement ids, all covered), `npm run build`
- `npm run test:browser` (4) and `npm run test:accessibility` (3), after
  `npx playwright install chromium`

`npm run verify` chains everything except the two Playwright suites.

The specific gate items:

- **Schema failures identify file and JSON path.** Every diagnostic carries the repository-relative
  file and the JSON path of the offending value, for example
  `content/catalog/hulls/independent.json definitions[0].signatureRadiusMetres`.
- **Semantic fixtures cover duplicate and unresolved ids and the MVP catalog relationships.**
  `tests/fixtures/content/minimal` is a complete, minimal valid pack; each negative test changes
  one thing in it (`tests/unit/content/semanticValidation.test.ts`, 25 cases).
- **Canonical output is stable across input order.** Compiling the same pack with the files
  reversed, or with definitions authored in another order, produces identical canonical bytes and
  an identical digest.
- **Development startup, test startup and production build all reject invalid content.** Verified
  by running each against a deliberately broken pack, and by
  `tests/unit/content/buildIntegration.test.ts`, which also asserts that every build configuration
  installs the plugin — including the separate worker build.

## What exists now

- **Shared primitives** under `src/shared`: branded namespaced definition ids; canonical numeric
  guards, units and conversions (`cubicMetresToCubicDecimetres`, `secondsToMilliseconds`); the
  clamping and final-step rounding of Functional Specification 4.1-4.2; stable, locale-independent
  ordering and indexing; the canonical JSON profile; and SHA-256.
- **Content schemas** under `schemas/content`: `common` plus one schema per content kind
  (`manifest`, `rules.time|combat|economy`, `hulls`, `modules`, `ammunition`, `items`, `systems`,
  `stations`, `market.listings`, `npc.profiles`, `loot.tables`, `encounters`, `localization`), and
  `bundle.schema.json`, which is the contract for the compiled artefact.
- **The content compiler** in `scripts/lib/content`, used by `npm run validate:content`, by
  `config/contentPlugin.mjs` (development server, test run, production build) and by the tests. It
  parses within the structural limits of Technical Specification 14, schema-validates by declared
  kind, runs the cross-file semantic pass, canonicalises, and derives `contentHash` and
  `contentVersion`.
- **The content port** (`src/engine/ports`) and its adapter (`src/adapters/content`). The adapter
  bounds the bundle, verifies its digest against its canonical bytes, converts authored cubic
  metres to canonical units, indexes every definition by stable id and freezes it in development.
- **Protocol contracts**: `content.summary`, the `CONTENT_ERROR` reason vocabulary shared by the
  build and the engine, and the `ContentIssue` shape, with schemas for both.
- **Seed content** under `content/`: one player-usable hull, two NPC hulls, seven modules, four
  ammunition types in two groups, three items, one system with a station site and three combat
  sites, one neutral-access station with its market, four NPC profiles, three loot tables and the
  three MVP encounters. Tuning values are provisional; Phase 17 owns balance.

## Decisions a later phase may want to revisit

1. **The engine host now requires a content repository.** `createEngineHost({ content })` has no
   default. The worker passes the compiled bundle; a test passes the shipped content
   (`tests/support/content.ts`) or a compiled fixture pack
   (`tests/support/contentFixtures.ts`). An optional port would have let a later phase depend
   silently on the empty case.
2. **Protocol version stays 1 while request types are added.** `system.capabilities` reports the
   accepted types, so a client discovers what a host answers. The version increments when a
   payload or response shape that has shipped changes incompatibly. If a client ever ships before
   the protocol settles, revisit this.
3. **`src/shared` uses explicit `.ts` import specifiers** (`allowImportingTsExtensions`), so Node
   can import those modules directly and the build tooling shares the engine's canonical JSON,
   id rules and unit conversions instead of duplicating them. Only `src/shared` is written this
   way; the rest of the tree still uses extensionless imports. Extending the style further would
   let the tooling reuse more engine code, at the cost of consistency with the existing files.
4. **The compiled bundle reaches the process as a virtual module**
   (`virtual:galactic-soup/content-bundle`, declared in `config/packages.mjs`). The content adapter
   therefore never reads a file system and stays headless. A future Java engine reads the same
   bundle shape from `schemas/content/bundle.schema.json`.
5. **The load-time guard does not re-run the schemas.** It bounds the structure, checks the digest
   and converts units; the digest establishes that the bundle is the artefact the build validated.
   If bundles ever arrive from somewhere other than this build, that reasoning no longer holds.
6. **Canonical number formatting is pinned by fixtures, not by a proof.** Shortest round-trip
   digits, expanded to plain decimal. Java 19+ produces the same digits;
   `tests/fixtures/canonical/profile.json` is the corpus a second implementation must reproduce.
7. **An NPC profile carries one ammunition type.** The semantic pass rejects a loadout whose
   turrets belong to different ammunition groups. That is a simplification, not a rule from the
   functional specification; a later phase that wants mixed loadouts will need per-weapon
   ammunition in the NPC profile schema.

## Notes for the next phase

- Phase 3 owns the campaign aggregate, the clock, the scheduler and deterministic randomness. The
  canonical JSON profile and SHA-256 it needs for authoritative-state hashing already exist in
  `@shared`; `contentVersion` and `contentHash` are ready for the snapshot Phase 4 writes.
- `content/rules/*.json` holds only the constants the MVP formulas name directly. Each gameplay
  phase should add the values it owns to the matching group and extend the rule schema and the
  `RulesContent` types in the same change.
- The MVP content floor is asserted in `tests/unit/content/shippedContent.test.ts` against the MVP
  acceptance ids. Those tests check scope commitments, not balance, so Phase 17 can retune freely
  as long as the catalogue still offers more than one viable approach.

## Open questions for the human operator

None.
