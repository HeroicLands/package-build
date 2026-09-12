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
 * Checking a note's **frontmatter** against the schema its `type` declares.
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
 * refuses. Each supplies its own message from the module that owns the
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

import { authoredFields, readsLegacyKey } from "./field-spec.mjs";
import {
    legacyKeyOf,
    resolveFieldValue,
    systemBlock,
    SYSTEM_BLOCK_KEYS,
    unknownBlockKeys,
} from "./system-block.mjs";
import { positionInFrontmatter, positionOfFrontmatterPath } from "./diagnostics.mjs";
import { checkHomepageAddressFields } from "./homepage.mjs";
import { RETIRED_TYPES, RENAMED_TYPES, currentType, renamedTypeMessage } from "./ids.mjs";
import { isAddressSegment } from "./address-charset.mjs";
// The one place the "every pack not named" key is spelled. Imported rather
// than repeated, because a linter holding its own copy of what the compiler
// reads is exactly the disagreement to avoid.
import { DEFAULT_PARENT } from "./folder-notes.mjs";
import { declaredTags, subTypeCharsetMessage, typeCharsetMessage } from "./note-vocabulary.mjs";
import {
    RETIRED_FIELD_ALIASES,
    declaresRetiredAlias,
    aliasesRetiredMessage,
    declaresRetiredAliasesField,
    draftRetiredMessage,
    legacyKeyMessage,
    readAliasedField,
    retiredAliasMessage,
    sectionRetiredMessage,
    traitsRetiredMessage,
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
 *   repository shipping several.
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
    new Set(["packFolder", "pack", "archetype", "templatePriority", "kbcat"]),
);

/**
 * The system blocks a build checks, and what each accepts beyond the shared
 * vocabulary.
 *
 * One entry, because one system is what every existing tree declares — and it
 * is a *fallback*, not the rule. {@link systemBlocksFor} derives the map from
 * the configuration, which is what makes the block a package actually ships for
 * the block that gets checked; this is what a caller holding no configuration
 * gets, which in practice is a unit test.
 *
 * A block nothing declares is not checked, because nothing can say what it may
 * carry, and inventing a rule for it would report a correct tree red.
 *
 * Three ways a block may state its vocabulary, and a spec declares at most one:
 *
 * - `known` — an explicit list of keys, for a caller stating them outright.
 * - `fieldVocabulary` — the note type's own declared field names, as the
 *   caller's `schemas` state them, are keys of this block. That holds for the
 *   **one** system a single-registry tree ships for, where `schemas` *is* that
 *   system's vocabulary, and in general holds for no other.
 * - `fields` — type → that system's own declared fields, from the registry the
 *   system declares. What a second system's block is checked against, because a
 *   second system's notes write a second system's fields and the note-type
 *   schemas describe somebody else's.
 *
 * @type {Readonly<Record<string, SystemBlockSpec>>}
 */
export const DEFAULT_SYSTEM_BLOCKS = Object.freeze({
    sohl: Object.freeze({ fieldVocabulary: true }),
});

/**
 * What one system block accepts beyond the keys every block carries.
 *
 * @typedef {object} SystemBlockSpec
 * @property {readonly string[]} [known] - Keys stated outright.
 * @property {boolean} [fieldVocabulary] - Whether the note type's declared field
 *   names, as the caller's `schemas` state them, are keys of this block.
 * @property {Readonly<Record<string, readonly object[]>>} [fields] - Type → this
 *   system's own declared fields. A type it does not name is a type this system
 *   says nothing about, and its block is left unchecked on such a note rather
 *   than reported wholesale.
 */

/**
 * Every system a configuration says its tree carries.
 *
 * **Which systems a package ships for is already declared**, in three places
 * that answer different questions, so this reads all three rather than asking a
 * new one:
 *
 * - `systems:` declares them without requiring one, which is how a
 *   package ships for several;
 * - a **pack's** `system:` is the same statement made per pack, and it is the
 *   one some trees make: `harn-ensemble` declares an `actors-sohl` and an
 *   `actors-hm3` and nothing else about either system. It is already
 *   authoritative elsewhere — `eligibleFor` fails a note for want of the block
 *   a pack's `system:` names — so a lint that did not read it would refuse a
 *   note at compile for a block it never checked;
 * - `stats.systemId` is the package-wide answer where there is one, and it has
 *   already absorbed every way of spelling that: a system package is its own
 *   system, and a module takes `requiresSystem`, its lone `systems:` entry, or
 *   its lone system relationship.
 *
 * A package naming a system in none of them is system-agnostic on purpose — its
 * packs are core document types carrying no system data — so it carries no
 * system block and naming one would invent it.
 *
 * @param {object} [config] - A resolved configuration from `defineConfig`.
 * @returns {string[]} The system ids, deduplicated, in declared order.
 */
export function declaredSystems(config) {
    const out = [];
    for (const system of Object.keys(config?.systems ?? {})) {
        if (!out.includes(system)) out.push(system);
    }
    for (const pack of config?.packs ?? []) {
        const system = pack?.system;
        if (typeof system === "string" && system && !out.includes(system)) out.push(system);
    }
    if (out.length) return out;
    const packageWide = config?.stats?.systemId;
    return typeof packageWide === "string" && packageWide ? [packageWide] : [];
}

