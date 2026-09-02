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

import { sohlField } from "./frontmatter.mjs";

/**
 * @typedef {object} FieldSpec
 * @property {string} to - Dotted path in the emitted `system` block.
 * @property {string} [name] - Frontmatter key under `sohl:`, dotted for a
 *   nested one (`impact.die`). Absent means the value is not authored — see
 *   `value`.
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
 *   system reads the note. `sohlField` already resolves the block *then* the
 *   top level, so this changes no reader; it tells the author-facing surfaces
 *   which of the two is the field's home, so a note writing it where it belongs
 *   is not reported as missing it (#142).
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
 * Write `value` at a dotted path, creating the intermediate objects.
 *
 * Insertion order is the emitted JSON's key order, so a declaration's order is
 * the compiled document's order — which is what lets a field list replace a
 * hand-written object literal without changing a single byte of output.
 *
 * @param {object} target - The object to write into (mutated).
 * @param {string} dotted - Path, e.g. `"locations.flexible"`.
 * @param {any} value - The value to set.
 * @returns {object} `target`, for chaining.
 */
export function setPath(target, dotted, value) {
    const parts = dotted.split(".");
    const leaf = parts.pop();
    let cursor = target;
    for (const part of parts) {
        if (
            cursor[part] == null ||
            typeof cursor[part] !== "object" ||
            Array.isArray(cursor[part])
        ) {
            cursor[part] = {};
        }
        cursor = cursor[part];
    }
    cursor[leaf] = value;
    return target;
}

/**
 * Read one declared field out of a note's frontmatter.
 *
 * @param {FieldSpec} field - The declaration.
 * @param {object} fm - The note's frontmatter.
 * @returns {any} The value to emit.
 */
export function readField(field, fm) {
    if (field.name === undefined) {
        return typeof field.value === "function" ? field.value(fm) : field.value;
    }
    const raw = sohlField(fm, field.name, field.default);
    return field.read ? field.read(raw, { fm, field }) : raw;
}

/**
 * Turn a field declaration into the builder it declares.
 *
 * @param {readonly FieldSpec[]} fields - The declaration, in emission order.
 * @returns {(fm: object) => object} A `system`-block builder.
 */
export function buildFromFields(fields) {
    return function buildDeclaredSystem(fm) {
        const out = {};
        for (const field of fields) {
            setPath(out, field.to, readField(field, fm));
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
