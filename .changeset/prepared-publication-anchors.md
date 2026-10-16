---
"@heroiclands/package-build": minor
---

- Rebuild and fetch package indexes to publish generated-section and SQL-expression anchors for links from dependent packages.
- Engine publishers with dynamic content must await `prepareContentIndex` and pass its publication to `emitContentIndex` before writing metadata.
- Missing section links fail for published notes with no prose anchors, including pages without journal documents.
- Readable item documentation anchors target their documentation journals.
