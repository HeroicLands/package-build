# Content authoring contract

See [the content format guide](docs/content-format.md) for the complete note
format and publishing behavior.

Every typed note must have a nonempty body after its frontmatter, including
drafts, folders and homepages. Empty or whitespace-only bodies are errors.
Nonempty bodies with fewer than 25 prose words warn unless tagged `draft`.
A folder note needs only a nonempty body: any content passes, tagged or not.
Lint and publishing commands enforce the error; a description is not a body.

An `affiliation` note must declare `data.governance.ranks` with a rung at
`level: 1`. That rung gives an ordinary member a valid standing. Each rung
states `level`, `title`, and `description`; one rung is enough if offices carry
the other distinctions. A missing or empty ladder, or one without level 1,
produces a located build error.

A place declares its government through `data.government`, an `Address` whose
default target type is `affiliation`. Explicit `null` means complete anarchy;
omission leaves government unknown. Governing bodies receive their place lists
from those references. See [place governments](docs/authoring/frontmatter.md#place-governments).
