# Galactic Soup Technical Specification

## 1. Purpose and authority

This document defines how the complete functionality of Galactic Soup is implemented. It specifies the runtime architecture, module boundaries, data representation, simulation model, persistence, content pipeline, user-interface implementation, validation, testing, and operational constraints for the full game.

The authority order is:

1. `human-input/GameConcept.md`
2. `GameDesignBrief.md`
3. `FunctionalSpecification.md`
4. this technical specification

This document must not change player-visible rules defined above it. Where this document and a higher-authority document conflict, the higher-authority document wins and this document must be corrected. Balance values, content quantities, delivery phases, and current implementation status remain outside this document unless they are needed to define a data shape or technical invariant.

The choices below define the target architecture. Current-state documents record which parts have been implemented and any temporary delivery constraints.

## 2. Technical goals and constraints

The implementation must:

- run entirely on the player's device with no required server or network connection during play;
- use TypeScript, HTML, CSS, and SVG for the shipped client;
- keep UI, commands, engine, and persistence as strict, testable layers;
- make the engine independent of the DOM, browser rendering, React, and browser storage APIs;
- store all campaign progress locally and support portable export and import;
- advance the campaign only from an explicit simulation clock, never from elapsed wall-clock time while closed;
- keep rules and balance data human-readable and outside engine source code;
- support deterministic reproduction of a saved state and command sequence;
- make a future move of the authoritative engine and persistence to a Java server possible without replacing the UI or redefining game commands;
- remain understandable and maintainable when the codebase is produced primarily by coding agents.

Correctness, save integrity, and explainability take precedence over rendering throughput. No optimization may duplicate authoritative state or move game rules into the UI.

## 3. Platform and toolchain

### 3.1 Application form

The game is a single-page browser application distributed as static files. A production build contains all executable code, content, fonts, icons, audio, and schemas needed to play. It makes no gameplay network requests.

The application uses:

- TypeScript in strict mode for application and engine code;
- React with TSX for HTML user-interface composition;
- SVG elements for the space view, system map, galaxy map, tactical overlays, and schematic icons;
- CSS custom properties and CSS modules for layout, themes, scaling, contrast, and reduced-motion behavior;
- a dedicated Web Worker for the authoritative engine;
- IndexedDB for campaign saves and generated history data;
- `localStorage` only for small, non-campaign preferences such as volume, UI scale, key bindings, and the last selected slot;
- JSON for authored game data and JSON Schema for validation;
- Vite for local development and production bundling;
- Vitest for unit, property, and integration tests;
- React Testing Library for component behavior;
- Playwright for browser-level acceptance and accessibility flows.

Dependency versions are pinned by the lockfile. Upgrading a dependency is a deliberate change accompanied by the relevant automated test suite. Runtime game rules must not depend on library-specific behavior when a small platform-independent implementation is practical.

IndexedDB is the campaign form of browser-local storage. It is used instead of placing campaigns in the `localStorage` key-value API because the full game requires multiple rolling snapshots, price history, and exportable saves that can exceed common `localStorage` quotas.

### 3.2 Browser support and offline operation

The implementation uses web standards supported by current desktop versions of Chromium-based browsers and Firefox. Exact supported browser versions and device classes are release targets defined in the applicable current-state document.

The production build is installable as a progressive web application. Its service worker precaches the versioned application shell and complete content set. After the first successful installation or load, the game starts and plays without a network connection. A downloaded standalone distribution may serve the same static build through a bundled local launcher.

The service worker never caches campaign state. Application updates activate only after the player returns to the main menu and accepts the update. The old application bundle remains active for the current session so that engine code and loaded content cannot change during a campaign session.

## 4. Architectural model

### 4.1 Layers and dependency direction

The runtime is divided into these layers:

```text
React / SVG UI
      |
      | commands, queries, view events
      v
Client gateway and protocol contracts
      |
      | structured-clone messages today; network transport later
      v
Application command/query handlers
      |
      v
Domain engine and simulation systems
      |
      | persistence port, content repository port
      v
Browser adapters: IndexedDB, files, static content
```

Dependencies point downward. The domain engine may depend on shared primitive types and ports, but never on UI components, React state, SVG nodes, IndexedDB, `window`, `document`, wall-clock timers, or file-download APIs.

The following rules enforce the boundary:

1. UI code cannot import mutable domain state or an engine system.
2. Every state-changing player action is represented by a command and handled by the engine.
3. Queries return immutable, serializable view models rather than domain objects.
4. Engine code reaches persistence and content only through declared interfaces.
5. Persistence stores snapshots supplied by the application layer; it does not infer or repair game rules.
6. A UI animation may interpolate a published position but cannot feed the interpolated position back into the simulation.

### 4.2 Runtime processes

The browser main thread owns the UI, audio, file import/export dialogs, and service-worker coordination. The engine worker owns the open campaign, simulation clock, random-number state, scheduler, command execution, view-model projection, and save orchestration.

The main thread communicates with the worker through a typed request/response protocol. Worker messages use the JSON-compatible subset of structured-clone data: plain objects, arrays, strings, booleans, finite numbers, and null. Protocol payloads do not use `undefined`, `bigint`, `Map`, `Set`, `Date`, typed arrays, callbacks, class instances, DOM objects, or shared mutable references.

If a worker cannot start, the game presents a blocking compatibility error. It does not fall back to running an authoritative engine inside UI components.

### 4.3 Source layout

The repository uses feature folders within stable package boundaries:

