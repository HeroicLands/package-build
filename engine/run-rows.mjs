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
 * Spans, divs and verse fences marked with `lang=`, `font=` or `enc=`, projected
 * from own-note index records into the SQL `runs` relation. Every value is a
 * column value and none is a key, so two notes writing one tag in different
 * case are two rows. Documentation records and assets contribute no rows.
 *
 * Encoding-document language and font defaults are filled by
 * {@link fillEncodingRuns} once every document exists. Roman runs use the
 * default encoding; ordinary font inheritance is projected by the scanner.
 *
 * @module
 */

import { canonicalKey, readCanonicalKey } from "./address.mjs";
import { encodeAddresses } from "./address-values.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { scanRuns } from "./content-scripts.mjs";
import { resolveScriptFonts } from "./script-fonts.mjs";
import { encodingsFromRecords, encodingAddress } from "./encoding-notes.mjs";

/** Every column of the `runs` relation, in order. */
export const RUN_COLUMNS = Object.freeze([
    "owner",
    "kind",
    "lang",
    "tag",
    "font",
    "enc",
    "line",
    "column",
]);

/**
 * One run as an index record carries it.
 *
 * @typedef {object} RecordRun
 * @property {"span"|"block"|"verse"|"scroll"} kind - The construct.
 * @property {string|null} lang - The language it is set in, as written: its
 *   own `lang=`, else the one the div or fence around it states.
 * @property {string|null} tag - The BCP 47 tag it resolves to, or null.
 * @property {string|null} font - Its explicit font, an inherited ordinary
 *   prose family, or the font of the selected encoding document.
 * @property {string|null} enc - Its resolved encoding document, or default for Roman text.
 * @property {number} line - 1-based file line of its opening.
 * @property {number} column - 1-based UTF-16 file column of its opening.
 */

/**
 * @typedef {RecordRun & {owner: string|null}} RunRow
 */

/**
 * A note body's runs, at file positions, as an index record carries them.
 *
 * @param {string} body - The note's body.
 * @param {object} options - Options.
 * @param {import("./content-scripts.mjs").RunContext} [options.context] - The
 *   configured languages, which give a declared name its tag.
 * @param {number} [options.bodyLine] - The 1-based file line the body starts on.
 * @param {number} [options.bodyColumn] - The 1-based column of its first character.
 * @param {import("./content-session.mjs").ContentSyntax} [options.syntax] -
 *   Session scanner projections.
 * @returns {RecordRun[]} One entry per run, in source order.
 */
export function recordRuns(body, { context, bodyLine = 1, bodyColumn = 1, syntax } = {}) {
    return scanRuns(body, context, syntax).runs.map((run) => ({
        kind: run.kind,
        lang: run.lang ?? null,
        tag: run.tag ?? null,
        font: run.font ?? null,
        enc: run.enc ?? null,
        line: bodyLine + run.line - 1,
        column: run.column + (run.line === 1 ? bodyColumn - 1 : 0),
    }));
}

/**
 * Resolve recorded encoding Addresses and fill the language and font supplied
 * by each selected document, once every index record exists.
 *
 * @param {Record<string, any>[]} records - The package's index records; each
 *   note record's `runs` is updated in place.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string, rootDir?:string, paths?:{content?:string}}} config -
 *   The configured languages, whose `note` names each language note.
 */
export function fillEncodingRuns(records, config) {
    const { encodings } = encodingsFromRecords(
        records,
        config,
        config?.rootDir ? resolveScriptFonts(config.rootDir) : undefined,
    );
    for (const record of records) {
        if (!record || !isNoteRecord(record) || !Array.isArray(record.runs)) continue;
        for (const run of record.runs) {
            run.enc ??= "default";
            const encoding =
                encodings.get(run.enc) ??
                encodings.get(encodingAddress(run.enc, config.contentPackage));
            if (!encoding) continue;
            run.enc = encoding.name;
            run.lang ??= encoding.language;
            run.font ??= encoding.font;
            run.tag ??= config.languages?.[run.lang]?.tag ?? null;
        }
    }
}

/**
 * The containing page's NOTE identity.
 *
 * @param {Record<string, any>} record - An own-note index record.
 * @returns {string|null} The page Address, or null for an unaddressable record.
 */
export function ownerOf(record) {
    const parts = readCanonicalKey(encodeAddresses(record.address?.canonical));
    return parts ? canonicalKey(parts.package, "note", parts.type, parts.shortcode) : null;
}

/**
 * Project recorded runs without reading sources or changing records.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, already
 *   narrowed to the audience.
 * @returns {RunRow[]} One row per run, in record then source order.
 */
export function runsRows(records) {
    const rows = [];
    for (const record of records) {
        if (!record || !isNoteRecord(record) || !Array.isArray(record.runs)) continue;
        const owner = ownerOf(record);
        for (const run of record.runs)
            rows.push({
                owner,
                kind: run.kind,
                lang: run.lang ?? null,
                tag: run.tag ?? null,
                font: run.font ?? null,
                enc: run.enc ?? null,
                line: run.line,
                column: run.column,
            });
    }
    return rows;
}
