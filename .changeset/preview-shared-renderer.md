---
"@heroiclands/package-build": patch
---

**Editor preview**

- Alerts, secret blocks, verse, captioned items, footnotes and pictures read as they do in Foundry and on the website.
- A verse in columns shows its grid and line numbers, a div keeps its language, and emphasis inside a secret span reads as emphasis.
- An editor that holds the content index can give it to `renderPreview` through `previewIndex`: links resolve, pictures and icons draw, marked text is mapped, and a map is numbered as a **Map**.
- The Gitea renderer's `assets/preview/gitea.ini` keeps the classes of alerts, pictures, verse columns and highlighted code; copy the new file into `app.ini`.
