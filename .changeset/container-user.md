---
"@heroiclands/package-build": patch
---

The test container can run as a chosen user, set by `FOUNDRYVTT_CONTAINER_USER`, so it works under rootless Docker: `0:0` makes the files in the data root belong to the host user.
