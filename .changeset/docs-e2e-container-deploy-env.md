---
"@heroiclands/package-build": patch
---

**Documentation**

- The `e2e` command page lists the `fast` flags, the build `sweep` requires, and the end-to-end stage, which is `dev`, `qa`, `prod` or `test`.
- Every environment variable the commands read is in one index, including the SFTP agent and port and the end-to-end world overrides.
- The page warns that `FOUNDRYVTT_<STAGE>_PORT` is both a deploy's SSH port and a container's host port.
- `e2e`, `deploy` and `container` `--help` list the flags, the sweep build and the environment variables they read.
- An empty `FOUNDRYVTT_<STAGE>_PORT` in `.env.local` falls back to the SFTP port instead of dialing port 0.
