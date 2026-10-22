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
 * **Delivering the installed faces to each target.** A consumer that installs
 * `@heroiclands/fonts` and sets text in one of its faces, with `font=` or by a
 * language note's `data.writtenIn`, gets the fonts on the site, in the Foundry
 * module and in its books; without both, nothing ships and nothing links to it.
 *
 * - **Site and Foundry** receive `fonts.css`, listing only the WOFF2 sources,
 *   the WOFF2 files and `LICENSE`.
 * - **Books** search the package's `fonts/` directory, which holds the TTFs.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { baseStyleLayer } from "./base-styles.mjs";
import { scanRuns } from "./content-scripts.mjs";
import { FONTS_MANIFEST, resolveScriptFonts } from "./script-fonts.mjs";
import { LANGUAGE_SUBTYPE } from "./word-terms.mjs";

/**
 * Where the files land in the staged Foundry module, relative to its root.
 *
 * @type {string}
 */
export const STAGED_FONTS_DIR = "fonts/heroiclands";

/**
 * Where the files land in the site's static tree, beneath a directory per
 * version.
 *
 * @type {string}
 */
export const SITE_FONTS_DIR = "fonts/heroiclands";

/** The stylesheet the fonts package publishes at its root. */
const STYLESHEET = "fonts.css";

/** The licence the fonts package publishes at its root. */
const LICENSE = "LICENSE";

/**
 * The part of a resolved configuration delivery reads.
 *
 * @typedef {object} DeliveryConfig
 * @property {string} [rootDir] - The consuming package's root.
 * @property {{content?: string}} [paths] - Where its notes are; relative to
 *   `rootDir` unless absolute.
 * @property {Readonly<Record<string, {tag: string}>>} [languages] - Its languages.
 */

/** The faces each configuration's notes set text in, found once. */
const usedFaces = new WeakMap();

/** A note's frontmatter block. */
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * The face a language note names in `data.writtenIn`, where it is installed.
 *
 * @param {string} source - The note's file.
 * @param {import("./script-fonts.mjs").ScriptFonts} installed - The fonts package.
 * @returns {string|undefined} The face's slug.
 */
function writtenInFace(source, installed) {
    const yaml = FRONTMATTER.exec(source)?.[1];
    if (yaml === undefined) return undefined;
    let fm;
    try {
        fm = YAML.parse(yaml);
    } catch {
        return undefined;
    }
    if (fm?.type !== "skill" || String(fm.subType ?? "").toLowerCase() !== LANGUAGE_SUBTYPE)
        return undefined;
    const font = fm.data?.writtenIn?.font;
    return typeof font === "string" && installed.faces.has(font) ? font : undefined;
}

/**
 * The faces the package's notes set text in, read from the notes
 * themselves: every Markdown file under the content tree that writes `font=`
 * is scanned for its runs, and the face every language note names in
 * `data.writtenIn` counts, since a run marked with the language alone is set
 * in it.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @param {import("./script-fonts.mjs").ScriptFonts} installed - The fonts package.
 * @returns {ReadonlySet<string>} The slugs of the faces used.
 */
export function facesUsed(config, installed) {
    const known = usedFaces.get(config);
    if (known) return known;
    const used = new Set();
    const content =
        config.paths?.content && config.rootDir ?
            path.resolve(config.rootDir, config.paths.content)
        :   undefined;
    /** @param {string} dir */
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.endsWith(".md")) {
                const source = fs.readFileSync(full, "utf8");
                if (/^\s*writtenIn:/m.test(source)) {
                    const face = writtenInFace(source, installed);
                    if (face) used.add(face);
                }
                if (!/\bfont=/.test(source)) continue;
                const body = source.replace(FRONTMATTER, (frontmatter) =>
                    frontmatter.replace(/[^\r\n]/g, " "),
                );
                const ctx = { languages: config.languages ?? {}, faces: installed.faces };
                for (const run of scanRuns(body, ctx).runs)
                    if (run.font !== undefined && installed.faces.has(run.font)) used.add(run.font);
            }
        }
    };
    if (content && fs.existsSync(content)) walk(content);
    usedFaces.set(config, used);
    return used;
}

