/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";

import { slugify } from "./content-slug.mjs";
import { parseExtensionAttributes } from "./extension-attributes.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "./heading-attributes.mjs";

const parser = new MarkdownIt({ html: true }).use(footnotePlugin).use(deflistPlugin);
const OPEN = /^:::caption\s+(\{[^}\n]*\})\s*$/;
const CAPTION_LINE = /^:::caption\b/;
const CLOSE = /^:::\s*$/;

/** A caption's automatically determined kind. */
export const CAPTION_NAMES = Object.freeze({
    code: "Code",
    table: "Table",
    figure: "Figure",
    prose: "Prose",
});

/** Number a sequence of captions with counters shared across documents. */
export function numberCaptions(captions, counts) {
    return captions.map((caption) => {
        const number = (counts[caption.kind] ?? 0) + 1;
        counts[caption.kind] = number;
        return { ...caption, number, label: `${CAPTION_NAMES[caption.kind]} ${number}` };
    });
}

/**
 * Read caption directives and the Markdown block immediately after each one.
 * SQL fences are expanded before this pass, so their output is a table.
 *
 * @param {string} source - A note body with expanded tables.
 * @returns {{captions: Array<{id: string, text: string, kind: string, number: number,
 *   label: string, line: number, blockStart: number, blockEnd: number,
 *   directiveEnd: number}>, errors: Array<{line: number, column: number, message: string}>}}
 */
export function scanCaptions(source) {
    const lines = String(source ?? "").split("\n");
    const captions = [];
    const errors = [];
    const counts = { code: 0, table: 0, figure: 0, prose: 0 };
    const ids = new Set();
    const headingIds = [];
    let codeFence = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length)
                codeFence = null;
            continue;
        }
        if (fence) {
            codeFence = fence[1];
            continue;
        }
        const heading = HEADING_LINE.exec(line);
        const headingId = heading ? splitHeadingAttributes(heading[2]).id : "";
        if (headingId) headingIds.push({ id: slugify(headingId), line: i + 1 });
        if (!CAPTION_LINE.test(line)) continue;
        const open = OPEN.exec(line);
        if (!open) {
            errors.push({ line: i + 1, column: 1, message: "caption needs {#anchor} attributes" });
            continue;
        }
        const attributes = parseExtensionAttributes(open[1].slice(1, -1));
        if (
            attributes.problems.length ||
            !attributes.id ||
            attributes.classes.length ||
            Object.keys(attributes.values).length
        ) {
            errors.push({
                line: i + 1,
                column: 1,
                message: attributes.problems[0] ?? "caption accepts only {#anchor}",
            });
            continue;
        }
        const id = attributes.id;
        const start = i;
        let close = i + 1;
        while (close < lines.length && !CLOSE.test(lines[close])) close++;
        if (close === lines.length) {
            errors.push({ line: start + 1, column: 1, message: "caption needs a closing :::" });
            continue;
        }
        const caption = lines
            .slice(i + 1, close)
            .join("\n")
            .trim();
        if (!caption) errors.push({ line: start + 1, column: 1, message: "caption text is empty" });
        if (ids.has(slugify(id)))
            errors.push({ line: start + 1, column: 1, message: `duplicate caption id "${id}"` });
        ids.add(slugify(id));

        let next = close + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next === lines.length || CAPTION_LINE.test(lines[next])) {
            errors.push({ line: start + 1, column: 1, message: "caption needs a following block" });
            i = close;
            continue;
        }
        const tokens = parser.parse(lines.slice(next).join("\n"), {});
        const first = tokens.find((token) => token.level === 0 && token.map);
        if (!first) {
            errors.push({ line: start + 1, column: 1, message: "caption needs a following block" });
            i = close;
            continue;
        }
        const blockEnd = next + first.map[1];
        const block = lines.slice(next, blockEnd).join("\n");
        const kind =
            first.type === "table_open" ? "table"
            : first.type === "fence" && /^\s*sql\b/i.test(first.info ?? "") ? "table"
            : first.type === "fence" || first.type === "code_block" ? "code"
            : /^(?:!\[|!\[\[|<figure\b|<img\b)/.test(block.trim()) ? "figure"
            : "prose";
        const number = ++counts[kind];
        captions.push({
            id,
            text: caption,
            kind,
            number,
            label: `${CAPTION_NAMES[kind]} ${number}`,
            line: start + 1,
            blockStart: next,
            blockEnd,
            directiveEnd: close + 1,
        });
        i = close;
    }
    for (const heading of headingIds) {
        if (ids.has(heading.id))
            errors.push({
                line: heading.line,
                column: 1,
                message: `heading and caption declare the same anchor "${heading.id}"`,
            });
    }
    return { captions, errors };
}

/** Render captioned blocks as HTML, leaving other Markdown untouched. */
export function renderCaptionBlocks(source, renderMarkdown = parser.render.bind(parser), numbers) {
    const { captions, errors } = scanCaptions(source);
    if (errors.length) return { markdown: source, errors };
    const byId = numbers ? new Map(numbers.map((entry) => [entry.id, entry])) : new Map();
    const lines = String(source ?? "").split("\n");
    const output = [];
    let cursor = 0;
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    for (const caption of captions) {
        output.push(...lines.slice(cursor, caption.line - 1));
        const numbered = byId.get(caption.id) ?? caption;
        let html = renderMarkdown(lines.slice(caption.blockStart, caption.blockEnd).join("\n"));
        if (caption.kind === "figure")
            html = html.replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/i, "");
        const captionHtml = parser.renderInline(caption.text);
        output.push(
            `<div id="${escape(slugify(caption.id))}" class="content-caption content-caption-${caption.kind}">`,
            html.trim(),
            `<p class="content-caption-label">${escape(numbered.label)}: ${captionHtml}</p>`,
            "</div>",
        );
        cursor = caption.blockEnd;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors: [] };
}
