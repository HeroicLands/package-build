# Content migration

Notes intended only for GMs use `tags: [gm]`. Configure a pack with
`private: true` and route the note's document to it with `data.pack`. For a note
that also creates a prose JournalEntry, configure one private JournalEntry pack.
The public site and book omit GM notes, and links from untagged notes to them
are build errors. Untagged notes need no changes.

## Being archetypes

Every `type: being` note with `subType: character` or `subType: npc` requires
at least one value in `data.archetypes`. Choose the exact lowercase terms in
[the archetype reference](docs/reference/format-details.md). Use `commoner` alone
when no more specific archetype fits. `subType: creature` permits an absent or
empty archetype list. Block and flow YAML follow the same rules.
