# Phase 17 completion note - Balance and progression pass

Status: complete. Date: 2026-09-26.

Implements Phase 17 of `docs/MVPImplementationPlan.md`. The authored data now meets every
progression and recovery objective in MVP Scope 4.3 under repeatable simulation, and no
representative fit is the best choice at every site.

The evidence is in `reports/balance.md`. `reports/` is gitignored, so `npm run balance` regenerates
it in about 3 minutes. The candidate tuning bundle and its fixture seeds are tracked in
`tests/fixtures/balance/candidate.json` for release-candidate comparison.

One engine defect the simulations exposed was fixed: the recovery-grant threshold (see Engine). Two
findings need a human decision and are posted as Q5 and Q6 in
`docs/agent-comm/requests/questions-and-answes.md`.

## MVP Scope 4.3, as measured

| Objective | Result |
|---|---|
| 1. Enter the easy site immediately | The starter fit clears the Pirate Scout 6/6 with nothing bought. |
| 2. A meaningful choice, not every upgrade | Every module on sale is affordable alone, but no two weapons or propulsion modules together. The starting credits buy the intermediate fit or the poor purchase, not both, and neither mastery fit. |
| 3. A decision within a few encounters | 1-2 multi-opponent clears pay for the mastery upgrades; 1-2 mastery-site clears pay for the long-range fit. |
| 4. An upgrade materially improves the next tier | Patrol: starter 0/3, intermediate 6/6. Base: intermediate 4/6 and loses 58% of its hit points; mastery 6/6 and loses 7%. |
| 5. Replay recovers from poor purchases and losses | Poor purchase back to the intermediate fit in 3-4 easy sorties. After a lost ship, back to it in 1. |
| 6. The hard site through the intended loop | New campaign to two Pirate Base clears in 5 sorties, 35-40 simulated minutes, every credit earned in play. |

## Balance simulations

All of them run headlessly through the protocol only, and all are deterministic per seed.

### The encounter matrix

`tests/fixtures/scenarios/progression.json` now sets all four representative fits (`starter`,
`intermediate`, `mastery`, `lancer`) against all three sites. It also holds three extra scenarios:

- `scout.folly`: the poor purchase at the easy site;
- `patrol.intermediate-marksman-first`: the wrong target order;
- `base.intermediate-brawl`: a reckless first visit to the base.

Each scenario carries **bands**, and the band replaces Phase 16's `minimumCompletedShare`. A band
holds any of: completed share, median fight seconds, hit points lost, and damage taken.

`progression.test.ts` runs the scout, patrol and failing base scenarios. `progressionMastery.test.ts`
runs the two mastery fits at the base.

### Dominance witnesses

`progression.json#dominance` names, for each representative fit, a site where another fit's band on
some measure is strictly better than its own:

| Fit | Outperformed by | At | On |
|---|---|---|---|
| starter | intermediate | patrol | completed share (0 vs 1) |
| intermediate | mastery | base | hit points lost (0.3-0.9 vs 0-0.2) |
| mastery | lancer | base | damage taken (1300-2600 vs 400-1200) |
| lancer | mastery | patrol | completed share (0 vs 1) |

`tests/unit/content/balanceFixtures.test.ts` proves from the bands alone that every fit has such a
witness, so none is universally dominant. The simulations hold the measurements to the bands.

### Careers

`tests/support/balance/career.ts` with `tests/fixtures/balance/careers.json` flies whole campaigns
from a new campaign. Nothing is set directly. A plan equips fits and flies scenarios until a goal is
met: completions, a loss, or enough credits for a fit. Each fly step has a sortie budget; exceeding
it stalls the career, and the budget is the band.

Between sorties the pilot:

- sells loot the plan has no use for, and keeps modules and charges a later fit uses;
- repairs, resupplies and buys back reserve rounds;
- waits docked until the capacitor is full (see Findings).

After a loss it carries on from whatever the recovery rules leave it.

