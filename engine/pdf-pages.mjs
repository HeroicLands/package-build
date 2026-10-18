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
 * Where each book prints each note, and how a book names a note another book
 * prints.
 *
 * A PDF link cannot reach another file, so a reference to a note whose **home
 * book** — the first book in configuration order that selects it — is another
 * book is set as words: `Name (_Book title_, p. N)`. The page is the one the
 * note's entry starts on in its home book. It is read from the laid-out
 * document rather than predicted, so the build renders every book, measures the
 * pages, and renders again with the table — see {@link module:engine/pdf-build}.
 *
 * - {@link homeEntries} says which book and which anchor each homed note has.
 * - {@link readEntryPages} measures one book's `.typ` with `typst eval`, which
 *   lays the document out and answers from its introspection. The page a
 *   reader sees printed is the page counter at the entry's heading, so the
 *   number needs neither the outline nor a `query` that cannot see layout.
 * - {@link pageTable} is the table written as `pages.json`.
 * - {@link elsewhereFor} is the lookup a book renders its cross-book
 *   references from.
 *
 * @module engine/pdf-pages
 */

import { spawnSync } from "node:child_process";

import { encodeAddresses } from "./address-values.mjs";
import { recordKey } from "./pdf-coverage.mjs";
import { labelFor } from "./pdf-render.mjs";

/** What a reference prints for a page that has not been measured. */
export const UNMEASURED_PAGE = "?";

/**
 * The Typst expression `typst eval` answers: every labelled heading and the
 * page number the book prints for it.
 */
const PAGES_EXPRESSION =
    'query(heading).filter(e => e.at("label", default: none) != none)' +
    '.map(e => (str(e.at("label")), counter(page).at(e.location()).first()))';

/**
 * The arguments that measure a book, as data.
 *
 * Fonts are the compile's, because a face with other metrics lays out other
 * pages.
 *
 * @param {string} typPath - The `.typ` file.
 * @param {string[]} fontArgs - `--ignore-system-fonts --font-path …`, as the
 *   compile passes them.
 * @returns {string[]} The arguments, in order.
 */
export function evalArgs(typPath, fontArgs) {
    return ["eval", "--in", typPath, ...fontArgs, PAGES_EXPRESSION];
}

/**
 * Say why a finished Typst process failed.
 *
 * A process killed by a signal has no exit status and prints nothing, so the
 * signal is named; `SIGKILL` is the kernel's out-of-memory kill. Otherwise the
 * first line the compiler printed is the reason, and the exit code stands in
 * when it printed none.
 *
 * @param {{status: number | null, signal: string | null, stderr?: string | null, stdout?: string | null}} result -
 *   The finished process.
 * @param {string} binary - The Typst binary.
 * @param {string} subcommand - The Typst subcommand that ran.
 * @returns {string} The reason, ready to follow the failing command's name.
 */
export function typstFailure(result, binary, subcommand) {
    const command = `\`${binary} ${subcommand}\``;
    if (result.signal) {
        const hint = result.signal === "SIGKILL" ? " (most often the memory limit)" : "";
        return `${command} was killed by ${result.signal}${hint}`;
    }
    const detail = String(result.stderr || result.stdout || "")
        .trim()
        .split("\n")[0];
    return detail ?
            `${command} failed: ${detail}`
        :   `${command} exited with code ${result.status} and printed nothing`;
}

/**
 * Measure the page each labelled entry of a book starts on.
 *
 * @param {string} typPath - The `.typ` file.
 * @param {string[]} fontArgs - The compile's font arguments.
 * @param {string} [binary] - The Typst binary.
 * @returns {{ok: boolean, message: string, pages: Map<string, number>}} The
 *   printed page of every labelled heading, keyed by label.
 */
export function readEntryPages(typPath, fontArgs, binary = "typst") {
    const fail = (message) => ({ ok: false, message, pages: new Map() });
    let result;
    try {
        result = spawnSync(binary, evalArgs(typPath, fontArgs), {
            encoding: "utf8",
            maxBuffer: 1 << 28,
        });
    } catch (err) {
        return fail(`could not run \`${binary}\`: ${err.message}`);
    }
    if (result.error) return fail(`could not run \`${binary}\`: ${result.error.message}`);
    if (result.status !== 0) return fail(typstFailure(result, binary, "eval"));
    let rows;
    try {
        rows = JSON.parse(result.stdout);
    } catch {
        return fail(`\`${binary} eval\` printed no page table`);
    }
    return {
        ok: true,
        message: "",
        pages: new Map(rows.map(([label, page]) => [String(label), Number(page)])),
    };
}

