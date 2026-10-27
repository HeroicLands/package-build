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
 * **A name's first use.** Each name a page marks is keyed, and the first use
 * of each key in the page's prose is bold when the page renders. Bold an author
 * writes is the author's choice.
 *
 * The key of a use is, in order:
 *
 * 1. a name wikilink's address (`[[being-tomr|Tom]]{.name}`);
 * 2. a `.name` span's `ref`: an address (`ref=being-tomr`) or a page-local key
 *    (`ref="#jane"`);
 * 3. otherwise the span's label, case folded, with its `lang` (`en` when it
 *    states none).
 *
 * Only body prose counts: paragraphs, list items, quotations and footnotes.
 * Headings, tables, captions, the title line of a named block, raw HTML, code,
 * verse and the sections generated from frontmatter neither take the bold nor
 * count as a use, and neither does a name inside a run that states `lang`,
 * `font` or `enc`. A name already inside authored strong text counts as its
 * key's first use and takes no second bold.
 *
 * {@link boldFirstUses} runs once, in the expansion every target shares, and
 * marks each first use with {@link FIRST_USE_OPEN} and {@link FIRST_USE_CLOSE};
 * {@link firstUsePlugin} turns the marks into strong text in every renderer.
 * {@link createFirstUseChecker} is the lint over the same uses.
 *
 * @module
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import MarkdownIt from "markdown-it";
import { readQualifier } from "./address.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { scanFigures } from "./content-figures.mjs";
import { RUN_KEYS } from "./content-scripts.mjs";
import { scanSpans, spanMarkdownPlugin } from "./content-spans.mjs";
import { inlineText, rebaseNameSpans } from "./name-markup.mjs";
import { isLocalRef, readNameRef } from "./name-refs.mjs";
import { createNameCatalog, normalizeName as normalize } from "./names.mjs";
import { WIKILINK, parseWikilink } from "./wikilink-syntax.mjs";

/**
 * Opens a first use in expanded markdown: a Unicode noncharacter, which no
 * authored text, font or encoding uses.
 */
export const FIRST_USE_OPEN = "\uFDD0";

/** Closes a first use in expanded markdown. */
export const FIRST_USE_CLOSE = "\uFDD1";

