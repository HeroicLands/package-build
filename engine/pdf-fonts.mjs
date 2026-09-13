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
 * Which glyph an icon name resolves to, read from the font that carries it.
 *
 * {@link module:engine/content-icons} states an icon's family and its name and
 * **deliberately holds no codepoints**: writing them out by hand would be a
 * second copy of a table the font already owns, wrong the first time the icon
 * set renumbers anything, and wrong silently. So the renderer resolves a name
 * against the file it is going to embed, which is this module.
 *
 * ## Two tables, joined
 *
 * A TrueType font answers "what is this glyph called" and "what codepoint
 * reaches it" in different places, and neither alone is enough:
 *
 * - **`post`**, format 2.0, maps every glyph index to a name — `star`,
 *   `pen-to-square`. That is the half that knows what an author meant.
 * - **`cmap`** maps codepoints to glyph indices. That is the half Typst needs,
 *   because a document selects a glyph by writing a character.
 *
 * Reading `post` for the index and inverting `cmap` to get back to a codepoint
 * is the whole algorithm. Formats 4 and 12 are both read: an icon font that
 * outgrew the Basic Multilingual Plane uses 12, and the older sets use 4.
 *
 * ## Nothing here fails a build
 *
 * A font that cannot be read, or a name it does not carry, is a **finding** and
 * the icon falls back to its literal `:icon-…:` text. That is the failure mode
 * {@link module:engine/content-icons} was designed around — visible on the
 * page, where an author is looking — and it is strictly better than a tofu box
 * or a silently missing glyph.
 *
 * @module
 */

import fs from "node:fs";

import { familyOf } from "./content-icons.mjs";

/**
 * The tables an sfnt file holds, by tag.
 *
 * @param {Buffer} buf - The font file.
 * @returns {Map<string, {offset: number, length: number}>} Its table directory.
 */
function tableDirectory(buf) {
    const tables = new Map();
    if (buf.length < 12) return tables;
    // A TrueType collection points at its first font; a bare font starts at 0.
    let base = 0;
    if (buf.toString("ascii", 0, 4) === "ttcf") {
        if (buf.length < 16) return tables;
        base = buf.readUInt32BE(12);
    }
    if (buf.length < base + 12) return tables;
    const numTables = buf.readUInt16BE(base + 4);
    for (let i = 0; i < numTables; i += 1) {
        const rec = base + 12 + i * 16;
        if (rec + 16 > buf.length) break;
        tables.set(buf.toString("ascii", rec, rec + 4), {
            offset: buf.readUInt32BE(rec + 8),
            length: buf.readUInt32BE(rec + 12),
        });
    }
    return tables;
}

/**
 * The 258 names a `post` table may refer to by index without spelling them out.
 *
 * This is the standard Macintosh glyph ordering, fixed by the OpenType `post`
 * specification: an index below 258 names a glyph from this list rather than
 * from the font's own string pool. It is data, not a guess, and it is here in
 * full rather than truncated to the entries an icon set happens to use — a
 * lookup that silently returned nothing for `A` would be the quiet kind of
 * wrong this toolchain exists to refuse.
 *
 * @type {readonly string[]}
 */
const MAC_GLYPH_NAMES = Object.freeze(
    (
        ".notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent " +
        "ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash " +
        "zero one two three four five six seven eight nine colon semicolon less equal greater " +
        "question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash " +
        "bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v " +
        "w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde " +
        "Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute " +
        "egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve " +
        "ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent " +
        "sterling section bullet paragraph germandbls registered copyright trademark acute " +
        "dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu " +
        "partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash " +
        "questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft " +
        "guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash " +
        "quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis " +
        "fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered " +
        "quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis " +
        "Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute " +
        "Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla " +
        "hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth " +
        "Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf " +
        "onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute " +
        "cacute Ccaron ccaron dcroat"
    ).split(" "),
);

/**
 * Glyph index → name, from a `post` table of format 2.0.
 *
 * @param {Buffer} buf - The font file.
 * @param {{offset: number, length: number}} table - The `post` record.
 * @returns {Map<number, string>} Names by glyph index.
 */
function glyphNames(buf, table) {
    const names = new Map();
    const at = table.offset;
    if (at + 34 > buf.length) return names;
    if (buf.readUInt32BE(at) !== 0x0002_0000) return names;
    const numGlyphs = buf.readUInt16BE(at + 32);
    const indexAt = at + 34;
    if (indexAt + numGlyphs * 2 > buf.length) return names;

    // The pascal strings follow the index array, in order, and are addressed by
    // ordinal rather than by offset — so they have to be read in one pass.
    const custom = [];
    let p = indexAt + numGlyphs * 2;
    while (p < at + table.length && p < buf.length) {
        const len = buf.readUInt8(p);
        custom.push(buf.toString("latin1", p + 1, p + 1 + len));
        p += 1 + len;
    }

    for (let g = 0; g < numGlyphs; g += 1) {
        const idx = buf.readUInt16BE(indexAt + g * 2);
        if (idx < 258) {
            if (idx < MAC_GLYPH_NAMES.length) names.set(g, MAC_GLYPH_NAMES[idx]);
            continue;
        }
        const name = custom[idx - 258];
        if (name) names.set(g, name);
    }
    return names;
}

