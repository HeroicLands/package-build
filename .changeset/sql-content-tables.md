---
"@heroiclands/package-build": minor
---

**A content table can be written in SQL, queried over the content index** (#246).

Tables were written in Dataview's query language, chosen when the corpus lived in
an Obsidian vault so a table rendered live while authoring. The vault is gone, and
what remained was a hand-written parser and evaluator for someone else's language,
kept faithful to semantics nothing checked it against.

The query is **real SQL, run by DuckDB** — not a dialect maintained here. That is
the point: a partial reimplementation would accept some valid SQL and silently
misread the rest, which is worse than an unfamiliar language because the boundary
is invisible.

```sql
SELECT address.slug AS _ref,
       sohl.kbcat   AS _section,
       name.full    AS "Name",
       sohl.weight  AS "Weight"
FROM notes
WHERE type = 'miscgear'
ORDER BY sohl.kbcat, name.full
```

**`sohl.weight` and `name.full` read in a query exactly as a note authors them.**
DuckDB reads the index as JSON and infers a `STRUCT` per nested object; a
column-per-path table would force `"sohl.weight"` in quotes and a JSON column
`sohl->>'weight'`. `union_by_name` is what makes it work across a corpus where
every note type's system block differs.

**What SQL cannot say, the projection says.** Which column links, and where a
section breaks, are decisions about output rather than relational operations, so
they ride as underscore-prefixed aliases — `_ref` and `_section` — which are
ordinary SQL, need no fence options, and sit where the author is already looking.
`_section` is why one query replaces the forty near-identical blocks
`Rules/Gear.md` needs today: it emits a headed table per distinct value, in the
order the authored `ORDER BY` produced.

`sql allow-empty` and `sql section-level=3` ride on the fence, as `dataview
allow-empty` already does, because both are statements about the directive rather
than part of the query.

**Both spellings work.** Every one of the 177 tables in the corpus is still
`dataview`; those now also report a warning naming this issue, and nothing else
changes for them. Nothing is opened for a tree with no `sql` directive, so this
costs a tree that has not converted one walk and no database.

_DuckDB is a **build** dependency, not merely a development one — every
consumer's CI runs a compile. It adds about 114MB to an install._
