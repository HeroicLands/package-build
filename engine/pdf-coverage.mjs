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
 * What the declared books cover, as a pure function of their selections.
 *
 * Every book's filters run against one corpus before any book renders, so the
 * questions that span books are answered once, here: which printable notes no
 * book selects, which book is each selected note's home, and how many notes
 * each book prints. Nothing is read or written; the build hands in the records
 * and prints what comes back.
 *
 * - **A candidate** is a note a book can print — not a stub, not a `gm` note —
 *   and not named by `pdf.unprinted`. A candidate no book selects is a finding
 *   at the severity `pdf.coverage` names, and `off` emits none.
 * - **The home book** is the first book in configuration order that selects the
 *   note. A note several books select prints in each; a note selected twice
 *   inside one book is still one book.
 *
 * @module engine/pdf-coverage
 */

import { isNoteRecord, isStub } from "./index-records.mjs";
import { encodeAddresses } from "./address-values.mjs";
import { isGmNote } from "./note-vocabulary.mjs";

/** The message a note in no book carries. */
export const UNCOVERED_MESSAGE =
    "no book selects this note; add it to a book's query or to `pdf.unprinted`";

/**
 * Whether a record is a note a book can print.
 *
 * @param {object} record - An index record.
 * @returns {boolean} False for an asset, a documentation row, a stub and a `gm` note.
 */
export function isPrintable(record) {
    return isNoteRecord(record) && !isStub(record) && !isGmNote(record);
}

/**
 * The key a note is counted by: its canonical address as text. An index record
 * holds the address as a tuple and a row of the notes database as a string;
 * both give the same key.
 *
 * @param {object} record - A printable record.
 * @returns {string} The key.
 */
export function recordKey(record) {
    const canonical = record?.address?.canonical;
    return String(
        canonical == null ?
            (record?.file?.path ?? record?.shortcode ?? "")
        :   encodeAddresses(canonical),
    );
}

/**
 * Whether a note has no resolved culture.
 *
 * @param {object} record - A record.
 * @returns {boolean} True when `data.culture` is absent, null or empty.
 */
function lacksCulture(record) {
    const culture = record?.data?.culture;
    return culture == null || culture === "" || (Array.isArray(culture) && !culture.length);
}

/**
 * Compute coverage, homes and the summary.
 *
 * @param {object} input - Options.
 * @param {Array<{id: string, records: object[]}>} input.books - Each book's
 *   selected records, in configuration order; a record selected twice appears
 *   twice.
 * @param {object[]} input.corpus - Every record in the index.
 * @param {object[]} [input.unprinted] - The records `pdf.unprinted` selects.
 * @param {"warning"|"error"|"off"} [input.mode] - `pdf.coverage`.
 * @param {(record: object) => {file?: string, line?: number, column?: number}} [input.locate]
 *   Where a note's `type:` line sits; a field it cannot supply is dropped.
 * @returns {{findings: object[], homes: Map<string, string>, summary: object}}
 *   The findings in corpus order, each note's home book id by address, and the
 *   summary: per-book counts, totals and every note several books select.
 */
export function coverage({ books, corpus, unprinted = [], mode = "warning", locate = () => ({}) }) {
    const shelved = new Set(unprinted.filter(isPrintable).map(recordKey));
    const candidates = corpus.filter(
        (record) => isPrintable(record) && !shelved.has(recordKey(record)),
    );

    /** @type {Map<string, string>} */
    const homes = new Map();
    /** @type {Map<string, {record: object, books: string[]}>} */
    const carriers = new Map();
    const perBook = books.map((book) => {
        const distinct = new Map();
        for (const record of book.records) {
            const key = recordKey(record);
            distinct.set(key, record);
            if (!homes.has(key)) homes.set(key, book.id);
            const carrier = carriers.get(key) ?? { record, books: [] };
            if (!carrier.books.includes(book.id)) carrier.books.push(book.id);
            carriers.set(key, carrier);
        }
        return {
            id: book.id,
            entries: book.records.length,
            notes: distinct.size,
            uncultured: [...distinct.values()].filter(lacksCulture).length,
        };
    });

    const uncovered = candidates.filter((record) => !carriers.has(recordKey(record)));
    const findings =
        mode === "off" ?
            []
        :   uncovered.map((record) => ({
                ...locate(record),
                severity: mode,
                message: UNCOVERED_MESSAGE,
            }));

    const order = new Map(books.map((book, index) => [book.id, index]));
    const multiple = [...carriers.values()]
        .filter((carrier) => carrier.books.length > 1)
        .map((carrier) => ({
            name: String(carrier.record?.name?.full ?? carrier.record?.shortcode ?? ""),
            path: String(carrier.record?.file?.path ?? ""),
            books: carrier.books,
            home: carrier.books[0],
        }))
        .sort(
            (a, b) =>
                order.get(a.home) - order.get(b.home) ||
                (a.path < b.path ? -1
                : a.path > b.path ? 1
                : 0),
        );

    return {
        findings,
        homes,
        summary: {
            books: perBook,
            totals: {
                candidates: candidates.length,
                uncovered: uncovered.length,
                unprinted: shelved.size,
            },
            multiple,
        },
    };
}

/**
 * The summary as the lines the command prints.
 *
 * @param {object} summary - From {@link coverage}.
 * @returns {string[]} One line per book, one for the totals, one per note
 *   several books select.
 */
export function summaryLines(summary) {
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    return [
        ...summary.books.map(
            (book) =>
                `${book.id}: ${plural(book.entries, "entry", "entries")}, ` +
                `${plural(book.notes, "note", "notes")}, ${book.uncultured} without a culture`,
        ),
        `${plural(summary.totals.candidates, "printable note", "printable notes")}, ` +
            `${summary.totals.uncovered} in no book, ${summary.totals.unprinted} in pdf.unprinted`,
        ...summary.multiple.map(
            (note) =>
                `${note.name} (${note.path}) is printed by ${note.books.join(", ")}; ` +
                `home: ${note.home}`,
        ),
    ];
}
