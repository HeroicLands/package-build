# Icons and artwork

Content uses two kinds of icons. An **asset icon** is an image file with an
address, suitable for a sheet portrait, token, or embedded picture. An **inline
icon** is a named font glyph in prose, such as the symbol beside an interface
control. They have different sources and different authoring syntax.

The [content format](../content-format.md) defines addresses, art slots, and
image embeds. The [configuration reference](../configuration.md) defines the
icon registry and PDF font settings.

## Give an image an address

Put a small image under `assets/icons/` and use its filename without the
extension as its shortcode. For example,
`assets/icons/tools/anvil.svg` has the address
`<package>-none-icon-anvil`. Directories beneath `assets/icons/` do not enter
the address, so filenames must be unique across that root. Larger illustrations
belong under `assets/images/` and have type `image`. Both types can be used in
art slots, but a bare value takes the slot's default type.

```yaml
shortcode: smith
name: { full: The Smith }
type: being
subType: character
data:
  icon: anvil
  tokenIcon: image-smith-token
```

Here `data.icon` resolves an `icon` asset and `data.tokenIcon` resolves an
`image` asset. A full address, such as `sohl-none-image-smith-token`, names
another package when that package is available to the build. `data.icon` and
`data.tokenIcon` default to the `icon` type; `data.bgImage` and `data.banner`
default to `image`. An explicit `image-` or `icon-` type works in any of the
four slots. A pathname with slashes or an extension is not an art-slot address.

| Art slot         | Its use                                         |
| ---------------- | ----------------------------------------------- |
| `data.icon`      | Profile art on a compiled Actor or Item         |
| `data.tokenIcon` | Actor token art; follows `data.icon` when unset |
| `data.bgImage`   | Background of a map Scene                       |
| `data.banner`    | Page hero image for the site                    |

An Item without `data.icon` uses its builder's configured default art. An
Actor without `data.icon` uses its compiled default art. Write `data.icon`
when the note needs a particular image. A portrait within the prose is an
image embed, for example `![[image-smith-portrait|The smith]]{size: medium}`;
it does not set a document's profile art. The
[art-slot reference](../content-format.md#the-four-art-slots) gives each
slot's type and document destination.

## Write an inline icon in prose

Declare the glyph vocabulary in `package-build.config.yaml` or a separate YAML
file named by `icons:`. The registry maps a stable content name to a font
family, glyph name, style, and accessible label:

```yaml
icons:
  families:
    fontawesome: { class: fa, styles: [solid, regular], describe: Font Awesome }
  icons:
    warning: { style: solid, icon: triangle-exclamation, label: Warning }
```

With one family, each icon uses it automatically. With several families, set
`defaultFamily` or give an entry `family`. The package supplies the stylesheet
and font that these declarations name; an empty registry supplies no glyphs.
The registry key uses lowercase letters, digits, and hyphens.

```markdown
Check the :icon-warning: marker before opening the gate.

The larger :icon-warning:{size: 2x} marks a hazardous passage.
```

Inline sizes are `lg`, `xl`, `2x`, and `3x`. They enlarge the glyph relative to
running text on the web and in the PDF. A missing registry name remains
visible as its literal `:icon-name:` text and produces a warning with the
note's position. Invalid attributes also produce warnings. In HTML, a known
name renders as an icon element with an accessible label.

For a PDF, point `pdf.iconFonts` at the font file for each family used in the
book:

```yaml
pdf:
  title: The Setting Guide
  document: book.yaml
  iconFonts:
    fontawesome: assets/fonts/fa-solid-900.ttf
```

The book build reads glyphs from those font files. Its findings identify a
font that cannot be read or a glyph that cannot be resolved. The
[book guide](book.md) covers book selection and font configuration.

## Check the result

Run the content lint and build the surfaces the package publishes:

```bash
package-build lint
package-build package compile
package-build site
package-build pdf --no-compile
```

The content index assigns addresses to image assets. The lint reports unknown
inline names and invalid art addresses. A documentation package has no packs,
so it skips `package compile`. Inspect a compiled Actor or Item's
`img`, an Actor's `prototypeToken.texture.src`, and a map's `background.src`
when checking document art. Inspect the site page and emitted Typst source for
inline icons and banners. The [command reference](../commands.md) gives the
available build and lint options.
