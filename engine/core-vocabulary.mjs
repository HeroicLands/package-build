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
 * A setting's core vocabulary: the concept list a `doc` note states in
 * `data.concepts`, the `data.core` flag that says a language must cover it, and
 * the `concept` a word of a language serves.
 *
 * This check owns what the values mean, each finding located at the key at
 * fault:
 *
 * - a concept's `id` is lowercase letters, digits and `-`;
 * - an `id` is stated once in a list, and by one note in the package;
 * - a concept's `gloss` and `group` are not blank;
 * - `data.core` is stated on a language only;
 * - a word's `concept` names entries of the concept list, each once.
 *
 * @module
 */

import { pathLabel as label } from "./data-keys.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { nearest } from "./near-miss.mjs";
import { LANGUAGE_SUBTYPE } from "./word-terms.mjs";

/** What a concept's `id` is made of. */
export const CONCEPT_ID = /^[a-z0-9-]+$/;

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * The notes of an index that state a concept list, read once per index.
 *
 * @type {WeakMap<object, Array<{file: string, ids: Map<string, number>}>>}
 */
const stated = new WeakMap();

/**
 * Each note of the index that states `data.concepts`, with the ids it states
 * and where each first stands.
 *
 * @param {{notes?: Iterable<{file: string, fm?: Record<string, any>}>}} index - The lint index.
 * @returns {Array<{file: string, ids: Map<string, number>}>} The notes.
 */
function listsIn(index) {
    const known = stated.get(index);
    if (known) return known;
    const lists = [];
    for (const note of index.notes ?? []) {
        const concepts = note?.fm?.data?.concepts;
        if (!Array.isArray(concepts)) continue;
        const ids = new Map();
        concepts.forEach((entry, at) => {
            if (isMap(entry) && typeof entry.id === "string" && !ids.has(entry.id))
                ids.set(entry.id, at);
        });
        lists.push({ file: note.file, ids });
    }
    stated.set(index, lists);
    return lists;
}

/**
 * Every concept id the index's notes state.
 *
 * @param {{notes?: Iterable<object>}|undefined} index - The lint index.
 * @returns {Set<string>|undefined} The ids, or `undefined` without an index.
 */
export function conceptIdsIn(index) {
    if (!index?.notes) return undefined;
    return new Set(listsIn(index).flatMap((list) => [...list.ids.keys()]));
}

/**
 * Check a `doc` note's `data.concepts`: each id's spelling, an id stated twice,
 * an id another note states, and a blank `gloss` or `group`.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{index?: {notes?: Iterable<object>}}} [context] - The lint index.
 * @returns {object[]} The findings, each at its key.
 */
export function checkConceptList(note, { index } = {}) {
    const concepts = note?.fm?.data?.concepts;
    if (!Array.isArray(concepts)) return [];
    const raw = note.raw ?? "";
    const finding = (path, message) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, path),
        severity: "error",
        message,
    });
    const others = index ? listsIn(index).filter((list) => list.file !== note.file) : [];
    const findings = [];
    const seen = new Set();
    concepts.forEach((entry, at) => {
        if (!isMap(entry)) return;
        const where = (key) => ["data", "concepts", at, key];
        if (typeof entry.id === "string") {
            if (!CONCEPT_ID.test(entry.id))
                findings.push(
                    finding(
                        where("id"),
                        `\`${label(where("id"))}\` is \`${entry.id}\`; a concept's id is lowercase letters, digits and \`-\``,
                    ),
                );
            else if (seen.has(entry.id))
                findings.push(
                    finding(
                        where("id"),
                        `\`${entry.id}\` is stated twice in this list; a concept's id is unique`,
                    ),
                );
            else {
                const also = others.find((list) => list.ids.has(entry.id));
                if (also)
                    findings.push(
                        finding(
                            where("id"),
                            `\`${entry.id}\` is also stated by ${also.file}; a concept's id is unique`,
                        ),
                    );
            }
            seen.add(entry.id);
        }
        for (const key of ["gloss", "group"])
            if (typeof entry[key] === "string" && entry[key].trim() === "")
                findings.push(
                    finding(where(key), `\`${label(where(key))}\` is blank; state the ${key}`),
                );
    });
    return findings;
}

/**
 * Check a `skill` note's `data.core`: stated on a language only.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - A `skill` note.
 * @returns {object[]} The findings.
 */
export function checkCoreFlag(note) {
    const fm = note?.fm ?? {};
    if (!isMap(fm.data) || fm.data.core === undefined || fm.data.core === null) return [];
    if (String(fm.subType ?? "").toLowerCase() === LANGUAGE_SUBTYPE) return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "core"], { key: true }),
            severity: "error",
            message:
                "`data.core` says a language must cover the core vocabulary, and this note's " +
                `\`subType\` is not \`${LANGUAGE_SUBTYPE}\``,
        },
    ];
}

/**
 * What is wrong with a word's `concept`: an id the list does not declare, and
 * an id stated twice.
 *
 * @param {unknown} value - The word's `concept`: an id, or a list of them.
 * @param {Set<string>|undefined} known - The ids the index declares, or
 *   `undefined` where there is no index to check against.
 * @returns {Array<{entry: number|null, message: string}>} Each problem and the
 *   list entry it sits at, `null` for a single id.
 */
export function conceptProblems(value, known) {
    if (!known) return [];
    const single = typeof value === "string";
    const entries = single ? [value] : listOf(value);
    const problems = [];
    const seen = new Set();
    entries.forEach((id, at) => {
        if (typeof id !== "string") return;
        const entry = single ? null : at;
        if (seen.has(id)) {
            problems.push({
                entry,
                message: `\`${id}\` is stated twice in this word's \`concept\``,
            });
            return;
        }
        seen.add(id);
        if (known.has(id)) return;
        const near = nearest(id, known);
        problems.push({
            entry,
            message:
                known.size ?
                    `\`${id}\` is not a core concept${near ? `; did you mean \`${near}\`?` : ""}`
                :   `\`${id}\` is not a core concept: no note states \`data.concepts\``,
        });
    });
    return problems;
}
