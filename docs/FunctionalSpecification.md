# Galactic Soup Functional Specification

## 1. Purpose and authority

This document defines the complete player-visible functionality of Galactic Soup. It answers how the full game behaves, including rules, calculations, commands, screens, progression, content requirements, failure cases, and system interactions.

The authority order is:

1. `human-input/GameConcept.md`
2. `GameDesignBrief.md`
3. this functional specification
4. the future technical specification

This document must be interpreted consistently with the documents above it. If a lower-level rule conflicts with a higher-level document, the higher-level document wins and this document must be corrected.

This is not an MVP definition or implementation sequence. Every normative requirement describes the intended complete game. Architecture, source-code organization, storage representation, and framework choices belong in the technical specification. Content quantities and delivery targets belong in current-state documents rather than this specification.

Unless a value is expressly described as a structural rule, exact numerical parameters governing balance, including costs, durations, rates, ranges, thresholds, and capacities, are tuning defaults rather than permanent scope. They must be stored with the human-readable game constants required by the concept and may be rebalanced without changing this specification, provided the specified relationships, limits, and player-visible behavior remain intact. Structural values such as the four damage types, the skill-rank range, and the available time-control states are normative.

## 2. Normative language and game terms

The words **must**, **must not**, **should**, and **may** are normative:

- **Must** and **must not** define required behavior.
- **Should** defines expected behavior that may be changed only for a documented usability or balancing reason.
- **May** defines permitted behavior.

The following terms are used consistently:

- **Campaign:** one player's persistent universe, character, assets, and progress.
- **Simulation time:** time that advances inside a campaign while the game is running and not paused.
- **Real time:** time outside the simulation. Real time must never advance skills, production, extraction, markets, deadlines, or other campaign state while the campaign is closed.
- **Ship:** a player or NPC spacecraft in space.
- **Hull:** a ship type before fitted modules, cargo, and ammunition are considered.
- **Active ship:** the single ship currently controlled by the player.
- **Site:** a local two-dimensional play area around a station, gate, belt, planet, anomaly, or encounter.
- **System:** a stellar system containing sites and connected to other systems by gates.
- **Docked:** the state in which the player and active ship are inside a station.
- **Reference value:** the data-defined baseline credit value of an item, used for rewards, insurance, and content balancing. It is not necessarily a market quote.
- **Tier:** an authored difficulty or capability band from 1 through 5. Tier is an information label, not a hidden player level.
- **Stack:** multiple interchangeable units of the same item in one inventory entry.

## 3. Campaign and session rules

### 3.1 Starting a campaign

A new campaign starts at a non-hostile independent station in a low-danger system. The initial tuning defaults grant the player:

- 20,000 credits;
- one fitted starter multi-role light ship;
- one basic light turret and one full ammunition load fitted to the ship;
- one basic shield booster fitted to the ship;
- one basic mining module and one basic scanner in the local station hangar;
- the core navigation, targeting, fitting, trade, mining, and scanning skills at rank 1;
- rank 0 in all other skills;
- neutral standing, value 0, with every faction;
- no planetary facilities, production jobs, or remote assets.

The starter fit must be valid, undockable, and capable of completing the guided introduction without purchases.

The player chooses a display name. The name has no mechanical effect and can be changed from the campaign settings while docked.

### 3.2 Guided introduction

The first station offers a guided objective chain covering, in order:

1. inspecting and issuing movement commands;
2. locking a target and firing a weapon;
3. using an active defense and observing capacitor use;
4. docking and changing a fitting;
5. mining and refining a small resource batch;
6. buying and selling an item;
7. scanning and visiting a basic anomaly;
8. fabricating one basic module;
9. viewing skills, factions, and the galaxy map.

The chain is optional and may be hidden or resumed at any time. Individual steps may be skipped. Skipping grants only tutorial-specific items required to keep later steps completable; it does not grant normal activity rewards or experience for the skipped step.

Tutorial combat cannot cause permanent ship loss. If the starter ship is destroyed in a tutorial instance, the instance resets to its entry state and explains the cause of failure.

### 3.3 Simulation time

The available time settings are paused, 1x, 2x, 4x, and 8x.

- Simulation time does not advance while paused, at the main menu, or while the campaign is closed.
- The player may inspect all screens and issue or change commands while paused. Commands begin or resume when simulation time advances.
- 4x and 8x are unavailable while a hostile ship is present in the player's current site, the player's ship is warp-disrupted, or the player has taken damage in the previous 10 simulation seconds.
- If one of those conditions begins at 4x or 8x, time immediately changes to 1x and a visible notification explains why.
- 2x remains available in combat. Pause remains available at all times.
- Production, planetary extraction, market changes, site expiration, travel, and combat all use the same simulation clock.

No system may use closing the game or waiting in real time as a way to make progress.

### 3.4 Saving and loading

The game must support at least three separate campaign slots. Each campaign has:

- a rolling set of five autosaves;
- one player-controlled manual save;
- export to a portable save file;
- import from a portable save file after validation and confirmation.

The game autosaves after docking, undocking, completing a gate jump, completing a market transaction, installing or cancelling an industry job, changing a skill, changing planetary infrastructure, completing an anomaly, and resolving player ship destruction. Autosaves also occur every five minutes of real play while the simulation is not paused.

Manual saving is available while docked and while undocked if no hostile ship is present in the current site. Loading returns to the main menu before the selected save is opened. Import never overwrites an existing campaign without explicit confirmation.

## 4. Shared numerical rules

### 4.1 Units and display

- Space distance is measured in kilometres.
- Ship speed is measured in kilometres per second.
- Angular velocity and tracking are measured in radians per second.
- Time is measured in simulation seconds, minutes, hours, and days.
- Cargo and item size are measured in cubic metres.
- Currency is measured in whole credits.
- Standing is shown from -100.0 to +100.0.
- Percentages shown to the player use percentage points, not fractions.

Internal calculations retain fractional precision. The interface rounds only for display:

- credits to whole credits;
- distance below 10 km to 0.1 km and distance at or above 10 km to whole kilometres;
- time below 60 seconds to 0.1 seconds where timing matters, otherwise whole seconds;
- percentages and standings to one decimal place;
- other values to enough digits that two meaningfully different choices do not appear equal.

A displayed total or preview must be calculated from unrounded values. When whole items or credits are produced, fractions are rounded down only at the final step unless a rule states otherwise.

### 4.2 Limits and clamping

Unless a specific rule says otherwise:

- probabilities are clamped from 0% through 100%;
- resistances are clamped from 0% through 90%;
- current hit points, capacitor, inventory quantity, and standing cannot exceed their defined minimum or maximum;
- a timed action completes when its remaining time reaches zero;
- an effect ending and an action completing at the same instant are resolved in favor of the action already in progress.

### 4.3 Random outcomes

