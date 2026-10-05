/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * General divs and the `:::secret` disclosure fence.
 *
 * ```
 * :::secret {#route title="For the GM" .wide}
 * The ford floods in Azlet.
 * :::
 * ```
 *
 * The secret fence carries the `secret` class and a heading, defaulting to
 * `Secret`. General divs carry only authored classes and ordinary attributes.
 * The author supplies secret headings through the reserved `title` attribute.
 * Neither construct adds inline styles.
 *
 * Each block stands on its own: a malformed one is a finding at its own line
 * and the blocks around it still render.
 *
 * **An H1, or an anchored heading at any level, is refused inside a block.**
 * Either starts a Foundry journal page, which would tear the block's own
 * page in two and publish the rest with no wrapper around it at all.
 *

 * **One pass reads named blocks and general divs.**
 *
 * **A block's body is left as Markdown, not pre-rendered.** The wrapper is
 * written with a blank line after the opening tag and before the closing one,
 * which is what lets the surrounding renderer — Foundry's single parse of the
 * whole page, or Hugo's of the whole site page — read the body as part of its
 * own document rather than as an isolated fragment. A fragment rendered on its
 * own has no access to the note's footnote definitions, which live at the top
 * level outside every block, so a reference inside one used to fall through as
 * literal `[^id]` text; reached by the one parse that also sees the
 * definitions, it resolves exactly as a reference inside a list item or a
 * block quote already does.
 *
 * @module
 */

import crypto from "node:crypto";
import { slugify } from "./content-slug.mjs";
import MarkdownIt from "markdown-it";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";
import { scanPoetry, renderPoetry } from "./content-poetry.mjs";
import { WITHHELD_CLASS, parseHeadingLine, withheldSections } from "./heading-attributes.mjs";

/**
 * Titles carry emphasis and nothing else. `html: false` escapes any tag an
 * author writes there, because a title is written into an element's first child
 * and a stray `<section>` would close the block early.
 */
const titleParser = new MarkdownIt({ html: false });

/** The blocks an author may open, with the heading each takes by default. */
export const BLOCK_NAMES = Object.freeze({
    secret: "Secret",
});

/**
 * Container fences whose bodies are scanned and rendered recursively.
 *
 * A secret may hold general divs; a general div may hold another div or a
 * secret. A secret nested directly within another secret is refused.
 *
 * @type {readonly string[]}
 */
export const BLOCK_CONTAINERS = Object.freeze(["secret", "div"]);

const names = () => [...Object.keys(BLOCK_NAMES), "div"].join(", ");

/** Text safe inside a double-quoted attribute. */
function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Find named blocks, leaving code examples alone.
 *
 * A block reaches `blocks` only when it is well formed and closed; everything
 * else is a finding, and the surrounding blocks are unaffected.
 *
 * @param {string} source - Markdown that may contain named blocks.
 * @returns {{blocks: Array<{name: string, title: string, id: string, classes: string[], attributes: Record<string, string>, start: number, end: number, body: string}>, errors: Array<{line: number, column: number, message: string}>}}
 */
