/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Declared frontmatter fields — what a note may write, said out loud.
 *
 * **The declaration is the builder, not a description of one.** A builder used
 * to be an opaque function: the mapping from a note's `sohl:` frontmatter to
 * the emitted `system` block existed only inside its body, so nothing could
 * read it — not a documentation generator, not a validator, not a person.
 * The obvious repair, a table written *beside* the function, buys very
 * little: two statements of one rule drift, and nothing notices.
 *
 * So the table is the only statement. {@link buildFromFields} turns a field
 * list into the builder, which means a field that is not declared is not
 * emitted, and a field whose declaration changes changes the output. There is
 * no second place for the truth to live.
 *
 * **A field carries its coercion, not just its name.** `weight` is not merely
 * "a number" — it is *this* reading of a raw YAML value, with *this* default
 * when absent. Pairing the two ({@link NUMBER} and friends are `{shape, read}`
 * pairs, spread into a field) means the documented shape and the executed
 * coercion cannot disagree either: they are one object.
 *
 * **Not everything in a `system` block is authored.** Constants (`quantity: 1`)
 * and derived values (a projectile's `numDice`, which follows from its die)
 * are declared with a `value` instead of a frontmatter `name`, so the emitted
 * block stays complete while the author-facing reference — anything built on
 * {@link authoredFields} — lists only what an author can actually write.
 *
 * Plain ESM, no configuration, no filesystem — a leaf, importable by anything.
 *
 * @module
 */

import { legacyKeyOf, resolveFieldValue, retiredTopLevelKey, setPath } from "./system-block.mjs";

export { legacyKeyOf, retiredTopLevelKey, setPath };

/**
 * @typedef {object} FieldSpec
 * @property {string} to - Dotted path in the emitted `system` block — and,
 *   the path a note authors the field at directly:
 *   `<system>.system.<to>`.
 * @property {string} [name] - The **shared, top-level property this field draws
 *   from** when the note authors no value at `<system>.system.<to>`. Dotted for
 *   a path into a shared container (`data.portrait`), which is now the ordinary
 *   case: `data:` puts every type-specific fact under one.
 *
 *   It used to mean "frontmatter key under `sohl:`", and that reading is the
 *   degenerate case where the shared source and the system destination happen
 *   to share a name. They constantly do not — one shared `data.portrait` feeds
 *   `sohl.system.portrait` *and* `hm3.system.bioImage` — so the source is
 *   declared rather than matched by spelling. The in-block position is
 *   still read, second, until the corpus moves off it — keyed on
 *   `legacyKey` where the two spellings differ.
 *
 *   Absent means the value is not authored at all — see `value`.
 * @property {string} [legacyKey] - **The key this field is authored at inside
 *   the system block** — the second position of the resolution order — when
 *   that is not `name`. Absent, the position is keyed on `name`.
 *
 *   As one property the two would hold only while a field's
 *   shared source and its in-block key were the same word. `data:` ended
 *   that: a shared source is a path into a container, so `data.species` and
 *   `species` name two different places and no single value reached both.
 *   `name: "species"` could not see `data.species`; `name: "data.species"`
 *   could not see `hm3.species`; and each yielded the field's **default**
 *   wherever only the other position was authored, with the note compiling and
 *   the value simply gone.
 *
 *   Declaring both restores the shape every other retirement in this package
 *   uses — read both spellings, let the current one win, and *report* the
 *   retiring one — so a field can move into `data:` while the corpus catches
 *   up, instead of on a flag day across four repositories. A declaration that
 *   names one is mid-sweep by construction; see {@link readsLegacyKey}.
 * @property {string} [topLevelMeans] - **What the note's top-level key of this
 *   name means instead** — declared only where it means something else, and
 *   stating it removes the shared top-level position from this field's
 *   resolution order.
 *
 *   A field's `name` doubles as its identity and as the shared property it
 *   draws from, which is right wherever the two levels state the same quantity
 *   — `data.weight` is the weight, whoever reads it. It is wrong wherever a
 *   spelling collides across the two vocabularies. An `affiliation` item's
 *   `system.title` is the style of address an office carries; a note's
 *   top-level `title` is the note's own heading. Nothing relates them, and
 *   before this key one silently fed the other, stringifying an authored
 *   `title: null` into fifteen documents.
 *
 *   **The value is the reason**, not a flag with a comment beside it. A boolean
 *   would record the decision and lose the case for it, and the next person
 *   adding a field needs to know the question exists — this package's own rule
 *   that the declaration *is* the statement, never a description of one. The
 *   author-facing reference renders it, so an author reading the field table
 *   learns that the top-level key will not fill this field, and why.
 *
 *   The exempted field is still authorable, at both of the positions that
 *   describe the *document* rather than the note: `<system>.system.<to>` and
 *   the legacy in-block `<system>.<name>`. Absent means the ordinary case —
 *   the top level is read, as the third step.
 *
 *   **It is read from the other side too**, because the statement is symmetric:
 *   if the two positions hold unrelated quantities then the *in-block* position
 *   is not the note-level field either, so a check about the note-level field
 *   reads past it. `engine/frontmatter-lint.mjs` resolves that through
 *   `collidingBlockKeys`. Reading it for the emitted field alone is
 *   how an affiliation's office style came to answer for its page heading.
 * @property {string} [shape] - Human-readable shape, for documentation. Comes
 *   paired with `read` from one of the coercion constants below.
 * @property {(raw: any, ctx: {fm: object, field: FieldSpec}) => any} [read] -
 *   How the raw frontmatter value becomes the emitted one. Identity if absent.
 * @property {any} [default] - Emitted when the note does not carry the field.
 * @property {boolean} [required] - Whether a note must carry it. A required
 *   field's `read` is expected to throw when it is missing.
 * @property {boolean} [shared] - Whether the field is authored at the note's
 *   **top level** rather than inside a system block, because what it states is
 *   not system-specific — a map's background art is the same art whichever
 *   system reads the note. It changes no reader: the top level is already the
 *   third step of {@link module:engine/system-block.resolveFieldValue}'s order,
 *   so the value resolves whichever region carries it. What it tells the
 *   author-facing surfaces is which of the two is the field's *home*, so a
 *   message about it names `img` rather than sending an author to `sohl.img`.
 * @property {"string"|"number"|"boolean"|"list"|"map"} [kind] - The value's
 *   shape, for the frontmatter linter. Distinct from `shape`, which is
 *   prose for a reader, and from `read`, which is what the compiler does: a
 *   field may declare `kind` without changing a byte of what it emits, and
 *   several do — `weight` is coerced leniently but is still a number, and
 *   `weight: heavy` is an authoring mistake worth reporting where it was made.
 *   Absent means the lint makes no claim about the value.
 * @property {string} [ref] - The content type a value addresses by shortcode,
 *   for the linter's dead-reference check. Only for references to a **note**:
 *   `bodyLocationCode` names a part inside a being's own body structure, not a
 *   note, so it declares none.
 * @property {any|((fm: object) => any)} [value] - For a field with no `name`:
 *   the constant, or a function deriving it from the frontmatter.
 * @property {boolean} [omitWhenAbsent] - **The key is left out entirely when
 *   the note does not carry the field**, rather than written from a
 *   declared default.
 *
 *   Every other field answers absence with a value: an unauthored `weight` is
 *   `0`, an unauthored `seat` is `null`. That is right wherever the type has an
 *   opinion about the empty case. It is wrong wherever the **DataModel** is the
 *   one holding the answer — an affliction's `onsetDurationFormula` has no
 *   compile-time value, and writing `null` over it does not merely fail to
 *   help: it makes "the author said none" and "the author said nothing"
 *   indistinguishable to every reader downstream, and it overwrites an
 *   `initial` the system chose on purpose.
 *
 *   It is the other conditional row of the same table
 *   {@link FieldSpec.runtimeOnly} completes, and the two differ only in what
 *   they do about an *authored* value:
 *
 *   | declaration      | authored | absent |
 *   | --- | --- | --- |
 *   | ordinary         | emitted  | default written |
 *   | `omitWhenAbsent` | emitted  | key omitted |
 *   | `runtimeOnly`    | refused  | key omitted |
 *
 *   **A field declaring it must declare no `default`**, and the two are
 *   contradictory rather than merely redundant — a default is a value for the
 *   absent case, which is the case this says has none. Nor may it be combined
 *   with `required` (which fails the build on absence, so nothing is ever
 *   omitted) or with `runtimeOnly` (which is never emitted at all). The shipped
 *   declarations are checked for all three in `tests/item-fields.test.ts`.
 *
 *   Unlike `runtimeOnly` this is a flag rather than a reason, because there is
 *   only ever one reason and no message prints it: the DataModel's `initial`
 *   stands. What an author needs to know is *that* the field has no default,
 *   which the generated reference states in the field's own row.
 * @property {string} [runtimeOnly] - **What the field holds once play has
 *   started** — declared on a field the *document* writes for itself, which no
 *   note may author.
 *
 *   A schema declares plenty of fields a compiled document has no business
 *   carrying: an affliction's `onsetDate` is the world time its onset fired
 *   at, crystallized when the phase runs. World time does not exist while
 *   content is compiled, so there is no authoring-time value — and `0` is
 *   itself a valid world time, which is why such a field is nullable rather
 *   than sentinelled and why a default cannot stand in for one.
 *
 *   Nothing used to stop a note writing one. The three checks that might have
 *   each declined for its own correct reason —
 *   {@link module:engine/system-block.unknownBlockKeys} reads the block's top
 *   level and never descends into `system:`;
 *   {@link module:engine/system-block.mergeSystemData} passes through every
 *   authored path no declared field claims; and the schema check's fatal
 *   direction is *undeclared*, which a field the schema really does declare
 *   satisfies. What was missing was a rule saying "declared by the system,
 *   but never authorable", and this is it.
 *
 *   Declaring it does two things, which are the two directions of one fact:
 *
 *   | declaration | authored | absent |
 *   | --- | --- | --- |
 *   | ordinary | emitted | default written |
 *   | runtime-only | **refused** | key omitted |
 *
 *   The refusal is {@link module:engine/runtime-only-fields.assertNoRuntimeOnlyFields}'s;
 *   the omission is {@link buildFromFields}'s. A runtime-only entry declares a
 *   `to` and **no `name`**, so it stays out of {@link authoredFields} and every
 *   author-facing surface built on it, while still giving `mergeSystemData` a
 *   claimed path and the refusal something to name.
 *
 *   **The value is the reason**, as {@link FieldSpec.topLevelMeans}'s is: a
 *   boolean would record the decision and lose the case for it, and the reason
 *   is what the refusal's message and the generated reference both print. It
 *   completes the sentence "it holds …".
 * @property {string} describe - One line, for the author-facing reference.
 */

/* --------------------------------------------------------------------- */
/*  Coercions — a shape and its reading, as one object                    */
/* --------------------------------------------------------------------- */

/** Whatever the author wrote, unconverted. */
export const AS_AUTHORED = Object.freeze({ shape: "as authored" });

/** Coerced with `String()`. */
export const STRING = Object.freeze({
    shape: "string",
    kind: "string",
    read: (raw) => String(raw),
});

/** Coerced with `Number()`, with a non-numeric or absent value reading `0`. */
export const NUMBER = Object.freeze({
    shape: "number",
    kind: "number",
    read: (raw) => Number(raw) || 0,
});

/** Coerced with `Boolean()`. */
export const BOOLEAN = Object.freeze({
    shape: "boolean",
    kind: "boolean",
    read: (raw) => Boolean(raw),
});

/**
 * A number whose *absence* is meaningful: unset or blank ships `null`, and any
 * other value goes through `Number()` unguarded (so a non-numeric one is
 * `NaN`, not a silent `0` — an authoring mistake worth seeing).
 */
export const NULLABLE_NUMBER = Object.freeze({
    shape: "number or unset",
    kind: "number",
    read: (raw) => (raw == null || raw === "" ? null : Number(raw)),
});

/**
 * A number whose absence is meaningful, but whose *value* is guarded: unset
 * ships `null`, anything else reads as a number defaulting to `0`.
 */
export const NULLABLE_COUNT = Object.freeze({
    shape: "number or unset",
    kind: "number",
    read: (raw) => (raw == null ? null : Number(raw) || 0),
});

/** Anything falsy — including a cleared `""` — ships `null`. */
export const BLANK_IS_NULL = Object.freeze({
    shape: "as authored, blank is unset",
    read: (raw) => raw || null,
});

/** Anything falsy — including a cleared `""` — falls back to the default. */
export const BLANK_IS_DEFAULT = Object.freeze({
    shape: "as authored, blank is the default",
    read: (raw, { field }) => raw || field.default,
});

/* --------------------------------------------------------------------- */
/*  Applying a declaration                                                */
/* --------------------------------------------------------------------- */

/**
 * Whether a resolution read a field from the position it is being swept off.
 *
 * The sweep's progress signal, in one predicate so the compile-time report and
 * the frontmatter lint cannot disagree about what counts — the role
 * {@link module:engine/retired-fields.declaresRetiredAlias} plays for a renamed
 * field.
 *
 * **Only for a field that declares a `legacyKey`.** Every other field's
 * in-block position is simply where it lives; reporting those would put a
 * finding on every field of every note in every tree, which is the corpus
 * migration rather than a signal anyone could act on.
 *
 * @param {FieldSpec} field - The declaration.
 * @param {import("./system-block.mjs").FieldSource} from - Where
 *   {@link resolveFieldValue} said the value came from.
 * @returns {boolean} True when the value came from the retiring position.
 */
export function readsLegacyKey(field, from) {
    return field?.legacyKey !== undefined && from === "block";
}

/**
 * Whether a resolution read a field from the top-level key `data:` gathered it
 * off — the shared level's retiring position.
 *
 * {@link readsLegacyKey}'s sibling, and the same signal: a finding here counts
 * one note still on the pre-`data:` spelling, so the sweep has something to
 * count down instead of a corpus nobody has surveyed.
 *
 * The `from` tag already carries the whole answer — step 3b is the only thing
 * that produces it, and it produces it only for a `data.` source — so this is a
 * name for the question rather than a second test of it. Named all the same,
 * because a compile-time report and the frontmatter lint both ask it and must
 * not drift apart about what counts.
 *
 * @param {FieldSpec} field - The declaration.
 * @param {import("./system-block.mjs").FieldSource} from - Where
 *   {@link resolveFieldValue} said the value came from.
 * @returns {boolean} True when the value came from the retiring top-level key.
 */
export function readsRetiredTopLevel(field, from) {
    return from === "topLevel" && retiredTopLevelKey(field) !== undefined;
}

/**
 * Read one declared field out of a note's frontmatter.
 *
 * The *position* is resolved by {@link resolveFieldValue} — `<system>.system`
 * first, then the legacy in-block key, then the declared shared source, then
 * the default. The **coercion** is applied here, once, wherever the value
 * came from: a field's `read` is a statement about the field, not about where
 * an author happened to write it, so `weight: "7"` reads as `7` at every one of
 * those positions.
 *
 * @param {FieldSpec} field - The declaration.
 * @param {object} fm - The note's frontmatter.
 * @param {object} [options] - Options.
 * @param {string} [options.block="sohl"] - Which system's block to resolve
 *   against. The default is the one block every existing tree authors; a
 *   second system passes its own.
 * @param {(field: FieldSpec) => void} [options.onLegacyKey] - Called with each
 *   field read from the position it is being swept off. A callback
 *   rather than a returned list because the caller is a compiler, which already
 *   knows the note and how to locate a key in it; this module knows neither and
 *   would have to invent a finding shape to say so.
 * @param {(field: FieldSpec) => void} [options.onRetiredTopLevel] - Called with
 *   each field read from the top-level key `data:` gathered it off. The
 *   shared level's counterpart to `onLegacyKey`, and a separate callback
 *   because it is a separate position: a note may have moved one of the two and
 *   not the other, and a caller that conflated them would tell its author to
 *   fix the wrong line.
 * @returns {any} The value to emit.
 */
export function readField(field, fm, options = {}) {
    return readFieldEntry(field, fm, options).value;
}

/**
 * The same read, reporting **where the value came from** as well.
 *
 * {@link readField} answers "what does this field hold", which is what almost
 * every caller wants. A builder has one further question — *should the key be
 * written at all* — and it cannot be answered from the value: `null` from a
 * note and `null` from a declared default are the same value and opposite
 * facts.
 *
 * So the position rides back beside the value, resolved **once**. The
 * alternative is a builder that calls {@link resolveFieldValue} for the source
 * and {@link readField} for the value, which resolves the position twice and
 * states in two places the rule that a field is authored in exactly one.
 *
 * @param {FieldSpec} field - The declaration.
 * @param {object} fm - The note's frontmatter.
 * @param {object} [options] - Options, as {@link readField} takes them.
 * @param {string} [options.block="sohl"] - Which system's block to resolve
 *   against.
 * @param {(field: FieldSpec) => void} [options.onLegacyKey] - See
 *   {@link readField}.
 * @param {(field: FieldSpec) => void} [options.onRetiredTopLevel] - See
 *   {@link readField}.
 * @returns {{value: any, from: import("./system-block.mjs").FieldSource}} The
 *   value to emit, and the position it was read from.
 */
export function readFieldEntry(field, fm, { block = "sohl", onLegacyKey, onRetiredTopLevel } = {}) {
    const { value, from } = resolveFieldValue(field, fm, { block });
    if (from === "value") return { value, from };
    if (onLegacyKey && readsLegacyKey(field, from)) onLegacyKey(field);
    if (onRetiredTopLevel && readsRetiredTopLevel(field, from)) onRetiredTopLevel(field);
    return { value: field.read ? field.read(value, { fm, field }) : value, from };
}

/**
 * Whether a note supplied a value for a field, as opposed to a default doing it.
 *
 * The question {@link FieldSpec.omitWhenAbsent} turns on, asked of the
 * *position* rather than of the value — which cannot answer it, since a
 * declared `default: null` and an authored `null` are indistinguishable once
 * the value is in hand.
 *
 * `undefined` counts as absent whatever position reported it, because writing
 * the key then emits a value `JSON.stringify` drops — the key present in the
 * object and absent from the pack, which is the sort of disagreement this
 * package exists to remove. It arrives from one place: the in-block step
 * answers `value ?? field.default` for a key authored as `null`, so a field
 * declaring no default resolves through "authored" to nothing at all. A field
 * that also declares a `read` never reaches this, since its coercion has by
 * then turned the `undefined` into whatever it makes of an absent value —
 * ordinarily `null`, which is a value the note asked for and is emitted.
 *
 * @param {import("./system-block.mjs").FieldSource} from - Where
 *   {@link resolveFieldValue} said the value came from.
 * @param {any} value - The value it gave back.
 * @returns {boolean} True when the note wrote one.
 */
export function isAuthored(from, value) {
    return from !== "default" && value !== undefined;
}

/**
 * Turn a field declaration into the builder it declares.
 *
 * @param {readonly FieldSpec[]} fields - The declaration, in emission order.
 * @param {object} [options] - Options.
 * @param {string} [options.block="sohl"] - Which system's block the builder
 *   reads. One declaration compiles against any block, which is what lets two
 *   systems declare the same shared source and different destinations.
 * @param {(field: FieldSpec) => void} [options.onLegacyKey] - Passed through to
 *   {@link readField}: called with each field the note authored at the position
 *   it is being swept off.
 * @param {(field: FieldSpec) => void} [options.onRetiredTopLevel] - Passed
 *   through to {@link readField}: called with each field the note authored at
 *   the top-level key `data:` gathered it off.
 * @returns {(fm: object) => object} A `system`-block builder.
 */
export function buildFromFields(fields, { block = "sohl", onLegacyKey, onRetiredTopLevel } = {}) {
    return function buildDeclaredSystem(fm) {
        const out = {};
        for (const field of fields) {
            // A runtime-only field is not this builder's to write. It is
            // declared so that the path is *claimed* — so the verbatim
            // passthrough leaves it alone and the refusal has a name — not so
            // that a compile-time answer is invented for a question only play
            // can answer. Omitting the key is what leaves the DataModel's own
            // `initial` standing; writing the `undefined` a source-less
            // declaration resolves to would put the key in the document.
            if (field.runtimeOnly) continue;
            const { value, from } = readFieldEntry(field, fm, {
                block,
                onLegacyKey,
                onRetiredTopLevel,
            });
            // The other conditional row: a field whose *absence* is meaningful.
            // Writing a declared default would answer a question the
            // note did not ask — "this affliction's onset takes `null` days" —
            // and would make the field's unset state indistinguishable from an
            // authored one for every reader downstream. Omitting the key leaves
            // the DataModel's own `initial` to say it instead, which is the one
            // place the answer actually lives.
            if (field.omitWhenAbsent && !isAuthored(from, value)) continue;
            setPath(out, field.to, value);
        }
        return out;
    };
}

/**
 * The fields of a declaration an author actually writes.
 *
 * Constants and derived values are part of the emitted document but not part of
 * the vocabulary, so every author-facing surface — the reference generator, a
 * frontmatter linter, an unknown-key check — wants this list rather than the
 * whole declaration.
 *
 * @param {readonly FieldSpec[]} fields - The declaration.
 * @returns {FieldSpec[]} Only the fields with a frontmatter `name`.
 */
export function authoredFields(fields) {
    return fields.filter((field) => field.name !== undefined);
}

/**
 * The fields of a declaration a note may **never** write.
 *
 * The complement of {@link authoredFields} in the direction that matters: those
 * are the fields an author may write, these are the ones authoring is an error.
 * Everything else in a declaration — a constant, a derived value — is
 * simply not authored, which is a statement about the *builder* rather than
 * about the author, and says nothing about what happens if a note writes the
 * path anyway.
 *
 * @param {readonly FieldSpec[]} fields - The declaration.
 * @returns {FieldSpec[]} Only the fields declaring `runtimeOnly`.
 */
export function runtimeOnlyFields(fields) {
    return (fields ?? []).filter((field) => Boolean(field?.runtimeOnly));
}
