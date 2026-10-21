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
 * **A metre is declared once, as an entry of a `doc` note's `data.metres`**:
 * its `name`, the `beats` of a line and the `kind` of count. This module holds
 * the declaration and its field check, and imports nothing that reads the note
 * vocabulary, which declares the field with them; reading the metres of an
 * index and counting a verse against them is {@link module:engine/verse-metre}.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** Whether a value is a plain map. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** What a metre's `kind` may be. */
export const METRE_KINDS = Object.freeze(["accentual"]);

/** What a metre's `name` may be. */
export const METRE_NAME = /^[a-z0-9-]+$/;

/**
 * One declared metre.
 *
 * @typedef {object} Metre
 * @property {string} name - What `scan=` names it by.
 * @property {number} beats - The beats of a line.
 * @property {string} kind - How they are counted: `accentual`.
 */

/** The notes declaring each metre name, read once per lint index. */
const declaredNames = new WeakMap();

/**
 * Each metre name the index's notes declare, and the notes declaring it.
 *
 * @param {{notes?: Iterable<{file: string, fm?: Record<string, any>}>}} index - The lint index.
 * @returns {Map<string, string[]>} Name → the files that declare it.
 */
function namesIn(index) {
    const known = declaredNames.get(index);
    if (known) return known;
    const names = new Map();
    for (const note of index.notes ?? [])
        for (const entry of listOf(note?.fm?.data?.metres)) {
            if (!isMap(entry) || typeof entry.name !== "string") continue;
            if (!names.has(entry.name)) names.set(entry.name, new Set());
            names.get(entry.name).add(note.file);
        }
    const out = new Map([...names].map(([name, files]) => [name, [...files]]));
    declaredNames.set(index, out);
    return out;
}

/**
 * Check a note's `data.metres`: each name's form, that no other entry declares
 * it, and that a beat count is a whole number above zero. The data-key check
 * owns every key, its kind and the closed `kind` list.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{index?: {notes?: Iterable<object>}}} [context] - The lint index.
 * @returns {object[]} The findings, each at its key.
 */
export function checkMetresField(note, { index } = {}) {
    const list = note?.fm?.data?.metres;
    if (!Array.isArray(list)) return [];
    const raw = note.raw ?? "";
    const finding = (keyPath, message) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "metres", ...keyPath]),
        severity: "error",
        message,
    });
    const findings = [];
    const seen = new Set();
    list.forEach((entry, at) => {
        if (!isMap(entry)) return;
        const { name, beats } = entry;
        if (typeof name === "string") {
            const label = `data.metres[${at}].name`;
            if (!METRE_NAME.test(name))
                findings.push(
                    finding(
                        [at, "name"],
                        `\`${label}\` is \`${name}\`; a metre's name is lowercase letters, digits and \`-\``,
                    ),
                );
            else if (seen.has(name))
                findings.push(
                    finding(
                        [at, "name"],
                        `\`${label}\` is \`${name}\`, which this note declares twice; a metre's name is unique`,
                    ),
                );
            else {
                const others = (index ? (namesIn(index).get(name) ?? []) : []).filter(
                    (file) => file !== note.file,
                );
                if (others.length)
                    findings.push(
                        finding(
                            [at, "name"],
                            `\`${label}\` is \`${name}\`, which ${others.join(", ")} also declares; a metre's name is unique`,
                        ),
                    );
            }
            seen.add(name);
        }
        if (beats !== undefined && Number.isFinite(Number(beats)) && !(Number(beats) >= 1))
            findings.push(
                finding(
                    [at, "beats"],
                    `\`data.metres[${at}].beats\` is \`${String(beats)}\`; a metre has one or more beats`,
                ),
            );
    });
    return findings;
}