/**
 * The system blocks a configuration says its tree carries, and what each
 * accepts.
 *
 * The lint checks the blocks its caller names, and for as long as there was one
 * system the only caller named none — so every tree took the `sohl:` of
 * {@link DEFAULT_SYSTEM_BLOCKS}, a constant, in a module whose whole discipline
 * is that it states no vocabulary of its own. That is wrong in both directions
 * the moment a second system exists, and the second direction is the worse:
 *
 * - a package shipping for `hm3` had its `hm3:` block **never looked at**, so
 *   every key in it was discarded at compile without a word — the silent-drop
 *   family this check exists to close;
 * - and the block that *was* checked was named after a system that package does
 *   not ship for, so the one finding it could make was about nothing.
 *
 * **A block's vocabulary has two sources, and a system may have both.**
 *
 * - The **note schemas** the caller hands in as `schemas`. Those belong to one
 *   system — the CLI imports `sohl/note-schemas.mjs` — and `schemaSystem` is the
 *   caller naming which, because only the caller knows. It is the only source
 *   that reaches a type no item registry declares, which is to say `being`: the
 *   2,512 notes `harn-ensemble` is made of, and the reason this is not an
 *   optional refinement.
 * - The system's **own registry**, `itemFieldsBySystem`, keyed by system and
 *   until now read by nothing. This is what a *second* system's block is held
 *   to, since the note schemas describe its neighbour.
 *
 * A system with neither is left out: nothing can state what its block may
 * carry, and holding it to an empty vocabulary would report every key in a
 * correct tree. **That is a check that does not run**, which is
 * indistinguishable from one that passed, so the caller says it out loud —
 * {@link declaredSystems} is the other half of that comparison. `harn-ensemble`
 * is the tree it names: two systems, and an `itemBuilders` registry for
 * neither, so its `hm3:` block is unchecked until it declares one.
 *
 * An earlier draft of this took the note schemas for a system's vocabulary only
 * where the package declared **one** system, on the reasoning that with several
 * there is nothing to say which one they describe. There is: the caller, which
 * chose them. The guess cost `harn-ensemble` its whole `sohl:` check — two
 * systems declared, so the fallback never fired — which is the coverage this
 * change exists to widen rather than narrow.
 *
 * @param {object} [config] - A resolved configuration from `defineConfig`.
 * @param {object} [options] - Options.
 * @param {string} [options.schemaSystem] - The system whose vocabulary the
 *   caller's `schemas` state. There are two systems, not an open set, so this is
 *   one word from the caller rather than a mechanism.
 * @returns {Readonly<Record<string, SystemBlockSpec>>} The blocks to check, in
 *   declared order. A system nothing states the vocabulary of is absent.
 */
export function systemBlocksFor(config, { schemaSystem } = {}) {
    const byName = config?.itemFieldsBySystem ?? {};
    /** @type {Record<string, SystemBlockSpec>} */
    const blocks = {};
    for (const system of declaredSystems(config)) {
        /** @type {SystemBlockSpec} */
        const spec = {};
        if (system === schemaSystem) spec.fieldVocabulary = true;
        if (byName[system]) spec.fields = byName[system];
        if (Object.keys(spec).length) blocks[system] = Object.freeze(spec);
    }
    return Object.freeze(blocks);
}

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
        case "scalar-or-map":
            // A scalar, or a map of them. The map's *entries* are checked
            // separately, by the caller that can name the key at fault; all
            // this answers is whether the value has one of the two shapes the
            // field admits. A list has neither.
            return matchesKind(value, "string") || matchesKind(value, "map");
        default:
            return true;
    }
}

/**
 * The entries of a `scalar-or-map` value written in its map form, or `null`
 * where it was written as the scalar.
 *
 * The empty-list spelling of an emptied map ({@link matchesKind}) has no
 * entries, so it reads the same as `{}` here too.
 *
 * @param {unknown} value - The authored value.
 * @returns {Record<string, unknown>|null} Its entries, or `null` for a scalar.
 */
function mapEntries(value) {
    if (Array.isArray(value)) return value.length === 0 ? {} : null;
    if (typeof value !== "object" || value === null) return null;
    return /** @type {Record<string, unknown>} */ (value);
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
 * declares.
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
 * @param {readonly string[]} [opts.packs] - The pack names this package
 *   declares, against which a `keys: "pack"` map's keys are checked. Absent,
 *   no claim is made about them: a caller that cannot see the configuration
 *   knows no pack names, and reporting every key as unknown because nothing
 *   was loaded to recognise it would be worse than not checking.
 * @returns {object[]} Findings.
 */
function checkDataContainer(note, { type, fields, packs }) {
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
        if (!matchesKind(value, field.kind)) {
            findings.push({
                file: note.file,
                ...positionOfFrontmatterPath(raw, ["data", ...segments]),
                severity: "error",
                message:
                    `\`data.${field.name}\` should be ${field.shape ?? field.kind}, ` +
                    `but reads ${JSON.stringify(value)}`,
            });
            continue;
        }
        // A `scalar-or-map` written in its map form is checked entry by entry,
        // because that is the correction an author has to make: one key's
        // value, not the whole map. Quoting the map back would name every
        // entry that is right alongside the one that is not.
        const written = field.kind === "scalar-or-map" ? mapEntries(value) : null;
        if (written) {
            findings.push(
                ...checkKeyedMap(note, { field, segments, entries: written, raw, packs }),
            );
        }
    }

    return findings;
}

/**
 * Check one `scalar-or-map` field written in its map form, entry by entry.
 *
 * Two separate statements are checked, and they fail independently: whether a
 * key names something — a pack, for `keys: "pack"` — and whether the value
 * under it has the shape one entry is declared to have. A key nobody declares
 * is not a harmless surplus: the compiler asks the map for the pack it is
 * compiling and takes `default` when there is no such key, so a mistyped
 * `journal:` silently files the folder wherever the default puts it, which is
 * exactly the hierarchy the author wrote the key to override.
 *
 * @param {object} note - The note.
 * @param {object} opts
 * @param {object} opts.field - The field's declaration.
 * @param {readonly string[]} opts.segments - Its path under `data:`.
 * @param {Record<string, unknown>} opts.entries - The map's entries.
 * @param {string} opts.raw - The note's raw text, for positions.
 * @param {readonly string[]} [opts.packs] - The declared pack names, if known.
 * @returns {object[]} Findings, one per offending entry.
 */
