#!/usr/bin/env node
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
 * Build `vendor/markdownlint.mjs`: the installed `markdownlint`, with every
 * package it depends on, as one ES module that imports only Node builtins.
 *
 * markdownlint's parser enables math through `micromark-extension-math`, whose
 * entry module re-exports an HTML compiler that requires KaTeX. markdownlint
 * uses the syntax extension alone and never renders HTML, so the bundle
 * resolves that package to its `lib/syntax.js`. Math is tokenized exactly as
 * markdownlint tokenizes it, and KaTeX is neither bundled nor installed by a
 * package that depends on this one.
 *
 * The module exports the whole of `markdownlint` and `markdownlint/promise`.
 * It opens with the name, version, licence and full licence text of every
 * package whose code it contains, read from that package's own files; a
 * bundled package with no licence file stops the build.
 *
 * `prepare` and `prepack` run this, so `npm ci` and `npm pack` both leave a bundle built
 * from the locked markdownlint. The output is deterministic for a given
 * lockfile, and `tests/markdownlint-vendored.test.ts` fails when the file on
 * disk differs from a fresh build.
 *
 * @module
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(PKG_ROOT, "package.json"));

/** Where the bundle is written, and where `engine/markdownlint-run.mjs` imports it from. */
export const VENDORED_FILE = path.join(PKG_ROOT, "vendor", "markdownlint.mjs");

/** The entry: markdownlint's two module surfaces, as one. */
const ENTRY = 'export * from "markdownlint";\nexport * from "markdownlint/promise";\n';

/**
 * Lets the CommonJS parts of markdownlint call `require` and
 * `require.resolve` from inside an ES module.
 */
const REQUIRE_SHIM =
    'import { createRequire as __vendorCreateRequire } from "node:module";\n' +
    "const require = __vendorCreateRequire(import.meta.url);\n";

/**
 * Resolves `micromark-extension-math` to its syntax module, leaving out the
 * KaTeX compiler. The package is located through esbuild's own resolver, so
 * the conditions Node happens to run under never pick a different build of it.
 */
const mathSyntaxOnly = {
    name: "micromark-extension-math-syntax",
    /** @param {import("esbuild").PluginBuild} b */
    setup(b) {
        b.onResolve({ filter: /^micromark-extension-math$/ }, async (args) => {
            if (args.pluginData === mathSyntaxOnly) return undefined;
            const entry = await b.resolve(args.path, {
                kind: args.kind,
                importer: args.importer,
                resolveDir: args.resolveDir,
                pluginData: mathSyntaxOnly,
            });
            if (entry.errors.length) return { errors: entry.errors };
            return { path: path.join(path.dirname(entry.path), "lib", "syntax.js") };
        });
    },
};

/**
 * The package directory a bundled input belongs to.
 *
 * @param {string} input - Input path from the esbuild metafile, relative to the package root.
 * @returns {string | undefined} Absolute package directory, or `undefined` for the entry.
 */
function packageDirOf(input) {
    const marker = "node_modules/";
    const at = input.lastIndexOf(marker);
    if (at === -1) return undefined;
    const rest = input.slice(at + marker.length).split("/");
    const depth = rest[0]?.startsWith("@") ? 2 : 1;
    return path.join(PKG_ROOT, input.slice(0, at + marker.length), ...rest.slice(0, depth));
}

/**
 * Name, version, licence and licence text for one bundled package.
 *
 * @param {string} dir - The package's directory.
 * @returns {{name: string, version: string, license: string, text: string}} The notice.
 */
function noticeFor(dir) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const licenceFile = fs.readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
    if (!licenceFile) {
        throw new Error(
            `${path.relative(PKG_ROOT, dir)}: error: bundled package has no licence file`,
        );
    }
    const text = fs.readFileSync(path.join(dir, licenceFile), "utf8").trim();
    if (text.includes("*/")) {
        throw new Error(
            `${path.relative(PKG_ROOT, path.join(dir, licenceFile))}: error: licence text closes a block comment`,
        );
    }
    return {
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
        text,
    };
}

/**
 * The notice block that opens the bundle.
 *
 * @param {{name: string, version: string, license: string, text: string}[]} notices - One per package.
 * @returns {string} A block comment.
 */
function header(notices) {
    const lines = [
        "/*!",
        " * markdownlint and the packages it depends on, bundled into one module by",
        " * @heroiclands/package-build. Generated by scripts/vendor-markdownlint.mjs;",
        " * every package keeps its own licence, given in full below.",
    ];
    for (const { name, version, license, text } of notices) {
        lines.push(" *", ` * ${name}@${version} (${license})`, " *");
        for (const line of text.split("\n")) lines.push(line ? ` *   ${line}` : " *");
    }
    lines.push(" */", "");
    return lines.join("\n");
}

/**
 * Build the bundle in memory.
 *
 * @returns {Promise<{code: string, packages: {name: string, version: string, license: string}[]}>}
 *   The module text and the packages whose code it contains.
 */
export async function bundleMarkdownlint() {
    const result = await build({
        stdin: { contents: ENTRY, resolveDir: PKG_ROOT, sourcefile: "markdownlint-entry.mjs" },
        absWorkingDir: PKG_ROOT,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        charset: "utf8",
        legalComments: "none",
        metafile: true,
        write: false,
        plugins: [mathSyntaxOnly],
    });
    const output = result.outputFiles[0];
    if (!output) throw new Error("esbuild produced no output");

    const dirs = new Set(
        Object.keys(result.metafile.inputs)
            .map(packageDirOf)
            .filter((dir) => dir !== undefined),
    );
    const notices = [...dirs].map(noticeFor).sort((a, b) => a.name.localeCompare(b.name));

    return {
        code: header(notices) + REQUIRE_SHIM + output.text,
        packages: notices.map(({ name, version, license }) => ({ name, version, license })),
    };
}

/** Write {@link VENDORED_FILE}. */
async function main() {
    // Resolving it here makes a missing devDependency fail by name, not deep inside esbuild.
    require.resolve("markdownlint");
    const { code } = await bundleMarkdownlint();
    fs.mkdirSync(path.dirname(VENDORED_FILE), { recursive: true });
    fs.writeFileSync(VENDORED_FILE, code, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    await main();
}
