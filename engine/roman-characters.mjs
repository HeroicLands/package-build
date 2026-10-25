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

/** A language's exact Roman source characters, before any script conversion. */

/** Unicode graphemes keep every canonically composing sequence together. */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A code point as the author sees it in a finding. */
const codeName = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Semantic problems in a supplied inventory. Shape belongs to the vocabulary.
 * An empty string explicitly declares no written characters.
 * @param {unknown} value - The authored `data.roman`.
 * @returns {string[]} Findings at that field.
 */
export function romanInventoryProblems(value) {
    if (typeof value !== "string") return [];
    const problems = [];
    if (value !== value.normalize("NFC"))
        problems.push(
            "`data.roman` must use NFC spelling; write precomposed accented letters where available",
        );
    if (/\s/u.test(value))
        problems.push(
            "`data.roman` lists characters without whitespace; spaces and line breaks are structural",
        );
    if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
        problems.push("`data.roman` contains a control, format or unpaired surrogate character");
    const seen = new Set();
    const repeated = new Set();
    for (const char of value) {
        if (seen.has(char)) repeated.add(char);
        seen.add(char);
    }
    if (repeated.size)
        problems.push(
            `\`data.roman\` repeats ${[...repeated].map((char) => `\`${char}\` (${codeName(char)})`).join(", ")}; list each character once`,
        );
    return problems;
}

/**
 * @typedef {object} RomanInventory
 * @property {string} language - The configured language name.
 * @property {ReadonlySet<string>|undefined} characters - Exact code points, absent for a missing declaration.
 */

/**
 * Each configured language note's own inventory, by alias and BCP 47 tag.
 * Language-family ancestry does not supply an inventory. Unassociated external
 * tags have no entry and keep their ordinary behavior.
 * @param {ReadonlyMap<string, Record<string, any>>} records - Configured language notes.
 * @param {Readonly<Record<string, {tag: string}>>} languages - Language configuration.
 * @returns {Map<string, RomanInventory>}
 */
export function romanInventoriesOf(records, languages = {}) {
    const out = new Map();
    for (const [language, record] of records) {
        const value = record.data?.roman;
        const inventory = Object.freeze({
            language,
            characters: typeof value === "string" ? new Set(value) : undefined,
        });
        out.set(language, inventory);
        const tag = languages[language]?.tag;
        if (typeof tag === "string") out.set(tag.toLowerCase(), inventory);
    }
    return out;
}

/**
 * Invalid source characters, retaining offsets in the supplied unescaped text.
 * No punctuation, case or normalization repair is performed.
 * @param {string} text - Visible Roman source.
 * @param {RomanInventory} inventory - Its language's declared characters.
 * @param {(char: string) => boolean} [native] - Whether a directly typed native sign is drawn in the selected native face.
 * @returns {Array<{offset: number, message: string}>}
 */
export function romanTextProblems(text, inventory, native = () => false) {
    const out = [];
    if (!inventory.characters) return out;
    for (const { segment: cluster, index } of graphemes.segment(text)) {
        let offset = index;
        if (cluster !== cluster.normalize("NFC")) {
            out.push({
                offset,
                message: `\`${cluster}\` is not NFC spelling in \`${inventory.language}\`; write \`${cluster.normalize("NFC")}\``,
            });
            continue;
        }
        for (const char of cluster) {
            if (!/[ \t\r\n]/u.test(char) && !inventory.characters.has(char) && !native(char))
                out.push({
                    offset,
                    message: `\`${char}\` (${codeName(char)}) is not in \`${inventory.language}\`'s \`data.roman\` inventory`,
                });
            offset += char.length;
        }
    }
    return out;
}
