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

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import MarkdownIt from "markdown-it";
import { scanSpans, spanMarkdownPlugin } from "./content-spans.mjs";
import { inlineText, rebaseNameSpans } from "./name-markup.mjs";
import { createNameCatalog, nameForms as forms, normalizeName as normalize } from "./names.mjs";
import { WIKILINK, parseWikilink } from "./wikilink-syntax.mjs";

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
const labelText = (text, env) => readLabel(text, env).text;

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

/** Explicit inline occurrences and structural exclusions at original source offsets. */
function prose(source, capturedNames) {
    const links = [],
        regions = [],
        excluded = [],
        bold = [],
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
            links.push({ ...parseWikilink(inner), start, end: start + text.length, wiki: true });
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
            if (node.type === "strong") bold.push({ start, end });
            if (["link", "linkReference"].includes(node.type) && source[start] === "[")
                links.push({ start, end, labelled: true });
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
            regions.push({ start: node.position.start.offset, end: node.position.end.offset });
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
        literal = ranges(excluded);
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
        .map((span) => ({ ...span, label: span.visible }));
    const explicit = ranges([...marked, ...authoredLinks]);
    return {
        marked,
        links: authoredLinks,
        bold: bold
            .filter((span) => eligible(span) && !overlaps(explicit, span))
            .map((span) => ({
                ...span,
                label: labelText(source.slice(span.start, span.end), env),
            })),
    };
}

/**
 * Prepare indexed names once, then check only explicit occurrences without reading files.
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
    const { recognize: recognized, resolve } = catalog;
    return ({ file, raw }) => {
        const authored = parsed?.get(file);
        const capturedNames =
            authored?.raw === raw && Number.isInteger(authored.bodyLine) ?
                rebaseNameSpans(
                    (syntax ? syntax(authored.body).spans : scanSpans(authored.body)).names,
                    { raw, bodyLine: authored.bodyLine, bodyColumn: authored.bodyColumn },
                )
            :   undefined;
        const { marked, links, bold } = prose(raw, capturedNames);
        const events = [
            ...marked.map((span) => ({ ...span, kind: "marked" })),
            ...links.map((link) => {
                const target = link.wiki ? resolve(link.target) : undefined;
                return {
                    ...link,
                    kind: "link",
                    preferred: target,
                    label:
                        link.labelled ?
                            link.wiki ?
                                labelText(link.display || target?.full || "")
                            :   link.display
                        :   undefined,
                };
            }),
        ].filter((event) => typeof event.label === "string" && normalize(event.label));
        const unknown = new Map();
        for (const event of [...events].sort(
            (a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label),
        )) {
            if (recognized(event.label, event.preferred) || unknown.has(normalize(event.label)))
                continue;
            const entry = {
                key: "name:" + normalize(event.label),
                full: event.label,
                fullUse: true,
            };
            for (const spelling of forms(event.label))
                if (!unknown.has(spelling)) unknown.set(spelling, entry);
        }
        const findings = new Map();
        const add = (offset, rule, message) => {
            if (!findings.has(offset)) findings.set(offset, { rules: [], messages: [] });
            const finding = findings.get(offset);
            if (!finding.rules.includes(rule)) {
                finding.rules.push(rule);
                finding.messages.push(message);
            }
        };
        const used = new Set(),
            fullUsed = new Set();
        for (const event of events.sort((a, b) => a.start - b.start)) {
            const entry =
                recognized(event.label, event.preferred) ?? unknown.get(normalize(event.label));
            if (event.kind === "marked" && entry.indexed) {
                const destinations = (entry.candidates ?? [entry])
                    .map((target) => target.key)
                    .sort()
                    .join(" or ");
                add(
                    event.start,
                    "unlinked-name",
                    `“${event.label}” names “${entry.full}”; use a link to “${destinations}”`,
                );
            }
            if (used.has(entry.key))
                add(
                    event.start,
                    "repeated-name",
                    `“${entry.full}” is linked or marked more than once`,
                );
            // A resolved wikilink identifies its note, so its label may be any natural form.
            const introduces = entry.fullUse || event.preferred !== undefined;
            if (!introduces && !fullUsed.has(entry.key))
                add(
                    event.start,
                    "short-before-full",
                    `“${event.label}” appears before the full name “${entry.full}”`,
                );
            used.add(entry.key);
            if (introduces) fullUsed.add(entry.key);
        }
        for (const span of bold) {
            if (typeof span.label !== "string") continue;
            const entry = recognized(span.label);
            if (entry)
                add(
                    span.start,
                    "bold-name",
                    `“${span.label}” matches an indexed name; mark or link this name`,
                );
        }
        const lineStarts = [0];
        for (let i = 0; i < raw.length; i++) if (raw[i] === "\n") lineStarts.push(i + 1);
        return [...findings]
            .sort(([a], [b]) => a - b)
            .map(([offset, finding]) => {
                let lo = 0,
                    hi = lineStarts.length;
                while (lo + 1 < hi) {
                    const mid = (lo + hi) >>> 1;
                    if (lineStarts[mid] <= offset) lo = mid;
                    else hi = mid;
                }
                return {
                    file,
                    line: lo + 1,
                    column: offset - lineStarts[lo] + 1,
                    severity: "warning",
                    rules: finding.rules,
                    message: `first-use/${finding.rules.join("+")}: ${finding.messages.join("; ")}`,
                };
            });
    };
}
