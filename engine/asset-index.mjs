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
 * The **asset record**: one line of the content index per addressable file.
 *
 * `engine/content-index.mjs` walks `assets/content` and emits a record per note.
 * This walks the three asset roots beside it and emits a record per file, into
 * the same JSON Lines index. There is no asset-specific index and no asset
 * emitter that a consumer has to know about separately — one file, two record
 * shapes, and the module says so.
 *
 * **What an asset record is not.** It carries no frontmatter, no anchors, no
 * `foundry` block and no page address. A file declares nothing about itself, so
 * there is nothing to copy through; it compiles into no document, so there is no
 * UUID; and it publishes no page, so `address` carries the canonical key and no
 * slug. A reader tells the two shapes apart by the `asset` block, which is what
 * {@link module:engine/index-records.isAssetRecord} asks.
 *
 * **`path` is what makes resolution one step.** The record is emitted by the
 * package holding the bytes, so its path is that package's path — relative to
 * that package's `assets/` directory — and each consumer joins its own root onto
 * it. Foundry prefixes `<kind>/<foundry id>/assets/`, the website its CDN prefix
 * for the package, the book the asset base it was configured with. Nothing has
 * to be looked up a second time.
 *
 * **Provenance resolves per address**, and the rule is stated rather than
 * inferred from a directory:
 *
 * 1. A sibling `<filename.ext>.yaml`, which **replaces** an inherited record
 *    wholesale rather than merging over it. Merging would make a record's
 *    meaning depend on what a directory two levels up happens to say, and a
 *    sidecar exists precisely because that answer is wrong for this one file.
 * 2. Otherwise the nearest `provenance.yaml`, searching the file's own directory
 *    and then its ancestors, stopping at the type root.
 * 3. Otherwise nothing, and the record's provenance fields are blank. A package
 *    that records no attribution is a fact to state, not a walk to fail.
 *
 * An unknown key in a provenance file is a **finding** rather than a silent
 * drop: `licence` beside `license` is otherwise an attribution record that looks
 * complete and carries nothing.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { canonicalKey } from "./content-address.mjs";
import { positionOfYamlPath } from "./diagnostics.mjs";
import { ASSET_SYSTEM, ASSET_TYPES, isAssetShortcode } from "./asset-types.mjs";

/**
 * The file a directory records provenance for its subtree in.
 *
 * @type {string}
 */
export const PROVENANCE_FILE = "provenance.yaml";

/**
 * The suffix a per-file provenance sidecar carries.
 *
 * Appended to the **whole** filename, extension included — `anvil.svg.yaml`,
 * not `anvil.yaml` — because the address holds one file whose format is free to
 * change, and a sidecar named after the address alone would be orphaned the day
 * an SVG became a WebP without anything saying so.
 *
 * @type {string}
 */
export const PROVENANCE_SIDECAR_SUFFIX = ".yaml";

/**
 * One field of the `asset` block.
 *
 * @typedef {object} AssetRecordField
 * @property {string} name - The key inside `asset`.
 * @property {"walk"|"provenance"} from - Where the value comes from: the walk
 *   itself, or the provenance record resolved for the address.
 * @property {string} describe - One line, for the author-facing reference.
 */

/**
 * Every field an `asset` block carries, in the order it is documented.
 *
 * **The emitter builds a record from this list**, rather than from a literal
 * that a second list somewhere else would have to be kept in step with. So a
 * field added here is emitted, a field removed here stops being emitted, and the
 * completeness guard derives what it checks from the same declaration instead of
 * hand-copying it.
 *
 * Every field is always present, blank where nothing states it. A fixed record
 * shape is what lets a consumer read `asset.license` without branching on
 * whether the package happened to record one, and blank is the honest answer to
 * "what does this package say about where this file came from" when it says
 * nothing.
 *
 * @type {readonly AssetRecordField[]}
 */
