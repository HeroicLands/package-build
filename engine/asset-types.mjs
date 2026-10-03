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
 * The asset types — `icon`, `image` and `audio` — and the three roots they are
 * walked from.
 *
 * An asset is addressed exactly as a note is: `<package>-none-<type>-<shortcode>`.
 * What differs is where the address comes from. A note declares its own `type:`
 * in frontmatter, so no directory has to; a `.webp` carries no frontmatter and
 * has nowhere to say what it is, which is why the **root supplies the type** and
 * the list of roots is closed. A directory under `assets/` that is not one of
 * them declares nothing, so nothing in it is addressable — `assets/ui` falls out
 * of that rule rather than needing an exemption.
 *
 * **Extension decides whether a file is an asset; root decides its type.** The
 * filter is load-bearing rather than tidy-minded: `provenance.yaml` files live
 * *inside* these roots at any depth, so a walk that took every file would read
 * attribution records as assets.
 *
 * **Beneath the root the layout is arbitrary.** The filename is the shortcode
 * and the directories above it are the package's own business, so a tree may be
 * rearranged wholesale without a reference changing. A root's shortcodes are one
 * flat namespace however deeply it nests, which is why two files under one root
 * sharing a basename are two claims on one address.
 *
 * **A font is not one of these.** An asset type exists so a note can name a file
 * and a package can substitute it, and a font answers to neither half: a
 * stylesheet names a file with `url()` and the book names a *family*, so neither
 * consumer could use an address. `assets/fonts` is not a root.
 *
 * This module is a **leaf** — `engine/address-charset.mjs` is the whole of its
 * dependency — so the configuration validator and the content index can both
 * name it without closing a cycle.
 *
 * @module
 */

import fs from "node:fs";

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";

/**
 * The `<system>` segment every asset address carries.
 *
 * Spelled here rather than imported from `engine/systems.mjs` so this module
 * stays a leaf. The two are held to one value by the address round-trip guard,
 * which reads both.
 *
 * @type {string}
 */
export const ASSET_SYSTEM = "none";

/**
 * File extensions that make a file a picture, lowercase and dot-led.
 *
 * Foundry's own `IMAGE_FILE_EXTENSIONS`, because these files are installed into
 * a Foundry data directory and a format Foundry will not display is not one this
 * toolchain should hand it an address for.
 *
 * @type {readonly string[]}
 */
export const IMAGE_EXTENSIONS = Object.freeze([
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".tiff",
    ".webp",
]);

/**
 * File extensions that make a file a sound, lowercase and dot-led.
 *
 * Foundry's own `AUDIO_FILE_EXTENSIONS`, for the reason above.
 *
 * @type {readonly string[]}
 */
export const AUDIO_EXTENSIONS = Object.freeze([
    ".aac",
    ".flac",
    ".m4a",
    ".mid",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
]);

/**
 * One asset type: what it is called, which directory holds it, and which files
 * in that directory are assets of it.
 *
 * @typedef {object} AssetType
 * @property {string} type - The type name, and the third segment of an address.
 * @property {string} root - The directory below `paths.assets` that holds it.
 * @property {readonly string[]} extensions - Lowercase, dot-led.
 * @property {string} describe - One line, for the author-facing reference.
 */

/**
 * The three asset types, in address order.
 *
 * The directory is named for what it holds and the type for what an address
 * reaches, so the two differ by a letter and the mapping is **declared** rather
 * than derived from the name.
 *
 * `icon` and `image` are two types rather than one because an icon has to stay
 * coherent drawn into a 32×32 slot while an image is unbounded — a fitness
 * property of the asset itself. They therefore have separate shortcode
 * namespaces, and `icon-anvil` and `image-anvil` are different addresses.
 *
 * @type {readonly AssetType[]}
 */
export const ASSET_TYPES = Object.freeze([
    Object.freeze({
        type: "audio",
        root: "audio",
        extensions: AUDIO_EXTENSIONS,
        describe: "A sound clip — an ambient loop, an effect.",
    }),
    Object.freeze({
        type: "icon",
        root: "icons",
        extensions: IMAGE_EXTENSIONS,
        describe: "A picture that stays legible drawn into a 32×32 slot.",
    }),
    Object.freeze({
        type: "image",
        root: "images",
        extensions: IMAGE_EXTENSIONS,
        describe: "A picture of unbounded size — a portrait, a map, a banner.",
    }),
]);