function checkKeyedMap(note, { field, segments, entries, raw, packs }) {
    const findings = [];
    const known = field.keys === "pack" && packs?.length ? new Set(packs) : undefined;

    for (const [key, value] of Object.entries(entries)) {
        const path = ["data", ...segments, key];
        const named = `data.${field.name}.${key}`;

        // `default` is the map's own key for "every pack not named", not a
        // pack — spelled out rather than left as an absent key, so a map
        // stating only exceptions still reads as a complete answer.
        if (known && key !== DEFAULT_PARENT && !known.has(key)) {
            const guess = nearest(key, known);
            findings.push({
                file: note.file,
                ...positionOfFrontmatterPath(raw, path, { key: true }),
                severity: "error",
                message:
                    `"${key}" is not a pack this package declares, so ` +
                    `\`${named}\` states a hierarchy nothing reads` +
                    (guess ? `. Did you mean "${guess}"?` : ""),
            });
            continue;
        }

        // An explicit `~` under a key is a statement, not an omission: it says
        // "at the root there", which is different from saying nothing.
        if (value === undefined || value === null) continue;
        if (matchesKind(value, "string")) continue;
        findings.push({
            file: note.file,
            // On the key, not the value: an entry whose value is itself a map
            // begins on the *next* line, so pointing at the value lands a
            // reader inside the thing that is wrong rather than on the entry
            // the message names.
            ...positionOfFrontmatterPath(raw, path, { key: true }),
            severity: "error",
            message:
                `\`${named}\` should be ${field.entryShape ?? "a scalar"}, ` +
                `but reads ${JSON.stringify(value)}`,
        });
    }

    return findings;
}

/**
 * Check a note's top-level `subType` against the values its type declares.
 *
 * `subType` stays at the top level — it is what each system's map reads to
 * derive a document type, so it describes the note rather than the subject —
 * but it is not open like the rest of that region: a type either declares a
 * `subType` or does not, and a type that does declares its values.
 *
 * **It is a genre, and only a genre.** A second reading of the field — a
 * `README.md` as its section's landing page, whose `subType` is the segment it
 * lands at — would mean checking the value against the sections that could
 * exist (every content type, plus whatever a repository configured) rather
 * than against the genres its type declares. Two vocabularies in one field is
 * the cause, and it is removed rather than the symptom: a section is a Hugo
 * directory the note format does not
 * carry, and a page introducing a type is an ordinary note addressed
 * `doc-<type>`. So the closed list answers for every note, whatever it is
 * called, and `rules`, `userguide`, `reference` mean three genres and nothing
 * else.
 *
 * **Two checks, in this order** — the charset, then the closed set. The
 * charset is first because it is the more general statement about
 * the same value: a value outside `^[A-Za-z0-9]+$` is refused whatever the type
 * declares, and only once it is a well-formed term is the type's own list the
 * reason to refuse it.
 *
 * There is deliberately no third, retired-spelling check ahead of them
 * accepting `user-guide` as a warning naming `userguide`. Every consumer tree
 * has swept, so it would guard nothing: the old spelling falls through to the
 * charset check, which refuses it for the reason that always applied — it
 * contains a hyphen.
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

    // The charset, before the closed set: a value outside it is refused
    // whatever the type declares, and the type's list is not the reason it is
    // refused. Reported here rather than only for an enumerated type, so a
    // `subTypes: null` type — whose values nothing may yet check — is still
    // held to the one rule that does not depend on knowing them.
    if (!isAddressSegment(value)) {
        return [
            {
                file: note.file,
                ...at,
                severity: "error",
                message: subTypeCharsetMessage(value),
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
 * Check a note's `tags` for near misses against the tags that classify.
 *
 * `tags:` is top-level and the top level is open, so an unrecognised tag is
 * **not** a finding: a theme, a region or a working state is the author's own
 * vocabulary and this build has no standing to refuse it.
 *
 * **Distance alone is not enough either**, which the corpus settles rather than
 * argues: `azravan` on a faith, `barter` on an economy note and `secret` on
 * three lore notes are all within a typo's distance of `caravan`, `border` and
 * `sacred`, and not one is a mistake. Checked against every declared tag at
 * once, the rule was wrong on every note it touched.
 *
 * **The scope is what makes it sound.** Each group names the types it applies
 * to, so a place's kinds are only ever checked on a place, and the eight
 * findings above become none while a settlement tagged `vilage` is still
 * caught.
 *
 * @param {object} note - The note.
 * @param {object} opts
 * @param {readonly string[]} opts.tags - Every declared tag, flattened.
 * @returns {object[]} Findings.
 */
function checkTags(note, { type }) {
    const authored = (note.fm ?? {}).tags;
    if (!Array.isArray(authored)) return [];

    const tags = declaredTags(type);
    if (!tags.length) return [];
    const declared = new Set(tags);
    const findings = [];
    for (const raw of authored) {
        if (typeof raw !== "string" || !raw.trim()) continue;
        const value = raw.trim();
        if (declared.has(value)) continue;
        const guess = nearest(value, tags);
        if (!guess) continue;
        findings.push({
            file: note.file,
            ...positionInFrontmatter(note.raw ?? "", "tags"),
            severity: "error",
            message:
                `tag "${value}" is not declared, and is a near miss for the declared ` +
                `tag "${guess}". A classifying tag is queried, so a misspelt one drops ` +
                `this note out of an index without failing anything. Write "${guess}", ` +
                `or rename the tag so it is plainly the author's own`,
        });
    }
    return findings;
}

/**
 * The frontmatter fields that name artwork, and so resolve through
 * {@link module:engine/helpers.resolveImg}.
 *
 * Both, always: a being carries `img` and `portrait` independently — the token
 * art and the sheet portrait — and a rule about how the translator reads an
 * empty value belongs to the translator, not to whichever key happens to be
 * more common. Eleven `sohl-kethira-basic` beings write `portrait: ""` and no
 * note in any tree writes `img: ""` on a being; a check keyed on `img` alone
 * would have called that tree clean.
 *
 * **Each carries where it is authored**, because the two no longer agree. The
 * specification puts an actor's portrait under `data:` and leaves its token art
 * at the note's top level, so `portrait` has a third position to read and `img`
 * does not — and a check that read only the two they share would pass a
 * `data.portrait: ""` it could not see.
 *
 * @type {readonly {key: string, inData: boolean}[]}
 */
