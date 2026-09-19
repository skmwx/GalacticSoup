# Galactic Soup Game Design Brief

## Purpose and authority

This document describes the complete intended game at the design level. It translates the game concept into a coherent player experience and gives direction to the functional specification.

The source of truth above this document is `human-input/GameConcept.md`. This brief must not contradict or expand the scope established there. It defines the character of the game, the relationships among its major activities, and the principles that should guide later decisions.

This brief does not define an MVP or development sequence. Exact rules, formulas, screen behavior, content quantities, and edge cases belong in the functional specification. Architecture, data structures, and implementation choices belong in the technical specification.

## Game summary

**Galactic Soup** is a single-player space game about becoming more capable through combat, exploration, mining, trade, fabrication, and long-term investment.

The player begins in a simple, inexpensive ship with limited means. By taking opportunities, gaining experience, accumulating wealth, and making increasingly informed choices, the player acquires better ships and equipment and gains access to more demanding content.

The game draws inspiration from the satisfying solo activities of EVE Online while leaving behind multiplayer competition, social obligations, sovereignty, real-time skill training, and an interface designed for massive fleet battles.

## Player fantasy

The player is an independent spacefarer building a place in a large interstellar world.

Early decisions concern basic survival and improvement. Over time, the player develops knowledge, resources, skills, equipment, and faction relationships. Greater capability enables the player to travel farther, face stronger opposition, pursue more valuable opportunities, and operate on a larger economic scale.

Progress should feel earned through preparation and good decisions rather than through direct-action piloting or passive waiting.

## Design pillars

### Preparation creates advantage

Ship choice, outfitting, knowledge, and planning should matter. Progress improves the player's options, but choosing an appropriate approach remains important.

### Activities form a connected whole

Combat, exploration, mining, trade, planetary extraction, fabrication, skills, and faction standings should support one another. They are different ways to advance within the same game rather than unrelated minigames.

### The player commands rather than pilots

The player issues orders and manages ship systems instead of steering continuously with direct movement controls. Play centers on reading the situation, choosing actions, and adapting those choices as circumstances change.

### Growth expands possibilities

Better ships, equipment, skills, wealth, and relationships should open new strategies and content. Progress should not reduce the game to one universally correct ship, activity, or career.

### Complexity remains legible

The game may contain deep interactions, especially in combat and outfitting, but the information needed to make decisions should be visible and understandable inside the game.

### Single-player needs come first

Pacing, challenge, progression, and interface design should serve one player. Mechanics inherited from multiplayer games should be retained only when they strengthen the single-player experience.

## Core player loop

The game follows a broad repeating loop:

1. Choose an opportunity or goal.
2. Gather enough information to make a plan.
3. Select and outfit a suitable ship.
4. Travel and perform one or more activities.
5. Convert the outcome into wealth, materials, experience, equipment, access, or standing.
6. Use those gains to pursue a more ambitious goal.

This loop should support both focused activities and goals that connect several systems. For example, a desired module might be bought through trade, fabricated from mined resources, or obtained through another activity. The functional specification will define which alternatives exist and how they work.

## World structure

The game takes place in a two-dimensional universe of stellar systems connected by gates. Systems contain objects such as planets, stations, asteroid belts, and anomalies.

The world should give location meaning. Different places should present different opportunities, resources, factions, and dangers, giving the player reasons to travel and learn the universe. The precise distribution and behavior of world content are functional-design decisions.

Movement within and between systems is command-driven. The world is represented at a level that supports useful spatial decisions without requiring manual flight through empty space.

## Major activities

### Combat and outfitting

Combat is against NPC opponents and may involve several enemies. Its intended depth comes from the interaction of active and passive defenses, capacitor management, damage types, range, weapon tracking, and transverse velocity.

Outfitting is the main way the player prepares a ship for a role or situation. Different ship lineups and equipment choices should support distinct strengths and tradeoffs. The player should be able to understand why a fit is suitable without relying on external tools.

The functional specification will define combat timing, available commands, calculations, enemy behavior, fitting constraints, and the consequences of victory or defeat.

### Trade, mining, and fabrication

