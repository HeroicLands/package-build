/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Leading captions apply to the next supported Markdown block. @module */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";

import { slugify } from "./content-slug.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "./heading-attributes.mjs";
import { IMAGE_PATTERN } from "./content-images.mjs";

const parser = new MarkdownIt({ html: true }).use(footnotePlugin).use(deflistPlugin);
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * An asset embed as authored, with the directive it may carry.
 *
 * Written here rather than imported so this module stays a leaf: it is read by
 * {@link module:engine/anchors}, which is asked by the link checker, the
 * content index and every build, and none of them can afford the address
 * machinery an embed reader pulls in. Only the spelling is needed — this pass
 * resolves no address.
 */
const EMBED = /!\[\[[^\]\n]+\]\](?:\{[^}\n]*\})?/;

/** An embed, capturing its interior — reused to read the address it draws. */
const EMBED_INNER = /!\[\[([^\]\n]+)\]\]/g;

/**
 * An `<img>` tag's `src`, as the website hands this pass once its own image
 * pass has already turned a block picture into HTML.
 */
const HTML_IMG_SRC = /<img\b[^>]*\bsrc="([^"]*)"/g;

/** A figure's automatically determined kind, and the word that labels it. */
export const FIGURE_NAMES = Object.freeze({
    code: "Code",
    example: "Example",
    table: "Table",
    figure: "Figure",
    map: "Map",
    poem: "Poem",
    prose: "Prose",
});

/**
 * Historical built-in presentation classes, retained for theme consumers.
 * Captions now accept arbitrary classes through the shared attribute grammar.
 * @type {readonly string[]}
 */
export const FIGURE_CLASSES = Object.freeze(["border"]);

/** Number a sequence of figures with counters shared across documents. */
export function numberFigures(figures, counts) {
    return figures.map((figure) => {
        if (figure.numbered === false) return { ...figure, number: 0, label: "" };
        const number = (counts[figure.kind] ?? 0) + 1;
        counts[figure.kind] = number;
        return { ...figure, number, label: `${FIGURE_NAMES[figure.kind]} ${number}` };
    });
}

/** Text safe inside a double-quoted attribute, and as element text. */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Whether a fence's contents are pictures and nothing else.
 *
 * Read line by line on the raw contents, because the contents of a fence are
 * what the author grouped: a plate of two embeds is as much a figure as one is,
 * and a trailing sentence or a footnote reference beside a picture makes the
 * passage prose with a picture in it.
 *
 * @param {string} contents - The captioned contents, as authored.
 * @returns {boolean} Whether every line that carries anything is a picture.
 */
function picturesOnly(contents) {
    const lines = contents.split("\n").filter((line) => line.trim());
    if (!lines.length) return false;
    return lines.every((line) => {
        const stripped = line
            .replace(new RegExp(EMBED.source, "g"), "")
            .replace(new RegExp(IMAGE_PATTERN.source, "g"), "");
        return stripped !== line && !stripped.trim();
    });
}

/**
 * Every address a fence's pictures draw, across the three forms a picture
 * reaches this pass in: an embed's inner text before its `|`, a markdown
 * image's path, or an HTML `<img>`'s `src`.
 *
 * @param {string} contents - The fence's contents.
 * @returns {string[]} One address per picture, in source order.
 */
function pictureAddresses(contents) {
    const addresses = [];
    for (const match of contents.matchAll(EMBED_INNER)) {
        addresses.push(match[1].split("|")[0].trim());
    }
    for (const match of contents.matchAll(IMAGE_PATTERN)) {
        if (match[2]) addresses.push(match[2]);
    }
    for (const match of contents.matchAll(HTML_IMG_SRC)) {
        addresses.push(match[1]);
    }
    return addresses.filter(Boolean);
}

/**
 * Whether every picture a fence holds declares the `map` role.
 *
 * @param {string} contents - The fence's contents.
 * @param {(address: string) => string|undefined} resolveRole - The caller's
 *   lookup from an address to the role its asset declares.
 * @returns {boolean} Whether the fence draws at least one picture and every
 *   one of them resolves to `map`.
 */
function picturesAreMap(contents, resolveRole) {
    const addresses = pictureAddresses(contents);
    return addresses.length > 0 && addresses.every((address) => resolveRole(address) === "map");
}

/**
 * Which counter a fence's contents belong to.
 *
 * @param {object|undefined} first - The first top-level token of the contents.
 * @param {string} contents - The contents, trimmed.
 * @param {(address: string) => string|undefined} resolveRole - The caller's
 *   lookup from a picture's address to the role its asset declares.
 * @returns {"code"|"table"|"figure"|"map"|"poem"|"prose"} The kind.
 */
function figureKind(first, contents, resolveRole) {
    if (/^(?:<div\b[^>]*\bclass="poetry(?:\s|"))/.test(contents)) return "poem";
    if (first?.type === "table_open") return "table";
    if (first?.type === "fence" && /^\s*sql\b/i.test(first.info ?? "")) return "table";
    if (first?.type === "fence" || first?.type === "code_block") return "code";
    // `<figure>` and `<img>` reach this pass from the website, where the image
    // pass runs first and hands over HTML rather than markdown.
    if (picturesOnly(contents) || /^(?:<figure\b|<img\b)/.test(contents)) {
        return picturesAreMap(contents, resolveRole) ? "map" : "figure";
    }
    return "prose";
}