export const ASSET_RECORD_FIELDS = Object.freeze([
    Object.freeze({
        name: "path",
        from: "walk",
        describe:
            "Where the file sits inside the emitting package's asset directory. " +
            "Each consumer joins its own root onto it.",
    }),
    Object.freeze({
        name: "attribution",
        from: "provenance",
        describe: "Who made the file, or what tool generated it.",
    }),
    Object.freeze({
        name: "source",
        from: "provenance",
        describe: "Where it came from — a URL, or a sentence.",
    }),
    Object.freeze({
        name: "license",
        from: "provenance",
        describe: "The licence it is used under — an SPDX identifier, or terms.",
    }),
    Object.freeze({
        name: "notes",
        from: "provenance",
        describe: "Anything else a person reading the attribution needs.",
    }),
]);

/**
 * The keys a provenance file may declare.
 *
 * Derived from {@link ASSET_RECORD_FIELDS} rather than restated, so the file
 * format and the record cannot disagree about which keys exist.
 *
 * @type {ReadonlySet<string>}
 */
export const PROVENANCE_KEYS = Object.freeze(
    new Set(
        ASSET_RECORD_FIELDS.filter((field) => field.from === "provenance").map(
            (field) => field.name,
        ),
    ),
);

/**
 * Read one provenance file, reporting every key that is not a provenance key.
 *
 * @param {string} file - The provenance file.
 * @param {object[]} findings - Collects a diagnostic per unknown key.
 * @returns {Record<string, string>} The recognised keys, as strings.
 */
function readProvenanceFile(file, findings) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        findings.push({
            file,
            severity: "error",
            message: `provenance file cannot be read: ${err.message}`,
        });
        return {};
    }

    let parsed;
    try {
        parsed = YAML.parse(text);
    } catch (err) {
        findings.push({
            file,
            severity: "error",
            message: `provenance file is not valid YAML: ${err.message}`,
        });
        return {};
    }
    if (parsed == null) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
        findings.push({
            file,
            severity: "error",
            message:
                "a provenance file is a map of " +
                `${[...PROVENANCE_KEYS].join(", ")} — this one is not a map`,
        });
        return {};
    }

    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!PROVENANCE_KEYS.has(key)) {
            findings.push({
                file,
                ...positionOfYamlPath(text, [key], { key: true }),
                severity: "error",
                message:
                    `\`${key}\` is not a provenance key — a record states ` +
                    `${[...PROVENANCE_KEYS].join(", ")}, and anything else is ` +
                    "dropped rather than recorded",
            });
            continue;
        }
        out[key] = value == null ? "" : String(value);
    }
    return out;
}

/**
 * The provenance a directory inherits, memoised per directory.
 *
 * The walk asks this once per file and the answer is the same for every file in
 * a directory, so a tree of 4,500 icons would otherwise re-read and re-parse the
 * same thirty-odd files thousands of times.
 *
 * @param {string} dir - The directory the file sits in.
 * @param {string} root - The type root the search stops at.
 * @param {Map<string, Record<string, string>|null>} cache - Per-directory answers.
 * @param {object[]} findings - Collects a diagnostic per unknown key.
 * @returns {Record<string, string>|null} The nearest record, or null.
 */
function inheritedProvenance(dir, root, cache, findings) {
    if (cache.has(dir)) return cache.get(dir);
    const own = path.join(dir, PROVENANCE_FILE);
    let answer;
    if (fs.existsSync(own)) {
        answer = readProvenanceFile(own, findings);
    } else if (path.resolve(dir) === path.resolve(root)) {
        // The search stops at the type root: `assets/` above it is the
        // package's own furniture, and a record there would speak for trees it
        // says nothing about.
        answer = null;
    } else {
        answer = inheritedProvenance(path.dirname(dir), root, cache, findings);
    }
    cache.set(dir, answer);
    return answer;
}

/**
 * The `asset` block for one file.
 *
 * @param {string} relPath - The file's path below the package's asset directory.
 * @param {Record<string, string>|null} provenance - The resolved record.
 * @returns {Record<string, string>} The block, every field present.
 */
function assetBlock(relPath, provenance) {
    const block = {};
    for (const field of ASSET_RECORD_FIELDS) {
        const value = field.from === "walk" ? relPath : provenance?.[field.name];
        block[field.name] = typeof value === "string" ? value : "";
    }
    return block;
}

