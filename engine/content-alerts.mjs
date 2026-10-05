/* SPDX-License-Identifier: GPL-3.0-or-later */
import MarkdownIt from "markdown-it";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";
import { slugify } from "./content-slug.mjs";

const icon = (body) =>
    `<svg class="alert-icon" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${body}</svg>`;
/** Alert titles and static icons shared by all publishing surfaces. */
export const ALERT_TYPES = Object.freeze({
    note: {
        title: "Note",
        icon: icon(
            '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z"/><circle cx="8" cy="5" r="1"/><path d="M7.25 7h1.5v5h-1.5z"/>',
        ),
    },
    tip: {
        title: "Tip",
        icon: icon(
            '<path d="M8 0a5 5 0 0 0-3 9v2h6V9a5 5 0 0 0-3-9Zm0 1.5A3.5 3.5 0 0 1 10 8l-.5.4v1.1h-3V8.4L6 8a3.5 3.5 0 0 1 2-6.5ZM5 12h6v1.5H5zm1 2.5h4V16H6z"/>',
        ),
    },
    important: {
        title: "Important",
        icon: icon(
            '<path d="M2 1h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6l-4 3V2a1 1 0 0 1 0-1Zm1.5 1.5V12l2-1.5h8V2.5Z"/><path d="M7.25 4h1.5v3.5h-1.5z"/><circle cx="8" cy="9" r="1"/>',
        ),
    },
    warning: {
        title: "Warning",
        icon: icon(
            '<path d="M8 0 0 15h16L8 0Zm0 3 5.5 10.5h-11L8 3Z"/><path d="M7.25 6h1.5v4h-1.5z"/><circle cx="8" cy="12" r="1"/>',
        ),
    },
    caution: {
        title: "Caution",
        icon: icon(
            '<path d="m5 0-5 5v6l5 5h6l5-5V5l-5-5H5Zm.6 1.5h4.8l4.1 4.1v4.8l-4.1 4.1H5.6l-4.1-4.1V5.6Z"/><path d="M7.25 4h1.5v5h-1.5z"/><circle cx="8" cy="11.5" r="1"/>',
        ),
    },
});
const parser = new MarkdownIt();
const titleParser = new MarkdownIt({ html: false });
const marker = /^ {0,3}>[ \t]?\[!([^\]\n]+)\](.*)$/;
/** Read alerts outside code examples, retaining inclusive source line ranges.
 * @param {string} source - Authored Markdown.
 */
export function scanAlerts(source) {
    const text = String(source ?? ""),
        lines = text.split("\n"),
        blocks = [],
        errors = [];
    let depth = 0;
    for (const token of parser.parse(text, {})) {
        if (token.type === "blockquote_close") {
            depth--;
            continue;
        }
        if (token.type !== "blockquote_open" || !token.map) continue;
        depth++;
        const [start, after] = token.map;
        let first = lines[start] ?? "";
        for (let level = 1; level < depth; level++) first = first.replace(/^ {0,3}>[ \t]?/, "");
        const match = marker.exec(first);
        if (!match) {
            if (/^ {0,3}>[ \t]?\[!/.test(first))
                errors.push({
                    line: start + 1,
                    column: lines[start].indexOf("[") + 1,
                    message: "alert marker needs [!TYPE] brackets",
                });
            continue;
        }
        const at = { line: start + 1, column: lines[start].indexOf("[") + 1 };
        const type = match[1].toLowerCase();
        if (match[1] !== match[1].toUpperCase() || !Object.hasOwn(ALERT_TYPES, type)) {
            errors.push({
                ...at,
                message: `unknown alert type ${match[1]}; use NOTE, TIP, IMPORTANT, WARNING or CAUTION`,
            });
            continue;
        }
        const raw = match[2].trim();
        let parsed = { id: "", classes: [], values: {}, problems: [] };
        if (raw) {
            if (!/^\{.*\}$/.test(raw))
                parsed.problems.push(
                    "alert attributes need {…} braces immediately after the marker",
                );
            else parsed = parseExtensionAttributes(raw.slice(1, -1));
        }
        for (const message of [...parsed.problems, ...refusedAttributes(parsed.values)])
            errors.push({ ...at, message });
        const body = lines
            .slice(start + 1, after)
            .map((line) => {
                for (let level = 0; level < depth; level++)
                    line = line.replace(/^ {0,3}>[ \t]?/, "");
                return line;
            })
            .join("\n")
            .trimEnd();
        if (!body.trim())
            errors.push({ ...at, message: `${ALERT_TYPES[type].title} alert needs a body` });
        const attributes = Object.fromEntries(
            Object.entries(parsed.values).filter(
                ([key, value]) => !refusedAttributes({ [key]: value }).length,
            ),
        );
        const title = attributes.title ?? ALERT_TYPES[type].title;
        delete attributes.title;
        blocks.push({
            start,
            end: after - 1,
            depth,
            type,
            title,
            id: parsed.id,
            classes: parsed.classes,
            attributes,
            body,
        });
    }
    return { blocks, errors };
}
/** Render alert wrappers while preserving ordinary Markdown and note footnotes.
 * @param {string} source - Authored Markdown.
 * @param {"web"|"foundry"} [target="web"] - Publishing surface.
 */
export function renderAlerts(source, target = "web") {
    const { blocks, errors } = scanAlerts(source),
        lines = String(source ?? "").split("\n"),
        output = [];
    let cursor = 0;
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    for (const block of blocks.filter(
        (block) => !blocks.some((parent) => parent.start < block.start && parent.end >= block.end),
    )) {
        output.push(...lines.slice(cursor, block.start));
        const attrs = [
            `class="${escape(["alert", `alert-${block.type}`, ...block.classes].join(" "))}"`,
        ];
        if (block.id) attrs.push(`id="${escape(slugify(block.id))}"`);
        for (const [key, value] of Object.entries(block.attributes))
            attrs.push(`${key}="${escape(value)}"`);
        const definition = ALERT_TYPES[block.type];
        output.push(
            "",
            `<aside ${attrs.join(" ")}>`,
            `<header class="alert-title">${definition.icon} ${titleParser.renderInline(block.title)}</header>`,
            "",
            renderAlerts(block.body, target).markdown,
            "",
            "</aside>",
            "",
        );
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors };
}
/** Mark alert blockquotes and remove their marker before inline parsing.
 * @param {import("markdown-it")} md - Markdown parser to extend.
 */
export function alertMarkdownPlugin(md) {
    md.core.ruler.before("inline", "alert_markers", (state) => {
        const alerts = scanAlerts(state.src).blocks;
        const depths = new Map();
        let depth = 0;
        for (let i = 0; i < state.tokens.length; i++) {
            if (state.tokens[i].type === "blockquote_open") depths.set(i, ++depth);
            if (state.tokens[i].type === "blockquote_close") depth--;
        }
        for (let i = state.tokens.length - 1; i >= 0; i--) {
            const token = state.tokens[i];
            if (token.type !== "blockquote_open") continue;
            const block = alerts.find(
                (block) => token.map?.[0] === block.start && depths.get(i) === block.depth,
            );
            if (!block) continue;
            token.meta = { ...token.meta, alert: block };
            const inline = state.tokens[i + 2];
            if (state.tokens[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline")
                continue;
            const newline = inline.content.indexOf("\n");
            if (newline < 0) state.tokens.splice(i + 1, 3);
            else {
                inline.content = inline.content.slice(newline + 1);
                if (inline.map) inline.map[0]++;
            }
        }
    });
}