```text
src/
  app/                 application bootstrap and top-level routing
  ui/                  React views, SVG renderers, input and accessibility
  gateway/             local worker client and transport-independent client API
  protocol/            command, query, response and event contracts
  engine/
    application/       command handlers, query handlers, transactions
    domain/            campaign aggregates, value objects and rules
    simulation/        clock, scheduler and ordered systems
    projections/       domain-to-view-model builders
    ports/             persistence and content interfaces
  adapters/
    worker/             worker host and message dispatch
    persistence/       IndexedDB and export/import implementations
    content/           JSON loading, indexing and schema validation
  shared/              dependency-free utilities and branded primitives
content/
  rules/               grouped tunable constants
  catalog/             items, hulls, modules, ammunition and skills
  universe/            regions, systems, sites, stations and gates
  economy/             listings, goods, recipes and facility data
  factions/            factions, relations and standing content
  encounters/          NPC profiles, encounter and anomaly definitions
schemas/                JSON Schemas for content, protocol and saves
tests/
  fixtures/             minimal content packs and golden saves
  acceptance/           functional-specification scenarios
```

A feature may expose a small public index. Cross-feature imports must use that public API. Circular imports are prohibited and checked in continuous integration.

## 5. Shared technical conventions

### 5.1 Identifiers and references

Authored definitions use stable, namespaced string IDs such as `hull.independent.starter` and `skill.navigation.core`. IDs are never derived from display names or array positions. Saved entities use opaque IDs generated by the engine from the campaign namespace and a persisted monotonic entity ordinal. ID allocation participates in the surrounding transaction so a failed command does not consume an ordinal.

TypeScript uses branded types for definition IDs, entity IDs, campaign IDs, inventory IDs, request IDs, simulation timestamps, and revisions. At runtime they serialize as strings or numbers. Every authored reference is validated at build time, and every saved reference is validated at import or migration time.

Renaming a shipped definition requires either retaining its ID or adding an explicit migration alias. Deleting a definition referenced by an existing campaign requires a save migration.

### 5.2 Canonical units and numbers

Engine code uses these canonical representations:

| Value | Representation |
|---|---|
| Simulation time and duration | integer milliseconds |
| Credits and item quantities | non-negative safe integers |
| Distance | kilometres as an IEEE-754 double |
| Velocity | kilometres per simulation second as a double |
| Angles and angular velocity | radians and radians per simulation second as doubles |
| Cargo volume | integer cubic-decimetre units, with authored cubic metres converted exactly when loaded |
| Hit points and capacitor | finite non-negative doubles |
| Probabilities and multipliers | doubles using fractions internally |
| Standing | double clamped to `[-100, 100]` |
| Content tiers and skill ranks | bounded integers |

All arithmetic inputs must be finite. `NaN`, infinities, negative quantities, unsafe integers, and invalid vector components are rejected at content and save boundaries.

Formula implementations live in named, side-effect-free domain functions. Display rounding lives in projection or UI formatting code. A command handler must use unrounded engine values, then perform only the final floor, ceiling, or nearest-integer operation required by the functional specification.

### 5.3 Collections and ordering

Authoritative logic must not depend on JavaScript object-property order. Entity collections are keyed maps; any iteration that can affect an outcome is sorted by stable ID or scheduler ordinal first. User-facing sort order is explicit in its view model.

Floating-point comparisons use rule-specific tolerances for geometry, never a global approximate-equality rule. Bounds are clamped after each defined operation, not after an arbitrary sequence of operations.

Checksums and deterministic state hashes use one documented canonical JSON profile. Object keys and map entries are ordered lexicographically, set-like collections are ordered by stable ID, order-sensitive arrays retain their semantic order, negative zero is normalized to zero, absent optional fields are omitted, and non-finite numbers are rejected. The UTF-8 byte representation and number formatting have cross-language fixtures so TypeScript and a future Java implementation hash the same canonical values.

### 5.4 Errors

Protocol errors use stable codes with localizable parameters. Required categories are:

- `INVALID_REQUEST` for malformed protocol data;
- `STALE_REVISION` or `STALE_PREVIEW` when relevant state changed;
- `RULE_VIOLATION` with a specific reason such as insufficient credits or unavailable command;
- `NOT_FOUND` for an invalid entity or definition reference;
- `CONTENT_ERROR` for an invalid installed content pack;
- `SAVE_ERROR`, `QUOTA_ERROR`, and `INTEGRITY_ERROR` for persistence failures;
- `INTERNAL_ERROR` for an invariant failure.

Expected rule failures do not throw across the worker boundary. Unexpected invariant failures abort the current transaction, preserve the last good state, write a local diagnostic record, and present a save-integrity message that cannot be hidden.

## 6. Content and game constants

### 6.1 Data-driven content

Definitions for hulls, modules, ammunition, resources, goods, skills, factions, systems, stations, market listings, recipes, NPC profiles, encounters, anomalies, rewards, tutorials, audio-cue mappings, and player-visible balance constants are authored as UTF-8 JSON. Media assets are separate bundled files referenced by stable IDs.

Files are grouped by purpose rather than placed in one global constants file. Examples include:

```text
content/rules/time.json
content/rules/combat.json
content/rules/economy.json
content/rules/persistence.json
content/catalog/hulls/*.json
content/catalog/modules/*.json
content/universe/regions/*.json
content/encounters/templates/*.json
```

Engine source contains structural algorithms and truly structural enums, including the four damage types and command/result discriminators. Values described as tunable by the functional specification belong in content or rule data.

### 6.2 Schema and semantic validation

JSON Schema validates field types, required values, ranges, discriminated unions, and unknown properties. A second semantic validation pass checks cross-file rules that JSON Schema cannot express, including:

