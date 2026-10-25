---
"@heroiclands/package-build": major
---

Configured language notes must declare `data.roman`, a literal NFC string of
permitted Roman source characters. Include both cases, accents, digits and
punctuation explicitly, each character once; `""` declares no written characters.
Spaces and line breaks are structural. There are no ranges, automatic case
expansions or inventories inherited from a parent language.

`package-build lint` and publication validation check language-tagged source
before script mappings or native dictionary forms can conceal invalid characters.
Configured names and their BCP 47 tags select the same inventory. Visible link
labels are checked while destinations, attributes and verse structure are
excluded. Invalid characters and non-NFC spellings are reported at their original
source positions. Unassociated external tags such as `en` and `zxx` keep their
ordinary behavior; standalone `package-build markdown` does not load inventories.

The invented-scripts guide uses only period as the Semaron pause input. A mapping
row is not permission to use a source character outside its language's inventory.

Direct native signs remain valid only in explicitly native runs whose selected
face draws those recognized setting-script characters. A Roman run cannot use
that exception, and drawing a Roman punctuation mark does not admit it.
