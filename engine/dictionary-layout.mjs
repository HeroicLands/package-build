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
 * An `sql` fence's result set as a dictionary of words, `layout=dictionary`,
 * or as a glossary of terms, `layout=glossary`.
 *
 * A dictionary reads the `dictionary` relation's columns and a glossary the
 * `terms` relation's, or any query returning them. Each needs `name`, `senses`
 * and `usage`, and a result missing one is refused naming it; every other
 * column is read where the query selects it. The output is Markdown, so every
 * surface sets it as it sets a note:
 *
 * - **the key**, once, at the head unless the fence sets `key=false`: the abbreviations this rendering uses,
 *   each with its expansion, then a glossary's common mark where an entry carries it.
 *   A fence setting `key=only` prints the key alone;
 * - **a heading per letter**, from `letter`, at the fence's `section-level`;
 * - **one paragraph per entry**: the common mark, the bold headword, the
 *   pronunciation between slashes, the language tag and word class in
 *   italics, a dictionary word's field tag and etymology in brackets, the senses, and the
 *   citations as links.
 *
 * A glossary sets the rows that share a headword and a language as one entry:
 * their senses numbered in the order the rows arrive, each tagged with the
 * bodies it comes from, except a sole owner's label on its own page. A sense
 * several rows give is printed once with all its bodies. A dictionary word's
 * senses carry no bodies; a glossary's contextual
 * and governance senses name their owners. A glossary headword naming a
 * dictionary word links to that word's anchored entry on its language page.
 *
 * The entries are ordered here rather than by the query: by letter, then by
 * `name_sort` with its accents taken off and its case folded, then as written.
 * A language tag prints where the entry's language is not the language of the
 * page the fence is on, and an etymology never repeats the entry's own.
 *
 * @module
 */

import { parseAddress, readCanonicalKey, renderAddress, splitAnchor } from "./address.mjs";
import { dictionaryEntryAnchor, dictionaryLetter } from "./dictionary-rows.mjs";
import { verbPattern } from "./verb-pattern.mjs";
import {
    WORD_CLASS_BASES,
    WORD_CLASS_MODIFIERS,
    abbreviateWordClass,
    parseWordClass,
} from "./word-classes.mjs";

/** The columns a dictionary or a glossary cannot be set without. */
export const LAYOUT_REQUIRED_COLUMNS = Object.freeze({
    dictionary: Object.freeze(["name", "senses", "usage"]),
    glossary: Object.freeze(["name", "senses", "usage"]),
});

/** The mark a common entry opens with. */
export const COMMON_MARK = "•";

/** The word-entry span class whose Foundry rendering is a native TOC heading. */
export const DICTIONARY_ENTRY_CLASS = "dictionary-entry";

/**
 * The class on every link an entry writes to another note, so a site can set
 * the link as plain text where its target is not a page a reader can reach.
 */
export const LEXICAL_LINK_CLASS = "lexical-ref";

/** Wikilinks in a gloss, marked with {@link LEXICAL_LINK_CLASS}. */
const markLinks = (text) =>
    String(text ?? "").replace(
        /\[\[[^\]]*\]\](?!\{)/g,
        (link) => `${link}{.${LEXICAL_LINK_CLASS}}`,
    );

/**
 * Render a dictionary entry's marked headword as an inline native heading in
 * Foundry. Its paragraph becomes a div, so the heading has a valid container.
 * The shared Markdown keeps its span and its containing journal page.
 *
 * @param {import("markdown-it")} md - The Foundry Markdown parser.
 */
export function dictionaryEntryPlugin(md) {
    md.core.ruler.after("inline", "dictionary_entry_headings", (state) => {
        for (let i = 1; i < state.tokens.length - 1; i++) {
            const inline = state.tokens[i];
            const opening = inline.children?.[0];
            if (
                inline.type !== "inline" ||
                state.tokens[i - 1].type !== "paragraph_open" ||
                state.tokens[i + 1].type !== "paragraph_close" ||
                opening?.type !== "span_open" ||
                !opening.attrGet("id") ||
                !String(opening.attrGet("class") ?? "")
                    .split(/\s+/)
                    .includes(DICTIONARY_ENTRY_CLASS)
            )
                continue;
            let depth = 0;
            const closing = inline.children.find((token) => {
                if (token.type === "span_open") depth++;
                if (token.type === "span_close") return --depth === 0;
                return false;
            });
            if (!closing) continue;
            opening.tag = closing.tag = "h6";
            opening.attrSet(
                "style",
                "display: inline; margin: 0; padding: 0; border: 0; font: inherit; text-transform: none",
            );
            state.tokens[i - 1].tag = state.tokens[i + 1].tag = "div";
            state.tokens[i - 1].attrSet("style", "margin: 0 0 0.5em");
        }
    });
}

