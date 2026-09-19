# Galactic Soup — Game Design Brief

## Document purpose and authority

This document defines the complete intended game at the design level. It translates the high-level concept into a cohesive player experience and provides direction for later functional and technical specifications.

The source of truth above this document is `human-input/GameConcept.md`. This brief must not contradict that concept. It describes what the game should feel like, how its major systems support one another, and what belongs in the full-game vision. Exact formulas, screen behavior, data schemas, and implementation details belong in later specifications.

This is a full-game design brief, not an MVP definition or development plan.

## Game summary

**Galactic Soup** is a single-player, command-driven space sandbox about building power through trade, exploration, mining, industry, and tactical combat.

The player begins with a cheap, limited spacecraft and modest opportunities. By learning how the universe works, taking calculated risks, and combining several economic and combat activities, the player acquires wealth, skills, reputation, ships, equipment, and industrial capacity. Each gain opens more dangerous regions, more capable enemies, more valuable markets, and more ambitious projects.

The game captures the satisfying solo progression, fitting decisions, economic interdependence, and layered combat associated with a large space MMO, while removing multiplayer competition, social obligations, real-time skill queues, and interfaces designed for battles involving hundreds of players.

## Player fantasy

The player is an independent spacefarer who gradually becomes a capable and influential force in a living interstellar economy.

At first, every replacement module and cargo purchase matters. Later, the player can maintain a stable of specialized ships, survive hostile space, exploit distant resources, operate planetary industries, manufacture advanced equipment, and choose which factions to support. Power is earned through knowledge and preparation as much as through statistics.

The intended emotional arc is:

1. **Vulnerability** — the universe is larger and more dangerous than the player's current means.
2. **Competence** — the player learns to fit ships, read situations, and turn local opportunities into reliable income.
3. **Specialization** — the player chooses ships, skills, markets, industries, and relationships that express a preferred style.
4. **Reach** — stronger capabilities make distant places and advanced activities practical.
5. **Mastery** — the player can plan and execute complex, self-directed goals across combat and industry.

## Design pillars

### 1. Preparation creates advantage

Success begins before a ship enters danger. Ship selection, fitting, cargo, intelligence, route choice, damage profile, engagement range, and retreat options should materially affect the outcome. Better numbers help, but an informed setup should outperform an unsuitable one.

### 2. Interlocking paths to power

Combat, mining, exploration, trade, planetary extraction, fabrication, skills, and faction standings are not isolated minigames. Each produces resources, knowledge, access, or demand that feeds other activities. The player should regularly see several viable ways to solve an economic or progression problem.

### 3. Command, observe, adapt

The player gives orders rather than directly piloting with continuous movement controls. The challenge is to understand the tactical picture, issue meaningful commands, manage ship systems, and revise the plan as ranges, velocities, threats, and resources change.

### 4. Visible growth with meaningful tradeoffs

New ships and modules should feel powerful without making all earlier choices irrelevant. Larger or more advanced equipment brings costs, fitting demands, operational constraints, and tactical weaknesses. Progress expands the player's options and scale rather than collapsing the game into one universally best ship.

### 5. A legible two-dimensional universe

The presentation is schematic and functional. Spatial relationships, movement, range, hazards, targets, routes, and system state should be understandable at a glance. Visual clarity has priority over spectacle, but the interface should still create a strong sense of place and scale.

### 6. A rich sandbox without multiplayer friction

The game provides uncertainty, danger, market opportunities, loss, rivalry, and faction consequences through authored systems and NPC simulation. It does not depend on PvP, player alliances, social scheduling, sovereignty wars, or an always-online population.

## Core player loop

The moment-to-moment and long-term game form a repeating loop:

1. **Choose a goal** — earn money, obtain a resource, improve a standing, learn a skill, build an item, acquire a ship, explore a location, or defeat a threat.
2. **Gather information** — inspect markets, routes, known sites, faction conditions, enemy profiles, available resources, and current capabilities.
3. **Prepare** — select and outfit a ship, arrange cargo and supplies, plan a route, and decide how much risk to accept.
4. **Travel and act** — move through connected stellar systems and trade, mine, scan, manage colonies, manufacture, or fight.
5. **Respond** — adapt to discoveries, price differences, depleted sites, hostile forces, damage, and changing tactical conditions.
6. **Return and convert gains** — sell cargo, refine or fabricate materials, repair and refit, claim rewards, improve standings, and invest experience.
7. **Expand capability** — unlock or afford new tools that make a previously impractical goal achievable.

The loop should support short opportunistic sessions as well as long, multi-stage plans. A player might complete a quick local trade, or spend several play sessions establishing the supply chain for an advanced combat ship.

