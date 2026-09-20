---
"@heroiclands/package-build": minor
---

**The site build generates the Hugo configuration.** `content-build site`
writes the whole Hugo source tree under `build/hugo/` — a generated
`hugo.toml`, the content mount at `build/hugo/content/`, Hugo's cache —
beside the deployment root `build/site/`, and the repository carries no Hugo
configuration of its own. Every value in the generated file has one source:
`package.json` (`homepage`, `description`, `author`),
`package-build.config.yaml` (`packageBuild.manifest.title`, `site.assets`,
`site.list`, `site.notfound`), the installed `@heroiclands/hugo-theme`, and
the organisation's brand links and navigation. `package.json`'s `homepage`
is checked on every site build: it must be
`https://www.heroiclands.org/<contentPackage>/`.

**`deps fetch` also fetches the navigation.** The header menu every site
renders comes from `https://www.heroiclands.org/nav.json`, cached under
`build/cache/navigation/` by `content-build deps fetch` and read from the
cache by the site build — a cold cache fails naming `deps fetch`, so a
package with no other dependency now runs `deps fetch` before `site` too.

**To migrate a repository:**

- Delete `site/` and its `.gitignore` entries (`site/content`, `site/public`,
  `site/resources`), and any `packageBuild.clean.extra` entry naming them.
- Delete `site.out` from `package-build.config.yaml`; the location is fixed.
- Move the `[params.notfound]` block from the old `hugo.toml` to
  `site.notfound` (`tagline`, `sitenoun`, optional `heroimage` and
  `links[]` of `{title, url, text}`), `params.list.shortcodes` to
  `site.list.shortcodes`, and `params.cdnBaseURL` to `site.assets` where it
  was not already there. Anything else the file carried that the generator
  does not write — `markup.goldmark.extensions.linkify`, say — goes under
  `site.hugo`, which is deep-merged last; every key the generator writes is
  refused there, naming its source.
- Point the npm scripts at the generated tree:
  `hugo --source build/hugo --minify --gc --cleanDestinationDir` and
  `hugo server --source build/hugo`.
- Make sure `package.json` declares `homepage`, `description` and `author`,
  and that `@heroiclands/hugo-theme` is under `devDependencies`.
