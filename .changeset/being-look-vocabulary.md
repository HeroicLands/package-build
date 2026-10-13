---
"@heroiclands/package-build": minor
---

**Being notes**

- A being's eye, hair and skin colour and its complexion now take words from a fixed list, alongside gender and frame, and any other value fails `package-build lint` naming the accepted words.
- Variant spellings and empty values are refused too: write `grey` rather than `gray`, and leave a field out when it is unrecorded.
- A complexion takes one word or a list of them; distinguishing marks stay free text in `extra_features`.
- The format reference lists every word with what it means.
