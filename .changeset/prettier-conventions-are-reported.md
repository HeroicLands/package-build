---
"@heroiclands/package-build": minor
---

**`content-build format` now says which shared Prettier conventions your
repository is not using.**

A consumer's own Prettier config wins **wholesale** — that is Prettier's own
behaviour and it is not changing — so the conventions this package publishes held
by convention alone, and lapsed silently in two opposite directions (#133):

| what a repository declares                                      | what it actually formatted to                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `export { default } from "@heroiclands/package-build/prettier"` | the shared conventions                                                                  |
| `{ ...PRETTIER_BASE }`, without the `**/*.md` override          | markdown at `tabWidth: 4` — every note reindenting away from the form it was written in |
| a partial `.prettierrc`, e.g. `{"tabWidth": 2}`                 | Prettier's defaults for `printWidth`, `trailingComma`, `experimentalTernaries`, …       |
| nothing at all                                                  | the shared conventions here, Prettier's own in your editor and in `npx prettier`        |

Every `format` run now reports each disagreement by name, before the per-file
report:

```text
prettier.config.mjs: warning: markdown `tabWidth` is 4 here; the shared configuration says 2
.prettierrc: warning: `printWidth` is not set here, so Prettier's own default applies; the shared configuration says 100
```

A repository with no Prettier config is warned too, with the one line that fixes
it — that case is the sharper one, because the shared conventions then reach this
command and nothing else, so a bare `npx prettier --check .` and the lint chain
take turns rewriting the same lines.

**Nothing here fails a build.** Every finding is a `warning`, the exit code is
untouched, and a deliberate local override keeps working exactly as before — it
just stops being silent.

New export: `checkPrettierConventions(root)` from
`@heroiclands/package-build/engine/prose-lint`, and the pure comparison behind it,
`sharedPrettierDivergence(resolved, file)` from
`@heroiclands/package-build/engine/prose-config`.
