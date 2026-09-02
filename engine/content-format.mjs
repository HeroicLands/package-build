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
 * Reading `docs/content-format.md` as data (#130).
 *
 * The content format — three frontmatter regions, a note vocabulary with its
 * own `type` and `subType`, and a declared map from each note type onto each
 * system's document fields — is prose, because that is the only form in which
 * the *reasons* survive. But two of the things it states are checkable, and
 * were checked by throwaway scripts while it was being drafted:
 *
 * - **every `system.*` target it names** must exist in the naming system's
 *   published `schema.json`, or the specification and the system disagree; and
 * - **every authored note** should carry only the keys the format declares for
 *   its type, which during the migration (#127) is a progress bar as much as a
 *   check.
 *
 * Both need the document as data, and this is the module that supplies it.
 *
 * **It reads the document's own tables rather than a transcription of them.**
 * A hardcoded list of targets and per-type vocabularies would be a second copy
 * of the specification, free to drift from the first the moment either is
 * edited — which is exactly the failure the checks exist to prevent, moved one
 * level up. So the parser knows the *shape* of the tables the document uses and
 * nothing about their contents: no type name, no field name and no system name
 * is written here. Editing the document changes what the checks assert.
 *
 * **Two table shapes carry everything.**
 *
 * | table | recognised by its first header cell | yields |
 * | --- | --- | --- |
 * | the per-type vocabulary | `` `data` property `` | the keys that type's `data:` block may carry |
 * | the per-type mapping | `shared source` | one claim per `system.*` cell |
 *
 * A mapping table's remaining header cells name the systems (`→ sohl`,
 * `→ hm3`), so the system vocabulary comes from the document too. A cell that
 * names no field — `NA`, `**see above**`, a `flags.*` path — is not a claim,
 * and is skipped rather than reported: the check is about `system.*` targets,
 * and a column reading NA is the document saying this type produces no document
 * there.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The specification this package ships.
 *
 * Resolved from this module rather than from the working directory: a consumer
 * runs `content-build content-format` inside its own repository, and the
 * document it should be checked against is the one that came with the toolchain
 * version it resolved — the same rule `--version` follows.
 *
 * @type {string}
 */
export const CONTENT_FORMAT_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "docs",
    "content-format.md",
);

/**
 * What one note type's section declares.
 *
 * @typedef {object} TypeSpec
 * @property {string} name - The note type, as the `### type:` heading spells it.
 * @property {number} line - 1-based line of that heading.
 * @property {Set<string>} dataKeys - The head segment of each declared `data`
 *   property — what a note actually writes. `appearance.eye_color` is authored
 *   as `appearance`, so that is the key recorded.
 * @property {Set<string>} dataPaths - The declared paths, whole.
 */

/**
 * One `system.*` target the specification names for one note type.
 *
 * @typedef {object} MappingClaim
 * @property {string} noteType - The type whose section makes the claim.
 * @property {string} system - The system column it sits under, from the header.
 * @property {string} source - The shared source cell, stripped of its backticks.
 * @property {string} target - The dotted path, `system.` prefix included.
 * @property {number} line - 1-based line of the row.
 * @property {number} column - 1-based column of the cell's first character.
 */

/**
 * The specification, as data.
 *
 * @typedef {object} ContentFormat
 * @property {string} file - Where it was read from, for diagnostics.
 * @property {Map<string, TypeSpec>} types - Note type → what its section declares.
 * @property {MappingClaim[]} claims - Every `system.*` target, in document order.
 */

/** A table row's cells, or `null` when the line is not a table row. */
function cellsOf(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return null;
    // A trailing `|` closes the row; splitting the interior keeps cell indices
    // aligned with the header's.
    const interior = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    return interior.split("|").map((cell) => cell.trim());
}

