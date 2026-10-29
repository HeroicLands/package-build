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

/** Pure encoding-note compiler and script execution. No files or Node APIs are needed. */
import { templateProgram } from "./encoding-template.mjs";
const OPEN = "⟦";
const CLOSE = "⟧";
const OPEN_MARK = "\u{E0112}";
const CLOSE_MARK = "\u{E0113}";
const ESCAPE_MARK = "\u{E0115}";
const WHITE = /^[\p{Zs}\u0009-\u000D]$/u;
const SPACE = /^\p{White_Space}$/u;
const LETTER = /^\p{L}$/u;
const WORD = /^[\p{L}\p{N}_]$/u;
const BOUNDARY = /^[\p{P}\p{S}]$/u;
const SLUG = /^[a-z0-9-]+$/;
const TOP_KEYS = new Set([
    "name",
    "kind",
    "fonts",
    "codes",
    "controls",
    "accepts",
    "separator",
    "vowels",
    "rows",
    "faces",
    "roundTrip",
    "groupCase",
]);
const CONTROL_KEYS = new Set([
    "verseStanza",
    "verseCanto",
    "wordSeparator",
    "literalOpen",
    "literalClose",
    "literalEscape",
]);
const compiled = new WeakSet();
const templateReaders = new WeakMap();
const templateSources = new WeakMap();
const chars = (text) => [...text];
const length = (text) => chars(text).length;
const firstAt = (text, at) =>
    at < text.length ? String.fromCodePoint(text.codePointAt(at)) : undefined;
const previousAt = (text, at) => {
    const last = text.charCodeAt(at - 1);
    return (
            at > 1 &&
                last >= 0xdc00 &&
                last <= 0xdfff &&
                text.charCodeAt(at - 2) >= 0xd800 &&
                text.charCodeAt(at - 2) <= 0xdbff
        ) ?
            text.slice(at - 2, at)
        :   text.slice(at - 1, at);
};
function pointSlice(text, at, count) {
    let end = at;
    while (count-- > 0 && end < text.length) end += firstAt(text, end).length;
    return text.slice(at, end);
}
const scalar = (text) =>
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const wordy = (char) => char !== undefined && WORD.test(char);

/**
 * A schema fault or text refusal. Text offsets are UTF-16; columns count code points.
 */
export class EncodingError extends Error {
    /** @param {string} message @param {{text?: string, offset?: number, key?: string}} [details] */
    constructor(message, { text, offset = 0, key } = {}) {
        super(message);
        this.name = "EncodingError";
        if (key !== undefined) this.key = key;
        if (text !== undefined) {
            this.offset = offset;
            this.line = text.slice(0, offset).split("\n").length;
            this.column = length(text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset)) + 1;
        }
    }
}

function fault(key, message) {
    throw new EncodingError(message, { key });
}
function textError(text, offset, message) {
    throw new EncodingError(message, { text, offset });
}
function keys(value, allowed, at) {
    for (const key of Object.keys(value))
        if (!allowed.has(key))
            fault(
                at ? `${at}.${key}` : key,
                `Unknown key \`${key}\`; an encoding is self-contained`,
            );
}
function string(value, key, nonempty = false) {
    if (typeof value !== "string" || (nonempty && !value) || !scalar(value))
        fault(key, `\`${key}\` must be ${nonempty ? "a nonempty" : "a"} Unicode scalar string`);
}
function rows(value, key, vowels, allowEmpty) {
    if (!Array.isArray(value)) fault(key, `\`${key}\` must be a list of rows`);
    return value.map((value, order) => {
        const at = `${key}.${order}`;
        let from, to, before, position;
        if (Array.isArray(value)) {
            if (value.length !== 2) fault(at, "A row is two strings, [from, to]");
            [from, to] = value;
        } else if (object(value)) {
            keys(value, new Set(["from", "to", "before", "at"]), at);
            ({ from, to, before, at: position } = value);
        } else fault(at, "A row is [from, to] or {from, to, before?, at?}");
        string(from, `${at}.from`, true);
        string(to, `${at}.to`);
        if (from.includes(OPEN) || from.includes(CLOSE))
            fault(`${at}.from`, "Literal markers enclose codes and cannot be row sources");
        if (from !== " " && chars(from).some((c) => WHITE.test(c)))
            fault(`${at}.from`, "Whitespace is stated by separator");
        if (!to && !allowEmpty && from !== " ")
            fault(`${at}.to`, "An exact row must write a nonempty output");
        if (before !== undefined && !["vowel", "consonant"].includes(before))
            fault(`${at}.before`, "before is vowel or consonant");
        if (before && !vowels) fault(`${at}.before`, "before needs vowels");
        if (position !== undefined && !["start", "end", "line-start"].includes(position))
            fault(`${at}.at`, "at is start, end or line-start");
        return Object.freeze({ from, to, before, at: position, order, key: at });
    });
}
function indexRows(rows) {
    const index = new Map();
    for (const row of rows) {
        const first = chars(row.from)[0];
        if (!index.has(first)) index.set(first, []);
        index.get(first).push(row);
    }
    for (const group of index.values())
        group.sort(
            (a, b) =>
                length(b.from) - length(a.from) ||
                Number(Boolean(b.before || b.at)) - Number(Boolean(a.before || a.at)) ||
                a.order - b.order,
        );
    return index;
}
function readings(rows) {
    const seen = new Set();
    const out = new Map();
    for (const row of rows) {
        if (!row.to || seen.has(row.to)) continue;
        seen.add(row.to);
        const first = chars(row.to)[0];
        if (!out.has(first)) out.set(first, []);
        out.get(first).push(row);
    }
    for (const group of out.values()) group.sort((a, b) => length(b.to) - length(a.to));
    return out;
}
function tier(rows, shared = [], prefix = []) {
    return { rows, index: indexRows(rows), readings: readings([...prefix, ...rows, ...shared]) };
}

