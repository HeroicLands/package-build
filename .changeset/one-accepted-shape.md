---
"@heroiclands/package-build": minor
---

- A note or a being's `items:` entry with an undeclared `type` is refused at its `type:` line, including `character`, `creature`, `armor`, `concoction` and `projectile`.
- The map types `battlemap`, `localmap` and `regionalmap` are refused the same way.
- A `data:` property written at the top level, or in a `sohl:` or `hm3:` block, is an error at its own line.
- `archetype`, `relation`, `birthday`, and top-level `draft`, `aliases`, `section`, `traits` and `folder` are unrecognized keys.
- Undeclared configuration keys, such as `packs[].folders` and `site.trees`, are refused as unrecognized options.
- `package-build content-format notes` is not a command.
