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
 * Checking a note's **frontmatter** against the schema its `type` declares
 * (#19).
 *
 * Until now nothing did. A note's type decides which properties are required,
 * what shape each value has, and which name another note — but that knowledge
 * existed only implicitly, spread across the readers that happen to consume
 * each field. So an authoring mistake was never reported where it was made:
 *
 * - a **missing required property** surfaced as a downstream failure whose
 *   message was about something else, or as a silently empty field;
 * - a **wrong type** threw deep inside a builder, or was coerced;
 * - a **misspelled property** was simply *ignored* — the builders are an
 *   allow-list, so an unrecognised `sohl:` key is dropped without a word. That
 *   is how 204 kethira mystical abilities shipped with no affiliation (#3), and
 *   why the silence mattered more than the missing field: an author could not
 *   tell a builder that forgot the field apart from a field that does
 *   not belong on the type at all;
 * - a **dead shortcode reference** in frontmatter was not checked at all, only
 *   wikilinks in the body were.
 *
 * **This module is vocabulary-agnostic.** It validates a note against whatever
 * schema its type declares and knows no type names of its own; the SoHL
 * vocabulary lives in `sohl/note-schemas.mjs`. That line is between knowledge
 * of the *game system* and knowledge of the *note format* — not a permission
 * boundary between consumers. Every content project authors the full type
 * vocabulary (an adventure module ships skills, beings and magic swords), so
 * every consumer loads all of it.
 *
 * **It takes a built link index rather than walking itself.** The dead-
 * reference check has to resolve exactly as a wikilink does, cross-package
 * manifests and all, and the way to guarantee that is to call the same
 * resolver rather than write a second one.
 *
 * @module
 */

import { authoredFields } from "./field-spec.mjs";
import { positionInFrontmatter } from "./diagnostics.mjs";
import { RETIRED_TYPES } from "./ids.mjs";
import { draftRetiredMessage } from "./retired-fields.mjs";

/**
 * `sohl:` keys every type accepts, whatever its schema says.
 *
 * Neither is part of a type's vocabulary — both are read for *any* note, by
 * passes that run before a builder sees it — so neither appears in a field
 * declaration and both would otherwise be reported as unknown on every note
 * that uses them.
 *
 * - `folder` — the compendium folder the document is filed in.
 * - `pack` — which compendium of the note's document type receives it, for a
 *   repository shipping several (#1566).
 * - `archetype` — the archetype flag, read for any note by the walk itself.
 * - `kbcat` — the knowledgebase category a note is grouped under.
 *
 * `kbcat` is the one that matters for what this check *is*. **The pack build is
 * not the only reader of a note's frontmatter.** A note also feeds a
 * knowledgebase and a website, and those surfaces consume classification the
 * compiler never emits — `kbcat` alone is read 51 times across SoHL's
 * knowledgebase layouts. A check that equated "the vocabulary" with "what the
 * builder compiles" would report every one of those as an unknown property and
 * turn a correct tree red, which is exactly what it did on first run: 4,241
 * findings against SoHL's own content, none of them a defect.
 *
 * So a type's schema declares what a note **may write**, which is broader than
 * what any one consumer reads.
 *
 * @type {ReadonlySet<string>}
 */
export const UNIVERSAL_KEYS = Object.freeze(
    new Set(["folder", "pack", "archetype", "kbcat"]),
);

/**
 * Edit distance, capped — enough to answer "did you mean".
 *
 * A misspelled property is the failure class this check exists for, and a
 * finding that names the key the author *meant* turns a hunt through the
 * reference into a one-character fix.
 *
 * @param {string} a - One string.
 * @param {string} b - The other.
 * @returns {number} The Levenshtein distance.
 */
function distance(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    let prev = Array.from({ length: cols }, (_, j) => j);
    for (let i = 1; i < rows; i += 1) {
        const row = [i];
        for (let j = 1; j < cols; j += 1) {
            row[j] = Math.min(
                prev[j] + 1,
                row[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        prev = row;
    }
    return prev[cols - 1];
}

/**
 * The declared key an unknown one was most likely meant to be.
 *
 * @param {string} key - The unknown key.
 * @param {Iterable<string>} candidates - The declared keys.
 * @returns {string|undefined} The nearest, when it is near enough to suggest.
 */
function nearest(key, candidates) {
    let best;
    let bestAt = Infinity;
    for (const candidate of candidates) {
        const d = distance(key.toLowerCase(), candidate.toLowerCase());
        if (d < bestAt) {
            bestAt = d;
            best = candidate;
        }
    }
    // A third of the key's length, so a suggestion is a plausible typo rather
    // than the least-bad of a list of unrelated words.
    return bestAt <= Math.max(1, Math.floor(key.length / 3)) ? best : undefined;
}

/**
 * Whether a value satisfies a declared {@link FieldSpec.kind}.
 *
 * Deliberately lenient about the spellings YAML makes ambiguous: `"12"` is a
 * number, because a quoted scalar is how a number arrives from many editors,
 * and a map authored as an empty list is a map, because Obsidian's property
 * editor serialises an emptied map that way (#8). What it rejects is a value
 * that cannot mean what the field is for — `weight: heavy`.
 *
 * @param {unknown} value - The authored value.
 * @param {string} kind - The declared kind.
 * @returns {boolean} Whether it is acceptable.
 */
export function matchesKind(value, kind) {
    switch (kind) {
        case "number":
            return typeof value === "number" ?
                    Number.isFinite(value)
                :   typeof value === "string" &&
                        value.trim() !== "" &&
                        Number.isFinite(Number(value));
        case "boolean":
            return (
                typeof value === "boolean" ||
                value === "true" ||
                value === "false"
            );
        case "string":
            return typeof value !== "object" || value === null;
        case "list":
            return Array.isArray(value);
        case "map":
            // An emptied map arrives as `[]` from the property editor, and
            // means "this note authors no entries" — the same thing `{}` means.
            return (
                (typeof value === "object" &&
                    value !== null &&
                    !Array.isArray(value)) ||
                (Array.isArray(value) && value.length === 0)
            );
        default:
            return true;
    }
}

/**
 * The `sohl:` block a note authored, or an empty one.
 *
 * @param {object} fm - The note's frontmatter.
 * @returns {object} The block.
 */
function sohlBlock(fm) {
    const block = fm?.sohl;
    return block && typeof block === "object" && !Array.isArray(block) ?
            block
        :   {};
}

/**
 * Check one note against its type's schema.
 *
 * @param {object} note - A note from the link index (`{fm, file, raw, type}`).
 * @param {object} opts
 * @param {Record<string, readonly object[]>} opts.schemas - Type → declaration.
 * @param {object} [opts.index] - The link index, for the reference check. Its
 *   absence skips that check rather than reporting every reference as dead.
 * @returns {object[]} Findings, each with a locator where one is obtainable.
 */
export function lintNote(note, { schemas, index }) {
    const findings = [];
    const fm = note.fm ?? {};
    const type = String(fm.type ?? "");
    const raw = () => note.raw ?? "";
    const at = (key, literal) =>
        positionInFrontmatter(raw(), key, literal ?? undefined);

    // The retired top-level fields, checked before the type: a note may carry
    // one whatever its type is, and each finding stands on its own. Reported
    // here as well as refused at compile because this is where an author meets
    // every finding in the tree at once, rather than one note at a time (#56).
    if (Object.hasOwn(fm, "package")) {
        findings.push({
            file: note.file,
            ...at("package"),
            severity: "error",
            message:
                "`package:` is a retired frontmatter field — delete it. A " +
                "note's package is this repository's configured " +
                "`contentPackage`, in package-build.config.yaml, and every " +
                "note in the tree belongs to it",
        });
    }
    if (Object.hasOwn(fm, "draft")) {
        findings.push({
            file: note.file,
            ...at("draft"),
            severity: "error",
            message: draftRetiredMessage(),
        });
    }

    const replacement = RETIRED_TYPES[type];
    if (replacement) {
        findings.push({
            file: note.file,
            ...at("type", type),
            severity: "error",
            message:
                `content type "${type}" was retired in favour of ` +
                `"${replacement}"; both compiled to the same document, so the ` +
                `fix is mechanical: write "${replacement}"`,
        });
        return findings;
    }

    const schema = schemas[type];
    if (!schema) {
        findings.push({
            file: note.file,
            ...at("type", type),
            severity: "error",
            message:
                `no schema is declared for content type "${type}", so nothing ` +
                `can say what this note may write; declare it, or correct the type`,
        });
        return findings;
    }

    const fields = authoredFields(schema);
    const block = sohlBlock(fm);
    /** First segment of each declared name — `impact.die` is authored as `impact`. */
    const declared = new Set(fields.map((f) => f.name.split(".")[0]));

    for (const key of Object.keys(block)) {
        if (declared.has(key) || UNIVERSAL_KEYS.has(key)) continue;
        const guess = nearest(key, declared);
        findings.push({
            file: note.file,
            ...at(key),
            severity: "error",
            message:
                `"${key}" is not a property of a ${type}; it is discarded at ` +
                `compile with no warning` +
                (guess ? `. Did you mean "${guess}"?` : ""),
        });
    }

    for (const field of fields) {
        // Only top-level names are read here: a nested one (`impact.die`) is
        // reached through its parent, and reporting the parent twice — once as
        // itself and once as its child — helps nobody.
        const [head, ...rest] = field.name.split(".");
        let value = block[head];
        for (const segment of rest) {
            value =
                value && typeof value === "object" ? value[segment] : undefined;
        }
        const absent = value === undefined || value === null;

        if (field.required && absent) {
            findings.push({
                file: note.file,
                ...at("type", type),
                severity: "error",
                message: `a ${type} must declare \`sohl.${field.name}\` — ${field.describe}`,
            });
            continue;
        }
        if (absent) continue;

        if (field.kind && !matchesKind(value, field.kind)) {
            findings.push({
                file: note.file,
                ...at(head),
                severity: "error",
                message:
                    `\`sohl.${field.name}\` should be ${field.shape ?? field.kind}, ` +
                    `but reads ${JSON.stringify(value)}`,
            });
            continue;
        }

        // A reference names another note by shortcode. Resolved through the
        // link index's own resolver, so a cross-package reference answered by a
        // vendored manifest lands exactly as the same address in a wikilink
        // would — rather than through a second, subtly different rule.
        if (field.ref && index && typeof value === "string" && value) {
            const target = `${field.ref}-${value}`;
            if (!index.resolve(note, target) && !index.manifestHit(target)) {
                findings.push({
                    file: note.file,
                    ...at(head, value),
                    severity: "error",
                    message:
                        `\`sohl.${field.name}\` names ${field.ref} ` +
                        `"${value}", and no note or vendored manifest declares it`,
                });
            }
        }
    }

    return findings;
}

/**
 * Check every note in a built index against its type's schema.
 *
 * @param {object} index - From `buildLinkIndex`.
 * @param {object} opts
 * @param {Record<string, readonly object[]>} opts.schemas - Type → declaration.
 * @param {boolean} [opts.references=true] - Whether to check references.
 * @returns {{findings: object[], notes: number}} The findings, and how many
 *   notes were inspected.
 */
export function lintFrontmatter(index, { schemas, references = true }) {
    const findings = [];
    const notes = [...index.notes].sort((a, b) =>
        a.file < b.file ? -1
        : a.file > b.file ? 1
        : 0,
    );
    for (const note of notes) {
        findings.push(
            ...lintNote(note, {
                schemas,
                index: references ? index : undefined,
            }),
        );
    }
    return { findings, notes: notes.length };
}