/**
 * Validate and compile an encoding note with a separately resolved font code table.
 * @param {any} data Encoding-note data with mappings and executable rules.
 * @param {{codes?: Record<string,string>, name?: string}} [options] Font glyph codes and canonical note identity.
 */
export function compileEncoding(data, options = {}) {
    const program = templateProgram(data, options, fault);
    try {
        return compileRows(program.definition, program.metadata);
    } catch (error) {
        const row = error instanceof EncodingError && error.key?.match(/^rows\.(\d+)(?:\.|$)/u);
        if (row) error.key = program.rowKeys[Number(row[1])];
        throw error;
    }
}

/**
 * Compile the internal row program, including isolated execution conformance fixtures.
 * Application inputs go through compileEncoding's closed note schema.
 * @internal
 * @param {any} definition Fully resolved internal rows.
 * @param {Partial<ReturnType<typeof templateProgram>["metadata"]>} [metadata] Validated note metadata, supplied by the template compiler.
 */
export function compileRows(definition, metadata = {}) {
    if (!object(definition)) fault("", "An encoding must be an object");
    keys(definition, TOP_KEYS, "");
    const d = definition;
    if (typeof d.name !== "string" || !SLUG.test(d.name))
        fault("name", "name must be a lowercase slug");
    if (d.kind !== undefined && d.kind !== "encoding")
        fault("kind", "Only an encoding can encode text; codes belong inside its codes rows");
    if (!Array.isArray(d.fonts) || !d.fonts.length)
        fault("fonts", "fonts must name at least one face");
    for (const [i, font] of d.fonts.entries())
        if (
            typeof font !== "string" ||
            !SLUG.test(font) ||
            ["mono", "serif", "sans"].includes(font) ||
            d.fonts.indexOf(font) !== i
        )
            fault(`fonts.${i}`, "A face must be a unique font slug");
    if (!Array.isArray(d.accepts))
        fault("accepts", "accepts must be a list of characters or ranges");
    const accepted = new Set();
    for (const [i, item] of d.accepts.entries()) {
        string(item, `accepts.${i}`, true);
        const c = chars(item);
        if (c.length === 1) accepted.add(item);
        else if (c.length === 3 && c[1] === "-" && c[0].codePointAt(0) < c[2].codePointAt(0)) {
            for (let point = c[0].codePointAt(0); point <= c[2].codePointAt(0); point++) {
                if (point >= 0xd800 && point <= 0xdfff)
                    fault(`accepts.${i}`, "A range cannot contain surrogates");
                accepted.add(String.fromCodePoint(point));
            }
        } else
            fault(
                `accepts.${i}`,
                "An accepted item is one character or an ascending range such as a-z",
            );
    }
    string(d.separator, "separator");
    if (/[\t\n\r⟦⟧]/u.test(d.separator))
        fault("separator", "separator cannot contain a line break or literal marker");
    const vowels = d.vowels ?? "";
    string(vowels, "vowels");
    if (d.roundTrip !== undefined && !["exact", "canonical"].includes(d.roundTrip))
        fault("roundTrip", "roundTrip is exact or canonical");
    if (d.groupCase !== undefined && d.groupCase !== "initial")
        fault("groupCase", "groupCase is initial");
    const controls = d.controls ?? {};
    if (!object(controls)) fault("controls", "controls must be an object");
    keys(controls, CONTROL_KEYS, "controls");
    for (const [key, value] of Object.entries(controls)) string(value, `controls.${key}`, true);
    if (controls.literalOpen !== undefined && controls.literalOpen !== OPEN_MARK)
        fault("controls.literalOpen", "literalOpen must be U+E0112");
    if (controls.literalClose !== undefined && controls.literalClose !== CLOSE_MARK)
        fault("controls.literalClose", "literalClose must be U+E0113");
    if (controls.literalEscape !== undefined && controls.literalEscape !== ESCAPE_MARK)
        fault("controls.literalEscape", "literalEscape must be U+E0115");
    const sharedRows = rows(d.rows, "rows", vowels, d.roundTrip === "canonical");
    const codeRows = rows(d.codes ?? [], "codes", "", false);
    const separatorRow = { from: " ", to: d.separator, key: "separator" };
    const prefix = d.separator ? [separatorRow] : [];
    const controlRows = [];
    if (controls.verseStanza) controlRows.push({ from: "\n\n", to: controls.verseStanza });
    if (controls.verseCanto) controlRows.push({ from: "***\n", to: controls.verseCanto });
    const shared = tier(sharedRows, [], [...prefix, ...controlRows]);
    const faces = new Map();
    if (d.faces !== undefined && !object(d.faces))
        fault("faces", "faces must map face slugs to rows");
    for (const [font, face] of Object.entries(d.faces ?? {})) {
        if (!d.fonts.includes(font)) fault(`faces.${font}`, "Face must be listed in fonts");
        if (!object(face)) fault(`faces.${font}`, "A face is {rows: [...]} ");
        keys(face, new Set(["rows"]), `faces.${font}`);
        faces.set(
            font,
            tier(
                rows(face.rows ?? [], `faces.${font}.rows`, vowels, d.roundTrip === "canonical"),
                sharedRows,
                [...prefix, ...controlRows],
            ),
        );
    }
    if (d.roundTrip !== "canonical") {
        for (const group of [
            sharedRows,
            ...[...faces.values()].map((face) => [...sharedRows, ...face.rows]),
        ]) {
            const outputs = new Map(prefix.map((row) => [row.to, row]));
            for (const row of group) {
                if (outputs.has(row.to) && outputs.get(row.to).from !== row.from)
                    fault(
                        row.key,
                        `Output duplicates ${outputs.get(row.to).key}; exact encodings need distinct outputs`,
                    );
                if (!outputs.has(row.to)) outputs.set(row.to, row);
            }
        }
    }
    const result = {
        name: d.name,
        fonts: Object.freeze([...d.fonts]),
        separator: d.separator,
        separatorRow,
        vowels: new Set(chars(vowels)),
        accepted,
        controls: Object.freeze({ ...controls }),
        groupCase: d.groupCase,
        roundTrip: d.roundTrip ?? "exact",
        shared,
        faces,
        codes: tier(codeRows),
        ...metadata,
    };
    compiled.add(result);
    return Object.freeze(result);
}
function tiers(enc, font) {
    if (!compiled.has(enc))
        throw new EncodingError("Compile the encoding definition before using it");
    font ??= enc.fonts[0];
    if (!enc.fonts.includes(font))
        throw new EncodingError(`\`${enc.name}\` serves ${enc.fonts.join(", ")}, not \`${font}\``, {
            key: "font",
        });
    return enc.faces.has(font) ? [enc.faces.get(font), enc.shared] : [enc.shared];
}
function boundary(char) {
    // Python str.isspace also includes the four information separators.
    return SPACE.test(char) || /[\u001C-\u001F]/u.test(char) || BOUNDARY.test(char);
}
function beforeHolds(condition, char, vowels) {
    return Boolean(
        char && (condition === "vowel" ? vowels.has(char) : !vowels.has(char) && LETTER.test(char)),
    );
}
function holds(row, text, start, end, vowels) {
    if (row.before && !beforeHolds(row.before, firstAt(text, end), vowels)) return false;
    if (row.at === "line-start") {
        let slash = text.lastIndexOf("/", start - 1);
        while (slash >= 0 && (/\\+$/.exec(text.slice(0, slash))?.[0].length ?? 0) % 2)
            slash = text.lastIndexOf("/", slash - 1);
        const prefix = text.slice(Math.max(text.lastIndexOf("\n", start - 1), slash) + 1, start);
        if (prefix.replaceAll("^", "")) return false;
    }
    if (row.at === "start" && start > 0 && !boundary(previousAt(text, start))) return false;
    if (row.at === "end" && end < text.length && !boundary(firstAt(text, end))) return false;
    return true;
}
function rowAt(enc, groups, text, at, bound = text.length) {
    const first = firstAt(text, at);
    for (const group of groups)
        for (const row of group.index.get(first) ?? [])
            if (
                at + row.from.length <= bound &&
                text.startsWith(row.from, at) &&
                holds(row, text, at, at + row.from.length, enc.vowels)
            )
                return row;
    return null;
}
function refused(enc, text, at, known, decoding = false) {
    const char = firstAt(text, at);
    const shown = `${JSON.stringify(char)} (U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`;
    textError(
        text,
        at,
        known ?
            `No row of the \`${enc.name}\` encoding ${decoding ? "writes" : "matches"} ${shown} here`
        :   `${shown} is ${decoding ? "written by no row of" : "not in"} the \`${enc.name}\` encoding`,
    );
}
function span(text, at, opener, closer) {
    let cursor = at + opener.length;
    while (cursor < text.length) {
        if (opener === OPEN_MARK && text.startsWith(ESCAPE_MARK, cursor)) {
            const following = firstAt(text, cursor + ESCAPE_MARK.length);
            if (![OPEN_MARK, CLOSE_MARK, ESCAPE_MARK].includes(following))
                textError(
                    text,
                    cursor,
                    "A literal escape must quote its open, close or escape control",
                );
            cursor += ESCAPE_MARK.length + following.length;
            continue;
        }
        if (text.startsWith(closer, cursor)) return cursor;
        if (text.startsWith(opener, cursor))
            textError(text, cursor, "A literal span opens inside another");
        cursor += firstAt(text, cursor).length;
    }
    textError(text, at, "A literal span opens with no closing marker");
}
function unicodeCode(code) {
    if (!/^U\+[0-9A-F]{4,6}$/.test(code)) return null;
    const value = Number.parseInt(code.slice(2), 16);
    return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ?
            String.fromCodePoint(value)
        :   null;
}
function piece(from, to, start, end, row) {
    return { from, to, start, end, row };
}
function codePieces(enc, text, start, end) {
    const out = [];
    let at = start;
    while (at < end) {
        const first = firstAt(text, at);
        if (WHITE.test(first)) {
            let stop = at + first.length;
            while (stop < end && WHITE.test(firstAt(text, stop)))
                stop += firstAt(text, stop).length;
            out.push(piece(text.slice(at, stop), "", at, stop, null));
            at = stop;
            continue;
        }
        if (text.startsWith("U+", at)) {
            let stop = at + 2;
            while (stop < end && /^[\p{L}\p{N}+]$/u.test(firstAt(text, stop)))
                stop += firstAt(text, stop).length;
            const code = text.slice(at, stop);
            const target = unicodeCode(code);
            if (target === null)
                textError(
                    text,
                    at,
                    `\`${code}\` is not a Unicode scalar code (U+0000 to U+10FFFF)`,
                );
            out.push(piece(code, target, at, stop, null));
            at = stop;
            continue;
        }
        const row = rowAt(enc, [enc.codes], text, at);
        if (row) {
            out.push(piece(row.from, row.to, at, at + row.from.length, row));
            at += row.from.length;
            continue;
        }
        let begin = at;
        if (wordy(first))
            while (begin > start && wordy(previousAt(text, begin)))
                begin -= previousAt(text, begin).length;
        textError(text, begin, "This code is not defined by the encoding");
    }
    return out;
}