/**
 * Every asset type name.
 *
 * @type {ReadonlySet<string>}
 */
export const ASSET_TYPE_NAMES = Object.freeze(new Set(ASSET_TYPES.map((entry) => entry.type)));

/**
 * Whether a type name addresses a file rather than a note.
 *
 * The one test the rewrite scoping rests on: a rewrite rule may substitute an
 * asset and nothing else, so a fourth asset type is covered by this answer
 * rather than by editing a list somewhere else.
 *
 * @param {unknown} type - The type name.
 * @returns {boolean} True for `icon`, `image` or `audio`.
 */
export function isAssetType(type) {
    return typeof type === "string" && ASSET_TYPE_NAMES.has(type.toLowerCase());
}

/**
 * The asset type a root directory declares, or `undefined`.
 *
 * @param {unknown} root - A directory name below `paths.assets`.
 * @returns {AssetType|undefined} The type it holds.
 */
export function assetTypeOfRoot(root) {
    return ASSET_TYPES.find((entry) => entry.root === root);
}

/**
 * Whether a filename can be an address at all.
 *
 * A shortcode is lowercase alphanumerics, so a version string, a hyphen or a
 * date stamp in a basename means the file cannot be addressed. The build says so
 * rather than inventing a shortcode for it.
 *
 * @param {string} shortcode - The basename with its extension removed.
 * @returns {boolean} Whether it matches {@link ADDRESS_SEGMENT_PATTERN}.
 */
export function isAssetShortcode(shortcode) {
    return typeof shortcode === "string" && ADDRESS_SEGMENT_PATTERN.test(shortcode);
}

/**
 * The PNG (and APNG, which shares the signature) header.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function pngDimensions(bytes) {
    if (bytes.length < 24) return undefined;
    if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") return undefined;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * The GIF header's logical screen size.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function gifDimensions(bytes) {
    if (bytes.length < 10) return undefined;
    const signature = bytes.toString("ascii", 0, 6);
    if (signature !== "GIF87a" && signature !== "GIF89a") return undefined;
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * The BMP header's size, carried as a signed value so a bottom-up bitmap's
 * negative height still reads as a pixel count.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function bmpDimensions(bytes) {
    if (bytes.length < 26) return undefined;
    if (bytes.toString("ascii", 0, 2) !== "BM") return undefined;
    return {
        width: Math.abs(bytes.readInt32LE(18)),
        height: Math.abs(bytes.readInt32LE(22)),
    };
}

/**
 * The size a JPEG's first SOF (start-of-frame) segment states, found by
 * walking its markers rather than assuming a fixed offset — a JPEG carries an
 * arbitrary run of metadata segments before the frame header.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function jpegDimensions(bytes) {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return undefined;
    let pos = 2;
    while (pos + 1 < bytes.length) {
        if (bytes[pos] !== 0xff) return undefined;
        const marker = bytes[pos + 1];
        pos += 2;
        // TEM and the restart markers carry no segment length; EOI ends the
        // stream with no frame header found.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (marker === 0xd9) return undefined;
        if (pos + 2 > bytes.length) return undefined;
        const length = bytes.readUInt16BE(pos);
        const isStartOfFrame =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc;
        if (isStartOfFrame) {
            if (pos + 7 > bytes.length) return undefined;
            return { height: bytes.readUInt16BE(pos + 3), width: bytes.readUInt16BE(pos + 5) };
        }
        pos += length;
    }
    return undefined;
}

/**
 * A WebP file's size, read from whichever of the three chunk layouts the
 * format defines — the plain lossy frame, the lossless bitstream, or the
 * extended header a file with alpha, animation or metadata carries instead.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function webpDimensions(bytes) {
    if (bytes.length < 30) return undefined;
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
        return undefined;
    }
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8 ") {
        return {
            width: bytes.readUInt16LE(26) & 0x3fff,
            height: bytes.readUInt16LE(28) & 0x3fff,
        };
    }
    if (chunk === "VP8L") {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
        return {
            width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
            height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
        };
    }
    return undefined;
}

/**
 * A TIFF's `ImageWidth`/`ImageLength` tags, read from its first IFD in
 * whichever byte order the file's own header declares.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function tiffDimensions(bytes) {
    if (bytes.length < 8) return undefined;
    const order = bytes.toString("ascii", 0, 2);
    let little;
    if (order === "II") little = true;
    else if (order === "MM") little = false;
    else return undefined;
    const u16 = (offset) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
    const u32 = (offset) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
    if (u16(2) !== 42) return undefined;
    const ifd = u32(4);
    if (ifd + 2 > bytes.length) return undefined;
    const entryCount = u16(ifd);
    let width;
    let height;
    for (let i = 0; i < entryCount && (width === undefined || height === undefined); i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) break;
        const tag = u16(entry);
        if (tag !== 256 && tag !== 257) continue;
        // SHORT (type 3) values sit in the first two bytes of the value
        // field; LONG (type 4) occupies all four, so only the width in that
        // field differs by type.
        const type = u16(entry + 2);
        const value = type === 3 ? u16(entry + 8) : u32(entry + 8);
        if (tag === 256) width = value;
        else height = value;
    }
    return width !== undefined && height !== undefined ? { width, height } : undefined;
}

/**
 * An AVIF's declared size, read from the first `ispe` (Image Spatial
 * Extents) property its ISOBMFF container carries, by walking box headers
 * down through `meta` → `iprp` → `ipco` rather than assuming a fixed layout.
 *
 * @param {Buffer} bytes
 * @returns {{width: number, height: number}|undefined}
 */