Loading a save must not reroll an outcome that had already been resolved when that save was created. Repeating actions from an earlier point may produce the same or a different outcome, but the game must not promise that reloading changes the result.

The player must be shown the relevant probability or outcome range before committing to an action when that probability materially affects the decision. The game must not secretly change probabilities based on previous success, player wealth, or repeated loading.

### 4.4 Attribute modifiers

Flat bonuses are added before percentage modifiers. Percentage modifiers are applied multiplicatively.

When multiple fitted modules modify the same ship attribute in the same direction, apply them from greatest absolute effect to least with effectiveness multipliers of 100%, 87%, 57%, 28%, and 10%. Further fitted-module modifiers to that attribute have no effect. Penalties and bonuses are ordered and diminished separately.

Hull traits, skills, temporary hostile effects, ammunition effects, and the module's effect on its own operation are not diminished unless their description explicitly says they are stacking-limited.

Every derived-stat tooltip must list its base value and each applied modifier in calculation order.

## 5. Universe structure

### 5.1 Galaxy and regions

The game contains multiple authored stellar systems divided among visually and economically distinct regions. Each system has permanent gate connections recorded on the galaxy map. The number of systems and regions is a content target defined by the applicable current-state document.

Systems have a danger rating from 1 through 5:

- **Danger 1:** starter space; weak hostile presence and common resources.
- **Danger 2:** established space; routine combat and broader markets.
- **Danger 3:** frontier space; mixed enemy groups and uncommon resources.
- **Danger 4:** hazardous space; strong control effects, advanced enemies, and valuable resources.
- **Danger 5:** extreme space; the hardest non-unique encounters and rarest repeatable rewards.

Danger rating is fixed by system and is visible on the galaxy and route views. Enemy strength does not scale to the player's ship, wealth, or skill total.

Every region must include at least one station open to a neutral player. At least one connected chain of neutral-access stations must remain usable regardless of faction standings, ensuring that the player cannot lose all access to markets and services.

### 5.2 System contents

A system may contain:

- one star and visual celestial landmarks;
- planets and moons;
- one or more gates;
- stations;
- asteroid belts or other resource fields;
- permanent faction or industrial sites;
- unresolved and resolved anomalies;
- temporary authored encounter sites;
- roaming NPC ships.

Celestial objects and permanent sites appear on the system map when the system is first entered. Hidden anomalies require scanning. Station services, market details, and belt composition become remotely visible after the player has docked at or surveyed the relevant location once.

### 5.3 Sites

Each site is a continuous two-dimensional area. Ships, asteroids, structures, containers, and relevant hazards have positions inside it.

Sites do not need to represent the empty distance between celestial objects. The player travels between sites by warp. Tactical objects may move within a site, but permanent celestial positions do not drift during play.

Ships do not cause collision damage. Ships and large objects apply gentle separation when overlapping so that they cannot remain at exactly the same position. Weapons do not hit unintended objects along their path unless their description explicitly defines an area effect.

### 5.4 Persistent and replenishing content

- Permanent stations, gates, planets, and authored landmarks do not disappear.
- Asteroid belts replenish depleted asteroids gradually and are guaranteed to receive a meaningful replenishment within 24 simulation hours.
- Unvisited anomalies expire after 48 simulation hours and are replaced according to the system's anomaly table.
- A resolved anomaly does not expire while the player is inside it.
- Completed anomalies despawn when the player leaves and are replaced no sooner than six simulation hours later.
- Jettisoned containers and NPC wrecks persist for 30 simulation minutes.
- The player's own wreck persists for two simulation hours and receives an automatic bookmark.

## 6. Player assets and inventory

### 6.1 Credits and ownership

Credits are globally available and do not occupy cargo space. Credits cannot become negative.

All physical items have a location. Valid locations are a ship cargo hold, a fitted ship slot, a station hangar, an industry input or output store, a planetary store, an orbital customs store, a container in space, or a wreck.

An item can exist in only one location. The game never provides remote access to physical items merely because the player owns them.

### 6.2 Cargo and station hangars

Every item has a unit volume. Moving a stack into a ship is allowed only if the destination hold has enough free volume for the entire requested quantity. The quantity selector provides a **maximum that fits** action.

Station hangars have unlimited capacity. Each station has a separate hangar. The assets screen lists all remote items and ships, but remote assets can only be fitted, used, refined, sold, or installed in production when the corresponding rule explicitly allows remote operation.

Cargo can be split and merged. Identical items stack if their functional state is identical. Loaded ammunition and configured items remain separate when their state differs.

### 6.3 Ships and remote transport

The player controls one active ship. Other ships are stored at stations.

The player may switch active ships while docked if the destination ship is at the same station. Cargo stays with the previous ship unless moved explicitly. Any locally stored ship may be opened in the fitting screen, but only a valid active ship may undock.

Discovered non-hostile stations offer insured transport of empty stored ships. Transport:

- accepts only an unfitted ship with an empty cargo hold;
- charges a displayed fee based on hull volume and shortest known route length;
- takes one simulation hour plus 15 minutes per gate on that route;
- is risk-free once accepted;
- delivers to the destination station hangar;
- cannot be accelerated by closing the game.

The transport fee is:

`ceil((500 + hull packaged volume × 2 credits × number of gates on the route) × origin-faction standing service multiplier)`

The preview shows the exact route, fee, and delivery time. A route with zero gates charges the 500-credit minimum.

Physical goods and fitted ships cannot use this service. They must be carried by the player or acquired at the destination.

## 7. Navigation and ship commands

### 7.1 Selection and command model

Selecting an object reveals contextual commands and information. Selection alone does not lock a target or change the ship's behavior.

The player may issue the following movement commands when applicable:

- **Approach:** move toward the target and stop at the chosen distance.
- **Orbit:** attempt to circle the target at the chosen radius.
- **Keep range:** move toward or away from the target to maintain the chosen distance while minimizing unnecessary transverse movement.
- **Move to point:** travel toward a player-selected point in the current site.
- **Stop:** reduce desired speed to zero.
- **Warp:** travel to a known site or bookmark.
- **Dock:** approach and enter a station.
- **Jump:** approach and activate a gate.

Only one movement command is active at a time. A new movement command replaces the previous one. Module activation, locking, and inventory actions are independent of the movement command.

The command bar must show the active movement order, target, requested distance, and any reason it cannot currently be fulfilled.

### 7.2 Normal-space movement

Each hull defines maximum speed, forward acceleration, braking acceleration, and maximum turn rate. The ship turns toward the direction needed by its current command and accelerates toward the desired velocity. It does not change velocity instantaneously.

- Approach selects the shortest direct course.
- Orbit continually selects a tangent course corrected toward the requested radius.
- Keep range uses radial movement first and slows as it enters a tolerance equal to 5% of the chosen range, with a minimum tolerance of 0.5 km.
- Stop uses the hull's braking acceleration.