const ART_FIELDS = Object.freeze([
    Object.freeze({ key: "img", inData: false }),
    Object.freeze({ key: "portrait", inData: true }),
]);

/**
 * The in-block keys a type's own declarations claim for a *different* quantity.
 *
 * {@link module:engine/field-spec.FieldSpec.topLevelMeans} read from the other
 * side. That property says the note's top-level key of a field's name means
 * something else, and `resolveFieldValue` honours it by refusing to read the
 * shared position *for that field*. The statement is symmetric: if the two
 * positions hold unrelated quantities, then the **block** position is not the
 * note-level field either, and a check about the note-level field must not read
 * it.
 *
 * `affiliation`'s `title` is the case that named this. A note's top-level
 * `title` is its page heading, which the site emitter publishes as
 * `fm.title ?? name`; `sohl.title` is the style of address an office carries —
 * "Ajaw", "Warden". Twenty-eight `sohl-kethira-basic` affiliations author
 * `sohl.title: ""` — an office with no style of address, which is ordinary —
 * and every one of them was reported as publishing a page with no heading. None
 * of them does; their pages take `name.full` exactly as intended.
 *
 * Keyed on the **in-block** key — `legacyKey` where a field declares one, and
 * its first segment where that is dotted — because that is the position a note
 * authors, and so the position a note-level check would otherwise read.
 *
 * @param {readonly object[]|null|undefined} schema - The type's declarations.
 * @returns {Set<string>} The in-block keys that are not the note-level field of
 *   the same name.
 */
/**
 * The keys a field declaration is authored at **inside a system block**.
 *
 * The first segment of each field's in-block key: `impact.die` is authored as
 * `impact`, and a field whose shared source moved under `data:` is authored at
 * the `legacyKey` it declares rather than at its dotted name. Keying on
 * the name instead would report `sohl.species` as a property no `being` has,
 * against exactly the notes the sweep has not reached yet.
 *
 * Written once and read twice: the note type's own declaration answers for the
 * system whose vocabulary the caller's `schemas` are, and a second system's
 * registry answers for its block. Two derivations of one thing would be
 * free to disagree about which position a note authors.
 *
 * @param {readonly object[]|null|undefined} schema - A type's declarations.
 * @returns {Set<string>} The in-block keys.
 */
function inBlockKeys(schema) {
    return new Set(authoredFields(schema ?? []).map((f) => legacyKeyOf(f).split(".")[0]));
}

function collidingBlockKeys(schema) {
    const keys = new Set();
    if (!Array.isArray(schema)) return keys;
    for (const field of authoredFields(schema)) {
        if (field.topLevelMeans === undefined) continue;
        keys.add(String(legacyKeyOf(field)).split(".")[0]);
    }
    return keys;
}

/**
 * Read a shared field the way the compiler reads one: the `sohl:` block first,
 * then `data:` where the field lives there, then the note's top level.
 *
 * The same order {@link module:engine/system-block.resolveFieldValue} uses,
 * restated here rather than imported so this module stays a leaf the linter can
 * load without a resolved build configuration. Unlike that resolver it
 * distinguishes the two empties — an authored `""` comes back as `""` and an
 * authored `null` as `null` — which is the whole point of the caller below.
 *
 * **`blockCollides` drops the first position**, where the note's type declares
 * a system field of that name meaning something else — the resolver's
 * `topLevelMeans` exemption, applied from the note-level side. See
 * {@link collidingBlockKeys}. The caller decides per key rather than this
 * function deciding for itself, because this module knows no type's vocabulary:
 * the declarations arrive from the caller, as `schemas` and `vocabulary` do.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} key - The field name.
 * @param {object} [options] - Options.
 * @param {boolean} [options.inData=false] - Whether the field's shared source
 *   is `data.<key>` rather than the top-level key.
 * @param {boolean} [options.blockCollides=false] - Whether `sohl.<key>` is a
 *   system field that merely shares this name, and so answers for nothing here.
 * @returns {any} The authored value, or `undefined` where no position declares
 *   one.
 */
function authoredValue(fm, key, { inData = false, blockCollides = false } = {}) {
    const block = blockCollides ? undefined : fm?.sohl;
    if (block && typeof block === "object" && !Array.isArray(block) && Object.hasOwn(block, key)) {
        return block[key];
    }
    const data = inData ? fm?.data : undefined;
    if (data && typeof data === "object" && !Array.isArray(data) && Object.hasOwn(data, key)) {
        return data[key];
    }
    return fm && Object.hasOwn(fm, key) ? fm[key] : undefined;
}

/**
 * Two embedded items on one actor may not share `(type, shortcode)`.
 *
 * SoHL treats `(type, shortcode)` as a **logical identity**, not a lookup
 * convenience: two documents of one type bearing one shortcode denote *the same
 * entity*, whatever their `_id`s or field values. It is unique within four
 * scopes, one of which is an actor's own embedded items — and the invariant
 * exists to keep that identity well-defined. Two colliding entries make "the
 * same thing" ambiguous, and every match resolving by it — compendium↔world
 * reconciliation, archetype shadowing, `fvttFindItemByShortcode`, cohort
 * membership, expression and effect references — becomes unsound.
 *
 * Nothing else catches it. The compiler resolves each entry independently and
 * distinguishes the two only when seeding `_id`, so the collision compiles to
 * two documents with distinct ids and ships unremarked.
 *
 * **Decidable from frontmatter alone**, which is why it belongs here rather
 * than in the compiler. An entry's effective key is
 * `system.shortcode ?? shortcode`: a top-level `shortcode` merely selects the
 * template the entry is written from and is never written to the document,
 * while a template's own `system.shortcode` is its address by construction. So
 * neither the catalogue nor a compile is needed to know what an entry will
 * carry.
 *
 * Only entries naming both a type and a key are compared. One naming neither —
 * a stand-alone entry still missing its `system.shortcode` — is the compiler's
 * finding to make, and reporting it twice helps nobody.
 *
 * @param {object} note - A note from the link index (`{fm, file, raw}`).
 * @param {string} blockName - The system block whose `items` to check.
 * @returns {object[]} One finding per collision, at the later entry.
 */
