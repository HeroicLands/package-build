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
import footnotePlugin from "markdown-it-footnote";
import { footnoteLabels, footnoteReferences } from "./content-footnotes.mjs";
import { inlineText } from "./name-markup.mjs";
import { pageOpenings } from "./heading-attributes.mjs";
import { inlineSyntaxRanges, verseRegions } from "./verse-regions.mjs";
import { blockTokens } from "./markdown-blocks.mjs";
import { slugify } from "./content-slug.mjs";
import { scanSpans, spanMarkdownPlugin } from "./content-spans.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

const lineParser = new MarkdownIt({ html: true }).use(footnotePlugin).use(spanMarkdownPlugin);

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

/** The authored attributes of a verse div. */
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

/** Read verse divs; start/end are inclusive zero-based source lines.
 * @param {string} source - Authored Markdown.
 * @param {object} [options] - Whole-page validation choices.
 * @param {boolean} [options.checkWorks] - Whether to validate page-local versions.
 * @returns {{blocks: VerseBlock[], errors: VerseDiagnostic[]}} Located divs and findings.
 */
export function scanVerse(source, { checkWorks = true } = {}) {
    const text = String(source ?? "");
    const lines = text.split("\n"),
        blocks = [],
        errors = [];
    for (const token of blockTokens(text)) {
        if (token.type === "fence" && /^verse(?:\s|$)/.test(token.info.trim())) {
            const opening = lines[token.map[0]];
            const marker = opening?.indexOf(token.markup);
            errors.push({
                line: token.map[0] + 1,
                ...(marker !== undefined && marker >= 0 ? { column: marker + 1 } : {}),
                message: "verse uses a .verse div: write ::: {.verse …} and a closing :::",
            });
        }
    }
    const definedFootnotes = footnoteLabels(text);
    for (const region of verseRegions(text)) {
        const at = { line: region.start + 1, column: region.contentStarts[0] - region.from + 1 };
        for (const message of [...region.problems, ...refusedAttributes(region.attributes)])
            errors.push({ ...at, message });
        if (!region.closed) errors.push({ ...at, message: "verse div needs a closing ::: line" });
        if (!region.body.trim()) errors.push({ ...at, message: "verse div is empty" });
        for (const key of Object.keys(region.attributes))
            if (!VERSE_KEYS.includes(key))
                errors.push({
                    ...at,
                    column: keyColumn(lines[region.start], key),
                    message: `${key}= is not a verse attribute`,
                });
        if (region.attributes.work !== undefined && !region.attributes.work.trim())
            errors.push({ ...at, message: "work= needs a nonempty page-local key" });
        const model = parseVerse(region.body, { footnotes: definedFootnotes });
        for (const finding of model.errors) {
            const preceding = text.slice(0, region.bodyStart + finding.offset);
            errors.push({
                line: preceding.split("\n").length,
                column: preceding.length - preceding.lastIndexOf("\n"),
                message: finding.message,
            });
        }
        for (const match of region.body.matchAll(/\t/g)) {
            const preceding = text.slice(0, region.bodyStart + match.index);
            errors.push({
                line: preceding.split("\n").length,
                column: preceding.length - preceding.lastIndexOf("\n"),
                message: "tabs are not allowed in verse",
            });
        }
        blocks.push({ ...region, column: at.column, model });
    }
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
    errors.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
    return { blocks, errors };
}

/**
 * The 1-based column of `key=`, or of a class or id token, in an opening line.
 *
 * @param {string} opening - The div's opening line.
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
 * @typedef {{cantoBreak: true, from: number, to: number, text?: string, id?: string, title?: string}} VerseCantoBreak
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
 * @property {VerseFinding[]} errors - Findings relative to the verse body.
 * @property {VerseLine[]} notes - Defined references without substantive verse text.
 */

/**
 * An authored verse div with its parsed logical structure.
 * @typedef {object} VerseBlock
 * @property {number} start - Opening div's zero-based source line.
 * @property {number} [column] - Opening delimiter's one-based source column, when known.
 * @property {number} end - Closing div's zero-based source line.
 * @property {number} from - Complete div first offset.
 * @property {number} to - Offset past complete div.
 * @property {number} bodyStart - First body offset.
 * @property {number} bodyEnd - Offset past body text.
 * @property {boolean} closed - Whether the closing delimiter exists.
 * @property {string[]} problems - Attribute syntax findings.
 * @property {"verse"} name - Region name.
 * @property {Record<string, string>} attributes - Authored attribute values.
 * @property {string} id - Authored anchor, or the empty string.
 * @property {string[]} classes - Authored presentation classes.
 * @property {string} indent - Opening div's leading spaces.
 * @property {string} body - Authored verse body.
 * @property {VerseModel} model - Logical structure relative to the body.
 */

