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
                  (combat/ locks, weapon cycles, reloads and their formulas)
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
`tests/fixtures/saves/format-9.json` is the golden artefact that pins the format, its canonical
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

Protocol version 12 exposes `loss.report`, `navigation.selectBookmark` and
`navigation.warpToBookmark`, `encounter.state`, `loot.contents` and `loot.take` alongside
`combat.state`, `targeting.lock`, `targeting.unlock`, `weapon.activate`, `weapon.deactivate`,
`weapon.reload`, `weapon.changeAmmunition`, `module.activate`, `module.deactivate`, `ship.get`,
`ship.undockValidity`, the fitting draft commands, `item.compare`, the inventory, market, repair,
resupply and insurance contracts, the navigation queries and orders, and the authored content
catalogue.

The tactical state includes layered shield, armour and hull condition, damage resistances,
capacitor recharge and endurance, active-module cycles and a bounded significant-event history.
All combat actors use the same deterministic lifecycle for damage, repair, propulsion and support
effects, so headless opponents and the player follow the same rules.

Campaign state and save format are version 9. Previous development saves are rejected without
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

## Locking and firing

A lock, a weapon cycle and a reload are each a queue entry with a due time, never a host timer, so a
campaign closed halfway through a lock comes back halfway through the same lock. They belong to the
ship that started them - `combat.ships` is keyed by ship id - and a ship that leaves the site drops
every one of them along with its queued boundaries.

Every cost a cycle commits is written on the cycle. Starting one spends its capacitor and holds one
round back from the magazine; applying the shot consumes that round; a target that disappears or a
lock that breaks first leaves the round loaded and does not refund the capacitor, which is what the
functional specification asks for. An empty magazine reloads itself from cargo while compatible
rounds remain and only then reports the weapon exhausted - including when the round that emptied it
destroyed the target, so a gun never comes home empty with rounds in the hold - and a reload asked
for mid-cycle waits for that cycle rather than interrupting it.

`src/engine/domain/combat/formulas.ts` holds lock time, relative motion, turret accuracy and shot
variation as pure functions of plain numbers. Each returns the trace that produced it, so
`combat.state` can hand the interface a hit chance with the range and tracking strains that made it
rather than a bare percentage. One shot draws from the `combat` stream in a fixed order - the hit
roll, then the critical roll, then the variation a critical replaces - so the same seed and the same
orders reproduce the same fight, and a refused command draws nothing at all.

A resolved shot is published as `combat.shotResolved` with its four raw damage components, and
`src/engine/domain/combat/damage.ts` applies them through shields, armour and hull: every component
crosses a depleted layer in the same proportion, so the order the damage types are iterated in
cannot change the result. Destruction is detected only after every completion already committed at
that timestamp has resolved, so two ships that fire simultaneously can destroy each other.

## Encounters, opponents and wrecks

An authored combat site is instantiated the moment the ship arrives, and the instance lasts exactly
as long as the player occupies the site. Leaving abandons it - retreat is a legal outcome, not a
failure - and the next arrival instantiates a fresh one, so no site can be exhausted.
`content/encounters/templates/*.json` says which profiles a site spawns, how many and how far out;
`npc.profiles` says what each one flies and carries and what its bounty is worth.

An opponent is an ordinary ship. It is created through the inventory service with a real fit in a
real fitting store and the reserve rounds its profile authors in its hold, so it reloads the way the
player does; it derives its attributes through the same pipeline the player's ship uses, and
`src/engine/simulation/encounter.ts` turns its intent into the same movement, targeting and module
commands the player issues. It cannot out-range, out-track or out-tank the rules, and it reads only
its own condition and the range to its target, so it gains nothing from the player losing.

What it wants is decided by a pure function in `src/engine/domain/encounter/behavior.ts`. A role is
a band rather than a distance: a brawler holds a small fraction of its own best turret optimal, a
skirmisher orbits at most of it and a sniper keeps more than it, each clamped to its authored
minimum and to what its own lock range can hold. It burns its propulsion only while it is outside
that band and runs its repair module only below the authored threshold, so a refit changes how it
fights without any behaviour being rewritten.