/** What the key says of the common mark. */
const COMMON_KEY = "a common word, which a player is expected to know by heart";

/** Code-point order. */
const compare = (a, b) =>
    a < b ? -1
    : a > b ? 1
    : 0;

/** A sort key with its accents off and its case folded. */
const fold = (text) =>
    String(text ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();

/** A sense as a sentence: a capital first, and a closing stop where none is. */
function sentence(text) {
    const value = String(text ?? "").trim();
    if (!value) return value;
    const opened = value[0].toLocaleUpperCase() + value.slice(1);
    return /[.!?…]$/u.test(opened) ? opened : `${opened}.`;
}

/**
 * @typedef {object} LayoutOptions
 * @property {(ref: object) => boolean} [linkable] - Whether an Address can be
 *   linked to; a citation that cannot prints as its label.
 * @property {number} [sectionLevel=2] - The level of a letter heading.
 * @property {object} [addressContext] - Address resolution context.
 * @property {(address: string) => string|undefined} [labelOf] - A note's
 *   `name.full`, by its Address.
 * @property {boolean|"only"} [showKey=true] - Whether the key and dictionary
 *   head tables are printed; `"only"` prints the key and nothing else.
 * @property {string} [pageLanguage] - The language of the page the fence is
 *   on, which no entry is tagged with.
 * @property {string} [pageOwner] - The containing page's canonical note Address;
 *   a sense attributed only to its own row's owner omits that label on this page.
 * @property {boolean} [entryAnchors=true] - Whether dictionary headwords carry
 *   their canonical targets; custom SQL views leave those to the automatic list.
 * @property {object} [verbs] - The owning language's stated pattern, including
 *   when its automatic dictionary has no eligible word entries.
 */

/**
 * Render a result of words as a dictionary.
 *
 * @param {{columns: string[], rows: object[]}} result - From
 *   {@link module:engine/sql-tables.runSqlQuery}.
 * @param {LayoutOptions} [opts]
 * @returns {string} The Markdown.
 * @throws {Error} When the result lacks a required column.
 */
export function renderDictionary(result, opts = {}) {
    requireColumns(result, "dictionary");
    return render(
        result.rows.map((row) => ({ ...row, rows: [row] })),
        opts,
        true,
        verbTables(result.rows, opts),
    );
}

/** A table cell cannot carry a literal pipe or a line break. */
const verbCell = (text) =>
    String(text)
        .replace(/\|/g, "\\|")
        .replace(/[\r\n]+/g, " ");

/** One head table per represented language, with no forms invented for a word. */
function verbTables(rows, opts) {
    const patterns = new Map();
    for (const row of rows)
        if (row.verbs && typeof row.verbs === "object")
            patterns.set(row.language ?? opts.pageLanguage ?? "", {
                verbs: row.verbs,
                label: row.language_tag,
            });
    if (opts.verbs && !patterns.has(opts.pageLanguage ?? ""))
        patterns.set(opts.pageLanguage ?? "", { verbs: opts.verbs });
    const tables = [];
    for (const [language, { verbs, label }] of [...patterns].sort(([a], [b]) => compare(a, b))) {
        const pattern = verbPattern(verbs);
        if (!pattern) continue;
        const replaced = pattern.replaces === undefined ? undefined : `-${pattern.replaces}`;
        const endings =
            pattern.invariant ?
                [["All persons", "unchanged"]]
            :   pattern.endings.map(({ label, ending }) => [
                    label,
                    ending ? `-${ending}`
                    : replaced ? `${replaced} dropped`
                    : "unchanged",
                ]);
        const heading =
            replaced && !pattern.invariant ?
                `Ending in place of a closing ${replaced}`
            :   "Ending added to citation form";
        const title =
            patterns.size > 1 ?
                `**Verbs (${String(opts.labelOf?.(language) ?? label ?? language).replace(/[\r\n]+/g, " ")})**`
            :   "**Verbs**";
        tables.push(
            [
                title,
                "",
                `| Person | ${verbCell(heading)} |`,
                "| --- | --- |",
                ...endings.map((ending) => `| ${ending.map(verbCell).join(" | ")} |`),
            ].join("\n"),
        );
    }
    return tables.join("\n\n");
}

/**
 * Render a result of terms as a glossary.
 *
 * @param {{columns: string[], rows: object[]}} result - From
 *   {@link module:engine/sql-tables.runSqlQuery}.
 * @param {LayoutOptions} [opts]
 * @returns {string} The Markdown.
 * @throws {Error} When the result lacks a required column.
 */
export function renderGlossary(result, opts = {}) {
    requireColumns(result, "glossary");
    const entries = new Map();
    for (const row of result.rows) {
        const key = `${row.language ?? ""}\0${row.name}`;
        if (!entries.has(key)) entries.set(key, { ...row, rows: [] });
        entries.get(key).rows.push(row);
    }
    return render(
        [...entries.values()].map((entry) => {
            const senses = [];
            for (const row of entry.rows)
                for (const sense of Array.isArray(row.senses) ? row.senses : []) {
                    const same = senses.find((one) => one.text === sense?.text);
                    const bodies = Array.isArray(sense?.bodies) ? sense.bodies : [];
                    const omitBody = Boolean(
                        opts.pageOwner &&
                        row.owner === opts.pageOwner &&
                        bodies.length === 1 &&
                        bodies[0] === row.owner,
                    );
                    if (!same) senses.push({ text: sense?.text, bodies: [...bodies], omitBody });
                    else {
                        same.omitBody &&= omitBody;
                        for (const body of bodies)
                            if (!same.bodies.includes(body)) same.bodies.push(body);
                    }
                }
            for (const sense of senses) sense.bodies.sort(compare);
            const first = (column) =>
                entry.rows.map((row) => row[column]).find((value) => value != null && value !== "");
            return {
                ...entry,
                senses,
                usage: [...new Set(entry.rows.flatMap((row) => row.usage ?? []))].sort(compare),
                common: entry.rows.some((row) => row.common === true),
                pronunciation: first("pronunciation"),
                name_sort: first("name_sort"),
                letter: first("letter"),
                class: first("class"),
                word: first("word"),
                etymology: undefined,
            };
        }),
        opts,
        false,
    );
}

/** Refuse a result missing a column its layout needs, naming the column. */
function requireColumns(result, layout) {
    const columns = new Set(result.columns);
    for (const column of LAYOUT_REQUIRED_COLUMNS[layout])
        if (!columns.has(column))
            throw new Error(
                `layout=${layout} needs the column "${column}", and the query does not select it`,
            );
}

/**
 * Set entries as Markdown.
 *
 * @param {object[]} entries - One per entry, with the row columns.
 * @param {LayoutOptions} opts
 * @param {boolean} words - Whether the entries are dictionary words, with
 *   their own anchors and etymology.
 * @param {string} [head] - Optional dictionary head tables.
 * @returns {string}
 */
function render(
    entries,
    {
        linkable = () => true,
        sectionLevel = 2,
        addressContext,
        labelOf = () => undefined,
        showKey = true,
        pageLanguage,
        entryAnchors = true,
    },
    words,
    head = "",
) {
    const label = (address) => labelOf(address) ?? address;
    const usedTags = new Map();
    const usedBases = new Set();
    const usedModifiers = new Set();
    let anyCommon = false;
    let anyPlural = false;

    const cite = (address) => {
        const text = label(address);
        const ref = parseAddress(address, addressContext ?? {}, { declared: true });
        if (ref.reason || !linkable(ref)) return text;
        return `[[${renderAddress(ref)}|${String(text).replace(/\|/g, "/")}]]{.${LEXICAL_LINK_CLASS}}`;
    };
    const tag = (language, text) => {
        if (!text) return "";
        if (!usedTags.has(text)) usedTags.set(text, language);
        return text;
    };

    const sorted = entries.map((row) => {
        const sortKey = String(row.name_sort ?? row.name ?? "");
        return { row, letter: String(row.letter ?? dictionaryLetter(sortKey)), sortKey };
    });
    sorted.sort(
        (a, b) =>
            compare(a.letter, b.letter) ||
            compare(fold(a.sortKey), fold(b.sortKey)) ||
            compare(a.sortKey, b.sortKey) ||
            compare(String(a.row.name), String(b.row.name)) ||
            compare(String(a.row.language_tag ?? ""), String(b.row.language_tag ?? "")),
    );

    const paragraphs = [];
    let letter;
    for (const { row, letter: current } of sorted) {
        if (current !== letter) {
            letter = current;
            paragraphs.push(`${"#".repeat(sectionLevel)} ${letter}`);
        }
        const parts = [];
        if (!words && row.common === true) {
            anyCommon = true;
            parts.push(COMMON_MARK);
        }
        let headword = `**${row.name}**`;
        if (words && entryAnchors && typeof row.language === "string")
            headword = `[${headword}]{#${dictionaryEntryAnchor(row.language, row.name)} .${DICTIONARY_ENTRY_CLASS}}`;
        else if (!words && typeof row.word === "string") {
            const { address, anchor } = splitAnchor(row.word);
            const ref = readCanonicalKey(address);
            if (ref && anchor && linkable(ref))
                headword = `**[[${renderAddress(ref)}#${anchor}|${String(row.name).replace(/\|/g, "/")}]]{.${LEXICAL_LINK_CLASS}}**`;
        }
        parts.push(headword);
        if (row.pronunciation) parts.push(`/${row.pronunciation}/`);

        const italic = [];
        if (row.language_tag && row.language !== pageLanguage)
            italic.push(tag(row.language, row.language_tag));
        if (row.class) {
            const parsed = parseWordClass(row.class);
            if (!parsed.reason) {
                usedBases.add(parsed.base);
                for (const token of parsed.modifiers) usedModifiers.add(token);
                let classification = abbreviateWordClass(parsed);
                if (words && parsed.base === "n" && typeof row.plural === "string" && row.plural) {
                    classification += `, pl. ${row.plural}`;
                    anyPlural = true;
                }
                italic.push(classification);
            } else italic.push(String(row.class));
        }
        if (italic.length) parts.push(`_${italic.join(" ")}_`);
        if (words && row.field) parts.push(`(_${row.field}_)`);

        if (words) {
            const bracket = etymologyText(row.etymology, row.language, tag);
            if (bracket) parts.push(`[${bracket}]`);
        }

        const senses = Array.isArray(row.senses) ? row.senses : [];
        const senseText = (sense) => {
            const bodies = Array.isArray(sense?.bodies) ? sense.bodies : [];
            const by =
                bodies.length && !sense.omitBody ? `(_${bodies.map(label).join(", ")}_) ` : "";
            return `${by}${markLinks(sentence(sense?.text))}`;
        };
        if (senses.length === 1) parts.push(senseText(senses[0]));
        else senses.forEach((sense, i) => parts.push(`**${i + 1}** ${senseText(sense)}`));

        const usage = Array.isArray(row.usage) ? row.usage : [];
        let line = parts.join(" ");
        if (usage.length) line += ` — ${usage.map(cite).join(", ")}`;
        paragraphs.push(line);
    }

    const key = [];
    for (const [text, language] of [...usedTags].sort((a, b) => compare(a[0], b[0]))) {
        const expansion = language ? labelOf(language) : undefined;
        if (expansion && expansion !== text) key.push(`_${text}_ ${expansion}`);
    }
    for (const base of WORD_CLASS_BASES)
        if (usedBases.has(base.token))
            key.push(`_${base.abbreviation ?? base.token}_ ${base.expansion}`);
    for (const modifier of WORD_CLASS_MODIFIERS)
        if (usedModifiers.has(modifier.token))
            key.push(`_${modifier.abbreviation}_ ${modifier.expansion}`);
    if (anyPlural) key.push("_pl._ plural");
    if (anyCommon) key.push(`${COMMON_MARK} ${COMMON_KEY}`);
    const line = key.length ? `**Key:** ${key.join("; ")}.` : "";
    if (showKey === "only") return line;
    if (showKey && head) paragraphs.unshift(head);
    if (showKey && line) paragraphs.unshift(line);
    return paragraphs.join("\n\n");
}

/**
 * An etymology as the bracket prints it, without the brackets, or the empty
 * string where it says nothing.
 *
 * @param {object|null|undefined} etymology - The row's `etymology`.
 * @param {string|null|undefined} own - The entry's own language.
 * @param {(language: string, text: string) => string} tag - Records and
 *   returns a language tag.
 * @returns {string}
 */
function etymologyText(etymology, own, tag) {
    if (!etymology || typeof etymology !== "object") return "";
    const pieces = [];
    const tongue =
        etymology.language && etymology.language !== own ?
            tag(etymology.language, etymology.language_tag)
        :   "";
    const form = etymology.form ? `_${etymology.form}_` : "";
    switch (etymology.kind) {
        case "borrowed":
            pieces.push(["fr.", tongue, form].filter(Boolean).join(" "));
            break;
        case "inherited":
        case "kept":
        case "worn":
            if (form || tongue) pieces.push([tongue, form && `*${form}`].filter(Boolean).join(" "));
            break;
        case "coined":
        case "substrate":
        case "island":
            pieces.push(etymology.kind);
            break;
        default:
            break;
    }
    if (Array.isArray(etymology.parts) && etymology.parts.length)
        pieces.push(
            etymology.parts
                .map((part) => `_${part.form}_${part.gloss ? ` "${part.gloss}"` : ""}`)
                .join(" + "),
        );
    const skeleton = [
        etymology.root ? `root _${etymology.root}_` : "",
        etymology.frame ? `pattern _${etymology.frame}_` : "",
    ]
        .filter(Boolean)
        .join(", ");
    if (skeleton) pieces.push(skeleton);
    return pieces.filter(Boolean).join("; ");
}
