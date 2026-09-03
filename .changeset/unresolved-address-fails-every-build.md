---
"@heroiclands/package-build": major
---

**An address that resolves to no note fails every build** (#184).

A wikilink whose address names no document was a **warning** in `content-build
links`, a **failure** in the pack compilers, and — in the site build — _nothing
at all_ while any linkable package had no vendored manifest. One authored link,
three verdicts. This makes it an error everywhere, and makes the three resolvers
name and word every class of link failure identically.

**Why the tolerance is spent.** It existed because a bare `[[Sunless Vault]]`
might be a worldbuilding placeholder for a note nobody had written. That was a
property of the bare form, which #180 retired, and the intent behind it now has
a real spelling: a note tagged `draft` exists, resolves, compiles, publishes,
and renders its inbound links marked (#183). An address naming no note is a typo
or an omission, and both want fixing.

**One vocabulary, one message.** `engine/wikilink-syntax.mjs` — which already
held the syntax the three resolvers share — now also holds the closed set of
failure classes (`LINK_FINDING_REASONS`) and the message each reports through
(`linkFindingMessage`, `unresolvedAddressMessage`, `ambiguousAddressMessage`).
An author meets whichever build ran first, and a consumer switching on a
`reason` should not be switching on which build produced it.

| finding          | checker | pack build | site build |
| ---------------- | ------- | ---------- | ---------- |
| `unlabelled`     | error   | error      | error      |
| `not-an-address` | error   | error      | error      |
| `unknown-type`   | error   | error      | error      |
| `unresolved`     | error   | error      | **error**  |
| `ambiguous`      | error   | error      | error      |

**Breaking changes.**

- _The site build fails an unresolved address unconditionally._
  `wikiContext()` no longer takes `manifestsComplete`, and `resolveWebWikilinks`
  ignores one on the context. A missing manifest is now advice inside the
  message rather than a reason to let the link through.
- _Two reason strings were renamed into the shared vocabulary._ The pack
  build's `"unknown"` and the site build's `"broken type/shortcode"` are both
  `"unresolved"`. A slash-qualified target naming no known type reports as
  `"unknown-type"` on the site build too, matching the checker.
- _`ambiguous` is a class in all three._ An address more than one package
  publishes was reported by the checker and the pack build as though nothing
  published it. The finding carries the claiming `packages`, and the message
  names them.
- _Site-build wikilink findings are compiler-parseable._ They were
  `log.error("bad wikilink [[x]]: reason  (file)")` — a `loglevel` timestamp
  sitting exactly where a parser reads the path from. They are now
  `file:line:column: error: message`, located by the authored link's own
  position in the source note, like every other diagnostic.
- _Pack-build failure messages are reworded_ by the shared table, and name the
  address rather than the whole authored link.

**Consumer impact: none measured.** Across the three content trees — `sohl`
(1,607 notes / 3,618 links), `thalorna` (1,849 / 7,913) and `kethira` (371 / 0)
— the promotion produces **zero** new findings. `thalorna`'s 66 dead addresses
are all `not-an-address`, which was already an error, and its 70 unlabelled
links are #180's. No tree carries an address that resolves nowhere.
