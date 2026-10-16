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
 * A culture's or an affiliation's own glossary terms: `data.glossary` on a
 * `lore` note of `subType: culture` or on an `affiliation`, a list of
 * `{ name, name_sort?, common?, definition?, pronunciation?, language? }`.
 *
 * An entry chooses a common word, gives a dictionary word a contextual
 * meaning, or defines a phrase, compound or term of art. An entry naming a
 * word of its resolved language carries that word's senses and class unless
 * its own `definition` supplies the sense. A rank or office can also be named.
 * Common marks, sort keys and pronunciation overrides belong to the entry's
 * own glossary.
 *
 * The shape is the inner-key check's; this check owns what an entry means:
 *
 * - an error on `data.glossary` written on a `lore` note that is not a
 *   culture, at the key;
 * - an error on two entries of one name, compared after NFC normalisation and
 *   case kept, at the second;
 * - an error on an entry's `language` that names a note other than a language
 *   skill, or nothing, at the value;
 * - an error on an entry that resolves to no language
 *   ({@link module:engine/glossary-language}), at the entry;
 * - an error on an entry with no definition that names no term of the note, at
 *   its name;
 * - an error on a pronunciation that is not a respelling, at the value;
 * - a warning on a definition that only repeats the one sense it replaces, at
 *   the definition.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import {
    addressKeyOf,
    entryLanguage,
    glossaryName,
    isCultureNote,
    noteTerms,
} from "./culture-reach.mjs";
import { pronunciationProblem } from "./word-terms.mjs";

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Check a culture's or an affiliation's `data.glossary`.
 *
 * @param {object} note - A `lore` or `affiliation` note.
 * @param {{index?: object}} [context] - The index, for what the note's terms
 *   and languages are. Without one, only what the note says of itself is
 *   checked.
 * @returns {object[]} The findings.
 */
export function checkGlossary(note, { index } = {}) {
    const data = note?.fm?.data;
    if (!isMap(data) || data.glossary === undefined || data.glossary === null) return [];
    const raw = note.raw ?? "";
    const at = (path, severity, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "glossary", ...path], { key }),
        severity,
        message,
    });
    const type = String(note?.type ?? note?.fm?.type ?? "").toLowerCase();
    if (type !== "affiliation" && !isCultureNote(note))
        return [
            at(
                [],
                "error",
                "`data.glossary` states a culture's own glossary terms, and this note's " +
                    "`subType` is not `culture`",
                true,
            ),
        ];
    if (!Array.isArray(data.glossary)) return [];

    const findings = [];
    const hasTerms = Boolean(index?.notes);
    const seen = new Set();
    data.glossary.forEach((entry, i) => {
        if (!isMap(entry) || typeof entry.name !== "string" || !entry.name.trim()) return;
        const name = glossaryName(entry.name);
        if (seen.has(name)) {
            findings.push(
                at(
                    [i, "name"],
                    "error",
                    `\`${entry.name}\` stands twice in this glossary; one entry says ` +
                        "everything the note says of a term",
                ),
            );
            return;
        }
        seen.add(name);
        if (typeof entry.pronunciation === "string") {
            const problem = pronunciationProblem(entry.pronunciation);
            if (problem)
                findings.push(
                    at(
                        [i, "pronunciation"],
                        "error",
                        `\`data.glossary[${i}].pronunciation\` is not a respelling: ${problem}`,
                    ),
                );
        }
        if (!hasTerms) return;
        const stated = entry.language !== undefined && entry.language !== null;
        const named = stated ? languageProblem(index, entry.language) : undefined;
        if (named) findings.push(at([i, "language"], "error", named));
        else if (!entryLanguage(index, note, entry))
            findings.push(
                at(
                    [i],
                    "error",
                    `\`${entry.name}\` resolves to no language: the entry states no ` +
                        "`language`, and " +
                        (type === "affiliation" ?
                            "neither the affiliation, its parents nor its culture states one"
                        :   "the culture states no `data.language`") +
                        "; state `language` on the entry or `data.language` on the note",
                ),
            );
        const senses = noteTerms(index, note, entry).get(name);
        const defined = typeof entry.definition === "string" && entry.definition.trim() !== "";
        if (!defined && !senses)
            findings.push(
                at(
                    [i, "name"],
                    "error",
                    `\`${entry.name}\` names nothing: it is no word of its resolved language ` +
                        "and no rank or office that reaches this note, and the entry gives no " +
                        "`definition` to make it a term",
                ),
            );
        else if (defined && senses?.length === 1 && senses[0].trim() === entry.definition.trim())
            findings.push(
                at(
                    [i, "definition"],
                    "warning",
                    `the definition of \`${entry.name}\` repeats the one sense it replaces; ` +
                        "leave `definition` out",
                ),
            );
    });
    return findings;
}

/**
 * Why an entry's `language` names no language skill, or `undefined` when it
 * names one.
 *
 * @param {object} index - The link index.
 * @param {unknown} value - The entry's `language`.
 * @returns {string|undefined}
 */
function languageProblem(index, value) {
    const key = addressKeyOf(value, index, "skill");
    if (!key) return `\`language\` is not an Address: ${JSON.stringify(value)}`;
    const target = index.addressHit?.(key);
    if (!target)
        return (
            `\`language\` names ${key}, which does not resolve in this package or its declared ` +
            "dependencies"
        );
    const fm = target.fm ?? target;
    if (String(fm.type ?? "").toLowerCase() === "skill" && fm.subType === "language")
        return undefined;
    return `\`language\` names ${key}, which is not a skill whose subType is language`;
}
