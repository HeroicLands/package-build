# Your first content note

A HeroicLands content tree lives under `assets/content/`. Put notes in whatever subfolders help you work: the build discovers them recursively and identifies each by frontmatter, not by its directory. This example works in a project made by [`package-build init`](../commands.md#package-build-init-directory).

Create `assets/content/Places/Harbor.md`:

```markdown
---
shortcode: harbor
name: { full: Harbor }
type: lore
subType: concept
---

# Harbor

A sheltered place where ships load and unload.
```

`shortcode` and `type` identify a HeroicLands note; `name.full` gives readers its name. The YAML ends at the second `---`. Everything after it is the shared Markdown body. Run `npm run lint` to check the note, then `npm run build:site` to build its web page. `npm run serve:site` serves the site locally; `npm run build:book` builds the book. A Foundry package's `npm run build:db` also compiles its configured packs. The generated project supplies these scripts and their configuration.

## What the note becomes

| Output                       | What it contains                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Content index                | The note Address, frontmatter, anchors, and links, for search and queries.                                                              |
| JournalEntry                 | The shared prose, independent of a game system.                                                                                         |
| JournalEntryPage             | One page per H1, plus an introduction page if prose comes before the first H1. An explicitly anchored lower heading also starts a page. |
| Website                      | A page at the note's Address when the package publishes content.                                                                        |
| Book                         | The same content when selected by the book's document tree.                                                                             |
| Actor, Item, Scene, or Macro | A game document when the type and a system block request one.                                                                           |

The full Address is `<package>-note-lore-harbor`; `<package>` comes from `contentPackage` in `package-build.config.yaml`. In another note, `[[lore-harbor|Harbor]]` links to it. `[[lore-harbor|]]` asks the renderer to use the target's current name. The pipe is required.

## Grow the note only when needed

Add `description` for a short page summary, `tags: [draft]` to mark unfinished prose, or `data` for fields the note's type permits. A system block such as `sohl:` or `hm3:` adds mechanics and can produce a Foundry Actor or Item. It does not replace the shared prose or make another JournalEntry. [Frontmatter](frontmatter.md) explains the allowed keys, and the [note-type reference](../reference/note-types.md) lists every type-specific field.

A note with an empty body is a stub. It remains addressable as data, while a document that would have no content is omitted. See [note states](../reference/format-details.md#three-states-of-a-note) for the precise emission rules.