If a target moves beyond the ship's ability to satisfy orbit or keep range, the command remains active and the interface marks the requested distance as unattainable.

### 7.3 Warp

Warp may target any known permanent site, resolved anomaly, authored encounter site, or bookmark in the current system that is at least 100 km away.

After a warp command, the ship automatically turns toward the destination and accelerates. Warp begins when:

- the ship is within 15 degrees of the destination direction;
- speed is at least 75% of current maximum normal speed;
- the ship is not warp-disrupted;
- a three-second warp preparation timer has completed.

Taking damage does not cancel warp preparation, but a warp-disruption effect does. Changing movement command cancels preparation. The interface shows the unmet condition and estimated time to warp.

The player chooses an arrival distance of 0, 10, 30, 50, or 100 km where the destination permits it. Stations and gates always allow 0 km. Some authored encounters may restrict arrival distance and must state that restriction before warp begins.

Weapons and active modules deactivate when warp begins. Passive modules remain in effect. Capacitor and shield regeneration continue in warp.

### 7.4 Docking and gates

Docking requires the ship to be within 1 km of the station and the station to permit access. The Dock command automatically approaches. Docking takes three seconds once in range and is cancelled by initiating an offensive action, losing access, leaving range, or replacing the movement command.

A gate jump requires the ship to be within 2 km of the gate. The Jump command automatically approaches. Jumping takes three seconds once in range and is cancelled by leaving range or replacing the movement command. Completion places the ship at the connected gate in the destination system.

After a gate jump, the ship receives up to 15 seconds of arrival concealment. During concealment it cannot be targeted. Concealment ends when the player issues a movement command, activates a module, begins locking, or reaches 15 seconds. The ship remains visible as an unidentifiable contact so the player cannot use concealment as permanent invisibility.

## 8. Ships, lineups, and fitting

### 8.1 Required hull lineups

Player-usable hulls are organized into lineups supporting these roles:

- close-range combat;
- long-range combat;
- control and durable combat;
- mining;
- hauling;
- exploration.

The starter ship is an inexpensive multi-role hull. Each lineup provides a meaningful path from an accessible entry hull to more capable or specialized hulls, but later hulls must retain at least one operational disadvantage such as cost, speed, signature, fitting demand, skill requirement, or vulnerability to small targets. Exact hull counts belong in the applicable current-state document.

No hull may be strictly better than every other hull of the same broad investment level. Each hull description states its intended role, bonuses, fitting profile, and significant limitations.

### 8.2 Ship attributes

Every hull defines at least:

- shield, armor, and hull hit points;
- four resistances for each defensive layer;
- capacitor capacity and recharge time;
- maximum speed, acceleration, braking, and turn rate;
- signature radius;
- scan resolution, maximum lock range, and maximum locked targets;
- cargo capacity;
- warp speed;
- weapon, system, engineering, and utility slot counts;
- supported weapon or industrial hardpoints;
- available power and processing capacity;
- skill requirements;
- reference value and insurance class;
- hull traits and role bonuses.

The fitting and ship-information screens show both base and current derived values.

### 8.3 Module categories

Modules occupy one slot of their category unless their description says otherwise:

- **Weapon slots:** turrets, launchers, and mining emitters.
- **System slots:** propulsion, active shield, active armor, capacitor injection, and electronic-control modules.
- **Engineering slots:** passive resistance, shield recharge, capacitor, weapon enhancement, cargo, and fitting-support modules.
- **Utility slots:** scanners, tractor devices, and other non-weapon operational tools.

Hull hardpoints may further restrict weapon-slot modules. A launcher cannot use a turret hardpoint, and a mining emitter requires a mining-compatible hardpoint.

### 8.4 Fitting resources and validity

Each module consumes power and processing capacity while online. A fit is valid only if:

- no slot count or hardpoint count is exceeded;
- total online power use does not exceed the ship's available power;
- total online processing use does not exceed available processing capacity;
- the player meets the hull and module skill requirements;
- all mutually exclusive restrictions are satisfied.

The player may store offline modules in fitted slots. Offline modules consume no power or processing, provide no modifiers, and cannot activate. Module online state can be changed only while docked at a fitting service.

Fitting, removing, loading, and unloading modules is instantaneous and free while docked at a fitting service. Required modules and ammunition must be in the same station hangar or ship cargo hold. Changing fits in space is not supported.

The player cannot undock in an invalid active ship. The fitting screen highlights every violated constraint and offers to revert changes made since the screen was opened.

### 8.5 Fitting information and saved fits

The fitting screen provides:

- drag-and-drop and contextual fitting actions;
- a live derived-stat preview before committing changes;
- capacitor endurance under the selected activation assumptions;
- sustained and burst defense estimates;
- weapon damage, optimal range, falloff, tracking, and ammunition effects;
- movement, targeting, cargo, mining, and scan changes;
- warnings for missing ammunition, inactive modules, uncovered damage weaknesses, and unstable capacitor use.

The player may save named fitting templates. Applying a template fits available local items and lists missing items; it never buys items automatically.

## 9. Targeting and combat

### 9.1 Combat state and legality

A ship is hostile if its faction state, encounter role, or previous action allows the player to attack it without a standing penalty. Hostiles are visually distinct from neutral, friendly, and owned objects without relying only on color.

The player may attack a non-hostile NPC, but the first offensive command requires confirmation and shows the expected faction consequence. Tutorial targets and protected neutral infrastructure cannot be attacked.

Combat has no separate turn or instance clock. Movement, locks, weapons, defenses, capacitor, reinforcements, and escape all resolve in simulation time.

### 9.2 Locking

Offensive modules and most targeted support modules require a completed lock. The player starts a lock from the selected object's command menu. Multiple locks may progress at once up to the ship's maximum target count.

Lock time in seconds is:

`clamp(0.75, 20, 4 × sqrt(100 / scan resolution) × sqrt(40 / target signature radius))`

Scan resolution and target signature use current modified values. The lock-time preview updates if either changes before completion.

A lock attempt is cancelled if the target remains beyond maximum lock range for two consecutive seconds, leaves the site, becomes concealed, or is destroyed. A completed lock breaks under the same conditions. Selecting a target is still allowed without a lock.

### 9.3 Movement relationships

For two ships, relative velocity is the target velocity minus the attacker's velocity. Transverse velocity is the component of relative velocity perpendicular to the line between them.

Angular velocity is:

`absolute cross product of relative position and relative velocity / distance squared`

The tactical view shows current range, closing or opening speed, transverse velocity, and angular velocity for the selected target. A weapon tooltip compares current values to that weapon's effective values.

### 9.4 Weapon operation

Weapons activate in repeating cycles against a locked target. Activating an inactive weapon begins its cycle. Deactivating it allows the current cycle to finish but prevents the next one. A weapon applies its shot at the end of its cycle.

