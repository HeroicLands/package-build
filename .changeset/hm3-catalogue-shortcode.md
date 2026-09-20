---
"@heroiclands/package-build": patch
---

**A module that embeds HârnMaster 3 items resolves them from a release that
stores their shortcodes under the system's own flags.** The actor pass reads
an item's `(type, shortcode)` address from `system.shortcode` where a system's
data model declares one, and otherwise from that system's own flag namespace —
never another system's, so a catalogue extracted for one system resolves
against its own handles only.
