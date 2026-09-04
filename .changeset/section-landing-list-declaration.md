---
"@heroiclands/package-build": minor
---

**A section can say what it lists.** `site.sections` / `site.readmeSections`
take two more keys, `listType` and `listSubType`, and both reach the generated
`_index.md`:

```yaml
sections:
  weapongear: { title: Weapons, listType: weapongear }
  user-guide: { title: User Guide, listType: doc, listSubType: userguide }
```

Since #204 a content page is written flat under the mount, so a declared
section's directory holds nothing but the landing this build writes for it and a
layout reading Hugo's `.Pages` finds no members. The membership survives in the
`site.sections` map and in nothing a theme can read — not on the page, not on
the landing, not in any URL — so every section landing served by a generic list
layout renders empty. `sohl` was unaffected only because its eleven catalog
layouts already query `site.RegularPages` by `Params.type`; a consumer rendering
through the shared theme has no layout of its own to edit. The landing now
states that query and the theme runs it
(HeroicLands/heroiclands-hugo-theme#50).

**Two keys of their own, not `type` / `subType`.** On an `_index.md`, `type` is
Hugo's own layout selector: verified against Hugo 0.165, a section landing
carrying `type: doc` renders through `layouts/doc/list.html` rather than the
default list template — behaviour this build already relies on deliberately, for
the mount's own `landing`. Spelling the content type there would silently change
which template serves the landing.

**Two keys added to the closed set, not an open passthrough.** `site.landing` is
passed through unvalidated because it is written once, for the mount, in one
landing template's own vocabulary; a section entry is written fourteen to twenty
times per build against a contract every package and every section shares.
Unbounded there, a mistyped `listTpye:` would publish into front matter, list
nothing, and report no error — which is the bug being fixed, moved one step
downstream where no build can see it. `normalizeSectionMeta` stays the one place
the vocabulary is bounded, and the writers still name no keys.

**Both values are checked, because both ways of writing an inert declaration are
silent.** They name a content type and subType, so each must be an address
segment (`^[A-Za-z0-9]+$`), and a `listSubType` with no `listType` is refused —
a subType tells pages apart only within a type, so alone it names no query. The
charset check is the trap this came from: a section is named for a URL the site
chose and need not match the address (`/sohl/kb/user-guide/` is the section,
`userguide` the subType, #207), and copying the section's name in would match no
page at exit 0. All three refusals are located at the offending key:

```text
package-build.config.yaml:504:90: error: package-build config:
`site.sections.user-guide.listSubType` is `user-guide`, which is not
alphanumeric. …
```

**Additive.** A section that declares neither key emits exactly the bytes it
did before. Verified on a pristine `origin/main` extraction of `sohl`, the only
consumer running `content-build site` with declared sections: 1670 emitted files
byte-identical, and with the keys declared on two of its nineteen sections
exactly those two `_index.md` files change.

Closes #212