- globally unique IDs and resolvable references;
- bidirectional gates with valid destination sites;
- at least one neutral-access station per region and a connected neutral recovery route;
- positive market target stock and legal elasticity/spread ranges;
- valid slot, hardpoint, skill, module, and ammunition relationships;
- faction-relation completeness and values in range;
- recipe inputs, outputs, facilities, and knowledge sources;
- availability of every fabrication raw material;
- reachability of starter/tutorial content with the starter fit;
- no circular skill prerequisite chain;
- encounter rewards and NPC loadouts referencing valid definitions;
- full localization keys and icon references.

Validation runs at development startup, test startup, and production build time. A production build fails on any error. Development diagnostics include the file, JSON path, bad value, and violated rule.

### 6.3 Content compilation

The build produces a canonical content bundle and index. Canonicalization sorts definitions by stable ID and strips authoring-only metadata. The bundle receives a `contentVersion` and SHA-256 hash recorded in every save.

The content repository exposes read-only lookup methods. Loaded definitions are deeply frozen in development. Campaign state stores definition IDs and only the mutable per-campaign data; it does not copy whole item or hull definitions into saves.

## 7. Protocol, commands, queries, and transactions

### 7.1 Message envelope

Every client request uses a versioned envelope equivalent to:

```ts
interface ClientRequest<TPayload> {
  protocolVersion: number;
  requestId: string;
  campaignId?: string;
  expectedRevision?: number;
  type: string;
  payload: TPayload;
}

type EngineResponse<T> =
  | { requestId: string; ok: true; revision: number; data: T }
  | { requestId: string; ok: false; revision?: number; error: EngineError };
```

The same envelope is usable over worker messaging now and HTTP or WebSocket later. Protocol schemas are generated and checked independently from UI types. The gateway hides transport details from UI components.

### 7.2 Command handling

A command is an intent to change campaign state. The application layer processes one command at a time:

1. validate the envelope and payload schema;
2. verify the campaign and any supplied expected revision;
3. authorize the action from campaign state;
4. evaluate all domain preconditions;
5. apply the action to a transaction-local state draft;
6. validate affected invariants;
7. commit state and increment the revision once;
8. publish domain events, projection invalidations, notifications, and any save request;
9. return the result.

Failure before commit leaves campaign state and random streams unchanged. The request ID for a committed state-changing command is retained in a bounded recent-request cache so an accidentally duplicated transport message returns the original result instead of applying twice. A retry must reuse the original request ID.

Command families cover campaign/session, time control, selection-independent ship orders, locks, module operation, inventory, fitting, docking and gates, markets, refining, scanning, planetary management, fabrication, skills, factions/opportunities, saves, settings that affect the campaign, and tutorial state. A new state-changing UI interaction must add or reuse a protocol command; it must not mutate a store directly.

### 7.3 Queries and projections

Queries are read-only and do not consume random numbers, advance time, or change a revision. They return purpose-built view models for the persistent frame, site, selected object, map, station service, market, fitting, assets, skills, factions, jobs, colonies, notifications, event log, and save list.

Frequently changing tactical data is published as revisioned projection frames. Slowly changing screens are refreshed by invalidation topics such as `inventory.changed`, `market.changed`, or `skills.changed`. The UI tracks revisions by projection topic. It discards a response only when a newer response or invalidation for the same topic has already been applied; an unrelated tactical revision does not invalidate a slower screen query.

Expanded formula explanations are engine projections. They contain labeled base values, modifiers in application order, substituted formula operands, unrounded result, and display result. The UI formats and lays them out but never reconstructs the formula.

### 7.4 Previews and confirmations

Any action requiring a preview returns a state-bound preview token containing the action type, canonical parameters, campaign revision for traceability, relevant entity versions, and a hash of the values used. Confirmation resubmits that token. The engine recomputes the action and compares the relevant versions and values, not the global revision alone. If any relevant value changed, it returns `STALE_PREVIEW` with a replacement preview and requires confirmation again.

This mechanism applies at least to market transactions, repair, refining, ship transport, insurance, destructive fitting changes, industry installation or cancellation, skill purchase, planetary construction/movement/demolition, faction consequences, remote purchases, and imported-save overwrite.

The token prevents accidental mismatch but is not a security credential. In the current local application, the engine remains authoritative even if browser developer tools modify UI state.

## 8. Campaign domain model

### 8.1 Campaign aggregate

`CampaignState` is the root of all authoritative mutable game data. It contains:

- campaign identity, display name, creation metadata, revision, and next entity ordinal;
- simulation timestamp, selected time rate, scheduler state, and random streams;
- credits, unspent experience, skills, learned recipes, standings, discoveries, milestones, and tutorial progress;
- active ship ID, most recently docked accessible station, and current location;
- ships, item stacks, inventories, fitting state, loaded ammunition, insurance, damage, capacitor, and active effects;
- current site runtime, NPCs, projectiles, wrecks, containers, bookmarks, unresolved signatures, and resolved anomaly state;
- known systems, sites, services, resources, prices, routes, and market histories;
- station stock, active events, replenishment state, and encountered content state;
- industry jobs, transports, colonies, planetary deposits, customs stores, and daily experience allowances;
- active authored objectives, opportunities, and consequence history;
- notifications, event-log summaries, combat/loss data, and autosave trigger state.

Large immutable definitions remain in the content repository. Historical series and logs may be held in bounded auxiliary records referenced by the campaign, but their deletion must never alter gameplay state.

### 8.2 Entities and aggregates

Mutation is organized around aggregate boundaries:

- **Ship aggregate:** hull reference, fitted modules, cargo inventory, damage, capacitor, movement order, locks, effects, and insurance.
- **Inventory aggregate:** explicit location, capacity policy, and item stacks.
- **Site aggregate:** objects, positions, velocities, encounter state, ownership, timers, and hazards.
- **Station economy aggregate:** stock, production/consumption accumulator, events, quote history, and service state.
- **Industry job aggregate:** committed inputs, fees, timing, facility, output, and delivery state.
- **Colony aggregate:** command capacity, structures, links, routes, stores, deposits, reserved inputs, and pending outputs.
- **Anomaly/objective aggregate:** discovery progress, revealed information, site instance, completion, and rewards.
- **Faction standing aggregate:** direct values, recent changes, unlock state, and reconciliation availability.

Handlers that span aggregates use a single campaign transaction so credits and goods, or destruction and recovery, cannot be partially committed.

### 8.3 Items and inventories

An item stack stores definition ID, whole quantity, location ID, acquisition provenance, weighted acquisition cost where applicable, and state that determines stack compatibility. Modules with individual operational state, loaded ammunition, recovery-grant restrictions, or configuration use individual instances or separate stacks.

Every physical item has exactly one location. Moving an item is one atomic remove-and-add operation. Capacity is checked before removal. The inventory service provides split, merge, reserve, release, transfer, and maximum-that-fits operations and is the only code allowed to change item location.

Industry inputs, processor inputs, weapon ammunition, and other committed items move into explicit reserve locations. Reservations are not flags on items left in a hangar, preventing the same item from being used twice.

### 8.4 Knowledge and remote information

Facts known to the player are stored separately from current world truth. Market knowledge records the last observed quote and simulation timestamp. Surveyed services, resources, faction information, anomaly thresholds, and map discoveries likewise retain what was learned and when.

Remote-information skills schedule knowledge refreshes from current world truth at the rule-defined cadence. A UI query never bypasses knowledge state to reveal undiscovered authoritative data.

## 9. Simulation and time

### 9.1 Authoritative clock

The campaign stores one monotonic `simulationTimeMs`. It changes only while a campaign is open, unpaused, and explicitly advancing at 1x, 2x, 4x, or 8x. The engine never derives it from a saved real timestamp.

The main thread supplies monotonic elapsed-frame deltas to the worker. The worker caps any single real delta at 250 milliseconds, multiplies it by the permitted time rate, and accumulates fixed 50-millisecond simulation quanta. Time for which the browser did not deliver timely deltas, such as while a tab was suspended, is discarded rather than replayed as catch-up. On a visibility or suspension transition, the gateway resets its elapsed-time baseline; the first frame after resumption advances no simulation time. Suspension does not alter the player's selected time rate, and advancement resumes from subsequent fresh deltas.

The engine itself enforces forced reduction from 4x or 8x to 1x. The UI cannot override it. Opening screens does not pause unless the player selects pause.

### 9.2 Scheduler and system order

Long-duration work uses a priority queue ordered by simulation timestamp, event priority, and stable insertion ordinal. Repeating actions schedule the next boundary only after the current boundary resolves successfully. No gameplay timer uses `setTimeout` or `setInterval` as authority.

Each quantum advances in this order:

1. determine the next quantum or earlier scheduled boundary;
2. integrate ship movement, projectiles, capacitor recharge, and shield recharge to that time;
3. evaluate range, visibility, and spatial transitions;
4. resolve already-committed completions due at that timestamp and stage their results;
5. apply staged repair, control, resource, projectile-impact, and damage results in stable order;
6. resolve destruction, objective transitions, rewards, and recovery caused by those results;
7. expire effects after completions at the same timestamp, so an action already in progress wins the tie;
8. start eligible next cycles and reserve their costs;
9. process world, economy, industry, transport, planetary, anomaly, and tutorial boundaries due at that time;
10. evaluate notifications, time-rate restrictions, autosave triggers, and projection invalidations;
11. validate touched invariants and commit the new revision.

All committed completions due at one timestamp resolve even if another due completion destroys their source at that timestamp. Destruction is applied after the completion batch. This prevents entity iteration order from deciding simultaneous exchanges.

Systems with coarse cycles do not iterate through every small simulation quantum. They schedule their next boundary and calculate the exact number of whole elapsed cycles when reached. The result must be identical to resolving each cycle in order, including storage blocks, depletion, hourly stock clamps, and daily limits.

### 9.3 Movement and geometry

Positions and velocities are two-component vectors in site-local kilometres. A ship stores facing separately from velocity. Movement systems implement approach, orbit, keep range, move to point, stop, warp preparation, docking approach, and gate approach as desired-velocity controllers constrained by hull acceleration, braking, maximum speed, and turn rate.

Geometry utilities provide distance, normalized direction, dot product, two-dimensional scalar cross product, radial speed, transverse velocity, and angular velocity. Zero-distance cases use a deterministic separation direction derived from entity IDs and never divide by zero.

Separation is a gentle non-damaging correction applied after normal movement. It cannot push an object through a site transition or make a ship exceed its speed cap. Collision geometry is not used for ordinary weapon interception.

### 9.4 Randomness

The engine uses a documented, platform-portable xoshiro128** pseudo-random generator implemented with unsigned 32-bit operations. A campaign seed creates named streams for world generation/replenishment, combat, loot/survival, economy events, and authored encounters. Each stream's four-word state is persisted.

Only domain functions may request a random draw. Queries, previews, UI rendering, audio, and logging may not. A transaction clones relevant stream state and commits it only with the transaction, so a failed command consumes no randomness.

Random checks record an internal event with stream, draw index, probability or range, and outcome. Normal saves need only retain current stream state and already-materialized outcomes. Development replay logs may retain the full details.

### 9.5 Deterministic replay

Given a content hash, starting snapshot, elapsed simulation deltas, and ordered commands, the engine must reach the same serialized authoritative state. Automated replay tests compare canonical state hashes at checkpoints.

