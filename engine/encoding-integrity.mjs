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

/** Prove ordinary output tokens uniquely decodable without adding invisible metadata. */

/**
 * Check codeword integrity with a trie and finite Sardinas–Patterson residuals.
 * Source-equivalent compositions are redundant rules, not distinct spellings.
 * @param {Array<{from:string,to:string,key:string,before?:string,at?:string}>} rows - Validated ordinary rows.
 * @param {(key:string,message:string)=>never} fault - Positioned schema-error constructor.
 */
export function assertUniqueOutputs(rows, fault) {
    const bySource = new Map();
    for (const row of rows) {
        if (row.before || row.at) continue;
        const first = [...row.from][0];
        if (!bySource.has(first)) bySource.set(first, []);
        bySource.get(first).push(row);
    }
    for (const group of bySource.values()) group.sort((a, b) => b.from.length - a.from.length);
    const redundant = (row) => {
        if (row.before || row.at || [...row.from].length < 2) return false;
        let at = 0,
            output = "";
        while (at < row.from.length) {
            const first = String.fromCodePoint(row.from.codePointAt(at));
            const part = (bySource.get(first) ?? []).find(
                (one) => one.from.length < row.from.length && row.from.startsWith(one.from, at),
            );
            if (!part) return false;
            output += part.to;
            at += part.from.length;
        }
        return output === row.to;
    };
    const words = [
        ...new Map(rows.filter((row) => !redundant(row)).map((row) => [row.to, row])).values(),
    ];
    const node = () => ({ children: new Map(), word: undefined, words: [] });
    const root = node();
    for (const word of words) {
        let cursor = root;
        cursor.words.push(word);
        for (const char of word.to) {
            if (!cursor.children.has(char)) cursor.children.set(char, node());
            cursor = cursor.children.get(char);
            cursor.words.push(word);
        }
        cursor.word = word;
    }
    const pending = [],
        seen = new Set();
    const add = (residual, key) => {
        if (!residual)
            fault(key, "Output sequences are ambiguous; the encoding must be uniquely decodable");
        if (!seen.has(residual)) {
            seen.add(residual);
            pending.push({ residual, key });
        }
    };
    // A residual is the unmatched suffix after cancelling one output prefix.
    for (const word of words) {
        let cursor = root,
            offset = 0;
        for (const char of word.to) {
            cursor = cursor.children.get(char);
            offset += char.length;
            if (cursor.word && offset < word.to.length) add(word.to.slice(offset), word.key);
        }
    }
    for (let i = 0; i < pending.length; i++) {
        const { residual, key } = pending[i];
        let cursor = root,
            offset = 0;
        for (const char of residual) {
            cursor = cursor.children.get(char);
            if (!cursor) break;
            offset += char.length;
            if (cursor.word) add(residual.slice(offset), key);
        }
        if (cursor && offset === residual.length)
            for (const word of cursor.words) add(word.to.slice(offset), key);
    }
}