/**
 * Every note that has a home book, with the anchor its entry carries there.
 *
 * **A note a book prints twice has one page**: the first entry, which is the
 * one the book's links reach. A note a book reprints from another book's home
 * keeps its home book's page here, because the home is the first book in
 * configuration order that selects it.
 *
 * @param {object} input - Options.
 * @param {Array<{id: string, title: string, plan: {entries: object[]}}>} input.books -
 *   The books that render, in configuration order.
 * @param {Map<string, string>} input.homes - Each note's key → its home book's
 *   id, from {@link module:engine/pdf-coverage.coverage}.
 * @returns {Array<{key: string, book: string, title: string, abbreviation?: string, anchor: string,
 *   record: object, slug: string, aliases: string[]}>} One per homed note, in book order and
 *   then entry order.
 */
export function homeEntries({ books, homes }) {
    const found = [];
    const claimed = new Set();
    for (const book of books) {
        for (const entry of book.plan.entries) {
            if (entry.kind !== "note") continue;
            const key = recordKey(entry.record);
            if (claimed.has(key) || homes.get(key) !== book.id) continue;
            claimed.add(key);
            const record = entry.record;
            found.push({
                key,
                book: book.id,
                title: book.title,
                abbreviation: book.abbreviation,
                anchor: entry.anchor,
                record,
                slug: String(record?.address?.slug ?? record?.shortcode ?? ""),
                aliases: [record?.address?.canonical, record?.documentation]
                    .filter(Boolean)
                    .map((address) => encodeAddresses(address)),
            });
        }
    }
    return found;
}

/**
 * The table written as `pages.json`.
 *
 * @param {ReturnType<typeof homeEntries>} entries - From {@link homeEntries}.
 * @param {Map<string, Map<string, number>>} measured - Book id → label → page.
 * @returns {Record<string, {book: string, page: number}>} Keyed by the note's
 *   key, in sorted key order. A note whose entry was not measured is absent.
 */
export function pageTable(entries, measured) {
    const table = {};
    const sorted = [...entries].sort((a, b) =>
        a.key < b.key ? -1
        : a.key > b.key ? 1
        : 0,
    );
    for (const entry of sorted) {
        const page = measured.get(entry.book)?.get(labelFor(entry.anchor));
        if (page !== undefined) table[entry.key] = { book: entry.book, page };
    }
    return table;
}

/**
 * The notes whose page differs between two tables.
 *
 * @param {Record<string, {book: string, page: number}>} before - A table.
 * @param {Record<string, {book: string, page: number}>} after - A later one.
 * @returns {Array<{key: string, book: string, before: number|undefined,
 *   after: number|undefined}>} In sorted key order.
 */
export function movedPages(before, after) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys
        .filter((key) => before[key]?.page !== after[key]?.page)
        .map((key) => ({
            key,
            book: (after[key] ?? before[key]).book,
            before: before[key]?.page,
            after: after[key]?.page,
        }));
}

/**
 * The lookup one book renders its cross-book references from.
 *
 * A note the book prints (a reprint included) is never in it: its link stays an
 * internal destination. Keys are the three forms the book's own link map
 * answers to — slug, canonical address and documentation address.
 *
 * `get` counts the references it answers, which is how the build knows whether
 * a measured pass can change anything.
 *
 * @param {object} input - Options.
 * @param {ReturnType<typeof homeEntries>} input.entries - From {@link homeEntries}.
 * @param {string} input.book - The id of the book that renders.
 * @param {Map<string, string>} input.printed - The book's own link map.
 * @param {Record<string, {book: string, page: number}>} [input.table] - The
 *   measured pages; every page is {@link UNMEASURED_PAGE} when absent.
 * @param {boolean} [input.seeAlso] - Whether the book's index lists the notes
 *   it mentions here (`pdf.indexSeeAlso`). `listed` is empty when not.
 * @returns {{used: number, seeAlso: boolean,
 *   listed: Array<{slug: string, name: string, title: string, page: string|number}>,
 *   get: (key: string) => ({slug: string, title: string, page: string|number}|undefined)}}
 *   The lookup. `listed` is every note another book prints, for the index to
 *   show those this book mentions.
 */
export function elsewhereFor({ entries, book, printed, table, seeAlso = false }) {
    const map = new Map();
    const listed = [];
    for (const entry of entries) {
        if (entry.book === book) continue;
        const keys = [entry.slug, ...entry.aliases].filter((key) => key && !printed.has(key));
        const page = table?.[entry.key]?.page ?? UNMEASURED_PAGE;
        for (const key of keys) {
            if (!map.has(key)) {
                map.set(key, {
                    slug: entry.slug,
                    title: entry.title,
                    abbreviation: entry.abbreviation,
                    page,
                });
            }
        }
        if (seeAlso && entry.slug && !printed.has(entry.slug)) {
            listed.push({
                slug: entry.slug,
                name: String(entry.record?.name?.full ?? "").trim(),
                title: entry.title,
                abbreviation: entry.abbreviation,
                page,
            });
        }
    }
    return {
        used: 0,
        seeAlso,
        listed,
        get(key) {
            const found = map.get(key);
            if (found) this.used += 1;
            return found;
        },
    };
}