/**
 * Read leading captions and their following blocks outside literal fences.
 * Historical figure API names remain for caption references and consumers.
 * @param {string} source - The authored or expanded note body.
 * @param {object} [options] - Options.
 * @param {(address: string) => string|undefined} [options.resolveRole] - Asset role lookup.
 * @returns {{figures: Array<{id: string, slug: string, caption: string,
 *   hasCaption: boolean, classes: string[], attributes: Record<string,string>,
 *   kind: string, numbered: boolean, number: number, label: string, line: number,
 *   bodyStart: number, bodyEnd: number, captionStart: number, captionEnd: number, close: number}>,
 *   errors: Array<{line: number, column: number, message: string}>}}
 */
export function scanFigures(source, { resolveRole = () => undefined } = {}) {
    const lines = String(source ?? "").split("\n");
    const figures = [],
        errors = [],
        ids = new Set();
    const counts = {};
    let codeFence = null;
    const fault = (line, message) => errors.push({ line: line + 1, column: 1, message });
    for (let i = 0; i < lines.length; i++) {
        const fence = FENCE.exec(lines[i]);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length)
                codeFence = null;
            continue;
        }
        if (fence) {
            codeFence = fence[1];
            continue;
        }
        if (/^ *:::figure\b/.test(lines[i])) {
            fault(i, ":::figure is no longer supported; write a leading : or :@ caption");
            continue;
        }
        const match = /^ {0,3}:(@)?[ \t]+(.+?)\s*$/.exec(lines[i]);
        if (!match) {
            if (/^ {0,3}:@?[ \t]*$/.test(lines[i])) fault(i, "a caption needs text");
            continue;
        }
        if ((i > 0 && lines[i - 1].trim()) || lines[i + 1]?.trim()) {
            fault(i, "a caption needs a blank line before and after it");
            continue;
        }
        let caption = match[2],
            attributes = parseExtensionAttributes("");
        const attr = /\s+(\{.*\})$/.exec(caption);
        if (attr) {
            attributes = parseExtensionAttributes(attr[1].slice(1, -1));
            caption = caption.slice(0, attr.index).trim();
        } else if (/\s+\{/.test(caption)) fault(i, "a caption has malformed attributes");
        for (const message of [...attributes.problems, ...refusedAttributes(attributes.values)])
            fault(i, message);
        const explicit = attributes.values.type;
        if (
            explicit &&
            !["figure", "table", "poetry", "code", "prose", "example"].includes(explicit)
        )
            fault(i, `unsupported caption type "${explicit}"`);
        if (!caption) fault(i, "a caption needs text");
        let bodyStart = i + 1;
        while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
        if (bodyStart === lines.length || /^ {0,3}:@?[ \t]+/.test(lines[bodyStart])) {
            fault(i, "a caption needs a following item");
            continue;
        }
        let bodyEnd;
        const firstLine = lines[bodyStart];
        let kind;
        if (/^ {0,3}:::(?:[ \t]+\{.*\})?[ \t]*$/.test(firstLine)) {
            let depth = 1,
                literal = null;
            bodyEnd = bodyStart + 1;
            for (; bodyEnd < lines.length; bodyEnd++) {
                const code = FENCE.exec(lines[bodyEnd]);
                if (literal) {
                    if (code && code[1][0] === literal[0] && code[1].length >= literal.length)
                        literal = null;
                    continue;
                }
                if (code) {
                    literal = code[1];
                    continue;
                }
                if (
                    /^ *:::(?:[ \t]+\{.*\}|(?:secret|info|warn)\b.*)?[ \t]*$/.test(lines[bodyEnd])
                ) {
                    if (/^ *:::[ \t]*$/.test(lines[bodyEnd])) depth--;
                    else depth++;
                    if (!depth) {
                        bodyEnd++;
                        break;
                    }
                }
            }
            if (depth) fault(bodyStart, "a captioned div needs a closing :::");
            kind = "prose";
        } else {
            if (/^ *:::/.test(firstLine)) {
                fault(bodyStart, "this fence cannot be captioned");
                continue;
            }
            const tokens = parser.parse(lines.slice(bodyStart).join("\n"), {});
            const first = tokens.find((token) => token.level === 0 && token.map);
            if (
                !first ||
                ![
                    "table_open",
                    "fence",
                    "code_block",
                    "paragraph_open",
                    "blockquote_open",
                    "html_block",
                ].includes(first.type)
            ) {
                fault(
                    bodyStart,
                    "a caption must be followed by an image, table, poetry or code fence, paragraph, quote, or fenced div",
                );
                continue;
            }
            bodyEnd = bodyStart + first.map[1];
            if (first.type === "html_block" && /^<div\b/.test(firstLine.trim())) {
                let depth = 0;
                for (let at = bodyStart; at < lines.length; at++) {
                    depth += (lines[at].match(/<div\b/g) ?? []).length;
                    depth -= (lines[at].match(/<\/div>/g) ?? []).length;
                    if (!depth) {
                        bodyEnd = at + 1;
                        break;
                    }
                }
            }
            const contents = lines.slice(bodyStart, bodyEnd).join("\n");
            if (
                first.type === "html_block" &&
                !/^(?:<figure\b|<img\b|<div\b)/.test(contents.trim())
            ) {
                fault(bodyStart, "this block cannot be captioned");
                continue;
            }
            kind =
                first.type === "fence" && /^poetry(?:\s|$)/.test(first.info) ?
                    "poem"
                :   figureKind(first, contents.trim(), resolveRole);
        }
        if (explicit) kind = explicit === "poetry" ? "poem" : explicit;
        const id = attributes.id;
        if (id && ids.has(slugify(id))) fault(i, `duplicate figure id "${id}"`);
        if (id) ids.add(slugify(id));
        const numbered = Boolean(match[1]);
        const number = numbered ? (counts[kind] = (counts[kind] ?? 0) + 1) : 0;
        figures.push({
            id,
            slug: id ? slugify(id) : "",
            caption,
            hasCaption: true,
            classes: attributes.classes,
            attributes: attributes.values,
            kind,
            numbered,
            number,
            label: numbered ? `${FIGURE_NAMES[kind]} ${number}` : "",
            line: i + 1,
            bodyStart,
            bodyEnd,
            captionStart: i,
            captionEnd: i + 1,
            close: bodyEnd - 1,
        });
        i = bodyEnd - 1;
    }
    let literal = null;
    for (let at = 0; at < lines.length; at++) {
        const fence = FENCE.exec(lines[at]);
        if (literal) {
            if (fence && fence[1][0] === literal[0] && fence[1].length >= literal.length)
                literal = null;
            continue;
        }
        if (fence) {
            literal = fence[1];
            continue;
        }
        const heading = HEADING_LINE.exec(lines[at]);
        const id = heading ? splitHeadingAttributes(heading[2]).id : "";
        if (id && ids.has(slugify(id)))
            fault(at, `heading and figure declare the same anchor "${slugify(id)}"`);
    }
    return { figures, errors };
}