Destroying one settles its bounty against a grant id, so a replayed completion cannot pay twice, and
leaves a wreck holding the contents its loot table rolled from the `loot` stream. The wreck is an
ordinary inventory in an ordinary place: taking from it is the same physical move as any other, so a
hold that is too small keeps the goods where they are rather than destroying them. It outlives the
instance that made it and expires on its own scheduled boundary, so warping out and back does not
make it vanish. `navigation.destinations` discloses each site's opponents, total bounty and possible
loot before entry, and records how often it has been completed.

## The combat interface

The space view is where a fight is read and commanded, and it decides nothing. Hostility is the
engine's answer (`attitude` on every site object: own, hostile or neutral), and it is drawn as a
shape - a hostile ship wears a diamond, a lock is a ringed crosshair, a lock in progress a broken
ring - as well as written beside the object in the list. The effects layer draws each weapon's
fire, every ship that has locked the player, and recent damage and repairs beside the ship they
happened to. Weapon and lock ranges are drawn on demand.

The panels beneath the view read the tactical projection. Status shows layers, resistances,
capacitor with its endurance calculation, and who has locked the ship. Weapons are grouped by
turret and charge; each group shows its hit chance against the aimed target, which half of the
turret formula limits it (`limitingFactor`), and the formula with the engine's operands written
into it. Each weapon shows its magazine, cycle and reload, and every charge it could change to with
what that charge would do. Modules are toggles; locks show their lock-time calculation; the
encounter panel lists the opponents by role and bounty; the combat log summarises the engine's
aggregated events and can be filtered. Selecting a wreck opens it, and the loot panel takes what
the hold accepts, asking the engine afresh between stacks.

The weapons aim at the selected object when it is locked, otherwise at the first completed lock.
A secondary click on an object - or the context-menu key or Shift+F10 on its list entry - opens
its commands, the same list the selected-object panel renders. Every combat action is a registry
entry with a shortcut: `l` lock, `n` unlock, `e` fire, `q` cease fire, `v` reload, `1`-`4` toggle
active modules, `t` take all, `]` and `[` step the selection, `b` draw ranges.

Back at the station the hub summarises the last sortie and what the hold carries, and the
departure panel discloses each site's opponents, bounties, possible loot and completion count, and
warns - without blocking - about an unloaded weapon or unrepaired armour and hull before undocking.
Docking refreshes every station surface, so a campaign reopened in space finds the market current
when it comes home.

## Losing a ship

When the player's hull gives out, one transaction settles everything
(`src/engine/simulation/loss.ts`). It runs after combat has finalized destruction and after the
encounter has paid for anything the same instant destroyed, so dying while killing the last opponent
still earns its bounty. The hull becomes the player's own wreck, which lasts two simulation hours;
each fitted module and each cargo stack survives into it on its own roll from the `loot` stream,
and loaded ammunition never does. The opponents stay behind, the site unloads and the pilot is
docked at the station they last docked at. Insurance pays at once - 30% of the hull's reference
value, or 70% under enhanced cover, which the loss consumes - and the loss report is frozen:
who hit the ship with what and which layers each attacker broke, the final burst, what had stopped
working, what was lost and what survived, the payout and how the pilot was recovered. Then the
campaign autosaves.

Recovery follows the functional specification literally. A pilot who owns no flight-ready ship and
has less than the starter hull's reference value is given a replacement starter ship with its
original basic fit and a full magazine. Everything granted - hull, modules, rounds - carries a
`recoveryGrant` mark that travels through every split, move, fit, reload and loss: it can be flown
and refitted but never sold or insured, and a marked stack merges only with a marked one (a loaded
magazine, being one physical charge, becomes marked if any of its rounds are). A pilot with more
than that owns no ship at all until they buy one - the active ship may be absent, but only while
docked - and a content check keeps the recovery station's starter hull within reach of exactly
that pilot. A shipless pilot who spends below the threshold is granted the ship then.

The wreck is an automatic bookmark. The station's departure panel offers it beside the encounters,
and the space view's warp control offers it beside the sites, so it can be recovered without a
system map: a warp to it arrives relative to the wreck rather than to the site's centre. The
authored opponents at that site are there again, because every visit instantiates a fresh
encounter.

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
