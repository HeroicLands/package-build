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
 * Reads the structured note-format contract shipped with this package.
 *
 * Types, subtype values, field paths, system mappings, and closed vocabularies
 * have located declarations. The guides can change their headings and tables
 * without changing validation. A caller may supply a Markdown specification
 * explicitly through `--spec`; the bundled contract is YAML.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/**
 * The structured format contract this package ships.
 *
 * Resolved from this module rather than from the working directory: a consumer
 * runs `package-build content-format` inside its own repository, and the
 * contract it should be checked against is the one that came with the toolchain
 * version it resolved — the same rule `--version` follows.
 *
 * @type {string}
 */
export const CONTENT_FORMAT_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "content-format.yaml",
);

/**
 * What one note type's section declares.
 *
 * @typedef {object} TypeSpec
 * @property {string} name - The note type as declared in the contract.
 * @property {number} line - 1-based line of that declaration.
 * @property {Set<string>} dataKeys - The head segment of each declared `data`
 *   property — what a note actually writes. `appearance.eye_color` is authored
 *   as `appearance`, so that is the key recorded.
 * @property {Set<string>} dataPaths - The declared paths, whole.
 * @property {Map<string, DataRow>} [dataRows] - Each documented path's row, as
 *   a reference document states it. Read from a Markdown specification only.
 * @property {string[]} subTypes - The declared `subType` values,
 *   in document order — empty when it states none, which is the ordinary case
 *   for a type that has no `subType` at all.
 */

/**
 * One row of a `data` property table, as a reference document states it.
 *
 * @typedef {object} DataRow
 * @property {string} shape - The second cell, the value's shape in words.
 * @property {string} text - The whole row as written, for a reader looking for
 *   a marker anywhere in it.
 * @property {number} line - 1-based line of the row.
 */

/**
 * One `system.*` target the specification names for one note type.
 *
 * @typedef {object} MappingClaim
 * @property {string} noteType - The type whose section makes the claim, or
 *   `the shared mappings` for a row of the shared tables — see `shared`.
 * @property {boolean} [shared] - Whether the row came from a **shared** mapping
 *   table, which stands before the first `### type:` heading and states what
 *   every type maps identically. Absent on a per-type row, so the two
 *   never mix: only a per-type row has a field declaration to be checked
 *   against.
 * @property {string} system - The system column it sits under, from the header.
 * @property {string} source - The shared source cell, stripped of its backticks.
 * @property {string} target - The dotted path, `system.` prefix included.
 * @property {number} line - 1-based line of the row.
 * @property {number} column - 1-based column of the cell's first character.
 */

/**
 * One closed vocabulary the specification states as a table.
 *
 * @typedef {object} VocabularySpec
 * @property {string} name - The key the header names, without its backticks.
 * @property {number} line - 1-based line of the header row.
 * @property {string[]} values - The values, in document order. A row whose
 *   first cell is not a single inline-code span states no value and is skipped,
 *   which is how a table says "no marker" in a row of its own.
 */

/**
 * The specification, as data.
 *
 * @typedef {object} ContentFormat
 * @property {string} file - Where it was read from, for diagnostics.
 * @property {Map<string, TypeSpec>} types - Note type → what its section declares.
 * @property {MappingClaim[]} claims - Every `system.*` target, in document order.
 * @property {Map<string, VocabularySpec>} vocabularies - Key → the values it
 *   admits, for every closed vocabulary the document states as a table.
 * @property {Map<string, DataRow>} [sharedDataRows] - The rows of the shared
 *   `data` property table — the keys every type accepts — by path. Read from a
 *   Markdown specification only.
 * @property {Map<string, DataRow>} [eventRows] - The rows of the event key
 *   tables, by path from one event entry (`names[].by`). Read from a Markdown
 *   specification only.
 */

