---
"@heroiclands/package-build": patch
---

**Names in prose**

- The first use of each name in a page is bold on the website, in Foundry journals and in the book, and its later uses are plain text.
- Every spelling tied by one `ref`, every link to one note and every case of one label count as one name, so `[Jane Doe]{.name ref="#jane"}` is bold and a later `[Jane]{.name ref="#jane"}` is not.
- A wikilink counts as a name when it carries `.name`: `[[place-harbor|the harbor]]{.name}`.
- Names in headings, tables, captions and runs in another language take no bold and do not count.
- Lint warns at bold written around a name, such as `**[Jane]{.name}**`; remove it.