/**
 * The installed package, when this consumer is to ship it.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @returns {import("./script-fonts.mjs").ScriptFonts|undefined} The package, or
 *   `undefined` without a root, an install, a manifest, or a note that sets
 *   text in one of its faces.
 */
function delivered(config) {
    if (!config?.rootDir) return undefined;
    const installed = resolveScriptFonts(config.rootDir);
    if (!installed?.manifest) return undefined;
    return facesUsed(config, installed).size ? installed : undefined;
}

/**
 * The files a target receives, as paths relative to the fonts package root.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @param {string[]} formats - The font formats the target uses: `woff2`, `ttf`.
 * @returns {{root: string, version: string, files: string[]}|undefined} The
 *   files, sorted: `fonts.css`, `LICENSE` and every file in `fonts/` of a
 *   listed format. `undefined` when the consumer ships none.
 */
export function scriptFontFiles(config, formats) {
    const installed = delivered(config);
    if (!installed) return undefined;
    const fontsDir = path.join(installed.root, "fonts");
    const fonts =
        fs.existsSync(fontsDir) ?
            fs
                .readdirSync(fontsDir)
                .filter((name) => formats.some((format) => name.endsWith(`.${format}`)))
                .map((name) => `fonts/${name}`)
        :   [];
    const files = [STYLESHEET, LICENSE, ...fonts].filter((file) =>
        fs.existsSync(path.join(installed.root, file)),
    );
    return { root: installed.root, version: installed.version, files: files.sort() };
}

/**
 * The source list of a `src` declaration, split at its top-level commas.
 *
 * @param {string} list - The value, without `src:` and the closing `;`.
 * @returns {string[]} The sources, each with its leading whitespace.
 */
function splitSources(list) {
    const out = [];
    let depth = 0;
    let quote = "";
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        const char = list[i];
        if (quote) {
            if (char === "\\") i++;
            else if (char === quote) quote = "";
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "(") depth++;
        else if (char === ")") depth--;
        else if (char === "," && depth === 0) {
            out.push(list.slice(start, i));
            start = i + 1;
        }
    }
    out.push(list.slice(start));
    return out;
}

/** A source's `url(…)` address, unquoted, or `undefined` for a `local(…)`. */
const sourceUrl = (source) => {
    const match = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/u.exec(source);
    return match ? (match[1] ?? match[2] ?? match[3]).replace(/^\.\//u, "") : undefined;
};

/**
 * The fonts package's stylesheet as a target stages it: each `@font-face`
 * `src` lists only the files staged beside it, so no browser asks for a
 * format the target does not carry. A `local(…)` source stays, and a face
 * left with no source is dropped.
 *
 * @param {string} css - The stylesheet as the package publishes it.
 * @param {ReadonlySet<string>} staged - The staged files, relative to the
 *   stylesheet: `fonts/SemaronKuriale-Regular.woff2`.
 * @returns {string} The stylesheet to stage.
 */
export function stagedStylesheet(css, staged) {
    return css.replace(/@font-face\s*\{[^}]*\}(?:[ \t]*\r?\n)?/gu, (face) => {
        let empty = false;
        const kept = face.replace(/(\bsrc\s*:)([^;}]*)(;?)/u, (_all, key, list, end) => {
            const sources = splitSources(list).filter((source) => {
                const url = sourceUrl(source);
                return url === undefined ? source.trim() !== "" : staged.has(url);
            });
            if (!sources.length) empty = true;
            return `${key} ${sources.map((source) => source.trim()).join(", ")}${end}`;
        });
        return empty ? "" : kept;
    });
}