Real creation timestamps, performance measurements, and UI settings are excluded from the authoritative hash. Where future Java floating-point behavior could differ, formula contract tests use shared input/output fixtures and explicit tolerances.

## 10. Gameplay subsystem implementation

### 10.1 Navigation, sites, and world state

The universe repository holds authored regions, systems, gates, and permanent site definitions. Campaign world state overlays discoveries, dynamic anomalies, asteroid depletion, station economies, roaming NPC state, events, and timestamps on those definitions.

Only the current tactical site is simulated at movement/combat granularity. Other locations advance through scheduled aggregate events. A site instance is loaded from its authored definition plus persistent overlay and is unloaded only after a completed warp, gate jump, docking, or destruction recovery transaction.

Warp is a state machine with aligning, preparation, transit, and arrival states. Dock and jump are state machines that retain the requested target and cancellation reason. Arrival concealment is an effect with explicit break triggers checked by command handlers before the requested action begins.

The route service runs Dijkstra's algorithm over known gate connections using a policy-specific edge cost. Avoided systems are removed except when they are the origin or explicitly selected destination. Route previews include the knowledge timestamp used to assess faction hostility and market information.

### 10.2 Fitting and derived attributes

Ship statistics are evaluated by one dependency-aware attribute pipeline:

1. read the hull or base definition;
2. add flat modifiers;
3. group same-attribute fitted percentage bonuses and penalties separately;
4. sort each group by absolute magnitude and apply the functional stacking multipliers;
5. apply undiminished hull traits, skills, ammunition, temporary effects, and self-operation effects in their declared stage;
6. clamp rule-bounded outputs;
7. record a calculation trace.

Modifier definitions declare target attribute, operation, value, stage, condition, and source label. Fitted percentage modifiers affecting the same attribute are diminished together by direction as required by the functional specification; content cannot declare an alternate group to bypass that rule. Arbitrary executable expressions are not allowed in content. A registry of reviewed formula operators implements all permitted effects.

Fitting edits occur in an engine-side fitting draft. The draft references a base revision, returns live previews, and is committed atomically. Closing or reverting discards it. Applying a saved fit is a planner operation that returns exact local allocations and missing items before confirmation.

### 10.3 Targeting, modules, and combat

Lock attempts, active module cycles, reloads, repairs, control effects, and projectile flights are scheduled actions owned by entities. Costs reserved at cycle start are represented explicitly so cancellation and refund behavior follows the functional specification.

Turret, guided-weapon, resistance, layer spillover, repair, capacitor, and lock-time calculations are independent pure functions with shared fixtures taken from the functional formulas. Damage is represented as a four-component vector. For each defensive layer, the engine calculates resisted damage for all four components together. If the total would deplete the layer, it consumes the same proportion of every raw component needed to reach zero hit points and passes the remaining raw vector to the next layer. Damage-type iteration order therefore cannot change the outcome.

NPCs issue the same movement and module commands available to player ships through an AI command adapter. A behavior selector combines authored role priorities, encounter objectives, target scoring, range bands, capacitor state, defense state, and retreat/reinforcement conditions. It receives only information the NPC is defined to know and cannot mutate ship state directly.

The combat recorder keeps a bounded ring buffer of significant events and periodically aggregates routine repeated damage. On player destruction it freezes the interval needed for the loss report, including incoming sources, damage types, layer transitions, control effects, destroyed equipment, survivors, insurance, and recovery result.

### 10.4 Economy and markets

Each station listing stores whole stock, its authored parameters, the last processed simulation hour, current event references, and bounded price-history buckets. The market service advances production and consumption at simulation-hour boundaries and computes quotes from unrounded values.

Bulk buying and selling iterate virtual stock one unit at a time to obtain the required total, but may group consecutive units with the same rounded price for performance. The optimized and literal algorithms must be property-tested for identical totals and final stock.

Price history stores hourly open, high, low, close, and volume buckets. The 24-hour view uses hourly buckets; longer views may aggregate them without inventing observations. Known remote quotes are snapshots of a station's calculated quote, not live references.

Purchased-goods provenance uses weighted acquisition cost in rational credit-total and quantity form. Splits apportion total cost deterministically; merges sum cost totals and quantities. A sale consumes provenance proportionally and grants trade experience only on positive realized purchased-goods profit.

### 10.5 Mining, containers, and refining

Asteroids are site entities backed by a persistent belt-depletion overlay. Mining cycles reserve capacitor but do not reserve asteroid units. At completion, the handler recomputes whole yield, remaining quantity, and cargo capacity, then transfers exactly the delivered amount in one transaction.

Belts store the next replenishment boundary and replenish from data-defined tables without requiring the site to be loaded. Patrol checks use the encounter random stream and simulation time spent operating, with a persisted next-check state.

Jettison creates or adds to an owned container through the inventory service and scheduler. Refining is an instantaneous preview-confirm transaction that calculates outputs, waste, fee, and skill/station modifiers from one revision.

### 10.6 Exploration and authored objectives

A system sweep and signature resolution are scheduled scanner actions. Signature state stores instance ID, source table, expiration time, difficulty, resolution percentage, revealed thresholds, bookmark state, and optionally instantiated site ID. Reward contents not required by a revealed threshold may remain unresolved until their authored trigger.

Anomalies and tutorials use a declarative objective state machine. Supported objective predicates and actions are registered engine operations such as enter site, approach object, destroy group, collect item, scan object, deliver item, show explanation, grant disclosed reward, or complete site. Content cannot execute JavaScript.

Objective definitions are statically checked for unreachable nodes, missing transitions, invalid rewards, and non-skippable tutorial dead ends. One-time rewards store their grant IDs so replayed events cannot grant them twice.

