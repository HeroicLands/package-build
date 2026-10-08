---
"@heroiclands/package-build": minor
---

**Events**

- An event entry is checked in full: a key or value the format does not admit, a missing `summary`, or an address naming nothing is now an error at that line.
- A note holding several events gives each an `id`, and `follows` names an earlier event, never a later one or a loop back.
- Places and affiliations can carry events too — a settlement's raising, an order's founding.
