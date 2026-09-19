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
 * `![[address|label]]` — the wikilink that renders a picture where it stands.
 *
 * There is no image grammar here. An embed is the wikilink
 * {@link module:engine/wikilink-syntax} already defines, with `!` meaning
 * _render it here_ rather than _link to it_, and the syntax supplying the
 * default type the way a field declaration does — `image`. The short-form
 * ladder, the package and system defaults, the lowercase rule and the findings
 * vocabulary all apply unchanged.
 *
 * ## An embed resolves to an ordinary image, and that is the whole design
 *
 * `![[thorn|Thorn]]{float: top-left}` becomes
 * `![Thorn](thalorna/assets/images/beings/thorn.webp){float: top-left}` in the
 * source text, before any surface renders it. Everything downstream is machinery
 * that already exists: {@link module:engine/content-images.imagePlugin} draws the
 * figure for a Foundry journal and for the book's Typst walk,
 * {@link module:engine/content-images.renderImageFigures} draws it for the
 * website, and {@link module:engine/content-images.imageSourcesIn} is what tells
 * the book which files to stage. One authored statement, three renderers, no
 * fourth image path.
 *
 * **That is why the rewrite is a source-text pass rather than a markdown-it
 * inline rule.** Two of the four readers have no render pass to put a token in:
 * the website is handed *markdown* for Hugo to render, and the link checker
 * parses nothing at all. A third, the book, reads its staging list out of the
 * source text before it tokenises. A token would therefore serve one reader and
 * leave the other three needing the grammar a second time, which is the drift
 * the wikilink pattern was consolidated here to end.
 *
 * ## The label is the alt text, and it stays with the referrer
 *
 * One image serves many documents, and only the referrer knows what it means
 * where it sits. `![[anvil|]]` is deliberately decorative, `![[anvil|An anvil]]`
 * carries meaning, and `![[anvil]]` is unlabelled and a finding like any other
 * link — the parser distinguishes a missing label from an empty one, so the two
 * differ without an exemption.
 *
 * ## An embed reaches asset types only
 *
 * The syntax invites the broader reading — transclusion of an arbitrary note —
 * so the restriction is a guard rather than a convention, and a `being` named
 * where a picture belongs is refused with its own reason rather than reported as
 * an address that resolves to nothing.
 *
 * @module
 */

import { matchAllOutsideCode } from "./code-fences.mjs";
import { parseImageDirective, standsAlone } from "./content-images.mjs";
import { positionInBody } from "./diagnostics.mjs";
import { authoredLabel, linkFindingMessage, parseWikilink } from "./wikilink-syntax.mjs";
import { readAssetAddress } from "./art-fields.mjs";

/**
 * The type a bare shortcode takes, supplied by the syntax itself.
 *
 * A picture is what `!` asks for, so `image` is what an unqualified embed names.
 * An icon is reached by stating it — `![[icon-anvil|An anvil]]` — because the two
 * have separate shortcode namespaces and neither is derivable from the other.
 *
 * @type {string}
 */
export const EMBED_DEFAULT_TYPE = "image";

/**
 * An embed, as authored, with the directive it may carry.
 *
 * The interior admits no `]` or newline, exactly as a wikilink's does: an embed
 * is written on one line, and an unclosed `![[` is a typo rather than licence to
 * consume the rest of the document looking for a closer.
 *
 * The directive is `{…}` immediately after the closing `]]`, holding no newline,
 * for the reason {@link module:engine/content-images.IMAGE_PATTERN} gives: a
 * brace that opens and never closes on its line is prose.
 *
 * @type {RegExp}
 */
export const EMBED_PATTERN = /!\[\[([^\]\n]+)\]\](\{[^}\n]*\})?/g;

/**
 * One embed, parsed.
 *
 * @typedef {object} ParsedEmbed
 * @property {string} all - The embed exactly as authored, directive included.
 * @property {string} inner - The whole interior of the brackets.
 * @property {string} written - The link part as authored, anchor included. An
 *   embed names a file and a file has no sections, so an anchor is carried into
 *   the address rather than stripped off it — where it fails the address charset
 *   and is reported as what it is.
 * @property {string|null} display - The text after `|`, `null` when unlabelled.
 * @property {boolean} labelled - Whether a `|` was present at all.
 * @property {string} directive - The `{…}` as written, or `""`.
 * @property {number} index - Where the embed begins in the body.
 * @property {number} length - How much of the body it occupies.
 * @property {boolean} block - Whether it stands alone in its own paragraph.
 */