/**
 * Render leading captions and their next blocks as HTML, leaving other Markdown untouched.
 *
 * A code, table or prose figure's contents are left as Markdown inside the
 * wrapper, blank-line separated from its tags exactly as
 * {@link module:engine/content-blocks.renderBlocks} leaves a named block's
 * body — so the surrounding render sees it as part of its own document and a
 * footnote reference inside it resolves against the note's own definitions.
 *
 * A figure's contents are rendered here rather than left for a later pass,
 * because a picture-only fence has to become the surface's own `<figure>`
 * markup directly inside the wrapper this function writes; the surrounding
 * render never sees it as Markdown, so a footnote reference inside one is not
 * resolved, the same gap a block's own title carries.
 *
 * @param {string} source - A note body with expanded tables.
 * @param {(markdown: string) => string} [renderMarkdown] - How to render a
 *   figure's own contents.
 * @param {Array<{id: string, label: string}>} [numbers] - Labels assigned by a
 *   surface that counts across documents, matched by id.
 * @param {object} [options] - Options.
 * @param {(address: string) => string|undefined} [options.resolveRole] - See
 *   {@link scanFigures}.
 * @returns {{markdown: string, errors: Array<{line: number, column: number, message: string}>}}
 */
export function renderFigureBlocks(
    source,
    renderMarkdown = parser.render.bind(parser),
    numbers,
    { resolveRole } = {},
) {
    const { figures, errors } = scanFigures(source, { resolveRole });
    if (errors.length) return { markdown: source, errors };
    const byId =
        numbers ?
            new Map(numbers.filter((entry) => entry.id).map((entry) => [entry.id, entry]))
        :   new Map();
    const lines = String(source ?? "").split("\n");
    const output = [];
    let cursor = 0;
    for (const figure of figures) {
        output.push(...lines.slice(cursor, figure.line - 1));
        const numbered = (figure.id ? byId.get(figure.id) : null) ?? figure;
        const contents = lines.slice(figure.bodyStart, figure.bodyEnd).join("\n");
        const classes = ["content-figure", `content-figure-${numbered.kind}`, ...figure.classes];
        const id = figure.slug ? ` id="${escapeHtml(figure.slug)}"` : "";
        const attrs = Object.entries(figure.attributes ?? {})
            .filter(([key]) => key !== "type")
            .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
            .join("");
        output.push(`<div${id} class="${escapeHtml(classes.join(" "))}"${attrs}>`);
        if (figure.kind === "figure" || figure.kind === "map") {
            output.push(renderMarkdown(contents).trim());
        } else {
            output.push("", contents, "");
        }
        const label = escapeHtml(numbered.label);
        output.push(
            `<p class="content-figure-label">${
                figure.hasCaption ?
                    `${label ? `${label}: ` : ""}${parser.renderInline(figure.caption)}`
                :   label
            }</p>`,
            "</div>",
        );
        cursor = figure.close + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors: [] };
}