function checkGroupCase(enc, groups, text, at, bound) {
    if (enc.groupCase === "initial") {
        const invalid = groups
            .flatMap((group) => group.rows)
            .map((row) => ({ row, value: pointSlice(text, at, length(row.from)) }))
            .find(
                ({ row, value }) =>
                    at + row.from.length <= bound &&
                    length(row.from) > 1 &&
                    /^\p{L}+$/u.test(row.from) &&
                    value.toLowerCase() === row.from.toLowerCase() &&
                    value !== row.from.toLowerCase() &&
                    value !==
                        chars(row.from.toLowerCase())[0].toUpperCase() +
                            chars(row.from.toLowerCase()).slice(1).join(""),
            );
        if (invalid)
            textError(
                text,
                at,
                `\`${invalid.value}\` is an illegal group spelling; use lowercase or initial capital`,
            );
    }
}

/**
 * Encode into matched pieces; start/end are offsets in the original UTF-16 input.
 * Each piece has from, to, start, end and its matched row (null for literal syntax).
 * @param {ReturnType<typeof compileEncoding>} enc
 * @param {string} text
 * @param {{font?: string, verse?: boolean, start?: number, end?: number}} [options]
 */
function encodeRawPieces(enc, text, { font, verse = false, start = 0, end = text.length } = {}) {
    const groups = tiers(enc, font);
    if (typeof text !== "string") throw new EncodingError("Text must be a string");
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > text.length
    )
        throw new EncodingError("Encoding bounds must be ordered UTF-16 offsets within the input", {
            key: "start",
        });
    const bound = end;
    const out = [];
    let at = start;
    while (at < bound) {
        const first = firstAt(text, at);
        if (first === OPEN) {
            const close = span(text.slice(0, bound), at, OPEN, CLOSE);
            out.push(
                piece(OPEN, OPEN_MARK, at, at + 1, null),
                ...codePieces(enc, text, at + 1, close).map((one) => ({
                    ...one,
                    to: chars(one.to)
                        .map((char) =>
                            [OPEN_MARK, CLOSE_MARK, ESCAPE_MARK].includes(char) ?
                                ESCAPE_MARK + char
                            :   char,
                        )
                        .join(""),
                })),
                piece(CLOSE, CLOSE_MARK, close, close + 1, null),
            );
            at = close + 1;
            continue;
        }
        if (first === CLOSE) textError(text, at, "A closing literal marker has no opening marker");
        const canto = cantoEnd(enc, text, at, bound);
        if (canto !== undefined) {
            const end = canto;
            out.push(piece(text.slice(at, end), enc.controls.verseCanto, at, end, null));
            at = end;
            if (verse) {
                while (at < bound && /[ \t\r\n]/.test(text[at])) at++;
            }
            continue;
        }
        if (verse && /[\r\n]/.test(first) && enc.controls.verseStanza) {
            let end = at;
            while (end < bound && /[ \t\r\n]/.test(text[end])) end++;
            const run = text.slice(at, end).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
            const row =
                run.split("\n").length === 2 ?
                    rowAt(enc, groups, "/", 0)
                :   { to: enc.controls.verseStanza };
            if (!row) textError(text, at, "The encoding has no verse line row");
            out.push(piece(text.slice(at, end), row.to, at, end, row));
            at = end;
            continue;
        }
        if (WHITE.test(first)) {
            let end = at + first.length;
            while (end < bound && WHITE.test(firstAt(text, end))) end += firstAt(text, end).length;
            const following = end < text.length ? rowAt(enc, groups, text, end) : null;
            const row =
                /[\r\n]/.test(text.slice(at, end)) && following?.at === "line-start" ?
                    rowAt(enc, groups, "/", 0)
                :   enc.separatorRow;
            if (!row) textError(text, at, "The encoding has no line row");
            out.push(piece(text.slice(at, end), row.to, at, end, row));
            at = end;
            continue;
        }
        if (!enc.template) checkGroupCase(enc, groups, text, at, bound);
        const row = enc.accepted.has(first) ? rowAt(enc, groups, text, at, bound) : null;
        if (!row)
            refused(
                enc,
                text,
                at,
                enc.accepted.has(first) && groups.some((group) => group.index.has(first)),
            );
        out.push(piece(row.from, row.to, at, at + row.from.length, row));
        at += row.from.length;
    }
    return out;
}

