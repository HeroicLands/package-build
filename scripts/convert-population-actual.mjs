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
 * Wrap authored population values in source-preserving actual declarations.
 * Run with `--preview` or `--write` and note files or content directories.
 * Every note is parsed and verified before any source is written. The summary
 * names changed files and counts the verified wrappers.
 * @module
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";

const numeric = (value) => value === null || (typeof value === "number" && Number.isFinite(value));

/** Convert a note in memory, checking the complete parsed result before returning it. */
export function convertPopulation(raw, file) {
    const fail = (message, offset = 0) => {
        const prefix = raw.slice(0, offset);
        throw new Error(
            `${file}:${prefix.split("\n").length}:${offset - prefix.lastIndexOf("\n")}: error: ${message}`,
        );
    };
    const opening = /^(?:\uFEFF)?---\r?\n/.exec(raw);
    if (!opening) fail("YAML frontmatter opening delimiter is required");
    const start = opening[0].length;
    const closing = /^---[ \t]*(?:\r?\n|$)/gm;
    closing.lastIndex = start;
    const end = closing.exec(raw);
    if (!end) fail("YAML frontmatter closing delimiter is required", start);
    const source = raw.slice(start, end.index);
    const doc = YAML.parseDocument(source, {
        keepSourceTokens: true,
        strict: true,
        uniqueKeys: true,
    });
    const error = doc.errors[0] ?? doc.warnings[0];
    if (error) fail(`unsupported YAML: ${error.message}`, start + (error.pos?.[0] ?? 0));
    const reject = (node, message) => fail(message, start + (node?.range?.[0] ?? 0));
    const inspect = (node) => {
        if (!node) return;
        if (YAML.isAlias(node) || node.anchor || node.tag)
            reject(node, "aliases, anchors and explicit YAML tags require an author edit");
        if (YAML.isMap(node)) {
            for (const pair of node.items) {
                if (
                    !YAML.isScalar(pair.key) ||
                    typeof pair.key.value !== "string" ||
                    pair.key.value === "<<"
                )
                    reject(pair.key, "complex and merge keys require an author edit");
                inspect(pair.key);
                inspect(pair.value);
            }
        } else if (YAML.isSeq(node)) node.items.forEach(inspect);
    };
    inspect(doc.contents);
    if (!YAML.isMap(doc.contents)) reject(doc.contents, "frontmatter must be a mapping");
    const original = doc.toJS({ maxAliasCount: 0 });
    const expected = structuredClone(original);
    const data = doc.get("data", true);
    if (data == null) return { text: raw, wrapped: 0 };
    if (!YAML.isMap(data)) reject(data, "data must be a mapping");
    const edits = [];
    const pairFor = (map, name) => map.items.find((pair) => pair.key?.value === name);
    const wrap = (map, target, name) => {
        const pair = pairFor(map, name);
        if (!pair) return;
        const node = pair.value;
        if (YAML.isMap(node)) {
            const value = node.toJSON();
            if (
                !Object.hasOwn(value, "actual") ||
                !numeric(value.actual) ||
                Object.keys(value).some((key) => key !== "actual" && key !== "apparent") ||
                (Object.hasOwn(value, "apparent") && !numeric(value.apparent))
            )
                reject(
                    node,
                    `${name} must contain numeric or null actual and optional apparent values`,
                );
            return;
        }
        if (!YAML.isScalar(node) || !numeric(node.value))
            reject(node ?? pair.key, `${name} must be a number, null, or an actual declaration`);
        const [begin, finish] = node.range;
        const value = source.slice(begin, finish);
        if (!value) {
            const at = pair.key.range[1] + 1;
            edits.push({ begin: at, finish: at, text: " {actual: null}" });
        } else edits.push({ begin, finish, text: `{actual: ${value}}` });
        target[name] = { actual: node.value };
    };
    wrap(data, expected.data, "population");
    wrap(data, expected.data, "territorial_population");
    const settlements = data.get("settlements", true);
    if (settlements != null) {
        if (!YAML.isSeq(settlements)) reject(settlements, "settlements must be a list");
        settlements.items.forEach((row, index) => {
            if (!YAML.isMap(row)) reject(row, "settlement row must be a mapping");
            wrap(row, expected.data.settlements[index], "population");
        });
    }
    let updated = source;
    for (const edit of edits.sort((a, b) => b.begin - a.begin))
        updated = updated.slice(0, edit.begin) + edit.text + updated.slice(edit.finish);
    const verified = YAML.parseDocument(updated, { strict: true, uniqueKeys: true });
    if (
        verified.errors.length ||
        verified.warnings.length ||
        !isDeepStrictEqual(verified.toJS(), expected)
    )
        fail("conversion verification failed", start);
    return { text: raw.slice(0, start) + updated + raw.slice(end.index), wrapped: edits.length };
}

/** Prepare every file before optionally writing the verified changes. */
export function convertFiles(files, { write = false } = {}) {
    const prepared = files.map((file) => {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            throw new Error(`${file}: error: source must be a regular, unlinked file`);
        const bytes = fs.readFileSync(file);
        const raw = bytes.toString("utf8");
        if (!Buffer.from(raw).equals(bytes)) throw new Error(`${file}: error: invalid UTF-8`);
        return { file, raw, ...convertPopulation(raw, file) };
    });
    const changed = prepared.filter(({ raw, text }) => raw !== text);
    if (write) {
        for (const item of changed) {
            if (fs.readFileSync(item.file, "utf8") !== item.raw)
                throw new Error(`${item.file}: error: source changed after preparation`);
        }
        for (const item of changed) fs.writeFileSync(item.file, item.text);
    }
    return {
        files: prepared.length,
        changed: changed.length,
        wrapped: prepared.reduce((sum, item) => sum + item.wrapped, 0),
        changes: changed.map(({ file, wrapped }) => ({ file, wrapped })),
    };
}

function collect(input) {
    const stat = fs.lstatSync(input);
    if (stat.isSymbolicLink()) throw new Error(`${input}: error: symbolic links are not supported`);
    if (stat.isDirectory())
        return fs
            .readdirSync(input)
            .sort()
            .flatMap((name) => collect(path.join(input, name)));
    return stat.isFile() && input.endsWith(".md") ? [input] : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const [mode, ...inputs] = process.argv.slice(2);
        if (!["--preview", "--write"].includes(mode) || !inputs.length)
            throw new Error(
                "usage: node scripts/convert-population-actual.mjs --preview|--write <note-or-directory>...",
            );
        const files = inputs.flatMap(collect);
        if (new Set(files.map((file) => path.resolve(file))).size !== files.length)
            throw new Error("each source must be selected only once");
        const result = convertFiles(files, { write: mode === "--write" });
        for (const change of result.changes)
            console.log(`${change.file}: ${change.wrapped} values`);
        console.log(
            `${mode.slice(2)}: ${result.files} files checked, ${result.changed} changed, ${result.wrapped} values verified`,
        );
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
