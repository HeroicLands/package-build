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
 * `:icon star-outline:` is parsed by the *same* {@link module:engine/content-icons.iconPlugin}
 * the journals and the website use — one rule, three surfaces — and only the
 * output differs. The glyph is resolved from the font file the consumer named,
 * because the registry deliberately holds no codepoints; when no font is
 * configured for an icon's family the name is set as literal text, which is the
 * visible failure the registry was designed to produce.
 *
 * @module
 */

import MarkdownIt from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";

import { bookDraftNoticePreamble } from "./draft-notice.mjs";
import { iconPlugin, ICON_PATTERN, ICON_SIZES } from "./content-icons.mjs";
import { IMAGE_CLASSES, IMAGE_FLOATS, IMAGE_PATTERN, imagePlugin } from "./content-images.mjs";
import { bookImageWidthIn } from "./pdf-images.mjs";

/** Requested print width for every named image size. */
export const BOOK_IMAGE_WIDTHS = Object.freeze({
    auto: "auto",
    small: "1.6cm",
    medium: "3.2cm",
    large: "5.6cm",
    xlarge: "8cm",
    "full-width": '"full-width"',
});
import { slugify } from "./content-slug.mjs";
import { scanFigures } from "./content-figures.mjs";
import { BLOCK_CONTAINERS, scanBlocks, BLOCK_NAMES } from "./content-blocks.mjs";
import { matchAllOutsideCode, replaceOutsideCode } from "./code-fences.mjs";
import { HTML_TAG, htmlMessage } from "./content-html.mjs";
import { EXPRESSION } from "./markdown-expressions.mjs";
import { WIKILINK } from "./wikilink-syntax.mjs";
import { EMBED_PATTERN } from "./content-embeds.mjs";
import { positionInBody } from "./diagnostics.mjs";
import {
    WITHHELD_CLASS,
    scanHeadingAttributes,
    splitHeadingAttributes,
    withheldSections,
} from "./heading-attributes.mjs";

/**
 * How each named block prints. Typst has no stylesheet to defer to, so the
 * colours live here rather than in the emitted markup; the HTML surfaces carry
 * a class and let CSS decide.
 */
const BLOCK_PRINT = Object.freeze({
    info: Object.freeze({ color: "#2f6f9f", background: "#eef6fb", symbol: "i" }),
    secret: Object.freeze({ color: "#5c4b8a", background: "#f2eefb", symbol: "!" }),
    warn: Object.freeze({ color: "#9a6700", background: "#fff5db", symbol: "!" }),
});

import {
    misplacedFootnoteDefinitions,
    separateFootnotes,
    unresolvedFootnoteReferences,
    unusedFootnoteDefinitions,
} from "./content-footnotes.mjs";

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
    md.use(footnotePlugin);
    md.use(deflistPlugin);
    md.use(iconPlugin(registry));
    // The same plugin the HTML surfaces use, so one directive is read once and
    // three renderers read the same `meta` off the same token.
    md.use(imagePlugin());
    return md;
}

/**
 * A closed HTML comment, however many lines it spans.
 *
 * Closed only: an unclosed `<!--` is text by CommonMark's reading, and a
 * pattern that ran to the end of the file for want of a closer would delete
 * every line after the mistake. {@link reportUnrenderable} names it instead.
 *
 * @type {RegExp}
 */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * A markdown body with its HTML comments taken out.
 *
 * A comment is an author's aside to the next author — a `markdownlint` pragma, a
 * note recording why a notice is quoted verbatim — and no surface shows one: the
 * packs and the website emit it into HTML, where it is a comment still. Typst
 * has nowhere to put it, so markdown-it hands the delimiters over as prose and
 * the aside is typeset. It comes out here instead, and a comment inside a fence
 * or a code span stays, because there it is an example of a comment.
 *
 * **The line count is preserved.** Every finding this module reports is located
 * in the markdown it was handed, so a pass that removed a line would move every
 * position after it.
 *
 * @param {string} markdown - The body, as authored.
 * @returns {string} The same body, its comments replaced by their own newlines.
 */
export function stripHtmlComments(markdown) {
    return replaceOutsideCode(String(markdown ?? ""), HTML_COMMENT, (comment) =>
        "\n".repeat((comment.match(/\n/g) ?? []).length),
    );
}

