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
 * **Minified site pages.** {@link minifyHtml} drops what a browser does not
 * read: comments, and every run of white space but one character.
 *
 * What a reader sees is unchanged. A run of white space between two words or
 * two tags still separates them, as one space; it is only made shorter. The
 * places where white space is the content are kept exactly as written: a
 * `<pre>`, a `<textarea>`, a `<script>` or `<style>`, and a verse's lines,
 * which set their spacing as authored. A tag is kept as written too, its
 * attribute values included.
 *
 * @module
 */

/** The elements whose content is written out as it stands. */
const VERBATIM = /^<(pre|textarea|script|style)\b/i;

/** A verse's spans, whose white space is set as authored. */
const VERSE_SPAN = /\bclass\s*=\s*"[^"]*\bverse-(?:line|column|part)\b/i;

/**
 * Minify a page.
 *
 * @param {string} html - A complete document.
 * @returns {string} The same document without comments and with each run of
 *   white space outside the verbatim elements cut to one character: a newline
 *   where the run held one, a space otherwise.
 */
export function minifyHtml(html) {
    const source = String(html ?? "");
    const pieces =
        /<!--[\s\S]*?-->|<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>|[^<]+|</gi;
    const verse = [];
    let out = "";
    for (const [piece] of source.matchAll(pieces)) {
        if (piece.startsWith("<!--")) {
            // A conditional comment is read by the browser it names.
            if (piece.startsWith("<!--[if")) out += piece;
            continue;
        }
        if (piece.startsWith("<")) {
            if (VERBATIM.test(piece)) {
                out += piece;
                continue;
            }
            if (/^<span\b/i.test(piece)) verse.push(verse.at(-1) || VERSE_SPAN.test(piece));
            else if (/^<\/span\s*>/i.test(piece)) verse.pop();
            out += piece;
            continue;
        }
        out +=
            verse.at(-1) ? piece : (
                piece.replace(/\s+/g, (run) => (run.includes("\n") ? "\n" : " "))
            );
    }
    return out.replace(/^\s+/, "");
}
