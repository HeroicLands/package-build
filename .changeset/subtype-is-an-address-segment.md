---
"@heroiclands/package-build": minor
---

Hold `type` and `subType` to the address charset, and rename a `doc`'s
`user-guide` subtype to `userguide` (#206).

**The rule.** An address is `package-type-shortcode`, read back by counting
hyphen-separated segments, and that is sound for exactly one reason: no segment
may contain a hyphen. `ADDRESS_SEGMENT_PATTERN` (`^[A-Za-z0-9]+$`) stated it and
`SHORTCODE_PATTERN` aliased it, but only a **shortcode** was checked against it.
The other two values that reach an address were not: a `type` is the first
segment of every address, and a `doc`'s `subType` is the section it routes to —
a path segment of its own, and, under #204, a shortcode. Both are now held to
the same constant, read rather than restated; a third spelling of one rule is how
the disagreements found in #202 and #203 happened.

**The diagnostic** is located where the value was written, in the standard form:

```text
assets/content/Beings/Folk.md:3:1: error: `subType` "common-folk" is not an address segment — a subType is letters and digits only (^[A-Za-z0-9]+$), the same charset a shortcode is held to. …
```

The charset is checked **ahead of** the closed-set check, which is what makes it
reach a type whose `subTypes` are declared but not yet enumerated (`being`) —
values nothing may otherwise claim to check.

**`user-guide` became `userguide`**, the one declared value that broke the rule
and the only hyphenated `type` or `subType` in the vocabulary. A hyphenated
declaration can no longer be imported at all: the registry is checked against the
charset as `engine/note-vocabulary.mjs` loads.

**The old spelling is accepted for one release, and says so.** A `doc` written
`subType: user-guide` is reported as a **warning** naming the note, the retired
value and its replacement, and the note still compiles:

```text
User_Guide/Actions.md:3:1: warning: `subType` "user-guide" is a retired spelling of "userguide" on a doc; write "userguide". …
```

_The ordering is the reverse of the usual, deliberately._ For a retired field the
sweep goes first; here it must go last. 43 `sohl` notes author `user-guide`
today, and declaring only the new spelling would invalidate all 43 with a release
they had no chance to sweep ahead of. So the acceptance ships first, consumers
rename, and a later change removes the acceptance — at which point the old
spelling falls through to the ordinary undeclared-value error with no code left
to remove. That later change is the breaking one; this one breaks nothing, which
is why it is a minor.

**`type` gets no transitional path**, deliberately: no note in `sohl`,
`sohl-thalorna` or `sohl-kethira-basic` authors a hyphenated type, so an
acceptance would be dead code guarding a case that does not exist. Measured
against a pristine `origin/main` extraction of each tree, the only hyphenated
value of either key anywhere is the 43 `user-guide` notes.
