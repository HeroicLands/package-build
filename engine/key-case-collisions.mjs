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
 * Keys that differ only in case, found in the content index's records.
 *
 * The notes relation is read with `read_json_auto`, which infers one struct
 * from every record and treats the names of a struct's fields without regard
 * to case. A map whose keys an author chooses therefore cannot hold `carved`
 * in one note and `Carved` in another: the relation refuses to load. This
 * module names each such pair, with the note and the line of both keys, so the
 * author renames one.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { formatDiagnostic, positionInFrontmatter } from "./diagnostics.mjs";

/**
 * Walk a record, noting every key under its case-folded path.
 *
 * @param {unknown} value - The value at `trail`.
 * @param {string} trail - The case-folded path to it.
 * @param {object} record - The record being walked.
 * @param {Map<string, Map<string, Set<object>>>} groups - Case-folded path to
 *   each spelling found there and the records that use it.
 */
function walk(value, trail, record, groups) {
    if (Array.isArray(value)) {
        for (const entry of value) walk(entry, trail, record, groups);
        return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
        const at = `${trail}.${key.toLowerCase()}`;
        let spellings = groups.get(at);
        if (!spellings) groups.set(at, (spellings = new Map()));
        let users = spellings.get(key);
        if (!users) spellings.set(key, (users = new Set()));
        users.add(record);
        walk(child, at, record, groups);
    }
}

/**
 * Every key that two records, or one record, spell with different case at the
 * same path.
 *
 * @param {object[]} records - Content-index records.
 * @returns {Array<{key: string, other: string, record: object, otherRecord: object}>}
 *   One entry per spelling that collides with another, naming the record that
 *   uses it and a record that uses the other spelling.
 */
export function findKeyCaseCollisions(records) {
    const groups = new Map();
    for (const record of records) walk(record, "", record, groups);
    const found = [];
    for (const spellings of groups.values()) {
        if (spellings.size < 2) continue;
        const keys = [...spellings.keys()].sort();
        const [first, ...rest] = keys;
        for (const key of keys) {
            const other = key === first ? rest[0] : first;
            found.push({
                key,
                other,
                record: [...spellings.get(key)][0],
                otherRecord: [...spellings.get(other)][0],
            });
        }
    }
    return found;
}

/**
 * The note a record came from and where a key sits in it.
 *
 * @param {object} record - A content-index record.
 * @param {string} key - The key to find.
 * @param {string|undefined} contentBase - The directory `record.file.path` is
 *   relative to.
 * @returns {{file: string, line?: number, column?: number}} The path relative
 *   to the working directory, with the position where the key is found.
 */
function noteLocation(record, key, contentBase) {
    const relative = record.file?.path ?? "";
    const absolute = contentBase ? path.join(contentBase, relative) : undefined;
    const file = absolute ? path.relative(process.cwd(), absolute) : relative;
    let position = {};
    if (absolute) {
        try {
            position = positionInFrontmatter(fs.readFileSync(absolute, "utf8"), key, undefined);
        } catch {
            position = {};
        }
    }
    return { file, ...position };
}

/**
 * The diagnostics for every case collision in the records, one per spelling,
 * each naming the note and line of the spelling it collides with.
 *
 * @param {object[]} records - Content-index records.
 * @param {object} [options]
 * @param {string} [options.contentBase] - The directory the records' paths are
 *   relative to.
 * @returns {string[]} Formatted `file:line:column: error: message` lines.
 */
export function keyCaseCollisionDiagnostics(records, { contentBase } = {}) {
    return findKeyCaseCollisions(records).map(({ key, other, record, otherRecord }) => {
        const here = noteLocation(record, key, contentBase);
        const there = noteLocation(otherRecord, other, contentBase);
        const where = [there.file, there.line, there.column].filter((part) => part !== undefined);
        return formatDiagnostic({
            ...here,
            severity: "error",
            message:
                `\`${key}\` and \`${other}\` name one key: the content index reads keys ` +
                `without regard to case, so \`${other}\` in ${where.join(":")} must be spelled ` +
                `the same way`,
        });
    });
}
