---
shortcode: source-preview
name: { full: "Source preview and Gitea renderer" }
type: doc
subType: reference
---

# Source preview and Gitea renderer

Preview renders only the supplied Markdown buffer. It works with ordinary
Markdown, optional YAML frontmatter, and local Heroic Lands extensions, without
configuration, a content tree, dependency caches, a content index or Pandoc. A
host that holds a content index can give it to the preview for a fuller view.

```sh
package-build-preview < note.md > preview.html
package-build-preview --dark < note.md > preview.html
package-build-preview --current-date 740.1 < note.md > preview.html
package-build-preview --css > preview.css
```

The command writes an HTML fragment by default. Include `preview.css` in the
hosting page to apply the syntax colors, panels and tinted alerts. Light mode
is the default; `--dark` is explicit and independent of browser preferences.
`--css` emits both scoped palettes and does not read stdin. `--help` lists the
options. Unsupported arguments exit 1. Findings go to stderr; success exits 0,
and render errors exit 1. A partial preview may accompany error findings.

Preview renders through the same renderer as the packs and the websites, so an
alert, a secret block, a verse, a captioned item, a footnote section and a
picture's size and position read as they do on those surfaces. Fenced code that
names a language is highlighted. A tag written in a note is shown as text.

The default view needs no content index, so it shows what it cannot resolve as
source. A host that holds the package's content index builds an index with
`previewIndex` and passes it to `renderPreview` as `index`. Rendered that way, a
wikilink is a link, a link to a concealed note is concealed, an embed draws its
picture, marked text is mapped and set in its face, an icon is drawn, and a
caption is numbered with its asset's role, so a map is a **Map**. A query, which
a buffer cannot run, stays highlighted source in both views.

Wikilinks, image and portrait links retain their complete source: blue brackets,
purple addresses, bold foreground labels and grey attributes. Entire spans are bold, including their visible brackets and attributes.
Definition-list terms are bold and definitions use normal text. SQL and pagelist fences remain grey source;
they never execute. Calendar expressions, dependent expressions, references and
maps remain green source. Local expressions can evaluate against authored
frontmatter. Missing ages are calculated from neutral birth dates and the root
`currentDate` setting, defaulting to `"720.1"`, as for other package outputs.
Authored ages, including `0`, take precedence. Unknown or calendar-dependent
birth dates omit the age row; `{{data.age}}` is empty when unavailable. Generated sections,
related pages and See also are absent. Preview performs no publication or link
checks. Alerts render with their icons, titles, Markdown bodies and tinted
backgrounds, including nested alerts. Secret blocks are closed disclosure
spoilers. An authored `.secret` heading hides its section through the next
heading at the same or a higher level, while retaining its anchor. Secret spans
redact their label until hover or keyboard focus; explicit `.secret` wikilink
and image attributes similarly redact their inner source. The authored outer
brackets and attributes remain visible. This uses scoped CSS and a focusable
wrapper, with no preview JavaScript required.

Applications import `renderPreview` and `previewStyles` from
`@heroiclands/package-build/preview`. The HTML wrapper has `hl-preview` and
exactly one mode class: `hl-preview-light` or `hl-preview-dark`. See the
[API reference](api.md) for the function contract.

## Current date

Declare the setting-wide date as a quoted root configuration value:

```yaml
currentDate: "720.1"
```

The standalone command discovers the nearest `package-build.config.yaml`,
`.yml` or `.mjs` from its working directory. YAML reads only `currentDate`; it
requires no other package fields, content or index. MJS executes its trusted
configuration module. Missing configuration or an absent setting uses `"720.1"`.
Invalid explicit values fail with a configuration diagnostic. Use
`--current-date DATE` to override discovery for one invocation. Dates must use
neutral `<year>[.<day>[:HHMMSS]]` syntax; named-calendar dates are refused.

The pure `renderPreview` API accepts `currentDate` and never reads configuration.
Hosts can opt into `await readPreviewCurrentDate(projectRoot)` to read the root
setting before rendering. Repeated calls observe configuration edits. This is
the same root setting used by compilation, website output and other toolchain
consumers; there is no separate preview date setting.

## Gitea installation

Install Node 24 or newer and this package in the Gitea runtime, including the
container image when applicable. The examples assume installation at
`/opt/heroiclands/node_modules/@heroiclands/package-build` and a usable Node
executable on Gitea's PATH. Pin the package version in the installation's
`package.json` and lockfile.