const MARKS = /[\uFDD0\uFDD1]/g;

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);
const labelParser = new MarkdownIt({ html: true }).use(spanMarkdownPlugin);
const linkRule = labelParser.inline.ruler.getRules("").find((rule) => rule.name === "link");
labelParser.inline.ruler.at("link", (state, silent) => {
    const start = state.pos,
        count = state.tokens.length;
    const matched = linkRule(state, silent);
    if (matched && !silent) {
        const opening = state.tokens.slice(count).find((token) => token.type === "link_open");
        opening.meta = {
            ...opening.meta,
            nameLink: { source: state.src, start, end: state.pos },
        };
    }
    return matched;
});
const blank = (text) => text.replace(/[^\r\n]/g, " ");
// A quoted bracket belongs to its attribute. This reads boundaries only;
// the separate raw-HTML check owns whether an author should write the tag.
const HTML_TOKEN =
    /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s(?:[^"'<>]|"[^"]*"|'[^']*')*)?\/?>/g;

/** Read an authored inline slice once with the renderer's span grammar. */
function readLabel(text, env = {}) {
    const tokens = labelParser.parseInline(text, env);
    const children = tokens[0]?.children ?? [];
    const offsets = [];
    for (let i = 0; i < text.length; i++) {
        offsets.push(i);
        if (text[i] === "\r" && text[i + 1] === "\n") i++;
    }
    offsets.push(text.length);
    const normalized = text.replace(/\r\n?/g, "\n").replaceAll("\0", "\uFFFD");
    const spans = [],
        links = [];
    for (let i = 0; i < children.length; i++) {
        const token = children[i];
        if (token.meta?.span) spans.push(token.meta);
        else if (token.type === "span_close") spans.pop();
        const link = token.meta?.nameLink;
        if (!link) continue;
        const parent =
            link.source === normalized ?
                undefined
            :   spans.findLast((span) => span.text === link.source);
        const base = parent ? parent.start + 1 : 0;
        let depth = 1,
            end = i + 1;
        for (; end < children.length; end++) {
            if (children[end].type === "link_open") depth++;
            if (children[end].type === "link_close" && --depth === 0) break;
        }
        links.push({
            start: offsets[base + link.start],
            end: offsets[base + link.end],
            display: inlineText(children.slice(i + 1, end)),
        });
    }
    return { text: inlineText(tokens), links };
}

/** The kind a span's `data-type` supplies; an invalid value is refused by the span check. */
function spanKind(span) {
    const value = span.attrs?.find(([key]) => key === "data-type")?.[1];
    if (typeof value !== "string") return undefined;
    const [type, subType] = value.split("/");
    return { type, subType: subType ?? null };
}

/** Join overlapping source ranges so lookups stay logarithmic. */
function ranges(values) {
    const out = [];
    for (const value of values.sort((a, b) => a.start - b.start || b.end - a.end)) {
        const last = out.at(-1);
        if (last && value.start <= last.end) last.end = Math.max(last.end, value.end);
        else out.push({ start: value.start, end: value.end });
    }
    return out;
}

/** Find the last range opening before an offset. */
function before(values, offset) {
    let lo = 0,
        hi = values.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (values[mid].start < offset) lo = mid + 1;
        else hi = mid;
    }
    return values[lo - 1];
}
const contains = (values, value) => {
    const range = before(values, value.start + 1);
    return range && range.end >= value.end;
};
const overlaps = (values, value) => {
    const range = before(values, value.end);
    return range && range.end > value.start;
};

/**
 * Explicit inline occurrences, authored strong text and structural exclusions
 * at original source offsets.
 */
function prose(source, capturedNames) {
    const links = [],
        paragraphs = [],
        regions = [],
        excluded = [],
        strong = [],
        html = [];
    const masked = source
        .replace(/!\[\[[^\]\n]+\]\]|\{\{[^}\n]+\}\}/g, (text, start) => {
            excluded.push({ start, end: start + text.length });
            return blank(text);
        })
        .replace(WIKILINK, (text, inner, start) => {
            let escapes = 0;
            while (source[start - escapes - 1] === "\\") escapes++;
            if (escapes % 2) return text;
            links.push({
                ...parseWikilink(inner, text),
                start,
                end: start + text.length,
                wiki: true,
            });
            return "x".repeat(text.length);
        });
    const tree = parser.parse(masked);
    const env = { references: Object.create(null) };
    const inline = (node) => {
        const start = node.position?.start.offset,
            end = node.position?.end.offset;
        if (["inlineCode", "image", "imageReference", "footnoteReference"].includes(node.type))
            excluded.push({ start, end });
        else if (node.type === "html") html.push(node);
        else if (["strong", "emphasis", "delete", "link", "linkReference"].includes(node.type)) {
            if (["link", "linkReference"].includes(node.type) && source[start] === "[")
                links.push({ start, end, labelled: true });
            if (node.type === "strong") strong.push({ start, end });
            for (const child of node.children ?? []) inline(child);
        }
    };
    const block = (node) => {
        if (node.type === "definition")
            env.references[labelParser.utils.normalizeReference(node.identifier)] = {
                href: node.url,
                title: node.title ?? "",
            };
        else if (node.type === "html") html.push(node);
        else if (node.type === "paragraph") {
            const range = { start: node.position.start.offset, end: node.position.end.offset };
            regions.push(range);
            paragraphs.push(range);
            for (const child of node.children ?? []) inline(child);
        } else if (
            ["root", "blockquote", "list", "listItem", "footnoteDefinition"].includes(node.type)
        ) {
            for (const child of node.children ?? []) block(child);
        }
    };
    block(tree);
    const stack = [];
    for (const node of html) {
        const htmlText = masked.slice(node.position.start.offset, node.position.end.offset);
        let cursor = 0;
        for (const tag of htmlText.matchAll(HTML_TOKEN)) {
            const start = node.position.start.offset + tag.index;
            if (tag.index > cursor)
                regions.push({ start: node.position.start.offset + cursor, end: start });
            cursor = tag.index + tag[0].length;
            excluded.push({ start, end: start + tag[0].length });
            if (tag[0].startsWith("<!--")) continue;
            const name = /^<\/?([A-Za-z][\w-]*)/.exec(tag[0])[1].toLowerCase();
            if (tag[0].startsWith("</")) {
                const opening = stack.findLastIndex((entry) => entry.name === name);
                if (opening < 0) continue;
                for (const entry of stack.splice(opening))
                    if (entry.excluded)
                        excluded.push({ start: entry.start, end: start + tag[0].length });
            } else if (
                !/\/>$/.test(tag[0]) &&
                !["br", "hr", "img", "input", "meta", "link"].includes(name)
            ) {
                const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
                stack.push({
                    name,
                    start,
                    excluded:
                        /^(?:h[1-6]|table|pre|code|script|style)$/.test(name) ||
                        (classes?.[1] ?? classes?.[2] ?? classes?.[3] ?? "")
                            .split(/\s+/)
                            .includes("infobox"),
                });
            }
        }
        if (cursor < htmlText.length)
            regions.push({
                start: node.position.start.offset + cursor,
                end: node.position.end.offset,
            });
    }
    for (const entry of stack)
        if (entry.excluded) excluded.push({ start: entry.start, end: source.length });
    const allowed = ranges(regions),
        literal = ranges(excluded),
        prosaic = ranges(paragraphs);
    const eligible = (value) => contains(allowed, value) && !overlaps(literal, value);
    const actualLinks = links.filter(eligible).flatMap((link) => {
        if (link.wiki) return [link];
        const label = readLabel(source.slice(link.start, link.end), env);
        return label.links.map((actual) => ({
            ...actual,
            labelled: true,
            start: link.start + actual.start,
            end: link.start + actual.end,
        }));
    });
    const authoredLinks = [...new Map(actualLinks.map((link) => [link.start, link])).values()];
    const linked = ranges(authoredLinks);
    const marked = (capturedNames ?? scanSpans(source).names)
        .filter((span) => eligible(span) && !contains(linked, span))
        .map((span) => ({
            ...span,
            label: span.visible,
            nameKind: spanKind(span),
            ref: readNameRef(span),
        }));
    return {
        marked,
        links: authoredLinks,
        strong,
        inParagraph: (value) => contains(prosaic, value),
    };
}

