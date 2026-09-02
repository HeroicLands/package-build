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
 * The two rules that are not schema-driven sit on the *note format* side of
 * that line, which is why they are here and not in `sohl/`: the retired
 * top-level fields, and the address-bearing fields a `type: homepage` note
 * refuses (#53). Each supplies its own message from the module that owns the
 * knowledge — `retired-fields.mjs` and `homepage.mjs` — and this module only
 * locates it in the file.
 *
 * **It takes a built link index rather than walking itself.** The dead-
 * reference check has to resolve exactly as a wikilink does, cross-package
 * manifests and all, and the way to guarantee that is to call the same
 * resolver rather than write a second one.
 *
 * @module
 */

import { authoredFields } from "./field-spec.mjs";
import { resolveFieldValue, SYSTEM_BLOCK_KEYS, unknownBlockKeys } from "./system-block.mjs";
import { positionInFrontmatter, positionOfFrontmatterPath } from "./diagnostics.mjs";
import { checkHomepageAddressFields } from "./homepage.mjs";
import { RETIRED_TYPES } from "./ids.mjs";
import {
    RETIRED_FIELD_ALIASES,
    declaresRetiredAlias,
    draftRetiredMessage,
    readAliasedField,
    retiredAliasMessage,
} from "./retired-fields.mjs";

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
export const UNIVERSAL_KEYS = Object.freeze(new Set(["folder", "pack", "archetype", "kbcat"]));

/**
 * The system blocks a build checks, and what each accepts beyond the shared
 * vocabulary.
 *
 * One entry, because one system is what every existing tree declares — and the
 * default is a *declaration*, not a hard-coded assumption: a build that ships
 * content for two systems passes both, and each block is then checked against
 * its own vocabulary rather than against the other's (#58). A block nothing
 * declares is not checked, because nothing can say what it may carry, and
 * inventing a rule for it would report a correct tree red.
 *
 * `fieldVocabulary` says the note type's own declared field names are keys of
 * this block. True for `sohl` and untrue in general: those names come from the
 * `itemBuilders` registry that this system declares, and a second system's
 * notes write a second system's fields.
 *
 * @type {Readonly<Record<string, {known?: readonly string[], fieldVocabulary?: boolean}>>}
 */
export const DEFAULT_SYSTEM_BLOCKS = Object.freeze({
    sohl: Object.freeze({ fieldVocabulary: true }),
});

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
            return typeof value === "boolean" || value === "true" || value === "false";
        case "string":
            return typeof value !== "object" || value === null;
        case "list":
            return Array.isArray(value);
        case "map":
            // An emptied map arrives as `[]` from the property editor, and
            // means "this note authors no entries" — the same thing `{}` means.
            return (
                (typeof value === "object" && value !== null && !Array.isArray(value)) ||
                (Array.isArray(value) && value.length === 0)
            );
        default:
            return true;
    }
}

/**
 * The `data:` container a note authored.
 *
 * An emptied map arrives from the property editor as `[]` and means the same
 * thing `{}` does — this note authors no entries (#8) — so both read as an
 * empty container rather than as a malformed one.
 *
 * @param {object} fm - The note's frontmatter.
 * @returns {{present: boolean, entries: object, malformed: boolean}} What was
 *   authored, and whether it is a container at all.
 */
function dataBlock(fm) {
    if (!Object.hasOwn(fm ?? {}, "data")) {
        return { present: false, entries: {}, malformed: false };
    }
    const value = fm.data;
    if (value == null || (Array.isArray(value) && value.length === 0)) {
        return { present: true, entries: {}, malformed: false };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        return { present: true, entries: {}, malformed: true };
    }
    return { present: true, entries: value, malformed: false };
}

/**
 * Check a note's `data:` container against the closed vocabulary its type
 * declares (#128).
 *
 * Unlike the top level, which is passed through to the published page and so
 * cannot be refused, `data:` holds the type-specific facts about the subject
 * and every key of it is declared. An unrecognised key is therefore a finding
 * naming the note, with the key it was most likely meant to be — the same
 * capped edit distance {@link nearest} applies to a `sohl:` key, drawn from
 * this type's own vocabulary rather than from every type's.
 *
 * @param {object} note - The note.
 * @param {object} opts
 * @param {string} opts.type - The note's type, for the message.
 * @param {readonly object[]} opts.fields - The type's `data:` declaration.
 * @returns {object[]} Findings.
 */
