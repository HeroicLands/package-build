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
 * Page lists: a tag in, the pages carrying it out.
 *
 * ````markdown
 * ```pagelist {tag="key-concept" descriptions=true}
 * ```
 * ````
 *
 * **A group expressed by intent.** A hand-enumerated list of links drifts — a
 * page is written and nobody adds it to the landing that should name it. A page
 * list names the *tag* instead: tag a page and it files itself, untag it and it
 * leaves.
 *
 * **It is a sibling of the `sql` content table, and answered the same way.**
 * The pages are resolved over the content index ahead of the synchronous
 * expansion pass, then
 * {@link module:engine/content-tables.expandContentTables} splices the result
 * in as ordinary Markdown — a bullet list of wikilinks. So each surface's own
 * wikilink resolver turns them into what that surface links with: a compendium
 * UUID in Foundry, a page URL on the web and in the book. One authored
 * construct, three real lists.
 *
 * **Attributes, never a body.** Everything the directive says about itself is
 * said in the braced attribute grammar every other body extension uses, so
 * there is one grammar to learn and one validator to maintain. The fence holds
 * nothing, and text written inside it is reported rather than ignored.
 *
 * @module
 */

import { FENCE_LINE, parseHeaderArgs } from "./code-fences.mjs";
import { booleanAttribute } from "./extension-attributes.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { NOTE_VOCABULARY, hasTag } from "./note-vocabulary.mjs";

/** The fence language that opens a page list. */
export const PAGE_LIST_LANGUAGE = "pagelist";

/**
 * The orders a page list may come out in.
 *
 * Ordering is about output rather than about the pages, so it is an attribute
 * rather than something read off a note. `name` is alphabetical, case and
 * accents folded; `type` groups the note types and orders by name inside each.
 *
 * @type {readonly string[]}
 */
export const PAGE_LIST_SORTS = Object.freeze(["name", "type"]);

/**
 * The attributes a page-list fence takes, with what each one is for.
 *
 * **This is the one list.** The fence is validated against it, the authoring
 * document's table is generated from it, and the reference is checked against
 * it — so an attribute added here is one both documents describe, and anything
 * else an author writes is reported by name.
 *
 * @type {Readonly<Record<string, Readonly<{value: string, default: string, summary: string}>>>}
 */
export const PAGE_LIST_ATTRIBUTES = Object.freeze({
    tag: Object.freeze({
        value: "a tag",
        default: "required",
        summary:
            "The tag a page carries to join the list. Matched the way `tags:` is read — " +
            "case and a leading `#` are not significant, the spelling of the tag itself is.",
    }),
    type: Object.freeze({
        value: "a note type",
        default: "every type",
        summary:
            "Restricts the list to one note type. A page's address is `<type>-<shortcode>`, " +
            "so the type is what divides the corpus into kinds of page.",
    }),
    sort: Object.freeze({
        value: "`name` or `type`",
        default: "`name`",
        summary:
            "The order the pages come out in. `name` is alphabetical; `type` groups the " +
            "note types and orders by name within each.",
    }),
    descriptions: Object.freeze({
        value: "`true` or `false`",
        default: "`false`",
        summary:
            "Whether each page's `description` follows its link. A page that states none " +
            "carries its link alone.",
    }),
    "allow-empty": Object.freeze({
        value: "`true` or `false`",
        default: "`false`",
        summary:
            "Whether a tag carried by no page is allowed. It is a finding otherwise, " +
            "because a heading with nothing under it is how a misspelled tag goes unnoticed.",
    }),
});

/** The note types a `type` attribute may name, from the vocabulary itself. */
const noteTypes = () => Object.keys(NOTE_VOCABULARY);

/**
 * Every `pagelist` fence in a markdown body, with the position each occupies.
 *
 * Positions are 0-based lines into the body as given, which is what a
 * diagnostic about a directive needs and what the expander uses to splice
 * results back in.
 *
 * **A malformed directive is still a directive.** It is returned carrying its
 * problems rather than skipped, so the expander finds a prepared answer at its
 * ordinal and reports the fault where the fence sits. That includes a fence
 * nobody closed, which the author meant as a directive and which would
 * otherwise swallow the rest of the note into a code block.
 *
 * @param {string} markdown - The note body, frontmatter already stripped.
 * @returns {Array<{line: number, close: number, indent: string, tag: string,
 *   type: string, sort: string, descriptions: boolean, allowEmpty: boolean,
 *   problems: string[], block: string}>} One entry per fence, in document order.
 */
