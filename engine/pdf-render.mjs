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

import { iconPlugin, ICON_PATTERN } from "./content-icons.mjs";

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
 * @param {number} [opts.headingOffset] - Added to every heading level, so a
 *   note's own `##` nests beneath the entry heading the book gave it.
 * @param {string} [opts.anchorPrefix] - The entry's anchor, which namespaces
 *   every `{#slug}` the body declares.
 * @returns {string} Typst markup.
 */
export function markdownToTypst(markdown, opts = {}) {
    const {
        md = createParser(opts.registry),
        links = new Map(),
        glyphs = new Map(),
        headingOffset = 0,
        anchorPrefix = "",
    } = opts;
    const tokens = md.parse(String(markdown ?? ""), {});
    return renderTokens(tokens, { links, glyphs, headingOffset, anchorPrefix });
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
            const level = Math.min(6, Number(token.tag.slice(1)) + ctx.headingOffset);
            const inline = tokens[i + 1];
            // `## Appearance {#appearance}` declares an addressable section. The
            // journals compiler strips the suffix and surfaces it as an anchor;
            // so does this, because a book that printed the braces would show
            // every reader the markup that makes a link work.
            const { text, anchor } = splitHeadingAnchor(inline, ctx);
            const label = anchor ? ` <${sectionLabel(ctx.anchorPrefix, anchor)}>` : "";
            out.push(`\n${"=".repeat(Math.max(1, level))} ${text}${label}\n\n`);
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
            const inner = renderTokens(tokens.slice(i + 1, end), ctx);
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
        items.push(renderTokens(tokens.slice(i + 1, close), ctx));
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
    return `\n#table(\n  columns: ${columns},${alignment}${header}\n${body}\n)\n\n`;
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
            case "image": {
                // An image has no route into a book that does not also carry the
                // file, and the asset tree is not this pass's to resolve. The
                // alt text is what the note said the picture was for.
                const alt = child.content || child.attrGet?.("alt") || "";
                if (alt) out.push(`#emph[${escapeTypst(alt)}]`);
                break;
            }
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
 * The whole book, as one Typst document.
 *
 * **Pure, and that is the point.** Everything a reviewer of #316 has to check
 * about structure — the outline's shape, the anchors, which links went inward,
 * the order entries print in — is decided here from a plan and a map of bodies,
 * with no filesystem and no compiler. {@link module:engine/pdf-build} supplies
 * both and runs Typst over the result.
 *
 * ## Two outlines, and why they are not the same outline
 *
 * A roster of 2,500 entries wants every entry reachable from a viewer's
 * sidebar, and emphatically does not want all 2,500 printed in the front
 * matter: that is forty pages of contents before the book starts.
 *
 * Typst separates the two for us. **The PDF bookmark outline is built from
 * every heading**, so each entry gets its own node at its own depth for free
 * and the sidebar is the navigational interface the issue asks for.
 * **`#outline()` prints only to `tocDepth`**, so the paper table of contents
 * stays the sections. Both are page-numbered and both are links.
 *
 * ## Headings carry the structure, so nothing else has to
 *
 * Every section, every prose file and every entry is a real Typst heading at
 * its plan depth. That single decision supplies the bookmarks, the printed
 * contents, the running heads and the page breaks at once — where drawing
 * titles as styled text would have meant building all four by hand and keeping
 * them agreeing with each other.
 *
 * @param {object} opts - Options.
 * @param {object} opts.plan - From {@link module:engine/pdf-toc.planDocument}.
 * @param {Map<string, string>} opts.bodies - Anchor → the entry's rendered
 *   Typst body. An entry with no body prints its heading alone.
 * @param {string} opts.title - The document's title.
 * @param {string} [opts.subtitle] - Shown under it on the title page.
 * @param {string[]} [opts.front] - Rendered Typst for each front-matter file.
 * @param {object} [opts.fonts] - `{ serif, sans, mono }` family names.
 * @param {number} [opts.tocDepth] - How deep the *printed* contents go.
 * @param {string} [opts.version] - Stamped on the title page when given.
 * @returns {string} A complete `.typ` document.
 */
export function renderBook({
    plan,
    bodies = new Map(),
    title,
    subtitle = "",
    front = [],
    fonts = {},
    tocDepth = 2,
    version = "",
} = {}) {
    const serif = fonts.serif || "Libertinus Serif";
    const sans = fonts.sans || serif;
    const mono = fonts.mono || "DejaVu Sans Mono";
    const out = [];

    out.push(`#set document(title: "${escapeTypstString(title)}")`);
    out.push('#set page(paper: "us-letter", margin: (x: 2.2cm, y: 2.4cm), numbering: "1")');
    out.push(`#set text(font: "${escapeTypstString(serif)}", size: 10pt, lang: "en")`);
    out.push("#set par(justify: true, leading: 0.65em)");
    // The mono face is a separate claim from the book face: a fenced block is
    // the one place the corpus is allowed box-drawing characters, and the
    // serif that sets the prose is not the font that carries them.
    out.push(`#show raw: set text(font: "${escapeTypstString(mono)}")`);
    out.push(`#show heading: set text(font: "${escapeTypstString(sans)}")`);
    // A link the reader can see is the difference between a cross-reference and
    // a sentence that happens to mention something.
    out.push('#show link: set text(fill: rgb("#1b4d7a"))');
    // Tables are the shape most of this corpus is in, so their defaults are the
    // book's defaults: a header that repeats on every page a long table spills
    // onto, and rules light enough not to fight the text.
    out.push("#set table(stroke: (x, y) => (top: 0.4pt, bottom: 0.4pt), inset: 5pt)");
    out.push("#show table.cell.where(y: 0): strong");
    out.push("");

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

    out.push(`#outline(title: [Contents], depth: ${Math.max(1, Number(tocDepth) || 2)})`);
    out.push("#pagebreak()");
    out.push("");

    for (const entry of plan?.entries ?? []) {
        const label = labelFor(entry.anchor);
        const depth = Math.min(6, Math.max(1, Number(entry.depth) || 1));
        if (entry.kind === "section") {
            out.push(`${"=".repeat(depth)} ${escapeTypst(entry.title)} <${label}>`);
            out.push("");
            continue;
        }
        if (entry.kind === "prose") {
            // Prose carries no title of its own — its headings are its own. The
            // label goes on a zero-width marker so the contents and any inbound
            // link still have somewhere to land.
            out.push(`#metadata(none) <${label}>`);
            out.push(bodies.get(entry.anchor) ?? "");
            out.push("");
            continue;
        }
        const name = entry.record?.name?.full ?? entry.record?.address?.slug ?? "(untitled)";
        out.push(`${"=".repeat(Math.min(6, depth + 1))} ${escapeTypst(name)} <${label}>`);
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
