---
"@heroiclands/package-build": major
---

Separate declaring a system from requiring one, and stamp `_stats` per pack
(#48).

A module shipping content for two systems could not say so. The only place to
state a system version was `relationships.systems`, and that list is a
**restriction**: Foundry's `supportsSystem` drops a package from any world whose
system it does not name. So the two needs were in direct conflict — name your
systems and become unloadable elsewhere, or stay loadable and stamp nothing.

**`harn-ensemble` is the case, and it is live.** It declares an `actors-hm3`
pack and an `actors-sohl` pack, and resolves to:

```json
{ "statsSystemId": null, "statsSystemVersion": null }
```

Nothing stamped, on content that was certainly built against `hm3 1.6.3` and
`sohl 0.8.2`. It takes that path deliberately, because declaring the two systems
would hide the module from every other world — including the ones that want only
its system-neutral journals pack.

**The split.**

|                   | describes                                    | gates                       |
| ----------------- | -------------------------------------------- | --------------------------- |
| `systems:`        | which systems this package can stamp against | **nothing**                 |
| `requiresSystem:` | —                                            | where the package will load |

Naming a system under `systems:` restricts nothing. `requiresSystem` is separate
and optional, and emits the `relationships.systems` entry Foundry reads —
_reusing_ the declaration rather than restating it, because
`stats.systemVersion` sat at `0.6.0` for four releases when a transcription was
free to disagree with what it copied.

```yaml
systems:
  hm3: { compatibility: { minimum: "1.6.3", verified: "1.6.3" } }
  sohl: { compatibility: { minimum: "0.8.2", verified: "0.8.2" } }
requiresSystem: null # optional; omitted, the package loads anywhere
```

**A pack's `system:` now selects what stamps its documents.** `_stats` was one
memoised block for the whole package, so every document in every pack was
stamped identically. It is per pack now: `statsForPack()` resolves the pack's
declared system through `systems:`, and `BasePackCompiler` exposes it as
`this.stats`, memoised per instance — one pass, one pack, one system.

**`systemId` travels with `systemVersion`.** They are one decision, so where one
is omitted both are. Stamping a per-pack version against a package-wide id would
emit `systemId: sohl, systemVersion: 1.6.3` on HM3 documents — a plausible lie,
which is worse than the missing value #43 fixed, because nothing about it looks
wrong.

**A name that resolves to nothing is an error.** A pack's `system:` must name a
declared system; `requiresSystem` must too; and with a gate set, a pack naming a
_different_ system is refused outright — Foundry would hide the whole package
from any world that pack could have appeared in, so it would ship and be
unreachable.

**Nothing that ships today moves.** All six consumers were resolved before and
after; none declares a `systems:` block yet, so every pack still falls through to
the package-wide block it used before:

| package              | `systems:` | `requiresSystem` | stamps         | packs unchanged |
| -------------------- | ---------: | ---------------- | -------------- | --------------- |
| `sohl`               |          0 | —                | `sohl / 0.8.2` | yes             |
| `sohl-thalorna`      |          0 | —                | `sohl / 0.8.2` | yes             |
| `sohl-kethira-basic` |          0 | —                | `sohl / 0.8.2` | yes             |
| `harn-ensemble`      |          0 | —                | `— / —`        | yes             |
| `harn-adventures`    |          0 | —                | `— / —`        | yes             |
| `hm3`                |          0 | —                | `hm3 / 1.6.3`  | yes             |

**`stats.systemId` and `stats.systemVersion` are refused outright.** Authoring a
derived value is an error rather than an override, which is the rule this
configuration already applies elsewhere — and the reason is the same one that let
`stats.systemVersion` sit at `0.6.0` for four releases: a transcribed copy is
free to drift from what it copied, and nothing reads a stamped `_stats` until
something migrates on it. The refusal names the key, its line, and what supplies
it now.

The value still has to reach the validator from the loader, which is the half
that may read the adjacent `package.json`. It travels under a **symbol**, so the
channel is not a second, forgeable spelling of the key just refused: a symbol
cannot be written in YAML and does not appear in `Object.keys`.

**`relationships.systems` keeps working, and still answers.** It carries
`itemCatalog` — a separate concern this split does not replace — so a repository
using it would otherwise have to restate its compatibility under `systems:`
purely to keep stamping, which is the duplication the change exists to remove. A
lone relationship is a declaration as much as a gate, so it derives `systemId`
too. Several have no single answer and get none.

**Every consumer was migrated in the same change.** One line each:

```diff
 stats:
-    systemId: sohl
     lastModifiedBy: sohlbuilder00000
```

`sohl` and `hm3` are systems and are their own system by construction;
`sohl-thalorna` and `sohl-kethira-basic` derive it from the single system
relationship they already declare; `harn-ensemble` and `harn-adventures` declared
none and were already clean.

**Bump**

_Major._ `stats.systemId` and `stats.systemVersion` were accepted and are now
refused, so a configuration that resolved before can fail — which is the
definition this repository uses. Every HeroicLands consumer is migrated in
lockstep and verified to stamp exactly what it stamped before, but a consumer
outside that set must delete the two keys.

Part of #57, the third of its three keys that both describe and gate. #56 is
done, #49 shipped in 6.2.0, and this is #48.
