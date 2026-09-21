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
