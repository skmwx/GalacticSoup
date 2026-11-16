# Human playtest route - v0.2 Combat Progression Alpha

This is the human product review that v0.2 Implementation Plan phase 6 schedules and acceptance
criterion **V02-AC-15** requires. The automated balance evidence (`reports/balance.md`) says the
fits differ, the hulls progress and the economy pays; it cannot say whether that is *enjoyable*:

> Does choosing a fit, earning a larger hull and applying the right tactics produce satisfying
> combat progression - "I used to fear that encounter; now I crush it"?

Only you can answer that. V02-AC-15 stays open until your result is recorded at the end of this
file. Anything you find becomes a tuning or usability change, and the affected evidence is run
again.

Allow about three hours over two or three sittings. Keep notes as you go: moments of confusion,
boredom and satisfaction matter more than whether you finish.

## Setup

1. In the repository run `npm run build`, then `npm run preview`, and open the address it prints.
2. Use a browser profile that has never opened the game (a private window is enough). If it offers
   "Resume campaign", start over with "Reset campaign" once inside: v0.1 campaigns cannot be
   continued in v0.2 by design.
3. A desktop with a mouse, a keyboard and sound.

## The route

Play unaided first: do not read the specifications, the balance report or the "For reference"
notes below until each stage is done. The stages are an order of experiences, not instructions:
reach each one however you like.

### Stage 1 - start unaided (about 30 minutes)

Start a new campaign and follow the game's own guidance, or ignore it. Clear the Pirate Scout, then
spend your money.

Note: what you bought first and why; whether the station made the choice clear.

### Stage 2 - try contrasting fits (about 30 minutes)

On the frigate, fly at least two different fits against the entry band (Knife Fight, Longshot
Picket, Missile Picket). For instance: autocannons with an afterburner and an armour repairer,
then guided launchers with a shield booster.

Note: did the two fits *feel* different - where you stood, what you watched, what went wrong? Did
the briefing ("Decision", "Recommended", "Weak fits") match what happened?

### Stage 3 - an explainable failure (about 15 minutes)

Take a fit somewhere its briefing warns against - a developed or fit-sensitive site such as
Armored Hold or Range Check in the frigate - and lose, or retreat.

Note: can you say, from the game alone (the loss report, the combat explanations, the briefing),
*why* it went wrong and what would counter it?

### Stage 4 - buy both hull upgrades (about 60 minutes)

Earn and buy the destroyer, move equipment across, fit it, fly it. Later, earn and buy the cruiser.
Switch between your ships at the station at least once.

Note: was the bare-hull price clear, and was it clear that the hull arrives empty? How long did
each upgrade take, and did the wait feel like progress or like grinding? Did you ever not know
which ship was active, or where a module had gone?

### Stage 5 - revisit an earlier threat (about 15 minutes)

Go back to the site that beat you in Stage 3 - or the one that frightened you most before the
upgrade - in the new hull with a suitable fit.

Note: did it feel like "I used to fear that encounter; now I crush it"? Was a larger hull *also*
worse somewhere (the fast frigates of Knife Fight or Range Check, or the cost of medium rounds)?

### Stage 6 - recover from a loss (about 15 minutes)

Lose a purchased hull, ideally the destroyer or the cruiser. Read the loss report.

Note: did insurance, your stored ship and the easy sites make the loss a setback rather than the end
or nothing? Was the stored ship where you expected, and was it clear what it still carried?

### Stage 7 - the advanced band (about 30 minutes)

Try the advanced band: Pirate Base, Bombardment Line, Screened Battery, Command Group.

Note: did the four feel different from each other? Did you have to change fit or tactics between
them, or did one fit do everything?

## Questions after the route

Answer each with yes, partly or no, and a sentence of why.

| # | Question | Acceptance |
|---|---|---|
| 1 | **Distinct fits.** Did two fits for the same hull ask for different decisions in combat (range, movement, defence, capacitor), and were both worth using somewhere? | V02-AC-04, V02-AC-15 |
| 2 | **Hull progression.** Did each larger hull make a formerly dangerous site clearly easier - "I used to fear it; now I crush it"? | V02-AC-11, V02-AC-15 |
| 3 | **Still choosing.** After the cruiser, did fit and site choice still matter, or did one ship and fit do everything? | V02-AC-04 |
| 4 | **Explainable failure.** Could you explain at least one failure and its counter from in-game information alone? Which one? | V02-AC-15 |
| 5 | **Pacing.** Did the time to each purchase feel right? Too fast, too slow, or grindy at a particular stage? | V02-AC-11 |
| 6 | **Loss.** Was losing a larger hull recoverable without feeling meaningless? | V02-AC-12 |
| 7 | **Enemies.** Could you tell the fast frigate, artillery, brawler, missile ship and web controller apart by how they fought? | V02-AC-08 |
| 8 | **Information.** What did you want to know that the game did not show, or showed unclearly (guided application, web effects, comparisons, the ship list, the destination briefings)? | V02-AC-14 |
| 9 | **Enjoyment.** Was the progression satisfying overall? Best moment, worst moment. | Product question |

Also record: any fit you found dominant; any site you found pointless or impossible; anything that
felt like an exploit.

## For reference, after you have played

These are what the scripted pilots measured (`reports/balance.md`). If your experience differs a
lot, that is worth saying: the pilots play perfectly consistent, not necessarily well.

- **Pacing (hull-ladder career, three seeds).** The pilot buys a second autocannon at once, the
  reference autocannon frigate after 1-2 Pirate Patrol clears, the destroyer package after 9
  sorties and the cruiser package after 13-14 more: 62-72 simulated minutes from a new campaign,
  not counting time paused at the station. With every module drop left behind: the destroyer after
  10-11 sorties, the cruiser after 15-16 more.
- **Fits.** On each hull the two reference fits trade places by site: autocannons beat guided
  launchers on the frigate at Knife Fight and lose at Longshot Picket; blasters with a web beat
  artillery on the destroyer at Armored Hold and lose at Longshot Picket; guided launchers beat
  railguns on the cruiser at Knife Fight and lose at Crossfire.
- **Hulls.** The best frigate fit loses or retreats at Armored Hold; the destroyer clears it. The
  destroyers clear the Pirate Base slowly or with repair bills; the railgun cruiser clears it fast
  and unhurt. The railgun cruiser mostly cannot clear Knife Fight or Range Check.

## Known before you start

- v0.1 campaigns are refused with an explanation; start a new campaign.
- There is one campaign slot and no manual save list; the game saves by itself.
- Hulls cannot be sold back in this release; modules and goods can.
- The simulation starts paused at the station.

## Result

To be filled in by the human operator.

- **Date:**
- **Browser:**
- **Stages reached, and time taken:**

| # | Answer (yes / partly / no) | Why |
|---|---|---|
| 1 Distinct fits | | |
| 2 Hull progression | | |
| 3 Still choosing | | |
| 4 Explainable failure | | |
| 5 Pacing | | |
| 6 Loss | | |
| 7 Enemies | | |
| 8 Information | | |
| 9 Enjoyment | | |

**Dominant fits, pointless sites, exploits:**

**Decision** (V02-AC-15) - choose one:

- [ ] **Accepted.** Fit decisions are distinct and hull progression is satisfying. V02-AC-15 is met.
- [ ] **Not yet.** List what must change. Each item becomes a tuning or usability change, and the
      affected balance evidence and this route are run again.

**What must change, if anything:**