export function scanBlocks(source) {
    const lines = String(source ?? "").split("\n"),
        blocks = [],
        errors = [];
    const stack = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const code = /^ *(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (
                code &&
                code[1][0] === fence[0] &&
                code[1].length >= fence.length &&
                !code[2].trim()
            )
                fence = null;
            continue;
        }
        if (code) {
            fence = code[1];
            continue;
        }
        const close = /^ *:::\s*$/.test(line);
        const named = /^ *:::([A-Za-z][A-Za-z0-9-]*)(?:\s+(.*))?$/.exec(line);
        const div = /^ *:::\s+(\{.*)$/.exec(line);
        if (close && stack.length) {
            const block = stack.pop();
            if (block.rejected) continue;
            block.end = i;
            block.body = lines
                .slice(block.start + 1, i)
                .join("\n")
                .trim();
            if (!block.body)
                errors.push({
                    line: block.start + 1,
                    column: 1,
                    message: `${block.name} block is empty`,
                });
            if (!stack.length) blocks.push(block);
            continue;
        }
        if (!close && !named && !div) continue;
        const name = named?.[1] ?? "div",
            raw = named?.[2] ?? div?.[1] ?? "";
        const at = { line: i + 1, column: 1 };
        if (name !== "div" && !Object.hasOwn(BLOCK_NAMES, name)) {
            errors.push({ ...at, message: `there is no ${name} block; the blocks are ${names()}` });
            stack.push({ start: i, rejected: true });
            continue;
        }
        if (stack.length && name !== "div" && !["secret", "div"].includes(stack.at(-1).name)) {
            errors.push({ ...at, message: `nested ${name} blocks are not supported` });
            stack.push({ start: i, rejected: true });
            continue;
        }
        if (stack.length && name === "secret" && stack.at(-1).name === "secret") {
            errors.push({ ...at, message: "nested secret blocks are not supported" });
            stack.push({ start: i, rejected: true });
            continue;
        }
        let parsed = { id: "", classes: [], values: {}, problems: [] };
        if (raw.trim()) {
            if (!/^\{[^}\n]*\}$/.test(raw.trim()))
                parsed.problems.push("block attributes need {…} braces");
            else parsed = parseExtensionAttributes(raw.trim().slice(1, -1));
        }
        for (const message of [...parsed.problems, ...refusedAttributes(parsed.values)])
            errors.push({ ...at, message });
        const attributes = { ...parsed.values };
        let title = BLOCK_NAMES[name] ?? "";
        if (name !== "div" && Object.hasOwn(attributes, "title")) {
            title = attributes.title;
            delete attributes.title;
        }
        stack.push({
            start: i,
            name,
            title,
            id: parsed.id,
            classes: parsed.classes,
            attributes,
            rejected: parsed.problems.length > 0 || refusedAttributes(parsed.values).length > 0,
            indent: /^ */.exec(line)[0],
        });
    }
    for (const block of stack)
        if (!block.rejected)
            errors.push({
                line: block.start + 1,
                column: 1,
                message: `${block.name} block needs a closing ::: line`,
            });
    for (const block of blocks) {
        let literal = null;
        for (let i = block.start + 1; i < block.end; i++) {
            const marker = /^ *(`{3,}|~{3,})(.*)$/.exec(lines[i]);
            if (literal) {
                if (
                    marker &&
                    marker[1][0] === literal[0] &&
                    marker[1].length >= literal.length &&
                    !marker[2].trim()
                )
                    literal = null;
                continue;
            }
            if (marker) {
                literal = marker[1];
                continue;
            }
            if (parseHeadingLine(lines[i])?.startsPage)
                errors.push({
                    line: i + 1,
                    column: 1,
                    message: `a heading that starts a page cannot be written inside a ${block.name} block — keep an H1 or an anchored heading at the top level, or drop the anchor and the level to stay inside it`,
                });
        }
    }
    return { blocks, errors: [...errors, ...scanPoetry(source).errors] };
}

/**
 * The id an element carries.
 *
 * A `secret` with no id of its own is given one derived from its body, because
 * Foundry tracks a revealed section by id and a section without one cannot be
 * remembered.
 */
function elementId(block, target) {
    if (block.id) return slugify(block.id);
    if (target !== "foundry" || block.name !== "secret") return "";
    const digest = crypto
        .createHash("sha256")
        .update(`${block.start}:${block.body}`)
        .digest("hex")
        .slice(0, 12);
    return `secret-${digest}`;
}

/** The attribute text shared by both surfaces, id and classes first. */
function attributeText(block, target, classes) {
    const id = elementId(block, target);
    const parts = [`class="${escapeAttribute(classes.join(" "))}"`];
    if (id) parts.push(`id="${escapeAttribute(id)}"`);
    for (const [key, value] of Object.entries(block.attributes)) {
        const attribute = key;
        parts.push(`${attribute}="${escapeAttribute(value)}"`);
    }
    return parts.join(" ");
}

/**
 * Render named blocks for one publishing surface.
 *
 * `foundry` emits a `<section>` whose heading is its first line; `web` emits a
 * `<details>` the reader opens. Neither carries an inline `style`.
 *
 * The body is left as Markdown between the wrapper's tags, each separated from
 * its tag by a blank line — see the module docs for why that is what lets the
 * surrounding render treat the body as real content rather than an opaque
 * fragment.
 *
 * A finding does not stop the well-formed blocks around it from rendering.
 *
 * @param {string} source - Markdown containing named blocks.
 * @param {"foundry"|"web"} target - Publishing surface.
 * @returns {{markdown: string, errors: Array<{line: number, column: number, message: string}>}}
 */
export function renderBlocks(source, target) {
    const { errors } = scanBlocks(source);
    source = renderPoetry(source).markdown;
    const renderedBlocks = scanBlocks(source).blocks;
    if (!renderedBlocks.length) return { markdown: String(source ?? ""), errors };
    const lines = String(source ?? "").split("\n");
    const output = [];
    let cursor = 0;
    for (const block of renderedBlocks) {
        output.push(...lines.slice(cursor, block.start));
        const classes = [...(block.name === "div" ? [] : [block.name]), ...block.classes];
        const attributes = attributeText(block, target, classes);
        // A container's body may hold a block of its own, rendered first so
        // its own wrapper is already written when the outer one wraps it in
        // turn — nesting composes because each level is markdown-with-raw-HTML
        // at every depth, never a rendered fragment.
        const held =
            BLOCK_CONTAINERS.includes(block.name) ?
                renderBlocks(block.body, target).markdown
            :   block.body;
        if (block.name === "div") {
            output.push("", `<div ${attributes}>`, "", held, "", "</div>", "");
            cursor = block.end + 1;
            continue;
        }
        const title = titleParser.renderInline(block.title);
        if (target === "foundry") {
            output.push(
                "",
                `<section ${attributes}>`,
                `<strong>${title}</strong>:<br/>`,
                "",
                held,
                "",
                "</section>",
                "",
            );
        } else {
            output.push(
                "",
                `<details ${attributes}>`,
                `<summary class="${escapeAttribute(block.name)}">${title}</summary>`,
                "",
                held,
                "",
                "</details>",
                "",
            );
        }
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors };
}

/**
 * Wrap each withheld section in the disclosure a `secret` block renders as.
 *
 * The section's own Markdown is left as Markdown, with a blank line either side
 * of it, so the page's renderer still reads it: the heading keeps its id, the
 * prose keeps its links, and only the disclosure around them is written as HTML.
 *
 * **A spoiler, not access control.** The section is in the published page, so a
 * reader who opens the element or reads the source reads it. Foundry is the one
 * surface that withholds anything.
 *
 * @param {string} source - A page's Markdown, headings intact.
 * @returns {string} The same Markdown, each withheld section inside a
 *   `<details>`.
 */
export function renderWithheldSections(source) {
    const text = String(source ?? "");
    const { sections } = withheldSections(text);
    if (!sections.length) return text;
    const lines = text.split("\n");
    const output = [];
    let cursor = 0;
    for (const section of sections) {
        output.push(...lines.slice(cursor, section.start));
        const classes = [
            WITHHELD_CLASS,
            ...section.heading.classes.filter((name) => name !== WITHHELD_CLASS),
        ];
        output.push(
            "",
            `<details class="${escapeAttribute(classes.join(" "))}">`,
            `<summary class="${escapeAttribute(WITHHELD_CLASS)}">${BLOCK_NAMES[WITHHELD_CLASS]}</summary>`,
            "",
            ...lines.slice(section.start, section.end),
            "",
            "</details>",
            "",
        );
        cursor = section.end;
    }
    output.push(...lines.slice(cursor));
    return output.join("\n");
}