## World structure

### The galaxy

The game world is a network of stellar systems connected by gates. Geography matters: routes concentrate traffic and opportunity, remote areas make logistics harder, and access to resources, markets, services, factions, and dangers varies by region.

The galaxy contains safer areas suitable for early progression and increasingly hazardous areas whose rewards justify stronger ships and better preparation. Danger is communicated clearly enough for deliberate risk-taking, while imperfect information preserves discovery.

### Stellar systems

Each system is a navigable two-dimensional space containing some combination of:

- stars, planets, moons, and other celestial landmarks;
- stations and service locations;
- gates to neighboring systems;
- asteroid belts and other resource sites;
- known and hidden anomalies;
- faction, civilian, industrial, and hostile activity.

The player moves between meaningful locations within a system by issuing commands. The system view presents relevant spatial and tactical information rather than simulating manual flight across empty distances.

### A changing but dependable world

The world should feel active through changing prices, resource availability, anomaly discovery, faction presence, and NPC threats. Change should create opportunities rather than invalidate the player's work arbitrarily. Stable regional identities and learnable patterns allow planning; variation prevents routes and activities from becoming completely mechanical.

## Major game activities

### Combat

Combat is real-time, command-driven, and usually pits the player's ship against multiple NPC opponents. It rewards fitting knowledge, target prioritization, positioning, range control, and active resource management.

Its defining considerations are:

- active and passive defenses;
- finite capacitor or equivalent ship energy;
- distinct damage types and defensive resistances;
- weapon ranges and effectiveness bands;
- weapon tracking in relation to target size and transverse velocity;
- mobility, approach, orbit, distance-keeping, and disengagement;
- multiple hostile roles that create target-priority decisions.

Enemies should use recognizable ship roles and tactics. Encounters become harder through more demanding compositions, environments, and decisions—not only through larger health and damage values.

Combat loss must matter enough to create tension, but recovery should remain possible. The game should encourage players to assess whether to engage, change fittings, bring a different ship, or retreat.

### Outfitting and ship lineups

Ships are platforms for distinct jobs and tactical styles. Lineups span different sizes, costs, fitting capacities, defenses, mobility profiles, and role bonuses. No single progression ladder replaces every earlier hull; specialized work continues to reward specialized ships.

Outfitting is a central expression of player intent. Weapons, defenses, propulsion, energy management, utility, mining, exploration, cargo, and support modules compete for limited fitting space and ship resources. Every fit represents compromises among effectiveness, resilience, flexibility, endurance, and cost.

The interface should make fit consequences understandable before purchase or deployment. Experimentation is encouraged, but the game does not require external spreadsheets to explain basic performance.

### Trading

NPC markets have regional supply, demand, and price differences. Trading gameplay comes from finding opportunities, choosing cargo, planning routes, and balancing margin against travel time, capacity, capital, and risk.

Markets also connect the rest of the game: miners and planetary operations supply materials; combat and industry consume equipment; loot and exploration produce unusual goods; fabrication transforms inputs into more valuable outputs. The economy should make location and logistics meaningful without attempting to reproduce a multiplayer market.

### Space mining

Mining converts time, ship capacity, fitting choices, and exposure to danger into raw materials. Resource types are geographically and environmentally distributed, giving players reasons to explore and operate farther from safe hubs.

Mining should involve more judgment than waiting for a cargo hold to fill. Site choice, target selection, yield, depletion, storage, transport, hostile interruption, and fitting tradeoffs all contribute. More capable operations improve efficiency and access, but require greater investment and risk.

### Exploration

Exploration reveals anomalies, resources, hazards, caches, hostile encounters, unusual trade goods, and other valuable opportunities. It rewards suitable equipment, attention to incomplete information, and willingness to travel beyond familiar routes.

Discoveries should support several player types: combat pilots find encounters, industrial players find resources and knowledge, and traders find rare goods or temporary opportunities. Exploration provides surprise and renews the world beyond fixed station-to-station routines.

### Planetary resource extraction

Planets support a light management layer inspired by farm-style production games. The player establishes extraction and processing operations, configures production chains, and periodically collects or redirects their output.

Planetary industry provides predictable, long-horizon production in contrast to active ship-based work. It should reward planning and expansion without relying on punishing real-world timers or demanding constant check-ins. Its products feed fabrication and trade.

### Fabrication

Fabrication turns acquired resources and components into weapons, modules, consumables, and other useful goods. The player obtains production knowledge, assembles supply chains, chooses what to build, and decides whether to use or sell the result.

