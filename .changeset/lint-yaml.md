---
"@heroiclands/package-build": minor
---

**`package-build yaml` lints note frontmatter and every YAML file** (#248).

Frontmatter carries a note's type, shortcode, address and system blocks, and
nothing checked it _as YAML_. Worse than unchecked: `parseMarkdownFile` caught a
parse failure, logged it at `warn`, and returned `{frontmatter: null}` — which is
not a note with bad frontmatter but, to every pass downstream, a file with no
frontmatter. A duplicate key did not fail a build; it removed a note from the
corpus while the build reported success. The parser had detected it all along.

**Frontmatter reaches ESLint through a processor**, the mechanism
`eslint-plugin-markdown` uses for fenced code blocks. Frontmatter is its easy
case — the block is always at the top of the file, so a finding maps back with a
constant `+1` for the opening `---` and no offset table.

**The rule set is deliberately narrow**, as the markdown and stylesheet ones are.
Prettier already owns YAML's whitespace, quoting and line breaks, including
inside a fence, so what is left is the class a formatter cannot see: text that
parses to something other than what it looks like. Parse errors, plus
`no-empty-mapping-value`, `no-irregular-whitespace`, `no-empty-key` and
`no-empty-document`. `folder:` and `folder: null` are one value and two opposite
statements — a decision, or a key somebody began and did not finish — and a key
with a block under it is not empty.

**GitHub workflows are exempt from the empty-value rule.** `on:` `push:` carries
its meaning by being present; `push: null` would be worse YAML, not better.

**A consumer changes one line** — `"lint:yaml": "package-build yaml"` — and needs
no `eslint` dependency, no `eslint.config.js` and no rule configuration.
package-build owns the tool and the config exactly as it owns markdownlint's, and
`overrideConfigFile: true` leaves a repository's own ESLint unconsulted.

Adoption costs 92 findings in total: 65 in `sohl-thalorna`, 20 in
`sohl-kethira-basic`, 5 in `harn-ensemble`, 2 in
`Song-of-Heroic-Lands-FoundryVTT`, none in `harn-adventures`. No live content
tree carries a parse error — every one found was in a `nogit/` archive — so this
is a missing guard rather than an overdue one.
