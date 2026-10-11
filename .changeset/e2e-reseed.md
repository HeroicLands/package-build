---
"@heroiclands/package-build": patch
---

- An e2e run reseeds and launches its test world even after Foundry has repaired a database in it.
- When the world does not activate, the hint names the stage, so `package-build container <stage> logs` can be pasted as written.