A cycle cannot start without enough capacitor and, when required, ammunition. Capacitor is consumed and one required ammunition unit is reserved at cycle start. The reserved ammunition is consumed when the shot is applied. If the target is destroyed or the lock breaks before application, the ammunition remains loaded; committed capacitor is not refunded.

Weapons stop repeating when their target is destroyed, the lock breaks, ammunition is exhausted, or a later cycle cannot pay its capacitor cost. The interface displays the reason.

Reloading draws a compatible ammunition stack from cargo, takes five seconds, and prevents that weapon from firing. Reloading or changing ammunition begins only after any current weapon cycle completes. Reload may be automatic when empty or explicitly commanded. Changing ammunition unloads the remaining magazine into cargo and then performs a full reload. It fails if cargo cannot hold the unloaded ammunition.

### 9.5 Turret accuracy

Turret weapons include projectile, beam, and other line-of-fire weapons. Each defines optimal range `O`, falloff `F`, tracking `T`, and weapon signature resolution `R`.

For target signature `S`, range `D`, and angular velocity `A`:

`tracking strain = (A × R) / (T × S)`

`range strain = 0`, when `D <= O`

`range strain = (D - O) / F`, when `D > O` and `F > 0`

`hit chance = 0.5 ^ (tracking strain² + range strain²)`

If `D > O` and falloff is zero, hit chance is 0%. Hit chance is otherwise clamped from 1% through 100% while the target is within the weapon's absolute range of `O + 3F`; beyond that range it is 0%.

Each shot makes one hit roll. A hit deals between 75% and 125% of listed damage with uniform probability. One percent of successful hits are critical hits and deal 200% of listed damage instead. The hit-chance preview excludes damage variation and shows the individual contributions of range and tracking.

### 9.6 Guided-weapon accuracy

Guided weapons launch a projectile with flight speed, maximum flight time, explosion radius `E`, and explosion velocity `V`. A launched projectile continues toward its target while the target remains in the site. It misses if flight time expires first.

On impact, for target signature `S` and current speed `Q`, the damage multiplier is:

`signature factor = min(1, S / E)`

`speed factor = min(1, (V / max(Q, 0.1)) × sqrt(S / E))`

`damage multiplier = max(0.1, min(signature factor, speed factor))`

Guided weapons therefore do at least 10% listed damage on a successful impact. They do not use the turret hit calculation and cannot critically hit unless an ammunition description explicitly says otherwise.

### 9.7 Damage types and defenses

All weapon damage is divided among electromagnetic, thermal, kinetic, and explosive damage. The weapon or loaded ammunition shows its exact distribution.

Ships have shield, armor, and hull layers. Damage applies to shield first, then armor, then hull. For each damage type and current layer:

`applied damage = raw damage × (1 - resistance)`

If a layer is depleted partway through a hit, remaining raw damage is calculated separately against the next layer's resistances. A ship is destroyed when hull reaches zero.

Shield regenerates continuously, including while the ship is taking damage, at:

`maximum shield / shield recharge time`

hit points per second until full. Armor and hull do not regenerate naturally.

Active shield, armor, or hull repair modules restore their listed amount at the end of each successful cycle. A repair cycle that began with enough capacitor completes even if capacitor later reaches zero. Repairs cannot exceed the layer maximum.

Passive tanking consists of hit-point, resistance, shield-recharge, and capacitor-recharge choices that require no activation. Active tanking consumes capacitor per cycle and can produce stronger immediate recovery.

### 9.8 Capacitor

Capacitor regenerates continuously at:

`maximum capacitor / capacitor recharge time`

per second until full. Each active module lists its activation cost and cycle time.

If a module lacks enough capacitor at cycle start, the cycle does not begin. A repeating module waits and tries again when enough capacitor is available unless the player deactivates it. The capacitor display shows current amount, net recent change, and estimated endurance for the currently repeating modules.

Propulsion, repair, electronic control, scanners, and some weapon families use capacitor. Passive modules never consume capacitor.

### 9.9 Electronic and movement-control effects

The full game supports at least:

- **Speed reduction:** multiplies the target's maximum normal speed for the effect duration.
- **Warp disruption:** prevents warp from beginning and cancels warp preparation.
- **Capacitor drain:** removes a stated capacitor amount, limited by what the target has.
- **Signature amplification:** increases target signature radius.
- **Targeting interference:** reduces maximum lock range or scan resolution.

Effects require range and a completed lock unless their description says otherwise. Repeating effects reapply at the end of every successful cycle. Their icons show source, strength, and time until the next cycle or expiration.

Movement speed cannot be reduced below 10% of the unmodified hull maximum. A ship may be affected by multiple warp disruptors, but any one active disruptor is sufficient to prevent warp.

### 9.10 NPC behavior

NPC combat ships use the same movement, range, tracking, damage, defense, capacitor, and control rules as the player unless a visible encounter rule states otherwise.

NPC roles include at least:

- brawlers that approach and hold close range;
- skirmishers that maintain range;
- snipers that favor long range and low transverse movement;
- tacklers that prioritize speed reduction or warp disruption;
- support ships that repair or enhance allies;
- vulnerable damage dealers that require target-priority decisions.

NPCs choose tactics according to their role, current conditions, and encounter objectives. They may change behavior, retreat, call authored reinforcements, or protect an objective. An NPC never gains hidden bonuses solely because the player is winning.

### 9.11 Victory, loot, and retreat

Destroyed NPC ships may provide:

- an immediate bounty paid in credits;
- combat experience;
- a wreck containing authored or randomly selected items;
- standing changes;
- authored encounter progress.

Reward ownership is immediate because the game is single-player. Opening a wreck within 1 km shows its contents. A take command moves selected items to cargo subject to capacity. Wreck contents remaining after expiration are lost.

Leaving a combat site is a valid outcome unless the encounter explicitly protects an objective or has a deadline. Hostile ships do not follow through warp or gates unless the encounter clearly announces pursuit before the player enters.

### 9.12 Player ship destruction and recovery

On player ship destruction:

1. the destroyed hull and fitted modules become a wreck;
2. each cargo stack and fitted module independently has a 50% chance to survive in the wreck;
3. loaded ammunition does not survive;
4. the player is recovered at the most recently docked accessible station;
5. insurance is paid immediately;
6. the loss report shows incoming damage, final damage, major disabling effects, and the lost and surviving items;
7. the game autosaves.

All hulls have free basic insurance paying 30% of hull reference value. While docked, the player may buy enhanced insurance for 15% of hull reference value; it pays 70% of hull reference value on the next destruction and is consumed by that destruction. Insurance never covers modules or cargo.

If, after destruction, the player owns no flight-ready ship and total credits are below the starter ship reference value, an independent recovery service supplies a replacement starter ship with its original basic fit. Repeated recovery grants are allowed, but granted recovery assets have zero sale, refining, fabrication-input, loot, and insurance value. Removing or replacing their modules is allowed, but cannot create saleable or insurable value.

