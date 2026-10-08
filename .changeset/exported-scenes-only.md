---
"@heroiclands/package-build": minor
---

**Maps**

- A map note carries a Scene exported from Foundry in `data.scene`, on every map subtype; draw walls, lights, sounds, regions and pins in Foundry's Scene editor.
- A map note's `data` takes only `scene`, `fixup` and `place`. A background image, scale, dimensions, grid size or other map setting written in the note is an error, as is map geometry under the system block.
- Nothing inside an exported Scene is checked; it must only be an object.
- Itinerary Scenes are no longer produced in Foundry.
- The book prints every map's picture from its exported Scene's level backgrounds, with `data.fixup` applied.
