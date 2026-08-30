---
"@heroiclands/package-build": minor
---

Resolve the `sohlKb` TypeDoc symbol map against the repository root, and stop
swallowing every failure to read it (#75).

`site.passOptions.symbolMap` is authored repo-relative, but `readSymbolMap` read
it against the process cwd and wrapped the read in a bare `catch` that returned
`{}`. A missing file, a malformed one, a permissions error, a path typo and a
correctly configured build with no symbols were all indistinguishable — and the
build exited 0 either way, publishing every `{@link}` as a code span instead of
a link into the API documentation. Driving `content-build site` from outside the
tree through `PACKAGE_BUILD_CONFIG` — how #51 was verified — silently dropped
224 API links across 25 pages of the `sohl` knowledgebase, and nothing at any
stage reported it.

**What changed**

| State                                  | Before               | Now                                          |
| -------------------------------------- | -------------------- | -------------------------------------------- |
| `symbolMap` unset                      | `{}`, silent         | `{}`, silent — unchanged                     |
| Configured, readable                   | works from repo root | works from **any** directory                 |
| Configured, missing / unreadable       | `{}`, exit 0         | build fails, naming the path and `errno`     |
| Configured, malformed JSON             | `{}`, exit 0         | build fails, naming the path and the JSON    |
| Configured, JSON that is not an object | `{}`, exit 0         | build fails, naming the path                 |
| Configured, read                       | nothing              | `resolved N API symbols from <path>` at info |

The count is reported because a map that loaded and a map that loaded _empty_
are otherwise indistinguishable without reading the emitted HTML, and an empty
one degrades every tag exactly as a missing one used to.

**Bump**

_Minor, not patch._ No key, export, or flag changed shape, and a consumer whose
map is where its configuration says it is sees only the new info line. But a
build that previously exited 0 can now fail — deliberately — which reverses the
module's own documented licence to run the knowledgebase before `npm run docs`
and publish degraded tags. A consumer that orders its pipeline that way must
either generate the map first or leave `symbolMap` unset. No known consumer is
affected: `Song-of-Heroic-Lands-FoundryVTT` commits `kb/data/api-symbols.json`.