Industry should make self-sufficiency possible as an earned specialization, not an early-game obligation. Buying remains a valid alternative. Advanced products draw from multiple activities and regions, creating ambitious logistical goals and reasons to diversify.

### Skills

Skills represent the character's learned capability and unlock or improve meaningful options. Progress is based on earned experience, economic investment, or a combination of the two; it is never gated by passive wall-clock training.

Skills support specialization in ships, combat systems, navigation, mining, trade, exploration, planetary operations, and fabrication. Early choices should create identity without permanently trapping the player. Broad mastery is a long-term achievement, while focused competence arrives soon enough to enable experimentation.

### Factions and standings

Factions give political and economic shape to the galaxy. The player's actions change standings, which influence access, prices, services, missions or opportunities, and hostility.

Faction choices should create consequences and tradeoffs without forcing the player into multiplayer diplomacy or territorial governance. Relationships provide context for combat and commerce: helping one group can make another less cooperative, while neutrality and repair of damaged relations remain possible at a cost.

## Progression and economy

Progression operates through several connected forms of capital:

- **Financial capital:** currency, inventory, ships, fittings, and industrial assets.
- **Character capability:** skills and access to more demanding equipment or activities.
- **Knowledge:** discovered locations, market understanding, enemy information, recipes, and regional familiarity.
- **Relationships:** standings and faction-specific access.
- **Infrastructure:** planetary operations, production capability, stored resources, and a fleet of fitted ships.

No single form should completely substitute for all others. A wealthy but inexperienced player can buy options but may use them poorly; a skilled pilot still needs material means; an industrial specialist benefits from exploration, trade, or combat relationships.

The economy must preserve meaningful decisions at every stage. Income and asset values rise over time, but running costs, replacement risk, advanced inputs, and larger ambitions continue to create demand. The game avoids mandatory grinding by offering multiple productive activities and by ensuring that the next important goal is visible and attainable.

## Full-game arc

### Early game: survival and orientation

The player operates near accessible stations in a basic ship. Goals are concrete: complete safe jobs, win small fights, mine common resources, discover nearby systems, make first profitable trades, and learn how fitting changes performance. Losses are recoverable and lessons are clearly surfaced.

### Mid game: specialization and expansion

The player owns several purpose-built ships and begins choosing preferred income and combat styles. Regional travel, stronger opponents, faction relationships, advanced production, and planetary extraction become important. Goals increasingly require preparation across more than one system or activity.

### Late game: mastery and ambitious projects

The player can reach dangerous space, field advanced ships, manufacture complex equipment, and exploit high-value opportunities. Challenges test complete builds and operational planning through difficult multi-ship encounters, hazardous expeditions, scarce supply chains, and consequential faction access.

Late-game play remains open-ended. The player defines success through goals such as completing a ship collection, mastering a profession, building an industrial network, reaching the hardest regions, maximizing faction access, accumulating wealth, or defeating the most demanding combat content. The game may acknowledge major mastery milestones, but it should not end the sandbox or reduce all play to a single final mission.

## Challenge, risk, and failure

Challenge should be understandable and attributable. When the player fails, the game should expose useful causes: an unsuitable damage profile, poor range control, capacitor exhaustion, excessive transverse velocity, an overextended route, or an unprofitable supply chain.

Risk comes from committing assets and time under uncertainty. The player controls risk through intelligence, preparation, ship cost, route choice, cargo exposure, and willingness to retreat. High-value opportunities may demand danger, but core recovery paths remain available in safer regions.

Failure can mean ship loss, damaged standings, wasted inputs, lost cargo, or missed profit. It should produce new decisions rather than a dead save. The player must always have a credible route back to productive play.

## Mission and content philosophy

Structured objectives provide onboarding, faction context, directed challenges, and short-term purpose. They coexist with self-directed sandbox play rather than replacing it.

Content should combine:

- authored introductions and milestone challenges;
- reusable activity patterns with varied locations, opponents, resources, and constraints;
- discoverable anomalies and temporary opportunities;
- systemic goals generated by markets, fabrication needs, standings, and player ambition.

Repetition is acceptable when the decision context changes. Repeating an identical optimal action without new tradeoffs is not the intended source of longevity.

## User experience and presentation

### Interaction model

The player controls the ship through discrete orders and system activation, not direct WASD or controller flight. Commands should be easy to issue, their current state should remain visible, and the likely effect of important actions should be previewed where practical.

The game is designed around the scale of a single player's encounters. It should favor direct manipulation, spatial views, concise summaries, and contextual detail over dense tables built for fleet command.

### Visual language

