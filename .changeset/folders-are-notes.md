---
"@heroiclands/package-build": minor
---

**A folder is a note** (#256), and `packFolder:` names one by **address** (#255).

```yaml
---
type: folder
shortcode: possessionscooking
name:
  full: Cooking
data:
  parent: possessionsmiscgear
  color: "#7a4b2a"
---
```

```yaml
packFolder: possessionscooking # on any note that files itself there
```

A `Folder` was the last document this package compiled from bespoke
configuration — `*-folders.yaml`, five files per tree — rather than from a note.
That was the one hole in the rule #243 establishes, _the compiler follows the
index_: a pass cannot follow the index for things the index does not contain.

**`parent` is an address**, so a dangling one is an ordinary dead-address finding
rather than a special-cased `Unknown folder id`, and a cycle is refused. Both are
reported when the tree is read, not when something happens to reference the
folder that carries them. A folder is addressed `<package>-none-folder-<shortcode>`
— `none`, because a `Folder` is a core Foundry document like a `JournalEntry`,
not a system's.

**`parent` may be a map keyed by pack.** A folder's identity is one thing and its
hierarchy is another: the same folder is deliberately filed under different
parents in different packs, and both large trees rely on it. This repository
files its three item roots one level deeper in the journals pack (under
`Rules/Descriptions`, beside `Rules/Combat`); `sohl-thalorna` groups the items
pack by document kind and the journals pack by setting geography, and 46 of its
75 shared folders differ. A scalar — the everyday spelling — is exactly
`{ default: <value> }`, and the folder keeps one id across every pack whatever
its parent there.

**Where a folder materialises is derived from what references it** (#257). Every
pack holding a document that names a folder gets that folder, and its ancestors
with it; a folder nothing references materialises nowhere.

That removes a live defect rather than reporting it. A documentation journal is
filed beside the item it describes by putting the item's folder id into the
_journals_ pack — which only worked where a second folder file mirrored the
first, and it mirrored in one tree of three:

| tree                              | item folders | in journal folders |        missing |
| --------------------------------- | -----------: | -----------------: | -------------: |
| `Song-of-Heroic-Lands-FoundryVTT` |           57 |                 57 |              0 |
| `sohl-thalorna`                   |          132 |                 75 |         **57** |
| `sohl-kethira-basic`              |            6 |                  — | **6**, no file |

Both emitted documentation journals into folders their own pack never declared,
silently. With one folder note and one address there is no second file to
disagree with the first, so the failure is unrepresentable rather than merely
caught.

**A folder's Foundry `_id` is derived from its address** (#258), stable across
runs, so a new folder needs no invented id. An **authored `id` is kept** where
one is present — which is what lets a tree sweep its folder YAML into notes
without a world that already holds those folders losing them, making this a build
change rather than a world migration. Two folders claiming one id is a build
error.

**`packFolder` was a path for one release and never shipped as one.** #252 landed
`Possessions/Misc_Gear/Cooking` and its changeset is still pending, so no
released version ever read a path. A path encoded the hierarchy _in the value_,
so reparenting a folder rewrote every note naming it; an address is stable under
reparenting, which is why a note is addressed by `(type, shortcode)` and never by
`file.path`. The path form is removed rather than deprecated — it had no authors
to migrate, which is the whole reason the change was cheap enough to make.

**`folder:` is untouched**, and every tree still compiles from its
`*-folders.yaml` exactly as before: the SoHL tree's 3,094 compiled documents are
byte-identical across this change. Retiring the id spelling and the YAML schema
is #260, after each tree has swept.