/** Whether a wikilink marks a name: it carries the `.name` class. */
const isNameLink = (link) => Boolean(link.wiki && link.attributes?.classes?.includes("name"));

/**
 * The addresses a page's names are read against: the tree's types and
 * packages, and the package an address that names none belongs to.
 *
 * @typedef {object} NameVocabulary
 * @property {Set<string>} [types] - Every type an address may name.
 * @property {Set<string>} [packages] - Every package an address may name.
 * @property {Set<string>} [noIndexPackages] - Packages with no content index.
 * @property {string} [contentPackage] - The package the page belongs to.
 */

/**
 * The key of a note address: its package, type and shortcode, so every
 * spelling of one note, and each of its systems' documents, is one key. An
 * address the vocabulary cannot read is keyed as written.
 */
function addressKey(address, { types, packages, noIndexPackages, contentPackage } = {}) {
    const read =
        types ? readQualifier(address, types, packages ?? new Set(), noIndexPackages) : null;
    if (!read || read.reason) return `note:${address}`;
    return `note:${read.package ?? contentPackage ?? ""}-${read.type}-${read.shortcode}`;
}

/** The key a span's use is counted under. */
function spanKey(span, vocabulary) {
    if (span.ref)
        return isLocalRef(span.ref) ? `local:${span.ref}` : addressKey(span.ref, vocabulary);
    const lang = span.attrs?.find(([key]) => key === "lang")?.[1] || "en";
    return `label:${lang}:${normalize(span.label)}`;
}

/** The key a name wikilink's use is counted under: its address. */
const linkKey = (link, vocabulary) =>
    link.target ? addressKey(link.target, vocabulary) : `anchor:#${link.anchor}`;

/** The 0-based line of each offset, by a sorted list of line starts. */
function lineOf(starts, offset) {
    let lo = 0,
        hi = starts.length;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid;
    }
    return lo;
}

