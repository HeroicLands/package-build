---
"@heroiclands/package-build": patch
---

**The generated Hugo configuration emits tag pages for a site whose notes carry `tags:`.** `content-build site` reads whether any note in the tree carries `tags:` and, when at least one does, writes `[taxonomies] tag = "tags"` and `[outputs] taxonomy = ["HTML"], term = ["HTML"]` into `build/hugo/hugo.toml`, and leaves `taxonomy` and `term` enabled among `disableKinds`. A site whose notes carry no `tags:` gets the same configuration as before — `taxonomy`, `term` and `RSS` all disabled, no `[taxonomies]` or `[outputs]` block. `site.hugo.disableKinds`, `.taxonomies` and `.outputs` stay refused under `site.hugo`, each naming this derivation as the source.
