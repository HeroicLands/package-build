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
 * A note's markdown, and a document plan, rendered as Typst source.
 *
 * **This module emits text and reads nothing.** It takes markdown and a plan and
 * returns a `.typ` document; the filesystem, the note bodies and the compiler
 * that turns the result into a PDF all live in
 * {@link module:engine/pdf-build}. That split is what lets the outline, the
 * table of contents, every anchor and every link destination be asserted in a
 * unit test with no renderer installed — which is most of what a book has to
 * get right, and all of what a test can check without eyes.
 *
 * ## Why a token walk rather than markdown-it's renderer
 *
 * markdown-it renders to HTML by replacing string-producing rules, and two of
 * the constructs a reference book leans on hardest — nested lists and tables —
 * are *indentation*-significant in Typst markup and would have to be rebuilt
 * from a flat stream of `_open`/`_close` strings anyway. Emitting Typst's
 * **function** forms instead (`#list(…)`, `#table(…)`, `#link(…)[…]`) removes
 * indentation from the problem completely: a list nested six deep inside a
 * table cell is a nested call, and nothing about the surrounding whitespace can
 * break it. So the token stream is walked directly.
 *
 * ## Links, and the one rule that decides them
 *
 * A wikilink is already resolved to a URL before this module sees it — by the
 * same {@link module:engine/web-wikilinks} pass the site uses, so the two
 * surfaces cannot disagree about where a link points. What differs is what a
 * *book* does with the answer:
 *
 * - A URL whose address slug this document prints becomes an **internal**
 *   destination, `#link(<anchor>)`, because the reader has the page in their
 *   hand and sending them to a website for it would be absurd.
 *   {@link module:engine/pdf-toc.planDocument} supplies that map, and points
 *   every inbound link at the *first* printing of a note that appears twice.
 * - Every other URL stays a URL: a cross-package link resolved through the link
 *   manifest, and a same-package note the book did not select, are both genuinely
 *   elsewhere.
 *
 * ## Icons
 *
 * `:icon-star-outline:` is parsed by the *same* {@link module:engine/content-icons.iconPlugin}
 * the journals and the website use — one rule, three surfaces — and only the
 * output differs. The glyph is resolved from the font file the consumer named,
 * because the registry deliberately holds no codepoints; when no font is
 * configured for an icon's family the name is set as literal text, which is the
 * visible failure the registry was designed to produce.
 *
 * @module
 */

import MarkdownIt from "markdown-it";

import { bookDraftNoticePreamble } from "./draft-notice.mjs";
import { iconPlugin, ICON_PATTERN } from "./content-icons.mjs";
import { IMAGE_CLASSES, IMAGE_FLOATS, imagePlugin } from "./content-images.mjs";
import { slugify } from "./content-slug.mjs";

/**
 * Characters that mean something to Typst's markup parser.
 *
 * Conservative on purpose. Escaping a character that did not need it costs a
 * backslash the reader never sees, where missing one turns a price list into a
 * heading or swallows a paragraph into a function call. `-`, `+` and `/` are
 * handled separately below, because they are only structural at the start of a
 * line and escaping them mid-word would litter every hyphenated name in the
 * corpus.
 *
 * @type {RegExp}
 */