## 10. Stations and services

Stations may provide a market, fitting, repair, refining, fabrication, skill academy, ship dealer, and insured ship transport. Available services are visible from the system and station information views.

While docked, the station view is the main hub. Undocking is allowed only with a valid active ship. The game warns before undocking without ammunition for fitted weapons, with severely damaged layers, or with a route through a system where the player is hostile.

Repair service restores shield, armor, and hull instantly. Shield repair is free. Armor and hull repair cost:

`ceil(hull reference value × (0.02 × missing armor fraction + 0.05 × missing hull fraction) × station service modifier × standing service multiplier)`

Station service modifier is a displayed content value from 0.75 through 1.50. Standing service multiplier is 1.10 when Distrusted, 1.00 when Neutral, 0.95 when Friendly, 0.90 when Allied, and 0.85 when Honored. Hostile stations do not provide service. Repair never begins without confirmation of the total price.

Stations controlled by hostile factions may deny docking. A station cannot revoke docking while the player is already docked; it permits undocking and asset removal. Neutral-access recovery stations never deny docking based on standings.

## 11. NPC economy and trade

### 11.1 Market listings

NPC station markets provide immediate buy and sell quotes. The player does not create persistent market orders and does not trade with other players.

Each station and item pair may define:

- base price `B`;
- regional price factor `R`;
- target stock `T`;
- current stock `S`;
- elasticity `E` from 0.1 through 0.6;
- base spread `P` from 4% through 15%;
- production and consumption per simulation hour;
- temporary event factor.

Target stock must be greater than zero for every market listing.

For a listing:

`scarcity = clamp(-1, 2, (T - S) / T)`

`mid price = B × R × clamp(0.4, 2.5, 1 + E × scarcity) × event factor`

`effective spread = clamp(0.02, 0.25, P × (1 - 0.04 × Trade skill rank) × (1 - controlling-faction standing / 500))`

`station sell price = mid price × (1 + effective spread)`

`station buy price = mid price × (1 - effective spread)`

The station sell price is what the player pays. The station buy price is what the player receives. Final per-unit prices round to the nearest whole credit with a minimum of one credit.

Bulk transaction totals are calculated one unit at a time as stock changes, preventing the whole stack from receiving the initial scarcity price. The confirmation screen shows average unit price, total, remaining stock, cargo effect, and any price movement caused by the transaction.

### 11.2 Market change

At each simulation-hour boundary, station stock changes by its production minus consumption rate, then clamps from zero to twice target stock unless content defines a larger warehouse. Quotes update immediately after stock, events, skills, or standing changes.

Regional events may multiply selected mid prices by 0.75 through 1.50 for 12 through 72 simulation hours. Events are announced in affected discovered regions and explain the affected goods and end time.

Markets at neutral recovery stations maintain unlimited, non-scarce stock of the starter hull, its basic modules, and compatible ammunition. These items use fixed prices and cannot be profitably resold to any station.

### 11.3 Trading flow and information

Buying requires sufficient credits, station stock, and local ship cargo or hangar capacity. Items bought while docked go to the station hangar by default. Selling requires the item to be in the local station hangar or docked ship cargo.

The market screen provides:

- local buy and sell prices and stock;
- known prices at previously visited stations;
- 24-hour, 7-day, and 30-day local price history in simulation time;
- route length and danger to a selected known market;
- cargo volume, total cost, expected destination proceeds, and estimated margin;
- warnings when displayed remote information is stale.

Known remote quotes update only when the player revisits the station, receives market data through an exploration reward, or has the skill needed for remote market information. Rank 0 provides no automatic remote update. Remote Market Information ranks 1 through 5 update quotes within 3, 2, 1, 0.5, and 0.25 simulation hours respectively.

Remote purchase becomes available at Remote Market Information rank 3 within the current region and rank 5 galaxy-wide. Remotely purchased items remain in that station's hangar. Remote sale is not available.

### 11.4 Trade experience

The game records weighted-average acquisition cost for purchased goods. Selling purchased goods grants one trade experience per 100 credits of positive realized profit, rounded down. No experience is granted for a loss or for selling items acquired by mining, loot, fabrication, tutorial grants, or recovery grants; those activities award their own experience.

The acquisition-cost record affects experience only, never ownership or sale price. Moving, splitting, and merging stacks preserve the weighted average.

## 12. Mining and refining

### 12.1 Asteroids and resource information

Asteroid belts contain individually selectable asteroids. Each asteroid defines resource type, remaining quantity, unit volume, mining difficulty, and visual size.

Basic scanners reveal resource family and approximate remaining quantity. A survey scanner reveals exact type, exact quantity, unit volume, and estimated time to deplete with the active mining modules.

Resource distribution depends on region and danger. Every fabrication raw material must have at least one dependable source, and the galaxy map's resource index must give a discoverable clue to its region after the player has encountered it once.

### 12.2 Mining operation

A mining emitter requires a completed lock, sufficient range, a compatible asteroid, capacitor when listed, and enough free cargo space for at least one unit. These conditions are checked before a cycle begins; a failed check consumes neither capacitor nor asteroid quantity.

At the end of each mining cycle:

`extracted units = floor(base module yield × hull modifier × skill modifier / resource difficulty)`

Extraction is limited by asteroid quantity and by the number of whole units that fit in cargo. The asteroid loses exactly the units delivered. A module cannot begin a cycle if the current formula would produce fewer than one unit. If cargo capacity changes during a cycle so that no whole unit fits at completion, the cycle consumes its already committed capacitor but removes no asteroid quantity, and the module stops with a cargo-full notice.

The Mining skill gives +8% module yield per rank. Hull and module bonuses multiply that value. Mining awards experience based on the reference value of resources actually delivered to cargo, with no award for repeatedly activating on an empty or incompatible target.

Belts in danger 2 through 5 may spawn authored hostile patrols. Spawn probability depends on system danger and time spent operating, not player strength. A visible belt-status indicator communicates the region's expected threat band without revealing exact spawn timing.

### 12.3 Jettison and collection

The player may jettison cargo into a container at the ship's location. A new container cannot be created more than once per 60 simulation seconds, but items may be added to an existing owned container within 1 km. Containers persist for 30 simulation minutes and display their expiration time.

Taking items requires being within 1 km and having cargo capacity. NPCs do not steal owned containers unless an encounter description explicitly announces that objective.

### 12.4 Refining

Stations with refining service convert raw resources into processed materials according to displayed recipes.

`refining yield = min(0.95, station base yield + 0.04 × Refining skill rank)`

Station base yield ranges from 60% through 75% and is shown before the station is selected. Whole output units are rounded down. Fractional remainder and material outside the yield are destroyed as waste.

