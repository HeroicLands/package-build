---
"@heroiclands/package-build": patch
---

**Rendering and sites**

- A single note can be rendered to the same body its website page shows, with the theme's styles and the site build's findings, for a preview outside a full site build.
- That preview keeps what it worked out under `build/`, so previewing again is quick, and after an edit only the changed note is worked out again.
- Building a content index, and every build that reads one, takes noticeably less time on a large content tree.