/**
 * A use of a name in a page's prose.
 *
 * @typedef {object} NameUse
 * @property {number} start - Inclusive UTF-16 offset of the use.
 * @property {number} end - Exclusive UTF-16 offset after it, attributes included.
 * @property {string} key - What the use is counted under.
 * @property {boolean} emphasised - It sits inside authored strong text.
 */

/**
 * Every use of a name in a body's prose, in source order.
 *
 * @param {string} markdown - A body, as authored or expanded.
 * @param {NameVocabulary} [vocabulary] - What its addresses are read against.
 * @returns {NameUse[]} The uses that count toward a first use.
 */
export function nameUses(markdown, vocabulary) {
    const source = String(markdown ?? "");
    // Every use carries the class, so a body without it is read no further.
    if (!source.includes(".name")) return [];
    const spans = scanSpans(source);
    const { marked, links, strong, inParagraph } = prose(source, spans.names);
    const starts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
    // A caption and a named block's opening and closing lines are not prose.
    const skipped = new Set();
    for (const figure of scanFigures(source).figures)
        for (let line = figure.captionStart; line < figure.captionEnd; line++) skipped.add(line);
    const blocks = scanBlocks(source).blocks;
    for (const one of blocks) skipped.add(one.start).add(one.end);
    // A name inside a run that states a language, font or encoding is that
    // run's text, never the page's prose.
    const hasRunKey = (keys) => RUN_KEYS.some((key) => Object.hasOwn(keys, key));
    const runLines = blocks
        .filter((one) => hasRunKey(one.attributes ?? {}))
        .map((one) => ({ start: one.start, end: one.end }));
    const runSpans = spans.spans.filter((span) => hasRunKey(Object.fromEntries(span.attrs)));
    const inRun = (use) =>
        runSpans.some(
            (span) =>
                span.start <= use.start &&
                span.end >= use.end &&
                (span.start !== use.start || span.end !== use.end),
        ) ||
        runLines.some(
            (range) =>
                lineOf(starts, use.start) > range.start && lineOf(starts, use.start) < range.end,
        );
    const emphasised = (use) =>
        strong.some((range) => range.start <= use.start && range.end >= use.end);
    return [
        ...links.filter(isNameLink).map((link) => ({ ...link, key: linkKey(link, vocabulary) })),
        ...marked.map((span) => ({ ...span, key: spanKey(span, vocabulary) })),
    ]
        .filter((use) => inParagraph(use) && !skipped.has(lineOf(starts, use.start)) && !inRun(use))
        .sort((a, b) => a.start - b.start)
        .map((use) => ({
            start: use.start,
            end: use.end,
            key: use.key,
            emphasised: emphasised(use),
        }));
}

/**
 * Mark the first use of each name in a body's prose as bold.
 *
 * Each first use is wrapped in {@link FIRST_USE_OPEN} and
 * {@link FIRST_USE_CLOSE}, which {@link firstUsePlugin} renders as strong
 * text. A first use already inside authored strong text is left as it is.
 *
 * @param {string} markdown - A body's prose, with its generated sections split
 *   off and its wikilinks not yet resolved.
 * @param {NameVocabulary} [vocabulary] - What its addresses are read against.
 * @returns {string} The same markdown with each first use marked.
 */
export function boldFirstUses(markdown, vocabulary) {
    const source = String(markdown ?? "");
    const seen = new Set(),
        firsts = [];
    for (const use of nameUses(source, vocabulary)) {
        if (seen.has(use.key)) continue;
        seen.add(use.key);
        if (!use.emphasised) firsts.push(use);
    }
    let out = source;
    for (const use of firsts.reverse())
        out =
            out.slice(0, use.start) +
            FIRST_USE_OPEN +
            out.slice(use.start, use.end) +
            FIRST_USE_CLOSE +
            out.slice(use.end);
    return out;
}

/**
 * Render the first-use marks {@link boldFirstUses} wrote as strong text.
 *
 * A mark in inline text opens or closes a `strong`; a mark anywhere else, as in
 * raw HTML or code, is dropped, so no mark reaches a reader.
 *
 * @param {import("markdown-it")} md - Markdown parser to extend.
 */
