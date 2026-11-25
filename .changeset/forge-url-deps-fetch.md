---
"@heroiclands/package-build": patch
---

**Builds and commands**

- Setting `PACKAGE_BUILD_FORGE_URL` makes `package-build deps fetch` read dependency releases from that Gitea forge, and unset or empty it reads from GitHub as before.
- A host that does not answer as a Gitea forge, and any GitHub-looking host other than `github.com`, is refused with an error naming the variable.
- `PACKAGE_BUILD_FORGE_TOKEN` supplies the token for a Gitea forge, separate from `PACKAGE_BUILD_FORGE_TOKEN_FILE`, which stays the token of a private build mirror.
- A dependency whose index is already fetched for its pinned version makes no network request, so a build reaches the GitHub rate limit far less often.
- A rate-limit error names the forge and the token variable to set, and `package-build deps --help` lists the variables.
