---
"@heroiclands/package-build": minor
---

**Books**

- `pdf:` declares its books in a `books:` list, and a configuration that still writes `pdf.title` or `pdf.document` fails.
- To move, put `title`, `subtitle`, `document` and `front` into one `pdf.books` entry with an `id`.
- `fonts`, `iconFonts`, `binary` and `out` stay directly under `pdf:`.
- `package-build pdf` builds every declared book, and `--book <id>` builds one.
- Each book's PDF is named from its `out` stem (default `<package>-<id>`) and the version; write `out: <package>` to keep a single book's file name.

**Authors**

- Authors are listed once, in a top-level `authors` list, each with an optional role.
- The Foundry manifest's authors come from that list, and the site's byline from its first entry.
- Move `packageBuild.manifest.authors` up to `authors`; the manifest block refuses it.
