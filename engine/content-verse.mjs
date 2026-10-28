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
import { WIKILINK } from "./wikilink-syntax.mjs";
import { pageOpenings } from "./heading-attributes.mjs";
import { blockTokens } from "./markdown-blocks.mjs";
import { slugify } from "./content-slug.mjs";
import { spanMarkdownPlugin } from "./content-spans.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

const lineParser = new MarkdownIt({ html: true }).use(spanMarkdownPlugin);

/**
 * Read one verse line. Marker offsets are zero-based in the authored line;
 * textColumn is the one-based column of its first non-space character.
 * Periods inside a span set indentation only when that span starts the line.
 */
export function verseLine(line) {
    const source = String(line ?? "");
    const spaces = /^ */.exec(source)[0].length;
    const written = source.slice(spaces).trimEnd();
    let markerStart = spaces;
    let markerLength = /^\.+/.exec(written)?.[0].length ?? 0;
    if (!markerLength) {
        const span = leadingSpan(written);
        const html = /^<span\b[^>]*>/.exec(written);
        const prefix =
            span ? 1
            : html ? html[0].length
            : 0;
        if (prefix) {
            markerStart += prefix;
            markerLength = /^\.+/.exec(written.slice(prefix))?.[0].length ?? 0;
        }
    }
    const start = markerStart - spaces;
    return {
        text: written.slice(0, start) + written.slice(start + markerLength),
        level: markerLength,
        markerStart,
        markerLength,
        textColumn: spaces + 1,
    };
}

/** The structural first span of a line, with its source ranges and keys. */
function leadingSpan(text) {
    if (!text.startsWith("[")) return undefined;
    const tokens = lineParser.parseInline(text, {})[0]?.children ?? [];
    return tokens.find((token) => token.meta?.span && token.meta.start === 0);
}

/** HTML indentation attributes; large levels retain their full authored depth. */
function indentStyle(level) {
    return level > 8 ? ` style="--verse-indent: ${level * 1.25}em"` : "";
}

/** A verse is inline Markdown even when it starts with block syntax. */
export function inlineVerse(text) {
    return String(text)
        .replace(/^(#{1,6}\s|>\s|[-+*]\s|:{1,2}\s|`{3,}|~{3,}|-{3,}\s*$)/, "\\$1")
        .replace(/^(\d+)([.)])\s/, "$1\\$2 ");
}

/**
 * Whether text runs right to left: its first letter is in a right-to-left
 * block. A face's right-to-left code points sit in U+1E800–U+1EFFF.
 *
 * @param {string} text - Text, after any map.
 * @returns {boolean} Whether it starts right to left.
 */
export function rightToLeft(text) {
    const first = /[\p{L}\p{M}\p{Co}\p{Cn}]/u.exec(
        String(text)
            .replace(/<[^>]*>/g, "")
            .replace(/\{[^}]*\}/g, ""),
    );
    return Boolean(
        first &&
        /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u.test(
            first[0],
        ),
    );
}

/** The authored attributes of a verse fence. */
export const VERSE_KEYS = Object.freeze([
    "form",
    "scan",
    "lang",
    "font",
    "enc",
    "work",
    "dir",
    "data-pagefind-ignore",
]);

/** A canto separator, including the escaped form produced by a native run. */
export const STANZA_BREAK = /^(?:\\?\*){3}$/;

/** Read verse code fences; start/end are inclusive zero-based source lines.
 * @param {string} source - Authored Markdown.
 * @param {object} [options] - Whole-page validation choices.
 * @param {boolean} [options.checkWorks] - Whether to validate page-local versions.
 * @returns {{blocks: VerseBlock[], errors: VerseDiagnostic[]}} Located fences and findings.
 */
