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
 * Automatic dictionaries and glossaries, derived synchronously from the same
 * rows their SQL layouts read. An existing anchored section receives its list
 * after its authored text; otherwise the note receives a new final section.
 * The insertion and the publisher read the same Markdown, on every surface.
 *
 * @module
 */

import { renderAddress } from "./address.mjs";
import { encodeAddresses } from "./address-values.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { renderDictionary, renderGlossary } from "./dictionary-layout.mjs";
import { DICTIONARY_COLUMNS, TERM_COLUMNS, dictionaryAndTermRows } from "./dictionary-rows.mjs";
import { glossaryLanguage } from "./glossary-language.mjs";
import { scanHeadingAttributes } from "./heading-attributes.mjs";
import { isNoteRecord } from "./index-records.mjs";

/** The automatic lexical sections and the authored anchors each may reuse. */
export const LEXICAL_SECTIONS = Object.freeze(
    [
        {
            slug: "dictionary",
            heading: "Dictionary",
            aliases: ["dictionary", "lexicon"],
            dataKey: "words",
            types: [{ type: "skill", subType: "language" }],
        },
        {
            slug: "glossary",
            heading: "Glossary",
            aliases: ["glossary"],
            dataKey: "glossary",
            types: [{ type: "lore", subType: "culture" }, { type: "affiliation" }],
        },
    ].map((section) =>
        Object.freeze({
            ...section,
            aliases: Object.freeze(section.aliases),
            types: Object.freeze(section.types.map((kind) => Object.freeze(kind))),
        }),
    ),
);

/** The lexical section this note's own nonempty frontmatter requests. */
function sectionFor(record) {
    return LEXICAL_SECTIONS.find(
        (section) =>
            section.types.some(
                (kind) =>
                    record?.type === kind.type &&
                    (!kind.subType || record.subType === kind.subType),
            ) &&
            Array.isArray(record.data?.[section.dataKey]) &&
            record.data[section.dataKey].length > 0,
    );
}

/**
 * Whether frontmatter supplies an automatic lexical section, including on a
 * note with no authored prose. Such a note has content and is not a stub.
 *
 * @param {object|null|undefined} frontmatter - A note or its index record.
 * @returns {boolean} Whether its own nonempty words or glossary qualify.
 */
export function hasLexicalEntries(frontmatter) {
    return Boolean(sectionFor(frontmatter));
}

/** A note's canonical identity, including a data-only note that was a stub. */
const keyOf = (record) =>
    record?.package && record.type && record.shortcode ?
        renderAddress({
            package: record.package,
            system: "note",
            type: record.type,
            shortcode: record.shortcode,
        })
    :   undefined;

/**
 * One automatic section, whose rows are rendered at its containing heading's
 * level when inserted.
 *
 * @typedef {object} LexicalSection
 * @property {string} slug - The canonical section anchor and layout name.
 * @property {string} heading - The heading used when none is authored.
 * @property {readonly string[]} aliases - Authored heading anchors to reuse.
 * @property {{columns: string[], rows: object[]}} result - The selected rows.
 * @property {import("./dictionary-layout.mjs").LayoutOptions} options - Labels,
 *   linkability and the page's language, shared by every surface.
 */

/**
 * Automatic lexical sections by owning note's canonical Address. Only
 * nonempty own `words` or `glossary` arrays qualify. A glossary selects only
 * explicitly declared owner entries, including a rank only when named there.
 *
 * @param {object[]} records - The audience's visible index records.
 * @param {object[]} [all=records] - Complete records for lineage traversal.
 * @returns {Map<string, LexicalSection[]>} Sections by owning Address.
 */
