---
"@heroiclands/package-build": minor
---

Locate a configuration error in the file it was written in (#95).

Every check across `content-config.mjs` and `config.mjs` — 81 of them — reports
through one `fail()`, which named the offending key's **dotted path** and
nothing else. That is a good description and a bad locator: nothing in the line
is a path an editor can open or a CI annotator can resolve, in a file that runs
to 400 lines with fourteen sibling entries under `sections:` alone, several of
them flow-mapped onto one line.

The path now rides on the error as a `field`, and the loader that read the file
resolves it — through `positionOfYamlPath`, the same locator `manifest`'s
`packFolders` findings already use — so all 81 come out in the
`file:line:column: severity: message` form every other finding uses, path first:

```text
package-build.config.yaml:382:64: error: package-build config: `site.sections.being.descrption` is not a recognized option (expected one of: title, banner, description).
```

**Located at the boundary, not at the check.** `content-config.mjs` is the leaf
an `.mjs` configuration imports and performs no I/O, so it attaches the path and
`configFromData` — which knows the file — formats it. `config.mjs`'s pure
`resolvePackageBuildConfig` is unchanged for the same reason;
`loadPackageBuildConfig` is where its findings are located.

**Positions are dropped, never guessed.** A required key the file never declared
has no node of its own, so the position names the **mapping it belongs in**, one
level up and no further — that entry is a real node and the one the reader must
edit. A missing _top-level_ key has nothing above it but the document, and an
`.mjs` configuration has no YAML to resolve a path against at all (parsing
JavaScript as YAML would resolve some paths to lines that mean nothing). Both
report `package-build.config.yaml: error: …` — the file, without a line.

Both command lines print a located failure unprefixed, since `package-build: `
and `loglevel`'s `[timestamp] [ERROR]:` occupy exactly the position a parser
reads the path from.

**Additive.** A valid configuration resolves exactly as before; only the text of
a rejection changes, and it keeps the body it had. `positionOfYamlPath` gains an
optional `{ key: true }` — report where a key is _declared_ rather than where
its value sits, which is what a message naming a field wants — and
`engine/diagnostics` gains `yamlKeyPath`, the one translation between a dotted
path and a YAML key path.
