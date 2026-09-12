---
"@heroiclands/package-build": minor
---

Add `close` and `run` to the icon registry, and correct `delete`.

Converting the SoHL user guide turned up two controls with no name to convert
to. A `✕` there means three different things — "not applicable" in a Healing
Rate column, "remove" on a control, and **close** on a dialog's corner — and a
`▶` **runs** an action, where the nearest existing entry was `expand`, whose
accessible label would have told a screen reader the wrong thing. Both now have
their own name and their own label; that Font Awesome draws the three `xmark`
senses identically is this table's business rather than the reader's.

`delete` was written as `fa-trash-can` and is now `fa-trash`, which is what the
system's templates actually draw — twenty-five times, against no `fa-trash-can`
at all. A registry checked against the interface is the whole point of having
one; unchecked, it is just a second place to be wrong.