/**
 * What a shared row's `noteType` reads, in place of a type name.
 *
 * Phrased to be substituted into a diagnostic sentence — "the format maps `x`
 * in the shared mappings to `y`" — because that is the only place it is ever
 * read. Both shared tables use it: the second states what the actor types add,
 * and a row of it is no more a `being`'s than a row of the first is.
 *
 * @type {string}
 */
export const SHARED_SCOPE = "the shared mappings";

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

/** The one shape the specification states a type's `subType` values in. */
const SUBTYPE_MARKER = "**subType**:";

/** Any line that reads as a `subType` marker, canonical or not. */
const SUBTYPE_MARKER_ISH = /^\s*\**\s*subTypes?\s*\**\s*:?\s*$/i;

/** One bullet of a values list: `- <value>` or `- <value>: <definition>`. */
const SUBTYPE_BULLET = /^-\s+(\S+?)\s*(?::|$)/;

/**
 * A parse failure, positioned where the document went wrong.
 *
 * Thrown rather than collected, because there is nothing partial to report: a
 * marker the reader does not understand yields a section that appears to
 * declare no subTypes, and every comparison against it then passes vacuously.
 * The message carries the compiler-parseable position the rest of the
 * toolchain's diagnostics use.
 *
 * @param {string} file - The document being read.
 * @param {number} line - 1-based line the fault is on.
 * @param {string} message - What is wrong, and what to write instead.
 * @returns {Error} The failure to throw.
 */
function specError(file, line, message) {
    return new Error(`${file}:${line}:1: error: ${message}`);
}

/**
 * The `subType` values a section enumerates under its marker.
 *
 * Reads the one contiguous bullet list directly below the marker and stops
 * there: several sections state another closed vocabulary of their own a blank
 * line later — `TransmissionTypes`, `GovernanceModel` — and reading on would
 * quietly attribute its values to `subType`.
 *
 * @param {string[]} lines - The document's lines.
 * @param {number} at - Index of the marker line.
 * @param {string} file - The document, for the failure message.
 * @returns {string[]} The values, in document order.
 */
