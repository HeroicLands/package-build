---
"@heroiclands/package-build": major
---

**A page states its address relative to the site root.** `site.base` is no
longer written into a page's Hugo `url:` front matter — only into the `href`s
this build renders and the base a link-manifest `path` is measured against:

```yaml
# emitted page
url: /doc-rulesintro/ # was: /sohl/doc-rulesintro/
```

`site.base` was two quantities wearing one name. It is correctly _where the
package is served_ — the prefix on every rendered `href`, and the base a
manifest `path` is stripped against — and `/<contentPackage>/` is the right
default for that. It was also written verbatim into each page's `url:`, and that
is a different quantity: Hugo resolves `url` against `baseURL`, whose path for
every consumer that exists **already is** the package base. So the prefix was
written twice, and every content page — plus the homepage — published one
package segment too deep:

```text
/sohl/doc-rulesintro/                404      /sohl/sohl/doc-rulesintro/               200
/thalorna/being-afzndhprnzr/         404      /thalorna/thalorna/being-afzndhprnzr/    200
```

Not one address a link manifest advertised resolved: **0 of `sohl`'s 2,988
entries**, and 0 of `thalorna`'s 2,585.

**One value fed two readers that need opposite framings**, which is why no
setting could fix it from a consumer: `site.base: "/"` bought the addresses and
short-changed the hrefs, and the default did the reverse. They are now separate,
and each reader gets the form it needs:

| Reader                                              | Gets                        | Because                                                             |
| --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| A page's own `url:` front matter                    | `/<type>-<shortcode>/`      | Hugo prefixes the site's `baseURL` path to it                       |
| The address index a `[[wikilink]]` resolves through | `<base><type>-<shortcode>/` | A browser resolves the rendered `href` against nothing              |
| A link-manifest `path`                              | `<type>-<shortcode>/`       | Measured against `site.base` and stripped; unchanged, byte for byte |

The homepage moves with them: `homepageFrontmatter` states `/homepage-root/`,
and no longer takes a `base` (nor does `writeHomepages`' fourth argument, which
existed only to supply it). `trees` pages and section landings never stated a
`url:` and are untouched — they take their address from their path.

**Take this release and drop your `site.base`.** Both publishing consumers set
`site.base: "/"` as a stopgap
(HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1813, HeroicLands/sohl-thalorna#131),
which bought the correct addresses at the cost of same-package body links
rendering `/doc-x/` rather than `/sohl/doc-x/` — dead either way, so nothing
regressed. With this release the stopgap is no longer needed and no longer
harmless: keeping it leaves those hrefs short. Delete the `base:` line and the
default is right for both halves.

**Verified against pristine `git archive origin/main` extractions of all three
consumers**, in both configurations, through `content-build site` **and** Hugo
0.165:

| Consumer   | `site.base` | Page `url:`           | Rendered path                  | Manifest entries resolving |
| ---------- | ----------- | --------------------- | ------------------------------ | -------------------------- |
| `sohl`     | unset       | `/doc-rulesintro/`    | `/sohl/doc-rulesintro/`        | 2,988 of 2,988 (was 0)     |
| `sohl`     | `"/"`       | `/doc-rulesintro/`    | `/sohl/doc-rulesintro/`        | 2,988 of 2,988             |
| `thalorna` | unset       | `/being-afzndhprnzr/` | `/thalorna/being-afzndhprnzr/` | 2,585 of 2,585 (was 0)     |
| `thalorna` | `"/"`       | `/being-afzndhprnzr/` | `/thalorna/being-afzndhprnzr/` | 2,585 of 2,585             |

No `/sohl/sohl/` or `/thalorna/thalorna/` path exists in either built tree, the
section landings, the content mount and the `dev-docs` tree pages all still
resolve, and with the stopgap dropped a same-package body link renders
`<a href=/sohl/doc-skills/>` again. `lint` and `links` are identical line for
line in every combination — `sohl` green, `sohl-thalorna` exactly as red as its
own content gap leaves it (1,983 lint findings, 122 link findings).

**Exactly one line per page changes, and nothing else does.** Of `sohl`'s 1,671
emitted files, 1,606 differ — the 1,605 content pages and the homepage — each by
its `url:` alone; the 46 tree pages and 19 landings are byte-identical, and
`build/manifests/sohl.json` is byte-identical. `sohl-kethira-basic` publishes a
homepage and nothing else (`publish.site: homepage`) and declares no
`site.base`: its console output is identical, its one emitted page moves from
`/kethira/kethira/homepage-root/` to `/kethira/homepage-root/`, and its landing
at `/kethira/` is unaffected.

Closes #217
