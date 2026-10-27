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
import { alertMarkdownPlugin } from "./content-alerts.mjs";
import { slugify } from "./content-slug.mjs";
import { scanVerse } from "./content-verse.mjs";
import footnotePlugin from "markdown-it-footnote";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";
import { inlineText } from "./name-markup.mjs";
import { cartoucheProblems, glyphProblems } from "./content-glyphs.mjs";

/** Add bracket spans after recognized Markdown links and footnotes.
 * @param {import("markdown-it")} md - Markdown parser to extend.
 * @param {object} [options] - Surface presentation.
 * @param {boolean} [options.source] - Emit opaque authored source tokens for buffer preview.
 * @param {boolean} [options.spoilers] - Add focusable CSS spoiler wrappers (Foundry).
 */
export function spanMarkdownPlugin(md, { spoilers = false, source = false } = {}) {
    {
        md.renderer.rules.span_open = (tokens, index, options, env, renderer) => {
            const token = tokens[index];
            const secret = (token.attrGet("class") ?? "").split(/\s+/).includes("secret");
            if (spoilers && secret) {
                token.attrSet("data-inline-spoiler", "");
                token.attrSet("tabindex", "0");
                if (!token.attrGet("title"))
                    token.attrSet("title", "Spoiler: hover or focus to reveal");
                if (!token.attrGet("aria-label"))
                    token.attrSet("aria-label", "Spoiler; focus to reveal");
            }
            const original = token.attrs;
            if (["em", "strong"].includes(token.tag))
                token.attrs = (token.attrs ?? []).flatMap(([key, value]) => {
                    if (key !== "class") return [[key, value]];
                    const classes = value
                        .split(/\s+/)
                        .filter((name) => !["emph", "strong"].includes(name));
                    return classes.length ? [[key, classes.join(" ")]] : [];
                });
            const rendered = renderer.renderToken(tokens, index, options);
            token.attrs = original;
            return rendered;
        };
    }
    md.inline.ruler.after("link", "bracket_span", (state, silent) => {
        const start = state.pos;
        if (
            state.src[start] !== "[" ||
            // Raw wikilinks are handled before spans render. Refuse their
            // adjacent closing brackets without parsing every label twice.
            (state.src[start + 1] === "[" &&
                state.src[state.src.indexOf("]", start + 2) + 1] === "]") ||
            /@[A-Za-z]+$/.test(state.src.slice(0, start)) ||
            state.src[start + 1] === "^" ||
            state.src[start + 1] === "!" ||
            ["!", "]"].includes(state.src[start - 1]) ||
            (state.src[start - 1] === "[" && state.linkLevel === 0)
        )
            return false;
        const end = state.md.helpers.parseLinkLabel(state, start, false);
        if (
            end < 0 ||
            ["(", "["].includes(state.src[end + 1]) ||
            (state.src[start + 1] === "[" && state.src[end + 1] !== "{")
        )
            return false;
        let finish = end + 1;
        let parsed = { id: "", classes: [], values: {}, problems: [] };
        if (state.src[finish] === "{") {
            let quote = false,
                escape = false,
                close = finish + 1;
            for (; close < state.posMax; close++) {
                const char = state.src[close];
                if (escape) {
                    escape = false;
                    continue;
                }
                if (char === "\\") {
                    escape = true;
                    continue;
                }
                if (char === '"') quote = !quote;
                if (char === "}" && !quote) break;
            }
            if (close === state.posMax)
                parsed.problems.push("span attributes need closing {…} braces");
            else {
                parsed = parseExtensionAttributes(state.src.slice(finish + 1, close), {
                    positions: true,
                });
                finish = close + 1;
            }
        }
        // A generated book link may put its language/script span directly
        // inside the label. Preserve the literal class-only bracket spelling
        // there for ordinary spans, including names used by the first-use audit.
        if (
            state.src[start - 1] === "[" &&
            !["lang", "font", "enc"].some((key) => Object.hasOwn(parsed.values, key)) &&
            !parsed.classes.some(
                (name) => name === "script" || /^font-(?:mono|serif|sans)$/.test(name),
            )
        )
            return false;
        const problems = [...parsed.problems, ...refusedAttributes(parsed.values)];
        if (parsed.classes.includes("glyph")) problems.push(...glyphProblems(parsed));
        else if (parsed.classes.includes("cartouche")) problems.push(...cartoucheProblems(parsed));
        if (silent) {
            state.pos = finish;
            return true;
        }
        const emphasis =
            parsed.classes.includes("emph") ? "em"
            : parsed.classes.includes("strong") ? "strong"
            : undefined;
        if (source && !emphasis) {
            // An incomplete attribute stays opaque through the end of its line.
            if (state.src[finish] === "{") {
                const newline = state.src.indexOf("\n", finish);
                finish = newline < 0 ? state.posMax : newline;
            }
            const token = state.push("span_source", "", 0);
            token.content = state.src.slice(start, finish);
            token.meta = {
                text: state.src.slice(start + 1, end),
                labelEnd: end - start,
                secret: parsed.classes.includes("secret"),
            };
            state.pos = finish;
            return true;
        }
        const token = state.push("span_open", emphasis ?? "span", 1);
        token.meta = {
            span: true,
            start,
            end: finish,
            text: state.src.slice(start + 1, end),
            problems,
            attributePositions: Object.fromEntries(
                Object.entries(parsed.positions ?? {}).map(([key, positions]) => [
                    key,
                    Object.fromEntries(
                        Object.entries(positions).map(([part, range]) => [
                            part,
                            { start: range.start + end + 2, end: range.end + end + 2 },
                        ]),
                    ),
                ]),
            ),
        };
        if (parsed.id) token.attrSet("id", slugify(parsed.id));
        if (parsed.classes.length) token.attrSet("class", parsed.classes.join(" "));
        for (const [key, value] of Object.entries(parsed.values))
            if (!refusedAttributes({ [key]: value }).length) token.attrSet(key, value);
        const nested = [];
        state.md.inline.parse(state.src.slice(start + 1, end), state.md, state.env, nested);
        for (const child of nested)
            if (child.meta?.span) {
                child.meta.start += start + 1;
                child.meta.end += start + 1;
                for (const positions of Object.values(child.meta.attributePositions ?? {}))
                    for (const range of Object.values(positions)) {
                        range.start += start + 1;
                        range.end += start + 1;
                    }
            }
        state.tokens.push(...nested);
        state.push("span_close", emphasis ?? "span", -1);
        state.pos = finish;
        return true;
    });
}

