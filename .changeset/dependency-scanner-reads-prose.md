---
"@heroiclands/package-build": patch
---

**The dependency check read English prose in a comment as an import** (#355).

`tests/dependencies-are-declared.test.ts` finds a shipped file's imports with a
regex over the raw file text. It already reasoned about one false positive — the
lookbehind stops `["from", "to"]` reading as an import of `", "` — but not about
comments, where `from` is an ordinary word and the quotes are ordinary quotes.
Any explanatory comment containing the word `from`, `import` or `require`
followed by a quoted phrase was reported as an undeclared dependency:

```text
FAIL sohl/item-fields.mjs imports only builtins, itself, or a declared dependency
  + [ "sohl/item-fields.mjs:455 → this note does not set the phase" ]
```

The message names a real file and a real line and says a dependency is missing,
so the first reading is that one genuinely is. Nothing in it suggests the culprit
is a sentence, and the fix — reword the comment — is unrelated to anything the
message describes. It cost a debugging cycle in #329, and the workaround left the
trap armed for whoever wrote the next comment.

**Comments are now blanked before the regex runs.** They are located by parsing
the file, not by a second regex, so `//` inside a string literal is still a string
literal. Each comment's characters are replaced one-for-one with spaces and its
newlines are left alone, so every offset survives and a finding still points at
the line a reader opens. The `sohl/item-fields.mjs` comment that provoked this
reads naturally again, and the suite carries it verbatim.
