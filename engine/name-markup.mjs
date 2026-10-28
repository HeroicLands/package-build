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

/** Pure projections of parsed inline text and original marked-name positions. */

/**
 * An original source range with its opening file position.
 * @typedef {object} SpanSourceSite
 * @property {number} start - Inclusive UTF-16 source offset.
 * @property {number} end - Exclusive UTF-16 source offset.
 * @property {number} line - Original 1-based source line.
 * @property {number} column - Original 1-based UTF-16 source column.
 */

/**
 * The retained attribute key and value at their authored positions.
 * @typedef {object} SpanAttributePosition
 * @property {SpanSourceSite} key - Attribute name, without surrounding whitespace.
 * @property {SpanSourceSite} value - Authored value, without its surrounding quotes.
 */

/**
 * One actual bracketed span and its renderer-derived visible text.
 * @typedef {object} ContentSpan
 * @property {string} id - Normalized anchor, or an empty string.
 * @property {number} start - Inclusive UTF-16 offset of the opening bracket.
 * @property {number} end - Exclusive UTF-16 offset after the complete span.
 * @property {number} line - Original 1-based line of the opening bracket.
 * @property {number} column - Original 1-based UTF-16 column of the bracket.
 * @property {string} text - Inline label source passed to the existing parser.
 * @property {number} contentEnd - Original UTF-16 offset of the closing label bracket.
 * @property {string} visible - Visible text from the actual parsed children.
 * @property {ReadonlyArray<readonly [string, string]>} attrs - Retained permitted HTML attributes.
 * @property {Record<string, SpanAttributePosition>} attributePositions - Authored key/value sites by retained attribute name.
 * @property {ReturnType<typeof import("./content-verse.mjs").parseVerse>} [verseModel] - Logical model of an inline verse quotation.
 */

/**
 * One located span-grammar or refused-attribute finding.
 * @typedef {object} SpanFinding
 * @property {number} line - Original 1-based source line.
 * @property {number} column - Original 1-based UTF-16 source column.
 * @property {string} message - The existing grammar or attribute diagnostic.
 */

/**
 * A captured authored span inventory.
 * @typedef {object} SpanScan
 * @property {ContentSpan[]} spans - All actual parsed bracketed spans in source order.
 * @property {ContentSpan[]} names - The same span objects carrying the exact name class.
 * @property {SpanFinding[]} errors - Located diagnostics in source order.
 */

/**
 * Visible name text from the renderer's actual parsed children. Footnote
 * markers and images supply no name text; references have already resolved.
 * @param {readonly object[]} tokens - Parsed inline tokens.
 * @returns {string} Text without inline formatting or annotation markers.
 */
export function inlineText(tokens) {
    return tokens
        .map((token) => {
            if (token.children && token.type !== "image") return inlineText(token.children);
            if (token.type === "text" || token.type === "code_inline") return token.content;
            if (token.type === "softbreak" || token.type === "hardbreak") return " ";
            return "";
        })
        .join("");
}

/**
 * Rebase an authored body's captured names to its original raw file.
 * The inventory is read only; no source parsing or second marker scan occurs.
 * @template {ContentSpan} Span
 * @param {readonly Span[]} spans - The captured body's name spans.
 * @param {{raw: string, bodyLine?: number, bodyColumn?: number}} source - Original body origin.
 * @returns {Span[]} Copies retaining the span metadata with raw offsets and file coordinates.
 */
export function rebaseNameSpans(spans, { raw, bodyLine = 1, bodyColumn = 1 }) {
    let origin = 0;
    for (let line = 1; line < bodyLine; line++) origin = raw.indexOf("\n", origin) + 1;
    origin += bodyColumn - 1;
    /**
     * @template {SpanSourceSite} Site
     * @param {Site} position - Captured relative range and opening position.
     * @returns {Site} The same metadata at original file coordinates.
     */
    const rebase = (position) => ({
        ...position,
        start: position.start + origin,
        end: position.end + origin,
        line: bodyLine + position.line - 1,
        column: position.column + (position.line === 1 ? bodyColumn - 1 : 0),
    });
    return spans.map((span) => ({
        ...rebase(span),
        contentEnd: span.contentEnd + origin,
        attributePositions: Object.fromEntries(
            Object.entries(span.attributePositions ?? {}).map(([key, positions]) => [
                key,
                { key: rebase(positions.key), value: rebase(positions.value) },
            ]),
        ),
    }));
}
