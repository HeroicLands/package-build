---
"@heroiclands/package-build": minor
---

**A `sql` content table takes org-babel header arguments, and a dependency's
notes are a schema** (#246).

**Header arguments.** Statements _about the directive_ — as opposed to the query
— were an ad-hoc bare word (`allow-empty`) and a `key=value`
(`section-level=3`), each matched by its own regex: a grammar only in the sense
that two regexes are one, with no room for a third property that did not also
invent a third spelling. They are now org-babel header args, written after the
language:

````
​```sql :section-level 3 :allow-empty
````

**The language word stays first and stays plain**, so GitHub, Prettier and every
other markdown reader still highlight the block as SQL and ignore what follows.

The grammar is org's, which is a real one with a specification and an editor
that completes it: a key is `:name` starting a word (so `:caption Gear: the
tables` is one argument); a value runs to the next key, spaces included; a
valueless key is `true`; a value may be `"quoted"` to hold a key-like word; a
repeated key takes its last value. `parseHeaderArgs` lives in `code-fences.mjs`
and every argument reaches the caller, so a property this module makes no use of
is still readable — the point of taking a grammar rather than a regex per
property.

The `sql` fence has never shipped, so both old spellings are simply gone rather
than retired. `dataview` keeps its bare `allow-empty`: it is the retiring
language and its grammar is frozen.

**A dependency is a schema.** Each package this one depends on is attached as a
schema named after it, so a satellite can tabulate what it builds on:

```sql
SELECT name.full AS "Name" FROM sohl.notes WHERE type = 'skill'
```

This package's own notes stay at the unqualified `notes`, and one query may read
both — joining your beings against the skills they cite is a `FROM` clause. It
costs no fetch and no configuration: every dependency's published index is
already in the metadata cache when a compile starts, because resolving addresses
across packages needs it.

Which dataset a query reads is `FROM`'s job, not a fence property naming a file.
A path in authored content writes a build artifact's name into the corpus, so
renaming the artifact would mean sweeping every note that cited it — and _which
dataset_ is exactly what SQL already has a clause for, the same rule that keeps
`_ref` and `_section` ordinary SQL rather than fence options.
