# Content migration

The `name` map accepts `full` and `aliases` on every note. Only a being with
`subType: character` may also use `given` and `clan`. Remove other name keys,
including `home` and `title`, before building. A being's homes belong in
`data.homes`; its affiliations and stations record its standing. Name values
must be nonempty strings, and aliases must be an ordered list of nonempty
strings. The first alias of a character or NPC is its nickname.

Notes intended only for GMs use `tags: [gm]`. Configure a pack with
`private: true` and route the note's document to it with `data.pack`. For a note
that also creates a prose JournalEntry, configure one private JournalEntry pack.
The public site and book omit GM notes, and links from untagged notes to them
are build errors. Untagged notes need no changes.
