---
shortcode: guideslocalization
name: { full: "Localize a Foundry package" }
type: doc
subType: howto
---

# Localize a Foundry package

A Foundry package ships translation files under `lang/` and lists them in its
generated manifest. The language commands check three different things: the
file can load in Foundry, every referenced key exists, and templates contain no
untranslated user-visible text. The [command reference](../commands.md) gives
their options and exit behavior; [configuration](../configuration.md#packagebuildlang)
defines the scan paths and exceptions.

## Declare a language

Put a JSON object in `lang/en.json`. Flat dotted keys make the path each call
site uses visible:

```json
{
  "EXAMPLE.Actor.greeting": "Well met, {name}.",
  "EXAMPLE.Skill.label": "Skill"
}
```

Foundry's formatted localization uses single-brace placeholders, such as
`{name}`. A key cannot be both a value and a prefix: declaring both
`EXAMPLE.Skill` and `EXAMPLE.Skill.label` makes Foundry's object expansion
fail. Keep a key segment to letters, digits, underscores, and hyphens. The
`lang check` command reports invalid JSON, a non-object top level, collisions,
invalid segments, and malformed placeholders.

Include the language directory in `packageBuild.assets` and declare its file
under `packageBuild.manifest.languages`:

```yaml
packageBuild:
  assets:
    - { from: lang, to: lang }
  manifest:
    languages:
      - { lang: en, name: English, path: lang/en.json }
```

The [manifest configuration](../configuration.md#packagebuildmanifest) covers
the rest of the manifest declaration. `package-build manifest` writes the
Foundry manifest from that configuration.

## Check that the file loads

```bash
package-build lang check
```

This command reads every file matching `packageBuild.lang.sources`, which
defaults to `lang/*.json`. It fails when the glob finds nothing. A content-only
package can use this check without configuring code or template scans.

## Check the keys used by code and templates

For packages with scripts or Handlebars templates, point the scan at the
files that reference localization keys:

```yaml
packageBuild:
  lang:
    primary: lang/en.json
    scripts: "src/**/*.{ts,mjs}"
    templates: "templates/**/*.hbs"
```

```bash
package-build lang coverage
package-build lang coverage --unused
package-build lang hardcoded
```

`coverage` compares keys in the primary file with references extracted from
scripts and templates. A referenced key that is absent fails the check. An
unreferenced declared key is advisory, because runtime code may construct its
name. `--unused` prints every advisory rather than a short preview. The scan
recognizes literal references and dynamic key shapes, including a key such as
`` `EXAMPLE.Calendar.Month.${index}.label` ``. It derives key roots from the
primary file, or uses `packageBuild.lang.keyRoots` when a root has no declared
key to derive it from.

`hardcoded` checks user-visible template text and checks that each template
compiles. It requires at least one template matching its configured glob;
`coverage` requires at least one matching script or template. A package with
no such files runs `lang check` alone.

## Account for generated keys and intentional literals

When a repository generates localization keys by its own convention, set
`packageBuild.lang.references` to a module exporting
`references(context) -> ReferenceSet`. Its `keys`, `namespaces`, `patterns`,
and `findings` join the built-in scan before coverage analysis. This lets the
package describe dynamic references without making an unreferenced key look
used merely because it has the right prefix. The [API reference](../api.md)
defines the `ReferenceSet` fields.

Use `packageBuild.lang.retained` for a declared key prefix that is intentionally
not reached by the scan. Use `packageBuild.lang.allow` for user-visible text in
a template that is deliberately literal. Each entry includes a reason:

```yaml
packageBuild:
  lang:
    retained:
      - { prefix: EXAMPLE.ExternalNames, reason: Read from saved documents }
    allow:
      - { literal: d20, reason: Dice notation is the same in every language }
```

Review coverage and hardcoded findings after changing a template or a
translation file. The checks are read-only; the authored JSON and templates
remain the source of the package's text.
