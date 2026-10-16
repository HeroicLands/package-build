# demo

## 1.2.0

### Minor Changes

- Language dictionaries and declared culture or affiliation glossaries appear automatically in journals, sites and books; remove SQL fences written for those default lists.
- Dictionaries use one alphabetical list with field tags and one key; glossary sections show only the owner's declared entries.
- Authored Dictionary, Lexicon or Glossary headings with the matching anchors keep their introductions and receive the generated list.
- Language notes with nonempty `data.words`, and cultures or affiliations with nonempty `data.glossary`, need no prose body because their generated sections provide content.
- Remove links to heading examples inside HTML comments or raw HTML; these examples do not publish sections or receive automatic lists.

Builds now refuse links to sections absent from a dependency's published notes, so broken section links must be corrected before publishing.

- Glossary entries naming dictionary words show their class and link, with the dictionary senses or a context definition supplied by the entry.
- Common words belong to each culture's or affiliation's glossary; language dictionaries hold the full vocabulary and show no common marks.
- Select common entries from glossary terms; dictionary queries that select or filter a common column fail.
- Glossary entries without definitions must name a word in their resolved language, or a reachable title; specify the language or supply a definition.
- Custom culture views with ranks or offices select the culture's entries and reached titles, with common marks only for entries the culture owns.
- A glossary omits a sole sense-owner label on that owner's page; other owners and shared senses keep their labels.

- Rebuild and fetch package indexes to publish generated-section and SQL-expression anchors for links from dependent packages.
- Engine publishers with dynamic content must await `prepareContentIndex` and pass its publication to `emitContentIndex` before writing metadata.
- Missing section links fail for published notes with no prose anchors, including pages without journal documents.
- Readable item documentation anchors target their documentation journals.

### Patch Changes

Words built from language elements now print their senses in dictionary etymologies and pass the built-piece check, including declared variants, inherited elements and front-vowel affix forms.

Public dictionaries omit citations to GM-only notes, and link checks no longer reject those hidden citations.