function checkEmbeddedShortcodes(note, blockName) {
    const findings = [];
    const block = systemBlock(note.fm ?? {}, blockName);
    const entries = block?.items;
    if (!Array.isArray(entries)) return findings;

    /** `type\0key` → the index that claimed it first. */
    const claimed = new Map();
    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
        const type = entry.type;
        const system = entry.system;
        const key =
            system && typeof system === "object" && !Array.isArray(system) ?
                (system.shortcode ?? entry.shortcode)
            :   entry.shortcode;
        if (!type || !key) return;

        const address = `${type}/${key}`;
        const first = claimed.get(address);
        if (first === undefined) {
            claimed.set(address, index);
            return;
        }
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", [blockName, "items", index]),
            severity: "error",
            message:
                `"${type}:${key}" is already the shortcode of ` +
                `\`${blockName}.items[${first}]\` on this actor; ` +
                `(type, shortcode) identifies *which entity* an item is, and ` +
                `must be unique among an actor's embedded items, so the two ` +
                `denote one thing and every lookup by it is ambiguous. Give ` +
                `this entry its own \`system.shortcode\`` +
                (entry.shortcode && !entry.system?.shortcode ?
                    ` — a top-level \`shortcode\` only selects the template ` +
                    `this entry is written from and never reaches the document`
                :   "") +
                `, or delete it if it is a duplicate.`,
        });
    });
    return findings;
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
 *   it declares, as `engine/note-vocabulary.mjs` states them. Supplied
 *   by the caller for the same reason `schemas` is: this module validates a
 *   note against whatever its type declares and knows no type names of its
 *   own. Its absence skips the `data:` and `subType` checks rather than
 *   reporting every key as unknown.
 * @param {(type: string) => {document: string|null, art: readonly string[]}|null} [opts.emittedArt]
 *   What art a note of one type reaches its document through — the passes' own
 *   declaration, asked through `engine/generate.mjs`'s `emittedArtFor`.
 *   Supplied by the caller like `schemas`, so this module states no list of
 *   iconless types of its own; absent it, an inert `img:` goes unreported
 *   rather than every note's being.
 * @param {Readonly<Record<string, SystemBlockSpec>>} [opts.systems]
 *   The system blocks to check, and what each accepts. Supplied by the caller
 *   for the same reason `schemas` is — a build derives them from its
 *   configuration through {@link systemBlocksFor}, and this module states no
 *   system name of its own. See {@link DEFAULT_SYSTEM_BLOCKS} for the fallback.
 * @param {readonly string[]} [opts.packs] - The pack names this package
 *   declares, for a `data:` field whose map is keyed by pack. Supplied by the
 *   caller like `schemas` and `vocabulary`, and absent it no claim is made
 *   about those keys.
 * @returns {object[]} Findings, each with a locator where one is obtainable.
 */