/**
 * Copy the delivered files into a directory, keeping their relative layout so
 * the stylesheet's `url("fonts/…")` resolves from where it lands. The
 * stylesheet is rewritten by {@link stagedStylesheet} to name only the files
 * copied with it.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @param {string} dest - The directory to fill; created when there is
 *   something to put in it.
 * @param {string[]} formats - The font formats the target uses.
 * @returns {number} How many files were written; 0 when the consumer ships none.
 */
export function copyScriptFonts(config, dest, formats) {
    const found = scriptFontFiles(config, formats);
    if (!found) return 0;
    const staged = new Set(found.files);
    for (const file of found.files) {
        const to = path.join(dest, file);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (file === STYLESHEET)
            fs.writeFileSync(
                to,
                stagedStylesheet(fs.readFileSync(path.join(found.root, file), "utf8"), staged),
            );
        else fs.copyFileSync(path.join(found.root, file), to);
    }
    return found.files.length;
}

/**
 * Whether the package ships what its manifest and stylesheet promise: the
 * stylesheet, the licence and every file the manifest lists.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @returns {{file: string, severity: "error", message: string}[]} One finding
 *   per missing file, located at the manifest; empty when the consumer ships none.
 */
export function checkScriptFonts(config) {
    const installed = delivered(config);
    if (!installed) return [];
    const manifest = path.join(installed.root, FONTS_MANIFEST);
    const wanted = new Set([STYLESHEET, LICENSE]);
    for (const entry of installed.manifest?.families ?? []) {
        for (const format of ["woff2", "ttf"]) {
            const file = entry.files?.[format];
            if (file) wanted.add(file);
        }
    }
    return [...wanted]
        .filter((file) => !fs.existsSync(path.join(installed.root, file)))
        .map((file) => ({
            file: manifest,
            severity: /** @type {const} */ ("error"),
            message:
                `@heroiclands/fonts ${installed.version} does not ship \`${file}\`, ` +
                "which the package's fonts depend on",
        }));
}

/**
 * The site param naming the stylesheet, relative to the site root.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @returns {string|undefined} The versioned address, or `undefined` when the
 *   site ships no fonts.
 */
export function siteFontsParam(config) {
    const found = scriptFontFiles(config, ["woff2"]);
    return found ? `${SITE_FONTS_DIR}/${found.version}/${STYLESHEET}` : undefined;
}

/**
 * The directory under the site's static tree that holds this version's fonts.
 *
 * @param {string} version - The fonts package's version.
 * @returns {string} The POSIX path, relative to the static tree.
 */
export function siteFontsDestination(version) {
    return `${SITE_FONTS_DIR}/${version}`;
}

/**
 * The manifest `styles`, with the fonts' stylesheet named after the base sheet.
 *
 * @param {object} options
 * @param {unknown} options.styles - The `styles` so far, base sheet included.
 * @param {"system"|"module"} options.artifact - Which artifact is shipped.
 * @param {boolean} options.delivered - Whether the module carries the fonts.
 * @returns {unknown} The `styles` to emit.
 */
export function withScriptFontStyle({ styles, artifact, delivered: carried }) {
    if (!carried) return styles;
    const list = Array.isArray(styles) ? styles : [];
    const src = `${STAGED_FONTS_DIR}/${STYLESHEET}`;
    const names = (entry) => (typeof entry === "string" ? entry : entry?.src);
    if (list.some((entry) => names(entry) === src)) return list;
    const entry = { src, layer: baseStyleLayer(artifact) };
    const baseAt = list.findIndex((item) => names(item) === "styles/package-build-base.css");
    return [...list.slice(0, baseAt + 1), entry, ...list.slice(baseAt + 1)];
}

/**
 * The directory of TTFs a book's compiler searches.
 *
 * @param {DeliveryConfig} config - The resolved configuration.
 * @returns {string|undefined} The package's `fonts/` directory, or `undefined`
 *   when the consumer ships no fonts.
 */
export function typstScriptFontPath(config) {
    const installed = delivered(config);
    return installed ? path.join(installed.root, "fonts") : undefined;
}
