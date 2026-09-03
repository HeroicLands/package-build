---
"@heroiclands/package-build": patch
---

**`collectContentPages` refuses a missing `base` instead of publishing to `undefined/`.**

A page's URL is built as `` `${ctx.base}${slug}/` `` since _a page URL is its
address_ (#181). When `base` was absent the template still ran, so every
non-landing page in that build published at `undefineddoc-<shortcode>/` with no
diagnostic. The function already guards the section immediately below, on the
stated grounds that a note with none "is reported rather than written to
`undefined/`" — the same reasoning applies to `base`, which affects _every_ page
rather than one.

It is a caller contract rather than a note defect, so it throws rather than being
collected as a finding.

Fixes the two in-repo callers that still supplied the pre-#181 options and had
gone unnoticed: the end-to-end draft-link case (#183) and a homepage case, whose
combination with #181 left `main` red — neither pull request failed alone.

Closes #195
