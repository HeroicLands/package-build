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
 * **A face's outlines, drawn as SVG.** The book sets a `scroll` fence as panel
 * images because Typst has no vertical writing, and draws each character from
 * the face's own TrueType outlines, so a panel needs no renderer and no font
 * on the machine that compiles the book.
 *
 * - **`cmap`** (formats 4 and 12) gives each code point its glyph.
 * - **`loca` and `glyf`** give each glyph's quadratic contours, a composite
 *   glyph's components moved and scaled into place.
 * - **`hmtx`** gives a glyph's width, which centres it in its column.
 * - **`vmtx`**, where the face has it, gives the space above a glyph in a
 *   column one em tall; a face without it is centred on its ascender and
 *   descender.
 *
 * A panel is one SVG: each glyph drawn once as a path and placed by `<use>`,
 * the columns read from the right, `rows` ems tall and
 * {@link module:engine/content-scroll.SCROLL_PITCH} ems from column to column.
 * A character the face does not draw, and whitespace, leave their cell empty.
 *
 * @module
 */

import fs from "node:fs";

import { SCROLL_PITCH } from "./content-scroll.mjs";
import { tableDirectory } from "./pdf-fonts.mjs";

/**
 * One glyph, in font units, its y axis pointing down from the baseline.
 *
 * @typedef {object} Glyph
 * @property {number} index - Its glyph index.
 * @property {string} d - Its outline as SVG path data; `""` for none.
 * @property {number} advance - Its horizontal advance.
 * @property {number} top - From the top of its cell to its baseline.
 */

/**
 * A face's outlines.
 *
 * @typedef {object} Outlines
 * @property {number} unitsPerEm - Its units per em.
 * @property {(point: number) => Glyph|undefined} glyph - The glyph a code
 *   point is drawn with, or `undefined` when the face does not draw it.
 */

/** @type {Map<string, Outlines>} */
const cache = new Map();

/**
 * Code point → glyph index, from a `cmap` of format 4 or 12.
 *
 * @param {Buffer} buf - The font file.
 * @param {{offset: number}} table - The `cmap` record.
 * @returns {Map<number, number>} Glyph indices by code point.
 */
function codepointGlyphs(buf, table) {
    const out = new Map();
    const at = table.offset;
    const numTables = buf.readUInt16BE(at + 2);
    for (let i = 0; i < numTables; i += 1) {
        const sub = at + buf.readUInt32BE(at + 4 + i * 8 + 4);
        const format = buf.readUInt16BE(sub);
        if (format === 4) {
            const segX2 = buf.readUInt16BE(sub + 6);
            const endAt = sub + 14;
            const startAt = endAt + segX2 + 2;
            const deltaAt = startAt + segX2;
            const rangeAt = deltaAt + segX2;
            for (let s = 0; s < segX2 / 2; s += 1) {
                const end = buf.readUInt16BE(endAt + s * 2);
                const start = buf.readUInt16BE(startAt + s * 2);
                const delta = buf.readInt16BE(deltaAt + s * 2);
                const rangeOffset = buf.readUInt16BE(rangeAt + s * 2);
                if (start === 0xffff) continue;
                for (let cp = start; cp <= end; cp += 1) {
                    let glyph;
                    if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
                    else {
                        glyph = buf.readUInt16BE(rangeAt + s * 2 + rangeOffset + (cp - start) * 2);
                        if (glyph) glyph = (glyph + delta) & 0xffff;
                    }
                    if (glyph && !out.has(cp)) out.set(cp, glyph);
                }
            }
        } else if (format === 12) {
            const groups = buf.readUInt32BE(sub + 12);
            for (let g = 0; g < groups; g += 1) {
                const row = sub + 16 + g * 12;
                const start = buf.readUInt32BE(row);
                const end = Math.min(buf.readUInt32BE(row + 4), start + 0x1_0000);
                const first = buf.readUInt32BE(row + 8);
                for (let cp = start; cp <= end; cp += 1)
                    if (!out.has(cp)) out.set(cp, first + (cp - start));
            }
        }
    }
    return out;
}

/**
 * A point of a contour.
 *
 * @typedef {{x: number, y: number, on: boolean}} Point
 */

/**
 * A glyph's contours, its components resolved.
 *
 * @param {Buffer} buf - The font file.
 * @param {number} glyf - The `glyf` table's offset.
 * @param {(index: number) => [number, number]} span - A glyph's offset in
 *   `glyf` and the offset past it.
 * @param {number} index - The glyph.
 * @param {number} depth - How deep in a composite this glyph sits.
 * @returns {Point[][]} Its contours.
 */
