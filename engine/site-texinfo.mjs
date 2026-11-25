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
 * **A package's Texinfo manuals on its site.**
 *
 * The site build looks in the package's Texinfo folder, `texinfo` under the
 * repository root unless `site.texinfo` names another. A file there ending in
 * `.texi` or `.texinfo` that holds an `@setfilename` line is a manual; a file
 * without one is an included chapter and is left to the manual that includes
 * it. Each manual is converted to split HTML by
 *
 * ```
 * texi2any --html --css-ref=<stylesheet> -c INFO_JS_DIR=../js -o <site>/texi/<name> <manual>
 * ```
 *
 * so a manual named `guide` is read at `texi/guide/` and every manual shares
 * the Info JavaScript written to `texi/js/`. The stylesheet is the site's
 * `css/texinfo.css`, or `texinfo.css` from the Texinfo folder when the package
 * has one, which is then published at `texi/texinfo.css` in its place.
 *
 * @module
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The folder searched for manuals when `site.texinfo` is not declared. */
export const TEXINFO_FOLDER = "texinfo";

/** The site's own Texinfo stylesheet, relative to the site. */
export const TEXINFO_STYLESHEET = "css/texinfo.css";

/** The package's stylesheet in the Texinfo folder, which replaces the site's. */
export const TEXINFO_OVERRIDE = "texinfo.css";

/** The folder of the site output the manuals are written under. */
export const TEXINFO_OUTPUT = "texi";

const SOURCE = /\.(?:texi|texinfo)$/;
const MASTER = /^@setfilename\b/m;
const MANUAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_NAMES = new Set(["js"]);

/** The most a single conversion may run before it is stopped, in milliseconds. */
export const TEXINFO_TIMEOUT = 300_000;

// What texi2any prints: `file:line: warning: text`, `file:line: text` for an
// error, `file:line:column: ...` where it has a column, and `texi2any: text` or
// `file.texi: text` where it has no line.
const LOCATED_LINE = /^(.+?):(\d+):(?: (\d+):)? (?:(warning|error): )?(.*)$/;
const PROGRAM_LINE = /^(?:texi2any|makeinfo): (?:(warning|error): )?(.*)$/;
const FILE_LINE = /^(\S+\.(?:texi|texinfo|txi)): (?:(warning|error): )?(.*)$/;
const IMAGE_SOURCE = /<img\b[^>]*?\ssrc="([^"]+)"/g;

/**
 * Find the manuals under a folder.
 *
 * @param {string} folder - The Texinfo folder, absolute.
 * @returns {{file: string, name: string}[]} Each manual's absolute path and its
 *   name, which is the file name without its extension, in path order.
 */
export function findTexinfoManuals(folder) {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
    const found = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (SOURCE.test(entry.name) && MASTER.test(fs.readFileSync(file, "utf8")))
                found.push({ file, name: entry.name.replace(SOURCE, "") });
        }
    };
    walk(folder);
    return found.sort((a, b) =>
        a.file < b.file ? -1
        : a.file > b.file ? 1
        : 0,
    );
}

/**
 * The arguments `texi2any` is run with for one manual.
 *
 * @param {object} options - The inputs.
 * @param {string} options.manual - The manual's path.
 * @param {string} options.output - The directory the HTML is written to.
 * @param {string} options.stylesheet - The stylesheet's URL.
 * @returns {string[]} The arguments.
 */
export function texinfoArguments({ manual, output, stylesheet }) {
    return ["--html", `--css-ref=${stylesheet}`, "-c", "INFO_JS_DIR=../js", "-o", output, manual];
}

/**
 * Convert a package's Texinfo manuals into its site.
 *
 * @param {object} options - The inputs.
 * @param {object} options.config - The resolved configuration.
 * @param {string} options.out - The package's directory of the site output.
 * @param {string} options.base - The path the package is served at, beginning
 *   and ending with `/`.
 * @param {(command: string, args: string[], options: object) => {error?: Error,
 *   status: number|null, stdout?: string, stderr?: string}} [options.run] -
 *   How a program is run; `spawnSync` unless a test supplies its own.
 * @returns {{manuals: {name: string, dir: string}[], findings: object[]}} The
 *   manuals written, and a finding for each problem. A package with no manuals
 *   yields neither and touches nothing.
 */