function sourceProjection(enc, text, options) {
    if (typeof text !== "string") throw new EncodingError("Text must be a string");
    const start = options.start ?? 0,
        end = options.end ?? text.length;
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > text.length
    )
        throw new EncodingError("Encoding bounds must be ordered UTF-16 offsets within the input", {
            key: "start",
        });
    if (!enc.template) return { normalized: text, sourceAt: null, begin: start, bound: end };
    // Each canonical combining sequence has a source-boundary projection. Both
    // diagnostics and pieces therefore refer to authored UTF-16, even after NFC.
    let projection = templateSources.get(enc);
    if (projection?.text !== text) {
        let normalized = "";
        const sourceAt = [0],
            normalizedAt = new Map([[0, 0]]);
        for (const match of text.matchAll(
            /(?:[\u1100-\u1112][\u1161-\u1175][\u11A8-\u11C2]?|[\uAC00-\uD7A3][\u11A8-\u11C2]?|[^\p{M}])\p{M}*|\p{M}+/gu,
        )) {
            const source = match[0],
                from = match.index,
                value = source.normalize("NFC");
            normalizedAt.set(from, normalized.length);
            for (let i = 0; i < value.length; i++)
                sourceAt[normalized.length + i] = source === value ? from + i : from;
            normalized += value;
            sourceAt[normalized.length] = from + source.length;
            normalizedAt.set(from + source.length, normalized.length);
        }
        projection = { text, normalized, sourceAt, normalizedAt };
        templateSources.set(enc, projection);
    }
    const { normalized, sourceAt, normalizedAt } = projection;
    if (!normalizedAt.has(start) || !normalizedAt.has(end))
        textError(
            text,
            !normalizedAt.has(start) ? start : end,
            "Encoding bounds cannot split a combining sequence",
        );
    const begin = normalizedAt.get(start),
        bound = normalizedAt.get(end);
    return { normalized, sourceAt, begin, bound };
}
function cantoEnd(enc, text, at, bound) {
    const source = "***";
    return (
            enc.controls.verseCanto &&
                at + source.length <= bound &&
                text.startsWith(source, at) &&
                !text
                    .slice(
                        Math.max(text.lastIndexOf("\n", at - 1), text.lastIndexOf("\r", at - 1)) +
                            1,
                        at,
                    )
                    .trim() &&
                !text
                    .slice(at + source.length, bound)
                    .split(/[\r\n]/, 1)[0]
                    .trim()
        ) ?
            at + source.length
        :   undefined;
}
function sourceDetails(enc, text, options) {
    const groups = tiers(enc, options.font);
    const projection = sourceProjection(enc, text, options);
    const { normalized, sourceAt, begin, bound } = projection;
    try {
        for (let at = begin; at < bound;) {
            const char = firstAt(normalized, at);
            if (char === OPEN) {
                const close = span(normalized.slice(0, bound), at, OPEN, CLOSE);
                codePieces(enc, normalized, at + OPEN.length, close);
                at = close + CLOSE.length;
                continue;
            }
            if (char === CLOSE)
                textError(normalized, at, "A closing literal marker has no opening marker");
            const canto = cantoEnd(enc, normalized, at, bound);
            if (canto !== undefined) {
                at = canto;
                continue;
            }
            const decomposed = char.normalize("NFD");
            if (enc.template?.diaeresis && decomposed.includes("\u0308"))
                textError(normalized, at, "Diaeresis is forbidden by the encoding");
            if (enc.template?.grave && decomposed.includes("\u0300"))
                textError(normalized, at, "Grave accents are forbidden by the encoding");
            if (!WHITE.test(char) && !enc.accepted.has(char)) refused(enc, normalized, at, false);
            if (char === "^" && !rowAt(enc, groups, normalized, at, bound))
                textError(normalized, at, "Indentation is allowed only at line start");
            at += char.length;
        }
        for (let at = begin; at < bound;) {
            if (normalized[at] === OPEN) {
                at = span(normalized.slice(0, bound), at, OPEN, CLOSE) + CLOSE.length;
                continue;
            }
            const canto = cantoEnd(enc, normalized, at, bound);
            if (canto !== undefined) {
                at = canto;
                continue;
            }
            checkGroupCase(enc, groups, normalized, at, bound);
            const row = rowAt(enc, groups, normalized, at, bound);
            at += row?.from.length ?? firstAt(normalized, at).length;
        }
        for (let at = begin; at < bound;) {
            if (normalized[at] === OPEN) {
                at = span(normalized.slice(0, bound), at, OPEN, CLOSE) + CLOSE.length;
                continue;
            }
            const canto = cantoEnd(enc, normalized, at, bound);
            if (canto !== undefined) {
                at = canto;
                continue;
            }
            const lookahead =
                enc.template ?
                    pointSlice(normalized.slice(0, bound), at, enc.template.maxVowelGroup)
                :   "";
            const lower = lookahead.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
            const group = enc.template?.vowelGroups.find((value) => lower.startsWith(value));
            if (group) {
                let cursor = at;
                for (let i = 0; i < [...group].length; i++) {
                    const vowel = firstAt(normalized, cursor);
                    if (i > 0 && enc.template.stress && vowel.normalize("NFD").includes("\u0301"))
                        textError(
                            normalized,
                            cursor,
                            "Stress belongs on the first vowel of an established vowel group",
                        );
                    cursor += vowel.length;
                }
                at = cursor;
            } else at += firstAt(normalized, at).length;
        }
    } catch (error) {
        if (error instanceof EncodingError && error.offset !== undefined && sourceAt)
            throw new EncodingError(error.message, {
                text,
                offset: sourceAt[error.offset],
                key: error.key,
            });
        throw error;
    }
    return projection;
}

