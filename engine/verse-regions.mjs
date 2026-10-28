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

import MarkdownIt from "markdown-it";
import { WIKILINK } from "./wikilink-pattern.mjs";
import { parseExtensionAttributes } from "./extension-attributes.mjs";

/**
 * A raw verse div, opaque to ordinary Markdown block syntax.
 * @typedef {object} VerseRegion
 * @property {number} start - Opening line, zero based.
 * @property {number} end - Closing line, zero based and inclusive.
 * @property {number} from - First offset of the complete region.
 * @property {number} to - Offset past the complete region.
 * @property {number} bodyStart - First body offset.
 * @property {number} bodyEnd - Offset past body text, excluding its final newline.
 * @property {string} body - Authored body bytes.
 * @property {Record<string,string>} attributes - Authored values.
 * @property {string} id - Anchor or empty string.
 * @property {string[]} classes - Authored classes including verse.
 * @property {string} indent - Opening indentation.
 * @property {"verse"} name - Region kind.
 * @property {boolean} closed - Whether a closing delimiter is present.
 * @property {string[]} problems - Attribute syntax findings.
 */

/** Recognize an opener without interpreting its body as Markdown blocks. */
function opener(line) {
    const named = /^ *:::verse(?:[ \t]+(.*))?$/.exec(line);
    const generic = /^ *:::[ \t]+(\{.*)$/.exec(line);
    if (!named && !generic) return undefined;
    const raw = (named?.[1] ?? generic?.[1] ?? "").trim();
    const braced = /^\{[^\n]*\}$/.test(raw);
    const parsed = parseExtensionAttributes(braced ? raw.slice(1, -1) : raw.replace(/^\{/, ""));
    if (!named && !parsed.classes.includes("verse")) return undefined;
    if (raw && !braced) parsed.problems.push("verse div attributes need {…} braces");
    if (!parsed.classes.includes("verse")) parsed.classes.unshift("verse");
    return parsed;
}

/**
 * Install the opaque verse-div block rule. Tokens carry raw source regions.
 * @param {import("markdown-it")} md - Markdown parser.
 */
export function verseDivPlugin(md) {
    md.block.ruler.before(
        "code",
        "verse_div",
        (state, first, past, silent) => {
            if (state.sCount[first] - state.blkIndent >= 4) return false;
            const line = state.src.slice(
                state.bMarks[first] + state.tShift[first],
                state.eMarks[first],
            );
            const parsed = opener(line);
            if (!parsed) return false;
            if (silent) return true;
            let close = first + 1;
            while (close < past) {
                const text = state.src.slice(
                    state.bMarks[close] + state.tShift[close],
                    state.eMarks[close],
                );
                if (/^ *:::[ \t]*$/.test(text)) break;
                close++;
            }
            const closed = close < past;
            const original = state.env.verseSource ?? state.src;
            const rawLines = original.split(/\r\n|\r|\n/);
            const starts = [0];
            for (const match of original.matchAll(/\r\n|\r|\n/g))
                starts.push(match.index + match[0].length);
            const from = starts[first] ?? original.length;
            const bodyStart = starts[first + 1] ?? original.length;
            let bodyEnd = starts[close] ?? original.length;
            if (bodyEnd > bodyStart) {
                if (original[bodyEnd - 1] === "\n") bodyEnd--;
                if (original[bodyEnd - 1] === "\r") bodyEnd--;
            }
            const region = {
                start: first,
                end: closed ? close : past - 1,
                from,
                to: starts[closed ? close + 1 : past] ?? original.length,
                bodyStart,
                bodyEnd,
                body: original.slice(bodyStart, bodyEnd),
                attributes: parsed.values,
                id: parsed.id,
                classes: parsed.classes,
                indent: /^ */.exec(rawLines[first] ?? "")[0],
                name: "verse",
                closed,
                problems: parsed.problems,
            };
            const token = state.push("verse_div", "div", 0);
            token.block = true;
            token.map = [first, closed ? close + 1 : past];
            token.content = region.body;
            token.meta = { verseRegion: region };
            state.line = closed ? close + 1 : past;
            return true;
        },
        { alt: ["paragraph", "reference", "blockquote", "list"] },
    );
}

const parser = new MarkdownIt({ html: true }).use(verseDivPlugin);
parser.core.ruler.disable(["inline", "linkify", "replacements", "smartquotes", "text_join"]);

/**
 * Locate complete raw verse divs while leaving literal examples untouched.
 * @param {string} source - Authored Markdown.
 * @returns {VerseRegion[]} Regions in source order, including unclosed divs.
 */
export function verseRegions(source) {
    return parser
        .parse(source, { verseSource: source })
        .filter((token) => token.type === "verse_div")
        .map((token) => token.meta.verseRegion);
}

/**
 * Source ranges belonging to inline syntax rather than visible verse text.
 * @param {string} source - Inline Markdown.
 * @returns {Array<[number,number]>} Protected UTF-16 ranges.
 */
export function inlineSyntaxRanges(source) {
    const ranges = [];
    for (const match of source.matchAll(new RegExp(WIKILINK.source, "g"))) {
        const separator = match[0].indexOf("|");
        const close = match[0].indexOf("]]");
        ranges.push([match.index, match.index + (separator < 0 ? close + 2 : separator + 1)]);
        ranges.push([match.index + close, match.index + match[0].length]);
    }
    for (let at = 0; at < source.length; at++) {
        if (source[at] === "\\") {
            at++;
            continue;
        }
        const char = source[at];
        let past = -1;
        if (char === "⟦") past = source.indexOf("⟧", at + 1) + 1;
        else if (char === "`") {
            const mark = /^`+/.exec(source.slice(at))[0];
            const close = source.indexOf(mark, at + mark.length);
            if (close >= 0) past = close + mark.length;
        } else if (source.startsWith("<!--", at)) past = source.indexOf("-->", at + 4) + 3;
        else if (char === "<") past = source.indexOf(">", at + 1) + 1;
        else if (char === "{") past = source.indexOf("}", at + 1) + 1;
        else if (char === "(" && source[at - 1] === "]") {
            let depth = 1;
            for (let next = at + 1; next < source.length; next++) {
                if (source[next] === "\\") {
                    next++;
                    continue;
                }
                if (source[next] === "(") depth++;
                if (source[next] === ")" && !--depth) {
                    past = next + 1;
                    break;
                }
            }
        }
        if (past > at) {
            ranges.push([at, past]);
            at = past - 1;
        }
    }
    return ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}
