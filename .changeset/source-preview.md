---
"@heroiclands/package-build": minor
---

Preview now renders the current buffer without a content index, dependency cache, SQL engine or Pandoc. Markdown, local figures, poetry and tinted alert boxes render directly; cross-note constructs remain highlighted source, with explicit light and dark palettes. Missing ages calculate locally from neutral birth dates and the root `currentDate` setting, defaulting to `"720.1"`. Authored ages, including zero, are preserved; unavailable ages are omitted. Generated sections and related pages are omitted. Integrations must replace `prepareSitePreview()` with `renderPreview(text, options)` and include `previewStyles()`. Pass `currentDate` to the pure renderer, or use `await readPreviewCurrentDate(projectRoot)` to read the setting from YAML/YML/MJS configuration. Standalone invocations can override it with `--current-date DATE`.