function contours(buf, glyf, span, index, depth = 0) {
    const [from, to] = span(index);
    if (to <= from || depth > 8) return [];
    const at = glyf + from;
    const count = buf.readInt16BE(at);
    if (count >= 0) {
        const ends = [];
        for (let c = 0; c < count; c += 1) ends.push(buf.readUInt16BE(at + 10 + c * 2));
        const points = count ? ends[count - 1] + 1 : 0;
        let p = at + 10 + count * 2;
        p += 2 + buf.readUInt16BE(p);
        const flags = [];
        while (flags.length < points) {
            const flag = buf.readUInt8(p++);
            flags.push(flag);
            if (flag & 8) {
                const repeat = buf.readUInt8(p++);
                for (let r = 0; r < repeat; r += 1) flags.push(flag);
            }
        }
        const read = (short, same) => {
            const values = [];
            let value = 0;
            for (const flag of flags) {
                if (flag & short) {
                    const delta = buf.readUInt8(p++);
                    value += flag & same ? delta : -delta;
                } else if (!(flag & same)) {
                    value += buf.readInt16BE(p);
                    p += 2;
                }
                values.push(value);
            }
            return values;
        };
        const xs = read(2, 16);
        const ys = read(4, 32);
        const out = [];
        let start = 0;
        for (const end of ends) {
            const contour = [];
            for (let k = start; k <= end; k += 1)
                contour.push({ x: xs[k], y: ys[k], on: Boolean(flags[k] & 1) });
            out.push(contour);
            start = end + 1;
        }
        return out;
    }
    const out = [];
    let p = at + 10;
    for (;;) {
        const flags = buf.readUInt16BE(p);
        const component = buf.readUInt16BE(p + 2);
        p += 4;
        let dx;
        let dy;
        if (flags & 1) {
            dx = buf.readInt16BE(p);
            dy = buf.readInt16BE(p + 2);
            p += 4;
        } else {
            dx = buf.readInt8(p);
            dy = buf.readInt8(p + 1);
            p += 2;
        }
        if (!(flags & 2)) {
            dx = 0;
            dy = 0;
        }
        let [a, b, c, d] = [1, 0, 0, 1];
        const f2dot14 = (offset) => buf.readInt16BE(offset) / 16384;
        if (flags & 8) {
            a = d = f2dot14(p);
            p += 2;
        } else if (flags & 0x40) {
            a = f2dot14(p);
            d = f2dot14(p + 2);
            p += 4;
        } else if (flags & 0x80) {
            a = f2dot14(p);
            b = f2dot14(p + 2);
            c = f2dot14(p + 4);
            d = f2dot14(p + 6);
            p += 8;
        }
        for (const contour of contours(buf, glyf, span, component, depth + 1))
            out.push(
                contour.map(({ x, y, on }) => ({
                    x: a * x + c * y + dx,
                    y: b * x + d * y + dy,
                    on,
                })),
            );
        if (!(flags & 0x20)) break;
    }
    return out;
}

/** A number as path data writes it. */
const num = (value) => String(Math.round(value * 100) / 100);

/**
 * A contour of quadratic segments as SVG path data, its y axis flipped so it
 * points down from the baseline.
 *
 * @param {Point[]} contour - The contour.
 * @returns {string} The path data.
 */
function contourPath(contour) {
    if (!contour.length) return "";
    const points = contour.map(({ x, y, on }) => ({ x, y: -y, on }));
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
    let first = points.findIndex((point) => point.on);
    let start;
    let ordered;
    if (first < 0) {
        start = mid(points[points.length - 1], points[0]);
        ordered = points;
    } else {
        start = points[first];
        ordered = [...points.slice(first + 1), ...points.slice(0, first)];
    }
    let d = `M${num(start.x)} ${num(start.y)}`;
    let control;
    for (const point of [...ordered, start]) {
        if (point.on) {
            d +=
                control ?
                    `Q${num(control.x)} ${num(control.y)} ${num(point.x)} ${num(point.y)}`
                :   `L${num(point.x)} ${num(point.y)}`;
            control = undefined;
        } else if (control) {
            const between = mid(control, point);
            d += `Q${num(control.x)} ${num(control.y)} ${num(between.x)} ${num(between.y)}`;
            control = point;
        } else control = point;
    }
    return `${d}Z`;
}

/**
 * The outlines of a TrueType face, read once per file.
 *
 * @param {string} file - The `.ttf`.
 * @returns {Outlines} Its outlines.
 * @throws {Error} When the file is not a TrueType face with outlines.
 */
