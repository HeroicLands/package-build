---
"@heroiclands/package-build": patch
---

**Builds and commands**

- `package-build npc new` draws items from a culture and the template selected by `data.occupationNote`, using their chances and seed. A matching occupation key replaces the culture item.
- Generated NPCs receive updated item-model defaults when the model changes; explicit per-entry choices remain intact.
