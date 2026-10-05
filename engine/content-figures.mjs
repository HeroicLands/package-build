/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `:::figure` — the fence that declares what is numbered and captioned.
 *
 * ```
 * :::figure {#thorn .border}
 * ![[being-foobar|The Great Beast]]
 * ///
 * The great beast, as drawn by [[person-havard]].
 * :::
 * ```
 *
 * The fence states the unit, so nothing is inferred about scope and a group —
 * two portraits as one plate, a table with its key beneath it — is one figure
 * with one number.
 *
 * **The caption is optional and the fence is what numbers a thing.** A fence
 * with no `///` draws its label alone. So the rule is "no fence, no number":
 * a bare embed takes no number and nothing is drawn beneath it.
 *
 * **`{#id}` is optional too.** A fence that declares none is numbered and drawn
 * and carries no anchor, so nothing can reference it.
 *
 * ## The split is lexical
 *
 * The first `///` at the top level of the body divides the contents from the
 * caption, and it is found **on the raw lines, before any markdown parsing**.
 * The alternative delimiters are claimed by the grammar: `---` or `===` on the
 * line after a paragraph is a setext heading, so an image tight against one
 * becomes an `<h2>` with nothing said. `///` has no CommonMark meaning, which
 * leaves a genuine thematic break available inside a grouped figure.
 *
 * A delimiter inside a nested code fence is content: a captioned listing
 * carries `///` as a doc comment, so the scan for both the delimiter and the
 * closing `:::` tracks nested fences and reads neither inside one.
 *
 * ## The kind is derived, never authored
 *
 * A table is self-evidently a table and a lone picture a figure, so the counter
 * comes from the fence's contents: a table is `table`, an `sql` fence is
 * `table`, any other fence or code block is `code`, pictures alone are
 * `figure`, and everything else is `prose`. A fence around prose, with
 * `.border`, is a numbered, referable boxed aside, which is what `Prose` names.
 *
 * **A picture counts as `map` instead of `figure` when every picture the fence
 * holds is one.** The fence's own markup cannot say so — a picture of a map
 * looks like any other picture — so the fact travels through a `resolveRole`
 * function the caller supplies, from the address each picture draws (an
 * embed's address, an image's path, or an `<img>` tag's `src`) to the role its
 * asset declares. This pass resolves no address of its own; `resolveRole` is
 * the one seam a caller reaches through with whatever lookup it already holds.
 * A caller that supplies none, or whose lookup answers nothing for a picture,
 * gets `figure` — the same reading as a picture with a role other than `map`.
 *
 * ## The class vocabulary is closed
 *
 * {@link FIGURE_CLASSES} holds what an author may write, and a class outside it
 * is a finding naming the class — so `.border` does not become the first of
 * twenty presentational classes. `key=value` is refused: the construct takes an
 * id and classes.
 *
 * @module
 */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";

import { slugify } from "./content-slug.mjs";
import { parseExtensionAttributes } from "./extension-attributes.mjs";
import { HEADING_LINE, parseHeadingLine, splitHeadingAttributes } from "./heading-attributes.mjs";
import { IMAGE_PATTERN } from "./content-images.mjs";

const parser = new MarkdownIt({ html: true }).use(footnotePlugin).use(deflistPlugin);
const OPEN = /^:::figure(?:[ \t]+(\{[^}\n]*\}))?[ \t]*$/;
const FIGURE_LINE = /^:::figure\b/;
const CLOSE = /^:::\s*$/;
const SPLIT = /^\/\/\/\s*$/;
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
    table: "Table",
    figure: "Figure",
    map: "Map",
    poem: "Poem",
    prose: "Prose",
});

/**
 * The classes a figure takes.
 *
 * `.border` states that the captioned thing is drawn inside a border, and each
 * medium owns what that means. The vocabulary is closed: a class absent from it
 * is a finding naming the class.
 *
 * @type {readonly string[]}
 */
export const FIGURE_CLASSES = Object.freeze(["border"]);