/**
 * Whether a codepoint is in a Private Use Area.
 *
 * All three: the BMP block and the two supplementary planes, because an icon
 * set large enough to have outgrown `U+E000`–`U+F8FF` moves to plane 15.
 *
 * @param {number} cp - A codepoint.
 * @returns {boolean} Whether it is private use.
 */
function isPrivateUse(cp) {
    return (
        (cp >= 0xe000 && cp <= 0xf8ff) ||
        (cp >= 0xf_0000 && cp <= 0xf_fffd) ||
        (cp >= 0x10_0000 && cp <= 0x10_fffd)
    );
}

/**
 * Glyph index → the codepoint a document should write to reach it.
 *
 * **The Private Use Area address wins when the font offers one.** An icon set
 * routinely maps one glyph twice: at a PUA codepoint that is its own, and at a
 * real Unicode character that merely looks like it. Font Awesome's `star` is at
 * both `U+F005` and `U+2B50`, its `xmark` at both `U+F00D` and `U+00D7`.
 *
 * Writing the real character would *look* right in a test and fail in a book:
 * `U+2B50` is the emoji star, so the moment font fallback engages — a weight the
 * icon font does not ship, a viewer substituting a face — the page gets a colour
 * emoji or a multiplication sign instead of the icon. A PUA codepoint is
 * unassigned by definition, so nothing but the font named alongside it can
 * satisfy it, and a substitution becomes a visible missing glyph rather than a
 * plausible wrong one.
 *
 * @param {Buffer} buf - The font file.
 * @param {{offset: number}} table - The `cmap` record.
 * @returns {Map<number, number>} Codepoints by glyph index.
 */
function glyphCodepoints(buf, table) {
    const out = new Map();
    const at = table.offset;
    if (at + 4 > buf.length) return out;
    const numTables = buf.readUInt16BE(at + 2);

    /**
     * Record a mapping, keeping the lowest codepoint per glyph.
     *
     * @param {number} glyph - The glyph index.
     * @param {number} cp - A codepoint reaching it.
     */
    const record = (glyph, cp) => {
        if (!glyph) return;
        const seen = out.get(glyph);
        if (seen === undefined) {
            out.set(glyph, cp);
            return;
        }
        // A PUA address displaces a non-PUA one; between two of a kind the
        // lower wins, so the result does not depend on table order.
        const had = isPrivateUse(seen);
        const has = isPrivateUse(cp);
        if (has && !had) out.set(glyph, cp);
        else if (has === had && cp < seen) out.set(glyph, cp);
    };

    for (let i = 0; i < numTables; i += 1) {
        const rec = at + 4 + i * 8;
        if (rec + 8 > buf.length) break;
        const sub = at + buf.readUInt32BE(rec + 4);
        if (sub + 4 > buf.length) continue;
        const format = buf.readUInt16BE(sub);

        if (format === 4) {
            const segX2 = buf.readUInt16BE(sub + 6);
            const segs = segX2 / 2;
            const endAt = sub + 14;
            const startAt = endAt + segX2 + 2;
            const deltaAt = startAt + segX2;
            const rangeAt = deltaAt + segX2;
            if (rangeAt + segX2 > buf.length) continue;
            for (let s = 0; s < segs; s += 1) {
                const end = buf.readUInt16BE(endAt + s * 2);
                const start = buf.readUInt16BE(startAt + s * 2);
                const delta = buf.readInt16BE(deltaAt + s * 2);
                const rangeOffset = buf.readUInt16BE(rangeAt + s * 2);
                if (start === 0xffff) continue;
                for (let cp = start; cp <= end && cp !== 0x1_0000; cp += 1) {
                    let glyph;
                    if (rangeOffset === 0) {
                        glyph = (cp + delta) & 0xffff;
                    } else {
                        const gAt = rangeAt + s * 2 + rangeOffset + (cp - start) * 2;
                        if (gAt + 2 > buf.length) continue;
                        glyph = buf.readUInt16BE(gAt);
                        if (glyph) glyph = (glyph + delta) & 0xffff;
                    }
                    record(glyph, cp);
                }
            }
        } else if (format === 12) {
            const groups = buf.readUInt32BE(sub + 12);
            for (let g = 0; g < groups; g += 1) {
                const rowAt = sub + 16 + g * 12;
                if (rowAt + 12 > buf.length) break;
                const start = buf.readUInt32BE(rowAt);
                const end = buf.readUInt32BE(rowAt + 4);
                const startGlyph = buf.readUInt32BE(rowAt + 8);
                // A single group may legitimately span a plane; the cap keeps a
                // corrupt table from turning into an unbounded loop.
                const last = Math.min(end, start + 0x1_0000);
                for (let cp = start; cp <= last; cp += 1) record(startGlyph + (cp - start), cp);
            }
        }
    }
    return out;
}