function checkDataContainer(note, { type, fields }) {
    const findings = [];
    const { present, entries, malformed } = dataBlock(note.fm ?? {});
    if (!present) return findings;

    const raw = note.raw ?? "";
    if (malformed) {
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(raw, ["data"], { key: true }),
            severity: "error",
            message:
                "`data:` must be a map of the note's own type-specific " +
                `properties, but reads ${JSON.stringify(note.fm.data)}`,
        });
        return findings;
    }

    /** First segment of each declared name — `charges.value` is authored as `charges`. */
    const declared = new Set(fields.map((f) => f.name.split(".")[0]));

    for (const key of Object.keys(entries)) {
        if (declared.has(key)) continue;
        const guess = nearest(key, declared);
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(raw, ["data", key], { key: true }),
            severity: "error",
            message:
                `"${key}" is not a \`data:\` property declared by ${type}; ` +
                `the container is closed, so unlike a top-level key it is ` +
                `not passed through to the page` +
                (guess ? `. Did you mean "${guess}"?` : ""),
        });
    }

    for (const field of fields) {
        if (!field.kind) continue;
        const segments = field.name.split(".");
        let value = entries;
        for (const segment of segments) {
            value = value && typeof value === "object" ? value[segment] : undefined;
        }
        if (value === undefined || value === null) continue;
        if (matchesKind(value, field.kind)) continue;
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(raw, ["data", ...segments]),
            severity: "error",
            message:
                `\`data.${field.name}\` should be ${field.shape ?? field.kind}, ` +
                `but reads ${JSON.stringify(value)}`,
        });
    }

    return findings;
}

/**
 * Check a note's top-level `subType` against the values its type declares
 * (#128).
 *
 * `subType` stays at the top level — it is what each system's map reads to
 * derive a document type, so it describes the note rather than the subject —
 * but it is not open like the rest of that region: a type either declares a
 * `subType` or does not, and a type that does declares its values.
 *
 * @param {object} note - The note.
 * @param {object} opts
 * @param {string} opts.type - The note's type, for the message.
 * @param {object} opts.entry - The type's vocabulary entry.
 * @returns {object[]} Findings.
 */
function checkSubType(note, { type, entry }) {
    const fm = note.fm ?? {};
    if (!Object.hasOwn(fm, "subType") || fm.subType == null || fm.subType === "") return [];

    const value = String(fm.subType);
    const at = positionInFrontmatter(note.raw ?? "", "subType");

    if (!Object.hasOwn(entry, "subTypes")) {
        return [
            {
                file: note.file,
                ...at,
                severity: "error",
                message:
                    `\`subType\` is not a property declared by ${type}; it ` +
                    `declares no subtypes, so nothing reads this value`,
            },
        ];
    }

    const values = entry.subTypes;
    // `null` is "declared, values not yet enumerated" — presence is legal and
    // the value is nobody's to check yet.
    if (values == null || values.includes(value)) return [];

    const guess = nearest(value, values);
    return [
        {
            file: note.file,
            ...at,
            severity: "error",
            message:
                `\`subType\` "${value}" is not one of the subtypes ` +
                `${type} declares (${values.join(", ")})` +
                (guess ? `. Did you mean "${guess}"?` : ""),
        },
    ];
}

/**
 * Check one note against its type's schema.
 *
 * @param {object} note - A note from the link index (`{fm, file, raw, type}`).
 * @param {object} opts
 * @param {Record<string, readonly object[]>} opts.schemas - Type → declaration.
 * @param {object} [opts.index] - The link index, for the reference check. Its
 *   absence skips that check rather than reporting every reference as dead.
 * @param {Record<string, object>} [opts.vocabulary] - Type → the closed regions
 *   it declares, as `engine/note-vocabulary.mjs` states them (#128). Supplied
 *   by the caller for the same reason `schemas` is: this module validates a
 *   note against whatever its type declares and knows no type names of its
 *   own. Its absence skips the `data:` and `subType` checks rather than
 *   reporting every key as unknown.
 * @param {Readonly<Record<string, {known?: readonly string[], fieldVocabulary?: boolean}>>} [opts.systems]
 *   The system blocks to check, and what each accepts. See
 *   {@link DEFAULT_SYSTEM_BLOCKS}.
 * @returns {object[]} Findings, each with a locator where one is obtainable.
 */