/** @typedef {{line: number, column?: number, message: string}} VerseDiagnostic */

/**
 * An encoded verse's shared display model and native-cell presentation.
 * @typedef {object} VersePresentation
 * @property {VerseModel} model - Logical structure with paired line text.
 * @property {string[]} classes - Native script and font classes.
 * @property {Record<string, string>} attributes - Native language, direction and search attributes.
 */

/** Read a standard canto separator's semantic attributes. */
function cantoLine(line) {
    const match = /^---[ \t]+(\{.*)$/.exec(line.trim());
    if (!match) return undefined;
    const closed = match[1].endsWith("}");
    const parsed = parseExtensionAttributes(closed ? match[1].slice(1, -1) : match[1].slice(1));
    if (!parsed.classes.includes("canto")) return undefined;
    if (!closed) parsed.problems.push("a canto break needs --- {.canto} attribute braces");
    for (const key of Object.keys(parsed.values))
        if (key !== "title") parsed.problems.push(`${key}= is not a canto attribute`);
    for (const name of parsed.classes)
        if (name !== "canto") parsed.problems.push(`.${name} is not a canto class`);
    return {
        id: parsed.id,
        title: parsed.values.title ?? "",
        problems: [...parsed.problems, ...refusedAttributes(parsed.values)],
    };
}

/**
 * Parse logical verse lines, stanzas and cantos without losing authored offsets.
 * Offsets are UTF-16 positions relative to body. Delimiters and indentation are
 * layout ranges; source newlines inside a logical line contribute one space.
 * @param {string} body - Authored verse body.
 * @param {{inline?: boolean, footnotes?: ReadonlySet<string>}} [options] - Inline quotations have no cantos; footnotes are same-note definition labels.
 * @returns {VerseModel} The shared structure with offsets relative to the body.
 */
export function parseVerse(body, { inline = false, footnotes = new Set() } = {}) {
    const source = String(body ?? "");
    const groups = [],
        boundaries = [],
        layout = [],
        errors = [];
    if (inline)
        for (const match of source.matchAll(/\r?\n[ \t]*\r?\n/g))
            errors.push({
                offset: match.index,
                message: "an inline .verse quotation uses // for a stanza break, not a blank line",
            });
    const cantos = [{ stanzas: [] }];
    const references = footnoteReferences(source, { definitions: footnotes, inline: true });
    layout.push(...references.map((ref) => [ref.from, ref.to]));
    const protectedRanges = [
        ...inlineSyntaxRanges(source),
        ...references.map((ref) => [ref.from, ref.to]),
    ].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const children = [];
    lineParser.inline.parse(source, lineParser, {}, children);
    const spans = children
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
    const pendingNotes = [];
    let pendingBreak;
    const cantoIds = new Set();
    if (inline)
        for (const match of source.matchAll(/---[ \t]+\{[^}]*\.canto[^}]*\}/g)) {
            const escaped = /\\+$/.exec(source.slice(0, match.index))?.[0].length ?? 0;
            if (
                escaped % 2 ||
                protectedRanges.some(([first, past]) => match.index >= first && match.index < past)
            )
                continue;
            errors.push({
                offset: match.index,
                message: "an inline .verse quotation has no canto breaks",
            });
        }
    const append = (value, at) => {
        text += value;
        for (let index = 0; index < value.length; index++) offsets.push(at + index);
    };
    const finishLine = (at) => {
        let kind = "empty";
        const trimmed = text.trimEnd();
        if (trimmed.trim()) {
            if (
                STANZA_BREAK.test(trimmed) &&
                !errors.some(
                    (error) =>
                        error.offset >= from &&
                        error.offset <= at &&
                        error.message.includes("--- {.canto}"),
                )
            )
                errors.push({
                    offset: from,
                    message: "write a canto break as --- {.canto}, preceded by a blank line",
                });
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
            const line = { text: lineText, level, from, to: at, offsets: lineOffsets };
            const visible = [];
            const hasReferences =
                footnoteReferences(lineText, { definitions: footnotes, inline: true }).length > 0;
            if (hasReferences)
                lineParser.inline.parse(
                    lineText,
                    lineParser,
                    {
                        footnotes: {
                            refs: Object.fromEntries([...footnotes].map((key) => [":" + key, -1])),
                        },
                    },
                    visible,
                );
            const onlyReferences =
                hasReferences &&
                !inlineText(visible).trim() &&
                !visible.some((token) => token.type === "image");
            kind = onlyReferences ? "note" : "content";
            if (onlyReferences) {
                const previous =
                    lines.at(-1) ?? groups.findLast((group) => !group.cantoBreak)?.lines.at(-1);
                if (previous) {
                    previous.text += line.text;
                    previous.offsets.push(...line.offsets);
                } else pendingNotes.push(line);
            } else {
                if (pendingNotes.length) {
                    line.text = pendingNotes.map((note) => note.text).join("") + line.text;
                    line.offsets = [
                        ...pendingNotes.flatMap((note) => note.offsets),
                        ...line.offsets,
                    ];
                    pendingNotes.length = 0;
                }
                lines.push(line);
            }
        }
        text = "";
        offsets = [];
        level = 0;
        from = at;
        return kind;
    };
    const finishStanza = (at) => {
        const kind = finishLine(at);
        const emitted = lines.length > 0;
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
        return { kind, emitted };
    };
    const event = (kind, at, past) => {
        const result =
            kind === "line" ? { kind: finishLine(at), emitted: false } : finishStanza(at);
        layout.push([at, past]);
        if (!(
            result.kind === "note" &&
            (kind === "line" || (kind === "stanza" && !result.emitted))
        ))
            boundaries.push({ kind, sourceOffset: at });
        from = past;
    };
    for (let at = 0; at < source.length;) {
        while (protectedRanges[protectedIndex]?.[1] <= at) protectedIndex++;
        const protectedRange = protectedRanges[protectedIndex];
        const protectedAt = protectedRange && protectedRange[0] <= at;
        const lineStart = at === 0 || /[\r\n]/.test(source[at - 1]);
        if (lineStart && !protectedAt) {
            const physical = /^[^\r\n]*/.exec(source.slice(at))[0];
            const newline = /^(?:\r\n|\r|\n)/.exec(source.slice(at + physical.length))?.[0] ?? "";
            if (!physical.trim()) {
                event("stanza", at, at + physical.length + newline.length);
                at += physical.length + newline.length;
                continue;
            }
            if (STANZA_BREAK.test(physical.trim()))
                errors.push({
                    offset: at,
                    message: "write a canto break as --- {.canto}, preceded by a blank line",
                });
            const canto = cantoLine(physical);
            if (canto) {
                if (inline) {
                    if (!errors.some((error) => error.offset === at))
                        errors.push({
                            offset: at,
                            message: "an inline .verse quotation has no canto breaks",
                        });
                } else {
                    for (const message of canto.problems) errors.push({ offset: at, message });
                    if (
                        at &&
                        source.slice(0, at).trimEnd().length &&
                        !/(?:\r?\n)[ \t]*(?:\r?\n)$/.test(source.slice(0, at))
                    )
                        errors.push({
                            offset: at,
                            message: "a canto break needs a blank line before it",
                        });
                    if (canto.id && cantoIds.has(canto.id))
                        errors.push({
                            offset: at,
                            message: `canto anchor #${canto.id} is written more than once`,
                        });
                    if (canto.id) cantoIds.add(canto.id);
                    event("canto", at, at + physical.length + newline.length);
                    if (!cantos.at(-1).stanzas.length)
                        errors.push({
                            offset: at,
                            message: "a canto break needs a stanza before and after it",
                        });
                    else {
                        groups.push({
                            cantoBreak: true,
                            from: at,
                            to: at + physical.length,
                            id: canto.id,
                            title: canto.title,
                        });
                        cantos.push({ stanzas: [] });
                    }
                    pendingBreak = at;
                    at += physical.length + newline.length;
                    continue;
                }
            }
        }

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
    return { cantos, groups, boundaries, layout, errors, notes: pendingNotes };
}