/**
 * Every glyph name a font carries, with the codepoint that reaches it.
 *
 * @param {string} file - Path to a `.ttf`/`.otf`.
 * @returns {Map<string, number>} Name → codepoint.
 */
export function glyphTable(file) {
    const buf = fs.readFileSync(file);
    const tables = tableDirectory(buf);
    const post = tables.get("post");
    const cmap = tables.get("cmap");
    if (!post || !cmap) return new Map();
    const names = glyphNames(buf, post);
    const points = glyphCodepoints(buf, cmap);
    const out = new Map();
    for (const [glyph, name] of names) {
        const cp = points.get(glyph);
        if (cp !== undefined && !out.has(name)) out.set(name, cp);
    }
    return out;
}

/**
 * The family name a font file announces, for Typst's `text(font: …)`.
 *
 * Read from the `name` table rather than from the file name, because the file
 * is what a consumer happened to call it and the family is what the font stack
 * will match on.
 *
 * @param {string} file - Path to a `.ttf`/`.otf`.
 * @returns {string} The family name, or "" when the table cannot be read.
 */
export function familyName(file) {
    let buf;
    try {
        buf = fs.readFileSync(file);
    } catch {
        return "";
    }
    const table = tableDirectory(buf).get("name");
    if (!table) return "";
    const at = table.offset;
    if (at + 6 > buf.length) return "";
    const count = buf.readUInt16BE(at + 2);
    const storage = at + buf.readUInt16BE(at + 4);
    let best = "";
    for (let i = 0; i < count; i += 1) {
        const rec = at + 6 + i * 12;
        if (rec + 12 > buf.length) break;
        const platform = buf.readUInt16BE(rec);
        const nameId = buf.readUInt16BE(rec + 6);
        if (nameId !== 1) continue;
        const length = buf.readUInt16BE(rec + 8);
        const offset = storage + buf.readUInt16BE(rec + 10);
        if (offset + length > buf.length) continue;
        const value =
            platform === 3 ?
                buf.toString("utf16le", offset, offset + length).replace(/\0/g, "")
            :   buf.toString("latin1", offset, offset + length);
        // Windows records (platform 3) are the ones a font stack reads, so they
        // win when a font ships both.
        if (platform === 3) return swapUtf16(buf, offset, length);
        if (!best) best = value;
    }
    return best;
}

/**
 * A big-endian UTF-16 name record, as a string.
 *
 * @param {Buffer} buf - The font file.
 * @param {number} offset - Where the record starts.
 * @param {number} length - Its byte length.
 * @returns {string} The decoded name.
 */
function swapUtf16(buf, offset, length) {
    const slice = Buffer.from(buf.subarray(offset, offset + length));
    slice.swap16();
    return slice.toString("utf16le").replace(/\0/g, "");
}

/**
 * Resolve every icon in a registry against the fonts a consumer named.
 *
 * @param {object} registry - The resolved `icons:` registry.
 * @param {Record<string, string>} iconFonts - Family name → font file.
 * @param {object[]} [findings] - Collected here rather than thrown.
 * @returns {Map<string, {font: string, codepoint: number}>} Icon name → glyph.
 */
export function resolveIconGlyphs(registry, iconFonts = {}, findings = []) {
    const out = new Map();
    const entries = Object.entries(registry?.icons ?? {});
    if (!entries.length) return out;

    const loaded = new Map();
    for (const [family, file] of Object.entries(iconFonts ?? {})) {
        try {
            loaded.set(family, {
                family: familyName(file) || family,
                table: glyphTable(file),
                file,
            });
        } catch (err) {
            findings.push({
                file,
                severity: "warning",
                message:
                    `the font named by \`pdf.iconFonts.${family}\` cannot be read ` +
                    `(${err.message}), so its icons print as their names`,
            });
        }
    }
    if (!loaded.size) return out;

    for (const [name, entry] of entries) {
        const family = familyOf(entry, registry);
        const font = loaded.get(family);
        if (!font) continue;
        // The registry's `icon` is the glyph's own name in its set; the entry's
        // key is what an author writes, and the two differ whenever a set
        // renames something.
        const glyphName = entry?.icon ?? name;
        const codepoint = font.table.get(glyphName);
        if (codepoint === undefined) {
            findings.push({
                file: font.file,
                severity: "warning",
                message:
                    `\`:icon-${name}:\` asks for glyph \`${glyphName}\`, which ` +
                    `${path0(font.file)} does not carry — it prints as its name`,
            });
            continue;
        }
        out.set(name, { font: font.family, codepoint });
    }
    return out;
}

/**
 * A font file's base name, for a diagnostic that should not carry a full path.
 *
 * @param {string} file - The path.
 * @returns {string} Its last segment.
 */
function path0(file) {
    return String(file).split("/").pop() ?? file;
}