const parser = new MarkdownIt({ html: true })
    .use(footnotePlugin)
    .use(alertMarkdownPlugin)
    .use(spanMarkdownPlugin);
/** Read span anchors and located attribute diagnostics outside literal code.
 * @param {string} source - Authored Markdown.
 * @returns {import("./name-markup.mjs").SpanScan} Actual spans, explicit names and located diagnostics.
 */
export function scanSpans(source) {
    const text = String(source ?? ""),
        env = {},
        tokens = parser.parse(text, env),
        spans = [],
        errors = [];
    const lines = text.split("\n"),
        starts = [];
    let offset = 0;
    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }
    const located = (start, end) => {
        let lo = 0,
            hi = starts.length;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >>> 1;
            if (starts[mid] <= start) lo = mid;
            else hi = mid;
        }
        return { start, end, line: lo + 1, column: start - starts[lo] + 1 };
    };
    const collect = (children, position) => {
        for (const [index, child] of (children ?? []).entries()) {
            if (!child.meta?.span) continue;
            const start = position(child.meta.start),
                end = position(child.meta.end);
            const { line, column } = located(start, end);
            let depth = 1,
                close = index + 1;
            for (; close < children.length; close++) {
                if (children[close].type === "span_open") depth++;
                if (children[close].type === "span_close" && --depth === 0) break;
            }
            spans.push({
                id: child.attrGet("id") ?? "",
                line,
                column,
                start,
                end,
                text: child.meta.text,
                contentEnd: position(child.meta.start + 1 + child.meta.text.length),
                visible: inlineText(children.slice(index + 1, close)),
                attrs: child.attrs ?? [],
                attributePositions: Object.fromEntries(
                    Object.entries(child.meta.attributePositions ?? {}).map(([key, positions]) => [
                        key,
                        Object.fromEntries(
                            Object.entries(positions).map(([part, range]) => [
                                part,
                                located(position(range.start), position(range.end)),
                            ]),
                        ),
                    ]),
                ),
            });
            for (const message of child.meta.problems) errors.push({ line, column, message });
        }
    };
    let row;
    for (const token of tokens) {
        if (token.type === "tr_open" && token.map) {
            const line = lines[token.map[0]],
                offsets = [];
            let content = "";
            // The existing table rule removes a backslash immediately before
            // a pipe. Retain that projection's original character positions;
            // actual row/cell tokens still own all table parsing and trimming.
            for (let i = 0; i < line.length; i++) {
                if (line[i] === "\\" && line[i + 1] === "|") continue;
                offsets.push(i);
                content += line[i];
            }
            offsets.push(line.length);
            row = { content, offsets, line: token.map[0], cursor: 0 };
        } else if (token.type === "tr_close") row = undefined;
        if (token.type !== "inline") continue;
        if (!token.map) {
            if (!row) continue;
            const column = row.content.indexOf(token.content, row.cursor);
            if (column < 0) continue;
            row.cursor = column + token.content.length;
            collect(token.children, (pos) => starts[row.line] + row.offsets[column + pos]);
            continue;
        }
        const contentLines = token.content.split("\n"),
            positions = [];
        let local = 0;
        for (let n = 0; n < contentLines.length; n++) {
            const sourceLine = token.map[0] + n;
            const column = lines[sourceLine]?.indexOf(contentLines[n]) ?? -1;
            positions.push({ local, absolute: starts[sourceLine] + Math.max(0, column) });
            local += contentLines[n].length + 1;
        }
        collect(token.children, (pos) => {
            const mapping = positions.findLast((mapping) => mapping.local <= pos) ?? positions[0];
            return mapping.absolute + pos - mapping.local;
        });
    }
    // Verse fences preserve inline Markdown even though the block parser
    // normally treats every code fence as literal text.
    for (const poem of scanVerse(text).blocks) {
        for (let line = poem.start + 1; line < poem.end; line++) {
            const children = [];
            parser.inline.parse(lines[line], parser, env, children);
            collect(children, (pos) => starts[line] + pos);
        }
    }
    spans.sort((a, b) => a.start - b.start);
    errors.sort((a, b) => a.line - b.line || a.column - b.column);
    return {
        spans,
        names: spans.filter((span) =>
            span.attrs.some(
                ([key, value]) => key === "class" && value.split(/\s+/).includes("name"),
            ),
        ),
        errors,
    };
}