/**
 * Validate a quoted verse span using its original source coordinates.
 * @param {{start: number, text: string, attrs: Array<[string,string]>}} span - Authored span.
 * @param {string} source - Complete Markdown source.
 * @returns {VerseDiagnostic[]} Located inline-only findings.
 */
export function inlineVerseFindings(span, source) {
    const findings = parseVerse(span.text, {
        inline: true,
        footnotes: footnoteLabels(source),
    }).errors;
    for (const [key] of span.attrs)
        if (["form", "work", "scan"].includes(key))
            findings.push({ offset: 0, message: `${key}= is not an inline .verse attribute` });
    return findings.map((finding) => {
        const prefix = source.slice(0, span.start + 1 + finding.offset);
        return {
            line: prefix.split("\n").length,
            column: prefix.length - prefix.lastIndexOf("\n"),
            message: finding.message,
        };
    });
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
 * @param {VerseBlock[]} blocks - Divs belonging to one page.
 * @returns {VerseDiagnostic[]} Findings at affected opening divs.
 */
export function workShapeFindings(blocks) {
    const location = (block) => ({
        line: block.start + 1,
        ...(block.column === undefined ? {} : { column: block.column }),
    });
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
                ...location(versions[0]),
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
                        errors.push({ ...location(block), message });
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
                        errors.push({ ...location(block), message });
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
 * @param {string} body - Authored verse body.
 * @param {object} [options] - Shared structure and display choices.
 * @param {boolean} [options.labelled] - Whether each stanza carries its label.
 * @param {VerseModel} [options.model] - Parsed structure; defaults to parsing the body.
 * @param {VersePresentation} [options.presentation] - Native-cell font and language.
 * @param {boolean} [options.inline] - Whether wrappers must remain inline-safe.
 * @returns {string} Markdown with verse layout wrappers.
 */
export function verseMarkdown(
    body,
    { labelled = false, model = parseVerse(body), presentation, inline = false } = {},
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
    const content = model.groups
        .map((group) => {
            if (group.cantoBreak) {
                const mark = group.text ? inlineVerse(group.text) : "";
                const content =
                    mark && presentation ?
                        `<span class="${escape(nativeClasses)}"${nativeAttrs}${!presentation.attributes?.dir && rightToLeft(group.text) ? ' dir="rtl"' : ""}>${mark}</span>`
                    :   mark;
                const heading =
                    group.title ?
                        `<span class="verse-canto-heading" role="heading" aria-level="3"${group.id ? ` id="${escape(slugify(group.id))}"` : ""}>${inlineVerse(group.title)}</span>`
                    : group.id ? `<span id="${escape(slugify(group.id))}"></span>`
                    : "";
                return (
                    heading + `<span class="verse-canto-break" aria-hidden="true">${content}</span>`
                );
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
                .join(
                    group.lines.some((line) => line.romanText !== undefined) ?
                        inline ? ""
                        :   "\n"
                    : inline ? "<br/>"
                    : "  \n",
                );
            return inline ?
                    `<span class="verse-stanza">${rows}</span>`
                :   `<div class="verse-stanza">${label}\n\n${rows}\n\n</div>`;
        })
        .join(inline ? '<br class="verse-stanza-break"/>' : "\n\n");
    const notes = (model.notes ?? [])
        .map((note) => inlineVerse(note.romanText ?? note.text))
        .join("");
    return content + (notes ? `<span class="verse-footnotes">${notes}</span>` : "");
}

/**
 * Replace verse divs with wrappers whose bodies remain inline Markdown.
 * @param {string} source - Markdown containing verse divs.
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
        const paired = Boolean(transported);
        const labelled = block.attributes.work !== undefined;
        const attrs = [
            `class="${escape(["verse", ...block.classes.filter((value) => value !== "verse" && (!paired || !transported?.classes?.includes(value))), ...(paired ? ["verse-paired"] : []), ...(labelled ? ["verse-labelled"] : [])].join(" "))}"`,
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

/**
 * Render quoted verse with inline-safe wrappers and shared logical structure.
 * @param {string} source - Markdown after block verse rendering.
 * @returns {string} Markdown retaining surrounding prose.
 */
export function renderVerseQuotes(source) {
    const spans = scanSpans(source).spans.filter((span) =>
        span.attrs.some(([key, value]) => key === "class" && value.split(/\s+/).includes("verse")),
    );
    const footnotes = footnoteLabels(source);
    let markdown = source;
    for (const span of spans
        .filter(
            (span) => !spans.some((parent) => parent.start < span.start && parent.end >= span.end),
        )
        .sort((a, b) => b.start - a.start)) {
        const model = span.verseModel ?? parseVerse(span.text, { inline: true, footnotes });
        const attrs = span.attrs
            .map(
                ([key, value]) =>
                    `${key}="${String(key === "class" ? value + " verse-inline" : value)
                        .replace(/&/g, "&amp;")
                        .replace(/"/g, "&quot;")}"`,
            )
            .join(" ");
        const html = `<span ${attrs}>${verseMarkdown(span.text, { model, inline: true })}</span>`;
        markdown = markdown.slice(0, span.start) + html + markdown.slice(span.end);
    }
    return markdown;
}
