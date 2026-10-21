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
 * **Typographic punctuation on the web.** A web page sets straight quotes as
 * curly ones and a run of hyphens or full stops as the dash or ellipsis it
 * stands for, as a printed page does:
 *
 * | Written | Set as |
 * | ------- | ------ |
 * | `"word"` | “word” |
 * | `'word'` | ‘word’ |
 * | `it's`, `'90s`, `'twas` | it’s, ’90s, ’twas |
 * | `--` | – |
 * | `---` | — |
 * | `...` | … |
 * | `<<`, `>>` | «, » |
 *
 * A quote is read by the characters either side of it, as emphasis is: one
 * that can only open a quotation opens one, one that can only close it closes
 * a quotation already open earlier on the page, and one that could do either
 * is left straight. Code, link destinations, raw HTML and a heading's
 * attribute block are never touched, and neither is a backslash-escaped
 * character.
 *
 * @module
 */

/** The characters markdown-it's text rule stops at, and the ones this rule reads. */
const STOPS = new Set([..."\n!#$%&*+-:<=@[\\]^_`{}~", '"', "'", ".", ">"]);

/**
 * The token a typographic character is written as. It is a token of its own,
 * not text, so a reader of a heading's text can tell where it stands.
 */
export const TYPOGRAPHIC = "typographic";

/** The characters this rule reads. */
const TRIGGERS = new Set(['"', "'", "-", ".", "<", ">"]);

const LEFT_SINGLE = "‘";
const RIGHT_SINGLE = "’";
const LEFT_DOUBLE = "“";
const RIGHT_DOUBLE = "”";

