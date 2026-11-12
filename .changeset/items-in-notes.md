---
"@heroiclands/package-build": minor
---

**Content and notes**

- A being, or a culture, can list the items it has or typically carries in `data.items`, naming an item note by `model` or defining an item with a `name` and `kind`.
- Gear, affliction, trauma and mystical ability notes must state a `kind` in `data`; an existing item note without one fails lint until it is added. An item note may also state a name, image and shared numbers.
- A listed item must come from the note's own package or a module it requires, never from a game system; lint reports a repeated `key` and says how to correct each finding.
- `package-build deps fetch` also fetches the modules that a package's required modules require, so an item from such a module resolves without declaring it.