The service fee is 3% of the reference value of the input, multiplied by the controlling-faction standing service multiplier and rounded up. The preview shows exact output, waste, fee, and whether a higher-volume batch would use remainder more efficiently. Refining is instantaneous after confirmation.

## 13. Exploration and anomalies

### 13.1 System sweep

A ship with an online scanner may perform a system sweep while undocked and not in warp. The sweep takes 10 seconds, consumes the scanner's listed capacitor, and reveals all unresolved signatures currently present in the system as entries with unknown type and difficulty band.

Once swept, a signature remains listed until it expires or is completed. The player may bookmark unresolved signatures.

### 13.2 Resolving a signature

The player selects one signature and activates the scanner in repeating eight-second cycles. Each successful cycle adds:

`resolution gain = clamp(5, 50, 20 × current scan strength / signature difficulty)`

percentage points, with total resolution capped at 100%. Resolution persists between visits until the signature expires. Scan strength and signature difficulty are positive displayed values.

Information is revealed at thresholds:

- 0%: signal only;
- 25%: site category;
- 50%: danger tier and environmental hazards;
- 75%: likely reward categories and recommended capabilities;
- 100%: exact site position and Warp command.

If capacitor is insufficient, the next cycle waits in the same manner as other repeating modules. Only one signature may be actively resolved at a time, but previously gained resolution does not decay.

### 13.3 Anomaly categories and resolution

The full game includes:

- hidden resource sites with unusual or concentrated materials;
- hostile sites containing combat and loot;
- caches requiring approach, collection, or scanner interaction;
- environmental sites that alter movement, targeting, defenses, or capacitor;
- rare discovery sites containing recipes, market intelligence, or faction opportunities.

Site rules and hazards are shown at 50% resolution and again before first warp. Hidden negative rules may affect loot contents or enemy arrival but must not invalidate a reasonable preparation based on the preview.

An anomaly completes when its authored primary objective is met. Completion grants exploration experience once. Objects may grant their normal mining, combat, or trade-related rewards in addition. The same site cannot be farmed after completion.

## 14. Planetary resource extraction

### 14.1 Access and ownership

Eligible planets provide a planetary management view divided into resource cells. Each cell has current richness for one or more planetary raw resources.

The player must buy a planetary charter from the controlling station before placing a command center. Charter price and minimum standing are displayed. A hostile standing blocks new charters but does not destroy an existing colony. The player may establish at most one colony on an eligible planet.

The player may own one colony at Planetary Operations rank 1 and one additional colony per further rank, to a maximum of five.

### 14.2 Structures and capacity

Every colony begins with one command center. It supplies command capacity used by all other structures and links. The functional structure types are:

- extractor;
- basic processor;
- advanced processor;
- storage facility;
- spaceport;
- link between two structures.

Each structure states credit cost, command-capacity cost, storage capacity where applicable, recipe or resource assignment, and cycle time. A structure can be placed only if the command center has sufficient remaining capacity and it can reach the intended link.

Resources move only along player-defined routes over links. A route has a source, destination, item type, and maximum units per cycle. If destination storage or route capacity is insufficient, excess output remains at the source; if the source cannot store it, production pauses rather than destroying it.

### 14.3 Extraction and depletion

An extractor is assigned to its cell's resource and operates in 10-simulation-minute cycles.

`units per cycle = floor(extractor base yield × current cell richness × skill and structure modifiers)`

Cell richness is a value from 0.10 through 1.00. Each extracted unit reduces a data-defined local deposit quantity. Richness falls as that quantity is depleted. Deposits regenerate by 10% of their maximum quantity per simulation day until full.

An extractor continues until stopped, rerouted, blocked by storage, or unable to produce one unit. It does not require a real-time restart. Moving an extractor costs 25% of its construction price; demolition returns no credits but immediately frees command capacity.

### 14.4 Processing

Processors use displayed recipes. At cycle start they reserve the exact required inputs from their source storage. At cycle end they place output into their destination route or local storage.

If inputs are missing, the processor waits and shows the shortage. If output has no capacity, it completes the current batch and holds that batch internally, then pauses. Changing a recipe returns any reserved but unprocessed inputs.

### 14.5 Control range and logistics

Planetary Networking controls where the player may inspect and modify colonies:

- rank 0: while at the planet's orbital site;
- rank 1: from anywhere in the same system;
- rank 2: from an adjacent system;
- rank 3: from the same region;
- rank 4: from any discovered region;
- rank 5: anywhere in the galaxy.

Physical import and export always require the active ship to be within 2 km of the planet's orbital customs structure. Transfers move items between ship cargo and customs storage and charge 2% of transferred reference value, multiplied by the controlling-faction standing service multiplier and rounded up.

The spaceport can send colony products to customs storage and receive imported inputs. If customs storage is full, export waits. Planetary goods never teleport directly to a station hangar or fabrication facility.

Colony production advances only in simulation time. The colony list shows current state, time to next output, blocking condition, storage fill, and time until a deposit falls below each projected yield band.

## 15. Fabrication

### 15.1 Recipes and knowledge

Fabrication creates weapons, other modules, ammunition, and consumables from processed, planetary, and advanced materials. Hulls are acquired through ship dealers and rewards rather than fabrication. Every item that can be fabricated has a recipe defining:

- required recipe knowledge;
- required Industry skill and any specialization;
- input items per batch;
- output quantity per batch;
- setup time and time per batch;
- facility fee;
- eligible station facility types.

Basic recipes are known at campaign start or sold by neutral academies. Advanced recipes are purchased from factions, awarded by authored faction opportunities, or found through exploration. Learned recipes are permanent campaign knowledge and do not occupy inventory.

Ordinary weapons, modules, ammunition, and consumables must generally be fabricable so that industry can support normal play. Unique faction or discovery rewards may be non-fabricable. Exact catalog coverage belongs in the applicable current-state document.

### 15.2 Installing jobs

A job may be installed while docked at the facility if all inputs are in the local station hangar, the player meets requirements, a job slot is free, and the fee can be paid.

Base job slots are one plus one per Industry skill rank, to a maximum of six. Jobs at different stations share this limit.

On installation:

- the full displayed fee, including the facility's controlling-faction standing service multiplier, is paid;
- all required inputs move into the job;
- the completion time is fixed from current skills and facility modifiers;
- the job begins immediately.

Fabrication time is:

`(setup time + batch time × batch count) × facility time modifier × (1 - 0.05 × Industry skill rank)`

The time multiplier cannot fall below 50%. Jobs progress in simulation time from anywhere in the galaxy and while the player is in combat, but not while the campaign is closed or paused.

### 15.3 Completion and cancellation

Completed output waits at the facility with no storage fee and may be delivered to that station's hangar remotely. Delivery does not move it between stations.

Cancelling a job returns:

`floor(original input quantity × uncompleted fraction)`

