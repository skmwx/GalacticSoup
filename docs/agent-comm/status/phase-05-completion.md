# Phase 5 completion note — Wallet, assets, and inventory domain

Status: complete. Date: 2026-09-20.

Implements Phase 5 of `docs/MVPImplementationPlan.md`. This is the headless foundation for
MVP-AC-02 and MVP-AC-06; their complete player flows remain assigned to later phases.

## Delivered

- `src/engine/domain/assets` defines ship identity, docked location, inventory IDs, capacity
  policies, item stacks, acquisition provenance and wallet operations.
- Campaign creation reads the starting wallet, station, hull and item grants from validated
  economy content. The shipped state has 20,000 credits, one unfitted starter hull, empty cargo,
  and a local hangar with one basic autocannon, one shield booster and 20 compatible charges.
  Existing catalog definitions supply these assets; no additional hull or item definitions were needed.
- The inventory service is the only writer of physical stacks and their locations. Split, merge,
  transfer, reserve, release, insertion and capacity changes operate on private drafts and commit
  together. A failure preserves quantities, locations, provenance and entity ordinals.
- Reservations move units into explicit inventories owned by a live ship. Reserved units continue
  to count against their source capacity. Player inventory commands cannot access those stores.
- Whole cubic-decimetre volumes support exact capacity and maximum-that-fits calculations.
  Station hangars are unlimited within the canonical safe-integer representation. Cargo rejects
  the entire requested transfer when it does not fit; nothing is silently discarded.
- Granted and purchased quantities are recorded separately, with total purchased acquisition
  credits. Splits apportion purchased units and cost deterministically, retaining the remainder at
  the source; merges sum those records. Local bigint intermediates prevent multiplication loss,
  while every stored and transported value remains an ordinary safe integer.
- Transfers, splits and merges run through the command pipeline, including locality checks,
  revision validation, duplicate suppression, events and projection invalidations. Campaign
  create/resume/close/reset also invalidate the new asset, inventory and wallet topics.
- Immutable queries expose assets, wallet, hangar, cargo, item inspection and maximum quantity.
  No station screen or fitting authority was added in this phase.

## Contracts and persistence

Protocol, campaign-state and save-format versions are all **2**. New requests:

| Request | Purpose |
|---|---|
| `assets.list` | Owned ships, inventories, location and wallet |
| `wallet.get` | Current credits |
| `inventory.hangar` | Hangar at a specified station |
| `inventory.cargo` | Cargo of a specified owned ship |
| `item.inspect` | Physical stack, item details, provenance and location |
| `inventory.maximum` | Available source quantity that fits the destination |
| `inventory.transfer` | Atomic local transfer |
| `inventory.split` | Separate part of a local stack |
| `inventory.merge` | Merge compatible local stacks |

Schemas, runtime validators, localization keys, invariants and the golden save were updated
together. `tests/fixtures/saves/format-2.json` uses the minimal fixture catalog and synthetic
content identity, so normal balance tuning does not rewrite the golden contract.

The loader checks every saved definition even when content hashes match. Full validation checks
entity namespaces and ordinals, references, ship/cargo ownership, active-ship location, capacity,
reserve relationships, whole non-negative values and provenance totals. The save service refuses
an invalid campaign before writing and preserves the previous valid snapshot.

No public save version exists, so the migration registry remains empty under MVP plan section 2,
rule 7. Format-1 development saves are rejected unchanged and require a new campaign. The old
golden fixture remains as a rejection case. Fixture registries still exercise migration chaining,
purity and loading through a version transition.

## Exit gate

All checks passed:

- `npm run verify`: type checking, architecture boundaries, content validation, **623 unit tests**,
  **51 integration tests**, **20 component tests**, traceability and production build.
- `npm run test:browser`: **11 tests**, including real worker/IndexedDB persistence of starting
  assets through close/reopen.
- `npm run test:accessibility`: **7 tests**.
- Traceability: **68 requirement IDs**, all claimed implemented requirements covered.

Inventory property tests run 80 deterministic seeds with 40 operations each. They check per-item
quantity and acquisition-credit conservation, one location, legal capacity, valid references and
unchanged state on failures after every operation. Targeted cases cover exact-fit boundaries,
overflow, mixed provenance, reserved capacity, capacity reduction and non-negative wallet changes.

Integration tests exercise both direct and structured-clone worker-dispatch transports, including
queries, stale commands, duplicate transfers, split/merge, save/reopen and matching replay hashes.
Persistence fixtures cover reservations and purchased provenance as well as malformed ownership,
missing content, reserve cycles, overfull cargo and rejected old saves.

## Handoff to Phase 6

- Assemble the starting fit from the existing hangar assets through the inventory service.
  Add fitted locations/instances and loaded ammunition with matching schemas and invariants;
  do not duplicate physical units into fitting state.
- `inventoryService.setCapacity` can apply a derived cargo capacity atomically. It refuses a
  reduction below the volume already occupied, including reservations.
- Current stack state is `plain`; future operational/configured state must extend compatibility
  and persistence together. Recovery restrictions remain Phase 15 work.
- Wallet helpers are domain-only. Future economic handlers must combine their changes with item
  mutations in one campaign transaction and publish the corresponding invalidations.
- Starter catalog values remain provisional. Mining/scanner grants, skills and other deferred
  systems were not introduced.

No open questions or new dependencies.