/**
 * Validate Roman spelling and literal syntax without requiring ordinary mapping coverage.
 * Accepted words may instead have authoritative native writings in the language note.
 * @param {ReturnType<typeof compileEncoding>} enc - Compiled encoding and its font codes.
 * @param {string} text - Authored Roman source, normalized to NFC for template rules.
 * @param {{font?:string,start?:number,end?:number}} [options] - Face and authored UTF-16 bounds.
 * @returns {void} Throws EncodingError at the authored UTF-16 offset and code-point column.
 */
export function validateSource(enc, text, options = {}) {
    sourceDetails(enc, text, options);
}

/**
 * Encode matched pieces while preserving offsets into the original source.
 * @param {ReturnType<typeof compileEncoding>} enc - Compiled encoding note.
 * @param {string} text - Authored Roman source.
 * @param {{font?: string, verse?: boolean, start?: number, end?: number}} [options] - Source bounds and presentation.
 */
export function encodePieces(enc, text, options = {}) {
    if (!enc?.template) return encodeRawPieces(enc, text, options);
    const { normalized, sourceAt, begin, bound } = sourceDetails(enc, text, options);
    try {
        return encodeRawPieces(enc, normalized, { ...options, start: begin, end: bound }).map(
            (one) => ({
                ...one,
                from: text.slice(sourceAt[one.start], sourceAt[one.end]),
                start: sourceAt[one.start],
                end: sourceAt[one.end],
            }),
        );
    } catch (error) {
        if (error instanceof EncodingError && error.offset !== undefined)
            throw new EncodingError(error.message, {
                text,
                offset: sourceAt[error.offset],
                key: error.key,
            });
        throw error;
    }
}