export function buildTexinfo({ config, out, base, run = spawnSync }) {
    const folderName = config.site.texinfo || TEXINFO_FOLDER;
    const folder = path.resolve(config.rootDir, folderName);
    const manuals = findTexinfoManuals(folder);
    const findings = [];
    if (!manuals.length) return { manuals: [], findings };

    const fail = (file, message, line = 1) =>
        findings.push({ file, line, column: 1, severity: "error", message });
    const shown = (file) => path.relative(process.cwd(), file) || file;

    const seen = new Map();
    for (const manual of manuals) {
        const folded = manual.name.toLowerCase();
        if (!MANUAL_NAME.test(manual.name) || RESERVED_NAMES.has(folded))
            fail(
                shown(manual.file),
                `the manual name \`${manual.name}\` is not usable: a name begins with a letter or digit, holds only letters, digits, dots, underscores and hyphens, and is not \`js\`, which holds the Info scripts`,
            );
        else if (seen.has(folded))
            fail(
                shown(manual.file),
                `the manual \`${manual.name}\` has the same name as ${shown(seen.get(folded))} apart from case; manuals are named by file and each name is used once`,
            );
        else seen.set(folded, manual.file);
    }
    if (findings.length) return { manuals: [], findings };

    const override = path.join(folder, TEXINFO_OVERRIDE);
    const hasOverride = fs.existsSync(override);
    const root = path.join(out, TEXINFO_OUTPUT);
    const stylesheet =
        hasOverride ?
            `${base}${TEXINFO_OUTPUT}/${TEXINFO_OVERRIDE}`
        :   `${base}${TEXINFO_STYLESHEET}`;

    const written = [];
    for (const manual of manuals) {
        const dir = path.join(root, manual.name);
        fs.mkdirSync(root, { recursive: true });
        const result = run(
            "texi2any",
            texinfoArguments({ manual: manual.file, output: dir, stylesheet }),
            {
                cwd: path.dirname(manual.file),
                encoding: "utf8",
                maxBuffer: 1 << 26,
                timeout: TEXINFO_TIMEOUT,
            },
        );
        if (result.error?.code === "ENOENT") {
            fail(
                shown(manual.file),
                "`texi2any` is not installed, and this package has Texinfo files to convert; install the texinfo package",
            );
            return { manuals: [], findings };
        }
        if (result.error?.code === "ETIMEDOUT" || (result.signal && !result.error)) {
            fail(
                shown(manual.file),
                result.error?.code === "ETIMEDOUT" ?
                    `\`texi2any\` was stopped after ${TEXINFO_TIMEOUT / 1000} seconds without finishing this manual`
                :   `\`texi2any\` was stopped by the signal ${result.signal}`,
            );
            continue;
        }
        if (result.error) {
            fail(shown(manual.file), `\`texi2any\` could not run: ${result.error.message}`);
            continue;
        }
        const reported = converterFindings(`${result.stderr ?? ""}`, manual.file, shown);
        findings.push(...reported.findings);
        if (result.status !== 0) {
            if (!reported.findings.some((finding) => finding.severity === "error"))
                fail(
                    shown(manual.file),
                    `\`texi2any\` exited with status ${result.status}${reported.other ? `: ${reported.other}` : ""}`,
                );
            continue;
        }
        copyManualImages({ dir, manual: manual.file, folder });
        written.push({ name: manual.name, dir });
    }
    if (hasOverride) {
        fs.mkdirSync(root, { recursive: true });
        fs.copyFileSync(override, path.join(root, TEXINFO_OVERRIDE));
    }
    return { manuals: written, findings };
}

/**
 * Read what `texi2any` printed on its error stream.
 *
 * @param {string} text - The stream.
 * @param {string} manual - The manual's path, where a message names no file.
 * @param {(file: string) => string} shown - How a path is shown.
 * @returns {{findings: object[], other: string}} A finding for each message
 *   that names where it is, and the text of every other line.
 */
function converterFindings(text, manual, shown) {
    const findings = [];
    const other = [];
    const base = path.dirname(manual);
    const add = (file, line, column, severity, message) =>
        findings.push({
            file: shown(path.isAbsolute(file) ? file : path.resolve(base, file)),
            line,
            column,
            severity: severity ?? "error",
            message,
        });
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        let match;
        if ((match = LOCATED_LINE.exec(line)))
            add(match[1], Number(match[2]), Number(match[3] ?? 1), match[4], match[5]);
        else if ((match = PROGRAM_LINE.exec(line))) add(manual, 1, 1, match[1], match[2]);
        else if ((match = FILE_LINE.exec(line))) add(match[1], 1, 1, match[2], match[3]);
        else other.push(line);
    }
    return { findings, other: other.join("; ") };
}

/**
 * Copy the images a converted manual shows beside its pages.
 *
 * `texi2any` writes `<img src="...">` for an `@image` and copies nothing. Each
 * relative source is looked for beside the manual, and copied to the same
 * relative path in the output when it is a file inside the Texinfo folder.
 *
 * @param {object} options - The inputs.
 * @param {string} options.dir - The manual's output directory.
 * @param {string} options.manual - The manual's path.
 * @param {string} options.folder - The Texinfo folder.
 */
function copyManualImages({ dir, manual, folder }) {
    if (!fs.existsSync(dir)) return;
    const base = path.dirname(manual);
    const root = fs.realpathSync(folder);
    const sources = new Set();
    for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith(".html")) continue;
        const html = fs.readFileSync(path.join(dir, entry), "utf8");
        for (const match of html.matchAll(IMAGE_SOURCE)) {
            const src = match[1].replace(/&amp;/g, "&");
            if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) continue;
            sources.add(src);
        }
    }
    for (const src of sources) {
        let relative;
        try {
            relative = decodeURI(src.split(/[?#]/)[0]);
        } catch {
            continue;
        }
        const from = path.resolve(base, relative);
        const to = path.resolve(dir, relative);
        if (!to.startsWith(`${dir}${path.sep}`)) continue;
        let real;
        try {
            real = fs.realpathSync(from);
        } catch {
            continue;
        }
        if (!real.startsWith(`${root}${path.sep}`) || !fs.statSync(real).isFile()) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(real, to);
    }
}
