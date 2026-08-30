---
"@heroiclands/package-build": minor
---

Compile actors without an Item pack of this package's own (#49).

The actors pass threw unless the package declared at least one pack of type
`Item`. An Item pack is system-bound by construction — Foundry requires `system`
on Item packs and on few others — so the guard asked a deliberately
system-agnostic module to declare the very thing it exists not to depend on.

**This is not hypothetical, and it is not a future case.** `harn-ensemble`
declares two Actor packs and no Item pack at all in its
`package-build.config.yaml` today. Run against that configuration, the compiler
does not start:

```text
packs declared   : actors-hm3(Actor), actors-sohl(Actor)
itemPackJsonDirs : []
Actors           : THREW — Actors compiler requires `itemsSourceDirs` …
```

Its 2,512 beings resolve their embedded items — `skill:awar`, `attribute:str`,
`weapongear:…` — against the `sohl` and `hm3` catalogues through
`foreignSourceDirs`. The optional mechanism is the one that matters there; the
mandatory one had nothing to contribute.

**The guard did not test what it claimed.** It counted _declared directories_,
not resolvable items. An Item pack containing no documents satisfied it, while a
being naming an item nothing defines still failed later — so it neither
prevented the failure it named nor reported it where it happened. And its
remedy, "declare at least one pack of type `Item`", is the opposite of the fix
for a system-agnostic package.

**The condition actually cared about was already checked, at the site of the
mistake.** `resolveEmbedded` reports each unresolved `(type, shortcode)` by
name, with the being as context, and counts it — and those counts aggregate into
`totalErrors`, so a package genuinely missing an item still fails the build:

```text
Bandit: no predefined item for "skill:awar"
```

That is the same line #43 and the frontmatter-lint work drew: a structural
precondition that is cheap to state is not the condition you care about, and
reporting where the mistake is beats refusing to start.

**Nothing tightens.** `itemsSourceDirs` defaults to `[]` and is otherwise
unchanged; `foreignSourceDirs` is untouched; `itemPackJsonDirs` already returned
an empty list for a repository with no Item packs, and only the constructor
rejected it. A package that declares Item packs behaves exactly as before — the
1,647 existing tests pass unchanged, with four added for the empty case and for
the point-of-use error that replaces the guard.

**Bump**

_Minor, not patch._ No consumer that compiled before fails now — the change only
removes a refusal — but a configuration that was rejected is now supported, which
is new surface rather than a repair to existing surface. Not major for the same
reason: nothing that was accepted stops being accepted.

Part of #57, which is the same defect in three places: a key that both describes
and gates, so the legitimate case cannot be expressed. Here the gate is removed
and the description — which Item packs this package ships — is left saying only
that.
