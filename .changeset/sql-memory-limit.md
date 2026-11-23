---
"@heroiclands/package-build": patch
---

**Builds and commands**

- A package whose notes need more than 2 GB for SQL queries can raise the limit with `sql.memoryLimit`, and a malformed value is reported with its file, line and column.
