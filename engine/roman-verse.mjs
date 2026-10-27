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

/** Logical verse text and separately located structural boundaries. @module */
import { verseLine } from "./content-verse.mjs";
import { plainRomanRun } from "./roman-run.mjs";

/**
 * Remove visual indentation before checking or encoding Roman verse. Each
 * content line keeps its own boundary, including the last line before a stanza
 * or canto; those extra structural controls do not consume its line boundary.
 * The caller writes the boundaries through its selected encoding.
 * @param {string} source - Complete authored source.
 * @param {Parameters<typeof plainRomanRun>[1] & {isCantoLine?: (line: string) => boolean}} [options] - Run bounds, spans and layout projection.
 * @returns {ReturnType<typeof plainRomanRun> & {boundaries: Array<{kind: "line"|"stanza"|"canto", at: number, sourceOffset: number}>, errors: Array<{offset: number, message: string}>}} Visible text, positions and structural events.
 */
export function plainRomanVerse(source, options = {}) {
    const {
        from = 0,
        to = source.length,
        exclude = [],
        isCantoLine = (line) => /^\s*---\s+\{\.canto\}\s*$/.test(line),
    } = options;
    const lines = [];
    const layout = [...exclude];
    let at = from;
    for (const match of source.slice(from, to).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
        if (!match[0]) continue;
        const line = match[1];
        const end = at + line.length;
        const kind =
            isCantoLine(line) ? "canto"
            : line.trim() ? "content"
            : "blank";
        lines.push({ from: at, to: end, kind });
        if (kind === "canto") layout.push([at, end]);
        else if (kind === "content") {
            const { markerStart, markerLength } = verseLine(line);
            if (markerLength) layout.push([at + markerStart, at + markerStart + markerLength]);
        }
        at += match[0].length;
    }
    const projected = plainRomanRun(source, { ...options, from, to, exclude: layout });
    const logicalAt = (offset) => {
        let first = 0,
            past = projected.offsets.length;
        while (first < past) {
            const middle = (first + past) >>> 1;
            if (projected.offsets[middle] < offset) first = middle + 1;
            else past = middle;
        }
        return first;
    };
    /** @type {Array<{kind: "line"|"stanza"|"canto", at: number, sourceOffset: number}>} */
    const boundaries = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.kind === "content")
            boundaries.push({ kind: "line", at: logicalAt(line.to), sourceOffset: line.to });
        else if (line.kind === "canto")
            boundaries.push({ kind: "canto", at: logicalAt(line.from), sourceOffset: line.from });
        else if (lines[index - 1]?.kind === "content") {
            const following = lines.slice(index + 1).find((next) => next.kind !== "blank");
            if (following?.kind === "content")
                boundaries.push({
                    kind: "stanza",
                    at: logicalAt(line.from),
                    sourceOffset: line.from,
                });
        }
    }
    const errors = [];
    for (let index = 0; index < projected.text.length; index++) {
        if (projected.text[index] === "⟦") {
            const close = projected.text.indexOf("⟧", index + 1);
            index = close < 0 ? projected.text.length : close;
        } else if (projected.text[index] === "/")
            errors.push({
                offset: projected.offsets[index],
                message:
                    "a verse fence uses authored line endings for verse boundaries; write no literal `/` inside it",
            });
    }
    return { ...projected, boundaries, errors };
}