### 10.7 Planetary extraction

Colonies use a graph of structures and links. Route validation confirms connected endpoints, supported item type, direction, and capacity. The colony scheduler processes extractor and processor boundaries in timestamp order, reserving processor inputs at cycle start and retaining blocked output in the producer.

Deposit quantity is authoritative; displayed richness is derived and clamped to its defined range. Regeneration and extraction operate on simulation-time boundaries. Batched catch-up stops at the first boundary where inputs, route capacity, local storage, customs capacity, or deposit yield changes the result, then recalculates.

Remote commands check Planetary Networking range against the active ship's current system and discovered-region state. Import and export remain local inventory transfers at the customs site regardless of remote control access.

### 10.8 Fabrication and transport

Installing a job atomically validates slot capacity, removes inputs into a job-owned inventory, charges the fee, snapshots the promised outputs and relevant result parameters, calculates a fixed duration, and schedules completion. Later skill, standing, facility, balance-data, or content-event changes do not alter that accepted job.

Job cancellation computes the uncompleted fraction from integer milliseconds, floors each returned input independently as required, and destroys the processed share. Completed outputs remain in job output storage until delivered to the same station hangar.

Insured ship transport is implemented as a job with a snapshotted route, fee, and arrival timestamp. Acceptance moves the eligible empty, unfitted ship into transport custody. Arrival moves it to the destination station even if later standing or route state changes.

### 10.9 Skills, factions, progression, and recovery

Skill purchase is an instantaneous academy transaction. Prerequisites are evaluated from already-owned ranks before costs are deducted. Derived attributes and access projections invalidate after commit.

Standing changes are calculated as a complete direct-and-derived set from the pre-action standings. Derived changes never feed further relations. The full set is clamped and committed together, followed by access and service projection updates.

Player destruction is one transaction that materializes a wreck and survival rolls, changes location, pays insurance, consumes enhanced insurance, creates the loss report, checks recovery eligibility, grants restricted recovery assets when necessary, and requests an autosave. Recovery-grant provenance is preserved through split, fitting, removal, and ownership so it cannot acquire sale, refine, input, loot, or insurance value.

## 11. Persistence, saves, and migration

### 11.1 Browser storage

One IndexedDB database contains object stores for:

- campaign-slot manifests;
- immutable save snapshots keyed by campaign, save kind, and sequence;
- bounded market-history and event-log segments;
- content/version metadata;
- save diagnostics and interrupted-write markers.

Each campaign supports five rotating autosaves and one replaceable manual save. Rotation is performed in one IndexedDB transaction: write and verify the new snapshot, update the manifest, then delete the oldest excess autosave. A failed write leaves the previous manifest and saves intact.

The application requests persistent browser storage when supported and shows an actionable warning if quota is low or persistence is denied. A quota failure never deletes an older valid save. The player can export a campaign even when new local snapshots cannot be written.

### 11.2 Snapshot format

A save is a UTF-8 JSON envelope containing:

```text
format identifier and format version
protocol and engine compatibility versions
content version and content hash
campaign and slot identifiers
save kind and autosave sequence
real creation timestamp for display only
simulation timestamp and campaign revision
canonical CampaignState payload
SHA-256 checksum of the canonical envelope fields and payload, excluding the checksum field itself
```

Canonical serialization sorts map keys and definition/entity IDs and normalizes absent optional values. Runtime caches, React state, SVG state, derived projections, and wall-clock deltas are excluded. Required derived indexes are rebuilt and validated on load.

The checksum detects accidental corruption and incomplete copies; it is not presented as protection against deliberate save editing.

### 11.3 Save timing and consistency

An autosave trigger is emitted only after the triggering engine transaction commits. The worker captures an immutable snapshot at that revision and continues simulation while the persistence adapter writes it. A later save may queue, but writes for one campaign finish in revision order and redundant interval saves may coalesce.

Before unload, the game attempts a final safe snapshot only if the current rules permit it, but correctness never relies on browser unload completing. The functional autosave triggers and rolling history are the recovery mechanism.

Real-time five-minute autosaves are driven by a main-thread monotonic play timer only while simulation is advancing. The timer requests a save; it never changes campaign simulation state.

### 11.4 Load, import, and migration

Loading proceeds through:

1. envelope and size validation;
2. checksum validation;
3. schema validation for the stored format version;
4. ordered pure migrations to the current save version;
5. content-version compatibility checks and content-ID migration where declared;
6. cross-reference and invariant validation;
7. derived-index reconstruction;
8. loading into a new worker session;
9. projection generation before the campaign is shown.

Migrations are immutable functions with golden before/after fixtures. Every publicly released save version has a migration path to the current version. A save from a newer unsupported version is rejected without modification. Missing required content produces a precise compatibility error rather than substituting an unrelated item.

The loader compares the save's content version and hash with the installed bundle. A hash mismatch is accepted only when the installed release declares a compatible content transition or provides a migration. Compatible balance-only changes retain entity and definition IDs and adopt the installed values for future calculations. Structural content changes migrate affected campaign state explicitly. An incompatible save is rejected without modification, and the original snapshot remains available. Released content transitions have fixtures covering representative saves that reference changed definitions.

Import first validates into temporary storage. By default it creates a new campaign slot with a new local slot identity while retaining the campaign identity inside the save only when it cannot collide. Overwrite requires an explicit preview and confirmation; the previous slot remains until the imported snapshot commits successfully.

Export uses the `.galacticsoup-save.json` extension and never includes preferences, diagnostics, or unrelated campaigns.

## 12. User-interface implementation

### 12.1 UI state

