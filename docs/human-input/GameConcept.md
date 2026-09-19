# High-level concept

We are making a space trading, exploration, mining and fighting game.

I played EVE online, and I found fun as a solo player; I didn't like the whole cutthroat PvP MMO thing.

The concept of this game with a working name Galactic Soup is to replicate the fun single-player parts, while leaving MMO mechanics and interface behind.

## Player fantasy

Start in a simple cheap space ship, fly around, fight, explore, build; get richer and more experienced, buy better ships, outfit better weapons, become stronger and more powerful, unlock more content now that you are stronger.

# Scope

## Game parts that are in:
- Combat versus multiple NPC opponent
- Combat complexity: managing active and passive tanking, capacitor, damage types, range, tracking vs tranverse velocity
- Different space ship lineups
- Outfitting
- Trading with NPCs
- Space Mining
- Planetary 'farmville'-style resource extraction
- Fabrication
- Player skills, but let's make it experience-based and/or economy based, not wall clock based.
- Factions and standings

## Game parts that are out:
- Multiplayer and PvP
- Everything related to player alliances, player diplomacy, sovereignity and sector control.

## Graphics

There will be no 3d graphics. The game will happen in a 2d Universe. Combat, solar system map, galaxy map, all 2d. The graphic will be simplistic, schematic, the goal is to implement a visual system sufficient to understand what's going on.

## User Interface
EVE Online interface was informed by the necessity to scale to a thousand ship combat.

We don't expect such a case in our game, the interface will rely more on visual representation and less on spreadsheets.

## What player controls
Same as in EVE Online, the player does not control the ship directly, doesn't fly it with WASD or a controller; player is giving the ship commands, and the ship performs them.

# Technical considerations

## Implementation style

The game will be coded 100% by coding agents (Codex, Claude Code), the human creator providinng the direction, but not contributing to the codebase.

## Technology
We'll use Typescript / HTML, with simplistic SVG graphics where necessary.

## Client-server
The game is fully client-side using local storage.

That said, the implementation must maintains a strict separation between the layers as if it was a client-server game. There should be clear separation between UI -> commands -> engine -> persistence.

It should be possible with relative ease to change this "clint-side only Typescript" decision later and go full Java server.

## Settings and constants
Game constants should be grouped logically and stored in a human-readable format, they should be separated from the engine code.