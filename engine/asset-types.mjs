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
