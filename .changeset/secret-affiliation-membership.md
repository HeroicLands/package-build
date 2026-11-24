---
"@heroiclands/package-build": patch
---

**Content and notes**

- A being's `data.affiliations` entry can state `secret: true`, and only the GM sees that membership.
- The infobox, the society's office-holder list, its glossary citations, the public index and SQL tables, and the public compendium leave a secret membership out.
- A being cannot name its secret society in `data.socialTies`, in `data.seeAlso`, or in a link outside a secret block.
- A society's `holders` list cannot name a being whose membership in it is secret.
