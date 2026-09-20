# Phase 7 completion note — Local station economy

Status: complete. Date: 2026-09-20.

Implements Phase 7 of `docs/MVPImplementationPlan.md`. Station-side economic actions now work
headlessly through the same engine host over both direct and channel transports. The player-facing
station screens remain Phase 8 work.

## Delivered

### Persisted station economy and hourly processing

Each authored station now has a campaign-owned economy overlay containing service availability and
version, plus listing stock, fractional production/consumption accumulator, last processed
simulation hour, event factor, and quote-relevant version. Fixed recovery listings retain unlimited
non-scarce supply; dynamic listings clamp hourly stock from zero to twice target.

Campaign creation schedules the first `economy.hour` boundary. Its registered resolver catches up
each listing at the authoritative simulation hour, carries fractional production between
boundaries, invalidates market projections only when a quote changes, and schedules the next hour.

The quote service implements the Functional Specification 11.1 scarcity, mid-price, and spread
formulas with whole-credit per-unit rounding. Bulk quotes produce the same total and final virtual
stock as literal one-unit-at-a-time execution while grouping ranges whose rounded price is fixed.
Every displayed quote contains its substituted operands, unrounded result, and displayed result.

### Atomic preview/confirm transactions

The following query/command pairs are available:

| Preview query | Confirmation command | Mutation |
|---|---|---|
| `market.previewBuy` | `market.confirmBuy` | Debits credits, moves station stock, and adds an item to a local hangar/cargo hold or creates a purchased hull. |
| `market.previewSell` | `market.confirmSell` | Removes a local plain-item stack, preserves proportional acquisition provenance, moves station stock, and credits the wallet. |
| `repair.preview` | `repair.confirm` | Charges the displayed formula and restores shield, armor, and hull in one transaction. |
| `resupply.preview` | `resupply.confirm` | Fills compatible fitted magazines from owned local ammunition first, then buys only the shortfall. |
| `insurance.preview` | `insurance.confirm` | Charges 15% of hull reference value and persists enhanced 70% coverage for that ship. |

Purchased hulls are independent ship aggregates with their own cargo and fitting inventories, full
starting condition, and free basic insurance. Market buy/sell confirmations and resupply
confirmations that purchase ammunition request an autosave. Owned-ammunition-only resupply, repair,
and enhanced-insurance purchase do not add triggers absent from Functional Specification 3.4.

Every command is one campaign transaction: a failed capacity, stock, funds, locality, or service
check changes neither side. Successful changes invalidate the wallet, inventory, ship, fitting, and
station-economy projections that can be affected. Command request IDs remain idempotent through the
engine host cache, so resending a confirmation cannot transact twice.

### State-bound preview tokens

An available preview carries the action, canonical input parameters, campaign revision for tracing,
relevant persisted entity versions, and a hash of the calculated preview values. Confirmation
parses the canonical parameters from the token and recomputes the entire preview from current
authoritative state.

The comparison uses the action, parameters, relevant versions, and values hash rather than the
global revision alone. A relevant wallet, inventory, ship, service, or listing change returns
`STALE_PREVIEW` with a fresh replacement preview. An unrelated revision does not force the player
to reconfirm an unchanged result.

### Projections and contracts

New immutable projections expose:

- `station.services`: docked state, service modifier, availability, and unavailability reasons;
- `market.listings`: local stock, both quote sides, and formula traces;
- buy/sell previews: average and edge prices, total, stock and cargo effects, and reasons;
- repair, resupply, and insurance previews with exact costs, resulting values, and traces.

Protocol, campaign-state, and save-format versions are **4**. Runtime validation and JSON schemas
cover all new requests, preview tokens, projections, stale-preview replacements, station economy,
asset versions, and per-ship insurance. `tests/fixtures/saves/format-4.json` is the new golden save.
The pre-release format-1 through format-3 fixtures remain explicit rejection cases; no released
format needs a migration.

## Exit gate

All checks passed:

- `npm run verify`: type checking, architecture boundaries, content validation, **733 unit tests**,
  **64 integration tests**, **20 component tests**, traceability, and production build.
- `npm run test:browser`: **11 tests**, including the real worker and IndexedDB save path.
- `npm run test:accessibility`: **7 tests**.
- Traceability: **79 requirement IDs**, all covered by tests.

Economy tests cover exact quote formulas, fixed recovery supply, optimized/literal bulk equivalence,
fractional hourly stock, repair, owned and purchased resupply, insurance, hull ownership, capacity
refusal, provenance conservation, stock and credit movement, stale replacement previews, duplicate
confirmation, both transports, and quote/ownership/insurance preservation through save and resume.

## Handoff to Phase 8

- Build station presentation from `station.services`, `market.listings`, and the transaction preview
  projections; the UI should format the supplied traces rather than reconstruct formulas.
- On `STALE_PREVIEW`, replace the displayed confirmation with `replacementPreview` and require a new
  confirmation.
- Route an economic command result with `autosaveRequested: true` through the same save trigger
  handling used by campaign commands.
- Reuse `item.inspect` and `item.compare` for market and hangar detail instead of adding another item
  comparison path.
- Insurance settlement and consumption occur on destruction and remain assigned to Phase 15.
- Remote quotes, price-history UI, trade progression, and regional event presentation remain outside
  this MVP phase.

No open questions or new dependencies.