All primary play spaces are two-dimensional: combat space, the stellar-system view, and the galaxy map. Graphics are simple and schematic, using shape, color, motion, lines, range indicators, and icons to communicate state.

The visual identity should suggest an instrument panel or navigational chart without becoming sterile. Consistency and readability take priority over realism. Important differences must not rely on color alone.

### Information hierarchy

At any moment, the interface should answer:

- Where am I, and what can I reach?
- What is my ship doing now?
- What is threatening or useful?
- What ranges and movement relationships matter?
- Which ship resources are changing, and why?
- What will this order, module, transaction, or production choice cost and accomplish?
- How does the current activity advance my goal?

Advanced detail should be available on demand. The default view communicates the decision; inspection explains the underlying factors.

### Learning and onboarding

The player learns through small, safe examples embedded in real play. Early objectives introduce travel, fitting, combat, trade, mining, exploration, production, and standings in a deliberate sequence while allowing the player to deviate.

Explanations should connect cause and effect. Tooltips, previews, combat feedback, and post-event summaries teach the systems so that eventual mastery can happen inside the game rather than through external guides.

## Tone and setting direction

The setting should support a vast, utilitarian spacefaring civilization: trade routes, industrial settlements, competing factions, dangerous frontiers, and remnants or anomalies worth investigating. The tone favors independence, competence, and discovery over a chosen-one narrative.

Humor or eccentricity may exist—the working title allows personality—but must not undermine the clarity of the world or the satisfaction of building a serious spacefaring operation. The player's story is primarily expressed through accumulated ships, journeys, relationships, discoveries, and projects.

## Accessibility and quality-of-life principles

The game should respect the player's time and make complex systems approachable without removing their depth.

- The player can pause or otherwise obtain sufficient thinking time in a single-player environment where appropriate.
- Routine actions can be streamlined after the player understands them.
- Comparisons expose meaningful differences among ships, modules, goods, and production choices.
- Warnings protect against obvious accidental losses without preventing deliberate risk.
- Saves are local and play does not depend on a network connection.
- Interface scale, input alternatives, readable contrast, and non-color indicators are considered from the start.
- Real-world waiting is not used as a substitute for progression or challenge.

## Scope boundaries

The full game includes:

- command-driven combat against multiple NPC opponents;
- layered fitting and combat interactions involving defenses, capacitor, damage types, range, tracking, and transverse velocity;
- multiple spacecraft lineups and specialized roles;
- outfitting and ownership of multiple ships;
- NPC trading and a regional economy;
- space mining and distributed resources;
- exploration and anomalies;
- planetary resource extraction and processing;
- fabrication of weapons, modules, and related goods;
- experience- and/or economy-based skill progression;
- factions, standings, and their consequences;
- a two-dimensional galaxy of gate-connected stellar systems;
- entirely local single-player play.

The full game excludes:

- multiplayer and PvP;
- player alliances and player-to-player diplomacy;
- sovereignty and player control of sectors;
- direct-action piloting as the primary control model;
- three-dimensional navigation or combat;
- progression based on mandatory real-world waiting;
- an interface designed around massive fleet battles.

## Design guardrails

Future specifications and features should preserve the following:

1. A proposed system should strengthen at least one core activity or a connection between activities.
2. Complexity should create decisions; complexity that only adds bookkeeping should be simplified or automated.
3. New equipment should add roles, tradeoffs, or combinations rather than only numerical tiers.
4. Dangerous rewards should be tempting, legible, and avoidable until the player chooses to pursue them.
5. The player should be able to recover from failure without restarting the game.
6. Single-player pacing takes priority over conventions inherited from online games.
7. Important information must be understandable in the game itself.
8. Economic, skill, and faction progression should open options rather than prescribe one correct career.
9. The schematic 2D presentation should remain sufficient to read every important spatial relationship.
10. No feature should quietly reintroduce multiplayer dependency, social obligation, or wall-clock gating.

## Full-game success criteria

The design succeeds when:

- a new player can understand a useful first goal and make progress without outside research;
- outfitting a ship feels like forming a plan, and combat tests that plan in readable ways;
- mining, exploration, trade, planetary extraction, fabrication, and combat each stand as worthwhile activities while also feeding one another;
- gaining a ship, skill, standing level, or industrial capability reveals meaningful new possibilities;
- the player can pursue different careers and switch direction without invalidating the save;
- the galaxy feels geographically varied and worth learning despite its schematic presentation;
- late-game power supports larger ambitions without eliminating risk, logistics, or specialization;
- the player experiences the depth and long-term satisfaction of a space MMO's solo systems without its PvP pressure, social overhead, or time-gated progression.