function subTypeValues(lines, at, file) {
    /** @type {string[]} */
    const values = [];
    let i = at + 1;
    while (i < lines.length && lines[i].trim() === "") i += 1;
    for (; i < lines.length; i += 1) {
        const line = lines[i];
        // A wrapped definition is indented under its own bullet.
        if (values.length && /^\s+\S/.test(line)) continue;
        if (!line.startsWith("-")) break;
        const bullet = SUBTYPE_BULLET.exec(line);
        const value = bullet?.[1].replace(/`/g, "");
        if (!value || !/^[A-Za-z0-9]+$/.test(value)) {
            throw specError(
                file,
                i + 1,
                `\`${SUBTYPE_MARKER}\` takes one bullet per value, ` +
                    "`- <value>` or `- <value>: <definition>`, and this bullet states none.",
            );
        }
        values.push(value);
    }
    if (!values.length) {
        throw specError(
            file,
            at + 1,
            `\`${SUBTYPE_MARKER}\` enumerates no values. A type whose subType values the ` +
                "specification does not state omits the marker.",
        );
    }
    return values;
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
    /** @type {Map<string, VocabularySpec>} */
    const vocabularies = new Map();
    /** @type {Map<string, DataRow>} */
    const sharedDataRows = new Map();
    /** @type {Map<string, DataRow>} */
    const eventRows = new Map();

    const lines = String(text ?? "").split("\n");
    /** @type {TypeSpec|undefined} */
    let current;
    /** @type {{kind: "data"|"mapping"|"vocabulary", systems: string[], shared?: boolean, vocabulary?: VocabularySpec}|undefined} */
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
                dataRows: new Map(),
                subTypes: [],
            };
            types.set(current.name, current);
            table = undefined;
            continue;
        }

        if (current && SUBTYPE_MARKER_ISH.test(line)) {
            if (line.trim() !== SUBTYPE_MARKER) {
                throw specError(
                    file,
                    i + 1,
                    `a type's subType values are stated as \`${SUBTYPE_MARKER}\`, ` +
                        `not \`${line.trim()}\`. The specification had five spellings and ` +
                        "converged on one, so that a section is never read as declaring none.",
                );
            }
            current.subTypes = subTypeValues(lines, i, file);
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
        if (cells[0] === "shared `data` property") {
            table = { kind: "shared-data", systems: [] };
            continue;
        }
        if (cells[0] === "event key" || cells[0] === "nested key") {
            table = { kind: "event", systems: [] };
            continue;
        }
        if (cells[0] === "shared source") {
            table = {
                kind: "mapping",
                systems: cells.slice(1).map((cell) => cell.replace(/^→\s*/, "").trim()),
                // Before any type section, so the rows are every type's.
                ...(current ? {} : { shared: true }),
            };
            continue;
        }
        // `` `<name>` value `` — a closed vocabulary, named by its own header.
        const vocabularyHeader = /^`([A-Za-z][\w-]*)`\s+value$/.exec(cells[0]);
        if (vocabularyHeader) {
            const name = vocabularyHeader[1];
            if (vocabularies.has(name)) {
                throw specError(
                    file,
                    i + 1,
                    `\`${name}\` already has a vocabulary table at line ` +
                        `${/** @type {VocabularySpec} */ (vocabularies.get(name)).line}. ` +
                        "A vocabulary is stated once, or a reader has two closed sets to " +
                        "reconcile and no rule for which is closed.",
                );
            }
            const vocabulary = { name, line: i + 1, values: /** @type {string[]} */ ([]) };
            vocabularies.set(name, vocabulary);
            table = { kind: "vocabulary", systems: [], vocabulary };
            continue;
        }
        if (!table) continue;

        if (table.kind === "vocabulary") {
            const value = code(cells[0]);
            // A row stating no value states the *absence* of a marker, which is
            // a real row of such a table and not a value it admits.
            if (value) /** @type {VocabularySpec} */ (table.vocabulary).values.push(value);
            continue;
        }

        if (table.kind === "data") {
            if (!current) continue;
            const declared = code(cells[0]);
            if (!declared) continue;
            current.dataPaths.add(declared);
            current.dataKeys.add(declared.split(".")[0]);
            current.dataRows?.set(declared, { shape: cells[1] ?? "", text: line, line: i + 1 });
            continue;
        }

        if (table.kind === "shared-data" || table.kind === "event") {
            const declared = code(cells[0]);
            if (declared)
                (table.kind === "event" ? eventRows : sharedDataRows).set(declared, {
                    shape: cells[1] ?? "",
                    text: line,
                    line: i + 1,
                });
            continue;
        }

        if (!table.shared && !current) continue;

        for (let c = 1; c < cells.length; c += 1) {
            const target = code(cells[c]);
            if (!target || !target.startsWith("system.")) continue;
            const system = table.systems[c - 1];
            if (!system) continue;
            claims.push({
                noteType: table.shared ? SHARED_SCOPE : /** @type {TypeSpec} */ (current).name,
                ...(table.shared ? { shared: true } : {}),
                system,
                source: code(cells[0]) ?? cells[0],
                target,
                line: i + 1,
                ...(columnOfCell(line, c) === undefined ? {} : { column: columnOfCell(line, c) }),
            });
        }
    }

    return { file, types, claims, vocabularies, sharedDataRows, eventRows };
}

/**
 * Read and parse the bundled contract or a caller-supplied specification.
 *
 * @param {string} [file] - The contract. Defaults to {@link CONTENT_FORMAT_PATH}.
 * @returns {ContentFormat} What it declares.
 */
export function loadContentFormat(file = CONTENT_FORMAT_PATH) {
    const source = fs.readFileSync(file, "utf8");
    return file.endsWith(".md") ?
            parseContentFormat(source, { file })
        :   parseStructuredContentFormat(source, { file });
}

