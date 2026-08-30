---
"@heroiclands/package-build": minor
---

Require exactly one `type: homepage` note per package (#52).

Every package is reachable at `/<package>/` and what a reader finds there is one
authored note in its content tree — but nothing required a package to have one,
so the failure mode of the whole arrangement was a package that builds green and
serves nothing at its own address.

**Zero and two are the same defect, at the same severity.** Neither is a warning,
because a build that proceeds past either publishes the wrong front page while
reporting success — which is exactly what a warning tolerates.

| Count    | What ships                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero** | Nothing at `/<package>/`, silently: the site build reports `wrote 0 homepage(s)` and exits 0.                                                                                    |
| **Two**  | A page nobody chose. Both are written to the same `_index.md`, so the last one walked wins — the front page decided by _filename_, on a type whose point is frontmatter routing. |

**It fires in `content-build lint` and in `content-build site`, because neither
one reaches every package.** `HarnMaster-3-FoundryVTT` runs `site` and no `lint`;
`sohl-thalorna` runs `lint` and its own site builder. A rule in one of them is a
rule two of the six packages do not have. Both call the same function, so this is
one rule with two call sites rather than two rules that can drift. In the site
build it runs _before the output tree is cleared_, so a failing gate cannot
destroy a good site to report a bad tree.

**It does not vary by `publish.site`.** That setting chooses whether the
_content_ surfaces are published; the homepage is the floor beneath both modes.
The lint call site reads no `site:` block at all, so it could not vary by mode
even if the rule wanted to.

**Zero has no file to name, and none is invented.** The locator is the content
root — a real path, and the directory the note has to be added to — with no line
and no column, as the diagnostic rules require. Two is reported once per note,
located at its own `type:` value and naming the other, because each note is a
place an author has to open and edit:

```text
assets/content: error: holds no `type: homepage` note, so package "sohl" publishes nothing at its own address /sohl/ — a package's front page is one authored note in this tree, routed by `type:` rather than by filename
assets/content/homepage.md:3:7: error: duplicate `type: homepage` note, also declared by assets/content/Landing.md; a package has one front page, at /sohl/, and every homepage is written to the same `_index.md` — so the one the walk reaches last silently overwrites the rest
```

**Minor rather than major, measured rather than assumed.** A new hard error is
breaking only if it fails a previously-passing consumer. All six HeroicLands
content packages were run at their default branch, before and after: `sohl`,
`hm3`, `thalorna`, `kethira`, `harnensemble` and `harnadventures` each carry
exactly one homepage note, and every one produces byte-identical findings and the
same exit code with the check as without it.

The issue's sequencing — ship it inert, flip it to an error later — was written
when the count was ~45 repositories and two homepages existed only in unmerged
pull requests. Both have since merged, the real count is six, and every one
passes today, so the warning window would protect nobody and the flip would be a
second pull request for no reason.