export function lintNote(
    note,
    { schemas, index, vocabulary, packs, emittedArt, systems = DEFAULT_SYSTEM_BLOCKS },
) {
    const findings = [];
    const fm = note.fm ?? {};
    const type = String(fm.type ?? "");
    const raw = () => note.raw ?? "";
    const at = (key, literal) => positionInFrontmatter(raw(), key, literal ?? undefined);
    /**
     * The in-block keys this note's own type claims for something other than
     * the note-level field of that name, which every note-level check below
     * reads past. Resolved once: the type is fixed for the note, and
     * each check would otherwise ask the same question of the same
     * declarations.
     */
    const blockCollisions = collidingBlockKeys(schemas?.[currentType(type)]);

    // The retired top-level fields, checked before the type: a note may carry
    // one whatever its type is, and each finding stands on its own. Reported
    // here as well as refused at compile because this is where an author meets
    // every finding in the tree at once, rather than one note at a time.
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
    // `folder:` named a compendium folder by the raw Foundry id declared in a
    // per-pack `*-folders.yaml`. Both halves are retired together: the
    // id spelling has nothing left to resolve against once the YAML is gone.
    //
    // Checked here as well as refused at compile because this is where an
    // author meets every one of them in the tree at once — which is what a
    // tree still to sweep needs, the whole corpus rather than the first note
    // the compile happens to reach.
    //
    // **Both positions**, because notes wrote it both ways: top-level, and
    // inside the `sohl:` block. The block spelling is no longer a universal
    // key, so it would otherwise be reported as merely unrecognized, which
    // says nothing about what to write instead.
    const sohlBlock = fm.sohl;
    const folderInBlock =
        !!sohlBlock && typeof sohlBlock === "object" && Object.hasOwn(sohlBlock, "folder");
    if (Object.hasOwn(fm, "folder") || folderInBlock) {
        findings.push({
            file: note.file,
            ...at("folder"),
            severity: "error",
            message:
                "`folder:` is a retired frontmatter field — write `packFolder` " +
                "instead. A folder is a note (`type: folder`) now, and " +
                "`packFolder` names it by its address, not by the Foundry id a " +
                "retired `*-folders.yaml` used to declare",
        });
    }
    // `img: ""` was how a note said "I name no art" while `resolveImg`
    // conflated the two empties and every caller defaulted with `||`. It now
    // says the opposite — "ship no art, and do not default me" — so a
    // note carrying the old spelling has quietly changed meaning. Forty-five
    // `sohl-thalorna` notes were written under the old reading and would have
    // lost their default art with no error and no warning; this is the guard
    // that would have caught them.
    //
    // **Both art fields, because both go through `resolveImg`.** `portrait` is
    // not a variant spelling of `img` — a being carries the two independently —
    // and checking only the more common one is how the sweep that prompted this
    // guard missed eleven `sohl-kethira-basic` beings that write
    // `portrait: ""`. Whatever the rule is, it belongs to the function, not to
    // one of the keys that reaches it.
    //
    // A **warning**, on the pattern the `package:` and retired-alias sweeps
    // set: the note still compiles, to a document that is merely iconless, so
    // reddening a tree over it would refuse before the sweep rather than after
    // it. It is transitional in the same sense — `""` is a legal thing to mean,
    // and the message says so, but nothing in any tree means it yet.
    //
    // **These two only, never `title`.** The rule reads as a general one about
    // optional strings, and it is not — it belongs to `resolveImg`, and `title`
    // never goes through it.
    //
    // It once had a sharper reason: a note's top-level `title` was
    // simultaneously the shared source for an `affiliation` item's
    // `system.title`, so asking an author for `title: null` would have compiled
    // the literal string `"null"` into the document. The field declares
    // `topLevelMeans` now, so the top-level key is no longer a source for it and
    // `title: null` is harmless. `title: ""` is warned about on its own account
    // below, as the *page's* heading rather than as an art path.
    //
    // **The collision itself did not go away, and this was where that was
    // misread.** `topLevelMeans` settles which position the *emitted field*
    // reads; it says nothing about which position a *check* reads, and
    // `authoredValue` went on resolving through the block regardless — so an
    // office with no style of address answered for its note's heading, in
    // twenty-eight `sohl-kethira-basic` affiliations. Hence
    // `blockCollisions`: a note-level check reads past a block key its type
    // claims for something else.

    // The template priority is a *shared source* — the specification states it
    // once for every type, as it does `pack` — so its retirement is reported
    // here rather than by the per-type loop below, which only reaches a field
    // some type's vocabulary declares.
    if (declaresRetiredAlias(fm, "templatePriority")) {
        findings.push({
            file: note.file,
            ...at(RETIRED_FIELD_ALIASES.templatePriority),
            // An error, unlike the other retired alias. `archetype` is not
            // a field of its own — it is `templatePriority` under its prior
            // name, and both sit one letter from `archetypes`, which means
            // something else entirely. A tree still on it is one where a
            // priority and a taxonomy are told apart by a plural `s`, which
            // is worth stopping rather than mentioning. This reds every
            // tree until each is swept; that is the point.
            severity: "error",
            message: retiredAliasMessage(
                RETIRED_FIELD_ALIASES.templatePriority,
                "templatePriority",
            ),
        });
    }

    // An art field a note's own type never emits. `img` is a *shared
    // top-level* field — `BLOCK_DOCUMENT_PROPERTIES` maps it onto
    // `document.img`, so it is legal on every note whatever the type — and a
    // note whose document has no such property authors it, validates, compiles,
    // and loses the value with nothing said. `Parrot` in `sohl-thalorna` had
    // declared `img: images/mystery/parrot.webp` since long before the art rule
    // was written and compiled `img: null`, exactly as a note declaring nothing
    // does. The author's only evidence was the absence of an icon somewhere
    // they were probably not looking.
    //
    // **Which types those are is not stated here.** It is asked of the passes,
    // through the `emittedArt` the caller supplies — a note's type routes to a
    // document, a document to the pass that compiles it, and the pass declares
    // its own art. A list of iconless types kept in the linter would be a list
    // free to drift from what is actually emitted, which is the defect rather
    // than the check. Absent the option no claim is made, on the pattern
    // `index` and `vocabulary` set.
    //
    // **Only an authored value, never `null`.** `null` is the blessed spelling
    // for "this note names no art", and on a type with no art that is a
    // true and harmless thing to say — it compiles identically to writing
    // nothing. Twenty-six `sohl-thalorna` place notes are in exactly that
    // state, and telling each of them to delete a key that already means
    // nothing would bury the fifty-seven that name a path they believe ships.
    //
    // A **warning**, as the `package:` and retired-alias sweeps are: the note
    // compiles correctly and the value is merely inert. Nor is it certainly
    // unwanted — a note's top level is the generated page's front matter as
    // well, so a template may read there what no document carries, which is a
    // judgement only the tree's author can make.
    const emitted = emittedArt ? emittedArt(currentType(type)) : null;
    /** The art fields this note's type reaches nothing through. */
    const inertArt = new Set(
        emitted ? ART_FIELDS.filter(({ key }) => !emitted.art.includes(key)).map((f) => f.key) : [],
    );
    for (const { key, inData } of ART_FIELDS) {
        if (!inertArt.has(key)) continue;
        const authored = authoredValue(fm, key, {
            inData,
            blockCollides: blockCollisions.has(key),
        });
        if (typeof authored !== "string") continue;
        findings.push({
            file: note.file,
            ...at(key),
            severity: "warning",
            message:
                `\`${key}:\` reaches no document from a \`${type}\` note — ` +
                (emitted?.document ?
                    `it compiles into a ${emitted.document}, which carries no artwork`
                :   "it compiles into a page rather than a compendium document") +
                ", so the path is dropped. Delete the key, or move the art onto " +
                "the note whose document is meant to show it; keep it only where " +
                "a page template reads it as a parameter",
        });
    }

    for (const { key, inData } of ART_FIELDS) {
        // Reported above, and the distinction this draws does not exist there:
        // where nothing is emitted, `""` and `null` are equally inert and the
        // note has no default art to lose.
        if (inertArt.has(key)) continue;
        if (authoredValue(fm, key, { inData, blockCollides: blockCollisions.has(key) }) !== "")
            continue;
        findings.push({
            file: note.file,
            ...at(key),
            severity: "warning",
            message:
                `\`${key}: ""\` means "ship no art at all" — it no longer falls ` +
                `back to this type's default. Write \`${key}: null\` for a note ` +
                'that simply names none; keep `""` only where the document is ' +
                "meant to have no image",
        });
    }
    // `title: ""` publishes a blank heading. The rule the art fields
    // follow — `null` falls back, `""` is blank on purpose — reads the same way
    // here, and for a *page heading* the deliberate blank is almost never what
    // anyone wants: the emitter is `fm.title ?? name`, so `""` survives, the
    // page publishes with no name, and it sorts to the front of its section
    // landing ahead of every named page. Fifteen notes in `sohl-thalorna` are
    // in exactly that state.
    //
    // A warning rather than an error: the value is legal under the rule, and a
    // note that genuinely wants no heading may keep it — it just has to mean it.
    //
    // **The emitter reads `fm.title`, so this reads the note level.** On an
    // `affiliation` `sohl.title` is the office's style of address, which the
    // heading has nothing to do with — and `blockCollisions` is what keeps the
    // two apart. On every other type nothing claims the block key, so the
    // resolution is the unchanged one.
    if (authoredValue(fm, "title", { blockCollides: blockCollisions.has("title") }) === "") {
        findings.push({
            file: note.file,
            ...at("title"),
            severity: "warning",
            message:
                '`title: ""` publishes a page with no heading, which sorts to ' +
                "the front of its section ahead of every named page. Write " +
                "`title: null` to fall back to `name.full`, or give the page a " +
                'heading; keep `""` only where the blank is meant',
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
    // Anchored at column 1 for the same reason `aliases` is: `section` names a
    // configuration key too (`site.trees[].section`), and a nested one under
    // some other block is not this field.
    if (Object.hasOwn(fm, "section")) {
        findings.push({
            file: note.file,
            ...positionInFrontmatter(raw(), "section", undefined, { topLevel: true }),
            severity: "error",
            message: sectionRetiredMessage(),
        });
    }
    // Anchored at column 1 for the same reason `section` is, and with more at
    // stake: `sohl.traits` is a *different field that shares the name* —
    // `projectilegear` declares one and the theme's gear sidebar reads it — so
    // a finding about the retired top-level block must never open on it.
    if (Object.hasOwn(fm, "traits")) {
        findings.push({
            file: note.file,
            ...positionInFrontmatter(raw(), "traits", undefined, { topLevel: true }),
            severity: "error",
            message: traitsRetiredMessage(),
        });
    }
    // Only the top-level `aliases` is retired. `name.aliases` writes the same
    // key indented under `name:` and is **permitted** — reserved and unread —
    // so both the test and the locator are anchored at column 1.
    if (declaresRetiredAliasesField(fm)) {
        findings.push({
            file: note.file,
            ...positionInFrontmatter(raw(), "aliases", undefined, { topLevel: true }),
            severity: "error",
            message: aliasesRetiredMessage(),
        });
    }

    // What the address rule says about a homepage's top-level fields: the
    // `shortcode` it owes, and the `id` it may not write. Reported
    // beside the retired fields above because it is the same kind of statement
    // about the same note, and, like them, it must survive the two early
    // returns below: the finding stands whatever else the type is.
    // Tags are checked here for the same reason: a classifying tag is not a
    // type's property — `draft` belongs to any note and `village` to a place —
    // so the finding must survive the early returns below.
    findings.push(...checkTags(note, { type }));

    // A refused field must be one the note *wrote*: `resolveNoteId` fills
    // `fm.id` in place, so the parsed frontmatter carries a derived id the
    // author never typed. The raw text is the only place that
    // distinguishes them, and `positionInFrontmatter` already answers it —
    // `topLevel` so a nested `id:` under some other key is not mistaken for the
    // note's own.
    const authoredAtTopLevel = (key) =>
        positionInFrontmatter(note.raw ?? "", key, undefined, { topLevel: true }).line !==
        undefined;
    for (const { locator, message } of checkHomepageAddressFields(fm, {
        isAuthored: authoredAtTopLevel,
    })) {
        findings.push({
            file: note.file,
            ...at(locator.key, locator.literal),
            severity: "error",
            message,
        });
    }

    // The type's charset, before anything that looks the type up. A
    // hyphenated type is unaddressable, and every lookup below would report it
    // as a type nobody declared — true, but not the reason, and it would send
    // the author to declare one rather than to rename it.
    //
    // Guarded on a non-empty type: an absent one is a missing key, not a
    // charset violation, and is reported as the missing schema it causes.
    // There is **no transitional path** here, deliberately: no tree authors a
    // hyphenated type, so an acceptance would guard a case that does not exist.
    if (type && !isAddressSegment(type)) {
        findings.push({
            file: note.file,
            ...at("type", type),
            severity: "error",
            message: typeCharsetMessage(type),
        });
        return findings;
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

    // A **renamed** type is the opposite case, and the opposite answer: the
    // note compiles into exactly the document it always did, so refusing it
    // would fail a build over a note that is not wrong. It is reported, and
    // every lookup below reads the current spelling.
    const renamedTo = RENAMED_TYPES[type];
    if (renamedTo) {
        findings.push({
            file: note.file,
            ...at("type", type),
            // A warning, for the reason the retired *field* alias below is one:
            // the sweep is the content trees' work and the refusal comes after
            // it, as `package:`'s did.
            severity: "warning",
            message: renamedTypeMessage(type, renamedTo),
        });
    }
    // What every type-keyed table is keyed by. The authored spelling is still
    // what a message quotes — it is what the reader has in front of them.
    const current = currentType(type);

    const schema = schemas[current];
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

    // The closed frontmatter regions, checked beside the `sohl:` block
    // because they are the same statement about the same note: this key is not
    // one this type may write. Skipped entirely when the caller declares no
    // vocabulary — reporting every key as unknown because nothing was loaded
    // to recognise it would be worse than not checking.
    const entry = vocabulary?.[current];
    if (entry) {
        findings.push(...checkDataContainer(note, { type, fields: entry.data ?? [], packs }));
        findings.push(...checkSubType(note, { type, entry }));
    }

    const fields = authoredFields(schema);
    /** The keys this type's own declaration is authored at inside a block. */
    const declared = inBlockKeys(schema);

    // The retired spelling of a field this type declares → what to write now.
    // Built from the type's own vocabulary, so a renamed field is retired
    // exactly where its replacement exists and the old name stays an unknown
    // key everywhere else.
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
            // `package:`'s did.
            severity: "warning",
            message: retiredAliasMessage(retired, current),
        });
    }

    // Every declared system's block, each against its own vocabulary. A
    // block carries the shared keys any system's does — `system`, `type`,
    // `img`, `effects`, `flags`, `pack` — plus whatever that system declares:
    // the note type's own field names for the system those schemas describe,
    // and a second system's own registry for its block. Which systems arrive
    // here is the configuration's answer, not this module's; see
    // {@link systemBlocksFor}.
    for (const [blockName, spec] of Object.entries(systems ?? {})) {
        // Two embedded items denoting one entity. Per block, because
        // `items` is a block key and a second system's actor carries its own.
        // Before the `continue` below, because it is a statement about the
        // block's *shape* and holds whether or not this system declares a
        // vocabulary for the note's type.
        findings.push(...checkEmbeddedShortcodes(note, blockName));
        // A block is checked only where its system speaks about this type. A
        // type a system's registry does not name is a type it says nothing
        // about — SoHL's `mysticalability` is not an HM3 type at all — and
        // holding the block to an empty vocabulary would report every key in
        // it, which is the correct tree reported red.
        //
        // `fieldVocabulary` reaches types no registry declares, `being` above
        // all, so a spec carrying it always speaks. Only a spec whose *sole*
        // statement is `fields` can fall silent here.
        const own = spec?.fields;
        if (own && !own[type] && !spec?.fieldVocabulary && !spec?.known) continue;
        const accepted = new Set([
            ...UNIVERSAL_KEYS,
            ...(spec?.known ?? []),
            ...(spec?.fieldVocabulary ? declared : []),
            ...(own ? inBlockKeys(own[type]) : []),
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
        // Resolved exactly as the compiler resolves it: the system path
        // first, then the block, then the declared shared source. A lint that
        // read only one of the three would report a note's own field as missing
        // the moment it moved to another of them. A **shared** field needs
        // nothing extra here — the note's top level *is* the third step — so
        // `shared` says only where the field's home is, for the message below.
        let { value, from } = resolveFieldValue(field, fm, { block: "sohl" });
        // A **renamed** field may still be written under its retired spelling,
        // which that order knows nothing about. It resolves through the reader
        // the compiler uses, so the lint cannot disagree with the build about
        // which value a note carries.
        if ((from === "default" || value == null) && RETIRED_FIELD_ALIASES[field.name]) {
            const aliased = readAliasedField(fm, field.name);
            if (aliased !== undefined) {
                value = aliased;
                from = "block";
            }
        }
        // The sweep's progress signal. A **warning**, for the reason a
        // retired spelling is one: the note compiles to the correct document,
        // so failing a build over it would red a tree that has done nothing
        // wrong yet. The refusal comes once no tree writes the position.
        if (readsLegacyKey(field, from)) {
            findings.push({
                file: note.file,
                ...at(legacyKeyOf(field)),
                severity: "warning",
                message: legacyKeyMessage("sohl", field),
            });
        }
        const absent = from === "default" || value === undefined || value === null;
        // Where the field belongs, as a message names it: a shared field is not
        // under `sohl:`, so telling an author to write `sohl.img` would send
        // them to the wrong region. Nor is a field whose shared source is a
        // path into `data:` — `sohl.data.species` is a region that does not
        // exist, and the home of that field is the container it names.
        const label =
            field.shared || (field.name.includes(".") && field.legacyKey !== undefined) ?
                `\`${field.name}\``
            :   `\`sohl.${field.name}\``;

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
        // fetched index lands exactly as the same address in a wikilink
        // would — rather than through a second, subtly different rule.
        //
        // **As an address, always** — which is now the only namespace there
        // is. A frontmatter reference is a bare address by construction:
        // there is no pipe to read intent from, and the field supplies the
        // type. The resolver once took a namespace argument, and omitting it
        // read every `ref:` value as an alias, which `type-shortcode` never was.
        if (field.ref && index && typeof value === "string" && value) {
            const target = `${field.ref}-${value}`;
            if (!index.resolve(target) && !index.manifestHit(target)) {
                findings.push({
                    file: note.file,
                    ...at(head, value),
                    severity: "error",
                    message:
                        `${label} names ${field.ref} ` +
                        `"${value}", and no note or fetched index declares it`,
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
 *   it declares; see {@link lintNote}.
 * @param {boolean} [opts.references=true] - Whether to check references.
 * @param {Readonly<Record<string, SystemBlockSpec>>} [opts.systems]
 *   The system blocks to check; see {@link lintNote} and
 *   {@link systemBlocksFor}.
 * @param {readonly string[]} [opts.packs] - The declared pack names; see
 *   {@link lintNote}.
 * @param {(type: string) => {document: string|null, art: readonly string[]}|null} [opts.emittedArt]
 *   What art a type reaches its document through; see {@link lintNote}.
 * @returns {{findings: object[], notes: number}} The findings, and how many
 *   notes were inspected.
 */
export function lintFrontmatter(
    index,
    { schemas, vocabulary, packs, emittedArt, references = true, systems },
) {
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
                packs,
                emittedArt,
                index: references ? index : undefined,
                ...(systems ? { systems } : {}),
            }),
        );
    }
    return { findings, notes: notes.length };
}