export function lexicalSectionsFor(records, all = records) {
    const visible = encodeAddresses(records).filter(isNoteRecord);
    const complete = encodeAddresses(all).filter(isNoteRecord);
    const byKey = new Map(visible.map((record) => [keyOf(record), record]));
    const addressContext = {
        types: new Set(complete.map((record) => record.type)),
        packages: new Set(complete.map((record) => record.package)),
        system: "note",
    };
    const { dictionary, terms } = dictionaryAndTermRows(visible, complete);
    const sections = new Map();
    for (const [key, record] of byKey) {
        if (!key) continue;
        const spec = sectionFor(record);
        if (!spec) continue;
        const language = spec.slug === "dictionary";
        const rows =
            language ?
                dictionary.filter((row) => row.language === key)
            :   terms.filter((row) => row.owner === key && row.origins.includes("glossary"));
        const pageLanguage = glossaryLanguage(undefined, record, {
            self: key,
            keyOf: (value) => (typeof value === "string" ? value : undefined),
            lookup: (address) => byKey.get(address),
        });
        sections.set(key, [
            {
                slug: spec.slug,
                heading: spec.heading,
                aliases: spec.aliases,
                result: { columns: [...(language ? DICTIONARY_COLUMNS : TERM_COLUMNS)], rows },
                options: {
                    addressContext: { ...addressContext, package: record.package },
                    pageLanguage,
                    pageOwner: key,
                    ...(language ? { verbs: record.data?.grammar?.verbs } : {}),
                    labelOf: (address) => byKey.get(address)?.name?.full,
                    linkable: (ref) => {
                        const target = byKey.get(renderAddress({ ...ref, system: "note" }));
                        return Boolean(target && (target.address || hasLexicalEntries(target)));
                    },
                },
            },
        ]);
    }
    return sections;
}

/** Authored section headings outside literal content and named containers. */
function headings(markdown, syntax) {
    const containers = (syntax ? syntax(markdown).blocks : scanBlocks(markdown)).blocks;
    return scanHeadingAttributes(markdown)
        .headings.filter(
            (heading) =>
                !containers.some(
                    (block) => heading.line - 1 >= block.start && heading.line - 1 <= block.end,
                ),
        )
        .map((heading) => ({ line: heading.line - 1, level: heading.level, slug: heading.id }));
}

/**
 * Insert lists at the end of their authored anchored sections, or append a
 * new H1 section when no heading names one. Source lines after an insertion
 * retain their original positions; inserted lines point to their heading.
 *
 * @param {string} markdown - The body with authored directives expanded.
 * @param {LexicalSection[]} [sections=[]] - From {@link lexicalSectionsFor}.
 * @param {{authored?: string, lineMap?: object[], generatedFrom?: number, syntax?: import("./content-session.mjs").ContentSyntax}} [context] -
 *   The original authored body, source mappings and the start of appended
 *   nonlexical generated sections. Without `authored`, `markdown` is the source.
 * @returns {{markdown: string, lineMap: object[], generatedFrom?: number}}
 */
export function insertLexicalSections(
    markdown,
    sections = [],
    { authored = markdown, lineMap, generatedFrom, syntax } = {},
) {
    const lines = String(markdown ?? "").split("\n");
    const locations = lineMap ? [...lineMap] : lines.map((_, line) => ({ line, generated: false }));
    if (!sections.length)
        return {
            markdown: lines.join("\n"),
            lineMap: locations,
            ...(generatedFrom === undefined ? {} : { generatedFrom }),
        };
    const edits = [];
    const realHeadings = headings(String(authored ?? ""), syntax)
        .map((heading) => ({
            ...heading,
            sourceLine: heading.line,
            line: locations.findIndex(
                (location, at) =>
                    location.line === heading.line &&
                    !location.generated &&
                    (generatedFrom === undefined || at < generatedFrom),
            ),
        }))
        .filter((heading) => heading.line >= 0);
    for (const section of sections) {
        const own = realHeadings.find((heading) => section.aliases.includes(heading.slug));
        const next =
            own &&
            realHeadings.find((heading) => heading.line > own.line && heading.level <= own.level);
        const at = next?.line ?? (own ? (generatedFrom ?? lines.length) : lines.length);
        const level = own?.level ?? 1;
        const render = section.slug === "dictionary" ? renderDictionary : renderGlossary;
        const list = render(section.result, {
            ...section.options,
            sectionLevel: Math.min(6, level + 1),
        });
        if (!list && own) continue;
        const text = `${own ? "" : `# ${section.heading} {#${section.slug}}\n\n`}${list}`;
        edits.push({
            at,
            source: own?.sourceLine ?? Math.max(0, String(authored ?? "").split("\n").length - 1),
            lines: ["", ...text.split("\n"), ""],
        });
    }
    for (const edit of edits.sort((a, b) => b.at - a.at)) {
        const location = { line: edit.source, generated: true };
        lines.splice(edit.at, 0, ...edit.lines);
        locations.splice(edit.at, 0, ...edit.lines.map(() => ({ ...location })));
        if (generatedFrom !== undefined && edit.at <= generatedFrom)
            generatedFrom += edit.lines.length;
    }
    return {
        markdown: lines.join("\n"),
        lineMap: locations,
        ...(generatedFrom === undefined ? {} : { generatedFrom }),
    };
}
