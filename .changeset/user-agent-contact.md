---
"@heroiclands/package-build": patch
---

- Downloads and other outbound requests now identify the repository and its version in their `User-Agent`.
- New optional configuration `userAgentUrl`, `userAgentEmail` and `userAgentEmailHosts` (or the `PACKAGE_BUILD_USER_AGENT_URL`, `PACKAGE_BUILD_USER_AGENT_EMAIL` and `PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS` variables) add a contact; the email goes only to the listed hosts.
