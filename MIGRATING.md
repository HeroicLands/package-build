# Content migration

The `name` map accepts `full` and `aliases` on every note. Only a being with
`subType: character` may also use `given` and `clan`. Remove other name keys,
including `home` and `title`, before building. A being's homes belong in
`data.homes`; its affiliations and stations record its memberships. Name values
must be nonempty strings, and aliases must be an ordered list of nonempty
strings. The first alias of a character or NPC is its nickname.

Notes intended only for GMs use `tags: [gm]`. Configure a pack with
`private: true` and route the note's document to it with `data.pack`. For a note
that also creates a prose JournalEntry, configure one private JournalEntry pack.
The public site and book omit GM notes, and links from untagged notes to them
are build errors. Untagged notes need no changes.

## Named blocks take a title

`:::secret`, `:::info` and `:::warn` share one syntax, and a braced attribute
block may follow the name:

```markdown
:::secret {#harbor title="For the GM" .wide}
The harbor master is working for the smugglers.
:::
```

**No note has to change.** What changes without one is the heading a block
carries: a `:::warn` heads `Warn` where it headed `Warning`, and a `:::secret`
heads `Secret` where it headed `GM note`. Write `title="GM note"` on a block that
needs the old wording.

Three things that used to pass are now reported, each at the line of the block
that caused it:

- A name that is not `secret`, `info` or `warn`. A `:::caution` block was
  previously left in the page as the literal text an author typed.
- `id=` or `class=` as a key. Use `#id` and `.class`.
- An attribute beginning `on`, which would be an event handler.

A package that styled a box by overriding the inline `style` the block used to
carry restyles `section.info` and `section.warn` instead. The shared stylesheet
styles both; `section.secret` is left to Foundry, which owns the reveal control
on it.

## A complexion holds one value or several

`data.appearance.complexion` accepts a single value as it always has, and now
accepts a list of them, because a face carries more than one condition at once:

```yaml
data:
  appearance:
    complexion: weathered
```

```yaml
data:
  appearance:
    complexion: [weathered, ruddy, scarred]
```

A single value means a list of one, so **no note has to change**. Several read as
one phrase where a surface shows them — "weathered, ruddy and scarred complexion".
The other appearance colours still hold one value each.

A being's `gender` is one of `male`, `female`, `nonbinary`, `none` or `other`.
`none` says the being has no gender; an absent field says its gender is
unrecorded. A being's `frame` is one of `scant`, `light`, `medium`, `heavy` or
`massive` — the reference previously named the fourth `large`, which no package
wrote.

## Being archetypes

Every `type: being` note with `subType: character` or `subType: npc` requires
at least one value in `data.archetypes`. Choose the exact lowercase terms in
[the archetype reference](docs/reference/format-details.md). Use `commoner` alone
when no more specific archetype fits. `subType: creature` permits an absent or
empty archetype list. Block and flow YAML follow the same rules.

## A being's affiliations become a map

`data.affiliations` is a **map keyed by the body's Address**, and each entry
holds the standing the being holds in that body:

```yaml
data:
  affiliations:
    affiliation-vrystwldtrbs: { rank: 5, office: War Chief }
    affiliation-greenwardens: {}
```

An entry carries `rank` — a number, the level on that body's own
`governance.ranks` ladder — and `office`, a string matched against the keys of
its `governance.offices` map. Both are optional, and an entry with neither is
valid: it says the being belongs to the body and nothing more.

**Convert a list by making each entry a key with an empty map**: `[x, y]`
becomes `{x: {}, y: {}}`, and `[]` becomes `{}`. No rank or office has to be
supplied by the conversion; fill those in afterwards as content work. Where a
being's `data.lore` names the rung it stands on, move that fact to the entry's
`rank` and drop the lore link, which has nowhere to name the body.

The list form is still accepted while a tree converts, and a note using it
keeps the checks it had. The map form earns two more, both read from the named
body's own frontmatter: a `rank` must be a level that body confers, and an
`office` must be one of its office keys. Each failure names the file, line and
column.

For SoHL, a being embeds one affiliation item per entry, with `rank` as that
item's `system.level` and `office` as its `system.office`. Remove any
affiliation entry authored by hand in a being's `sohl.items`: a standing stated
in both places is a sheet and a page free to disagree.
