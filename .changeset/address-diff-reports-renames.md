---
"@heroiclands/package-build": minor
---

**`content-build addresses diff` reports every published address a build has
stopped publishing, and tells a rename from a removal** (#66).

A package's `(type, shortcode)` addresses are a published interface — every
satellite declaring `itemCatalog: true` assembles its beings out of them — but
nothing compared one release's addresses against the next, so renaming a
shortcode cost nothing and produced no signal. The check that got made instead
was a repository-local grep, which cannot see the other repositories and reports
the reassuring answer. `sohl` renamed `weapongear:Tabri` to `weapongear:Taburi`
two days after the `v0.8.2` tag both satellites pin, stating that nothing
referenced the old value; five lookups across two repositories do, and they fail
the moment either pin moves.

```bash
gh release download v0.8.2 -p system.zip -D build/baseline
npx content-build addresses diff --from build/baseline/system.zip
```

Run against `sohl` today that reports 20 findings — 8 renames and 12
withdrawals — including the `Tabri` one, at the line of the note that made it:

```text
assets/content/Weapons/Melee/Taburi.md:12:1: warning: since sohl@0.8.2, weapongear:Tabri is no longer published; the same document (s5D6QJbw7ZbETxdN) is now published as weapongear:Taburi. Every package that resolves weapongear:Tabri breaks when it moves past sohl@0.8.2
```

**A rename is told from a removal by the document id, which is an identity match
rather than an inference.** A note authors its `_id` in frontmatter and it is not
derived from the shortcode, so it survives a rename. Where the id is published
under no address at all, the finding says only that — _withdrawn_, naming no
successor. A split, a deletion and a merge are indistinguishable at that point,
and a "did you mean" guessed from string similarity would send the reader to the
wrong fix.

Both findings are warnings and neither fails a build: retiring content is
legitimate, and so is renaming — the shortcode charset rule forces some. What a
rename must not do is happen in silence. `--strict` reports both as errors and
exits non-zero, for a release workflow that wants a gate.

Additive: nothing runs unless the command is invoked, and no existing behaviour
changed.