UI state contains only presentation concerns: open panel, selection, camera transform, hover, filters, sort order, draft text, pending request IDs, and cached immutable projections. Authoritative credits, cargo, damage, positions, timers, market stock, and progress never live only in a React store.

Optimistic updates are allowed only for reversible presentation state. Gameplay results are shown after engine acknowledgement. Controls with a pending command prevent duplicate submission while preserving pause and emergency navigation controls.

### 12.2 SVG views

The space, system, and galaxy renderers share an icon and semantic-color library. The engine publishes world coordinates and visibility; the renderer applies camera pan/zoom and screen-space label layout.

SVG layers are ordered as background/hazards, range overlays, paths and intent, world objects, effects, labels, off-screen indicators, and interaction targets. Visible artwork may be small, but transparent hit targets meet a minimum pointer size. Selection, lock, hostility, ownership, and danger each have shape or icon treatment in addition to color.

At high object counts, labels are culled and compatible background objects may be visually grouped. Selected, locked, dangerous, objective, and player-owned objects are never hidden by grouping. Grouping changes presentation only; commands always target an entity ID.

Animation uses `requestAnimationFrame` to interpolate between authoritative projection frames. Reduced-motion mode disables nonessential interpolation, screen shake, pulsing, and camera easing without changing simulation timing.

### 12.3 Interaction, shortcuts, and accessibility

A central action registry defines the action ID, label key, icon, default shortcut, remapping category, and command handler. Engine projections provide the current availability and unavailability reason for applicable actions. Context menus, command bars, tooltips, and keyboard shortcuts consume the same registry entry and projected availability so UI surfaces cannot diverge or reimplement the rule.

Every frequent action is operable by mouse and by a remappable keyboard shortcut. Continuous key state never steers the ship. Focus order, focus return after dialogs, escape behavior, and screen-reader labels are explicit. Modal confirmations trap focus; non-modal panels do not.

UI scale and text scale are independent CSS variables. High-contrast themes meet WCAG AA contrast for text and meaningful controls. Audio channels provide master, music, effects, interface, and alert levels. Immediate-danger events have both visual and audible representations, while sound may be disabled.

### 12.4 Notifications and audio

The engine emits semantic notifications with category, severity, grouping key, subject IDs, simulation timestamp, and localization parameters. The UI decides placement, duration, and configured visibility. Required save-integrity and ship-destruction messages ignore hide preferences as specified.

Audio is triggered from semantic events on the main thread and never from simulation timing callbacks. Repeated low-priority events are rate-limited by presentation code; this does not suppress their engine log entries.

### 12.5 Localization readiness

All player-visible text uses localization keys and named parameters. Content stores localization keys rather than English embedded in formulas or logic. The initial release may contain one language, but layout must tolerate text expansion and locale-specific number formatting. Save and protocol fields remain locale-independent.

## 13. Performance and resource limits

The reference performance target is a current mid-range desktop at 1920x1080:

- maintain 60 rendered frames per second in ordinary sites and at least 30 in the largest supported authored encounter;
- process one 50-millisecond simulation quantum in under 4 milliseconds at the 95th percentile at 1x;
- keep an 8x catch-up frame under 16 milliseconds at the 95th percentile;
- acknowledge a non-advancing command or query within 100 milliseconds at the 95th percentile;
- open a validated campaign within two seconds for a 25 MB uncompressed snapshot;
- complete routine autosave serialization without blocking the UI main thread for more than one frame.

Content validation defines explicit per-site soft budgets for ships, projectiles, containers, asteroids, labels, and scheduled events. Exceeding a soft budget emits a build warning and requires a performance fixture. It does not silently change game rules at runtime.

Spatial queries use a uniform grid index maintained by the site aggregate. Direct iteration remains acceptable for small authored sites, but results must be returned in stable order. Projection messages use topic deltas for fast-changing data and full snapshots after load or recovery.

Market history, notification history, replay diagnostics, and routine combat logs are bounded. Anything needed for current rules, a loss report, faction history, or save recovery is not removed by log compaction.

## 14. Security and integrity

Imported saves and all authored content are untrusted input at their boundaries. Parsers enforce maximum total size, collection sizes, string lengths, numeric bounds, and nesting depth before constructing domain state.

The application uses no `eval`, dynamic script content, remote code, or executable expressions in JSON. Content descriptions are rendered as text or through a restricted markup renderer with an allowlist. SVG assets are bundled and sanitized at build time; imported saves cannot contain SVG or HTML.

The production site uses a restrictive Content Security Policy allowing only its bundled scripts, styles, media, and worker. Runtime telemetry is disabled by default and no campaign data leaves the device. If optional crash reporting is ever introduced, it requires a higher-authority product decision and explicit player consent; it is not part of this specification.

Engine invariants are checked in all tests and development builds. Production performs lightweight checks at transaction boundaries and complete checks before save, after load, after migration, and after import.

## 15. Testing and verification

### 15.1 Test levels

The required test suite includes:

- **Formula unit tests:** exact examples and boundary cases for every functional formula, clamp, rounding rule, modifier stage, and unit conversion.
- **Property tests:** inventory conservation, non-negative credits, layer damage conservation, standing bounds, fitting limits, route validity, market bulk equivalence, cancellation returns, and colony storage behavior.
- **State-machine tests:** movement commands, warp, docking, gates, concealment, locks, module cycles, reloads, scanner actions, objectives, jobs, transport, and destruction recovery.
- **Deterministic replay tests:** snapshot plus command/delta logs with canonical state hashes.
- **Content tests:** schema, semantic validation, starter/tutorial reachability, neutral recovery connectivity, full reference coverage, and catalog relationships.
- **Persistence tests:** atomic rotation, quota failure, checksum failure, migration, forward-version rejection, export/import, and interrupted writes.
- **Protocol contract tests:** schema compatibility and identical outcomes through direct test adapter and worker transport.
- **UI component tests:** availability reasons, stale previews, keyboard operation, focus management, comparison traces, and notification grouping.
- **Browser acceptance tests:** complete representative loops across navigation, combat, fitting, trade, mining, exploration, planetary extraction, fabrication, skills, factions, loss/recovery, and save reopening.
- **Accessibility tests:** automated checks plus keyboard-only scripted flows at every required scale and contrast mode.
- **Performance tests:** maximum authored encounters, large asset lists, long-running markets/colonies, 8x simulation, and large saves.

