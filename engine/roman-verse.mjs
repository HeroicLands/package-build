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
import { parseVerse } from "./content-verse.mjs";
import { plainRomanRun } from "./roman-run.mjs";

/**
 * Project verse text with explicit authored line, stanza and canto boundaries.
 * Source newlines within a logical line are whitespace. Delimiters and visual
 * indentation do not reach the encoder as letters.
 * @param {string} source - Complete authored source.
 * @param {Parameters<typeof plainRomanRun>[1] & {model?: ReturnType<typeof parseVerse>, modelOffset?: number}} [options] - Run bounds, spans and layout projection.
 * @returns {ReturnType<typeof plainRomanRun> & {boundaries: Array<{kind: "line"|"stanza"|"canto", at: number, sourceOffset: number}>, errors: Array<{offset: number, message: string}>}} Visible text, positions and structural events.
 */
export function plainRomanVerse(source, options = {}) {
    const {
        from = 0,
        to = source.length,
        exclude = [],
        model: sharedModel,
        modelOffset = from,
    } = options;
    const model = sharedModel ?? parseVerse(source.slice(from, to));
    const base = sharedModel ? modelOffset : from;
    const boundaries = model.boundaries
        .map((boundary) => ({ ...boundary, sourceOffset: base + boundary.sourceOffset }))
        .filter((boundary) => boundary.sourceOffset >= from && boundary.sourceOffset <= to);
    const projected = plainRomanRun(source, {
        ...options,
        preserveSlashEscape: true,
        from,
        to,
        exclude: [
            ...exclude,
            ...model.layout
                .map(([first, past]) => [Math.max(from, base + first), Math.min(to, base + past)])
                .filter(([first, past]) => past > first),
        ],
    });
    const text = [],
        offsets = [],
        positions = [],
        ends = [];
    const pending = [...boundaries];
    let boundaryIndex = 0;
    const appendBoundary = (boundary) => {
        text.push("\n");
        offsets.push(boundary.sourceOffset);
    };
    for (let index = 0; index < projected.text.length; index++) {
        ends[index] = text.length;
        while (
            pending[boundaryIndex] &&
            pending[boundaryIndex].sourceOffset <= projected.offsets[index]
        )
            appendBoundary(pending[boundaryIndex++]);
        positions[index] = text.length;
        const char = projected.text[index];
        if (char === "\n" && projected.text[index - 1] === "\r") continue;
        text.push(/[\r\n]/.test(char) ? " " : char);
        offsets.push(projected.offsets[index]);
    }
    ends[projected.text.length] = text.length;
    while (pending[boundaryIndex]) appendBoundary(pending[boundaryIndex++]);
    positions[projected.text.length] = text.length;
    projected.text = text.join("");
    projected.offsets = offsets;
    projected.spans = projected.spans.map((span) => ({
        ...span,
        from: positions[span.from],
        to: ends[span.to],
        contentFrom: positions[span.contentFrom],
        contentTo: ends[span.contentTo],
    }));
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
    return {
        ...projected,
        boundaries: boundaries.map(({ kind, sourceOffset }) => ({
            kind,
            sourceOffset,
            at: logicalAt(sourceOffset),
        })),
        errors: model.errors
            .map(({ offset, message }) => ({ offset: base + offset, message }))
            .filter((error) => error.offset >= from && error.offset < to),
    };
}
