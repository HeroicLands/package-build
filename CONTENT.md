# Content authoring contract

See [the content format guide](docs/content-format.md) for the complete note
format and publishing behavior.

An `affiliation` note must declare `data.governance.ranks` with a rung at
`level: 1`. That rung gives an ordinary member a valid standing. Each rung
states `level`, `title`, and `description`; one rung is enough if offices carry
the other distinctions. A missing or empty ladder, or one without level 1,
produces a located build error.
