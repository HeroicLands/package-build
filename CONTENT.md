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

A being's `data.gender`, `data.frame`, `data.appearance.eye_color`,
`hair_color`, `skin_color` and `complexion` take their words from one closed
vocabulary, and any other value is a located build error naming the words the
field takes. `data.appearance.extra_features` is free text. See
[a being's look](docs/reference/format-details.md#a-beings-look).

A `lore` note of `subType: culture` may state `data.appearanceProfile`: words
of that vocabulary, each with a positive weight, for `frame`, `eye_color`,
`hair_color`, `skin_color` and `complexion`, and a `height` range for at least
`female` and `male`. `package-build npc new` draws a new npc of that culture
from it. See
[appearance profiles](docs/reference/format-details.md#appearance-profiles).

A culture may name the tongue its people speak in `data.language`, a `skill`
note of `subType: language`. That language may state `data.names`: a
`pattern` such as `"{given} {clan}"` — or a list of them, or a map of genders to
them — `given` names listed by gender, and every other list the patterns name. `package-build npc new` draws a culture's names
from them, and checks a name it is given against them. See
[name lists](docs/reference/format-details.md#name-lists).
