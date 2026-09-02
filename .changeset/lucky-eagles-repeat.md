---
"@heroiclands/package-build": major
---

**The pipe decides how a wikilink resolves** (#131). `[[x]]` is an **alias**;
`[[x|…]]` is an **address**. Neither falls back to the other, so a target is
read by the punctuation the author wrote rather than by whether its shape
happens to look like an address.

Both resolvers previously tried the address grammar and fell through to the
alias index — or the reverse — so one authored link had two chances to land and
the author could not say which they meant. A note whose _name_ looked like an
address (`Grukar-ahk`) was read as one, and a genuine address that resolved
nowhere silently became a name lookup and reported nothing.

**What changes for a content tree**

| Written                    | Was                              | Now                                      |
| -------------------------- | -------------------------------- | ---------------------------------------- |
| `[[type-shortcode\|Text]]` | address                          | address — _unchanged_                    |
| `[[type-shortcode\|]]`     | address, shows the target's name | _unchanged_                              |
| `[[Some Name]]`            | alias                            | alias — _unchanged_                      |
| `[[type-shortcode]]`       | address                          | **alias lookup**, so it must gain a `\|` |
| `[[Some Name\|Text]]`      | alias                            | **address**, so the name must become one |

An empty label stays writable and now carries its full weight: `[[x|]]` is the
one way to write an address that renders the target's _current_ name, so a
rename shows at every citation with no link edited.

**The alias index no longer carries the filename.** Its sources are the
authored ones — `aliases`, `name.aliases`, `name.full`. `basename(file, ".md")`
with underscores turned to spaces admitted keys nobody could cite: thirteen
`_Introduction.md` notes all claimed `" introduction"`, leading space included.
Measured across five content trees, not one link that resolves today resolves
through the filename alone.

**A same-type alias collision is now a finding, naming every claimant.** It was
silently deleted, so the pair resolved to nothing and nobody was told. The
finding is reported at each claiming note, never at the note that merely cites
the alias — whoever added the second claimant broke every existing citation.

**The two failure modes read differently.** A piped target that resolves
nowhere, or does not parse as an address at all, is an **error**: the pipe says
the author meant an address. An unpiped target naming no note of the source's
type is a **warning**, since a bare `[[Name]]` may be a worldbuilding
placeholder for a note not yet written.

Resolution is stated once for both builds: `resolvesAsAddress` in
`engine/wikilink-syntax.mjs`, and the new `engine/alias-index.mjs` for what may
be claimed and how a claim is keyed.