export function fontOutlines(file) {
    const known = cache.get(file);
    if (known) return known;
    const buf = fs.readFileSync(file);
    const tables = tableDirectory(buf);
    for (const tag of ["head", "maxp", "hhea", "hmtx", "loca", "glyf", "cmap"])
        if (!tables.has(tag))
            throw new Error(
                `${file}: error: the face has no \`${tag}\` table to draw a scroll from`,
            );
    const head = /** @type {{offset: number}} */ (tables.get("head")).offset;
    const unitsPerEm = buf.readUInt16BE(head + 18);
    const longOffsets = buf.readInt16BE(head + 50) === 1;
    const numGlyphs = buf.readUInt16BE(
        /** @type {{offset: number}} */ (tables.get("maxp")).offset + 4,
    );
    const hhea = /** @type {{offset: number}} */ (tables.get("hhea")).offset;
    const ascender = buf.readInt16BE(hhea + 4);
    const descender = buf.readInt16BE(hhea + 6);
    const hMetrics = buf.readUInt16BE(hhea + 34);
    const hmtx = /** @type {{offset: number}} */ (tables.get("hmtx")).offset;
    const loca = /** @type {{offset: number}} */ (tables.get("loca")).offset;
    const glyf = /** @type {{offset: number}} */ (tables.get("glyf")).offset;
    const vhea = tables.get("vhea");
    const vmtx = tables.get("vmtx");
    const vMetrics = vhea && vmtx ? buf.readUInt16BE(vhea.offset + 34) : 0;
    const span = (index) =>
        index >= numGlyphs ? [0, 0]
        : longOffsets ? [buf.readUInt32BE(loca + index * 4), buf.readUInt32BE(loca + index * 4 + 4)]
        : [buf.readUInt16BE(loca + index * 2) * 2, buf.readUInt16BE(loca + index * 2 + 2) * 2];
    const glyphs = codepointGlyphs(buf, /** @type {{offset: number}} */ (tables.get("cmap")));
    /** @type {Map<number, Glyph>} */
    const drawn = new Map();
    const glyphOf = (index) => {
        const had = drawn.get(index);
        if (had) return had;
        const advance = buf.readUInt16BE(hmtx + Math.min(index, hMetrics - 1) * 4);
        const [from, to] = span(index);
        const yMax = to > from ? buf.readInt16BE(glyf + from + 8) : 0;
        let top;
        if (vmtx && vMetrics) {
            const tsb =
                index < vMetrics ?
                    buf.readInt16BE(vmtx.offset + index * 4 + 2)
                :   buf.readInt16BE(vmtx.offset + vMetrics * 4 + (index - vMetrics) * 2);
            top = yMax + tsb;
        } else top = ascender + (unitsPerEm - (ascender - descender)) / 2;
        const glyph = {
            index,
            d: contours(buf, glyf, span, index).map(contourPath).join(""),
            advance,
            top,
        };
        drawn.set(index, glyph);
        return glyph;
    };
    const outlines = {
        unitsPerEm,
        glyph: (point) => {
            const index = glyphs.get(point);
            return index === undefined ? undefined : glyphOf(index);
        },
    };
    cache.set(file, outlines);
    return outlines;
}

/** The book's rubric red, which its preamble names `book-rubric`. */
export const BOOK_RUBRIC = "#9c281b";

/** The book's ink, which its preamble names `book-ink`. */
export const BOOK_INK = "#241f1a";

/** The colour of plain text and of text set in the rubric. */
const INK = Object.freeze({ plain: BOOK_INK, rubric: BOOK_RUBRIC });

/**
 * One panel of a scroll as SVG: its columns read from the right, `rows` ems
 * tall, each character centred in its column, in red where it is set in the
 * rubric and with a line beside it, on the right, where it is overlined.
 *
 * @param {import("./content-scroll.mjs").ScrollCell[][]} panel - Its columns,
 *   the first the rightmost.
 * @param {number} rows - The characters in a column.
 * @param {Outlines} outlines - The face.
 * @returns {string} The SVG.
 */
export function scrollPanelSvg(panel, rows, outlines) {
    const em = outlines.unitsPerEm;
    const pitch = SCROLL_PITCH * em;
    const width = panel.length * pitch;
    const height = rows * em;
    const defs = new Map();
    const marks = [];
    panel.forEach((column, at) => {
        const centre = width - (at + 0.5) * pitch;
        column.forEach((cell, row) => {
            const cellTop = row * em;
            if (cell.emphasis === "overline")
                marks.push(
                    `<rect x="${num(centre + 0.55 * em)}" y="${num(cellTop)}" width="${num(0.05 * em)}" height="${num(em)}" fill="${INK.plain}"/>`,
                );
            const point = cell.text.codePointAt(0);
            if (point === undefined || /\s/u.test(cell.text)) return;
            const glyph = outlines.glyph(point);
            if (!glyph?.d) return;
            defs.set(glyph.index, `<path id="g${glyph.index}" d="${glyph.d}"/>`);
            marks.push(
                `<use href="#g${glyph.index}" x="${num(centre - glyph.advance / 2)}" y="${num(cellTop + glyph.top)}" fill="${cell.emphasis === "rubric" ? INK.rubric : INK.plain}"/>`,
            );
        });
    });
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}">` +
        `<defs>${[...defs.values()].join("")}</defs>${marks.join("")}</svg>`
    );
}