/** ASCII punctuation, as a byte table reads it. */
const isAsciiPunct = (char) => char !== undefined && /^[!-/:-@[-`{-~]$/.test(char);

/** ASCII white space, as a byte table reads it. */
const isAsciiSpace = (char) => char === " " || char === "\t" || char === "\n" || char === "\r";

/** Unicode punctuation. */
const isPunct = (char) => char !== undefined && /^\p{P}$/u.test(char);

/** Unicode punctuation or a symbol. */
const isPunctOrSymbol = (char) => char !== undefined && /^[\p{P}\p{S}]$/u.test(char);

/** Unicode white space. */
const isSpace = (char) => char !== undefined && (isAsciiSpace(char) || /^\s$/u.test(char));

const isLetter = (char) => char !== undefined && /^\p{L}$/u.test(char);
const isDigit = (char) => char !== undefined && /^\p{Nd}$/u.test(char);
const isAsciiDigit = (char) => char !== undefined && char >= "0" && char <= "9";

/**
 * Whether a run of quote characters can open and can close, by the flanking
 * rules emphasis uses.
 *
 * @param {string} before - The character before the run, or a newline.
 * @param {string} after - The character after it, or a space.
 * @returns {{canOpen: boolean, canClose: boolean}} What the run can do.
 */
function flanking(before, after) {
    const beforePunct = isPunctOrSymbol(before);
    const beforeSpace = isSpace(before);
    const afterPunct = isPunctOrSymbol(after);
    const afterSpace = isSpace(after);
    return {
        canOpen: !afterSpace && (!afterPunct || beforeSpace || beforePunct),
        canClose: !beforeSpace && (!beforePunct || afterSpace || afterPunct),
    };
}

/**
 * Where a trailing attribute block starts in an inline run, so a heading's
 * `{#id key="value"}` keeps its straight quotes and hyphens.
 *
 * @param {string} src - The inline run.
 * @returns {number} The index of its opening brace, or the run's length.
 */
function attributeStart(src) {
    const match = /\{[^{}\n]*\}\s*$/.exec(src);
    return match ? match.index : src.length;
}

/**
 * The punctuation one position sets, and how many characters it consumes.
 *
 * @param {object} state - markdown-it's inline state.
 * @returns {{text: string, length: number}|null} The replacement, or `null`
 *   where the character stays as written.
 */
function substitution(state) {
    const { src, pos } = state;
    const end = src.indexOf("\n", pos);
    const line = [...src.slice(pos, end < 0 ? src.length : end + 1)];
    const c = line[0];
    if (line.length > 2) {
        if (c === "-" && line[1] === "-" && line[2] === "-") return { text: "—", length: 3 };
        if (c === "." && line[1] === "." && line[2] === ".") return { text: "…", length: 3 };
    }
    if (c === ".") return null;
    if (line.length > 1) {
        if (c === "<") return line[1] === "<" ? { text: "«", length: 2 } : null;
        if (c === ">") return line[1] === ">" ? { text: "»", length: 2 } : null;
        if (c === "-" && line[1] === "-") return { text: "–", length: 2 };
    }
    if (c !== "'" && c !== '"') return null;

    const before = pos > 0 ? [...src.slice(0, pos)].at(-1) : "\n";
    let run = 0;
    while (run < line.length && line[run] === c) run++;
    const { canOpen, canClose } = flanking(before, run < line.length ? line[run] : " ");
    const counter = (state.env.typographerQuotes ??= { single: 0, double: 0 });
    const one = (text) => ({ text, length: 1 });

    if (c === "'") {
        // A decade: '90s.
        if (
            canOpen &&
            !canClose &&
            line.length > 3 &&
            isAsciiDigit(line[1]) &&
            isAsciiDigit(line[2]) &&
            line[3] === "s"
        ) {
            const after = line.length > 4 ? line[4] : " ";
            if (isSpace(after) || isPunctOrSymbol(after)) return one(RIGHT_SINGLE);
        }
        // An elision: 'twas, 'em, 'net.
        if (
            line.length > 1 &&
            (isPunct(before) || isSpace(before)) &&
            ["t", "e", "n", "l"].includes(line[1])
        )
            return one(RIGHT_SINGLE);
        // An apostrophe between a letter or digit and a letter.
        if (line.length > 1 && (isDigit(before) || isLetter(before)) && isLetter(line[1]))
            return one(RIGHT_SINGLE);
        if (canOpen && !canClose) {
            const contracted =
                (line.length > 1 &&
                    ["s", "m", "t", "d"].includes(line[1]) &&
                    (line.length < 3 || isAsciiPunct(line[2]) || isAsciiSpace(line[2]))) ||
                (line.length > 2 &&
                    ["ve", "ll", "re"].includes(`${line[1]}${line[2]}`) &&
                    (line.length < 4 || isAsciiPunct(line[3]) || isAsciiSpace(line[3])));
            if (contracted) return one(RIGHT_SINGLE);
            counter.single++;
            return one(LEFT_SINGLE);
        }
        // A plural possessive or a dropped letter: Smiths', doin'.
        if (line.length > 2 && !isDigit(line[1])) return one(RIGHT_SINGLE);
        if (counter.single > 0 && closes(canOpen, canClose, line)) {
            counter.single--;
            return one(RIGHT_SINGLE);
        }
        return null;
    }

    if (canOpen && !canClose) {
        counter.double++;
        return one(LEFT_DOUBLE);
    }
    if (counter.double > 0 && closes(canOpen, canClose, line)) {
        // A measurement in inches: "Monitor 21"".
        if (line.length > 1 && line[1] === '"' && isDigit(before)) return null;
        counter.double--;
        return one(RIGHT_DOUBLE);
    }
    return null;
}

/**
 * Whether a quote closes: it can only close, or it could do either and stands
 * before punctuation that ends the line or is followed by white space or more
 * punctuation.
 *
 * @param {boolean} canOpen - The run can open.
 * @param {boolean} canClose - The run can close.
 * @param {string[]} line - The rest of the line, from the quote.
 * @returns {boolean} Whether it closes.
 */
function closes(canOpen, canClose, line) {
    if (canClose && !canOpen) return true;
    return (
        canClose &&
        canOpen &&
        line.length > 1 &&
        isPunct(line[1]) &&
        (line.length === 2 || isAsciiPunct(line[2]) || isAsciiSpace(line[2]))
    );
}

/**
 * Set typographic punctuation in every inline run.
 *
 * @param {import("markdown-it")} md - Markdown parser to extend.
 */
export function typographerPlugin(md) {
    md.inline.ruler.at("text", (state, silent) => {
        let pos = state.pos;
        while (pos < state.posMax && !STOPS.has(state.src[pos])) pos++;
        if (pos === state.pos) return false;
        if (!silent) state.pending += state.src.slice(state.pos, pos);
        state.pos = pos;
        return true;
    });
    md.inline.ruler.push("typographer", (state, silent) => {
        if (!TRIGGERS.has(state.src[state.pos])) return false;
        state.typographerEnd ??= attributeStart(state.src);
        if (state.pos >= state.typographerEnd) return false;
        const found = substitution(state);
        if (!found) return false;
        if (!silent) state.push(TYPOGRAPHIC, "", 0).content = found.text;
        state.pos += found.length;
        return true;
    });
    md.renderer.rules[TYPOGRAPHIC] = (tokens, idx) => md.utils.escapeHtml(tokens[idx].content);
    // An image's description is its text, its punctuation included.
    const asText = md.renderer.renderInlineAsText.bind(md.renderer);
    md.renderer.renderInlineAsText = (tokens, options, env) =>
        tokens
            .map((token) =>
                token.type === TYPOGRAPHIC ? token.content : asText([token], options, env),
            )
            .join("");
}
