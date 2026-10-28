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

/** A language's Roman additions and the shared punctuation standard. */

import { isSettingScriptCodePoint } from "./content-charset.mjs";

/** Sentence terminals in the shared Roman standard. */
const TERMINALS = new Set(".?‼!");
/** Unconditional punctuation; ^ is conditional indentation or a language addition. */
const STANDARD = new Set(".?‼!,«»‹›—…/{}⟦⟧");
/** Exactly the encoding definition's word-separating whitespace class. */
export const isRomanWhitespace = (char) => /^[\p{Zs}\u0009-\u000D]$/u.test(char);

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
    const supplied = [...new Set(value)].filter(
        (char) => STANDARD.has(char) || /[;:"“”]/u.test(char),
    );
    if (supplied.length)
        problems.push(
            "`data.roman` lists only language additions, without standard punctuation, literal markers, semicolons, colons or English quotation marks: " +
                supplied.map((char) => `\`${char}\``).join(", "),
        );
    const native = [...new Set(value)].filter((char) =>
        isSettingScriptCodePoint(char.codePointAt(0)),
    );
    if (native.length)
        problems.push(
            "`data.roman` lists Roman additions, without setting-script characters; write exact native characters through codage",
        );
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
 * @returns {Array<{offset: number, message: string}>}
 */
export function romanTextProblems(text, inventory) {
    const out = [];
    if (!inventory.characters) return out;
    const decomposed = new Map(
        [...graphemes.segment(text)]
            .filter(({ segment }) => segment !== segment.normalize("NFC"))
            .map(({ segment, index }) => [index, segment]),
    );
    const quotes = [];
    let sentenceStart = true;
    const sentenceText = () => {
        sentenceStart = false;
        if (quotes.length) quotes.at(-1).hasText = true;
    };
    const report = (offset, message) => out.push({ offset, message });
    for (let offset = 0; offset < text.length;) {
        const char = String.fromCodePoint(text.codePointAt(offset));
        // Verse retains this escape so the encoder can distinguish a literal
        // slash from its line control. The slash itself is standard Roman.
        if (text.startsWith("\\/", offset)) {
            offset++;
            continue;
        }
        if (char === "⟦") {
            // The encoding validates codage and its boundary grammar. Roman
            // punctuation and language letters never reinterpret its contents.
            const close = text.indexOf("⟧", offset + 1);
            offset = close < 0 ? text.length : close + 1;
            sentenceText();
            continue;
        }
        const cluster = decomposed.get(offset);
        if (cluster) {
            report(
                offset,
                `\`${cluster}\` is not NFC spelling in \`${inventory.language}\`; write \`${cluster.normalize("NFC")}\``,
            );
            offset += cluster.length;
            sentenceText();
            continue;
        }
        // An independent language child projects to an opaque empty name.
        if (text.startsWith("{}", offset)) {
            offset += 2;
            sentenceText();
            continue;
        }
        // Layout, pauses and name boundaries supply no sentence text.
        if (isRomanWhitespace(char) || "/,{}".includes(char)) {
            offset += char.length;
            continue;
        }
        if (char === "^") {
            let slash = text.lastIndexOf("/", offset - 1);
            while (slash >= 0 && (/\\+$/.exec(text.slice(0, slash))?.[0].length ?? 0) % 2)
                slash = text.lastIndexOf("/", slash - 1);
            const start = Math.max(text.lastIndexOf("\n", offset - 1), slash) + 1;
            if (/^\^*$/.test(text.slice(start, offset))) {
                // Indentation is layout and leaves sentence-start ellipsis
                // semantics intact. The reference encoder uses these bounds.
                offset += char.length;
                continue;
            }
        }
        if (text.startsWith("<<", offset) || text.startsWith(">>", offset)) {
            report(
                offset,
                `write \`${char === "<" ? "«" : "»"}\` for a quotation, not \`${char}${char}\``,
            );
            offset += 2;
            continue;
        }
        if (text.startsWith("...", offset)) {
            report(offset, "write the ellipsis `…`, not three periods `...`");
            offset += 3;
            continue;
        }
        if (char === ";" || char === ":") {
            report(
                offset,
                `\`${char}\` (${codeName(char)}) is not standard Roman punctuation; write \`,\` for a pause within a sentence or \`.\` between complete sentences`,
            );
        } else if (/^["“”]$/u.test(char)) {
            report(
                offset,
                "write `«…»` for an outer quotation and `‹…›` for a quotation inside it",
            );
        } else if (isSettingScriptCodePoint(char.codePointAt(0))) {
            report(
                offset,
                `write the setting-script character ${codeName(char)} as \`⟦${codeName(char)}⟧\` or by its encoding's codage name`,
            );
        } else if (char === "^" && !inventory.characters.has(char)) {
            report(
                offset,
                "`^` is line-start indentation; elsewhere it must be a declared language addition in `data.roman`",
            );
        } else if (!STANDARD.has(char) && !inventory.characters.has(char)) {
            report(
                offset,
                `\`${char}\` (${codeName(char)}) is not in \`${inventory.language}\`'s \`data.roman\` inventory`,
            );
        }
        if (char === "«" || char === "‹") {
            const expected = quotes.length % 2 === 0 ? "«" : "‹";
            if (char !== expected)
                report(offset, `a quotation at this depth opens with \`${expected}\``);
            quotes.push({ char, offset, sentenceStart, hasText: false });
            sentenceStart = true;
        } else if (char === "»" || char === "›") {
            const opening = quotes.at(-1);
            const expected = opening?.char === "«" ? "»" : "›";
            if (!opening) report(offset, `quotation closer \`${char}\` has no opening quotation`);
            else {
                if (char !== expected)
                    report(offset, `this quotation closes with \`${expected}\`, not \`${char}\``);
                quotes.pop();
                sentenceStart = opening.sentenceStart && !opening.hasText;
                if (opening.hasText) sentenceText();
            }
        } else if (char === "—" || (char === "…" && !sentenceStart)) {
            const rest = text.slice(offset + char.length);
            if ([...rest].some((next) => !isRomanWhitespace(next)) && !TERMINALS.has(rest[0]))
                report(
                    offset,
                    `\`${char}\` is immediately followed by a terminal (\`.\`, \`?\`, \`‼\` or \`!\`) except at the end of a run`,
                );
        } else if (TERMINALS.has(char)) {
            if (sentenceStart)
                report(offset, `terminal \`${char}\` has no sentence text before it`);
            sentenceStart = true;
        } else sentenceText();
        offset += char.length;
    }
    for (const opening of quotes)
        report(
            opening.offset,
            `quotation \`${opening.char}\` needs its closing \`${opening.char === "«" ? "»" : "›"}\``,
        );
    return out.sort((a, b) => a.offset - b.offset);
}