Copy [the complete renderer configuration](../assets/preview/gitea.ini) into
`app.ini`. It replaces whole-file rendering for the listed Markdown extensions;
it does not replace Gitea's issue-comment or pull-request discussion renderer.
The renderer section must appear before its sanitizer sections. Its command
reads stdin and emits HTML; it needs no repository checkout. Change the absolute
command path to match the installation. Gitea normally uses the shared default
`"720.1"` because it receives no repository checkout. To select the deployment's
setting-wide date explicitly, use:

```ini
RENDER_COMMAND = /opt/heroiclands/node_modules/.bin/package-build-preview --current-date 740.1
```

Keep this override aligned with the setting's root configuration. Without an
override, run Gitea from a directory with no package-build configuration so
unrelated local configuration cannot select the date.

The supplied configuration keeps sanitization enabled and disables Gitea's
post-processing so preserved source and literal links remain intact. It permits
only the preview's class families on the elements that need them, plus the SVG
attributes needed for alert icons. Gitea's default SVG rules retain `viewBox`,
`width`, `height`, `aria-hidden`, path `d` and `fill-rule`; the extra rules retain
`fill="currentColor"` and circle coordinates. The wrapper mode class, syntax
span classes, fence classes and infobox wrapper must survive sanitization for
styling to work. Source is escaped text, so no additional source-data attributes
are required. The `secretFocus` rule retains only `tabindex="0"` on span
wrappers so keyboard users can reveal redacted source labels. Do not enable
arbitrary styles, scripts or data-URI images.

Install the stylesheet and optional theme adapter beneath the Gitea custom
path. Here `custom` means the actual instance's `CustomPath`:

```sh
mkdir -p custom/public/assets/css custom/public/assets/js
/opt/heroiclands/node_modules/.bin/package-build-preview --css > custom/public/assets/css/heroiclands-preview.css
cp /opt/heroiclands/node_modules/@heroiclands/package-build/assets/preview/gitea-theme.js custom/public/assets/js/heroiclands-preview.js
```

Add to `custom/templates/custom/header.tmpl`, preserving existing content:

```html
<link rel="stylesheet" href="{{AppSubUrl}}/assets/css/heroiclands-preview.css" />
<script defer src="{{AppSubUrl}}/assets/js/heroiclands-preview.js"></script>
```

Restart Gitea after configuration/template changes. Regenerate the CSS asset
when updating the package. These are administrator installation instructions;
package-build does not deploy or change the server configuration.

## Gitea theme selection

The external renderer runs on the server and cannot see a reader's active
theme. The installed browser adapter reads Gitea's root CSS variable
`--is-dark-theme`, selecting dark for `true` and light for `false`. It follows
`data-theme` changes, stylesheet loads and newly inserted preview nodes. It
changes only `.markup.markdown .hl-preview` mode classes; the surrounding Gitea
interface keeps its own colors. A custom theme that omits the variable retains
the initial renderer mode.

Without the browser adapter, use the default command for fixed light rendering,
or append `--dark` to `RENDER_COMMAND` for fixed dark rendering. Explicit CLI
mode never changes itself. Theme adaptation happens only when the administrator
installs the separate browser script.

## Sanitizer validation

[The validation harness](../assets/preview/check-sanitizer.go) applies the
shipped INI rules using the actual `bluemonday` sanitizer and the relevant
Gitea SVG defaults. It requires a Go toolchain and a temporary module with
`github.com/microcosm-cc/bluemonday` at the version used by the target Gitea
release. Run it against generated preview HTML:

```sh
go run check-sanitizer.go /path/to/gitea.ini < preview.html > sanitized.html
```

Check both light and dark fixtures containing all four alert types, a custom
title, nesting, wikilinks and attributes, SQL/pagelist fences, infoboxes, verse
and footnotes. All wrapper/token classes and icon shapes should remain, while
injected scripts and event-handler attributes should disappear. This replay
checks the sanitizer primitives; also inspect the result in the actual Gitea
version before deployment, since defaults can vary between releases.

Configuration and installation follow Gitea's
[external renderer documentation](https://docs.gitea.com/administration/external-renderers/).
The relevant implementation contracts are its
[command adapter](https://github.com/go-gitea/gitea/blob/main/modules/markup/external/external.go),
[sanitizer defaults](https://github.com/go-gitea/gitea/blob/main/modules/markup/sanitizer_default.go),
[renderer settings](https://github.com/go-gitea/gitea/blob/main/modules/setting/markup.go),
[root theme attribute](https://github.com/go-gitea/gitea/blob/main/templates/base/head.tmpl),
and [theme scheme variable](https://github.com/go-gitea/gitea/blob/main/web_src/css/themes/theme-gitea-dark.css).