| Career | Plan | Measured |
|---|---|---|
| scout-first | 2 scouts, intermediate, patrol until mastery is affordable, 2 bases | 5 sorties, 35-40 min |
| long-range | intermediate, patrols, mastery, bases until the lancer is affordable, 2 lancer bases | 5 sorties, about 71 min |
| poor-purchase | armour-tank folly, scouts until intermediate, 1 patrol | 4-5 sorties |
| loss-recovery | intermediate, reckless base brawl (lost), recovery grant, scouts until intermediate, 1 patrol | 3 sorties |

Every career also holds running costs as a band:

- every cleared site pays more than its repairs and resupply;
- across the career, repairs and resupply take 3-35% of what the sites paid. Measured: 5-11%.

There is one file per career under `tests/integration/balance/`, so they run in parallel.
`startingWallet.test.ts` holds objective 2.

### Reports and the candidate

Each balance test writes a section to `reports/balance/`. `scripts/balance-report.mjs` joins the
sections into `reports/balance.md` and `.json`: the 4.3 objectives table, the dominance table, the
encounter matrix, and every career with its per-sortie economics.

`npm run balance:record` also writes `tests/fixtures/balance/candidate.json`, which records:

- the content version and hash;
- a **tuning digest**: rules, definitions and listings only, from `scripts/lib/content/tuning.mjs`;
- all six seeds;
- each scenario's and each career seed's headline figures.

`npm run balance` compares a new report against that record and lists what moved. A unit test fails
when the installed tuning digest differs from the recorded one, so a tuning change cannot leave the
candidate stale unnoticed. Text-only content edits do not trip it.

### Diagnostics

Two changes to the content diagnosis (`tests/support/progression/diagnostics.ts`):

- **Orbiting opponents.** The model moved every opponent radially, so it thought railguns hit
  orbiting cutters every time. It now gives orbiters their full speed as transverse motion, in both
  directions. It therefore explains why the long-range fit loses the patrol: the layers break at
  about 111 s.
- **Kiting fits.** The model's documented blind spot is that it puts every brawler in range from
  the first second. It now names that blind spot instead of raising a false warning. When the
  tactics hold a range and no brawler can close on the ship within the fight, "overwhelmed" becomes
  a note that says so. Such a brawler is either slower, as against mastery with its afterburner, or
  too little faster, needing about 472 s against the lancer. The intermediate fit at the base, which
  the brawlers do catch, keeps its warning.

The pilot now records the lowest share of hit points reached during a fight, and each sortie records
the damage taken.

## Tuning (content only)

All ids are stable; every change is a value change.

| What | Before | After | Why |
|---|---|---|---|
| Gunner ammunition, reserve rounds | fusion, 120 | phased, 80 | Phased still lands at 10 km and is strong against shields, so the base now demands range control. Fewer reserve rounds keep the best mastery tactic winning every seed. |
| Warden guns | 1 autocannon | 2 autocannons (phased) | Tier-3 pressure. The intermediate fit no longer kites the base safely, and the long-range fit gains a real niche. |
| Bounties: cutter / marksman / gunner / warden | 6,000 / 9,000 / 8,000 / 12,000 | 4,000 / 5,000 / 6,000 / 9,000 | Patrol 21,000 to 13,000, base 37,000 to 26,000. Phase 16's economy finished the whole loop in 5 sorties with wallets of 130-165k. |
| Alloy / circuitry value (reference and base price) | 2,500 / 4,200 | 1,400 / 2,400 | Salvage roughly matched the bounties. |
| Alloy / circuitry starting stock (target 60 / 40) | 20 / 12 | 45 / 30 | The stations started scarce, so salvage also sold at a 20-35% premium. |
| Harbour autocannon / shield booster / fusion | 12,960 / ~9,180 dynamic / 10 | 12,000 / 8,500 fixed / 9 | Required by the recovery fix: the whole starter ship is fixed-price at or below reference, as Functional Specification 11.2 asks. |
| Pirate Base description | - | mentions the warden's two guns and the phased rounds' reach | The disclosure matches the site. |

The pacing is now:

- the starting credits buy the intermediate fit;
- one or two patrols buy the mastery upgrades;
- one or two base clears buy the railguns.