Trading with NPCs, mining in space, and fabricating weapons and modules form an economic path through the game. Materials and goods should connect these activities so that acquiring, moving, using, and transforming resources all have value.

These activities should offer meaningful progression alongside combat rather than existing only to support it. Their exact economic rules, production chains, and degree of simulation belong in the functional specification.

### Planetary resource extraction

Planetary extraction provides a management-oriented activity inspired by farm-style games. It contributes resources to the wider economy and gives the player a form of progress distinct from operating a ship.

The functional specification will determine its interaction model, pacing, production rules, and relationship with fabrication.

### Exploration

Exploration gives the player reasons to enter unfamiliar systems and investigate anomalies. It should reward curiosity and extend the value of the world beyond known routes and routine activities.

The types of discoveries, the means of finding them, and their rewards remain functional-design decisions.

### Skills

Skills represent the player's growing capability. Their progression is based on experience, economic investment, or a combination of the two, never passive wall-clock training.

Skills should allow specialization while supporting the broader fantasy of gradually gaining access to more capable ships, equipment, and activities. The skill structure and progression rules belong in the functional specification.

### Factions and standings

Factions and standings give the player's actions a wider context and provide another form of progression. Relationships with factions should matter to the player's opportunities without introducing multiplayer diplomacy, alliances, sovereignty, or sector control.

The functional specification will define how standings change and what effects they have.

## Progression shape

The overall progression follows the player fantasy established in the concept:

- At the beginning, the player has a cheap ship, limited resources, and access to relatively modest opportunities.
- As competence and resources grow, the player can specialize, maintain better equipment, and engage with more demanding parts of the game.
- In the long term, the player can pursue powerful ships, advanced equipment, difficult content, and larger economic or industrial goals.

Progress may come through wealth, experience, equipment, knowledge, production capability, and faction relationships. These forms of progress should reinforce one another without forcing every player through exactly the same sequence of activities.

The game is a continuing progression experience rather than a multiplayer contest. The functional specification may define milestones and high-level goals, but they should remain consistent with the fantasy of self-directed advancement.

## Interaction and presentation

Combat, stellar-system navigation, and the galaxy map are presented in two dimensions using simple, schematic graphics. The purpose of the visual system is to make position, movement, range, objects, threats, and available actions easy to understand.

The interface should take advantage of the game's single-player scale. It should favor visual representation and contextual information over spreadsheet-like presentation intended for very large battles.

The player gives commands to the ship and activates relevant systems. The functional specification will define the command set, information hierarchy, interaction flows, time controls, and feedback.

## Scope boundaries

The complete game includes the activities and systems named in the concept: NPC combat, ship lineups, outfitting, trading, space mining, planetary extraction, fabrication, skills, factions, standings, exploration, and a gate-connected two-dimensional universe.

The game excludes multiplayer, PvP, player alliances, player diplomacy, sovereignty, sector control, direct-action piloting as the primary control model, and three-dimensional play.

This scope describes the intended complete game. Delivery phases and the current implementation state are defined in separate current-state documents.

## Design guardrails

Later specifications should preserve these principles:

1. New features should strengthen a core activity or a connection between activities.
2. Complexity should produce meaningful decisions rather than bookkeeping alone.
3. Progress should expand viable choices rather than create one universally best path.
4. Preparation and understanding should remain important as the player becomes stronger.
5. Important information should be understandable through the game's own interface.
6. Single-player pacing takes priority over conventions inherited from online games.
7. No feature should introduce multiplayer dependency, social obligation, or wall-clock skill training.
8. The schematic two-dimensional presentation should remain sufficient to understand every important spatial relationship.

## Decisions deferred to later documents

The functional specification is responsible for defining exact player-visible behavior, including combat rules, progression rates, economic behavior, exploration mechanics, faction effects, failure and recovery, commands, screens, and interaction flows.

The technical specification is responsible for defining how that behavior is implemented, subject to the technical constraints in the game concept.

Current-state documents are responsible for selecting which part of the complete game is delivered in the MVP and each later phase. They may narrow the work being implemented, but they do not redefine the game described here.