### 15.2 Functional acceptance traceability

Each normative section and numbered acceptance criterion in `FunctionalSpecification.md` receives one or more stable scenario IDs. Tests include those IDs in their names or metadata. A generated traceability report lists the implementing engine module, content validator, projection/UI surface, and tests for each criterion.

The report proves coverage but does not replace human playtesting. Changes to a functional rule are incomplete until its content schema, formula trace, automated tests, and traceability entry are updated together.

### 15.3 Required invariant checks

At minimum, a full campaign validation verifies:

1. credits, quantities, experience, hit points, capacitor, and bounded values are legal;
2. every entity and definition reference resolves;
3. every item exists in exactly one valid location;
4. inventory capacity and job/colony reservations are consistent;
5. exactly one active player ship exists and its location agrees with campaign location;
6. fitting slot, hardpoint, online resource, and skill rules are internally consistent;
7. scheduler entries refer to live owners or an allowed persistent world event;
8. locks, movement targets, effects, and objectives refer to valid entities;
9. completed and one-time rewards cannot be granted again;
10. recovery and neutral-access guarantees remain available;
11. random streams, simulation time, revisions, entity ordinals, and event ordinals are valid and monotonic;
12. no real timestamp is used as a pending gameplay completion condition.

## 16. Diagnostics and development support

Development builds provide a local diagnostics panel showing campaign revision, simulation time, time rate, system timings, scheduler size, projection sizes, content version, save status, and recent command/error records. Developer commands may inspect or create test fixtures only when a compile-time development flag is enabled; they are absent from production bundles.

Structured logs use stable event names and redact free-form player names from exported diagnostics by default. A player-initiated diagnostic export may include engine version, content hash, browser capability summary, invariant failures, and recent protocol/event metadata, but not full campaign contents unless the player explicitly chooses to attach the save.

The engine can run headlessly in tests with an in-memory persistence adapter and a deterministic elapsed-time driver. This is the primary tool for balance simulations and long-duration economy, production, and colony verification; browser automation is reserved for behavior that crosses the UI boundary.

## 17. Future Java-server migration

The current local worker is treated as the first engine host, not as part of the UI. Migration to a Java server proceeds by implementing the same protocol and domain behavior behind a remote gateway.

The architecture preserves that option through these constraints:

- protocol payloads and saves are JSON-schema-defined and contain no TypeScript-only runtime types;
- canonical units, rounding, scheduler ordering, random generator, and formula fixtures are documented and portable;
- the client knows only the gateway interface, not whether commands run in a worker or remotely;
- the engine owns validation and does not trust a client preview;
- campaign state has a single authoritative owner;
- content definitions use stable IDs rather than imported TypeScript symbols;
- persistence is behind a port and is not called from domain objects;
- real-time UI animation is separate from authoritative movement;
- Java parity can be demonstrated by running the shared command/replay fixture corpus against both engines and comparing canonical state hashes or defined numeric tolerances.

A server migration may add authentication, remote persistence, authoritative elapsed-time policy, and transport security, but those are separate product and technical decisions. It must not silently introduce multiplayer, offline progress, or different game rules.

## 18. Delivery and change rules

This specification describes the full game and does not define an MVP, milestone, or implementation phase. Current-state documents may select a subset for a delivery phase, but any implemented slice must preserve the layer boundaries, ID strategy, persistence versioning, content validation, and command authority defined here so later systems do not require architectural replacement.

Technical changes are handled as follows:

- a player-visible rule change belongs first in the appropriate higher-authority game document;
- a balance-only change updates content data and relevant tests;
- a protocol or save-shape change increments its version and supplies compatibility handling;
- a new gameplay system declares its commands, queries, aggregate ownership, scheduled boundaries, persistence shape, content schema, formula traces, and acceptance tests;
- a new dependency requires a documented purpose and must not breach engine portability or offline operation;
- a deliberate exception to this specification is recorded in an architecture decision record and updates this document if the exception becomes the new rule.

## 19. Technical completion criteria

The full-game implementation satisfies this technical specification when:

1. all functional acceptance criteria have traced, passing automated scenarios and have been verified in representative play;
2. the UI changes campaign state only through the versioned command gateway;
3. the headless engine runs without DOM, React, browser storage, or network dependencies;
4. all complete-game content passes schema and semantic validation;
5. identical snapshots, elapsed deltas, and commands reproduce identical authoritative results;
6. campaign snapshots survive autosave rotation, manual save, close/reopen, export/import, corruption handling, and every released migration path;
7. closing, pausing, changing the system clock, or resuming after browser suspension never creates unearned campaign progress;
8. inventory, credit, fitting, scheduler, progression, and recovery invariants hold under property and long-running simulation tests;
9. the SVG/HTML interface meets required keyboard, mouse, scale, contrast, reduced-motion, notification, and explanation behavior;
10. production play has no required network request and contains no server dependency;
11. performance targets hold for the maximum supported authored scenarios and save sizes;
12. the worker gateway can be replaced by a protocol-compatible test or remote adapter without changing gameplay UI components.
