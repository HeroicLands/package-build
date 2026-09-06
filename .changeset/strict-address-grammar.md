---
"@heroiclands/package-build": major
---

**The address grammar is strict, and omission runs left to right** (#59).

```text
[[[[<package>-]<system>-]<type>-]<shortcode>]
```

The written forms are exactly the suffixes of the canonical address —
`type-shortcode`, `system-type-shortcode`, `package-system-type-shortcode` — and
**`package-type-shortcode` is not one of them**. A link into another package must
now be fully qualified. That is the price of positional segments, and the
alternative is a parser that needs a vocabulary to tell a package from a system.

`readQualifier` counted at most three segments and never read a system, so it
accepted a package with its system omitted and every authored target resolved
system-blind. It now counts segments and assigns each position its field, the
same rule `readCanonicalKey` follows.

**`sohl` is both a package and a system**, and counting is what makes that
harmless: three segments name a _system_ whatever the first segment could also
have meant, and four is the full form. Nothing has to guess which sense was
written.

**A stated system is now matched, not merely parsed.** A target naming a system
resolves against the segments it supplied rather than falling back to the
system-blind short key, so `[[hm3-skill-clmb]]` no longer silently resolves to
a `sohl` note.

**A hyphenated shortcode is no longer read.** The old parser split at the _first_
hyphen so a shortcode could contain one (`trauma-self-pro`); #1397 made every
segment `^[A-Za-z0-9]+$`, and the two rules cannot both hold. The charset rule
wins — it is enforced, and no tree has used the tolerance: 138,204 authored
shortcodes across four content trees, none carrying a separator.

**Verified against real content, not fixtures.** `content-build links` over
`Song-of-Heroic-Lands-FoundryVTT` (1,606 notes) and `sohl-thalorna` (1,852 notes,
which links into SoHL) reports the _same_ findings before and after — 43 and 122
respectively, identical file sets, no new failure. No authored link in any of the
four trees uses the retired form.

Two messages follow the grammar: an ambiguity now asks for the fully qualified
form rather than a package-qualified one that would not parse, and a labelled
non-address names both the local and the cross-package spelling.