/**
 * Where a position in the markdown handed in falls in the file that holds it.
 *
 * The three corrections {@link module:engine/diagnostics.positionInBody} makes,
 * applied to a line and column rather than to an offset: the frontmatter above
 * the body, the indentation a trimmed first line lost, and a line that a
 * content table generated and no author wrote — which has no column to point at.
 *
 * @param {number} line - 1-based line within the markdown.
 * @param {number} column - 1-based column within that line.
 * @param {object} [opts] - As {@link markdownToTypst} takes.
 * @returns {{line: number, column?: number}} The position, in the file.
 */
function linePosition(line, column, { bodyLine = 1, bodyColumn = 1, lineMap } = {}) {
    const mapped = lineMap?.[line - 1];
    const sourceLine = mapped ? mapped.line : line - 1;
    if (mapped?.generated) return { line: bodyLine + sourceLine };
    return {
        line: bodyLine + sourceLine,
        column: sourceLine === 0 ? bodyColumn + column - 1 : column,
    };
}

/**
 * Where a character offset within the markdown handed in falls in its file.
 *
 * @param {string} source - The markdown the offset indexes into.
 * @param {number} offset - 0-based character offset.
 * @param {object} [opts] - As {@link markdownToTypst} takes.
 * @returns {{line: number, column?: number}} The position, in the file.
 */
function offsetPosition(source, offset, opts = {}) {
    const { line, column, generated } = positionInBody(source, offset, opts);
    return generated ? { line } : { line, column };
}

/**
 * Everything in one body that the book cannot set, reported.
 *
 * **The renderer owes a finding for every construct it meets and cannot
 * render.** It emits text and reads nothing, so there is no state it can refuse
 * from; what it can do is say what it met, at the line it met it, and let the
 * caller decide. Without that a body carrying a construct this pass does not
 * handle is typeset as its own markup — delimiters, braces and all — and the
 * build exits 0 having printed the mistake into the book.
 *
 * Two families are named here, and they fail for opposite reasons:
 *
 * - **A construct no book renderer reads.** Raw HTML, and an HTML comment that
 *   is never closed. Both reach Typst as prose, and the first is reported in
 *   {@link module:engine/content-html}'s own words so one authored tag does not
 *   get two explanations.
 * - **A pass's output that never arrived.** A wikilink, an embed and an inline
 *   `{{…}}` expression are each resolved before the book sees them; one that is
 *   still in the markdown means the pass that owns it did not run over this
 *   body, and the markup is about to be typeset verbatim. Reported only where
 *   those passes did not run — `opts.prepared` — because each of them leaves the
 *   markup as written when it fails and has already said so in its own words.
 *
 * A `:::` block and a `:::figure` are the pair this pass does handle, and their
 * own scanners decide what is well formed; their findings are reported here so
 * that a front-matter file, a prose file and a note body all get them.
 *
 * @param {string} source - The body, comments already stripped.
 * @param {string} definitions - The footnote definitions separated from it.
 * @param {object} opts - As {@link markdownToTypst} takes.
 * @param {string} original - `source` before its definitions were blanked —
 *   {@link unusedFootnoteDefinitions} locates a definition by searching for
 *   its own text, which `source` no longer carries.
 * @returns {void}
 */
