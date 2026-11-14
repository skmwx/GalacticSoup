# ADR-V02-01: v0.1 to v0.2 save compatibility boundary

**Status:** accepted for v0.2 (Combat Progression Alpha). **Date:** 2026-11-14. **Phase:** v0.2 implementation plan, phase 0.

## Context

Technical Specification 11.4 requires a migration path from every publicly released save version. The v0.2 feature brief (`human-input/Features-v02.md`, "Saves migration") says that being incompatible with old saves is acceptable during this early phase. FeatureSpec02 section 10 turns that into a requirement: v0.2 does not migrate v0.1 saves, and it refuses them safely.

v0.1 wrote save formats up to 10 and campaign state version 10. Before this decision the loader accepted a save written against different content whenever every definition it named still resolved. That rule alone could have let a v0.1 save load into v0.2 rules.

## Decision

1. **Explicit boundary.** v0.2 writes save format 11 with campaign state version 11. `OLDEST_SUPPORTED_SAVE_FORMAT_VERSION` is 11 (`src/engine/ports/persistence/saves.ts`).
2. **Refused first.** A save below format 11 is refused with the `earlierRelease` load error, which names release 0.1. The check runs before checksum validation, migration, and content checks, so the save is never migrated and never judged by whether its IDs resolve.
3. **Nothing destructive.** The refused snapshot stays in storage unchanged. Nothing is deleted, partly loaded, or replaced by a new campaign. The start screen says the save cannot be continued and does not offer Resume. Starting a new campaign over any saved one now asks for confirmation; the existing in-game reset still needs its own confirmation.
4. **Declared content transitions.** The content manifest declares `compatibleContentVersions`. A save whose content hash differs from the installed bundle opens only if its authored content version (the part of `contentVersion` before `+`) is declared, and the bundle's own version always is. The v0.2 content is `0.2.0`; `0.1.0` is deliberately not declared. Saves made during v0.2 development keep opening across balance changes, because they share the authored version `0.2.0`.
5. **Versions.** Engine `0.2.0`, protocol 19, save format 11, campaign state 11, content `0.2.0`. The application package version moves to 0.2 with the release metadata in phase 7.

## Scope

The exception covers only the v0.1 to v0.2 transition. It removes the obligation to write migrations for formats 1-10. It does not remove schema validation, checksums, bounded parsing, transaction safety, autosave recovery, current-version (v0.2) replay and golden fixtures, or the refusal of newer unsupported formats. From format 11 onward the migration registry is the compatibility path again unless a later decision record declares another boundary.

## Consequences

- Players of v0.1 start a new campaign in v0.2. The release notes must say so (phase 7).
- `tests/fixtures/saves/format-1.json` to `format-10.json` remain as rejection fixtures. `format-10.json` is the representative v0.1 save, and tests check that it is refused byte-for-byte unchanged.
- The current golden save fixture is `format-11.json`, and the golden campaign saves are re-recorded at format 11.
- Technical Specification 5.1, 11.4, 18, and 19 now describe compatibility boundaries. Functional Specification 3.4 is unchanged in this respect.
