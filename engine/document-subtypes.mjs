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
 * A system's declared note-type to document-subtype map.
 *
 * Each row names a Foundry document class and either one subtype or a
 * discriminator with permitted subtypes. The discriminator is read from the
 * system block; missing or unsupported values produce a located error.
 *
 * System-specific embedded references use {@link referencedSubtype}. A
 * reference supplies no discriminator; a split row resolves only when its
 * spelling identifies one of the permitted subtypes.
 * Unmapped references produce a finding unless a consumer declares the type.
 * A standard item note with a system block but no mapped type must select a
 * native item type. Item notes may supply a valid system override.
 *
 * @module
 */

import fs from "node:fs";
import { ITEM_NOTE_TYPES } from "./item-terms.mjs";
import { NO_SYSTEM } from "./systems.mjs";

export { NO_SYSTEM };
import { locateFrontmatterKey, positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * One row of a system's map: what a note of this type becomes.
 *
 * @typedef {object} DocumentSubtypeRow
 * @property {string} document - The Foundry document class — `"Item"`,
 *   `"Actor"`, and so on. It must agree with what the engine's own
 *   {@link packForType} routes the type to; they are two statements about one
 *   fact, and a test holds them together.
 * @property {string} [subType] - The document subtype, for a one-to-one row.
 *   Mutually exclusive with `discriminator`.
 * @property {string} [discriminator] - For a one-to-many row: the key the note
 *   supplies in this system's own frontmatter block to say which subtype it
 *   is.
 * @property {readonly string[]} [subTypes] - The subtypes `discriminator` may
 *   name. Required with it, and never empty — a row permitting nothing is a
 *   row that can never resolve.
 */

/**
 * A system's whole declaration: which system it belongs to, which frontmatter
 * block its notes write, and every note type it maps.
 *
 * @typedef {object} DocumentSubtypeMap
 * @property {string} system - The system this map belongs to (`"sohl"`).
 * @property {string} block - The note frontmatter block this system's notes
 *   write, and the only place a discriminator is read from. Defaults to
 *   `system`.
 * @property {Readonly<Record<string, DocumentSubtypeRow>>} types - Note type →
 *   row.
 */

/**
 * Declare one system's note-type → document-subtype map.
 *
 * Every malformed row is refused **here**, at module evaluation, rather than
 * when some note happens to reach it: a map is a small piece of authored data
 * loaded once per build, so a mistake in it should stop the build immediately
 * and name the row, not surface as a missing document a thousand notes later.
 *
 * @param {object} declaration - The system's declaration.
 * @param {string} declaration.system - The system this map belongs to.
 * @param {string} [declaration.block] - The frontmatter block its notes write.
 *   Defaults to `system`.
 * @param {Readonly<Record<string, DocumentSubtypeRow>>} declaration.types -
 *   Note type → row.
 * @returns {DocumentSubtypeMap} The frozen map, rows and all.
 * @throws {Error} When the declaration names no system, or any row is neither
 *   of the two permitted shapes.
 */
export function defineDocumentSubtypes({ system, block, types } = /** @type {never} */ ({})) {
    if (typeof system !== "string" || system === "") {
        throw new Error(
            "A document-subtype map must name the `system` it belongs to — it is " +
                "read per system, and its rows are only meaningful against one.",
        );
    }
    if (types == null || typeof types !== "object") {
        throw new Error(`The "${system}" document-subtype map declares no \`types\`.`);
    }

    const rows = Object.entries(types).map(([noteType, row]) => [
        noteType,
        frozenRow(system, noteType, row),
    ]);

    return Object.freeze({
        system,
        block: typeof block === "string" && block !== "" ? block : system,
        types: Object.freeze(Object.fromEntries(rows)),
    });
}

/**
 * Validate one row and freeze it.
 *
 * @param {string} system - The declaring system, named in every message.
 * @param {string} noteType - The note type this row is keyed by.
 * @param {DocumentSubtypeRow} row - The row as declared.
 * @returns {Readonly<DocumentSubtypeRow>} The frozen row.
 * @throws {Error} When the row is neither of the two permitted shapes.
 */
function frozenRow(system, noteType, row) {
    const where = `The "${system}" document-subtype map's "${noteType}" row`;
    if (row == null || typeof row !== "object") {
        throw new Error(`${where} is not a row — write \`{ document, subType }\`.`);
    }
    if (typeof row.document !== "string" || row.document === "") {
        throw new Error(
            `${where} names no \`document\` — say which Foundry document class ` +
                `it compiles into ("Item", "Actor", …).`,
        );
    }

    const oneToOne = typeof row.subType === "string" && row.subType !== "";
    const oneToMany = typeof row.discriminator === "string" && row.discriminator !== "";
    if (oneToOne && oneToMany) {
        throw new Error(
            `${where} declares both a \`subType\` and a \`discriminator\` — a row ` +
                `is one or the other, and a fixed subtype cannot also be chosen ` +
                `per note.`,
        );
    }
    if (!oneToOne && !oneToMany) {
        throw new Error(
            `${where} declares neither a \`subType\` nor a \`discriminator\` — an ` +
                `identity row is written out (\`subType: "${noteType}"\`) rather ` +
                `than left to the coincidence of the names matching.`,
        );
    }
    if (oneToMany && (!Array.isArray(row.subTypes) || row.subTypes.length === 0)) {
        throw new Error(
            `${where} names a \`discriminator\` but no \`subTypes\` — list the ` +
                `values it may take, since nothing else says what a note is ` +
                `allowed to write.`,
        );
    }

    return Object.freeze({
        document: row.document,
        ...(oneToOne ? { subType: row.subType } : {}),
        ...(oneToMany ?
            {
                discriminator: row.discriminator,
                subTypes: Object.freeze([...(row.subTypes ?? [])]),
            }
        :   {}),
    });
}

/**
 * The row a system declares for a note type, or nothing.
 *
 * The **one** place a map is indexed — {@link documentSubtype},
 * {@link mapsNoteType}, {@link noteTypesFor}'s consumers and {@link systemOf}
 * all arrive here.
 *
 * @param {DocumentSubtypeMap} map - The system's map.
 * @param {string|undefined} noteType - The note's declared `type`.
 * @returns {Readonly<DocumentSubtypeRow>|undefined} The row, or `undefined`
 *   where this system maps the type at all.
 */
export function subtypeRow(map, noteType) {
    if (!noteType || typeof noteType !== "string") return undefined;
    return map?.types?.[noteType];
}

/**
 * Whether a system maps a note type — optionally, onto one document class.
 *
 * This is what a pass asks to decide whether it claims a note, which is the
 * whole of the "no mapping, no document" property: a type the map does not
 * carry is skipped exactly as quietly as the thousands of notes that belong to
 * another pass.
 *
 * @param {DocumentSubtypeMap} map - The system's map.
 * @param {string|undefined} noteType - The note's declared `type`.
 * @param {string} [document] - Restrict the question to one document class.
 * @returns {boolean} True when the map carries a matching row.
 */
export function mapsNoteType(map, noteType, document) {
    const row = subtypeRow(map, noteType);
    if (!row) return false;
    return document === undefined || row.document === document;
}

/**
 * Every note type a system maps onto one document class, sorted.
 *
 * A pass reports what it skipped by naming what it would have claimed, and
 * that list is the map's — never a constant restating it.
 *
 * @param {DocumentSubtypeMap} map - The system's map.
 * @param {string} document - The Foundry document class.
 * @returns {string[]} The note types, in sorted order.
 */
export function noteTypesFor(map, document) {
    return Object.entries(map?.types ?? {})
        .filter(([, row]) => row.document === document)
        .map(([noteType]) => noteType)
        .sort();
}

/**
 * The document subtype a note compiles into for one system.
 *
 * @param {DocumentSubtypeMap} map - The system's map.
 * @param {string|undefined} noteType - The note's declared `type`.
 * @param {object} fm - The note's frontmatter, read only for a one-to-many
 *   row's discriminator.
 * @param {object} [options] - Options.
 * @param {string} [options.file] - The note's path, appended to the message.
 *   Omit it where the caller emits through a diagnostic, which already puts
 *   the locator at the start of the line.
 * @param {string} [options.absPath] - The note's file on disk, read only on
 *   the failing path to locate the offending line. The position rides on the
 *   thrown error as `position`, for a caller that emits a diagnostic.
 * @returns {string|undefined} The subtype, or `undefined` where this system
 *   maps nothing for the type — which means no document, not an error.
 * @throws {Error} When a one-to-many row's discriminator is absent, blank, or
 *   names a value the row does not permit.
 */
export function documentSubtype(map, noteType, fm, { file, absPath } = {}) {
    const row = subtypeRow(map, noteType);
    if (!row) return undefined;
    if (row.subType) return row.subType;

    const block = map.block;
    const field = `${block}.${row.discriminator}`;
    const permitted = /** @type {readonly string[]} */ (row.subTypes);
    const declared = readDiscriminator(fm, block, /** @type {string} */ (row.discriminator));

    if (declared === undefined) {
        throw located(
            `a "${noteType}" note compiles into more than one ${map.system} ` +
                `${row.document} subtype, so it must say which: write ` +
                `\`${field}\` as one of ${list(permitted)}`,
            { file, absPath, key: block },
        );
    }
    if (!permitted.includes(declared)) {
        throw located(
            `\`${field}: ${declared}\` is not a ${map.system} ${row.document} ` +
                `subtype a "${noteType}" note may compile into — write one of ` +
                `${list(permitted)}`,
            { file, absPath, key: row.discriminator, value: declared },
        );
    }
    return declared;
}

/** Resolve an item note's native type, including a valid system override.
 * @param {DocumentSubtypeMap} map - The target system map.
 * @param {object} fm - The note frontmatter.
 * @param {object} [options] - Source location.
 * @param {string} [options.file] - File displayed in the finding.
 * @param {string} [options.absPath] - File containing the finding.
 * @returns {string} The native item type.
 */
export function itemDocumentSubtype(map, fm, options = {}) {
    const row = subtypeRow(map, fm.type);
    const block = fm?.[map.block];
    const supplied = block != null && Object.hasOwn(block, "type");
    const raw = supplied ? block.type : undefined;
    if (supplied) {
        const value = typeof raw === "string" ? raw.trim() : "";
        const allowed = row?.discriminator === "type" ? row.subTypes : undefined;
        if (!value || (allowed ? !allowed.includes(value) : !isNativeItemSubtype(map, value))) {
            const choices = allowed ?? nativeItemSubtypes(map);
            throw located(
                `\`${map.block}.type\` on a "${fm.type}" note must name one of ${list(choices)}`,
                { ...options, path: [map.block, "type"] },
            );
        }
        return value;
    }
    if (!row && ITEM_NOTE_TYPES.includes(fm.type)) {
        throw located(
            `${map.system} has no default Item type for a "${fm.type}" note; write \`${map.block}.type\` as one of ${list(nativeItemSubtypes(map))}`,
            { ...options, path: [map.block] },
        );
    }
    if (row?.discriminator === "type" && row.subTypes?.includes(fm.type)) return fm.type;
    try {
        return documentSubtype(map, fm.type, fm, options) ?? fm.type;
    } catch (error) {
        if (options.absPath) {
            error.position = positionOfFrontmatterPath(
                fs.readFileSync(options.absPath, "utf8"),
                [map.block],
                { key: true },
            );
        }
        throw error;
    }
}

/** @param {DocumentSubtypeMap} map - The target system map.
 * @returns {string[]} The native item subtypes.
 */
function nativeItemSubtypes(map) {
    return [
        ...new Set(
            Object.values(map.types)
                .filter((row) => row.document === "Item")
                .flatMap((row) => (row.subType ? [row.subType] : (row.subTypes ?? []))),
        ),
    ].sort();
}

/** Check a native item type without interpreting it as a note type.
 * @param {DocumentSubtypeMap} map - The target system map.
 * @param {unknown} value - The authored native type.
 * @returns {boolean} Whether the map declares this native item type.
 */
export function isNativeItemSubtype(map, value) {
    return (
        typeof value === "string" &&
        value.trim() !== "" &&
        Object.values(map.types).some(
            (candidate) =>
                candidate.document === "Item" &&
                (candidate.subType === value || candidate.subTypes?.includes(value)),
        )
    );
}

/**
 * The answer {@link referencedSubtype} gives: a subtype, or why there is none.
 *
 * Exactly one of the two fields is set. A `problem` is a sentence a caller
 * prefixes with its own context and emits as a finding — it never throws,
 * because the caller resolving a reference is walking a list and has to report
 * this one and carry on.
 *
 * @typedef {object} ReferencedSubtype
 * @property {string} [subType] - The document subtype the reference addresses.
 * @property {string} [problem] - Why the reference names no document subtype.
 */

/** Every subtype a map's rows produce, per map. @type {WeakMap<object, Set<string>>} */
const PRODUCED = new WeakMap();

/**
 * The document subtypes the rows of a map produce.
 *
 * @param {DocumentSubtypeMap} map - The system's map.
 * @returns {Set<string>} Each one-to-one row's subtype and every subtype a
 *   one-to-many row permits.
 */
function producedSubtypes(map) {
    let produced = PRODUCED.get(map);
    if (!produced) {
        produced = new Set();
        for (const row of Object.values(map?.types ?? {})) {
            if (row.subType) produced.add(row.subType);
            for (const subType of row.subTypes ?? []) produced.add(subType);
        }
        PRODUCED.set(map, produced);
    }
    return produced;
}

/**
 * The document subtype a `(type, shortcode)` **reference** addresses.
 *
 * A being's frontmatter names each embedded item by the *note's* type — the
 * vocabulary an author writes — while the predefined items it resolves against
 * are compiled documents, which carry only the *subtype*. One side has to
 * translate, and it is this one: the map is a function from note type to
 * subtype by construction, whereas the reverse is not — two note types may
 * compile into one subtype, and a compiled document records nothing about the
 * note that produced it. So the addresses stay keyed on the **document
 * subtype**, which is the only vocabulary both a local pack and an extracted
 * dependency catalogue actually carry, and a reference is translated forward
 * here before it is looked up.
 *
 * Five answers, and only the last refuses:
 *
 * - _A one-to-one row_ → the subtype it declares. `armor` addresses an
 *   `armorgear`.
 * - _No row at all_ → the note type itself. A consumer declares its own item
 *   types in its `itemBuilders` table rather than in this system's map, and the
 *   Item pass stamps such a document with the note type; the reference has to
 *   agree, or a consumer's own items would stop resolving the moment a map
 *   existed.
 * - _A row for another document class_ → a problem. A being is not an item,
 *   however the address is spelled.
 * - _A one-to-many row, named by one of its own permitted subtypes_ → that
 *   subtype. HM3's `weapongear` row is keyed by the note type `weapongear` but
 *   permits `["weapongear", "missilegear"]`; a reference spelled `weapongear`
 *   is not ambiguous — it already names the subtype it wants, the same as a
 *   reference spelled `missilegear` does by matching no row at all and taking
 *   the unmapped fallback above. Only the row's own key can coincide with one
 *   of its subtypes, so this is never a second guess at the note's
 *   frontmatter — the row was looked up by this exact spelling.
 * - _A one-to-many row, named by neither the row's other permitted subtypes
 *   nor resolved above_ → a problem naming the candidates. The note that owns
 *   such a row resolves it from its own frontmatter block; a reference naming
 *   only the row has no block to read a discriminator from, so nothing here
 *   can choose, and choosing anyway would be right about half the time.
 *
 * A type that no row names, that no row produces as a subtype and that the
 * consumer does not declare is refused: stamping the authored spelling on it
 * would address a document that cannot exist.
 *
 * @param {DocumentSubtypeMap} map - The system's map.
 * @param {string|undefined} noteType - The type the reference names.
 * @param {string} document - The Foundry document class the reference must
 *   address — `"Item"` for a being's embedded items.
 * @param {object} [options] - Options.
 * @param {ReadonlySet<string>} [options.declared] - The item types the
 *   consuming repository declares itself, which the map does not name.
 * @returns {ReferencedSubtype} The subtype, or why there is none.
 */
export function referencedSubtype(map, noteType, document, { declared } = {}) {
    if (!noteType || typeof noteType !== "string") {
        return { problem: "the reference names no type" };
    }

    const row = subtypeRow(map, noteType);
    // No row: the type is the consumer's own, or a subtype a row produces, and
    // its document is stamped with the note type. See the note on the unmapped
    // fallback above. Returned as *authored* — the Item pass stamps an unmapped
    // document with `fm.type` verbatim, and the two answers have to agree.
    if (!row) {
        if (declared?.has(noteType) || producedSubtypes(map).has(noteType)) {
            return { subType: noteType };
        }
        return { problem: `"${noteType}" is not a type any registry declares` };
    }

    if (row.document !== document) {
        return {
            problem:
                `${map.system} compiles a "${noteType}" note into a ` +
                `${row.document}, not a ${document}`,
        };
    }
    if (!row.subType) {
        const permitted = /** @type {readonly string[]} */ (row.subTypes);
        // The reference is not ambiguous when its own spelling names one of the
        // row's permitted subtypes rather than merely the row itself: a
        // `weapongear` reference into HM3's one-to-many `weapongear` row already
        // says which subtype it wants, in the same way a `missilegear`
        // reference does by never matching this row's key at all. Only a
        // reference that names the row without naming a subtype is genuinely
        // undecidable.
        if (permitted.includes(noteType)) {
            return { subType: noteType };
        }
        return {
            problem:
                `a "${noteType}" note compiles into more than one ${map.system} ` +
                `${document} subtype (${list(permitted)}), and a ` +
                `(type, shortcode) reference cannot say which`,
        };
    }
    return { subType: row.subType };
}

/**
 * Read a discriminator out of one system's block, and nowhere else.
 *
 * Deliberately **not** {@link sohlField}, which falls back to the top level: a
 * discriminator is a statement about *this system's* document, so a note that
 * wrote it outside this system's block has not supplied it. Accepting it
 * anyway is how a second system's block would silently answer for the first.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The system's block key.
 * @param {string} key - The discriminator key within it.
 * @returns {string|undefined} The declared value, or `undefined` when absent
 *   or blank — the two are the same thing to an author.
 */
function readDiscriminator(fm, block, key) {
    if (fm == null || typeof fm !== "object") return undefined;
    const declared = /** @type {Record<string, unknown>} */ (fm)[block];
    if (declared == null || typeof declared !== "object") return undefined;
    const value = /** @type {Record<string, unknown>} */ (declared)[key];
    if (value == null) return undefined;
    const text = String(value).trim();
    return text === "" ? undefined : text;
}

/**
 * Build an error carrying the position of the frontmatter key it is about.
 *
 * @param {string} message - What is wrong, in one sentence.
 * @param {object} at - Where.
 * @param {string} [at.file] - The note's path, appended to the message.
 * @param {string} [at.absPath] - The note's file, read to locate the key.
 * @param {string} [at.key] - The frontmatter key to locate.
 * @param {string} [at.value] - Prefer the line carrying this value.
 * @param {string[]} [at.path] - Exact frontmatter path.
 * @returns {Error & {position?: {line?: number, column?: number}}} The error.
 */
function located(message, { file, absPath, key, value, path } = {}) {
    const err = /** @type {Error & {position?: object}} */ (
        new Error(message + (file ? ` — ${file}` : ""))
    );
    const position =
        path && absPath ?
            positionOfFrontmatterPath(fs.readFileSync(absPath, "utf8"), path, { key: true })
        : key ? locateFrontmatterKey(absPath, key, value)
        : undefined;
    if (position) err.position = position;
    return err;
}

/**
 * A readable list of permitted values, for a message an author acts on.
 *
 * @param {readonly string[]} values - The values.
 * @returns {string} `"a", "b" or "c"`.
 */
function list(values) {
    const quoted = values.map((value) => `"${value}"`);
    if (quoted.length <= 1) return quoted.join("");
    return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/**
 * Which system defines the document a note of this type compiles into.
 *
 * A journal, a macro, a scene and an item's documentation journal belong to no
 * system and answer {@link NO_SYSTEM}; an item or an actor belongs to whichever
 * system's map claims its note type.
 *
 * `maps` is required rather than defaulted, so this stays reachable from any
 * pass: the registry of maps lives in `note-claims.mjs`, which imports half the
 * engine, and defaulting to it here would drag that in wherever an address is
 * built.
 *
 * @param {string} type - The note's `type`.
 * @param {readonly object[]} maps - The document-subtype maps this build ships.
 * @returns {string} The system id, or {@link NO_SYSTEM}.
 */
export function systemOf(type, maps) {
    for (const map of maps ?? []) {
        if (subtypeRow(map, type)) return map.system;
    }
    return NO_SYSTEM;
}
