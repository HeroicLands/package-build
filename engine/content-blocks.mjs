/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Named body blocks — `:::secret`, `:::info` and `:::warn` — as one construct.
 *
 * ```
 * :::info {#route title="The road north" .wide}
 * The ford floods in Azlet.
 * :::
 * ```
 *
 * The block's name becomes its first class, the author's classes follow it, and
 * every other attribute is written onto the element. `title` is reserved: it
 * supplies the heading, and a block that states none takes the capitalised name
 * — `Secret`, `Info`, `Warn`.
 *
 * The three names differ in the class they carry and in nothing else, so a
 * stylesheet owns their appearance. None is emitted with an inline `style`.
 *
 * Each block stands on its own: a malformed one is a finding at its own line
 * and the blocks around it still render.
 *
 * **One pass reads all three names.** Reading them in two passes made the first
 * one meet the second's closers with nothing open, and report a block the author
 * had not written. A construct this pass does not own — `:::caption` — is
 * counted rather than claimed, so its closer is attributed to it and the pass
 * that owns it still finds it in the markdown this one passes through.
 *
 * @module
 */

import crypto from "node:crypto";
import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";
import { WITHHELD_CLASS, withheldSections } from "./heading-attributes.mjs";

const parser = new MarkdownIt({ html: true }).use(footnotePlugin).use(deflistPlugin);

/**
 * Titles carry emphasis and nothing else. `html: false` escapes any tag an
 * author writes there, because a title is written into an element's first child
 * and a stray `<section>` would close the block early.
 */
const titleParser = new MarkdownIt({ html: false });

const OPEN = /^:::([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSE = /^:::[ \t]*$/;

/** The blocks an author may open, with the heading each takes by default. */
export const BLOCK_NAMES = Object.freeze({
    info: "Info",
    secret: "Secret",
    warn: "Warn",
});

/**
 * Blocks that may hold another named block.
 *
 * A box inside a GM-only section is a real thing to write — the section is a
 * container for whatever the GM reads, boxes included — so a `secret` holds one
 * and the box stays inside it. A box inside a box is noise, so `info` and `warn`
 * hold no named block and a second opener inside one is a finding.
 *
 * Exported because a renderer has to know it: the body of a container is read
 * for blocks of its own, and the body of a box is not.
 *
 * @type {readonly string[]}
 */
export const BLOCK_CONTAINERS = Object.freeze(["secret"]);

/**
 * Constructs another pass owns. A `:::caption` is read by the caption pass, so
 * this one **counts it and does not claim it**: the opener and its closer pass
 * through untouched, and the count is what lets a closer be attributed to the
 * innermost block actually open. Claiming one would report a block that does not
 * exist and take the caption out of the note.
 */
const FOREIGN = Object.freeze(["caption"]);

/** `title` is the heading. Everything else an author writes becomes an attribute. */
const TITLE = "title";

const names = () => Object.keys(BLOCK_NAMES).join(", ");

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
    const lines = String(source ?? "").split("\n");
    const blocks = [];
    const errors = [];
    let opening = null;
    let codeFence = null;
    // Blocks open inside this pass's own block, and blocks of another
    // construct open outside it, counted so a `:::` closes the innermost thing
    // rather than whatever this pass happens to have open.
    let innerOpen = 0;
    let foreignOutside = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length) {
                codeFence = null;
            }
            continue;
        }
        if (fence) {
            codeFence = fence[1];
            continue;
        }

        if (CLOSE.test(line)) {
            // A closer belongs to the innermost block still open, whichever
            // pass owns it.
            if (opening && innerOpen > 0) {
                innerOpen -= 1;
                continue;
            }
            if (!opening) {
                if (foreignOutside > 0) {
                    foreignOutside -= 1;
                    continue;
                }
                errors.push({ line: i + 1, column: 1, message: "a ::: line closes no block" });
                continue;
            }
            if (opening.rejected) {
                opening = null;
                continue;
            }
            const body = lines
                .slice(opening.start + 1, i)
                .join("\n")
                .trim();
            if (!body) {
                errors.push({
                    line: opening.start + 1,
                    column: 1,
                    message: `${opening.name} block is empty`,
                });
                opening = null;
                continue;
            }
            blocks.push({ ...opening, end: i, body });
            opening = null;
            continue;
        }

        const open = OPEN.exec(line);
        if (!open) continue;
        const [, name, raw = ""] = open;
        const at = { line: i + 1, column: 1 };
        if (FOREIGN.includes(name)) {
            if (opening) innerOpen += 1;
            else foreignOutside += 1;
            continue;
        }
        if (!Object.hasOwn(BLOCK_NAMES, name)) {
            errors.push({ ...at, message: `there is no ${name} block; the blocks are ${names()}` });
            opening = { start: i, rejected: true };
            continue;
        }
        if (opening) {
            if (BLOCK_CONTAINERS.includes(opening.name) && !BLOCK_CONTAINERS.includes(name)) {
                // Held by the block it is written in, and counted so the
                // closers are attributed in the order they were opened. The
                // body is rendered for its own blocks before it is rendered as
                // markdown, so the inner block comes out as a block.
                innerOpen += 1;
                continue;
            }
            // Not counted, unlike a block the outer one holds: the nesting is
            // already reported, and counting it would leave the outer block
            // looking unclosed as well — two findings for one mistake.
            errors.push({ ...at, message: `nested ${name} blocks are not supported` });
            continue;
        }

        let id = "";
        let classes = [];
        const attributes = {};
        let title = BLOCK_NAMES[name];
        const text = raw.trim();
        if (text) {
            if (!/^\{[^}\n]*\}$/.test(text)) {
                errors.push({ ...at, message: "block attributes need {…} braces" });
                opening = { start: i, rejected: true };
                continue;
            }
            const parsed = parseExtensionAttributes(text.slice(1, -1));
            if (parsed.problems.length) {
                for (const message of parsed.problems) errors.push({ ...at, message });
                opening = { start: i, rejected: true };
                continue;
            }
            id = parsed.id;
            classes = parsed.classes;
            const refused = refusedAttributes(parsed.values);
            for (const message of refused) errors.push({ ...at, message });
            if (refused.length) {
                opening = { start: i, rejected: true };
                continue;
            }
            for (const [key, value] of Object.entries(parsed.values)) {
                if (key === TITLE) title = value;
                else attributes[key] = value;
            }
        }
        opening = { start: i, name, title, id, classes, attributes };
    }

    if (opening && !opening.rejected) {
        errors.push({
            line: opening.start + 1,
            column: 1,
            message: `${opening.name} block needs a closing ::: line`,
        });
    }
    return { blocks, errors };
}