/** Whether a row is the `| --- | --- |` rule under a header. */
function isRule(cells) {
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** The contents of a cell written as a single inline-code span, or `undefined`. */
function code(cell) {
    const match = /^`([^`]+)`$/.exec(cell);
    return match ? match[1] : undefined;
}

/**
 * Where a cell starts on its line, 1-based.
 *
 * Counted by walking the row's `|` separators rather than searching for the
 * cell's text, which would land on the wrong column whenever two cells in a row
 * hold the same string — and `NA` appears twice on plenty of rows.
 *
 * @param {string} line - The raw line.
 * @param {number} index - Which cell, 0-based, counting from after the first `|`.
 * @returns {number|undefined} The column, or `undefined` when the row has no
 *   such cell — dropped rather than guessed.
 */
function columnOfCell(line, index) {
    // The separator opening the wanted cell is the (index + 1)-th `|`.
    let at = -1;
    for (let i = 0; i <= index; i += 1) {
        at = line.indexOf("|", at + 1);
        if (at === -1) return undefined;
    }
    const rest = line.slice(at + 1);
    const lead = rest.length - rest.trimStart().length;
    return at + lead + 2;
}

/**
 * Parse the specification's tables.
 *
 * Pure: text in, model out, so a test states a miniature document rather than
 * asserting against the real one and its 1,100 lines of prose.
 *
 * @param {string} text - The document's contents.
 * @param {object} [opts]
 * @param {string} [opts.file] - Path recorded on the result, for diagnostics.
 * @returns {ContentFormat} What the document declares.
 */
export function parseContentFormat(text, { file = CONTENT_FORMAT_PATH } = {}) {
    /** @type {Map<string, TypeSpec>} */
    const types = new Map();
    /** @type {MappingClaim[]} */
    const claims = [];

    const lines = String(text ?? "").split("\n");
    /** @type {TypeSpec|undefined} */
    let current;
    /** @type {{kind: "data"|"mapping", systems: string[]}|undefined} */
    let table;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        const heading = /^#{2,4}\s+type:\s*(\S+)\s*$/.exec(line);
        if (heading) {
            current = {
                name: heading[1],
                line: i + 1,
                dataKeys: new Set(),
                dataPaths: new Set(),
            };
            types.set(current.name, current);
            table = undefined;
            continue;
        }

        const cells = cellsOf(line);
        if (!cells) {
            // Any non-table line ends the table. A blank line between two
            // tables is what keeps a mapping table's rows from being read
            // under the vocabulary table's header.
            table = undefined;
            continue;
        }
        if (isRule(cells)) continue;

        // A header row, recognised by its first cell alone.
        if (cells[0] === "`data` property") {
            table = { kind: "data", systems: [] };
            continue;
        }
        if (cells[0] === "shared source") {
            table = {
                kind: "mapping",
                systems: cells.slice(1).map((cell) => cell.replace(/^→\s*/, "").trim()),
            };
            continue;
        }
        if (!table || !current) continue;

        if (table.kind === "data") {
            const declared = code(cells[0]);
            if (!declared) continue;
            current.dataPaths.add(declared);
            current.dataKeys.add(declared.split(".")[0]);
            continue;
        }

        for (let c = 1; c < cells.length; c += 1) {
            const target = code(cells[c]);
            if (!target || !target.startsWith("system.")) continue;
            const system = table.systems[c - 1];
            if (!system) continue;
            claims.push({
                noteType: current.name,
                system,
                source: code(cells[0]) ?? cells[0],
                target,
                line: i + 1,
                ...(columnOfCell(line, c) === undefined ? {} : { column: columnOfCell(line, c) }),
            });
        }
    }

    return { file, types, claims };
}

/**
 * Read and parse the specification from disk.
 *
 * @param {string} [file] - The document. Defaults to {@link CONTENT_FORMAT_PATH}.
 * @returns {ContentFormat} What it declares.
 */
export function loadContentFormat(file = CONTENT_FORMAT_PATH) {
    return parseContentFormat(fs.readFileSync(file, "utf8"), { file });
}
