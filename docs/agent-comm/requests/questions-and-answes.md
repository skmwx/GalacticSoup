# Questions and answers

Coding agents post questions here; the human operator answers them in place.

---

## Q1 — Phase 4 — What should a content change do to an existing campaign?

**Asked:** 2026-09-20 (Phase 4, one-slot save, close and resume). **Blocking:** no.

Technical Specification 11.4 says a save written against different content is rejected unless the
release declares a compatible transition. Phase 4 implements that by checking whether every
definition id the saved state names still resolves in the installed bundle: if they all resolve the
save opens and adopts the installed values, and if one does not the save is refused with a precise
error and left untouched.

Campaign state names no definitions yet, so nothing is refused today. From Phase 5 onwards, deleting
or renaming a definition in `content/` will make an existing development campaign unopenable, and
the interface will offer to start a new one.

That is correct for a released game. If you would rather trade it for smoother iteration while the
game is unreleased, the loader can instead drop a campaign's unresolved references and warn. That
would be a change to the technical specification rather than a local exception, so it needs your
decision.

**Answer:**
Please do not worry about save compatibility, we are in early development stage, saves are not important right now.
---

## Q2 — Phase 11 — Does a weapon's per-cycle round need its own reserve inventory?

**Asked:** 2026-09-21 (Phase 11, targeting, turret, ammunition and reload). **Blocking:** no —
Phase 11 shipped with the reading below, and changing it later is a localised change.

Technical Specification 8.3 says that committed weapon ammunition "moves into explicit reserve
locations" and that "reservations are not flags on items left in a hangar". Functional Specification
9.4 says one round is reserved when a cycle starts and consumed when the shot is applied.

Phase 11 reads the magazine itself as that explicit location: loading a weapon moves rounds out of
cargo and into the ship's fitting store as a charge stack tied to one slot, which is a real move to
a real place rather than a flag. The single round a running cycle holds back is then recorded on the
cycle as `reservedRounds`, and the magazine's available count is reduced by it.

The alternative — splitting that one round into its own reserve inventory for the length of every
cycle — is what a literal reading asks for. It would create and destroy an inventory entity roughly
every 2.5 seconds per weapon and allocate two entity ordinals per shot. It would not prevent
anything: the cycle owns its magazine exclusively, so the round cannot be spent twice.

If you would rather have the literal reading, say so and it becomes a small change in
`src/engine/simulation/combat.ts` plus its tests. Otherwise the technical specification's wording in
8.3 could be tightened to say that a dedicated magazine counts as the explicit location.

**Answer:**

---

## Q3 — Phase 15 — A pilot can own no ship at all; Technical Specification 15.3 says otherwise

**Asked:** 2026-09-25 (Phase 15, destruction, insurance and recovery). **Blocking:** no — Phase 15
shipped with the reading below.

Functional Specification 9.12 grants a replacement starter ship only when the pilot "owns no
flight-ready ship and total credits are below the starter ship reference value". A pilot who loses
their only ship while holding 12,000 credits or more therefore owns no ship at all until they buy
one. Technical Specification 15.3 check 5 says "exactly one active player ship exists", which that
state breaks.

The functional specification outranks the technical one, so Phase 15 implements it: the active ship
may be absent, but only while docked, only when no ship of the player's waits at that station, and
only while the pilot owns a flight-ready ship elsewhere or can afford the starter hull. Buying a hull
while shipless makes it the active ship. A content check keeps the recovery station's starter hull
at or below its reference value (it was 12,960 against 12,000, which would have stranded a pilot
with 12,000-12,959 credits; it is now 11,988).

Proposed wording for Technical Specification 15.3 check 5: "at most one active player ship exists;
when one does, its location agrees with the campaign location; a campaign without one is docked,
and the pilot either owns a flight-ready ship or can afford the starter hull at that station."

**Answer:**

---

## Q4 — Phase 15 — What counts as a "flight-ready" ship, and when is the recovery grant checked?

**Asked:** 2026-09-25 (Phase 15). **Blocking:** no.

Phase 15 reads "flight-ready" as "passes the undock rule", so a bare hull with nothing fitted is
flight-ready. Two consequences are worth a decision:

