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
 * read it — not a documentation generator, not a validator, not a person
 * (#22). The obvious repair, a table written *beside* the function, buys very
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

import { legacyKeyOf, resolveFieldValue, setPath } from "./system-block.mjs";

export { legacyKeyOf, setPath };

/**
 * @typedef {object} FieldSpec
 * @property {string} to - Dotted path in the emitted `system` block — and,
 *   since #58, the path a note authors the field at directly:
 *   `<system>.system.<to>`.
 * @property {string} [name] - The **shared, top-level property this field draws
 *   from** when the note authors no value at `<system>.system.<to>`. Dotted for
 *   a path into a shared container (`data.portrait`), which is now the ordinary
 *   case: `data:` (#128) puts every type-specific fact under one.
 *
 *   It used to mean "frontmatter key under `sohl:`", and that reading is the
 *   degenerate case where the shared source and the system destination happen
 *   to share a name. They constantly do not — one shared `data.portrait` feeds
 *   `sohl.system.portrait` *and* `hm3.system.bioImage` — so the source is
 *   declared rather than matched by spelling (#58). The in-block position is
 *   still read, second, until #126 moves the corpus off it — keyed on
 *   `legacyKey` where the two spellings differ.
 *
 *   Absent means the value is not authored at all — see `value`.
 * @property {string} [legacyKey] - **The key this field is authored at inside
 *   the system block** — the second position of the resolution order — when
 *   that is not `name`. Absent, the position is keyed on `name`.
 *
 *   The two were one property until #305, which held only while a field's
 *   shared source and its in-block key were the same word. `data:` (#128) ended
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
 *   resolution order (#218).
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
 *   message about it names `img` rather than sending an author to `sohl.img`
 *   (#142).
 * @property {"string"|"number"|"boolean"|"list"|"map"} [kind] - The value's
 *   shape, for the frontmatter linter (#19). Distinct from `shape`, which is
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
 * finding on every field of every note in every tree, which is #126's corpus
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
 * Read one declared field out of a note's frontmatter.
 *
 * The *position* is resolved by {@link resolveFieldValue} — `<system>.system`
 * first, then the legacy in-block key, then the declared shared source, then
 * the default (#58). The **coercion** is applied here, once, wherever the value
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
 *   field read from the position it is being swept off (#305). A callback
 *   rather than a returned list because the caller is a compiler, which already
 *   knows the note and how to locate a key in it; this module knows neither and
 *   would have to invent a finding shape to say so.
 * @returns {any} The value to emit.
 */
export function readField(field, fm, { block = "sohl", onLegacyKey } = {}) {
    const { value, from } = resolveFieldValue(field, fm, { block });
    if (from === "value") return value;
    if (onLegacyKey && readsLegacyKey(field, from)) onLegacyKey(field);
    return field.read ? field.read(value, { fm, field }) : value;
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
 *   it is being swept off (#305).
 * @returns {(fm: object) => object} A `system`-block builder.
 */
export function buildFromFields(fields, { block = "sohl", onLegacyKey } = {}) {
    return function buildDeclaredSystem(fm) {
        const out = {};
        for (const field of fields) {
            setPath(out, field.to, readField(field, fm, { block, onLegacyKey }));
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