/**
 * Every embed in one body, in source order.
 *
 * Code is skipped, because an embed shown as an example is prose *about* an
 * embed — which is what makes this module's own documentation writable.
 *
 * @param {string} body - The note's markdown, without its frontmatter.
 * @returns {ParsedEmbed[]} One entry per embed.
 */
export function embedsIn(body) {
    const text = String(body ?? "");
    return matchAllOutsideCode(text, new RegExp(EMBED_PATTERN.source, "g")).map((match) => {
        const index = /** @type {number} */ (match.index);
        const parsed = parseWikilink(match[1] ?? "");
        const length = match[0].length;
        return {
            all: match[0],
            inner: parsed.inner,
            written: parsed.anchor ? `${parsed.target}#${parsed.anchor}` : parsed.target,
            display: parsed.display,
            labelled: parsed.labelled,
            directive: match[2] ?? "",
            index,
            length,
            block: standsAlone(text, index, index + length),
        };
    });
}

/**
 * What one embed resolves to, or why it does not.
 *
 * The reasons are {@link module:engine/wikilink-syntax.LINK_FINDING_REASONS},
 * the vocabulary every resolver shares, so an author meets one wording for one
 * mistake whichever build they ran first.
 *
 * @param {object} index - From {@link module:engine/wikilinks.buildWikilinkIndex},
 *   or the equivalent the site and the book build.
 * @param {ParsedEmbed} embed - The embed.
 * @returns {{pathname: string}|{reason: string, target: string, type?: string}}
 *   The authored pathname the picture is at, or the finding.
 */
export function resolveEmbed(index, embed) {
    // **Every link carries a label**, and an embed is a link. Without one there
    // is nothing to show and nothing to describe the picture with, so it is
    // reported before anything is looked up.
    if (!embed.labelled) return { reason: "unlabelled", target: embed.inner };

    const read = readAssetAddress(index, embed.written, EMBED_DEFAULT_TYPE);
    if (read.record) {
        return { pathname: read.pathname };
    }
    return { reason: read.reason, target: embed.written, type: read.type };
}

/**
 * What is wrong with one embed's directive or placement, if anything.
 *
 * Separate from the link findings beside it because the two speak different
 * vocabularies: a link finding is a `reason` from the closed set every resolver
 * shares, and this is an image's own complaint about a brace or a paragraph.
 * Collapsing them would put a sentence where a `reason` belongs.
 *
 * @param {ParsedEmbed} embed - The embed.
 * @returns {Array<{link: string, offset: number, message: string}>} One entry
 *   per defect. `link` is the embed exactly as authored, which is what lets a
 *   caller with no offsets locate it by searching the note for the literal.
 */
export function embedProblems(embed) {
    /** @type {Array<{link: string, offset: number, message: string}>} */
    const problems = [];
    if (!embed.block) {
        problems.push({
            link: embed.all,
            offset: embed.index,
            message:
                `\`![[${embed.inner}]]\` shares its paragraph with other text — an ` +
                "embedded image is a block, standing alone with a blank line either " +
                "side of it, because a width and a position mean nothing applied to a " +
                "word in a sentence",
        });
    }
    if (!embed.directive) return problems;
    // Located on the brace rather than on the embed: the brace is what the
    // author edits, and two problems in one directive should not report at the
    // same column twice.
    const offset = embed.index + embed.length - embed.directive.length;
    for (const message of parseImageDirective(embed.directive).problems) {
        problems.push({ link: embed.all, offset, message });
    }
    return problems;
}