function avifDimensions(bytes) {
    /** @type {{width: number, height: number}|undefined} */
    let found;
    const walk = (start, end) => {
        let pos = start;
        while (!found && pos + 8 <= end) {
            const size = bytes.readUInt32BE(pos);
            if (size < 8) return;
            const type = bytes.toString("ascii", pos + 4, pos + 8);
            const dataStart = pos + 8;
            const dataEnd = Math.min(pos + size, end);
            if (type === "meta") {
                // `meta` is a full box: four bytes of version and flags
                // precede its own nested boxes.
                walk(dataStart + 4, dataEnd);
            } else if (type === "iprp" || type === "ipco") {
                walk(dataStart, dataEnd);
            } else if (type === "ispe" && dataEnd - dataStart >= 12) {
                found = {
                    width: bytes.readUInt32BE(dataStart + 4),
                    height: bytes.readUInt32BE(dataStart + 8),
                };
            }
            pos += size;
        }
    };
    walk(0, bytes.length);
    return found;
}

/**
 * The pixel dimensions a raster image's own header states.
 *
 * Read from the file's bytes directly rather than through a decoder, so a
 * corrupt or partial file fails closed — the same `undefined` answer as a
 * format this carries no reader for — instead of throwing out of the asset
 * walk. An SVG has no pixel dimensions to read; stating one would be a
 * fabricated viewBox reading rather than a fact about the file.
 *
 * @param {string} absPath - The file's absolute path.
 * @param {string} ext - Its extension, lowercase and dot-led.
 * @returns {{width: number, height: number}|undefined} The declared size, or
 *   `undefined` when the format carries none, or the header cannot be read.
 */
export function imageDimensions(absPath, ext) {
    if (ext === ".svg") return undefined;
    const reader = IMAGE_DIMENSION_READERS[ext];
    if (!reader) return undefined;
    let bytes;
    try {
        bytes = fs.readFileSync(absPath);
    } catch {
        return undefined;
    }
    try {
        return reader(bytes);
    } catch {
        // A header this short or this malformed to parse is the same answer
        // as one this reads no format for: the dimensions stay blank.
        return undefined;
    }
}

/**
 * The dimension reader for each raster extension {@link IMAGE_EXTENSIONS}
 * declares, `.svg` excepted — it has no pixel dimensions, handled above
 * rather than entered here.
 *
 * @type {Readonly<Record<string, (bytes: Buffer) => ({width: number, height: number}|undefined)>>}
 */
const IMAGE_DIMENSION_READERS = Object.freeze({
    ".png": pngDimensions,
    ".apng": pngDimensions,
    ".gif": gifDimensions,
    ".bmp": bmpDimensions,
    ".jpg": jpegDimensions,
    ".jpeg": jpegDimensions,
    ".webp": webpDimensions,
    ".tiff": tiffDimensions,
    ".avif": avifDimensions,
});
