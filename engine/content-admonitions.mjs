/* SPDX-License-Identifier: GPL-3.0-or-later */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";
import { parseExtensionAttributes } from "./extension-attributes.mjs";

const parser = new MarkdownIt({ html: true }).use(footnotePlugin).use(deflistPlugin);
const OPEN = /^:::(info|warn)(?:\s+(.*))?\s*$/;
const CLOSE = /^:::\s*$/;
const STYLES = Object.freeze({
    info: { label: "Info", icon: "ℹ", color: "#2f6f9f", background: "#eef6fb" },
    warn: { label: "Warning", icon: "⚠", color: "#9a6700", background: "#fff5db" },
});

/** Find inline info and warning blocks without interpreting code examples. */
export function scanAdmonitions(source) {
    const lines = String(source ?? "").split("\n");
    const blocks = [];
    const errors = [];
    let opening = null;
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
        const open = OPEN.exec(line);
        if (open) {
            if (opening) {
                errors.push({
                    line: i + 1,
                    column: 1,
                    message: "nested info and warning blocks are not supported",
                });
                continue;
            }
            const raw = open[2]?.trim() ?? "";
            let id = "";
            if (raw) {
                if (!/^\{[^}\n]*\}$/.test(raw))
                    errors.push({
                        line: i + 1,
                        column: 1,
                        message: "block attributes need {#id} syntax",
                    });
                else {
                    const attrs = parseExtensionAttributes(raw.slice(1, -1));
                    id = attrs.id;
                    for (const message of attrs.problems)
                        errors.push({ line: i + 1, column: 1, message });
                    if (attrs.classes.length || Object.keys(attrs.values).length)
                        errors.push({
                            line: i + 1,
                            column: 1,
                            message: "info and warn accept only an id",
                        });
                }
            }
            opening = { start: i, kind: open[1], id };
            continue;
        }
        if (CLOSE.test(line) && opening) {
            const body = lines
                .slice(opening.start + 1, i)
                .join("\n")
                .trim();
            if (!body)
                errors.push({
                    line: opening.start + 1,
                    column: 1,
                    message: `${opening.kind} block is empty`,
                });
            blocks.push({ ...opening, end: i, body });
            opening = null;
        }
    }
    if (opening)
        errors.push({
            line: opening.start + 1,
            column: 1,
            message: `${opening.kind} block needs a closing ::: line`,
        });
    return { blocks, errors };
}

/** Render info and warning blocks as styled, labelled HTML. */
export function renderAdmonitions(source, renderMarkdown = parser.render.bind(parser)) {
    const { blocks, errors } = scanAdmonitions(source);
    if (errors.length) return { markdown: source, errors };
    const lines = String(source ?? "").split("\n");
    const output = [];
    let cursor = 0;
    for (const block of blocks) {
        const style = STYLES[block.kind];
        output.push(...lines.slice(cursor, block.start));
        output.push(
            `<aside${block.id ? ` id="${block.id}"` : ""} class="sohl-admonition sohl-admonition-${block.kind}" style="border-left: 3px solid ${style.color}; background: ${style.background}; padding: 0.5em 0.8em; margin: 0.75em 0;">`,
            `<p><strong><span aria-hidden="true">${style.icon}</span> ${style.label}</strong></p>`,
            renderMarkdown(block.body).trim(),
            "</aside>",
        );
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors: [] };
}