function reportUnrenderable(source, definitions, opts, original) {
    const findings = opts.findings;
    if (!findings) return;
    const file = opts.file ? { file: opts.file } : {};
    /**
     * @param {{line: number, column?: number}} position - Where it is.
     * @param {"warning"|"error"} severity - Which level.
     * @param {string} message - What is wrong.
     * @returns {void}
     */
    const report = (position, severity, message) => {
        findings.push({ ...file, ...position, severity, message });
    };

    const blocks = scanBlocks(source);
    for (const error of blocks.errors)
        report(linePosition(error.line, error.column, opts), "error", error.message);
    // A container's body, read for faults of its own — an empty box, an
    // attribute that does not parse — which the scan above passes over, because
    // there an inner opener is a counted line rather than a block.
    //
    // Only where that reading was sound. One mistake draws several findings from
    // a single scan already, and a body read from a misread outer block draws
    // more that say the same thing in other words. One level down and no
    // further: a box inside a GM-only section is the only nesting the format
    // admits.
    const lines = source.split("\n");
    if (!blocks.errors.length) {
        for (const block of blocks.blocks) {
            if (!BLOCK_CONTAINERS.includes(block.name)) continue;
            const body = lines.slice(block.start + 1, block.end).join("\n");
            for (const error of scanBlocks(body).errors)
                report(
                    linePosition(block.start + 1 + error.line, error.column, opts),
                    "error",
                    error.message,
                );
        }
    }
    for (const error of scanFigures(source).errors)
        report(linePosition(error.line, error.column, opts), "error", error.message);
    for (const error of scanHeadingAttributes(source).errors)
        report(linePosition(error.line, error.column, opts), "error", error.message);
    for (const error of withheldSections(source).errors)
        report(linePosition(error.line, error.column, opts), "error", error.message);

    // Every closed comment is gone by the time this runs, so an opener still
    // here is one that was never closed — on the website that swallows the rest
    // of the page, and here it is typeset.
    for (const match of matchAllOutsideCode(source, /<!--/g))
        report(
            offsetPosition(source, match.index, opts),
            "error",
            "an HTML comment is opened and never closed — close it with `-->`",
        );
    for (const match of matchAllOutsideCode(source, HTML_TAG))
        report(offsetPosition(source, match.index, opts), "warning", htmlMessage(match[0]));
    if (!opts.prepared) {
        for (const match of matchAllOutsideCode(source, EMBED_PATTERN))
            report(
                offsetPosition(source, match.index, opts),
                "error",
                `\`${match[0]}\` reaches the book as written — an embed is resolved to a ` +
                    "picture before the book is set, and nothing resolved this one",
            );
        for (const match of matchAllOutsideCode(source, WIKILINK))
            report(
                offsetPosition(source, match.index, opts),
                "error",
                `\`${match[0]}\` reaches the book as written — a link is resolved to an ` +
                    "address before the book is set, and nothing resolved this one",
            );
        for (const match of matchAllOutsideCode(source, EXPRESSION))
            report(
                offsetPosition(source, match.index, opts),
                "error",
                `\`${match[0]}\` reaches the book as written — an expression is evaluated ` +
                    "before the book is set, and nothing evaluated this one",
            );
    }
    // Derived from the one place that already finds definitions, rather than
    // a second scanner that could drift from {@link separateFootnotes} — the
    // web and Foundry report the identical three findings from the identical
    // functions.
    for (const error of misplacedFootnoteDefinitions(source))
        report(linePosition(error.line, error.column, opts), "error", error.message);
    for (const error of unresolvedFootnoteReferences(source, definitions))
        report(linePosition(error.line, error.column, opts), "error", error.message);
    for (const error of unusedFootnoteDefinitions(original))
        report(linePosition(error.line, error.column, opts), "error", error.message);
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
 * @param {Map<string, {type: string, role?: string, width: number|"", height: number|""}>}
 *   [opts.assets] - An image's address as authored → what
 *   {@link module:engine/art-fields.assetImageInfoByPathname} records for it,
 *   which is what sizes a picture carrying no named `size=` — see
 *   {@link module:engine/pdf-images.bookImageWidthIn}. An address missing from
 *   this map draws at the medium's ordinary size, the same as today.
 * @param {number} [opts.headingOffset] - Added to every heading level, so a
 *   note's own `##` nests beneath the entry heading the book gave it.
 * @param {string} [opts.anchorPrefix] - The entry's anchor, which namespaces
 *   every `{#slug}` the body declares.
 * @param {object[]} [opts.findings] - Collected here rather than thrown. Every
 *   construct this pass cannot render is reported into it — see
 *   {@link reportUnrenderable} — and a caller that passes none renders the same
 *   Typst and is told nothing.
 * @param {string} [opts.file] - The file the markdown came from, named in every
 *   finding.
 * @param {number} [opts.bodyLine] - The 1-based file line the body starts on, so
 *   a finding's line is the file's rather than the body's.
 * @param {number} [opts.bodyColumn] - The 1-based column the body starts at.
 * @param {Array<{line: number, generated: boolean}>} [opts.lineMap] - From
 *   table expansion, mapping each line handed in back to the line an author
 *   wrote.
 * @param {boolean} [opts.prepared] - Whether this body has been through the
 *   passes that resolve a wikilink, an embed and an inline expression. A note's
 *   has; a front-matter file's and a prose file's have not, and markup of theirs
 *   left in one is reported rather than typeset in silence.
 * @param {string} [opts.url] - The absolute address this book's pages are served
 *   at. Every link the book sets as a URL is resolved against it, because a
 *   reader holding a PDF has no page to resolve a path against — see
 *   {@link renderLink}.
 * @returns {string} Typst markup.
 */
export function markdownToTypst(markdown, opts = {}) {
    const {
        md = createParser(opts.registry),
        links = new Map(),
        glyphs = new Map(),
        images = new Map(),
        assets = new Map(),
        headingOffset = 0,
        anchorPrefix = "",
    } = opts;
    const given = opts.nested ? String(markdown ?? "") : stripHtmlComments(markdown);
    const separated = opts.footnoteDefinitions === undefined ? separateFootnotes(given) : null;
    const source = separated?.markdown ?? given;
    const definitions = opts.footnoteDefinitions ?? separated?.definitions ?? "";
    const footnoteState = opts.footnoteState ?? { seen: new Set() };
    const sharedOptions = {
        ...opts,
        footnoteDefinitions: definitions,
        footnoteState,
        nested: true,
    };
    // Read once, over the body as it arrived: every position a finding carries
    // is an offset into *this* string, and the renderer below walks slices of it.
    if (!opts.nested) reportUnrenderable(source, definitions, opts, given);
    // One map for the whole body, not one per block: a heading inside a
    // blockquote or a list item shares the entry's anchor namespace with every
    // other heading in the same body, because `sectionLabel` scopes by entry
    // rather than by container.
    const ctx = {
        md,
        links,
        glyphs,
        images,
        assets,
        headingOffset,
        anchorPrefix,
        url: opts.url,
        seen: new Map(),
        footnoteState,
        footnotePrefix: opts.footnotePrefix ?? `footnote-${slugify(anchorPrefix || "body")}`,
    };
    // A withheld section is set in the box a `:::secret` is set in, and its
    // heading is set inside it: a printed page honours no reader permission, so
    // the labelled box is what tells a referee the section is for them. Read
    // outermost, before the named blocks, because a section holds blocks of its
    // own and they are rendered by the recursion into its body.
    if (!opts.insideAdmonition && !opts.insideWithheld) {
        const { sections } = withheldSections(source);
        if (sections.length) {
            const lines = source.split("\n");
            const output = [];
            let cursor = 0;
            for (const section of sections) {
                output.push(
                    markdownToTypst(lines.slice(cursor, section.start).join("\n"), sharedOptions),
                );
                output.push(
                    withheldBox(
                        markdownToTypst(lines.slice(section.start, section.end).join("\n"), {
                            ...sharedOptions,
                            insideWithheld: true,
                        }),
                        ctx,
                    ),
                );
                cursor = section.end;
            }
            output.push(markdownToTypst(lines.slice(cursor).join("\n"), sharedOptions));
            return output.join("\n");
        }
    }
    if (!opts.insideAdmonition) {
        const { blocks } = scanBlocks(source);
        if (blocks.length) {
            const lines = source.split("\n");
            const output = [];
            let cursor = 0;
            for (const block of blocks) {
                output.push(
                    markdownToTypst(lines.slice(cursor, block.start).join("\n"), {
                        ...sharedOptions,
                        insideAdmonition: true,
                    }),
                );
                const { color, background, symbol } = BLOCK_PRINT[block.name];
                // The title is inline markdown, rendered the way every other
                // phrase in the book is. Set as it was written it would be read
                // by Typst instead: `*word*` is bold there and emphasis here, a
                // `#` opens a function call, and one unbalanced `]` ends the box
                // and takes the rest of the document with it.
                const label = inlineMarkup(block.title, ctx);
                // A GM-only section holds a box, so its body is read for blocks
                // of its own; a box holds none, and the scan has already said so.
                const content = markdownToTypst(block.body, {
                    ...sharedOptions,
                    insideAdmonition: !BLOCK_CONTAINERS.includes(block.name),
                });
                output.push(
                    `\n#block(width: 100%, fill: rgb("${background}"), stroke: (left: 2pt + rgb("${color}")), inset: 8pt, above: 0.7em, below: 0.7em)[#text(fill: rgb("${color}"), weight: "bold")[${symbol} ${label}]\n\n${content}]\n`,
                );
                cursor = block.end + 1;
            }
            output.push(
                markdownToTypst(lines.slice(cursor).join("\n"), {
                    ...sharedOptions,
                    insideAdmonition: true,
                }),
            );
            return output.join("\n");
        }
    }
    const lines = source.split("\n");
    const localFigures = scanFigures(source).figures;
    // Numbered by the caller, which counts across the whole book, and placed by
    // the scan above, which is the only reading of *this* body. Paired by
    // position: two figures may share an id — a finding, and the book is built
    // anyway — and keying on one would give the second figure's lines to the
    // first, printing its contents twice and losing its label.
    const provided = opts.captions ?? localFigures;
    const numbered = new Map(provided.map((figure) => [figure.id, figure]));
    const captions = localFigures.map((figure, at) => {
        const counted =
            provided[at]?.id === figure.id ? provided[at] : (numbered.get(figure.id) ?? figure);
        return { ...figure, label: counted.label, number: counted.number };
    });
    if (!captions.length) return renderMarkdownSegment(source, md, ctx, definitions);
    const out = [];
    let cursor = 0;
    for (const caption of captions) {
        out.push(
            renderMarkdownSegment(
                lines.slice(cursor, caption.line - 1).join("\n"),
                md,
                ctx,
                definitions,
            ),
        );
        const block = lines.slice(caption.bodyStart, caption.bodyEnd).join("\n");
        // A grouped figure's images are rendered through the same call that
        // reads `ctx.caption`, so `renderImage` needs to know which one is
        // last — see the counter it decrements, set only for a `figure`-kind
        // fence, where more than one image can share the one caption.
        const captioned =
            caption.kind === "figure" ?
                { ...caption, imagesRemaining: { n: countImages(block) } }
            :   caption;
        const segments = [
            renderMarkdownSegment(block, md, { ...ctx, caption: captioned }, definitions),
        ];
        if (caption.kind !== "table" && caption.kind !== "figure") {
            segments.push(
                `\n#block(below: 0.6em)[#text(size: 7.6pt, style: "italic")[${captionMarkup(caption, ctx)}]]${typstAnchor(anchorPrefix, caption)}\n\n`,
            );
        }
        out.push(
            caption.classes.includes("border") ?
                figureBorder(segments.join(""))
            :   segments.join(""),
        );
        cursor = caption.close + 1;
    }
    out.push(renderMarkdownSegment(lines.slice(cursor).join("\n"), md, ctx, definitions));
    return out.filter(Boolean).join("\n\n");
}

/** Render one fragment with the note's footnote definitions available. */
function renderMarkdownSegment(source, md, ctx, definitions) {
    const input = definitions ? `${source}\n\n${definitions}` : source;
    const tokens = md.parse(input, {});
    const footnoteStart = tokens.findIndex((token) => token.type === "footnote_block_open");
    const visible = footnoteStart < 0 ? tokens : tokens.slice(0, footnoteStart);
    const footnotes = new Map();
    if (footnoteStart >= 0) {
        for (let at = footnoteStart + 1; at < tokens.length; at++) {
            if (tokens[at].type !== "footnote_open") continue;
            const id = tokens[at].meta.id;
            const start = at + 1;
            while (at < tokens.length && tokens[at].type !== "footnote_close") at++;
            footnotes.set(id, tokens.slice(start, at));
        }
    }
    return renderTokens(visible, { ...ctx, footnotes });
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
        case "dl_open": {
            const end = matching(tokens, i, "dl_open", "dl_close");
            const entries = [];
            let at = i + 1;
            while (at < end) {
                if (tokens[at].type !== "dt_open") {
                    at++;
                    continue;
                }
                const termEnd = matching(tokens, at, "dt_open", "dt_close");
                const term = renderTokens(tokens.slice(at + 1, termEnd), ctx);
                at = termEnd + 1;
                const definitions = [];
                while (at < end && tokens[at].type === "dd_open") {
                    const definitionEnd = matching(tokens, at, "dd_open", "dd_close");
                    definitions.push(renderTokens(tokens.slice(at + 1, definitionEnd), ctx));
                    at = definitionEnd + 1;
                }
                entries.push(`terms.item([${term}],[${definitions.join("\n\n")}])`);
            }
            out.push(`\n#terms(${entries.join(", ")})\n\n`);
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
 * A withheld section, set in the box a `secret` block is set in.
 *
 * @param {string} content - The section's rendered Typst, heading included.
 * @param {object} ctx - Render context, for the label's inline markup.
 * @returns {string} Typst markup.
 */
function withheldBox(content, ctx) {
    const { color, background, symbol } = BLOCK_PRINT[WITHHELD_CLASS];
    const label = inlineMarkup(BLOCK_NAMES[WITHHELD_CLASS], ctx);
    return `\n#block(width: 100%, fill: rgb("${background}"), stroke: (left: 2pt + rgb("${color}")), inset: 8pt, above: 0.7em, below: 0.7em)[#text(fill: rgb("${color}"), weight: "bold")[${symbol} ${label}]\n\n${content}]\n`;
}

/**
 * A heading's text, and the attribute block it may end with.
 *
 * The suffix is removed from the *rendered* children rather than from the raw
 * source, so an anchor written inside emphasis or after a link still comes off
 * cleanly and the text either side of it survives.
 *
 * A class and an attribute have nowhere to go in Typst, which has no
 * stylesheet, so the id is what the book takes and the rest is dropped — the
 * reference says so per surface.
 *
 * @param {object} inline - The heading's `inline` token.
 * @param {object} ctx - Render context.
 * @returns {{text: string, anchor: string}} The heading, and its anchor or "".
 */
function splitHeadingAnchor(inline, ctx) {
    const last = inline?.children?.[(inline.children?.length ?? 0) - 1];
    const raw = last?.type === "text" ? String(last.content ?? "") : "";
    const parsed = splitHeadingAttributes(raw);
    if (!parsed.braces || parsed.problems.length) {
        return { text: renderInline(inline, ctx), anchor: "" };
    }
    // Rendered with the suffix removed from a copy, so the token stream the
    // caller owns is not mutated — the same tokens are walked again by the
    // journals and the index.
    const children = [...inline.children];
    children[children.length - 1] = { ...last, content: parsed.text };
    return { text: renderInline({ ...inline, children }, ctx), anchor: parsed.id };
}

/**
 * A heading's words, unescaped and without its attribute block.
 *
 * Used only to derive an anchor when the author wrote none, so it wants the
 * words as typed rather than the Typst-escaped text {@link splitHeadingAnchor}
 * renders — {@link module:engine/content-slug.slugify} normalises punctuation
 * and case itself and has no use for an escape backslash. The block comes off
 * because a heading that declares classes alone would otherwise be addressed by
 * an anchor naming them.
 *
 * @param {object} inline - The heading's `inline` token.
 * @returns {string} The heading's raw text.
 */
function plainHeadingText(inline) {
    const children = inline?.children ?? [];
    const raw = children.map((child) => child.content ?? "").join("");
    const parsed = splitHeadingAttributes(raw);
    return parsed.problems.length ? raw : parsed.text;
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
 * A phrase of inline Markdown, set the way the prose around it is.
 *
 * A caption, a named block's title: text an author writes outside a paragraph
 * and still expects emphasis in. Rendering it through the same walk is also what
 * makes it inert — Typst's own markup characters are escaped on the way, which
 * handing the string over raw does not do.
 *
 * @param {string} text - The phrase, as authored.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function inlineMarkup(text, ctx) {
    const inline = ctx.md.parseInline(String(text ?? ""), {})[0];
    return inline ? renderInline(inline, ctx) : "";
}

/**
 * A figure's label, with its caption when it carries one.
 *
 * The caption's inline Markdown is handled the way the surrounding prose is. A
 * figure with no caption draws its label alone.
 *
 * @param {object} caption - A figure record.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function captionMarkup(caption, ctx) {
    const label = escapeTypst(caption.label);
    return caption.hasCaption ? `${label}: ${inlineMarkup(caption.caption, ctx)}` : label;
}

/**
 * How many markdown images a figure's contents carry.
 *
 * A grouped figure's `///` caption describes the whole plate, not any one
 * picture in it, so {@link renderImage} needs to know which image is the
 * last — the one that carries the group's single label and anchor — and this
 * is the count it counts down from.
 *
 * @param {string} contents - The figure's captioned contents, as authored.
 * @returns {number} How many images the contents hold.
 */
function countImages(contents) {
    return (String(contents ?? "").match(IMAGE_PATTERN) ?? []).length;
}

/**
 * `.border` draws the whole figure — its content and its label together —
 * inside a hairline box. A thin stroke is print's equivalent of a border and
 * padding on the web and in a Foundry journal: a figure already sits inside
 * its own column or float, so the book's version of a border is the lightest
 * mark that still reads as one rather than a second, heavier frame around a
 * frame.
 *
 * @param {string} body - The figure's own rendered Typst, content and label.
 * @returns {string} Typst markup.
 */
function figureBorder(body) {
    return `\n#block(width: 100%, stroke: 0.4pt + luma(60%), inset: 8pt, above: 0.6em, below: 0.6em)[\n${body}\n]\n\n`;
}

/**
 * The Typst label a figure is referenced by, or `""` when it declares no id.
 *
 * A figure with no id is numbered and drawn and nothing addresses it, so it is
 * given no label: an empty one would collide with every other idless figure.
 *
 * @param {string} prefix - The entry's anchor prefix.
 * @param {object} caption - A figure record.
 * @returns {string} A ` <label>` to append, or `""`.
 */
function typstAnchor(prefix, caption) {
    return caption.id ? ` <${sectionLabel(prefix, slugify(caption.id))}>` : "";
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
    const caption = ctx.caption;
    const labelled =
        caption ?
            `#text(size: 7.6pt, style: "italic")[${captionMarkup(caption, ctx)}]${typstAnchor(ctx.anchorPrefix, caption)}\n${drawn}`
        :   drawn;
    // Wide content is given an explicit span rather than left to overflow the
    // measure: past three columns a table is set across the page, and
    // `book-wide` decides between a float and pages of its own by measuring it.
    if (columns > WIDE_TABLE_COLUMNS)
        return `${caption ? "" : "\n#pagebreak(weak: true)\n"}\n#book-wide[\n${labelled}\n]\n\n`;
    return `\n${labelled}\n\n`;
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
            case "footnote_ref": {
                const label = child.meta?.label ?? String(child.meta?.id ?? "");
                const key = `${ctx.footnotePrefix}-${slugify(label)}`;
                const body = ctx.footnotes?.get(child.meta?.id);
                if (!body) {
                    out.push(escapeTypst(`[^${label}]`));
                    break;
                }
                if (ctx.footnoteState.seen.has(key)) out.push(`#footnote(<${key}>)`);
                else {
                    ctx.footnoteState.seen.add(key);
                    out.push(`#footnote[${renderTokens(body, ctx)}] <${key}>`);
                }
                break;
            }
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
    return `#raw("${escapeTypstString(content)}", block: false)`;
}

/**
 * A page address as a reader of the book can follow it.
 *
 * **Every link the book sets as a URL is absolute.** A page's address is written
 * from the root of the site that serves it — `/sohl/skill-guil/` — because on the
 * website that is the shortest form that is right wherever the page is read
 * from. A PDF is read from nowhere: a viewer handed a path has no document to
 * resolve it against, so it either does nothing or looks for a file on the
 * reader's own disk, and a book of a thousand pages carries a thousand links
 * that do neither.
 *
 * So a root-relative address is resolved against the site's own, which is the
 * one absolute address a build already holds. A **dependency's** page keeps its
 * own package prefix, from the registry in
 * {@link module:engine/content-address.PACKAGE_BASE}, so it resolves to the host
 * serving that package — and where the registry names a host of its own the
 * address is already absolute and is left exactly as it is.
 *
 * @param {string} url - The address, as the link pass resolved it.
 * @param {string} [site] - The absolute address this book's pages are served at.
 * @returns {string} An absolute URL, or the address unchanged when there is no
 *   site to resolve it against or it is already absolute.
 */
export function absolutePageUrl(url, site) {
    const address = String(url ?? "");
    if (!site || !address.startsWith("/") || address.startsWith("//")) return address;
    try {
        return new URL(address, site).href;
    } catch {
        return address;
    }
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
    if (url.startsWith("#") && fragment)
        return `#link(<${sectionLabel(ctx.anchorPrefix, fragment)}>)[${inner}]`;
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
    return `#link("${escapeTypstString(absolutePageUrl(url, ctx.url))}")[${inner}]`;
}

/**
 * A width in inches, as a Typst length literal.
 *
 * @param {number} inches - The width.
 * @returns {string} A Typst length, rounded to a thousandth of an inch.
 */
function typstInches(inches) {
    return `${Math.round(inches * 1000) / 1000}in`;
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
 * A `.full-width` image that **also states a `float`** is asking for a float,
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
 * page. An address the build could not stage prints its authored caption alone
 * instead, if it has one, and nothing at all if it does not; the build reports
 * the address it could not find either way.
 *
 * ## A grouped figure's one label belongs to the last picture
 *
 * Only a figure-kind fence labels an image inline — a fence holding anything
 * besides pictures is prose, and gets its label from the generic block-level
 * print in {@link markdownToTypst} instead, the same as a code or a table
 * fence. Within a figure-kind fence, `ctx.caption.imagesRemaining` counts down
 * one picture at a time; the picture that brings it to zero is the last one in
 * document order, and only that one carries the caption and the anchor. Every
 * other picture in the group draws with no caption at all. Attaching the label
 * to each of them would print the same text under every picture and emit the
 * same Typst label more than once, which Typst refuses to compile.
 *
 * @param {object} token - An `image` token.
 * @param {object} ctx - Render context.
 * @returns {string} Typst markup.
 */
function renderImage(token, ctx) {
    const figureCaption = ctx.caption?.kind === "figure" ? ctx.caption : null;
    const remaining = figureCaption?.imagesRemaining;
    const isLastImage = !remaining || --remaining.n <= 0;
    const labelled = Boolean(figureCaption) && isLastImage;
    const captionText = labelled ? captionMarkup(figureCaption, ctx) : "";
    const caption = captionText ? `[${captionText}]` : "none";
    const anchor = labelled ? typstAnchor(ctx.anchorPrefix, figureCaption) : "";
    const src = token.attrGet?.("src") ?? "";
    const staged = ctx.images.get(src);
    if (!staged)
        return captionText ?
                `\n#block(below: 0.6em)[#text(size: 7.6pt, style: "italic", fill: luma(45%))${caption}]${anchor}\n\n`
            :   "";

    // A named `size=` is the author's own statement and wins outright. Left
    // unstated — `auto`, written or implied — the picture's role or its icon
    // type decides instead, and only a picture declaring neither falls back to
    // the natural-pixel `auto` Typst resolves for itself.
    const requestedSize = token.meta?.size;
    const roleWidthIn =
        requestedSize && requestedSize !== "auto" ?
            undefined
        :   bookImageWidthIn(ctx.assets?.get(src));
    const size =
        roleWidthIn !== undefined ?
            typstInches(roleWidthIn)
        :   (BOOK_IMAGE_WIDTHS[requestedSize] ?? BOOK_IMAGE_WIDTHS.auto);
    const figure = `#book-image("${escapeTypstString(staged)}", requested: ${size}, caption: ${caption})${anchor}`;

    const width = token.meta?.classes?.[0];
    const scope =
        token.meta?.size === "full-width" ? "parent" : (IMAGE_CLASSES[width]?.scope ?? "column");
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
    if (!glyph) return escapeTypst(`:icon ${name}:`);
    const scale = ICON_SIZES[token?.meta?.attrs?.size]?.scale;
    const size = scale ? `, size: ${scale}em` : "";
    return `#text(font: "${escapeTypstString(glyph.font)}"${size})[\\u{${glyph.codepoint.toString(16)}}]`;
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
        // Use the file's natural measure for auto. Every requested width is
        // bounded by the available measure and by the height of a page.
        "#let book-image(path, requested: auto, caption: none) = layout(size => {\n" +
            "  let natural = measure(image(path))\n" +
            '  let target = if requested == auto { natural.width } else if requested == "full-width" { size.width } else { requested }\n' +
            "  let width = calc.min(target, size.width, book-text-height * 0.8 * (natural.width / natural.height))\n" +
            "  block(width: width, below: 0.6em)[\n" +
            '    #image(path, width: 100%, fit: "contain")\n' +
            '    #if caption != none { text(size: 7.6pt, style: "italic", fill: luma(45%))[#caption] }\n' +
            "  ]\n" +
            "})",
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
        "#let book-place-map(title, path) = {\n" +
            "  page(columns: 1, flipped: true)[\n" +
            "    #set par(justify: false, first-line-indent: 0em)\n" +
            '    #text(size: 18pt, weight: "bold", fill: book-head)[#title]\n' +
            "    #v(0.4cm)\n" +
            '    #image(path, width: 100%, height: book-text-width - 2cm, fit: "contain")\n' +
            "  ]\n" +
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
 * **Pure, and that is the point.** The book's structural properties
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
 * @param {Map<string, {path: string, title: string}>} [opts.maps] - An entry
 *   anchor to its SVG path and page heading. Each map takes a page after its entry.
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
    maps = new Map(),
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
    out.push("#show footnote.entry: set text(size: 7.8pt)");
    out.push("#set par(justify: true, leading: 0.55em, first-line-indent: 1.2em)");
    // The first-line indent is what separates one paragraph of running prose
    // from the next, and inside a list item the marker already does that. An
    // item carrying more than one paragraph sets every one of them flush at the
    // item's own text column, so the item reads as a single block hanging off
    // its marker. Neither the marker column nor the gap after it is set here:
    // Typst measures the widest marker in the list and aligns every body
    // against it, which is what keeps a list of twelve aligned once `10.`
    // becomes wider than `1.`.
    out.push("#show list: set par(first-line-indent: 0em)");
    out.push("#show enum: set par(first-line-indent: 0em)");
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
        for (const map of maps.get(entry.anchor) ?? []) {
            out.push(
                `#book-place-map([${escapeTypst(map.title)}], "${escapeTypstString(map.path)}")`,
            );
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
