/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Where a footnote's two halves belong, and the two findings that hold the
 * line.
 *
 * A reference (`[^id]`) may be written anywhere prose can be written — a
 * paragraph, a list item, a block quote, a table cell, a heading, a
 * definition-list term. A definition (`[^id]: text`) belongs at the top
 * level of the note, the one place {@link separateFootnotes} looks for it:
 * the web and Foundry can resolve one nested in a list or a block quote, but
 * the book cannot, so the three surfaces would otherwise disagree about what
 * one note means. {@link misplacedFootnoteDefinitions} and
 * {@link unresolvedFootnoteReferences} are what every surface reports
 * instead of rendering the three different wrong things a misplaced or
 * missing definition otherwise produces.
 *
 * @module
 */

import { matchAllOutsideCode } from "./code-fences.mjs";

/**
 * Where a character offset in `source` falls, as a 1-based line and column.
 * @param {string} source - The text the offset indexes into.
 * @param {number} offset - A 0-based character offset.
 * @returns {{line: number, column: number}}
 */
function lineColumn(source, offset) {
    const before = source.slice(0, offset);
    const nl = before.lastIndexOf("\n");
    return { line: before.split("\n").length, column: offset - nl };
}

/**
 * Separate top-level footnote definitions from prose while retaining line numbers.
 * Definitions belong to the note and can be used by any rendered page.
 * @param {string} source - Authored Markdown.
 * @returns {{markdown: string, definitions: string}} Body with blanked definitions and their source.
 */
export function separateFootnotes(source) {
    const lines = String(source ?? "").split("\n");
    const body = [...lines];
    const definitions = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length)
                fence = null;
            continue;
        }
        if (marker) {
            fence = marker[1];
            continue;
        }
        if (!/^\[\^[^\]\s]+\]:/.test(lines[i])) continue;
        const start = i;
        i++;
        while (i < lines.length && (!lines[i].trim() || /^(?: {4}|\t)/.test(lines[i]))) i++;
        definitions.push(lines.slice(start, i).join("\n").trimEnd());
        for (let at = start; at < i; at++) body[at] = "";
        i--;
    }
    return { markdown: body.join("\n"), definitions: definitions.join("\n\n") };
}

/** A top-level footnote definition's opening line. */
const TOP_LEVEL_DEF = /^\[\^([^\]\s]+)\]:/;

/**
 * A list marker or a block quote marker, stripped as many times as it
 * repeats — a block quote can hold a list, and either can nest.
 */
const CONTAINER_PREFIX = /^(?:[ \t]{0,3}>[ \t]?|[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)+/;

/**
 * A footnote definition written inside a list item or a block quote, where
 * the web and Foundry can resolve it but the book drops it silently.
 *
 * A definition inside a table cell is not reported here: a table cell is
 * inline content, so `[^id]:` there is never recognised as a definition on
 * any surface and simply prints as written — the reference it was meant to
 * answer is what {@link unresolvedFootnoteReferences} reports.
 *
 * @param {string} source - A note's markdown body.
 * @returns {Array<{line: number, column: number, label: string, message: string}>}
 */
export function misplacedFootnoteDefinitions(source) {
    const lines = String(source ?? "").split("\n");
    const errors = [];
    let fence = null;
    // Inside the continuation of a genuine top-level definition: a blank
    // line or a four-space indent belongs to it, not to a new mistake.
    let continuation = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length)
                fence = null;
            continue;
        }
        if (marker) {
            fence = marker[1];
            continue;
        }
        if (TOP_LEVEL_DEF.test(line)) {
            continuation = true;
            continue;
        }
        if (continuation) {
            if (!line.trim() || /^(?: {4}|\t)/.test(line)) continue;
            continuation = false;
        }
        const prefix = CONTAINER_PREFIX.exec(line);
        if (!prefix) continue;
        const rest = line.slice(prefix[0].length);
        const match = TOP_LEVEL_DEF.exec(rest);
        if (!match) continue;
        errors.push({
            line: i + 1,
            column: prefix[0].length + 1,
            label: match[1],
            message:
                "a footnote definition belongs at the top level of the note " +
                "— a reference may be written anywhere, but move this " +
                `\`[^${match[1]}]:\` definition out of the list or block quote`,
        });
    }
    return errors;
}

/**
 * A footnote reference with no top-level definition to resolve against.
 *
 * Covers both commoner slips alike: a label never defined at all, and one
 * "defined" only inside a table cell, which is inline content and never
 * registers as a definition on any surface. A label misplaced in a list or a
 * block quote is excluded — {@link misplacedFootnoteDefinitions} already
 * reports that mistake at the definition's own line, and reporting it again
 * at the reference would say the same thing twice.
 *
 * @param {string} source - A note's markdown body.
 * @param {string} [definitions] - Its top-level definitions, when a caller
 *   already extracted them with {@link separateFootnotes}. Derived from
 *   `source` when omitted; a caller already holding both passes its own
 *   extraction instead, so the two cannot disagree about what is defined.
 * @returns {Array<{line: number, column: number, message: string}>}
 */
export function unresolvedFootnoteReferences(source, definitions) {
    const src = String(source ?? "");
    const resolvedAgainst = definitions ?? separateFootnotes(src).definitions;
    const resolved = new Set([...resolvedAgainst.matchAll(/\[\^([^\]\s]+)\]:/g)].map((m) => m[1]));
    const misplaced = new Set(misplacedFootnoteDefinitions(src).map((e) => e.label));
    const errors = [];
    for (const match of matchAllOutsideCode(src, /\[\^([^\]\s]+)\](?!:)/g)) {
        const label = match[1];
        if (resolved.has(label) || misplaced.has(label)) continue;
        errors.push({
            ...lineColumn(src, match.index),
            message:
                `footnote [^${label}] has no definition, so it is set as text — write ` +
                `\`[^${label}]: …\` at the top level of the note`,
        });
    }
    return errors;
}

/**
 * Every footnote placement finding for one note body — the union
 * {@link misplacedFootnoteDefinitions} and {@link unresolvedFootnoteReferences}
 * report, in document order.
 *
 * @param {string} source - A note's markdown body.
 * @returns {Array<{line: number, column: number, message: string}>}
 */
export function footnoteFindings(source) {
    const misplaced = misplacedFootnoteDefinitions(source).map(({ label, ...rest }) => rest);
    const unresolved = unresolvedFootnoteReferences(source);
    return [...misplaced, ...unresolved].sort((a, b) => a.line - b.line || a.column - b.column);
}