const TYPST_SPECIAL = /([\\#$*_@<>[\]~`"'])/g;

/**
 * Escape literal text for Typst markup.
 *
 * @param {string} text - Text as the author wrote it.
 * @returns {string} The same text, inert.
 */
export function escapeTypst(text) {
    return (
        String(text ?? "")
            .replace(TYPST_SPECIAL, "\\$1")
            // Structural only at the head of a line: a list marker, a term, or a
            // heading. `10' × 11'` must not become a bullet, and `e-mail` must not
            // grow a backslash.
            .replace(/^(\s*)([-+/=])/gm, "$1\\$2")
    );
}

/**
 * Escape a string going inside Typst string quotes, as a `#link` URL does.
 *
 * @param {string} text - The raw value.
 * @returns {string} The same value, quotable.
 */
export function escapeTypstString(text) {
    return String(text ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

/**
 * A Typst label, from a plan anchor.
 *
 * Typst labels admit a narrower charset than an anchor does, so anything else
 * folds to a hyphen. The plan already guarantees anchors are unique, and a fold
 * that merged two of them would silently give one destination two meanings —
 * so the fold is injective by construction: only characters Typst rejects move,
 * and they move to a character the slugifier never emits twice in a row.
 *
 * @param {string} anchor - The plan's anchor.
 * @returns {string} A Typst label name.
 */
export function labelFor(anchor) {
    return (
        String(anchor ?? "")
            .replace(/[^A-Za-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "anchor"
    );
}

/**
 * A markdown-it configured to parse, not to render.
 *
 * `html: false` is the load-bearing setting: raw HTML in a note has no route to
 * Typst at all, which is why {@link module:engine/content-html} reports it. With
 * HTML disabled markdown-it emits the tag as text, so it arrives in the book
 * visibly wrong rather than invisibly missing.
 *
 * @param {object} [registry] - The icon registry.
 * @returns {object} A markdown-it instance.
 */
export function createParser(registry) {
    const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
    md.use(iconPlugin(registry));
    // The same plugin the HTML surfaces use, so one directive is read once and
    // three renderers read the same `meta` off the same token.
    md.use(imagePlugin());
    return md;
}

/**
 * Render markdown as Typst content.
 *
 * @param {string} markdown - The note's body, tables expanded and links resolved.
 * @param {object} [opts] - Options.
 * @param {object} [opts.md] - A parser from {@link createParser}, reused across
 *   a whole book rather than rebuilt for each of 2,500 notes.
 * @param {object} [opts.registry] - The icon registry, when no parser is passed.
 * @param {Map<string, string>} [opts.links] - Address slug → plan anchor.
 * @param {Map<string, string>} [opts.glyphs] - Icon name → `{font, char}`.
 * @param {Map<string, string>} [opts.images] - An image's address as authored →
 *   the staged file's path, relative to the `.typ`. An address this does not
 *   carry has no file the compiler can open, so the figure prints its caption
 *   alone — see {@link renderImage}.
 * @param {number} [opts.headingOffset] - Added to every heading level, so a
 *   note's own `##` nests beneath the entry heading the book gave it.
 * @param {string} [opts.anchorPrefix] - The entry's anchor, which namespaces
 *   every `{#slug}` the body declares.
 *   capital. Set for an entry, which begins a page; not for front matter or a
 *   prose file, which carry headings of their own.
 * @returns {string} Typst markup.
 */
export function markdownToTypst(markdown, opts = {}) {
    const {
        md = createParser(opts.registry),
        links = new Map(),
        glyphs = new Map(),
        images = new Map(),
        headingOffset = 0,
        anchorPrefix = "",
    } = opts;
    const tokens = md.parse(String(markdown ?? ""), {});
    // One map for the whole body, not one per block: a heading inside a
    // blockquote or a list item shares the entry's anchor namespace with every
    // other heading in the same body, because `sectionLabel` scopes by entry
    // rather than by container.
    return renderTokens(tokens, {
        links,
        glyphs,
        images,
        headingOffset,
        anchorPrefix,
        seen: new Map(),
    });
}

/**
 * Walk a token stream, emitting Typst.
 *
 * @param {object[]} tokens - markdown-it tokens.
 * @param {object} ctx - `{ links, glyphs, headingOffset }`.
 * @returns {string} Typst markup.
 */
function renderTokens(tokens, ctx) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
        const consumed = renderBlock(tokens, i, out, ctx);
        i += consumed > 0 ? consumed : 1;
    }
    return out
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Render one block-level token and everything it encloses.
 *
 * @param {object[]} tokens - The stream.
 * @param {number} i - Where to start.
 * @param {string[]} out - Output accumulator.
 * @param {object} ctx - Render context.
 * @returns {number} How many tokens were consumed.
 */
function renderBlock(tokens, i, out, ctx) {
    const token = tokens[i];
    switch (token.type) {
        case "heading_open": {
            // Typst caps headings at a depth no book reaches by accident; going
            // past it would be a compile error in the middle of a 2,500-entry
            // run, so it clamps and keeps setting.
            const level = Math.max(1, Math.min(6, Number(token.tag.slice(1)) + ctx.headingOffset));
            const inline = tokens[i + 1];
            // `## Appearance {#appearance}` declares an addressable section. The
            // journals compiler strips the suffix and surfaces it as an anchor;
            // so does this, because a book that printed the braces would show
            // every reader the markup that makes a link work.
            const { text, anchor } = splitHeadingAnchor(inline, ctx);
            // A heading with no authored anchor still needs a link target, so one
            // is derived from its own text. `anchorFor` keeps it from colliding
            // with an authored anchor, or with another derived one, that lands on
            // the same words later in the same entry.
            const base = anchor || slugify(plainHeadingText(inline)) || "heading";
            const unique = anchorFor(base, ctx.seen);
            const label = ` <${sectionLabel(ctx.anchorPrefix, unique)}>`;
            // A body heading is never printed and never bookmarked — it is
            // structure a reader reaches only by following a link, not a
            // destination either outline offers on its own.
            out.push(
                `\n#heading(level: ${level}, outlined: false, bookmarked: false)[${text}]${label}\n\n`,
            );
            return 3;
        }
        case "paragraph_open": {
            out.push(`\n${renderInline(tokens[i + 1], ctx)}\n\n`);
            return 3;
        }
        case "fence":
        case "code_block": {
            out.push(rawBlock(token.content, token.info?.trim() || ""));
            return 1;
        }
        case "hr":
            out.push("\n#line(length: 100%, stroke: 0.4pt)\n\n");
            return 1;
        case "blockquote_open": {
            const end = matching(tokens, i, "blockquote_open", "blockquote_close");
            const inner = renderTokens(tokens.slice(i + 1, end), { ...ctx });
            out.push(`\n#quote(block: true)[${inner}]\n\n`);
            return end - i + 1;
        }
        case "bullet_list_open":
        case "ordered_list_open": {
            const close =
                token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
            const end = matching(tokens, i, token.type, close);
            const fn = token.type === "bullet_list_open" ? "list" : "enum";
            const items = listItems(tokens, i + 1, end, ctx);
            out.push(`\n#${fn}(${items.map((it) => `[${it}]`).join(", ")})\n\n`);
            return end - i + 1;
        }
        case "table_open": {
            const end = matching(tokens, i, "table_open", "table_close");
            out.push(renderTable(tokens.slice(i, end + 1), ctx));
            return end - i + 1;
        }
        case "inline":
            out.push(renderInline(token, ctx));
            return 1;
        default:
            return 1;
    }
}

/**
 * A heading's text, and the `{#slug}` it may end with.
 *
 * The suffix is removed from the *rendered* children rather than from the raw
 * source, so an anchor written inside emphasis or after a link still comes off
 * cleanly and the text either side of it survives.
 *
 * @param {object} inline - The heading's `inline` token.
 * @param {object} ctx - Render context.
 * @returns {{text: string, anchor: string}} The heading, and its anchor or "".
 */
function splitHeadingAnchor(inline, ctx) {
    const last = inline?.children?.[(inline.children?.length ?? 0) - 1];
    const raw = last?.type === "text" ? String(last.content ?? "") : "";
    const match = /^(.*?)\s*\{#([^}]+)\}\s*$/.exec(raw);
    if (!match) return { text: renderInline(inline, ctx), anchor: "" };
    // Rendered with the suffix removed from a copy, so the token stream the
    // caller owns is not mutated — the same tokens are walked again by the
    // journals and the index.
    const children = [...inline.children];
    children[children.length - 1] = { ...last, content: match[1] };
    return { text: renderInline({ ...inline, children }, ctx), anchor: match[2] };
}

/**
 * A heading's text, unescaped and with any `{#anchor}` suffix still attached.
 *
 * Used only to derive an anchor when the author wrote none, so it wants the
 * words as typed rather than the Typst-escaped, suffix-stripped text
 * {@link splitHeadingAnchor} renders — {@link module:engine/content-slug.slugify}
 * normalises punctuation and case itself and has no use for an escape
 * backslash.
 *
 * @param {object} inline - The heading's `inline` token.
 * @returns {string} The heading's raw text.
 */
function plainHeadingText(inline) {
    const children = inline?.children ?? [];
    return children.map((child) => child.content ?? "").join("");
}

/**
 * A unique anchor within one render pass, suffixed when the base repeats.
 *
 * A derived anchor is only as good as its uniqueness: two headings reading
 * "Notes" in one entry, or a derived "description" landing on an author's own
 * `{#description}`, would otherwise give one label two meanings. First use of
 * a base anchor keeps it exactly as written or slugified; every later use in
 * the same body is suffixed, in the order headings are walked — which is
 * stable across rebuilds because the body's markdown is.
 *
 * @param {string} base - The preferred anchor.
 * @param {Map<string, number>} seen - How many times each base has been used,
 *   scoped to one call to {@link markdownToTypst}.
 * @returns {string} The anchor.
 */
function anchorFor(base, seen) {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
}

/**
 * A label for an anchor declared inside a note.
 *
 * Namespaced by the entry that carries it, because `{#appearance}` is written
 * in hundreds of the 2,500 character notes and a bare label would give one
 * destination hundreds of meanings — every inbound link landing on whichever
 * Typst emitted last.
 *
 * @param {string} prefix - The entry's own anchor.
 * @param {string} anchor - The anchor the heading declared.
 * @returns {string} A document-unique label.
 */
function sectionLabel(prefix, anchor) {
    return labelFor(`${prefix ? `${prefix}--` : ""}${anchor}`);
}

/**
 * The index of the token closing the one at `i`.
 *
 * @param {object[]} tokens - The stream.
 * @param {number} i - The opening token's index.
 * @param {string} open - The opening type.
 * @param {string} close - The closing type.
 * @returns {number} The closing token's index, or the stream's end.
 */
function matching(tokens, i, open, close) {
    let depth = 0;
    for (let j = i; j < tokens.length; j += 1) {
        if (tokens[j].type === open) depth += 1;
        else if (tokens[j].type === close) {
            depth -= 1;
            if (depth === 0) return j;
        }
    }
    return tokens.length - 1;
}

/**
 * The rendered content of each item in a list.
 *
 * @param {object[]} tokens - The stream.
 * @param {number} start - First token inside the list.
 * @param {number} end - The list's closing token.
 * @param {object} ctx - Render context.
 * @returns {string[]} One rendered item per entry.
 */
function listItems(tokens, start, end, ctx) {
    const items = [];
    let i = start;
    while (i < end) {
        if (tokens[i].type !== "list_item_open") {
            i += 1;
            continue;
        }
        const close = matching(tokens, i, "list_item_open", "list_item_close");
        items.push(renderTokens(tokens.slice(i + 1, close), { ...ctx }));
        i = close + 1;
    }
    return items;
}

/**
 * A markdown table as a Typst `#table`.
 *
 * The header row is emitted through `table.header`, which is what makes it
 * **repeat on every page a long table spills onto** — the property a roster of
 * 2,500 entries needs most and the one a naive HTML-to-PDF pass loses. Column
 * widths are left to Typst rather than computed here: it measures the content,
 * and a width guessed from character counts is wrong the moment a face changes.
 *
 * @param {object[]} tokens - `table_open` through `table_close`.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function renderTable(tokens, ctx) {
    const rows = [];
    let current = null;
    let inHeader = false;
    let headerRows = 0;
    const aligns = [];

    for (const token of tokens) {
        switch (token.type) {
            case "thead_open":
                inHeader = true;
                break;
            case "thead_close":
                inHeader = false;
                break;
            case "tr_open":
                current = [];
                break;
            case "tr_close":
                if (current) {
                    rows.push({ cells: current, header: inHeader });
                    if (inHeader) headerRows += 1;
                }
                current = null;
                break;
            case "th_open":
            case "td_open": {
                if (token.type === "th_open") {
                    const style = String(token.attrGet?.("style") ?? "");
                    aligns.push(
                        style.includes("right") ? "right"
                        : style.includes("center") ? "center"
                        : "left",
                    );
                }
                break;
            }
            case "inline":
                if (current) current.push(renderInline(token, ctx));
                break;
            default:
                break;
        }
    }

    if (!rows.length) return "";
    const columns = Math.max(...rows.map((r) => r.cells.length));
    const alignment = aligns.length === columns ? `\n  align: (${aligns.join(", ")}),` : "";
    const body = rows
        .filter((r) => !r.header)
        .map((r) => `  ${padCells(r.cells, columns)},`)
        .join("\n");
    const header =
        headerRows ?
            `\n  table.header(${padCells(
                rows.filter((r) => r.header).flatMap((r) => r.cells),
                columns,
            )}),`
        :   "";
    const drawn = `#table(\n  columns: ${columns},${alignment}${header}\n${body}\n)`;
    // Wide content is given an explicit span rather than left to overflow the
    // measure: past three columns a table is set across the page, and
    // `book-wide` decides between a float and pages of its own by measuring it.
    if (columns > WIDE_TABLE_COLUMNS) return `\n#book-wide[\n${drawn}\n]\n\n`;
    return `\n${drawn}\n\n`;
}

/**
 * Cells as Typst content blocks, padded to the table's width.
 *
 * A short row is a real thing in authored markdown, and Typst counts cells
 * rather than rows — one missing cell would shift every later row one column
 * left for the rest of the table.
 *
 * @param {string[]} cells - Rendered cell contents.
 * @param {number} columns - The table's column count.
 * @returns {string} A comma-separated list of content blocks.
 */
function padCells(cells, columns) {
    const padded = [...cells];
    while (padded.length < columns) padded.push("");
    return padded.map((c) => `[${c}]`).join(", ");
}

/**
 * A fenced block as Typst raw text.
 *
 * The fence is opened with more backticks than the content holds, so a note
 * documenting a fenced block cannot terminate its own.
 *
 * @param {string} content - The block's text.
 * @param {string} info - The language, when the fence declared one.
 * @returns {string} Typst markup.
 */
function rawBlock(content, info) {
    const text = String(content ?? "").replace(/\n$/, "");
    const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
    const ticks = "`".repeat(Math.max(3, longest + 1));
    const lang = /^[A-Za-z0-9_+-]+$/.test(info) ? info : "";
    return `\n${ticks}${lang}\n${text}\n${ticks}\n\n`;
}

/**
 * Render an inline token's children.
 *
 * @param {object} token - An `inline` token.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function renderInline(token, ctx) {
    const children = token?.children ?? [];
    const out = [];
    for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        switch (child.type) {
            case "text":
                out.push(escapeTypst(child.content));
                break;
            case "softbreak":
                out.push("\n");
                break;
            case "hardbreak":
                out.push(" \\\n");
                break;
            case "code_inline":
                out.push(inlineRaw(child.content));
                break;
            case "strong_open":
                out.push("#strong[");
                break;
            case "em_open":
                out.push("#emph[");
                break;
            case "s_open":
                out.push("#strike[");
                break;
            case "strong_close":
            case "em_close":
            case "s_close":
                out.push("]");
                break;
            case "heroiclands_icon":
                out.push(renderIcon(child, ctx));
                break;
            case "link_open": {
                const close = childMatching(children, i, "link_open", "link_close");
                const inner = renderInline({ children: children.slice(i + 1, close) }, ctx);
                out.push(renderLink(child.attrGet?.("href") ?? "", inner, ctx));
                i = close;
                break;
            }
            case "image":
                out.push(renderImage(child, ctx));
                break;
            default:
                if (child.content) out.push(escapeTypst(child.content));
                break;
        }
    }
    return out.join("");
}

/**
 * The index of the inline token closing the one at `i`.
 *
 * @param {object[]} children - Inline children.
 * @param {number} i - The opening token's index.
 * @param {string} open - The opening type.
 * @param {string} close - The closing type.
 * @returns {number} The closing index, or the last child.
 */
function childMatching(children, i, open, close) {
    let depth = 0;
    for (let j = i; j < children.length; j += 1) {
        if (children[j].type === open) depth += 1;
        else if (children[j].type === close) {
            depth -= 1;
            if (depth === 0) return j;
        }
    }
    return children.length - 1;
}

/**
 * Inline code as Typst raw.
 *
 * @param {string} content - The code.
 * @returns {string} Typst markup.
 */
function inlineRaw(content) {
    const text = String(content ?? "");
    const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
    const ticks = "`".repeat(Math.max(1, longest + 1));
    return `${ticks}${text}${ticks}`;
}

/**
 * A link, internal when the book prints its destination and external otherwise.
 *
 * The address slug is read from the tail of the URL, which is where every
 * address this toolchain publishes puts it — `…/<type>-<shortcode>/`. A
 * cross-package URL resolved through the link manifest is on another package's
 * base and cannot collide, and a same-package note the book did not select is
 * genuinely on the website rather than in the reader's hand.
 *
 * @param {string} href - The resolved URL.
 * @param {string} inner - The already-rendered link text.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function renderLink(href, inner, ctx) {
    const url = String(href ?? "");
    const fragment = /#([^?]*)/.exec(url)?.[1] ?? "";
    const slug =
        url
            .replace(/[#?].*$/, "")
            .replace(/\/+$/, "")
            .split("/")
            .pop() ?? "";
    const anchor = ctx.links.get(slug);
    if (anchor) {
        // `[[note#appearance]]` reaches the section, not just the entry — the
        // same namespaced label the heading declared.
        const target = fragment ? sectionLabel(anchor, fragment) : labelFor(anchor);
        return `#link(<${target}>)[${inner}]`;
    }
    if (!url) return inner;
    return `#link("${escapeTypstString(url)}")[${inner}]`;
}

/**
 * One image, as the figure the book prints.
 *
 * ## The width class is the measure
 *
 * An image with no class is one column wide. That is `width: 100%` of whatever
 * container it is set in — a column of the two the body is set in — so the
 * ordinary case needs nothing but an ordinary block, and lands exactly where it
 * was written.
 *
 * `.full-width` has to leave its column, and only a float placed with
 * `scope: "parent"` spans every column of a page. A float, though, is placed
 * where the page has room rather than where it was written: it is set at the
 * top of the page, above the prose that introduces it, and where the page is
 * too far along to take it, on the next page — after prose that follows it in
 * the note. Document order governs what follows an image, so
 * {@link bookTypstPreamble}'s `book-figure` breaks the page first and places
 * the figure at the top of the fresh one, where nothing is above it to displace
 * it and nothing that follows it can print first.
 *
 * A `.full-width` image that **also states a `float:`** is asking for a float,
 * and keeps one — deferral is the honest consequence of the request.
 *
 * ## A float occupies the measure
 *
 * Typst has no shaped text flow, so `#place(…, float: true)` reserves the whole
 * measure and sets the text above and below rather than beside. The horizontal
 * half of a position therefore has no effect on the page; it is emitted anyway,
 * because it costs nothing and says what the note asked for.
 *
 * ## No file, no picture
 *
 * `#image` on a path Typst cannot open is a compile error, and a compile error
 * in a 2,500-entry book is fatal at the very end of a run that otherwise
 * succeeded — over an illustration, which is the least important thing on the
 * page. An address the build could not stage prints its caption alone instead,
 * and the build reports the address it could not find.
 *
 * @param {object} token - An `image` token.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function renderImage(token, ctx) {
    const alt = token.content || token.attrGet?.("alt") || "";
    const caption =
        alt ? `\n  #text(size: 7.6pt, style: "italic", fill: luma(45%))[${escapeTypst(alt)}]` : "";
    const staged = ctx.images.get(token.attrGet?.("src") ?? "");
    if (!staged) return caption ? `\n#block(below: 0.6em)[${caption}\n]\n\n` : "";

    const figure =
        `#block(width: 100%, below: 0.6em)[\n` +
        `  #image("${escapeTypstString(staged)}", width: 100%)${caption}\n]`;

    const width = token.meta?.classes?.[0];
    const scope = IMAGE_CLASSES[width]?.scope ?? "column";
    const float = IMAGE_FLOATS[token.meta?.float];
    // In the flow where it was written: no class asking for the page, and no
    // position asking for the top or the bottom of the column.
    if (!float && scope === "column") return `\n${figure}\n\n`;
    // The page, in document order: a width class says how wide the picture is
    // and not when it appears.
    if (!float) return `\n#book-figure[\n${figure}\n]\n\n`;
    return `\n#place(${float.align}, float: true, scope: "${scope}", clearance: 0.7em)[\n${figure}\n]\n\n`;
}

/**
 * One icon, as its glyph when a font carries it and as its name otherwise.
 *
 * @param {object} token - A `heroiclands_icon` token.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function renderIcon(token, ctx) {
    const name = token?.meta?.name ?? "";
    const glyph = ctx.glyphs.get(name);
    if (!glyph) return escapeTypst(`:icon-${name}:`);
    return `#text(font: "${escapeTypstString(glyph.font)}")[\\u{${glyph.codepoint.toString(16)}}]`;
}

/**
 * How many columns a table may hold before it is set across the page.
 *
 * Three is where a column measure gives out. A two- or three-column table of
 * names and numbers sets comfortably in half a US Letter page; a fourth column
 * is where the cells start breaking one word to a line, and by five — a roster
 * of nomes with a sentence of character in the last cell — the table is wider
 * than the measure whatever the renderer does with it.
 *
 * The count is the rule because it is the one thing known without laying the
 * page out. How *tall* the result is decides the rest, and that is measured in
 * Typst rather than guessed here: see `book-wide` in {@link bookTypstPreamble}.
 *
 * @type {number}
 */
const WIDE_TABLE_COLUMNS = 3;

/**
 * The Typst definitions the book's page furniture is drawn with.
 *
 * Emitted once at the head of the document, for the reason the infobox panel's
 * rules are: 2,000 entries each restating the plate, the running foot and the
 * drop cap is a megabyte of repetition, and the one place a reader changes how
 * the book looks should be one place.
 *
 * ## The geometry is stated, not discovered
 *
 * The page is US Letter with a 1.9cm margin, and the plate bleeds off all
 * three edges it touches — so the plate has to know the paper's width and the
 * margin it is escaping. Both are `#let` bindings here rather than numbers
 * repeated down the file, and every other measure is arithmetic on them.
 *
 * ## Three things that cost time to discover, encoded here
 *
 * - **A title inherits the body's justification and hyphenation** unless told
 *   otherwise. Both are habits of body text that make a display line look
 *   broken, so the plate turns them off inside itself.
 * - **The plate's height follows its title**, and the line count is derived
 *   from the title's *natural* width: measuring an already-wrapped block does
 *   not report the wrapped height, and a percentage width cannot resolve
 *   inside `measure`. So the title arrives as a string to be measured
 *   alongside the heading that is actually drawn.
 * - **A float is not breakable.** A table taller than the page placed as one
 *   silently piles its rows on top of each other at the foot of the page —
 *   no warning, no error. So `book-wide` measures first and gives a table that
 *   will not fit its own single-column pages instead.
 *
 * ## The ornament is drawn, not typed
 *
 * The running foot's centre mark is a rotated square rather than a dingbat
 * character, because the faces a consumer names and the faces a build runner
 * carries are not the same set, and a missing glyph on 2,000 feet is a
 * tofu box on every page of the book.
 *
 * @returns {string} Typst markup.
 */
export function bookTypstPreamble() {
    return [
        "#let book-margin = 1.9cm",
        "#let book-page-width = 8.5in",
        "#let book-page-height = 11in",
        "#let book-text-width = book-page-width - 2 * book-margin",
        "#let book-text-height = book-page-height - 2 * book-margin",
        // The title sets short of the measure, so a plate's last line does not
        // run to the trimmed edge of the paper.
        "#let book-title-measure = book-text-width - 2.5cm",
        '#let book-ink = rgb("#241f1a")',
        '#let book-paper = rgb("#f4efe4")',
        '#let book-accent = rgb("#7c3b1e")',
        '#let book-head = rgb("#5e2b14")',
        '#let book-faint = rgb("#6b6357")',
        "#let book-ornament = box(baseline: 1pt, " +
            "rotate(45deg, rect(width: 3pt, height: 3pt, fill: book-accent)))",
        "#let book-footer(name) = context {\n" +
            "  set text(size: 8pt, fill: book-faint)\n" +
            "  grid(columns: (1fr, auto, 1fr), align(left)[#name], align(center)[#book-ornament],\n" +
            "    align(right)[#counter(page).display()])\n" +
            "}",
        // A heading justifies and hyphenates like body text unless told
        // otherwise, and both make a display line look broken.
        //
        // Size, weight and the space above follow the level, so a parent reads
        // as one without the words being read. The rule belongs to the note's own
        // top level alone; every level under it is set apart by space. Headings set
        // in the sans face and in the case they were authored in, so neither
        // capitals nor tracking is carrying the distinction. The scale starts
        // at 3: `book-plate` shadows this rule while it draws the title, so
        // the section landing and the entry title never arrive here, and the
        // headings that do are the note's own.
        "#let book-sechead(it) = {\n" +
            "  let lv = it.level\n" +
            "  let size = if lv <= 3 { 26pt } else if lv == 4 { 19pt }\n" +
            "    else if lv == 5 { 14pt } else { 11pt }\n" +
            "  let above = if lv <= 3 { 2.5em } else if lv == 4 { 2.0em }\n" +
            "    else { 1.0em }\n" +
            "  let below = if lv <= 3 { 0.5em } else if lv == 4 { 0.36em }\n" +
            "    else { 0.28em }\n" +
            '  let weight = if lv <= 5 { "bold" } else { "regular" }\n' +
            "  block(width: 100%, above: above, below: below, breakable: false)[\n" +
            "    #set par(justify: false, first-line-indent: 0em)\n" +
            "    #set text(hyphenate: false)\n" +
            "    #text(size: size, weight: weight, fill: book-head)[#it.body]\n" +
            "    #if lv <= 3 {\n" +
            "      v(-0.30em)\n" +
            "      line(length: 100%, stroke: 0.5pt + book-accent)\n" +
            "    }\n" +
            "  ]\n" +
            "}",
        // The plate bleeds off the paper: the placed panel is the full width of
        // the sheet and starts a margin above and to the left of wherever the
        // flow has reached, which on an entry's first page is the top corner.
        "#let book-plate(kicker, title, banner, floor, body) = context {\n" +
            '  let natural = measure(text(size: 25pt, weight: "bold", tracking: 1.4pt)[#title]).width\n' +
            "  let lines = calc.max(1, calc.ceil(natural / book-title-measure))\n" +
            "  let height = calc.max(floor, lines * 1.15cm + 1.75cm)\n" +
            "  block(width: 100%, height: height - book-margin, above: 0pt, below: 0pt)[\n" +
            "    #place(top + left, dx: -book-margin, dy: -book-margin)[\n" +
            "      #block(width: book-page-width, height: height, clip: true, inset: 0pt,\n" +
            "        fill: book-ink)[\n" +
            "        #if banner != none {\n" +
            '          place(top + left, image(banner, width: 100%, height: height, fit: "cover"))\n' +
            "        }\n" +
            "        #place(top + left, rect(width: 100%, height: height,\n" +
            "          fill: gradient.linear(rgb(10, 8, 6, 70), rgb(10, 8, 6, 175),\n" +
            "            rgb(10, 8, 6, 240), angle: 90deg)))\n" +
            "        #place(bottom + left, dx: book-margin, dy: -0.55cm)[\n" +
            "          #block(width: book-title-measure)[\n" +
            "            #set par(justify: false, leading: 0.35em, first-line-indent: 0em)\n" +
            "            #set text(hyphenate: false)\n" +
            '            #text(fill: rgb("#e8dcc2"), size: 7.5pt, tracking: 2.6pt)[#upper(kicker)]\n' +
            "            #v(-0.10em)\n" +
            "            #{\n" +
            "              show heading: it => it.body\n" +
            '              set text(fill: white, size: 25pt, weight: "bold", tracking: 1.4pt)\n' +
            "              body\n" +
            "            }\n" +
            "          ]\n" +
            "        ]\n" +
            "      ]\n" +
            "    ]\n" +
            "  ]\n" +
            "}",
        // A statement about the entry rather than about its subject, set in
        // the running face at the head of the leaf. The mark is drawn from two
        // primitives rather than set from a face: a consumer declares its icon
        // families or declares none, and a glyph the face lacks is silent here.
        bookDraftNoticePreamble(),
        "#let book-epigraph(body) = {\n" +
            "  v(0.42cm)\n" +
            "  align(center)[\n" +
            "    #line(length: 38%, stroke: 0.6pt + book-accent)\n" +
            "    #v(0.28em)\n" +
            "    #block(width: 78%)[\n" +
            "      #set par(justify: false, first-line-indent: 0em)\n" +
            '      #text(size: 10pt, style: "italic", fill: rgb("#3d352b"))[#body]\n' +
            "    ]\n" +
            "    #v(0.28em)\n" +
            "    #line(length: 38%, stroke: 0.6pt + book-accent)\n" +
            "  ]\n" +
            "}",
        // An entry owns its page. The plate is a float scoped to the parent
        // because that is the only placement that spans every column, and the
        // body has to set *below* it rather than beside it.
        "#let book-entry(kicker, title, banner, epigraph, body) = {\n" +
            "  pagebreak(weak: true)\n" +
            '  place(top, float: true, scope: "parent", clearance: 0.55cm)[\n' +
            "    #book-plate(kicker, title, banner, 3.5cm, body)\n" +
            "    #if epigraph != none { book-epigraph(epigraph) }\n" +
            "  ]\n" +
            "}",
        // A section opener holds nothing but its plate, so the plate needs no
        // float: placed out of the flow it covers the sheet whichever column
        // the flow happens to be in, and the break after it is what makes the
        // page exist.
        "#let book-section(kicker, title, banner, body) = {\n" +
            "  pagebreak(weak: true)\n" +
            "  place(top + left)[#book-plate(kicker, title, banner, 9cm, body)]\n" +
            "  pagebreak()\n" +
            "}",
        // A full-width figure spans the page in document order. Only a float
        // spans every column, and a float is placed where the page has room
        // rather than where it was written — at the top, above the prose that
        // introduces it, or on the next page when this one is too far along.
        // Breaking first puts it at the top of a page whose float region is
        // empty, which is the one place it cannot be displaced. A picture
        // taller than the page takes a page of its own, for the reason
        // `book-wide` states.
        //
        // `measure` alone is stable here. A rule reading `here().position()`
        // to keep the break for the cases that need it does not converge: the
        // position decides the layout and the layout decides the position.
        "#let book-figure(body) = context {\n" +
            "  if measure(block(width: book-text-width)[#body]).height >= book-text-height * 0.88 {\n" +
            "    page(columns: 1)[#body]\n" +
            "  } else {\n" +
            "    pagebreak(weak: true)\n" +
            '    place(top, float: true, scope: "parent", clearance: 0.7em)[#body]\n' +
            "  }\n" +
            "}",
        // Wide content spans the page, and how it spans depends on how tall it
        // is: a float is unbreakable and silently overflows, so anything taller
        // than a page takes pages of its own instead.
        "#let book-wide(body) = context {\n" +
            "  if measure(block(width: book-text-width)[#body]).height < book-text-height * 0.88 {\n" +
            '    place(top, float: true, scope: "parent", clearance: 0.8em)[#body]\n' +
            "  } else {\n" +
            "    page(columns: 1)[#body]\n" +
            "  }\n" +
            "}",
    ].join("\n");
}

/**
 * The whole book, as one Typst document.
 *
 * **Pure, and that is the point.** Everything a reviewer of #316 has to check
 * about structure — the outline's shape, the anchors, which links went inward,
 * the order entries print in — is decided here from a plan and a map of bodies,
 * with no filesystem and no compiler. {@link module:engine/pdf-build} supplies
 * both and runs Typst over the result.
 *
 * ## Three surfaces, one heading tree
 *
 * A roster of 2,500 entries wants every entry reachable from a viewer's
 * sidebar, and emphatically does not want all 2,500 printed in the front
 * matter: that is forty pages of contents before the book starts. It also
 * wants every heading in a note's own body to keep working as a link target,
 * without appearing on either surface — the anchor an author writes for
 * `[[note#appearance]]` is structure, not a destination either outline offers
 * on its own.
 *
 * `heading` carries `outlined` and `bookmarked` independently, so the three
 * wants are three settings rather than three passes:
 *
 * - A **section** — `outlined: true, bookmarked: true` — prints in the paper
 *   contents and the PDF sidebar alike.
 * - A **note leaf**, titled from `name.full`, is `outlined: false,
 *   bookmarked: true`: reachable from the sidebar, absent from the printed
 *   contents.
 * - A **body heading**, inside a note's own markdown, is `outlined: false,
 *   bookmarked: false`: a real heading with a label, so it still supplies a
 *   link target, a running head and a page break, but neither outline lists
 *   it. {@link markdownToTypst} emits these.
 *
 * `#outline()` needs no depth limit under this model: what prints is decided
 * per heading, not by how deep the tree happens to go.
 *
 * ## An entry owns its page, and the page is set in two columns
 *
 * A reference book is consulted rather than read through. An entry beginning
 * halfway down a page is harder to find, cannot carry its own running head
 * honestly, and makes a page number in the contents point at the middle of
 * something else — so every entry opens a page of its own, under a full-bleed
 * plate carrying a kicker and its name.
 *
 * The body is set in **two columns**, the measure a reference work wants and
 * the one every other decision follows from: an image with no width class is a
 * column wide, the infobox flows in the column measure and breaks between its
 * sections, and a table wider than {@link WIDE_TABLE_COLUMNS} spans the page.
 * The columns are the *page's* rather than a `columns()` block's, because only
 * a page with columns can carry a float that spans them — which is what the
 * plate, a wide table and a full-width figure all need.
 *
 * Two columns are print's answer and print's alone: a scrolling page has no
 * fixed viewport, so the website keeps one measure.
 *
 * ## What a section declares, its entries inherit
 *
 * {@link module:engine/pdf-toc.PRESENTATION_KEYS} travels down the document
 * tree, and two of those keys are read here:
 *
 * - **`page`** — `banner:`, the plate's picture; `kicker:`, the line above an
 *   entry's name; and `columns:`, the measure the section's pages are set in.
 * - **`footer`** — the name the running foot carries, which is the section's
 *   own title when nothing says otherwise.
 *
 * `header` and `infobox` are reserved and read by nothing: the running head is
 * a foot in this design, and which infobox a note draws is decided by the
 * note's type.
 *
 * ## A missing banner is a plate without a picture
 *
 * A section plate implies a banner per section, and art arrives later than
 * rendering does. A section that names no banner — or names one the build
 * cannot read — still gets its plate, its kicker and its title, set over the
 * book's ink.
 *
 * ## Headings carry the structure, so nothing else has to
 *
 * Every section, every prose file and every entry is a real Typst heading at
 * its plan depth. That single decision supplies both outlines, the running
 * heads and the page breaks at once — where drawing titles as styled text
 * would have meant building all four by hand and keeping them agreeing with
 * each other.
 *
 * @param {object} opts - Options.
 * @param {object} opts.plan - From {@link module:engine/pdf-toc.planDocument}.
 * @param {Map<string, string>} opts.bodies - Anchor → the entry's rendered
 *   Typst body. An entry with no body prints its heading alone.
 * @param {string} opts.title - The document's title.
 * @param {string} [opts.subtitle] - Shown under it on the title page.
 * @param {string[]} [opts.front] - Rendered Typst for each front-matter file.
 * @param {object} [opts.fonts] - `{ serif, sans, mono }` family names. Each
 *   falls back to the face the toolchain ships or the compiler embeds, so a
 *   caller that names none still sets the book in all three.
 * @param {string} [opts.version] - Stamped on the title page when given.
 * @param {string} [opts.preamble] - Definitions the bodies call, emitted once
 *   above the title page. A panel every entry draws is a set of rules stated
 *   here rather than repeated 2,500 times.
 * @param {Map<string, string>} [opts.banners] - A banner as the document tree
 *   declared it → the staged file's path, relative to the `.typ`. A declared
 *   banner this map does not carry has no file the compiler can open, so the
 *   plate draws without a picture.
 * @returns {string} A complete `.typ` document.
 */
export function renderBook({
    plan,
    bodies = new Map(),
    title,
    subtitle = "",
    front = [],
    fonts = {},
    version = "",
    preamble = "",
    banners = new Map(),
} = {}) {
    // The two halves of one superfamily, chosen together: matched metrics are
    // most of why the sans can carry every heading over a serif body without
    // the page reading as two books. The mono is a separate claim — the
    // superfamily's own is missing the Latin Extended Additional letters this
    // corpus spells names with, where the compiler's embedded face carries them.
    const serif = fonts.serif || "Libertinus Serif";
    const sans = fonts.sans || "Libertinus Sans";
    const mono = fonts.mono || "DejaVu Sans Mono";
    const out = [];

    out.push(bookTypstPreamble());
    out.push("");
    out.push(`#set document(title: "${escapeTypstString(title)}")`);
    // Cream stock and dark ink rather than a dark screen theme: 2,000 pages of
    // reversed-out text is a different proposition on paper than on a display.
    out.push(
        '#set page(paper: "us-letter", margin: book-margin, fill: book-paper, numbering: "1")',
    );
    out.push(
        `#set text(font: "${escapeTypstString(serif)}", size: 9.6pt, fill: book-ink, lang: "en")`,
    );
    out.push("#set par(justify: true, leading: 0.55em, first-line-indent: 1.2em)");
    // The mono face is a separate claim from the book face: a fenced block is
    // the one place the corpus is allowed box-drawing characters, and the
    // serif that sets the prose is not the font that carries them.
    out.push(`#show raw: set text(font: "${escapeTypstString(mono)}")`);
    out.push(`#show heading: set text(font: "${escapeTypstString(sans)}")`);
    // Every heading the reader sees inside an entry is a section rule in the
    // accent: the entry's own name is drawn on its plate, where a nested show
    // rule takes the heading back to its words.
    out.push("#show heading: book-sechead");
    // A link the reader can see is the difference between a cross-reference and
    // a sentence that happens to mention something.
    out.push('#show link: set text(fill: rgb("#1b4d7a"))');
    // Tables are the shape most of this corpus is in, so their defaults are the
    // book's defaults: a header that repeats on every page a long table spills
    // onto, and rules light enough not to fight the text.
    out.push("#set table(stroke: (x, y) => (top: 0.4pt, bottom: 0.4pt), inset: 5pt)");
    out.push("#show table.cell.where(y: 0): strong");
    out.push("");

    if (preamble.trim()) {
        out.push(preamble);
        out.push("");
    }

    // Title page.
    out.push("#align(center + horizon)[");
    out.push(`  #text(size: 30pt, weight: "bold")[${escapeTypst(title)}]`);
    if (subtitle) {
        out.push("  #v(0.6em)");
        out.push(`  #text(size: 15pt)[${escapeTypst(subtitle)}]`);
    }
    if (version) {
        out.push("  #v(2em)");
        out.push(`  #text(size: 10pt)[${escapeTypst(version)}]`);
    }
    out.push("]");
    out.push("#pagebreak()");
    out.push("");

    for (const piece of front) {
        if (!piece?.trim()) continue;
        out.push(piece);
        out.push("#pagebreak()");
        out.push("");
    }

    // No `depth:` limit: what prints is decided per heading by `outlined`,
    // below, not by how deep the plan's tree happens to go.
    out.push("#outline(title: [Contents])");
    out.push("#pagebreak()");
    out.push("");

    // The body's geometry, once. Each section restates the columns and the
    // running foot below, because a `set page` rule starts a page and a
    // section opener starts one anyway — so the two cost nothing together.
    out.push(
        "#set page(margin: book-margin, columns: 2, " +
            `footer: book-footer[${escapeTypst(title)}])`,
    );
    out.push("");

    for (const entry of plan?.entries ?? []) {
        const label = labelFor(entry.anchor);
        const depth = Math.min(6, Math.max(1, Number(entry.depth) || 1));
        const page = presentationPage(entry);
        const banner = plateBanner(page, banners);
        if (entry.kind === "section") {
            // A declared `sectionName:` — the structure the printed contents
            // shows and the bookmarks panel shows alongside it. It opens a page
            // of its own so that a section reads as a section rather than as
            // the first entry beneath it.
            out.push(
                `#set page(columns: ${columnsOf(page)}, ` +
                    `footer: book-footer[${escapeTypst(footerName(entry))}])`,
            );
            out.push(
                `#book-section("${escapeTypstString(sectionKicker(entry, title))}", ` +
                    `"${escapeTypstString(entry.title)}", ${banner})[` +
                    `#heading(level: ${depth}, outlined: true, bookmarked: true)` +
                    `[${escapeTypst(entry.title)}] <${label}>]`,
            );
            out.push("");
            continue;
        }
        if (entry.kind === "prose") {
            // Prose carries no title of its own — its headings are its own. The
            // label goes on a zero-width marker so the contents and any inbound
            // link still have somewhere to land.
            out.push("#pagebreak(weak: true)");
            out.push(`#metadata(none) <${label}>`);
            out.push(bodies.get(entry.anchor) ?? "");
            out.push("");
            continue;
        }
        // A note leaf: reachable from the bookmarks panel, titled from
        // `name.full`, and never printed in the paper contents. The heading is
        // handed to the plate, which draws it as the entry's name — one
        // element, so the bookmark, the anchor and the title a reader sees
        // cannot drift apart.
        const name = entry.record?.name?.full ?? entry.record?.address?.slug ?? "(untitled)";
        const description = String(entry.record?.description ?? "").trim();
        const epigraph = description ? `[${escapeTypst(description)}]` : "none";
        out.push(
            `#book-entry("${escapeTypstString(entryKicker(entry))}", ` +
                `"${escapeTypstString(name)}", ${banner}, ${epigraph})[` +
                `#heading(level: ${Math.min(6, depth + 1)}, outlined: false, bookmarked: true)` +
                `[${escapeTypst(name)}] <${label}>]`,
        );
        out.push("");
        const body = bodies.get(entry.anchor);
        if (body) {
            out.push(body);
            out.push("");
        }
    }

    return `${out.join("\n")}\n`;
}

/**
 * The `page:` presentation an entry inherited, as a mapping.
 *
 * @param {object} entry - A plan entry.
 * @returns {object} The mapping, or an empty one.
 */
function presentationPage(entry) {
    const page = entry?.presentation?.page;
    return page && typeof page === "object" && !Array.isArray(page) ? page : {};
}

/**
 * How many columns an entry's pages are set in.
 *
 * @param {object} page - The `page:` presentation.
 * @returns {number} The column count.
 */
function columnsOf(page) {
    const columns = Number(page.columns);
    return Number.isInteger(columns) && columns >= 1 && columns <= 4 ? columns : 2;
}

/**
 * The staged banner an entry's plate draws, as a Typst argument.
 *
 * @param {object} page - The `page:` presentation.
 * @param {Map<string, string>} banners - Declared path → staged path.
 * @returns {string} A quoted path, or `none`.
 */
function plateBanner(page, banners) {
    const staged = typeof page.banner === "string" ? banners.get(page.banner) : undefined;
    return staged ? `"${escapeTypstString(staged)}"` : "none";
}

/**
 * The line an entry's name is set under.
 *
 * The section that holds it, which is what a reader needs to place an entry
 * they have arrived at from the index. A tree that wants something else —
 * the volume's own name, a series line — declares `page.kicker`.
 *
 * @param {object} entry - A plan entry.
 * @returns {string} The kicker.
 */
function entryKicker(entry) {
    const declared = presentationPage(entry).kicker;
    if (typeof declared === "string" && declared.trim()) return declared.trim();
    const trail = Array.isArray(entry.trail) ? entry.trail : [];
    return trail.join(" · ");
}

/**
 * The line a section's own name is set under.
 *
 * The sections above it, and the book's title at the top of the tree — where
 * repeating the section's own name would say nothing.
 *
 * @param {object} entry - A section entry.
 * @param {string} title - The book's title.
 * @returns {string} The kicker.
 */
function sectionKicker(entry, title) {
    const declared = presentationPage(entry).kicker;
    if (typeof declared === "string" && declared.trim()) return declared.trim();
    const trail = Array.isArray(entry.trail) ? entry.trail : [];
    return trail.slice(0, -1).join(" · ") || String(title ?? "");
}

/**
 * The name the running foot carries beneath a section and everything under it.
 *
 * @param {object} entry - A section entry.
 * @returns {string} The name.
 */
function footerName(entry) {
    const declared = entry?.presentation?.footer;
    if (typeof declared === "string" && declared.trim()) return declared.trim();
    return String(entry?.title ?? "");
}

/**
 * Point every internal link at a label the document actually declares.
 *
 * **Typst refuses to compile a reference to a label that is not there.** That
 * makes one mistyped `[[note#appearance]]`, or an anchor written inside a code
 * fence where no heading is emitted, fatal to a 1,200-page book — and fatal at
 * the very end, after everything else has succeeded. A reference book cannot
 * have that failure mode: the link is the least important thing on the page and
 * would be taking the other two thousand entries down with it.
 *
 * So references are reconciled against declarations before the source is
 * written. A link to a section that does not exist falls back to the **entry**
 * that would have contained it, which is where a reader wants to end up anyway;
 * a link with no entry to fall back to becomes plain text. Both are reported.
 *
 * A declaration is a label not preceded by `#link(` — the only two places a
 * label appears are the heading that declares one and the link that uses one.
 *
 * @param {string} source - The assembled Typst document.
 * @param {object[]} [findings] - Collected here rather than thrown.
 * @returns {string} The same document, with no reference left dangling.
 */
export function resolveDanglingLabels(source, findings = []) {
    const text = String(source ?? "");
    const declared = new Set();
    for (const match of text.matchAll(/(?<!#link\()<([A-Za-z0-9_-]+)>/g)) declared.add(match[1]);

    return text.replace(/#link\(<([A-Za-z0-9_-]+)>\)/g, (whole, label) => {
        if (declared.has(label)) return whole;
        // `entry--section` falls back to `entry`: the section is missing, the
        // entry is the page the reader was being sent to.
        const entry = label.includes("--") ? label.slice(0, label.indexOf("--")) : "";
        if (entry && declared.has(entry)) {
            findings.push({
                severity: "warning",
                message:
                    `a link to \`${label}\` found no such section in the book, ` +
                    `so it points at \`${entry}\` instead`,
            });
            return `#link(<${entry}>)`;
        }
        findings.push({
            severity: "warning",
            message: `a link to \`${label}\` found no such destination in the book, so it is set as plain text`,
        });
        // `#link(…)[text]` becomes `#box[text]`: the words survive, the
        // reference does not, and nothing is silently deleted from the page.
        return "#box";
    });
}

/**
 * Every icon name a body uses, so a build can resolve them once.
 *
 * @param {string} markdown - A note body.
 * @returns {string[]} The names, in order of appearance, with repeats.
 */
export function iconNamesIn(markdown) {
    const names = [];
    for (const match of String(markdown ?? "").matchAll(ICON_PATTERN)) names.push(match[1]);
    return names;
}
