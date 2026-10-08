# Human playtest script - MVP release candidate

This is the playtest that MVP Scope 9.3 requires. The automated gate has passed (see
`release-candidate-report.md`), but it cannot answer the product question:

> Is it enjoyable to prepare a ship, command it through a tactical encounter, earn rewards, improve
> the fit, and use that improvement to overcome a harder encounter?

Only you can. The MVP is not complete until your result is recorded at the end of this file.

Allow about two hours: one unguided session of 60-90 minutes and one of 20-30 minutes that visits
what the first may have missed. Keep notes as you go. The moments where you were confused, bored or
pleased matter more than whether you finished.

## Setup

1. In the repository run `npm run build`, then `npm run preview`. Open `http://localhost:4173`.
2. Use a browser profile that has never opened the game: a private window is enough. If the start
   screen offers "Resume campaign", start over with "Reset campaign" once inside.
3. Play Session 1 in a Chromium-based browser (Chrome or Edge) and Session 2 in Firefox, or the
   other way round. Both are release targets.
4. Play on a desktop with a mouse and a keyboard, sound on.

The game needs no network once the page has loaded. You may unplug to check; loading the page again
still needs `npm run preview` to be running.

## Session 1 - play it cold (60-90 minutes)

Start a campaign and play. Do not read the README, the specifications or the rest of this script
first. Follow the game's own guidance (the "Flight school" panel) or ignore it, as you would with
any new game. Aim to clear the Pirate Base, and stop when you have, or when you no longer want to
continue. Either is a result.

While you play, note the time and a few words whenever:

- you did not know what to do next, or where a control was;
- something happened and you could not tell why (a miss, a loss, a refused command, a price);
- you made a choice you cared about (what to buy, whom to shoot first, when to leave);
- you were waiting with nothing to decide;
- you wanted to do something the game did not let you do;
- the picture stuttered or the controls lagged. The automated gate times the engine, not the
  drawing, so this is the only check of how smoothly the space view runs, above all at the Pirate
  Base.

For reference only after the session: the balance simulations clear the Pirate Base on the fourth
sortie of a new campaign (two at the Pirate Scout, one at the Pirate Patrol, then the Base) and
again on the fifth, in 32-34 minutes of simulation time, which does not count time spent paused at
the station. If you needed three times as many sorties, or never got there, that is worth saying.

### Questions after Session 1

Answer each with yes, partly or no, and a sentence of why.

| # | Product question, clause by clause | Acceptance criterion |
|---|---|---|
| 1 | **Start.** Did you understand what the station offers and what to do first, without help? | MVP-AC-01, MVP-AC-10 |
| 2 | **Prepare.** Could you tell what an item would do for your ship before you bought or fitted it? Did you ever undock unprepared without having been warned? | MVP-AC-02 |
| 3 | **Command.** Did ordering the ship (orbit, approach, keep range, warp, dock, lock, fire, modules) feel like commanding rather than fighting the interface? | MVP-AC-03 |
| 4 | **Understand.** When a fight went well or badly, could you say why - range, tracking, damage type, shield and armour, ammunition, capacitor? | MVP-AC-04 |
| 5 | **Pressure.** At the Pirate Patrol, did the order you killed things in, your range and your modules change the outcome? | MVP-AC-05 |
| 6 | **Rewards.** Did the bounties and the loot give you a decision at the station, rather than one obvious purchase? | MVP-AC-06 |
| 7 | **Improve and overcome.** Did a better or better-suited fit let you beat a site you could not beat before, and did that feel earned? | MVP-AC-07 |
| 8 | **Repeat.** After the Pirate Base, would you play another sortie? Did replaying a site feel like a way forward or like a chore? | MVP-AC-09 |
| 9 | **Enjoy.** Was the loop as a whole enjoyable? What was the best moment, and the worst? | Product question |

## Session 2 - what the first session may not have reached (20-30 minutes)

Use the other browser. Resume is per browser, so this is a new campaign. Tick each item and note
anything that surprised you.

**Retreat and loss (MVP-AC-08)**

- [ ] Fly to the Pirate Patrol in the ship you were given, take some damage and Retreat. You should
      get home, and the site should be offered again.
- [ ] In Services, use "Improve insurance", then fly the starter ship to the Pirate Base and let it be
      destroyed. Read the loss report. Does it tell you what killed you, what you lost, what
      survived, what the insurance paid and how you were given a ship?
- [ ] Recover what survived from your wreck (it is offered as a destination), come home, and clear
      the Pirate Scout again. Did losing a ship feel like a setback you could recover from, rather
      than either nothing or the end?

**Close and reopen (MVP-AC-01)**

- [ ] In the middle of a fight, press "Close campaign", load the page again and resume. The fight
      should be exactly where you left it.
- [ ] Close the browser window altogether while docked, wait a minute and come back. The simulation
      clock should not have moved.

**Input and presentation (MVP-AC-03, MVP-AC-10)**

- [ ] Fight the Pirate Scout with the keyboard alone, using the keys the buttons show.
- [ ] Fight it again with the mouse alone, pausing to give orders.
- [ ] In Settings, change the interface size, the text size, the contrast and reduced motion. Is the
      game still readable and usable at each?
- [ ] Rebind one key in Settings and use it.

**Explanations (MVP-AC-04, MVP-AC-10)**

- [ ] In the Market, compare two weapons or two kinds of ammunition. Can you tell which you want and
      why?
- [ ] In a fight, open the hit-chance explanation in the Weapons panel. Does it explain a miss?
- [ ] Find a disabled button anywhere. Does it say why it is disabled?

## Known before you start

So that these do not cost you time; they are not blockers. `release-candidate-report.md` has the
full list.

- The simulation starts paused. Nothing moves until you press Resume.
- At the station with the clock running, a Confirm button may answer "Something changed while you
  were deciding" and need a second press. Nothing was charged wrongly. Pausing avoids it.
- There is one campaign slot and no manual save list; the game saves by itself.
- There is no map. A site is chosen in Departure, or from the warp control in space.
- Loading the page again needs the local server; the installable offline package is deferred.

## Result

To be filled in by the human operator.

- **Date:**
- **Browsers used:**
- **Reached the Pirate Base?** In how long?

| # | Answer (yes / partly / no) | Why |
|---|---|---|
| 1 Start | | |
| 2 Prepare | | |
| 3 Command | | |
| 4 Understand | | |
| 5 Pressure | | |
| 6 Rewards | | |
| 7 Improve and overcome | | |
| 8 Repeat | | |
| 9 Enjoy | | |

**Session 2 findings:**

**Decision** (MVP Scope 9.3) - choose one:

- [ ] **Accepted.** The loop is understandable, repeatable and enjoyable enough to justify
      expanding the game. The MVP is complete.
- [ ] **Not yet.** List what must change. Each item becomes a session-sized tuning or usability
      phase, and the release gate runs again afterwards. This does not expand the MVP.

**What must change, if anything:**
