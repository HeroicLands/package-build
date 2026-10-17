---
"@heroiclands/package-build": minor
---

Render a Markdown buffer with `package-build-preview`, without package
configuration or a content index. Pipe Markdown into the command for light HTML,
add `--dark` for dark HTML, or use `--css` to export the shared stylesheet.
Gitea administrators can install the renderer with the documented sanitizer
rules and browser theme adapter. Applications can import the renderer from
`@heroiclands/package-build/preview`.