/**
 * Rewrite every embed in one body into the image each surface already renders.
 *
 * An embed that does not resolve is left **exactly as authored** and reported,
 * so a missing picture degrades to visible literal text rather than to a broken
 * `src` or a swallowed paragraph. So is one whose directive does not parse: a
 * directive holding a problem is not honoured at all, and the braces reaching
 * the page as their own literal text is how the mistake is visible without a
 * log.
 *
 * Call this **before** wikilink resolution. The rewrite consumes the `!` along
 * with the brackets, which is what stops the link pass reading an embed's
 * interior as an ordinary link to a note that does not exist.
 *
 * @param {string} body - The note's markdown, tables already expanded.
 * @param {object} ctx
 * @param {object} ctx.index - The address index assets resolve through.
 * @returns {{markdown: string, unresolved: Array<{link: string, target: string,
 *   offset: number, reason: string, type?: string}>,
 *   problems: Array<{link: string, offset: number, message: string}>,
 *   images: Array<{link: string, offset: number, pathname: string}>}} The body,
 *   the embeds that named nothing, the directives that could not be honoured,
 *   and the pathname each embed that did resolve now names. Every `offset` is
 *   0-based in `body`, which is what lets a caller report a line and a column
 *   and tell two identical embeds apart.
 *
 *   **`images` is how a surface holds an embed to its own rule.** The rewrite
 *   is surface-agnostic — a file the website serves and the book stages is not
 *   always one a Foundry install carries — so a caller that cares asks about
 *   the pathname while it still knows which embed produced it, rather than
 *   searching a rewritten body for a literal the note never wrote.
 */
export function resolveEmbeds(body, { index }) {
    const text = String(body ?? "");
    /** @type {Array<{link: string, target: string, offset: number, reason: string, type?: string}>} */
    const unresolved = [];
    /** @type {Array<{link: string, offset: number, message: string}>} */
    const problems = [];
    /** @type {Array<{link: string, offset: number, pathname: string}>} */
    const images = [];
    let out = "";
    let last = 0;

    for (const embed of embedsIn(text)) {
        problems.push(...embedProblems(embed));
        const resolved = resolveEmbed(index, embed);
        if (!("pathname" in resolved)) {
            unresolved.push({
                link: embed.all,
                target: resolved.target,
                offset: embed.index,
                reason: resolved.reason,
                ...(resolved.type ? { type: resolved.type } : {}),
            });
            continue;
        }
        if (parseImageDirective(embed.directive).problems.length) continue;

        out += text.slice(last, embed.index);
        // The label is the alt text, and an empty one is deliberately
        // decorative — {@link authoredLabel} is where that reading lives, so an
        // embed and a link cannot draw the line in two places.
        out += `![${authoredLabel(embed) ?? ""}](${resolved.pathname})${embed.directive}`;
        images.push({ link: embed.all, offset: embed.index, pathname: resolved.pathname });
        last = embed.index + embed.length;
    }
    return { markdown: out + text.slice(last), unresolved, problems, images };
}

/**
 * Every defect in one note's embeds, located.
 *
 * {@link resolveEmbeds} with its two lists turned into the one shape a finding
 * takes, for a caller that wants the report and not the rewrite.
 *
 * **Errors, not warnings**, for the reason an image's are: `reportFindings`
 * fails on an error and not on a warning, so a refusal reported as advisory
 * publishes anyway, looking exactly like a directive that worked.
 *
 * @param {string} body - The note's markdown, without its frontmatter.
 * @param {string} file - The note's path, for the finding.
 * @param {object} [opts]
 * @param {number} [opts.bodyLine=1] - The 1-based file line the body starts on.
 * @param {number} [opts.bodyColumn=1] - The 1-based file column it starts at.
 * @param {object} [opts.index] - The address index assets resolve through.
 * @returns {Array<{file: string, line: number, column: number|undefined,
 *   severity: "error", message: string}>} One finding per defect, in source
 *   order.
 */
export function checkEmbeds(body, file, { bodyLine = 1, bodyColumn = 1, index } = {}) {
    const text = String(body ?? "");
    if (!text) return [];

    const { unresolved, problems } = resolveEmbeds(text, { index });
    return [
        ...unresolved.map((u) => ({ offset: u.offset, message: linkFindingMessage(u) })),
        ...problems,
    ]
        .sort((a, b) => a.offset - b.offset)
        .map(({ offset, message }) => {
            const { line, column } = positionInBody(text, offset, { bodyLine, bodyColumn });
            return {
                file,
                line,
                column,
                severity: /** @type {"error"} */ ("error"),
                message,
            };
        });
}
