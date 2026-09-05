---
"@heroiclands/package-build": minor
---

**A note can name its compendium folder by path, as `packFolder:`** (#251).

```yaml
packFolder: Possessions/Consumables/Poisons and Toxins
```

A folder is addressed by where it is rather than by a 16-character id nothing
about which says _Poisons and Toxins_. The path runs through the pack's folder
file, `/`-separated, using each folder's `name`; sibling names are already unique
and no name may now contain `/`, so a full path identifies exactly one folder.

**Which spelling a value is comes from the field it was written in, never from
the string.** A top-level path is a bare name, and a name is as alphanumeric as
an id, so there is nothing in `Possessions` to tell the two apart. `packFolder`
is a path, `folder` is an id, and `packFolder` wins where a note carries both.

**`folder:` is unchanged.** A note that names an id is read, resolved and emitted
exactly as before, and nothing warns about it.

**A path this pack does not declare fails the build**, naming every path it does.
That includes the documentation journal filed beside an item, so the journals
pack must declare the folder too — where the folder files disagree, the build
says so. The id spelling never noticed: it was passed across packs verbatim and
validated nowhere, so the journal carried a folder reference its pack could not
honour. `sohl-thalorna` has 57 item folders its journals pack has never heard of,
and `sohl-kethira-basic` has no journal folder file at all; both are in that state
today, silently.

Two new invariants on a folder file, both of which every tree already satisfies:
a folder name may not contain `/`, and a parent cycle is refused rather than spun
on.
