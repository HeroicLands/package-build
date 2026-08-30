---
"@heroiclands/package-build": major
---

Check `packFolders` against the derived `packs[]` (#81).

`packageBuild.manifest.packFolders` is the one **declared** manifest key that
names something the build **derives**. Every other declared key states a fact
about the package (`title`, `socket`, `grid`) or addresses a staged file
(`esmodules`, `styles`, `languages`) — a staged file being a different relation,
answered against the stage rather than against configuration. Surveyed across
all six HeroicLands packages, no other declared key names a derived value, so
this is the only place the two halves could drift.

They did. `HarnMaster-3-FoundryVTT` shipped a folder naming `character`,
`possessions`, `esoteric` and `system-help`; three had not existed since its
compendium was consolidated into one `items` pack, and `items` — 1,577 of 1,597
documents — was named by no folder at all. Foundry rendered the folder holding
one journal pack with the entire item compendium loose beside it, and the build
reported nothing at any point (HarnMaster-3-FoundryVTT#420).

**Two findings, deliberately different severities**

| Finding                                         | Severity    | Why                                                                                                                 |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| a folder names a pack the package does not ship | **error**   | Foundry silently skips a name it cannot resolve, so the declaration does nothing; no arrangement intends it         |
| a pack no folder names                          | **warning** | legal, and a root-level pack can be deliberate — but a package that declared a folder rarely meant to leave one out |
| no `packFolders` declared at all                | nothing     | everything at the root is an arrangement, not an omission                                                           |

Giving the two one severity gets one of them wrong: erroring on an ungrouped
pack fails working packages over a matter of taste, and warning on an
unresolvable name reproduces the defect this exists to catch.

The comparison descends through nested folders — Foundry's
`PackageCompendiumFolder` re-declares itself while `depth < 4` — so a nested
name is checked in both directions rather than being missed and then reported as
ungrouped.

**Reported where the reader can open it**

Findings carry the config key path of the offending scalar, which
`positionOfYamlPath` (new, in `engine/diagnostics.mjs`) resolves against the
configuration file. A position that cannot be established honestly — an `.mjs`
configuration, an unreadable file — is dropped rather than guessed, so the line
degrades from `file:line:column:` to `file:` to no locator:

```text
package-build.config.yaml:164:23: error: packFolders: folder "HârnMaster 3 System" names pack "character", which this package does not ship (packs: items, system-help)
package-build.config.yaml:162:13: warning: packFolders: pack "items" is named by no folder, so it ships outside every folder this package declares
```

An error **stops the write**: a manifest already known to describe packs that do
not exist should not reach the stage, where the next command would deploy it.

**Why major**

It newly fails a build that passes today. Measured against every real consumer
as each stands: `sohl`, `sohl-kethira-basic`, `harn-ensemble` and
`harn-adventures` are clean; `sohl-thalorna` warns once, for an `actors` pack no
folder names, and still builds; and `HarnMaster-3-FoundryVTT`'s `main` fails
with the three errors above, which is HarnMaster-3-FoundryVTT#420 — filed, and
fixed in its open PR #426. That is a real defect reported rather than
accommodated, but it is still a red build a consumer would meet on a blind
upgrade, so it takes the major.

Also new and exported: `packFolderFindings` (the rule, pure) from
`@heroiclands/package-build/manifest`, `positionOfYamlPath` from
`@heroiclands/package-build/engine/diagnostics`, and `packConfigPath` from
`@heroiclands/package-build/engine/pack-config` — the file `loadPackConfig`
actually read, so a finding about a configured value names it rather than
re-deriving a path free to disagree. `writeManifest` takes an optional
`configFile`; omitting it costs the position, not the finding.