/**
 * Every file under one root that is an asset of its type.
 *
 * The layout beneath the root is arbitrary, so the walk derives the address from
 * the file it finds and never from the path above it.
 *
 * @param {string} rootDir - The absolute root directory.
 * @param {readonly string[]} extensions - Lowercase, dot-led.
 * @yields {{absPath: string, relPath: string, shortcode: string}}
 */
function* walkAssetRoot(rootDir, extensions) {
    if (!fs.existsSync(rootDir)) return;
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            // A directory that cannot be read holds no address this build can
            // state. Reported by the caller, which knows the root it is walking.
            continue;
        }
        for (const entry of entries) {
            const absPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(absPath);
                continue;
            }
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!extensions.includes(ext)) continue;
            yield {
                absPath,
                relPath: path.relative(rootDir, absPath).split(path.sep).join("/"),
                shortcode: entry.name.slice(0, entry.name.length - ext.length),
            };
        }
    }
}

/**
 * Read a package's asset trees into index records.
 *
 * @param {string} assetsBase - The package's asset directory, the three roots'
 *   parent. A directory that does not exist yields nothing: a package with no
 *   art is ordinary.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package the trees belong to.
 * @param {object[]} [options.problems] - Supplied by a **reader**: a file that
 *   cannot be addressed is pushed here as a diagnostic and skipped. Omitted, it
 *   throws — the contract the emitter needs, since an index missing an asset
 *   asserts that the address does not exist.
 * @returns {Array<Record<string, any>>} One record per addressable file, in walk
 *   order; the caller imposes the index's total order.
 * @throws {Error} When a file cannot be addressed and no `problems` array was
 *   supplied. `file` rides on the error.
 */
export function collectAssetRecords(assetsBase, { contentPackage, problems }) {
    const records = [];
    const findings = [];

    // Collected rather than thrown at the point of discovery, so an emitter and
    // a reader see the same set: the emitter throws on the first of them below,
    // while a reader gets every one at once instead of losing the rest to the
    // first bad filename.
    const report = (file, message) => findings.push({ file, severity: "error", message });

    for (const { type, root, extensions } of ASSET_TYPES) {
        const rootDir = path.join(assetsBase, root);
        const cache = new Map();
        /** @type {Map<string, string>} shortcode → the file already claiming it. */
        const claimed = new Map();

        for (const { absPath, relPath, shortcode } of walkAssetRoot(rootDir, extensions)) {
            if (!isAssetShortcode(shortcode)) {
                report(
                    absPath,
                    `"${shortcode}" is not a shortcode — an asset is addressed ` +
                        `\`${contentPackage}-${ASSET_SYSTEM}-${type}-<shortcode>\`, and a ` +
                        "shortcode is lowercase letters and digits only, so this file " +
                        "has no address. Rename it",
                );
                continue;
            }
            const already = claimed.get(shortcode);
            if (already) {
                report(
                    absPath,
                    `two files under ${root}/ are named "${shortcode}", so both ` +
                        `claim \`${contentPackage}-${ASSET_SYSTEM}-${type}-${shortcode}\` — ` +
                        `the other is ${already}. A root's shortcodes are one flat ` +
                        "namespace however deeply it nests, so rename one of them",
                );
                continue;
            }
            claimed.set(shortcode, relPath);

            const sidecar = `${absPath}${PROVENANCE_SIDECAR_SUFFIX}`;
            const provenance =
                fs.existsSync(sidecar) ?
                    readProvenanceFile(sidecar, findings)
                    // A sidecar replaces an inherited record wholesale, so the
                    // ancestor walk is not consulted when one is present.
                :   inheritedProvenance(path.dirname(absPath), rootDir, cache, findings);

            records.push({
                package: contentPackage,
                type,
                shortcode,
                // The canonical key, and no slug: an asset publishes no page, so
                // there is no page address for a slug to name.
                address: {
                    canonical: canonicalKey(contentPackage, ASSET_SYSTEM, type, shortcode),
                },
                asset: assetBlock(`${root}/${relPath}`, provenance),
            });
        }
    }

    if (findings.length) {
        if (!problems) {
            const first = findings[0];
            const err = new Error(first.message);
            err.file = first.file;
            if (first.line) err.position = { line: first.line, column: first.column };
            throw err;
        }
        problems.push(...findings);
    }
    return records;
}