/** Number a sequence of figures with counters shared across documents. */
export function numberFigures(figures, counts) {
    return figures.map((figure) => {
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
    if (/^(?: *:::poetry(?:\s|$)|<div\b[^>]*\bclass="poetry(?:\s|"))/.test(contents)) return "poem";
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
 * Read every `:::figure` fence in a body.
 *
 * SQL fences are expanded before this pass, so their output is a table.
 *
 * @param {string} source - A note body with expanded tables.
 * @param {object} [options] - Options.
 * @param {(address: string) => string|undefined} [options.resolveRole] - From
 *   a picture's address to the role its asset declares, so a picture whose
 *   asset declares `role: map` counts as `map` rather than `figure`. Omitted,
 *   every picture counts as `figure` — the same reading a role other than
 *   `map` gets.
 * @returns {{figures: Array<{id: string, slug: string, caption: string,
 *   hasCaption: boolean, classes: string[], kind: string, number: number,
 *   label: string, line: number, bodyStart: number, bodyEnd: number,
 *   captionStart: number, captionEnd: number, close: number}>,
 *   errors: Array<{line: number, column: number, message: string}>}}
 */
export function scanFigures(source, { resolveRole = () => undefined } = {}) {
    const lines = String(source ?? "").split("\n");
    const figures = [];
    const errors = [];
    const counts = { code: 0, table: 0, figure: 0, map: 0, poem: 0, prose: 0 };
    const ids = new Set();
    const headingIds = [];
    let codeFence = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = FENCE.exec(line);
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
        if (!FIGURE_LINE.test(line)) continue;
        const open = OPEN.exec(line);
        if (!open) {
            errors.push({
                line: i + 1,
                column: 1,
                message: "a figure's attributes are written as {#id .border}",
            });
            continue;
        }
        const start = i;
        const attributes = parseExtensionAttributes((open[1] ?? "{}").slice(1, -1));
        const faults = [...attributes.problems];
        for (const name of attributes.classes) {
            if (FIGURE_CLASSES.includes(name)) continue;
            faults.push(
                `a figure takes no .${name} class — the classes a figure takes are ` +
                    FIGURE_CLASSES.map((known) => `.${known}`).join(", "),
            );
        }
        for (const key of Object.keys(attributes.values)) {
            faults.push(
                `${key}= is not an attribute a figure takes — a figure takes an id and classes`,
            );
        }
        for (const message of faults) errors.push({ line: start + 1, column: 1, message });

        // The body, read line by line: the first top-level `///` splits it, the
        // closing `:::` ends it, and a nested fence holds neither.
        let close = start + 1;
        let split = -1;
        let nested = null;
        let namedDepth = 0;
        const fenced = new Set();
        while (close < lines.length) {
            const body = lines[close];
            const bodyFence = FENCE.exec(body);
            if (namedDepth) {
                fenced.add(close);
                if (/^ *:::[ \t]*$/.test(body)) namedDepth--;
                close++;
                continue;
            }
            if (nested) {
                fenced.add(close);
                if (
                    bodyFence &&
                    bodyFence[1][0] === nested[0] &&
                    bodyFence[1].length >= nested.length
                )
                    nested = null;
                close++;
                continue;
            }
            if (bodyFence) {
                nested = bodyFence[1];
                fenced.add(close);
                close++;
                continue;
            }
            if (/^ *:::poetry(?:\s|$)/.test(body)) {
                namedDepth++;
                fenced.add(close);
                close++;
                continue;
            }
            if (CLOSE.test(body)) break;
            if (SPLIT.test(body)) {
                if (split < 0) split = close;
                else
                    errors.push({
                        line: close + 1,
                        column: 1,
                        message: "a figure holds one caption, so it carries one /// line",
                    });
            }
            close++;
        }
        if (close === lines.length) {
            errors.push({ line: start + 1, column: 1, message: "a figure needs a closing :::" });
            continue;
        }

        const bodyStart = start + 1;
        const bodyEnd = split < 0 ? close : split;
        const captionStart = split < 0 ? -1 : split + 1;
        const captionEnd = split < 0 ? -1 : close;
        const contents = lines.slice(bodyStart, bodyEnd).join("\n");
        const caption = split < 0 ? "" : lines.slice(captionStart, captionEnd).join("\n").trim();
        if (!contents.trim())
            errors.push({ line: start + 1, column: 1, message: "a figure has no contents" });
        if (split >= 0 && !caption)
            errors.push({
                line: split + 1,
                column: 1,
                message:
                    "a figure's /// section carries no caption — write no /// to leave the " +
                    "figure uncaptioned",
            });
        // An H1, or an anchored heading at any level, starts a Foundry
        // journal page — see `engine/content-blocks.mjs`'s identical refusal
        // for a named block.
        for (let at = bodyStart; at < close; at++) {
            if (fenced.has(at)) continue;
            if (!parseHeadingLine(lines[at])?.startsPage) continue;
            errors.push({
                line: at + 1,
                column: 1,
                message:
                    "a heading that starts a page cannot be written inside a figure — " +
                    "keep an H1 or an anchored heading at the top level, or drop the " +
                    "anchor and the level to stay inside it",
            });
        }
        const id = attributes.id;
        if (id) {
            if (ids.has(slugify(id)))
                errors.push({ line: start + 1, column: 1, message: `duplicate figure id "${id}"` });
            ids.add(slugify(id));
        }

        const trimmed = contents.trim();
        const tokens = parser.parse(contents, {});
        const first = tokens.find((token) => token.level === 0 && token.map);
        const kind = figureKind(first, trimmed, resolveRole);
        const number = ++counts[kind];
        figures.push({
            id,
            slug: id ? slugify(id) : "",
            caption,
            hasCaption: Boolean(caption),
            classes: attributes.classes,
            kind,
            number,
            label: `${FIGURE_NAMES[kind]} ${number}`,
            line: start + 1,
            bodyStart,
            bodyEnd,
            captionStart,
            captionEnd,
            close,
        });
        i = close;
    }
    for (const heading of headingIds) {
        if (ids.has(heading.id))
            errors.push({
                line: heading.line,
                column: 1,
                message: `heading and figure declare the same anchor "${heading.id}"`,
            });
    }
    return { figures, errors };
}

/**
 * Render figure fences as HTML, leaving other Markdown untouched.
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
        output.push(`<div${id} class="${escapeHtml(classes.join(" "))}">`);
        if (figure.kind === "figure" || figure.kind === "map") {
            output.push(renderMarkdown(contents).trim());
        } else {
            output.push("", contents, "");
        }
        const label = escapeHtml(numbered.label);
        output.push(
            `<p class="content-figure-label">${
                figure.hasCaption ? `${label}: ${parser.renderInline(figure.caption)}` : label
            }</p>`,
            "</div>",
        );
        cursor = figure.close + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors: [] };
}