/** Emit span tags while leaving their inline content as Markdown.
 * @param {string} source - Authored Markdown.
 */
export function renderSpans(source) {
    const { spans, errors } = scanSpans(source);
    let markdown = String(source ?? "");
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    for (const span of spans
        .filter(
            (span) => !spans.some((parent) => parent.start < span.start && parent.end >= span.end),
        )
        .sort((a, b) => b.start - a.start)) {
        const classes = (span.attrs.find(([key]) => key === "class")?.[1] ?? "").split(/\s+/);
        const tag =
            classes.includes("emph") ? "em"
            : classes.includes("strong") ? "strong"
            : "span";
        const attrs = span.attrs
            .flatMap(([key, value]) => {
                if (key === "class" && tag !== "span") {
                    value = value
                        .split(/\s+/)
                        .filter((name) => !["emph", "strong"].includes(name))
                        .join(" ");
                    if (!value) return [];
                }
                return [` ${key}="${escape(value)}"`];
            })
            .join("");
        const inner = renderSpans(markdown.slice(span.start + 1, span.contentEnd)).markdown;
        const secret = span.attrs.some(
            ([key, value]) => key === "class" && value.split(/\s+/).includes("secret"),
        );
        const content =
            secret ?
                `<span${attrs} data-inline-secret data-pagefind-ignore><button type="button" class="inline-secret-toggle" aria-label="Show spoiler" aria-expanded="false">Show spoiler</button><span class="inline-secret-content" hidden>${inner}</span></span>`
            :   `<${tag}${attrs}>${inner}</${tag}>`;
        markdown = markdown.slice(0, span.start) + content + markdown.slice(span.end);
    }
    return { markdown, errors };
}