export function findPageListBlocks(markdown) {
    const lines = String(markdown ?? "").split("\n");
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
        const opening = FENCE_LINE.exec(lines[i]);
        if (!opening) continue;
        const [, indent, marker, info] = opening;
        const closer = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`);
        let close = i + 1;
        while (close < lines.length && !closer.test(lines[close])) close += 1;
        const { language, args, problems } = parseHeaderArgs(info);
        if (language !== PAGE_LIST_LANGUAGE) {
            // Not ours, but still a fence: skip its body so a directive shown
            // as an example inside a longer fence is never read as one.
            i = close;
            continue;
        }
        const errors = [...problems];
        for (const key of Object.keys(args)) {
            if (!Object.hasOwn(PAGE_LIST_ATTRIBUTES, key))
                errors.push(`${key} is not a page-list attribute`);
        }
        const tag = String(args.tag ?? "").trim();
        if (!tag) errors.push("a pagelist fence needs a tag attribute");
        const type = String(args.type ?? "").trim();
        if (type && !noteTypes().includes(type))
            errors.push(`type ${JSON.stringify(type)} is not a note type`);
        const sort = String(args.sort ?? PAGE_LIST_SORTS[0]).trim();
        if (!PAGE_LIST_SORTS.includes(sort))
            errors.push(`sort needs ${PAGE_LIST_SORTS.join(" or ")}`);
        const flags = { descriptions: false, allowEmpty: false };
        for (const [key, field] of [
            ["descriptions", "descriptions"],
            ["allow-empty", "allowEmpty"],
        ]) {
            if (!Object.hasOwn(args, key)) continue;
            try {
                flags[field] = booleanAttribute(args[key], key);
            } catch (error) {
                errors.push(error.message);
            }
        }
        if (close >= lines.length) errors.push("a pagelist fence needs a closing fence");
        else if (
            lines
                .slice(i + 1, close)
                .join("\n")
                .trim()
        )
            errors.push("a pagelist fence takes no body; its tag is the tag attribute");
        blocks.push({
            line: i,
            close,
            indent,
            tag,
            type,
            sort,
            ...flags,
            problems: errors,
            block: lines.slice(i, Math.min(close + 1, lines.length)).join("\n"),
        });
        i = close;
    }
    return blocks;
}

/** A page's sort key, folded so a circumflex sorts with its letter. */
const nameKey = (record) => String(record?.nameAscii ?? record?.name?.full ?? "").toLowerCase();

/** The address a page is addressed by, as a stable tiebreak. */
const slugKey = (record) => String(record?.address?.slug ?? "");

/**
 * By name, tiebroken on address.
 *
 * The tiebreak keeps the list stable where two pages share a name, which a
 * corpus of a few thousand eventually does.
 */
function byName(a, b) {
    const an = nameKey(a);
    const bn = nameKey(b);
    if (an !== bn) return an < bn ? -1 : 1;
    const as = slugKey(a);
    const bs = slugKey(b);
    return (
        as < bs ? -1
        : as > bs ? 1
        : 0
    );
}

/** By note type, then by name within it. */
function byType(a, b) {
    const at = String(a?.type ?? "");
    const bt = String(b?.type ?? "");
    if (at !== bt) return at < bt ? -1 : 1;
    return byName(a, b);
}

const COMPARATORS = Object.freeze({ name: byName, type: byType });

/** A link label, with the characters a wikilink reads replaced. */
function linkLabel(record) {
    const written = String(record?.name?.full ?? record?.shortcode ?? "")
        // A wikilink's own separator, so a name carrying one would truncate
        // the label at it.
        .replace(/\|/g, "/")
        .replace(/[\r\n]+/g, " ")
        .trim();
    return written || slugKey(record);
}

/** A description on one line, so a list item stays a list item. */
const oneLine = (value) => (typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "");

/**
 * The pages a directive selects, as index records.
 *
 * A **stub** is left out: an empty body publishes no page, which the index says
 * by holding no address, so there is nothing for the list to link to. A
 * documentation journal and an asset are not pages an author tagged, which
 * {@link module:engine/index-records.isNoteRecord} already answers.
 *
 * @param {object[]} records - Content-index records.
 * @param {{tag: string, type: string}} directive - From {@link findPageListBlocks}.
 * @returns {object[]} The selected records, unordered.
 */
export function pagesForList(records, { tag, type }) {
    return (records ?? []).filter((record) => {
        if (!isNoteRecord(record) || !record.address) return false;
        if (type && record.type !== type) return false;
        return hasTag(record, tag);
    });
}

/**
 * Render one directive's answer as markdown.
 *
 * **The emitted link is the page's `address.slug`** — the `type-shortcode`
 * form a wikilink resolves — which is exactly what a table's `_ref` cell
 * writes. A short form names the package the link is written in, so it is
 * unambiguous for a list of this package's own pages, and it resolves to the
 * note's **page** on each surface: a compendium journal in Foundry, a URL on
 * the web and in the book. An item note's page is its documentation journal,
 * and the short form reaches it the way prose does.
 *
 * @param {object[]} records - Content-index records.
 * @param {object} directive - From {@link findPageListBlocks}.
 * @returns {{markdown: string, pages: number}} The list, and how many pages
 *   are in it.
 */
export function renderPageList(records, directive) {
    const selected = pagesForList(records, directive).sort(
        COMPARATORS[directive.sort] ?? COMPARATORS.name,
    );
    const rows = selected.map((record) => {
        const link = `- [[${slugKey(record)}|${linkLabel(record)}]]`;
        if (!directive.descriptions) return link;
        const summary = oneLine(record.description);
        return summary ? `${link} — ${summary}` : link;
    });
    return { markdown: rows.join("\n"), pages: selected.length };
}

/**
 * What the expander prints where a tag selects nothing.
 *
 * The tag is quoted, because a misspelled tag is the whole of what goes wrong
 * here and a reader needs to see the exact spelling the directive asked for.
 */
function emptyMessage({ tag, type }) {
    const scope = type ? ` of type ${JSON.stringify(type)}` : "";
    return (
        `page list selects no page; no page${scope} carries the tag ${JSON.stringify(tag)}. ` +
        "Check the spelling, tag some pages, or state {allow-empty=true}"
    );
}

/**
 * Answer every `pagelist` directive in a set of note bodies, ahead of expansion.
 *
 * **Why a separate pass.** The same reason the SQL tables have one:
 * {@link module:engine/content-tables.expandContentTables} is synchronous and
 * exported, and the corpus is enumerated once by whoever already holds it
 * rather than derived again inside a renderer. A page list needs no database —
 * it is a filter over the records — so preparing one costs a walk of what the
 * caller already has.
 *
 * **Keyed by note, then by the directive's ordinal within it**, not by its
 * line: the passes do not agree on what a body is, and trim it differently,
 * but a directive's position in the sequence of fences is the same in each.
 *
 * A malformed directive is recorded rather than thrown, so one bad fence costs
 * its own list and not the whole build's report.
 *
 * @param {object[]} records - Content-index records, already narrowed to the
 *   audience the surface publishes to.
 * @param {Array<{source: string, markdown: string}>} sources - The bodies to scan.
 * @returns {Map<string, Array<{markdown?: string, pages?: number, empty?: string,
 *   reason?: string, allowEmpty: boolean}>>} Note to results, in document order.
 */
export function preparePageLists(records, sources) {
    const prepared = new Map();
    for (const { source, markdown } of sources ?? []) {
        const blocks = findPageListBlocks(markdown);
        if (!blocks.length) continue;
        const forNote = [];
        prepared.set(source, forNote);
        for (const block of blocks) {
            if (block.problems.length) {
                forNote.push({
                    reason: block.problems.join("; "),
                    allowEmpty: block.allowEmpty,
                });
                continue;
            }
            const { markdown: rendered, pages } = renderPageList(records, block);
            forNote.push({
                markdown: rendered,
                pages,
                empty: emptyMessage(block),
                allowEmpty: block.allowEmpty,
            });
        }
    }
    return prepared;
}