export function firstUsePlugin(md) {
    md.core.ruler.push("first_use", (state) => {
        const Token = state.Token;
        const strip = (token) => {
            if (token.content?.includes(FIRST_USE_OPEN) || token.content?.includes(FIRST_USE_CLOSE))
                token.content = token.content.replace(MARKS, "");
        };
        for (const token of state.tokens) {
            if (token.type !== "inline") {
                strip(token);
                continue;
            }
            if (!token.children) continue;
            const children = [];
            for (const child of token.children) {
                if (child.type !== "text" || !MARKS.test(child.content)) {
                    MARKS.lastIndex = 0;
                    strip(child);
                    children.push(child);
                    continue;
                }
                MARKS.lastIndex = 0;
                for (const part of child.content.split(/([﷐﷑])/)) {
                    if (part === FIRST_USE_OPEN || part === FIRST_USE_CLOSE) {
                        const open = part === FIRST_USE_OPEN;
                        const mark = new Token(
                            open ? "strong_open" : "strong_close",
                            "strong",
                            open ? 1 : -1,
                        );
                        mark.level = child.level;
                        children.push(mark);
                    } else if (part) {
                        const text = new Token("text", "", 0);
                        text.content = part;
                        text.level = child.level;
                        children.push(text);
                    }
                }
            }
            token.children = children;
        }
    });
}

/**
 * Prepare indexed names once, then check each note's marked names without
 * reading files.
 *
 * One rule, a warning at the occurrence:
 *
 * - `unlinked-name`: a `.name` span with no `ref` names an indexed note, which
 *   a link or a `ref` ties to its note.
 *
 * @param {{records: readonly object[], index: object,
 *   catalog?: import("./names.mjs").NameCatalog,
 *   parsed?: Map<string, {raw: string, body: string, bodyLine?: number, bodyColumn?: number}>,
 *   syntax?: import("./content-session.mjs").ContentSyntax}} options - Lint's
 *   records/resolver and optional captured authored-body projections.
 * @returns {(note: {file: string, raw: string}) => Array<{file: string, line: number, column: number, severity: "warning", rules: string[], message: string}>} Located warning diagnostics.
 */
export function createFirstUseChecker({
    records,
    index,
    parsed,
    syntax,
    catalog = createNameCatalog({ records, index }),
}) {
    const { recognize } = catalog;
    return ({ file, raw }) => {
        const authored = parsed?.get(file);
        const capturedNames =
            authored?.raw === raw && Number.isInteger(authored.bodyLine) ?
                rebaseNameSpans(
                    (syntax ? syntax(authored.body).spans : scanSpans(authored.body)).names,
                    { raw, bodyLine: authored.bodyLine, bodyColumn: authored.bodyColumn },
                )
            :   undefined;
        const { marked } = prose(raw, capturedNames);
        const findings = new Map();
        const add = (offset, rule, message) => {
            if (!findings.has(offset)) findings.set(offset, { rules: [], messages: [] });
            const finding = findings.get(offset);
            if (!finding.rules.includes(rule)) {
                finding.rules.push(rule);
                finding.messages.push(message);
            }
        };
        for (const span of marked) {
            if (span.ref || !normalize(span.label)) continue;
            const entry = recognize(span.label, undefined, span.nameKind);
            if (!entry?.indexed) continue;
            const destinations = (entry.candidates ?? [entry])
                .map((target) => target.key)
                .sort()
                .join(" or ");
            add(
                span.start,
                "unlinked-name",
                `“${span.label}” names “${entry.full}”; use a link to “${destinations}”, or tie it with ref=`,
            );
        }
        const lineStarts = [0];
        for (let i = 0; i < raw.length; i++) if (raw[i] === "\n") lineStarts.push(i + 1);
        return [...findings]
            .sort(([a], [b]) => a - b)
            .map(([offset, finding]) => {
                const line = lineOf(lineStarts, offset);
                return {
                    file,
                    line: line + 1,
                    column: offset - lineStarts[line] + 1,
                    severity: "warning",
                    rules: finding.rules,
                    message: `first-use/${finding.rules.join("+")}: ${finding.messages.join("; ")}`,
                };
            });
    };
}
