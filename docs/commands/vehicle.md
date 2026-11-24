---
shortcode: cmdvehicle
name: { full: "Vehicle command" }
type: doc
subType: reference
texinfo:
  parent: commands
---

# Vehicle command

`package-build vehicle prompt <Address> [--model <style> --seed <text>] [--view <view>]` prints a JSON object with `positive` and, for `sdxl`, `negative` prompt strings. Styles are `flux-dev`, `flux2-pro`, and `sdxl`.

When no picture record exists, supply `--model` and `--seed`. `--view` is optional and accepts `side` or `three-quarter`; the seed selects a view when omitted. These settings are transient. A vehicle with a picture record uses its stored settings and refuses all three overrides.

The command resolves explicitly authored item models through the content index and includes their names and declared quantities as vehicle item facts. It does not infer which items are visible, where they are placed, or what a container holds. It does not draw appearance values, write the note, or generate a picture.

The command refuses a vehicle note with any lint error and prints located diagnostics to stderr. It exits with status 0 on success and 1 on invalid arguments, unresolved input, lint errors, or prompt composition errors.