Loot still adds real value (module drops especially), but it no longer doubles every bounty.

## Engine

- **Recovery threshold (Q5).** `starterReferenceValue` now values the starter **ship**: hull, original
  fit and one magazine, 32,680. The shipless invariant uses the same value. The simulations showed
  the old hull-only threshold (12,000) stranded the typical overreaching pilot: 14-31k credits, too
  rich for a grant, able to buy a hull, unable to arm it. The content check `checkRecoveryReach` now
  requires the whole starter ship to be stocked at fixed prices no higher than its reference values.
  The loss-report text says "a starter ship with its original fit".
- No protocol, campaign-state or save-format change. Protocol 12, save format 9.

## Findings worth retaining

- **Docking does not recharge the capacitor (Q6).** Every career that flew straight from the patrol
  to the base undocked with 6-8% capacitor and lost the mastery fit. The same fit with a full
  capacitor wins every seed. Nothing warns the player. The careers, scenario refits and browser test
  now rest docked until charged. A rule or warning belongs to Phase 18/19 after the specification
  decides.
- **Nearest-first is the competent tactic at the base.** Engaging a fixed order - gunners first -
  lets the others close; mastery won only 2/8 that way in the harsher tuning. The fixtures and the
  browser pilot now target the nearest opponent. Phase 18's guidance should teach it.
- **End-of-fight hit points hide risk.** The booster tops the shield back up, so mastery and the
  lancer looked equally safe. Damage taken separates them.
- **The Phase 16 reload trap still stands.** Fire does not queue behind a reload. Unchanged, and
  still Phase 18/19 material.
- **Q3 and Q4 remain open.** Q5 narrows Q4 but does not answer it.

## Test changes caused by this phase

- Loss tests separate the hull's reference value (insurance) from the ship's (recovery threshold).
  The shipless cases start with enough credits to buy the starter ship back.
- The component loss screen, the shipless accessibility audit and schema parity reach a shipless
  pilot by selling the autocannon first.
- The schema-parity loss also arrives at 30 km, so its booster runs dry and the report has a
  disabling effect.
- Wallet figures moved:
  - the browser loss test: 8,000 and 11,600;
  - the loss integration test: 11,600;
  - the station component test: fusion sells at 9 and buys at 7, and 10 rounds leave 19,910.
- The minimal fixture pack's turret and charge now sell at or below their reference values.
- The warden's slot-plan test expects two turrets.
- The browser progression test:
  - expects the new bounties (13,000 and 26,000);
  - sells circuitry when present;
  - waits docked for a full capacitor;
  - engages the base nearest first, running the booster below 80% shield.

## Results

- `npm run verify` passes:
  - typecheck, architecture and content validation, including the floor;
  - **1144 unit tests** (was 1136);
  - **103 integration tests** (was 97);
  - **90 component tests**;
  - traceability: 112 requirement ids, all covered;
  - the production build.
- `npx playwright test` passes all **46** browser and accessibility tests on the first run. The
  progression test is the long pole at 18.8 minutes of 1x play, including the docked capacitor rest.
- `npm run balance` takes about 3 minutes wall time and finds 0 differences from the recorded
  candidate. The integration suite now takes about 150 s (was about 107 s), because the balance
  files run within it in parallel.
- One flake, not caused by this phase: the inventory property test
  (`tests/unit/engine/inventory.test.ts`, "conserves every unit...") runs close to its 5 s timeout
  when all 64 unit files run in parallel. It timed out once in four `verify` runs and takes 1.6 s
  alone. It was left unchanged.

## Handoff to Phase 18

- Answer Q6 before writing the undock and failure explanations. Low capacitor is today's most likely
  unexplained loss.
- The guidance should teach engaging the nearest brawler and holding range at the base, and killing
  the cutters before the marksman at the patrol. The simulations show both decide those fights.
- If a later phase changes combat rules, re-run `npm run balance`. The report lists what moved
  against the candidate. Re-record only once the new numbers are the intended ones.
