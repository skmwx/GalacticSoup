# MVP review 03 - completion note

Source: `human-input/MVP-review-03.md`. Implemented in one session.

## What changed

### Weapons panel
- **Top row unchanged:** Fire, Cease fire and Reload all, which act on every weapon at once, with the "Aimed at ..." line beside the heading.
- **One entry per weapon, in slot order.** The old grouping ("2 x 200mm Autocannon - Fusion S" with a block per group) is gone. Each entry is one line:
  - the weapon's name, which opens and closes its details;
  - a round **cycle clock**, which fills as the shot approaches (dashed ring while reloading, a cross when stopped);
  - the magazine as an ammunition icon and `20/20 (100)`: loaded / magazine size (rounds of that charge in the hold). It turns amber when empty. Hovering shows the same in words ("Fusion S: 20 of 20 rounds loaded, 100 more in the hold"), and screen readers read that;
  - an icon-only **reload** button;
  - a **fire / cease-fire switch**, lit green while the weapon repeats.
- Under the line, one short status: `Firing at Pirate Scout`, `Reloading - 3.4 s`, `Stopped: ...`, `Idle`. The stop reason stays visible because Functional Specification 9.4 requires it. The countdown moved into the clock.
- **Folded details**, in the review's order:
  1. Charge selector and **Load**. The charge's damage and ranges are shown only when the chosen charge is not the loaded one, because the loaded charge's figures are the weapon's own, listed just below.
  2. Optimal / falloff / reach.
  3. Hit chance (`73%`) and **Main strain** (`Range 0.65 (tracking 0.177)`), with no advice on what to do about it. The hit-chance calculation stays behind its own disclosure (Functional Specification 19.6 requires it).
  4. Expected damage a shot (`13.1 before resistances (Explosive 13.5 · Kinetic 4.5)`).
- Tracking (rad/s) is no longer a separate readout. It appears in the hit-chance calculation.

### Modules panel
- Each active module is one line: name (opens its details), cycle clock, **on/off switch** (a power icon, lit green while running).
- The clock replaces the "cycle ends in 2.5 s" text on the line. The words remain in its tooltip, for screen readers, and in the details.
- **Waiting for capacitor** and **stopped for a reason** still show on the line in amber, beneath the name, and the clock changes shape (a bar or a cross). An empty capacitor stopping a booster should not be hidden behind a click.
- The details hold the status sentence, the description ("+40 Shield every 4 s ...") and the calculation.
- Passive modules: name with a "Passive" tag; their effect is in the details.

Number-key toggles (1-4), E/Q/V and every accessible name ("Activate Small Shield Booster", "Fire weapon 1", "Reload weapon 1", "Load into weapon 1", "Charge for weapon 1") are unchanged.

## Code
- New `src/ui/space/CycleClock.tsx`. New `power` icon in the action icon set.
- `WeaponsPanel.tsx` and `ModulesPanel.tsx` were rewritten; new entry styles are in `Space.module.css` and the old group/limit styles were removed.
- `weaponGroups` / `WeaponGroup` were removed from `tactical.ts` and the UI index; nothing else used them.
- The UI catalogue changed: new short labels; the limiting-factor messages no longer give advice; `cockpit.weaponControls`, `tactical.weapons.group`, `.slot` and `.hitChance` were removed.
- No engine, protocol, content or save change, so no fixtures were re-recorded.
- Functional Specification §19.3: "each grouped weapon's hit chance" now reads "each weapon's". One paragraph was added describing the compact weapons and modules lists.

## Tests changed
- `tests/component/CombatScreen.test.tsx`:
  - the hit-chance test now checks the compact line (clock, `n/n (n)` magazine, reload, fire switch);
  - it opens the folded details before reading the hit chance, the main strain, the expected damage and the formula;
  - it checks that the strain no longer gives advice;
  - the module test opens the booster's details to read its description.
- `tests/browser/combat.spec.ts`: the second sortie expects two weapon entries with Fusion S loaded, not the old "2 x ..." group heading.
- `tests/accessibility/combat.spec.ts`: the mid-fight audit opens every weapon and module entry before opening every explanation, so the folded content is audited too.

## Verification
All passing:

- `npm run typecheck`, `check:architecture`, `traceability`.
- Unit: 1404 tests.
- Component: 143 tests.
- Playwright `browser` and `accessibility` (Chromium): all 69 tests.
  - The full run had two failures. One was the accessibility audit, which could not reach the now-folded explanation; the test was fixed.
  - The other was a one-off in `station.spec`, which does not touch this code and passed when re-run.
  - Both specs were re-run and passed.

Integration, performance, Firefox projects and `release:gate` were **not** run. No engine, content or fixture code changed.

Screenshots (1440x900, paused mid-fight) are in `release/mvp-review-03/`:

- the compact panel;
- the weapon and module entries expanded;
- the magazine tooltip.
