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
 * Project an authored run to logical Roman text while retaining source offsets.
 * Presentation-only children contribute their text; names contribute standard
 * braces. The caller decides which children are independent runs and which
 * ranges are layout or emphasis delimiters.
 * @module
 */

/**
 * @typedef {object} RomanSpan
 * @property {number} start - Opening bracket offset.
 * @property {number} end - Offset past the attribute block.
 * @property {number} contentEnd - Closing bracket offset.
 * @property {Array<[string, string]>} [attrs] - Authored attributes.
 */

/**
 * @typedef {object} ProjectedSpan
 * @property {RomanSpan} source - The authored child.
 * @property {number} from - Its first logical UTF-16 offset, including name braces.
 * @property {number} to - Offset past its logical text and braces.
 * @property {number} contentFrom - Logical text after its opening name brace.
 * @property {number} contentTo - Offset past the logical text, before its closing name brace.
 * @property {boolean} name - Whether this child marks a name.
 * @property {boolean} included - Whether this child contributes its own text.
 */

/**
 * Remove Markdown escapes, inline presentation syntax and excluded layout.
 * The returned offsets refer to the original source, in UTF-16 units, matching
 * the source scanner. A supplementary character has two entries, both pointing
 * at its original first unit. Synthetic braces point at the name's brackets.
 * @param {string} source - Complete authored source.
 * @param {object} [options] - Bounds and projections chosen by the run scanner.
 * @param {number} [options.from] - First included source offset.
 * @param {number} [options.to] - Offset past the included source.
 * @param {readonly RomanSpan[]} [options.spans] - Scanned spans, with absolute offsets.
 * @param {(span: RomanSpan) => boolean} [options.includeSpan] - Whether a child inherits this run.
 * @param {(span: RomanSpan) => string} [options.opaqueSpan] - Placeholder for an independent child. The default empty name keeps sentence state without introducing that child's letters.
 * @param {ReadonlyArray<readonly [number, number]>} [options.exclude] - Absolute source ranges that carry layout or presentation syntax.
 * @param {boolean} [options.markNames] - Whether name children contribute braces.
 * @param {boolean} [options.preserveSlashEscape] - Keep a literal verse slash distinct from a line control.
 * @returns {{text: string, offsets: number[], spans: ProjectedSpan[]}} Logical text and source locations, with child ranges for presentation.
 */
export function plainRomanRun(
    source,
    {
        from = 0,
        to = source.length,
        spans = [],
        includeSpan = () => true,
        opaqueSpan = () => "{}",
        exclude = [],
        markNames = true,
        preserveSlashEscape = false,
    } = {},
) {
    let text = "";
    const offsets = [];
    const projected = [];
    const children = [...spans]
        .filter((span) => span.start >= from && span.end <= to)
        .sort((a, b) => a.start - b.start || b.end - a.end);
    const byStart = new Map(children.map((span) => [span.start, span]));
    const excluded = [...exclude].sort((a, b) => a[0] - b[0]);
    let excludedIndex = 0;
    const append = (value, offset) => {
        text += value;
        for (let unit = 0; unit < value.length; unit++) offsets.push(offset);
    };
    const walk = (first, past) => {
        let at = first;
        while (at < past) {
            while (excluded[excludedIndex]?.[1] <= at) excludedIndex++;
            const omitted = excluded[excludedIndex];
            if (omitted && omitted[0] <= at) {
                at = Math.min(past, omitted[1]);
                continue;
            }
            const candidate = byStart.get(at);
            const span = candidate && candidate.end <= past ? candidate : undefined;
            if (span) {
                const name = (span.attrs?.find(([key]) => key === "class")?.[1] ?? "")
                    .split(/\s+/)
                    .includes("name");
                const included = includeSpan(span);
                const range = {
                    source: span,
                    from: text.length,
                    to: text.length,
                    contentFrom: text.length,
                    contentTo: text.length,
                    name,
                    included,
                };
                projected.push(range);
                if (included) {
                    if (name && markNames) append("{", span.start);
                    range.contentFrom = text.length;
                    walk(span.start + 1, span.contentEnd);
                    range.contentTo = text.length;
                    if (name && markNames) append("}", span.contentEnd);
                } else {
                    append(opaqueSpan(span), span.start);
                    range.contentTo = text.length;
                }
                range.to = text.length;
                at = span.end;
                continue;
            }
            // A codage's notation belongs to its encoding. Do not unescape or
            // interpret anything between its immutable boundaries.
            if (source[at] === "⟦") {
                const close = source.indexOf("⟧", at + 1);
                const end = close >= 0 && close < past ? close + 1 : past;
                while (at < end) {
                    const char = String.fromCodePoint(source.codePointAt(at));
                    append(char, at);
                    at += char.length;
                }
                continue;
            }
            const escaped =
                source[at] === "\\" && at + 1 < past && /[!-/:-@[-`{-~]/.test(source[at + 1]);
            const offset = at + (escaped ? 1 : 0);
            if (escaped && preserveSlashEscape && source[offset] === "/") append("\\", at);
            // A terminal Markdown line-break slash is layout, not Roman.
            if (source[at] === "\\" && !escaped && /[\r\n]/.test(source[at + 1] ?? "")) {
                at++;
                continue;
            }
            const char = String.fromCodePoint(source.codePointAt(offset));
            append(char, offset);
            at = offset + char.length;
        }
    };
    walk(from, to);
    return { text, offsets, spans: projected };
}