of each input to the station hangar. The completed fraction is elapsed job time divided by total job time. The fee and the processed fraction of inputs are lost, and no partial output is produced.

The jobs view shows progress, simulation completion time, inputs, outputs, station, and any completed job awaiting delivery.

### 15.4 Item quality

Fabricated items are functionally identical to the same item bought or looted. There are no random quality tiers or hidden crafting outcomes. Fabrication skill changes access, time, material efficiency where a skill explicitly states it, and job capacity; it does not create unidentified stat rolls.

## 16. Skills and experience

### 16.1 Skill structure

Skills are grouped into navigation, ship command, weapons, defense, capacitor and engineering, mining, trade, exploration, planetary operations, industry, and faction relations.

Every skill has ranks 0 through 5, a base experience cost, a base credit cost, prerequisites, and a precise effect per rank. Rank 0 means untrained. A requirement of rank 0 means no skill gate.

Skill effects must be one or more of:

- unlocking a hull, module, recipe, service, or remote action;
- improving a displayed numerical attribute;
- increasing a capacity such as targets, jobs, or colonies;
- reducing a displayed cost or time.

Skills must not contain undocumented effects.

### 16.2 Earning experience

Experience is a single spendable pool. It is earned when a meaningful result completes, not merely when an action button is pressed.

Sources include:

- defeating NPC ships, based on their authored threat value;
- completing anomalies and other authored objectives;
- discovering a system or authored landmark for the first time;
- delivering mined resources to cargo;
- positive realized trade profit under section 11.4;
- completing fabrication batches, limited to the first authored experience allowance for that recipe per simulation day;
- exporting newly produced planetary goods, subject to the same daily recipe allowance;
- major tutorial and other one-time authored milestones.

The result preview or completion report shows experience earned and its source. Reversible transfers, buying and immediately selling at a loss, repeatedly fitting modules, and moving items grant no experience.

### 16.3 Learning skills

Learning a rank is instantaneous and may be done while docked at a station with an academy service. It costs:

`experience cost = base experience cost × new rank²`

`credit cost = base credit cost × new rank²`

Prerequisites must already be learned. Both costs and resulting effects are shown before confirmation. There is no training queue and no elapsed training time.

Skills are permanent. The player may eventually learn every skill; there is no hard character class or total skill cap. Specialization arises from increasing rank costs, equipment investment, and access requirements rather than irreversible choices.

## 17. Factions and standings

### 17.1 Faction content

The full game contains multiple major factions, a broadly neutral independent network, and hostile or outlaw factions. Each has:

- controlled or preferred systems and stations;
- ship and encounter identity;
- economic strengths and demanded goods;
- a relation from -1.0 through +1.0 with every other faction;
- standing rewards and restricted content.

Faction identities and the relations needed to predict a standing consequence must be visible before the player can take an optional action that causes that consequence. Other faction information may remain undiscovered until encountered.

### 17.2 Standing changes

Any action that changes standing must define its base change and disclose the affected factions before an optional commitment or immediately after an unavoidable result. Standing changes may be attached to combat, trade or delivery, exploration, and other authored faction objectives.

Standing ranges from -100 to +100. Direct positive standing change with current standing `C` is:

`applied gain = base gain × (1 - max(0, C) / 100)`

Direct negative change is applied at full base magnitude. Final standing is clamped to the allowed range.

When standing with faction A changes by an applied amount, each other faction B receives:

`derived change = applied amount × relation(A, B) × 0.25`

Derived changes do not cascade into further changes. The result screen lists direct and derived changes before they are applied when the action is optional, and immediately afterward when caused by combat.

### 17.3 Standing bands

- **-100 to -50, Hostile:** faction combat ships attack when able; faction stations deny new docking; faction opportunities and restricted trade are unavailable.
- **Above -50 to -10, Distrusted:** docking remains available; service spreads and fees increase; faction opportunities are limited to reconciliation work.
- **Above -10 to below +10, Neutral:** standard services and entry-level faction opportunities.
- **+10 to below +40, Friendly:** 5% service-fee reduction and access to improved faction goods and opportunities.
- **+40 to below +70, Allied:** 10% service-fee reduction and access to advanced faction hulls, modules, and recipes.
- **+70 to +100, Honored:** 15% service-fee reduction and access to the faction's highest standing rewards.

The standing service multiplier is 1.10 when Distrusted, 1.00 when Neutral, 0.95 when Friendly, 0.90 when Allied, and 0.85 when Honored. It applies to repair, refining, fabrication-facility, planetary-customs, and ship-transport fees charged by that faction. It does not change item mid prices, insurance, or authored rewards. Market spread uses its own standing formula.

The standing screen shows current value, band, benefits, penalties, recent causes, and known ways to improve or damage the relationship.

### 17.4 Recovery from hostile standing

Independent stations always offer repeatable reconciliation opportunities for non-outlaw major factions. These may require payments, deliveries, or action against that faction's enemies. They remain available regardless of target-faction standing and provide a route from -100 to above -50 without entering hostile stations.

Outlaw factions may remain hostile by default, but their standing must still be changeable if they have standing-gated player content.

## 18. Progression, access, and end-state

There is no global player level. Content access results from physical location, ship capability, skills, wealth, recipe knowledge, and faction standing.

World danger does not scale to player progress. Tier-1 opportunities remain available after the player becomes powerful, and a new player may enter a tier-5 system if able to reach it. The interface warns but does not impose an invisible level wall.

The game records significant discoveries and accomplishments where they help the player understand progress. Any rewards attached to such milestones must be disclosed and must not create permanently missable power.

The full game has no forced final ending. Authored milestones may acknowledge progress, but the campaign remains playable afterward.

## 19. Interface and interaction requirements

### 19.1 Persistent frame

When a campaign is open, the persistent frame shows:

- current system, site, and danger rating;
- simulation time and time controls;
- credits and unspent experience;
- notifications;
- access to galaxy, assets, skills, factions, industry, colonies, settings, and save controls.

While undocked it additionally shows shield, armor, hull, capacitor, speed, active movement command, locked targets, fitted active modules, and hostile effects.

### 19.2 Space view

The main space view is a two-dimensional schematic representation. It must show:

- the player's ship and facing;
- known ships, structures, resources, containers, and relevant hazards;
- selection and lock state;
- movement vectors on demand;
- weapon, module, lock, and interaction ranges on demand;
- approach, orbit, and keep-range intent;
- damage and repair events near their affected target;
- off-screen direction markers for selected, locked, and dangerous objects.

Zoom changes display scale, not game physics. Labels group or hide according to zoom but dangerous and selected objects remain identifiable.

Right-click or the equivalent opens contextual commands. Common commands also have remappable keyboard shortcuts. Keyboard input may issue discrete commands but never becomes continuous steering.

### 19.3 Object and combat information