/**
 * The id an element carries.
 *
 * A `secret` with no id of its own is given one derived from its body, because
 * Foundry tracks a revealed section by id and a section without one cannot be
 * remembered.
 */
function elementId(block, target) {
    if (block.id) return block.id;
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
        parts.push(`${key}="${escapeAttribute(value)}"`);
    }
    return parts.join(" ");
}

/**
 * Render named blocks for one publishing surface.
 *
 * `foundry` emits a `<section>` whose heading is its first line; `web` emits a
 * `<details>` the reader opens. Neither carries an inline `style`.
 *
 * A finding does not stop the well-formed blocks around it from rendering.
 *
 * @param {string} source - Markdown containing named blocks.
 * @param {"foundry"|"web"} target - Publishing surface.
 * @param {(markdown: string) => string} [renderMarkdown] - Body renderer.
 * @returns {{markdown: string, errors: Array<{line: number, column: number, message: string}>}}
 */
export function renderBlocks(source, target, renderMarkdown = parser.render.bind(parser)) {
    const { blocks, errors } = scanBlocks(source);
    if (!blocks.length) return { markdown: String(source ?? ""), errors };
    const lines = String(source ?? "").split("\n");
    const output = [];
    let cursor = 0;
    for (const block of blocks) {
        output.push(...lines.slice(cursor, block.start));
        const classes = [block.name, ...block.classes];
        const attributes = attributeText(block, target, classes);
        const title = titleParser.renderInline(block.title);
        // A container's body may hold a block of its own. Rendering it first
        // leaves HTML the markdown renderer passes through, so the held block
        // comes out as a block rather than as the `:::` lines an author wrote.
        const held =
            BLOCK_CONTAINERS.includes(block.name) ?
                renderBlocks(block.body, target, renderMarkdown).markdown
            :   block.body;
        const body = renderMarkdown(held).trim();
        if (target === "foundry") {
            output.push(
                "",
                `<section ${attributes}>`,
                `<strong>${title}</strong>:<br/>`,
                body,
                "</section>",
                "",
            );
        } else {
            output.push(
                "",
                `<details ${attributes}>`,
                `<summary class="${escapeAttribute(block.name)}">${title}</summary>`,
                body,
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
