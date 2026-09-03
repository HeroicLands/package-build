---
"@heroiclands/package-build": minor
---

Give an affiliation the ranks and offices it confers, settle the
`government`/`governance` split on one root, and stop the mapping table claiming
system fields for things that reach none (#160).

**An affiliation now publishes its own social structure.** `governance.ranks` is
the ladder the body confers — `level`, `title`, `description` per rung — and
`governance.offices` is a map of named post to what that post does. Level 0 is
reserved for the excluded: outlawed, expelled, excommunicated is a standing an
organisation still recognises, so it still has to define it.

The reason to put them here rather than on a membership is that a bare `level: 4`
says nothing on its own. It means _Knight_ only because the polity declared that
rung, so the ladder is authored once, on the body that confers it, and a member's
rank is an index into it. Offices are not ranked at all — a Chancellor and a
Marshal are both great officers and neither is above the other — so an office is a
key with a description rather than a rung.

**The membership fields leave `data:`.** `society`, `office`, `title` and `level`
described a being's standing in a body, not the body, and all 199 authored
affiliation notes left them null. They are filled on the affiliation _as embedded
on a being_, which is where they always belonged.

**One root: `governance`.** The specification mixed `governance.model` with
`government.summary` and `engine/note-vocabulary.mjs` declared exactly that pair,
with a comment saying the two had to be reconciled somewhere else. They are
reconciled here, on `governance` — the root that names the concept rather than
the institution, and the one the new `ranks` and `offices` read naturally under.

**`Republic` joins `GovernanceModel`, and the three civic models are given a
test.** A Roman-shaped republic was none of the existing values exactly: not an
`Oligarchy`, whose closed group holds authority with no election and no term; not
a `Democracy`, where any member may hold office. Ask who fills the offices and on
what terms and the three separate cleanly, which the enum now says. Naming it
`Republic` rather than `Senatorial Oligarchy` keeps the enum a partition of
one-word answers to _where does authority rest_ — "senatorial" is a culture's word
for its ruling order, and culture words belong in a body's rank titles, not in the
shared vocabulary every culture is described with.

**Two renames and a new field.** `domain` becomes `domains`, which is what a list
of places wants to be called; `languages` becomes `commonSkills`, since what
members share is not only speech; and `economy` is new — the currencies, banking
bodies and goods an affiliation's economic life runs on, as wikilinks rather than
prose.

**The mapping table stops overclaiming.** `governance` reaches no `system.*`
field: SoHL's affiliation item has nowhere to put ranks or offices, and inventing
a mapping for a field no schema declares is the drift these tables exist to
catch. The four membership rows go with the fields, leaving 84 mapping claims and
66 checked against SoHL's published schema.

**`mystery` accepts `birthsign`**, which the specification declares and the
vocabulary did not, and the four gear headings are spelled as the vocabulary
enforces them — `armorgear`, `concoctiongear`, `projectilegear`, `weapongear` —
rather than as #78 will rename them.