The selected-object panel shows identity, faction, attitude, range, relative motion, known defenses, active effects, and applicable commands. Unknown information is marked unknown rather than replaced with false precision.

For a locked combat target, the interface shows:

- current defensive layers when known;
- active hostile and friendly effects;
- each grouped weapon's hit chance or guided damage multiplier;
- whether range, tracking, target size, or target speed is the main limiting factor;
- expected time until the next cycle;
- warp-disruption state.

Combat messages are filterable and summarized. The default view emphasizes causes and important changes rather than displaying every numerical event in a scrolling spreadsheet.

### 19.4 Galaxy and system maps

The galaxy map supports pan, zoom, search, route planning, and overlays for danger, faction control, visited state, known market opportunities, known resources, and tracked destinations.

Routes optimize for one selected policy:

- fewest gates;
- lowest danger;
- avoid hostile factions;
- player-defined avoided systems.

The route preview shows gates, estimated travel distance, highest danger, hostile access, and stale-information warnings. Autopilot may issue sequential warp and jump commands, but it pauses on hostile presence, low capacitor, a blocked gate, or any warning requiring a decision. Autopilot never fights, docks, buys, sells, or accepts risk confirmations automatically.

The system map displays permanent sites, resolved anomalies, unresolved signatures, bookmarks, and current route. It is also two-dimensional and uses the same icon language as the space view.

### 19.5 Station screens

The station hub presents available services as spatially and visually distinct actions. It must not require the player to navigate a dense universal table to find routine functions.

Market, fitting, hangar, repair, refinery, fabrication, academy, ship dealer, and transport screens share:

- consistent item inspection;
- side-by-side comparison;
- location and availability labels;
- clear total cost and resulting balance;
- confirmation for irreversible or expensive actions;
- a back path that preserves uncommitted selections.

### 19.6 Comparisons and explanations

Any two compatible ships, modules, ammunition types, market quotes, or recipes can be compared. Differences are grouped by purpose and beneficial or harmful direction, with neutral treatment where the meaning depends on context.

Every formula-driven preview offers an expanded explanation that substitutes current values into the formula. The player is not required to consult this specification or an external tool to understand a result.

### 19.7 Notifications

Notifications have four levels:

- informational;
- opportunity or completion;
- warning;
- immediate danger.

Immediate danger includes first hostile lock, first warp disruption, shield reaching 25%, armor first taking damage, hull first taking damage, and insufficient capacitor preventing an active defense. These events produce a visible and audible cue. Events that meet the conditions in section 3.3 automatically reduce 4x or 8x time to 1x.

Repeated events are grouped. The player may configure sound and visibility by notification category, but ship-destruction and save-integrity messages cannot be fully hidden.

## 20. Accessibility and quality of life

The complete game must provide:

- remappable keyboard shortcuts for all frequent commands;
- full mouse operation without keyboard timing requirements;
- pause at any point in combat;
- UI scale and text-size controls;
- high-contrast modes;
- shape, icon, and label distinctions in addition to color;
- independent volume controls and optional reduced motion;
- configurable confirmation prompts with a restore-defaults action;
- search and filters for assets, markets, recipes, and skills;
- route, fitting, market, and production previews before commitment;
- an event log and loss report that explain important outcomes.

Routine repetitions may be streamlined with repeat toggles, quantity controls, saved fits, routes, and job templates after the player has learned the underlying action. Automation may not choose combat targets, fits, market trades, skill purchases, or faction consequences for the player.

## 21. Full-game content coverage

The complete content set must exercise the functional range described by this specification:

- regions and systems provide meaningfully different resources, markets, factions, routes, and danger;
- every ship lineup contains distinct choices and a useful progression path;
- modules support every required combat, fitting, mining, scanning, cargo, and control interaction;
- all four damage types have viable offensive uses and relevant defensive tradeoffs;
- trade, mining, planetary extraction, and fabrication use enough goods and recipes to form connected economic paths;
- anomalies cover the defined categories and danger tiers;
- combat encounters use varied combinations of enemy roles, environments, and objectives across the danger tiers;
- every major activity has skills that provide access and meaningful improvement;
- faction content provides both benefits and consequences for positive and negative standings.

Variations created only by changing quantities or enemy hit points are not functionally distinct. A distinct template changes location, objective, composition, hazard, logistical constraint, or decision pattern. Exact content quantities and delivery milestones belong in current-state documents.

## 22. Edge cases and invariants

The following rules always apply:

1. The player must retain a path to a usable ship, neutral station, and basic market after any loss or standing change.
2. No accepted transaction may make credits negative or silently discard an item for lack of space.
3. No physical item may be usable in two locations at once.
4. A preview and its confirmed action must use the same rules; if relevant state changes before confirmation, the preview must refresh and require confirmation again.
5. If a target disappears, dependent commands stop safely and identify the missing target.
6. If an inventory destination fills during a timed action, completed whole output is retained at the source or in the producing structure; it is not silently destroyed.
7. Content expiration cannot remove the site the player currently occupies, a player ship, station inventory, fitted item, active industry input, colony, active authored objective without its stated failure rule, or the player's own unexpired wreck.
8. Standing changes cannot strand the player inside a station or destroy assets at that station.
9. Skills never decrease. A standing decrease cannot invalidate the current ship in space; standing restrictions are checked on docking, purchase, acceptance of a faction opportunity, or job installation.
10. The game must explain why any command is unavailable.
11. Cancelled commands do not refund costs already explicitly committed, but they do not consume later cycle costs.
12. Offline progress is always zero, regardless of system clock changes.
13. Pausing cannot be disabled by difficulty, encounter, or failure state.
14. The game contains no multiplayer, PvP, player alliance, player diplomacy, sovereignty, sector-control, or direct-action piloting behavior.

## 23. Functional acceptance criteria

The complete functionality satisfies this specification when a player can:

1. start from the defined basic ship and learn every core interaction inside the game;
2. navigate the gate-connected 2D universe entirely through ship commands;
3. observe range, tracking, transverse motion, damage types, defenses, and capacitor changing combat outcomes according to the stated rules;
4. fit multiple viable ship roles and understand every fitting constraint and derived-stat change;
5. earn and move physical resources through mining, refining, trade, planetary extraction, exploration, loot, and fabrication without location inconsistencies;
6. progress through experience and credits without real-time skill training or offline production;
7. build positive and negative faction relationships with visible access and economic consequences;
8. pursue every major activity while retaining self-directed progression;
9. enter content above or below current capability without hidden level scaling;
10. suffer meaningful ship and cargo loss while always retaining a viable recovery route;
11. continue playing after completing authored milestones or the most difficult available content;
12. understand important decisions and failures through the 2D visual interface without an external spreadsheet or guide;
13. save, close, reopen, export, and import a campaign without any simulation-time progress occurring while closed;
14. play the entire game without a network connection or another player.