export function lintNote(note, { schemas, index, vocabulary, systems = DEFAULT_SYSTEM_BLOCKS }) {
    const findings = [];
    const fm = note.fm ?? {};
    const type = String(fm.type ?? "");
    const raw = () => note.raw ?? "";
    const at = (key, literal) => positionInFrontmatter(raw(), key, literal ?? undefined);

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

    // A homepage's address is its package's, so the top-level fields that
    // decide an address decide nothing on it (#53). Reported beside the retired
    // fields above because it is the same kind of statement — a top-level key
    // this note may not write — and, like them, it must survive the two early
    // returns below: the finding stands whatever else the type is.
    for (const { key, message } of checkHomepageAddressFields(fm)) {
        findings.push({
            file: note.file,
            ...at(key),
            severity: "error",
            message,
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

    // The closed frontmatter regions (#128), checked beside the `sohl:` block
    // because they are the same statement about the same note: this key is not
    // one this type may write. Skipped entirely when the caller declares no
    // vocabulary — reporting every key as unknown because nothing was loaded
    // to recognise it would be worse than not checking.
    const entry = vocabulary?.[type];
    if (entry) {
        findings.push(...checkDataContainer(note, { type, fields: entry.data ?? [] }));
        findings.push(...checkSubType(note, { type, entry }));
    }

    const fields = authoredFields(schema);
    /** First segment of each declared name — `impact.die` is authored as `impact`. */
    const declared = new Set(fields.map((f) => f.name.split(".")[0]));

    // The retired spelling of a field this type declares → what to write now.
    // Built from the type's own vocabulary, so a renamed field is retired
    // exactly where its replacement exists and the old name stays an unknown
    // key everywhere else (#142).
    const renamed = new Map();
    for (const name of declared) {
        const retired = RETIRED_FIELD_ALIASES[name];
        if (retired) renamed.set(retired, name);
    }
    for (const [retired, current] of renamed) {
        // `declaresRetiredAlias` searches both regions, because both are read:
        // a note that moved the key to the top level without renaming it has
        // done half the migration. It is the same predicate the compile-time
        // report asks, so the two cannot disagree about what a note declares.
        if (!declaresRetiredAlias(fm, current)) continue;
        findings.push({
            file: note.file,
            ...at(retired),
            // A warning, not an error: the note compiles to the correct
            // document, so failing a build over it would red a tree that has
            // done nothing wrong yet. The refusal comes after the sweep, as
            // `package:`'s did (#56).
            severity: "warning",
            message: retiredAliasMessage(retired, current),
        });
    }

    // Every declared system's block, each against its own vocabulary (#58). A
    // block carries the shared keys any system's does — `system`, `type`,
    // `img`, `effects`, `flags`, `pack` — plus whatever that system declares:
    // for `sohl`, the note type's own field names, which are still the position
    // the corpus authors them at until #126 moves them.
    for (const [blockName, spec] of Object.entries(systems ?? {})) {
        const accepted = new Set([
            ...UNIVERSAL_KEYS,
            ...(spec?.known ?? []),
            ...(spec?.fieldVocabulary ? declared : []),
        ]);
        for (const key of unknownBlockKeys(fm, blockName, { known: accepted })) {
            // Reported above, with what to write instead — a retired spelling
            // is a rename to schedule, not a key nobody recognises. Only where
            // the block's vocabulary is this type's: the alias renames *this*
            // system's field, and another system's like-spelled key is not it.
            if (spec?.fieldVocabulary && renamed.has(key)) continue;
            const guess = nearest(key, [...accepted, ...SYSTEM_BLOCK_KEYS]);
            findings.push({
                file: note.file,
                ...at(key),
                severity: "error",
                message:
                    `"${key}" is not a property of a ${type}` +
                    (blockName === "sohl" ? "" : ` under \`${blockName}\``) +
                    `; it is discarded at compile with no warning` +
                    (guess ? `. Did you mean "${guess}"?` : ""),
            });
        }
    }

    for (const field of fields) {
        // Only top-level names are read here: a nested one (`impact.die`) is
        // reached through its parent, and reporting the parent twice — once as
        // itself and once as its child — helps nobody.
        const [head] = field.name.split(".");
        // Resolved exactly as the compiler resolves it (#58): the system path
        // first, then the block, then the declared shared source. A lint that
        // read only one of the three would report a note's own field as missing
        // the moment it moved to another of them. A **shared** field needs
        // nothing extra here — the note's top level *is* the third step — so
        // `shared` says only where the field's home is, for the message below.
        let { value, from } = resolveFieldValue(field, fm, { block: "sohl" });
        // A **renamed** field may still be written under its retired spelling,
        // which that order knows nothing about. It resolves through the reader
        // the compiler uses, so the lint cannot disagree with the build about
        // which value a note carries (#142).
        if ((from === "default" || value == null) && RETIRED_FIELD_ALIASES[field.name]) {
            const aliased = readAliasedField(fm, field.name);
            if (aliased !== undefined) {
                value = aliased;
                from = "block";
            }
        }
        const absent = from === "default" || value === undefined || value === null;
        // Where the field belongs, as a message names it: a shared field is not
        // under `sohl:`, so telling an author to write `sohl.img` would send
        // them to the wrong region.
        const label = field.shared ? `\`${field.name}\`` : `\`sohl.${field.name}\``;

        if (field.required && absent) {
            findings.push({
                file: note.file,
                ...at("type", type),
                severity: "error",
                message: `a ${type} must declare ${label} — ${field.describe}`,
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
                    `${label} should be ${field.shape ?? field.kind}, ` +
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
                        `${label} names ${field.ref} ` +
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
 * @param {Record<string, object>} [opts.vocabulary] - Type → the closed regions
 *   it declares (#128); see {@link lintNote}.
 * @param {boolean} [opts.references=true] - Whether to check references.
 * @param {Readonly<Record<string, {known?: readonly string[], fieldVocabulary?: boolean}>>} [opts.systems]
 *   The system blocks to check. See {@link DEFAULT_SYSTEM_BLOCKS}.
 * @returns {{findings: object[], notes: number}} The findings, and how many
 *   notes were inspected.
 */
export function lintFrontmatter(index, { schemas, vocabulary, references = true, systems }) {
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
                vocabulary,
                index: references ? index : undefined,
                ...(systems ? { systems } : {}),
            }),
        );
    }
    return { findings, notes: notes.length };
}