/**
 * Read the machine contract without depending on the presentation of a guide.
 * A Markdown file remains accepted by `--spec` for callers carrying a custom
 * specification; the shipped contract is YAML.
 *
 * @param {string} text - YAML content.
 * @param {object} [opts]
 * @param {string} [opts.file] - Location reported in diagnostics.
 * @returns {ContentFormat} Types, mappings, and closed vocabularies.
 */
export function parseStructuredContentFormat(text, { file = CONTENT_FORMAT_PATH } = {}) {
    const lines = new YAML.LineCounter();
    const document = YAML.parseDocument(text, { lineCounter: lines, uniqueKeys: true });
    if (document.errors.length) {
        const fault = document.errors[0];
        const position = fault.pos?.[0] === undefined ? null : lines.linePos(fault.pos[0]);
        throw new Error(
            `${file}${position ? `:${position.line}:${position.col}` : ""}: error: ${fault.message}`,
        );
    }
    const root = document.toJS();
    const mapping = (value) => value && typeof value === "object" && !Array.isArray(value);
    if (
        root?.version !== 1 ||
        !mapping(root.types) ||
        !Array.isArray(root.claims) ||
        !mapping(root.vocabularies)
    ) {
        throw new Error(
            `${file}: error: expected format contract version 1 with types, claims, and vocabularies`,
        );
    }
    const at = (node) => (node?.range?.[0] === undefined ? null : lines.linePos(node.range[0]));
    const errorAt = (node, message) => {
        const position = at(node);
        return new Error(
            `${file}${position ? `:${position.line}:${position.col}` : ""}: error: ${message}`,
        );
    };
    const types = new Map();
    for (const [name, spec] of Object.entries(root.types)) {
        const node = document.getIn(["types", name], true);
        if (!Array.isArray(spec.data) || !Array.isArray(spec.subTypes)) {
            throw errorAt(node, `type ${name} needs data and subTypes lists`);
        }
        for (const [index, field] of spec.data.entries()) {
            if (typeof field !== "string" || !field.trim()) {
                throw errorAt(
                    document.getIn(["types", name, "data", index], true),
                    `type ${name} has an empty or non-string data field`,
                );
            }
        }
        for (const [index, subType] of spec.subTypes.entries()) {
            if (typeof subType !== "string" || !subType.trim()) {
                throw errorAt(
                    document.getIn(["types", name, "subTypes", index], true),
                    `type ${name} has an empty or non-string subType`,
                );
            }
        }
        types.set(name, {
            name,
            line: at(node)?.line,
            dataKeys: new Set(spec.data.map((field) => field.split(".")[0])),
            dataPaths: new Set(spec.data),
            subTypes: spec.subTypes,
        });
    }
    const claims = root.claims.map((claim, index) => {
        const node = document.getIn(["claims", index], true);
        const position = at(node);
        if (
            !mapping(claim) ||
            ["noteType", "system", "source", "target"].some(
                (key) => typeof claim[key] !== "string" || !claim[key].trim(),
            )
        ) {
            throw errorAt(node, "a mapping needs noteType, system, source, and target");
        }
        return {
            ...claim,
            ...(position ? { line: position.line, column: position.col } : {}),
        };
    });
    const vocabularies = new Map();
    for (const [name, values] of Object.entries(root.vocabularies)) {
        const node = document.getIn(["vocabularies", name], true);
        if (!Array.isArray(values)) {
            throw errorAt(node, `vocabulary ${name} needs a values list`);
        }
        for (const [index, value] of values.entries()) {
            if (typeof value !== "string" || !value.trim()) {
                throw errorAt(
                    document.getIn(["vocabularies", name, index], true),
                    `vocabulary ${name} has an empty or non-string value`,
                );
            }
        }
        vocabularies.set(name, {
            name,
            line: at(node)?.line,
            values,
        });
    }
    return { file, types, claims, vocabularies };
}