1. A pilot who buys the bare starter hull with their last credits owns a flight-ready but unarmed
   ship, so they are not owed a grant. Their way out is to recover their wreck, or to be destroyed
   again - after which they are owed one. That is a legal but unpleasant route. Reading
   "flight-ready" as "able to undock with a working weapon and ammunition" would close it, but it
   would add a rule the specification does not state.
2. The grant is checked at destruction, as 9.12 says, and again after any market purchase that
   leaves a shipless pilot below the starter's reference value, which is the only other way such a
   pilot can fall below it. Without that second check, a shipless pilot who buys ammunition before a
   hull could strand themselves. This reads "after destruction" as "at any time after a
   destruction, while no ship has been flown since".

If either reading is wrong, both are small, local changes in `src/engine/domain/recovery/`.

**Answer:**

---

## Q5 - Phase 17 - The recovery grant now uses the starter *ship's* reference value

**Asked:** 2026-09-26 (Phase 17, balance and progression pass). **Blocking:** no. Phase 17 shipped
this change; it is a single function if you want it back.

Functional Specification 9.12 grants a replacement ship when credits are "below the starter ship
reference value". Section 2 separates a hull ("a ship type before fitted modules, cargo, and
ammunition are considered") from a ship. Phase 15 used the hull's reference value alone, 12,000.

The balance simulations showed what that does in play. A pilot who takes the intermediate fit to the
Pirate Base too early usually kills a gunner or two before dying. The bounties and insurance then
leave them with 14,000-31,000 credits:

- that is too much for a grant;
- it buys the bare hull (11,988);
- it does not buy the autocannon to arm it.

The only ways out were to salvage the wreck from the site that killed them, or to be destroyed
again. This happened on all three seeds of the loss scenario, so it is the typical overreach, not
an edge case. Functional Specification 22.1 requires a path to a *usable* ship.

Phase 17 reads the sentence literally:

- **The threshold** is the starter hull plus its original fit plus one full magazine, 32,680
  (`starterReferenceValue` in `src/engine/domain/recovery/rules.ts`).
- **Prices:** the recovery station now sells the basic autocannon, the shield booster and fusion
  rounds at fixed prices no higher than their reference values. Functional Specification 11.2
  already calls for fixed prices here; the booster had been a dynamic listing.
- **Content check:** the check now requires this for the whole starter ship, not just the hull.

A pilot at or above the threshold can always buy the whole ship back, and a pilot below it is
always given one. Insurance still pays on the hull alone.

If you prefer a different reading - for example Q4's "flight-ready means armed" - this can be
reverted in one function and one content check. Q4 itself remains open: a pilot who deliberately
buys a bare hull with their last credits is still not owed a grant.

**Answer:**

---

## Q6 - Phase 17 - Docking does not recharge the capacitor, and nothing warns about it

**Asked:** 2026-09-26 (Phase 17). **Blocking:** no. It needs a specification decision before any
change.

Repair restores shield, armour and hull (Functional Specification 10). The capacitor recharges only
while simulation time passes. The station's services take no time, so a pilot who docks after a
fight and undocks at once leaves with whatever charge they docked with. A booster left running while
looting empties it, and fitting a capacitor battery adds capacity but no charge.

The simulations found this the hard way. Every scripted career that went straight from the Pirate
Patrol to the Pirate Base undocked with 6-8% capacitor and lost the mastery fit. The same fit with a
full capacitor clears the site in every seed. The persistent frame shows capacitor only while
undocked, and the undock warnings in Functional Specification 10 cover ammunition and damaged layers
but not capacitor. A player can therefore walk into this without being told why they lost.

Phase 17 changed no rule. The careers and the browser test now wait docked until the capacitor is
full, as a careful player would, and the ship panel does show the charge. Options for Phase 18/19:

1. Add low capacitor to the undock warnings in Functional Specification 10, and explain it in the
   loss report's "what had stopped working".
2. Recharge the capacitor as part of the free shield repair, or on docking. This is a rule change to
   Functional Specification 10.
3. Leave it, and teach it through the Phase 18 guidance.

Option 1 matches how the specification treats ammunition. Option 2 removes the trap altogether.

**Answer:**