export function scanVerse(source, { checkWorks = true } = {}) {
    const lines = String(source ?? "").split("\n"),
        blocks = [],
        errors = [];
    const literalLines = new Set();
    for (const token of blockTokens(source)) {
        if (!token.map || !["blockquote_open", "html_block"].includes(token.type)) continue;
        for (let line = token.map[0]; line < token.map[1]; line++) literalLines.add(line);
    }
    let opening = null;
    for (let i = 0; i < lines.length; i++) {
        if (literalLines.has(i)) continue;
        const match = /^ *(`{3,}|~{3,})(.*)$/.exec(lines[i]);
        if (opening) {
            if (
                match &&
                match[1][0] === opening.fence[0] &&
                match[1].length >= opening.fence.length &&
                !match[2].trim()
            ) {
                if (opening.name === "verse") {
                    const body = lines.slice(opening.start + 1, i).join("\n");
                    if (!body.trim())
                        errors.push({
                            line: opening.start + 1,
                            column: 1,
                            message: "verse block is empty",
                        });
                    for (let n = opening.start + 1; n < i; n++) {
                        const col = lines[n].indexOf("\t");
                        if (col >= 0)
                            errors.push({
                                line: n + 1,
                                column: col + 1,
                                message: "tabs are not allowed in verse",
                            });
                    }
                    const block = { ...opening, end: i, body };
                    block.model = parseVerse(body);
                    const bodyOffset = lines.slice(0, opening.start + 1).join("\n").length + 1;
                    for (const finding of block.model.errors) {
                        const prefix = String(source).slice(0, bodyOffset + finding.offset);
                        errors.push({
                            line: prefix.split("\n").length,
                            column: prefix.length - prefix.lastIndexOf("\n"),
                            message: finding.message,
                        });
                    }
                    blocks.push(block);
                }
                opening = null;
            }
            continue;
        }
        if (!match) continue;
        const info = match[2].trim();
        opening = {
            start: i,
            fence: match[1],
            name: info.split(/\s/)[0],
            attributes: {},
            id: "",
            classes: [],
            indent: /^ */.exec(lines[i])[0],
        };
        if (opening.name !== "verse") continue;
        const raw = info.slice(6).trim();
        const at = { line: i + 1, column: 1 };
        if (raw && !/^\{[^}\n]*\}$/.test(raw)) {
            errors.push({ ...at, message: "verse attributes need {…} braces" });
            continue;
        }
        const parsed = parseExtensionAttributes(raw ? raw.slice(1, -1) : "");
        opening.id = parsed.id;
        opening.classes = parsed.classes;
        opening.attributes = parsed.values;
        for (const message of [...parsed.problems, ...refusedAttributes(parsed.values)])
            errors.push({ ...at, message });
        for (const [key, value] of Object.entries(parsed.values)) {
            if (key === "work" && !value.trim())
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key),
                    message: "work= needs a nonempty page-local key",
                });
            if (!VERSE_KEYS.includes(key))
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key),
                    message: `${key}= is not a verse attribute`,
                });
        }
    }
    if (opening?.name === "verse")
        errors.push({
            line: opening.start + 1,
            column: 1,
            message: "verse block needs a closing code fence",
        });
    if (checkWorks) {
        const openings = [...pageOpenings(source).keys()];
        const pages = new Map();
        for (const block of blocks) {
            const page = openings.findLast((line) => line <= block.start) ?? -1;
            if (!pages.has(page)) pages.set(page, []);
            pages.get(page).push(block);
        }
        for (const page of pages.values()) errors.push(...workShapeFindings(page));
    }
    errors.sort((a, b) => a.line - b.line || a.column - b.column);
    return { blocks, errors };
}

/**
 * The 1-based column of `key=`, or of a class or id token, in an opening line.
 *
 * @param {string} opening - The fence's opening line.
 * @param {string} key - The key, or a `.class` or `#id` token.
 * @returns {number} Its column, or the brace's when it is not found.
 */
function keyColumn(opening, key) {
    const brace = opening.indexOf("{");
    const token = /^[.#]/.test(key) ? key : `${key}=`;
    const at = opening
        .slice(brace)
        .search(new RegExp(`(?<=[{\\s])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    return (at < 0 ? brace : brace + at) + 1;
}

/** Source ranges whose slash characters belong to inline syntax. */
function syntaxRanges(source) {
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
        } else if (char === "<") past = source.indexOf(">", at + 1) + 1;
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

/**
 * A logical line with its authored UTF-16 coordinates.
 * @typedef {object} VerseLine
 * @property {string} text - Inline Markdown in this presentation.
 * @property {number} level - Leading-period indentation depth.
 * @property {number} from - First authored offset, including indentation.
 * @property {number} to - Offset at the line ending.
 * @property {number[]} offsets - Source offset for each UTF-16 text unit.
 * @property {string} [romanText] - Roman text paired with an encoded line.
 */

/**
 * A stanza's logical lines and authored bounds.
 * @typedef {object} VerseStanza
 * @property {VerseLine[]} lines - Lines in reading order.
 * @property {number} from - First authored offset.
 * @property {number} to - Offset at the stanza ending.
 */

/**
 * @typedef {VerseStanza & {canto: number, stanza: number, label: string, cantoBreak?: false}} VerseTextGroup
 * @typedef {{cantoBreak: true, from: number, to: number, text?: string}} VerseCantoBreak
 * @typedef {{kind: "line"|"stanza"|"canto", sourceOffset: number}} VerseBoundary
 * @typedef {{offset: number, message: string}} VerseFinding
 */

/**
 * Shared authored verse structure and source locations.
 * @typedef {object} VerseModel
 * @property {Array<{stanzas: VerseStanza[]}>} cantos - Cantos in reading order.
 * @property {Array<VerseTextGroup|VerseCantoBreak>} groups - Stanzas and canto breaks.
 * @property {VerseBoundary[]} boundaries - Explicit authored boundaries.
 * @property {Array<[number, number]>} layout - Source ranges omitted from encoded letters.
 * @property {VerseFinding[]} errors - Findings relative to the fence body.
 */

/**
 * An authored verse fence with its parsed logical structure.
 * @typedef {object} VerseBlock
 * @property {number} start - Opening fence's zero-based source line.
 * @property {number} end - Closing fence's zero-based source line.
 * @property {string} fence - Authored fence delimiter.
 * @property {"verse"} name - Fence language.
 * @property {Record<string, string>} attributes - Authored attribute values.
 * @property {string} id - Authored anchor, or the empty string.
 * @property {string[]} classes - Authored presentation classes.
 * @property {string} indent - Opening fence's leading spaces.
 * @property {string} body - Authored fence body.
 * @property {VerseModel} model - Logical structure relative to the body.
 */

/** @typedef {{line: number, column: number, message: string}} VerseDiagnostic */

/**
 * An encoded verse's shared display model and native-cell presentation.
 * @typedef {object} VersePresentation
 * @property {VerseModel} model - Logical structure with paired line text.
 * @property {string[]} classes - Native script and font classes.
 * @property {Record<string, string>} attributes - Native language, direction and search attributes.
 */

/**
 * Parse logical verse lines, stanzas and cantos without losing authored offsets.
 * Offsets are UTF-16 positions relative to body. Delimiters and indentation are
 * layout ranges; source newlines inside a logical line contribute one space.
 * @param {string} body - Authored fence body.
 * @returns {VerseModel} The shared structure with offsets relative to the body.
 */
export function parseVerse(body) {
    const source = String(body ?? "");
    const groups = [],
        boundaries = [],
        layout = [],
        errors = [];
    const cantos = [{ stanzas: [] }];
    const protectedRanges = syntaxRanges(source);
    const spans = (lineParser.parseInline(source, {})[0]?.children ?? [])
        .filter((token) => token.meta?.span)
        .map((token) => ({
            start: token.meta.start,
            end: token.meta.end,
            contentEnd: token.meta.start + 1 + token.meta.text.length,
        }));
    let protectedIndex = 0;
    let text = "",
        offsets = [],
        from = 0,
        level = 0,
        lines = [];
    let pendingBreak;
    const append = (value, at) => {
        text += value;
        for (let index = 0; index < value.length; index++) offsets.push(at + index);
    };
    const finishLine = (at) => {
        const trimmed = text.trimEnd();
        if (trimmed.trim()) {
            let lineText = trimmed,
                lineOffsets = offsets.slice(0, trimmed.length);
            for (const span of spans
                .filter((span) => span.start < from && span.contentEnd >= from)
                .sort((a, b) => b.start - a.start)) {
                lineText = "[" + lineText;
                lineOffsets.unshift(span.start);
            }
            for (const span of spans
                .filter((span) => span.start < at && span.contentEnd >= at)
                .sort((a, b) => b.start - a.start)) {
                const suffix = source.slice(span.contentEnd, span.end);
                lineText += suffix;
                for (let index = 0; index < suffix.length; index++)
                    lineOffsets.push(span.contentEnd + index);
            }
            const repeatedIds = spans
                .filter((span) => span.start < from && span.contentEnd >= from)
                .flatMap((span) => {
                    const raw = source.slice(span.contentEnd + 2, span.end - 1);
                    return [...raw.matchAll(/(?:[^\s"]+|"(?:\\.|[^"\\])*")+/g)]
                        .filter((match) => match[0].startsWith("#"))
                        .map((match) => [
                            span.contentEnd + 2 + match.index,
                            span.contentEnd + 2 + match.index + match[0].length,
                        ]);
                });
            if (repeatedIds.length) {
                const kept = lineOffsets
                    .map((offset, index) => ({ offset, char: lineText[index] }))
                    .filter(
                        ({ offset }) =>
                            !repeatedIds.some(([first, past]) => offset >= first && offset < past),
                    );
                lineText = kept.map(({ char }) => char).join("");
                lineOffsets = kept.map(({ offset }) => offset);
            }
            lines.push({ text: lineText, level, from, to: at, offsets: lineOffsets });
        }
        text = "";
        offsets = [];
        level = 0;
        from = at;
    };
    const finishStanza = (at) => {
        finishLine(at);
        if (lines.length) {
            const stanza = { lines, from: lines[0].from, to: at };
            cantos.at(-1).stanzas.push(stanza);
            groups.push({
                ...stanza,
                canto: cantos.length,
                stanza: cantos.at(-1).stanzas.length,
                label: "",
            });
            lines = [];
        }
    };
    const event = (kind, at, past) => {
        if (kind === "line") finishLine(at);
        else finishStanza(at);
        layout.push([at, past]);
        boundaries.push({ kind, sourceOffset: at });
        from = past;
    };
    for (let at = 0; at < source.length;) {
        const lineStart = at === 0 || /[\r\n]/.test(source[at - 1]);
        if (lineStart) {
            const physical = /^[^\r\n]*/.exec(source.slice(at))[0];
            const newline = /^(?:\r\n|\r|\n)/.exec(source.slice(at + physical.length))?.[0] ?? "";
            if (!physical.trim()) {
                event("stanza", at, at + physical.length + newline.length);
                at += physical.length + newline.length;
                continue;
            }
            if (STANZA_BREAK.test(physical.trim())) {
                event("canto", at, at + physical.length + newline.length);
                if (!cantos.at(-1).stanzas.length)
                    errors.push({
                        offset: at,
                        message: "a canto break needs a stanza before and after it",
                    });
                else {
                    groups.push({ cantoBreak: true, from: at, to: at + physical.length });
                    cantos.push({ stanzas: [] });
                }
                pendingBreak = at;
                at += physical.length + newline.length;
                continue;
            }
        }
        while (protectedRanges[protectedIndex]?.[1] <= at) protectedIndex++;
        const protectedRange = protectedRanges[protectedIndex];
        const protectedAt = protectedRange && protectedRange[0] <= at;
        if (!text && !/\s/.test(source[at])) {
            if (!level) from = at;
            const remaining = source.slice(at);
            const reading = verseLine(remaining.split(/\r?\n/)[0]);
            if (reading.markerLength) {
                level = reading.level;
                const first = at + reading.markerStart;
                layout.push([first, first + reading.markerLength]);
                // A leading span keeps its brackets and attributes around the indented text.
                if (reading.markerStart) append(source.slice(at, first), at);
                at = first + reading.markerLength;
                continue;
            }
        }
        if (!protectedAt && source[at] === "\\" && at + 1 < source.length) {
            append(source.slice(at, at + 2), at);
            at += 2;
            continue;
        }
        if (!protectedAt && source[at] === "/") {
            const length = source[at + 1] === "/" ? 2 : 1;
            event(length === 2 ? "stanza" : "line", at, at + length);
            at += length;
            continue;
        }
        if (/[\r\n]/.test(source[at])) {
            const length = source[at] === "\r" && source[at + 1] === "\n" ? 2 : 1;
            if (text && !/\s$/.test(text)) append(" ", at);
            at += length;
            while (source[at] === " ") at++;
            continue;
        }
        if (!text && source[at] === " ") {
            at++;
            continue;
        }
        append(source[at], at);
        at++;
    }
    finishStanza(source.length);
    if (pendingBreak !== undefined && !cantos.at(-1).stanzas.length) {
        if (!errors.some((error) => error.offset === pendingBreak))
            errors.push({
                offset: pendingBreak,
                message: "a canto break needs a stanza before and after it",
            });
        cantos.pop();
        if (groups.at(-1)?.cantoBreak) groups.pop();
    }
    const multi = cantos.length > 1;
    for (const group of groups)
        if (!group.cantoBreak)
            group.label = multi ? `${group.canto}:${group.stanza}` : String(group.stanza);
    return { cantos, groups, boundaries, layout, errors };
}

/** Logical line text for consumers that do not need source locations. */
export function verseLines(body) {
    return parseVerse(body).groups.flatMap((group) =>
        group.cantoBreak ? [] : group.lines.map((line) => line.text),
    );
}

/** Paragraph groups with separate canto gaps. */
export function verseStanzas(body) {
    return parseVerse(body).groups.map((group) =>
        group.cantoBreak ?
            [{ text: "***", level: 0 }]
        :   group.lines.map(({ text, level }) => ({ text, level })),
    );
}

/** Whether the projected group is a canto gap. */
export const stanzaSeparator = (group) => group.length === 1 && STANZA_BREAK.test(group[0].text);

/**
 * Compare the stanza counts of each version of a page-local work.
 * @param {VerseBlock[]} blocks - Fences belonging to one page.
 * @returns {VerseDiagnostic[]} Findings at affected opening fences.
 */
export function workShapeFindings(blocks) {
    const works = new Map(),
        errors = [];
    for (const block of blocks) {
        const key = block.attributes.work;
        if (key === undefined) continue;
        if (!works.has(key)) works.set(key, []);
        works.get(key).push(block);
    }
    for (const [key, versions] of works) {
        if (versions.length === 1) {
            errors.push({
                line: versions[0].start + 1,
                column: 1,
                message: `work=${key} has only one version`,
            });
            continue;
        }
        const first = versions[0];
        const shape = (block) => block.model.cantos.map((canto) => canto.stanzas.length);
        const expected = shape(first);
        const seen = new Set();
        for (const version of versions.slice(1)) {
            const actual = shape(version);
            if (actual.length !== expected.length) {
                const message = `work=${key}: ${expected.length} cantos in the first version and ${actual.length} in this version`;
                for (const block of [first, version]) {
                    const identity = `${block.start}:${message}`;
                    if (!seen.has(identity)) {
                        errors.push({ line: block.start + 1, column: 1, message });
                        seen.add(identity);
                    }
                }
            }
            for (let canto = 0; canto < Math.max(expected.length, actual.length); canto++) {
                if (expected[canto] === actual[canto]) continue;
                const message = `work=${key}, canto ${canto + 1}: ${expected[canto] ?? 0} stanzas in the first version and ${actual[canto] ?? 0} in this version`;
                for (const block of [first, version]) {
                    const identity = `${block.start}:${message}`;
                    if (!seen.has(identity)) {
                        errors.push({ line: block.start + 1, column: 1, message });
                        seen.add(identity);
                    }
                }
            }
        }
    }
    return errors;
}

/**
 * Render a shared verse structure while preserving surrounding inline Markdown.
 * @param {string} body - Authored fence body.
 * @param {object} [options] - Shared structure and display choices.
 * @param {boolean} [options.labelled] - Whether each stanza carries its label.
 * @param {VerseModel} [options.model] - Parsed structure; defaults to parsing the body.
 * @param {VersePresentation} [options.presentation] - Native-cell font and language.
 * @returns {string} Markdown with verse layout wrappers.
 */
export function verseMarkdown(
    body,
    { labelled = false, model = parseVerse(body), presentation } = {},
) {
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    const nativeAttrs = Object.entries(presentation?.attributes ?? {})
        .filter(([key]) => ["lang", "dir", "data-pagefind-ignore"].includes(key))
        .map(([key, value]) => ` ${key}="${escape(value)}"`)
        .join("");
    const nativeClasses = ["verse-native", ...(presentation?.classes ?? [])].join(" ");
    return model.groups
        .map((group) => {
            if (group.cantoBreak) {
                const mark = group.text ? inlineVerse(group.text) : "";
                const content =
                    mark && presentation ?
                        `<span class="${escape(nativeClasses)}"${nativeAttrs}${!presentation.attributes?.dir && rightToLeft(group.text) ? ' dir="rtl"' : ""}>${mark}</span>`
                    :   mark;
                return `<span class="verse-canto-break" aria-hidden="true">${content}</span>`;
            }
            const label = labelled ? `<span class="verse-label">${group.label}</span>` : "";
            const rows = group.lines
                .map((line) => {
                    const content = (text) =>
                        `<span class="verse-line${line.level ? ` i${line.level}` : ""}"${indentStyle(line.level)}>${inlineVerse(text)}</span>`;
                    if (line.romanText !== undefined)
                        return `<span class="verse-row"><span class="${escape(nativeClasses)}"${nativeAttrs}${!presentation?.attributes?.dir && rightToLeft(line.text) ? ' dir="rtl"' : ""}>${content(line.text)}</span><span class="verse-roman">${content(line.romanText)}</span></span>`;
                    return content(line.text);
                })
                .join(group.lines.some((line) => line.romanText !== undefined) ? "\n" : "  \n");
            return `<div class="verse-stanza">${label}\n\n${rows}\n\n</div>`;
        })
        .join("\n\n");
}

/**
 * Replace verse fences with wrappers whose bodies remain inline Markdown.
 * @param {string} source - Markdown containing verse fences.
 * @param {object} [options] - Encoded display models.
 * @param {Map<string, VersePresentation>} [options.verses] - Presentations keyed by rewritten body.
 */
export function renderVerse(source, { verses = new Map() } = {}) {
    const { blocks, errors } = scanVerse(source),
        lines = String(source ?? "").split("\n"),
        output = [];
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    let cursor = 0;
    for (const block of blocks) {
        output.push(...lines.slice(cursor, block.start));
        const transported = verses.get(block.body);
        const model = transported?.model ?? block.model;
        const paired = model.groups.some(
            (group) =>
                !group.cantoBreak && group.lines.some((line) => line.romanText !== undefined),
        );
        const labelled = block.attributes.work !== undefined;
        const attrs = [
            `class="${escape(["verse", ...block.classes.filter((value) => !paired || !transported?.classes?.includes(value)), ...(paired ? ["verse-paired"] : []), ...(labelled ? ["verse-labelled"] : [])].join(" "))}"`,
        ];
        if (block.id) attrs.push(`id="${escape(slugify(block.id))}"`);
        for (const [key, value] of Object.entries(block.attributes)) {
            if (
                !VERSE_KEYS.includes(key) ||
                refusedAttributes({ [key]: value }).length ||
                (paired && ["lang", "dir", "data-pagefind-ignore", "font", "enc"].includes(key))
            )
                continue;
            attrs.push(
                `${["lang", "dir", "data-pagefind-ignore"].includes(key) ? key : `data-${key}`}="${escape(value)}"`,
            );
        }
        let indent = block.indent;
        if (
            indent.length >= 4 &&
            !lines.slice(0, block.start).some((line) => /^ *(?:[-+*]|\d+[.)]) +/.test(line))
        )
            indent = "";
        output.push(
            "",
            `${indent}<div ${attrs.join(" ")}>`,
            "",
            ...verseMarkdown(block.body, { labelled, model, presentation: transported })
                .split("\n")
                .map((line) => (line ? indent + line : line)),
            "",
            `${indent}</div>`,
            "",
        );
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors };
}
