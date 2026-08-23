---
"@heroiclands/package-build": minor
---

Add the two localization guards that keep a package translated: `lang coverage`
and `lang hardcoded` (#19).

`lang check` already asked whether a localization file is _shippable_. Neither
of the questions that decide whether it is _translated_ was asked anywhere but
in the Song of Heroic Lands repository, in two scripts of its own — and both
satellites ship `lang/` files with no guard at all.

**`lang coverage`** — every key the package references exists, and every key it
declares is referenced. The two halves are not the same severity: a referenced
key that is missing renders to a player as its own raw key string and fails the
run; a declared key nothing references is reported and does not, because no scan
sees every way a key is reached and a guard that fails over one teaches people
to switch it off.

**`lang hardcoded`** — every user-visible literal in the templates goes through
localization, and every template still compiles once it does. This is the
_reverse_ walk, and it is the reason both exist: coverage walks key → file and
is blind to a template that names no key whatsoever. Before the work that
prompted this guard, SoHL had 516 hardcoded English literals across 61
templates, and translating every key in `en.json` would have left every one of
them in English.

**What a repository states.** Which files to scan is configuration and defaults
to the conventional layout, so a repository that follows it declares nothing.
The escape hatches — a key retained despite looking unreferenced, a literal
allowed despite looking like prose — each carry a required `reason`, because
each is a claim a reviewer has to be able to check.

**What stays the repository's.** `packageBuild.lang.references` names a module
exporting `references(context) -> ReferenceSet`, contributing the keys only that
repository's conventions can find — SoHL's `defineType(prefix, def)` mints one
key per member of an enum by a rule of its own. Everything Foundry-shaped is
built in: `{{localize}}`, `game.i18n.localize` / `format`, keys in string and
template literals, a DataModel's `LOCALIZATION_PREFIXES`, and the field
`label` / `hint` keys Foundry mints off one.

Scripts are read through the **AST**, so a key named in a JSDoc `@example` is
neither required to exist nor able to keep a dead key alive. `typescript` and
`handlebars` become runtime dependencies for that reason.