/**
 * Encode text using exactly the rows of its compiled encoding. Unknown input is refused.
 * @param {ReturnType<typeof compileEncoding>} enc
 * @param {string} text
 * @param {{font?: string, verse?: boolean}} [options]
 * @returns {string}
 */
export function encodeText(enc, text, options = {}) {
    return encodePieces(enc, text, options)
        .map((piece) => piece.to)
        .join("");
}
function decodeCodes(enc, text, start, end) {
    let payload = "";
    for (let at = start; at < end;) {
        let char = firstAt(text, at);
        if (char === ESCAPE_MARK) {
            const escapedAt = at;
            at += ESCAPE_MARK.length;
            char = firstAt(text, at);
            if (at >= end || ![OPEN_MARK, CLOSE_MARK, ESCAPE_MARK].includes(char))
                textError(
                    text,
                    escapedAt,
                    "A literal escape must quote its open, close or escape control",
                );
        }
        if (!scalar(char)) textError(text, at, "A literal span contains a non-scalar surrogate");
        payload += char;
        at += char.length;
    }
    text = payload;
    let out = "";
    let at = 0;
    end = text.length;
    while (at < end) {
        const first = firstAt(text, at);
        const row = (enc.codes.readings.get(first) ?? []).find(
            (row) => at + row.to.length <= end && text.startsWith(row.to, at),
        );
        const code =
            row?.from ?? `U+${first.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
        if (wordy(chars(out).at(-1)) && wordy(chars(code)[0])) out += " ";
        out += code;
        at += row ? row.to.length : first.length;
    }
    return out;
}

/**
 * Decode by longest output match, with source positions on any unidentified scalar.
 * @param {ReturnType<typeof compileEncoding>} enc
 * @param {string} text
 * @param {{font?: string}} [options]
 * @returns {string}
 */
function decodeRawText(enc, text, { font } = {}) {
    const readings = tiers(enc, font)[0].readings;
    if (typeof text !== "string") throw new EncodingError("Text must be a string");
    let out = "";
    let at = 0;
    while (at < text.length) {
        if (text.startsWith(OPEN_MARK, at)) {
            const end = span(text, at, OPEN_MARK, CLOSE_MARK);
            out += OPEN + decodeCodes(enc, text, at + OPEN_MARK.length, end) + CLOSE;
            at = end + CLOSE_MARK.length;
            continue;
        }
        if (text.startsWith(CLOSE_MARK, at))
            textError(text, at, "The closing literal mark has no opening mark");
        const first = firstAt(text, at);
        const row = (readings.get(first) ?? []).find((row) => text.startsWith(row.to, at));
        if (!row) refused(enc, text, at, readings.has(first), true);
        out += row.from;
        at += row.to.length;
    }
    return out;
}

/**
 * Decode exact output or the conventional reading of an explicitly canonical note.
 * @param {ReturnType<typeof compileEncoding>} enc - Compiled encoding note.
 * @param {string} text - Native text with optional literal spans.
 * @param {{font?: string}} [options] - Selected encoding face.
 * @returns {string} Roman source, with literals kept between their visible markers.
 */
export function decodeText(enc, text, options = {}) {
    if (!enc?.template) return decodeRawText(enc, text, options);
    const readings = tiers(enc, options.font)[0].readings;
    if (typeof text !== "string") throw new EncodingError("Text must be a string");
    if (!templateReaders.has(enc)) {
        const root = { children: new Map(), row: undefined, rows: [] };
        const rows = new Set([...readings.values()].flat().concat(enc.shared.rows));
        for (const row of rows) {
            if (!row.to) continue;
            let node = root;
            for (const char of row.to) {
                if (!node.children.has(char))
                    node.children.set(char, { children: new Map(), row: undefined, rows: [] });
                node = node.children.get(char);
            }
            node.row ??= row;
            node.rows.push(row);
        }
        templateReaders.set(enc, root);
    }
    const reader = templateReaders.get(enc);
    // Right-to-left segmentation can look past a greedy dead end without
    // recursion or copies of the remaining passage at each candidate.
    const starts = [];
    for (let at = 0; at < text.length; at += firstAt(text, at).length) starts.push(at);
    const paths = new Map([[text.length, { from: "", next: text.length }]]);
    let failedContext = text.length;
    for (let i = starts.length - 1; i >= 0; i--) {
        const at = starts[i];
        if (text.startsWith(OPEN_MARK, at)) {
            try {
                const close = span(text, at, OPEN_MARK, CLOSE_MARK),
                    next = close + CLOSE_MARK.length;
                if (paths.has(next))
                    paths.set(at, {
                        from: OPEN + decodeCodes(enc, text, at + OPEN_MARK.length, close) + CLOSE,
                        next,
                    });
            } catch (error) {
                if (!(error instanceof EncodingError)) throw error;
            }
            continue;
        }
        let cursor = reader,
            next = at;
        while (next < text.length) {
            const char = firstAt(text, next);
            cursor = cursor.children.get(char);
            if (!cursor) break;
            next += char.length;
            if (!cursor.row || !paths.has(next)) continue;
            const following = firstAt(paths.get(next).from, 0);
            const preferred = cursor.rows.find(
                (row) => !row.before || beforeHolds(row.before, following, enc.vowels),
            );
            // Canonical source can omit the vowel or marker that selected a form.
            // Prefer applicable aliases, then retain the first authored reading.
            const row = preferred ?? (enc.roundTrip === "canonical" ? cursor.row : undefined);
            if (!row) {
                failedContext = Math.min(failedContext, at);
                continue;
            }
            paths.set(at, { from: row.from, next });
        }
    }
    if (!paths.has(0)) {
        // A greedy dead end is not necessarily the first unsupported scalar.
        // Reach every complete prefix with the same trie before locating refusal.
        const reachable = new Set([0]);
        let furthest = 0;
        for (const at of starts) {
            if (!reachable.has(at)) continue;
            if (text.startsWith(OPEN_MARK, at)) {
                const close = span(text, at, OPEN_MARK, CLOSE_MARK);
                decodeCodes(enc, text, at + OPEN_MARK.length, close);
                const next = close + CLOSE_MARK.length;
                reachable.add(next);
                furthest = Math.max(furthest, next);
                continue;
            }
            let cursor = reader,
                next = at;
            while (next < text.length) {
                const char = firstAt(text, next);
                cursor = cursor.children.get(char);
                if (!cursor) break;
                next += char.length;
                if (cursor.row) {
                    reachable.add(next);
                    furthest = Math.max(furthest, next);
                }
            }
        }
        if (furthest < text.length) {
            if (text.startsWith(CLOSE_MARK, furthest))
                textError(text, furthest, "The closing literal mark has no opening mark");
            refused(enc, text, furthest, reader.children.has(firstAt(text, furthest)), true);
        }
        textError(
            text,
            failedContext < text.length ? failedContext : 0,
            "Native output does not satisfy the encoding's contextual mappings",
        );
    }
    const out = [];
    for (let at = 0; at < text.length;) {
        const step = paths.get(at);
        out.push(step.from);
        at = step.next;
    }
    return out.join("");
}
