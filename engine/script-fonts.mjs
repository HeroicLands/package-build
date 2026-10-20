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
 * **The faces a consumer installed.** `@heroiclands/fonts` owns the facts
 * about its faces — family, class, direction, features and the code points
 * each one draws — in its `fonts.json`, and this module reads them from the
 * **consuming package's** install.
 *
 * package-build declares no dependency on `@heroiclands/fonts` in any field:
 * the fonts package depends on package-build to build, so the consumer adds it
 * as a devDependency of its own and package-build resolves it from the
 * consumer's root. Resolving from this module's own location would find
 * whatever happens to sit above package-build's install, or nothing.
 *
 * @module
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** The npm name of the fonts package. */
export const FONTS_PACKAGE = "@heroiclands/fonts";

/** The manifest the fonts package publishes at its root. */
export const FONTS_MANIFEST = "fonts.json";

/**
 * One code point a face draws, as `fonts.json` lists it.
 *
 * @typedef {object} FaceCodepoint
 * @property {string} codepoint - `U+` and the hexadecimal code point.
 * @property {string} glyph - The glyph's name in the face.
 * @property {string} kind - What it is: `letter`, `numeral`, `mark` and so on.
 */

/**
 * One entry of `fonts.json`.
 *
 * @typedef {object} FontEntry
 * @property {string} [name] - Its unique key; `family` when absent.
 * @property {string} family - The CSS and Typst font family.
 * @property {string} class - The class that sets text in it, `hl-<slug>`.
 * @property {Record<string, string>} files - Its font files, by format.
 * @property {string} direction - `ltr` or `rtl`.
 * @property {string[]} features - OpenType features it turns on.
 * @property {FaceCodepoint[]} [codepoints] - Every code point it draws.
 */

/**
 * A face as a run reads it.
 *
 * @typedef {object} Face
 * @property {string} slug - What `font=` names it by: its class without `hl-`.
 * @property {string} family - The CSS and Typst font family.
 * @property {string} class - The class that sets text in it.
 * @property {string} direction - `ltr` or `rtl`.
 * @property {string[]} features - OpenType features it turns on.
 * @property {ReadonlySet<number>} draws - Every code point it draws.
 */

/**
 * The installed fonts package, as a consumer sees it.
 *
 * @typedef {object} ScriptFonts
 * @property {string} root - The package's directory.
 * @property {string} version - Its `package.json` version.
 * @property {{families: FontEntry[]}|undefined} manifest - Its `fonts.json`,
 *   `undefined` when the installed version ships none.
 * @property {Map<string, Face>} faces - Each face by its slug, in manifest
 *   order; empty without a manifest.
 */

/**
 * The slug `font=` names a face by: its class without the `hl-` prefix.
 *
 * @param {FontEntry} entry - A `fonts.json` entry.
 * @returns {string|undefined} The slug, or `undefined` for an entry with no class.
 */
export function faceSlug(entry) {
    const name = typeof entry?.class === "string" ? entry.class : "";
    return name ? name.replace(/^hl-/, "") : undefined;
}

/**
 * The code point a `U+XXXX` string names.
 *
 * @param {unknown} value - The listed code point.
 * @returns {number|undefined} The code point, or `undefined` when it names none.
 */
function codepointOf(value) {
    const match = /^U\+([0-9A-Fa-f]{4,6})$/.exec(String(value ?? ""));
    return match ? Number.parseInt(match[1], 16) : undefined;
}

/**
 * The fonts package the consumer at `rootDir` installed.
 *
 * @param {string} rootDir - The consuming package's root, holding its
 *   `package.json`.
 * @returns {ScriptFonts|undefined} The package, or `undefined` when the
 *   consumer has not installed it.
 * @throws {Error} When the installed `fonts.json` is not readable JSON, or
 *   holds no `families` list.
 */
export function resolveScriptFonts(rootDir) {
    const require = createRequire(path.join(rootDir, "package.json"));
    let packageJson;
    try {
        packageJson = require.resolve(`${FONTS_PACKAGE}/package.json`);
    } catch (err) {
        if (/** @type {{code?: string}} */ (err)?.code === "MODULE_NOT_FOUND") return undefined;
        throw err;
    }
    const root = path.dirname(packageJson);
    const { version } = JSON.parse(fs.readFileSync(packageJson, "utf8"));

    const manifestFile = path.join(root, FONTS_MANIFEST);
    let manifest;
    if (fs.existsSync(manifestFile)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        } catch (err) {
            throw new Error(
                `${manifestFile}: error: ${FONTS_PACKAGE} ${version} ships a ` +
                    `${FONTS_MANIFEST} that is not readable JSON: ${/** @type {Error} */ (err).message}`,
                { cause: err },
            );
        }
        if (!Array.isArray(manifest?.families)) {
            throw new Error(
                `${manifestFile}: error: ${FONTS_PACKAGE} ${version} ships a ` +
                    `${FONTS_MANIFEST} with no \`families\` list`,
            );
        }
    }

    const faces = new Map();
    for (const entry of manifest?.families ?? []) {
        const slug = faceSlug(entry);
        if (!slug || faces.has(slug)) continue;
        const draws = new Set();
        for (const listed of entry.codepoints ?? []) {
            const point = codepointOf(listed?.codepoint);
            if (point !== undefined) draws.add(point);
        }
        faces.set(
            slug,
            Object.freeze({
                slug,
                family: entry.family,
                class: entry.class,
                direction: entry.direction === "rtl" ? "rtl" : "ltr",
                features: Object.freeze([...(entry.features ?? [])]),
                draws,
            }),
        );
    }

    return { root, version, manifest, faces };
}
