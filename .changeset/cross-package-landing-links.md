---
"@heroiclands/package-build": minor
---

Address another package's landing without naming a host (#87).

A link from one package's page to another package's landing had no form but a
hardcoded absolute URL, and the homepage link check (#54) exempted one — a
finding whose fix does not exist is noise. `sohl-kethira-basic`'s homepage writes
`https://www.heroiclands.org/sohl/` twice.

**The premise the exemption rested on is true, and does not lead where it looked
like it led.** A landing is in no link manifest: it compiles to no document and
is entered in no index. The reading that follows is that nothing can resolve it.
But a landing's address is not a _note's_ address — it is the **package's**, and
`PACKAGE_BASE` has recorded where each package is served all along. Consulting it
walks no tree, reads no manifest and builds no index, which is exactly why the
mechanism survives the fence: `kethira` and `harnadventures` publish a homepage
and nothing else, and that mode never walks a content tree.

**So the authored form is the absolute URL with the host struck off.** `/sohl/`
in a body, or `href: /sohl/` in a card. Both were already accepted here — nothing
had ever named one as the form to use, which is the whole of what was missing.

| Field   | Cross-package landing | Why                                       |
| ------- | --------------------- | ----------------------------------------- |
| body    | `[SoHL](/sohl/)`      | emitted verbatim, resolved by the browser |
| `href:` | `/sohl/`              | "already resolved, used verbatim"         |
| `url:`  | **not expressible**   | package-relative by construction          |

`url:` cannot leave its own package, so a `url:` naming another package's landing
is now reported with the field as the fix rather than a path — previously it was
told to "write `/`", which is nonsense arrived at by taking the path after the
prefix when there is nothing after the prefix.

**The base comes from the roster, not from the prefix.** The finding names
`PACKAGE_BASE[pkg]`, so a package the roster relocates (`/setting/thalorna/`) is
addressed where it actually is. That is the property the manifest enforces
everywhere else — the address published is the address emitted — reaching these
links for the first time.

**Roster for landings only.** Widening the package set the other rules read would
have them offer manifest-based advice about packages no manifest is vendored for.
An in-site path naming no known package is still left alone: several surfaces a
landing routes to are built by other tools, and this build does not hold the set
of published pages.

**Measured across every homepage authored today.** All five were run before and
after, each under its own `package-build.config.yaml`:

| Package                   | Before | After |                         |
| ------------------------- | ------ | ----- | ----------------------- |
| `sohl-kethira-basic`      | 0      | **2** | the two the issue names |
| `sohl-thalorna`           | 0      | 0     |                         |
| `harn-ensemble`           | 0      | 0     |                         |
| `harn-adventures`         | 0      | 0     |                         |
| `HarnMaster-3-FoundryVTT` | 0      | 0     |                         |

Kethira vendors no manifest at all — it is homepage-only — so it is also the
proof that the roster reaches where an index does not. Applying the fix the
finding names takes it back to 0.

**Sequencing, stated because it decides the bump.** These are hard errors:
`severity: "error"`, counted into `failures`, `exitCode 1`. By this repository's
own rule — a new hard error is breaking only if it fails a previously-passing
consumer — this is minor **only once kethira's two lines are converted**, and
major if it ships before them. The conversion does not wait on this release:
`/sohl/` already passes under the current published version, verified, so it can
land in `sohl-kethira-basic` immediately and independently. It must land first.

**Bump**

_Minor, not patch, and not major._ Not patch: a check that previously passed a
page can now fail it. Not major, on the condition above — with kethira converted,
every homepage authored today passes before and after, and no export, option or
emitted document changes shape.
