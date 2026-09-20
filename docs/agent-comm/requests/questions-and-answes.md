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