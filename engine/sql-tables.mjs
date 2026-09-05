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
 * Content tables written in SQL, queried over the content index.
 *
 * The tables were written in Dataview's query language, chosen when the corpus
 * lived in an Obsidian vault so a table rendered live while authoring. The vault
 * is gone, and what remained was a hand-written parser and evaluator for someone
 * else's language, kept faithful to semantics nothing checked it against (#246).
 *
 * **The query is real SQL, run by DuckDB** — not a dialect maintained here. That
 * is the whole point: a partial reimplementation would accept some valid SQL and
 * silently misread the rest, which is worse than an unfamiliar language, because
 * the boundary is invisible.
 *
 * **What SQL cannot say, the projection says.** Rendering a table is not a
 * relational operation: which column links, and where a section breaks, are
 * decisions about output. They are carried as **underscore-prefixed aliases** —
 * `_ref` and `_section` — which are ordinary SQL, need no fence options, and are
 * visible in the query where an author is already looking.
 *
 * @module
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FENCE_LINE } from "./code-fences.mjs";

/** The fence info string that marks a SQL content table. */
const SQL_INFO = /^sql\b/i;

/** Rendered in a cell whose value is absent. */
const EMPTY_CELL = "—";

/**
 * Aliases the renderer reads rather than printing.
 *
 * `_ref` is the note a row points at, as the `type-shortcode` address a wikilink
 * resolves — `address.slug` in the index. `_section` partitions the result into
 * headed tables.
 */
export const RENDER_ALIASES = Object.freeze({ ref: "_ref", section: "_section" });

/** A table cell may not carry a raw `|` or a line break. */
const escapeCell = (text) =>
    String(text)
        .replace(/\|/g, "\\|")
        .replace(/[\r\n]+/g, " ");

/**
 * Every `sql` fence in a markdown body, with the position each occupies.
 *
 * Positions are 0-based lines into the body as given, which is what a diagnostic
 * about a directive needs (#17) and what the expander uses to splice results
 * back in.
 *
 * @param {string} markdown - The note body, frontmatter already stripped.
 * @returns {Array<{line: number, close: number, indent: string, query: string,
 *   allowEmpty: boolean, sectionLevel: number, block: string}>} One entry per
 *   fence, in document order.
 */
export function findSqlBlocks(markdown) {
    const lines = String(markdown ?? "").split("\n");
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
        const opening = FENCE_LINE.exec(lines[i]);
        if (!opening) continue;
        const [, indent, marker, info] = opening;
        const closer = new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`);
        let close = i + 1;
        while (close < lines.length && !closer.test(lines[close])) close += 1;
        if (!SQL_INFO.test(info.trim())) {
            // Not ours, but still a fence: skip its body so a `sql` line inside
            // some other block is never read as a directive.
            i = close;
            continue;
        }
        if (close >= lines.length) continue;
        const level = /\bsection-level=(\d)\b/.exec(info);
        blocks.push({
            line: i,
            close,
            indent,
            query: lines.slice(i + 1, close).join("\n"),
            // `sql allow-empty` says a table selecting nothing is intended.
            // Spelled on the fence rather than in the query because it is a
            // statement about this directive and not part of SQL (#223).
            allowEmpty: /\ballow-empty\b/i.test(info),
            sectionLevel: level ? Number(level[1]) : 2,
            block: lines.slice(i, close + 1).join("\n"),
        });
        i = close;
    }
    return blocks;
}

/**
 * Open a DuckDB view over the content index.
 *
 * The records are written as JSON Lines to a temporary file and read with
 * `read_json_auto`, rather than inserted row by row, because that is what makes
 * the queries readable: DuckDB infers a `STRUCT` for every nested object, so a
 * note's `sohl.weight` and `name.full` are addressed in a query exactly as they
 * are authored in the note. A column-per-path table would force
 * `"sohl.weight"` in quotes, and a JSON column would force `sohl->>'weight'`.
 *
 * `union_by_name` is what makes that work across a heterogeneous corpus: a
 * `sohl:` block differs by note type, and the inferred struct is the union of
 * every type's fields, with `NULL` where a record does not have one.
 *
 * `threads=1` so a result is byte-identical between runs. Rows tied under the
 * authored `ORDER BY` then fall back to the index's own order, which is itself
 * deterministic — the index is emitted sorted and byte-stable.
 *
 * @param {object[]} records - Content-index records, as
 *   {@link module:engine/content-index.collectContentIndex} returns them.
 * @param {object} [opts]
 * @param {string} [opts.dir] - Directory for the temporary file.
 * @returns {Promise<{query: (sql: string) => Promise<object[]>,
 *   close: () => Promise<void>}>} The open database.
 */
export async function openNotesDatabase(records, { dir } = {}) {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const base = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "content-sql-"));
    fs.mkdirSync(base, { recursive: true });
    const jsonl = path.join(base, "notes.jsonl");
    fs.writeFileSync(jsonl, records.map((record) => JSON.stringify(record)).join("\n"));

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run("SET threads=1");
    await connection.run(
        `CREATE VIEW notes AS SELECT * FROM read_json_auto(` +
            `'${jsonl.replace(/'/g, "''")}', format='newline_delimited', ` +
            `union_by_name=true, maximum_object_size=20000000)`,
    );

    return {
        async query(sql) {
            const reader = await connection.runAndReadAll(sql);
            return {
                // From the result's schema, not from the rows: a query that
                // selects nothing still has columns, and reporting *that* is
                // what tells a stale query from an empty category (#223).
                columnNames: reader.columnNames(),
                rows: reader
                    .getRowObjects()
                    .map((row) =>
                        Object.fromEntries(
                            Object.entries(row).map(([key, value]) => [key, toPlain(value)]),
                        ),
                    ),
            };
        },
        async close() {
            if (!dir) fs.rmSync(base, { recursive: true, force: true });
        },
    };
}

/**
 * Run one authored query and shape its result for the renderer.
 *
 * @param {object} db - From {@link openNotesDatabase}.
 * @param {string} sql - The query, as authored.
 * @returns {Promise<{columns: string[], rows: object[]}>} The rendered columns
 *   — every selected alias except the underscore-prefixed ones — and the rows.
 */
export async function runSqlQuery(db, sql) {
    const { rows, columnNames } = await db.query(sql);
    return { columns: columnNames.filter((key) => !key.startsWith("_")), rows };
}

/**
 * One DuckDB value as the plain JavaScript the renderer works with.
 *
 * DuckDB returns its own wrapper for every non-primitive: a list is a
 * `DuckDBListValue` holding `items`, a struct a `DuckDBStructValue` holding
 * `entries`, and — the one that would otherwise reach a cell as `[object
 * Object]` — a decimal is `{width, scale, value}`, where `1.5` arrives as
 * `value: 15n, scale: 1`. Everything else DuckDB wraps (dates, timestamps,
 * intervals, blobs) renders through its own `toString`, which is the value a
 * reader expects to see.
 *
 * A struct is deliberately left an object: a column that resolves to one is a
 * mistake the renderer reports rather than prints.
 *
 * @param {unknown} value - As DuckDB returned it.
 * @returns {unknown} The plain value.
 */
function toPlain(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value.items)) return value.items.map(toPlain);
    if (value.entries && typeof value.entries === "object") {
        return Object.fromEntries(
            Object.entries(value.entries).map(([key, entry]) => [key, toPlain(entry)]),
        );
    }
    if (typeof value.scale === "number" && value.value != null) {
        return Number(value.value) / 10 ** value.scale;
    }
    if (value.constructor?.name?.startsWith("DuckDB")) return String(value);
    return value;
}

/**
 * One value as the text a cell shows.
 *
 * DuckDB returns an integer as a `BigInt`, which `String()` renders without its
 * `n` — but a struct or a list would stringify as `[object Object]`, so those
 * are refused rather than printed. A list of scalars is joined, because that is
 * what a `tags` or `aliases` column means.
 *
 * @param {unknown} value - The cell value.
 * @param {string} column - Its column, named in the message.
 * @returns {string} The cell.
 */
function cellText(value, column) {
    if (value == null || value === "") return EMPTY_CELL;
    if (Array.isArray(value)) {
        if (value.some((entry) => entry != null && typeof entry === "object")) {
            throw new Error(`column "${column}" resolves to a list of objects`);
        }
        return value.length ? escapeCell(value.join(", ")) : EMPTY_CELL;
    }
    if (typeof value === "object" && !(value instanceof Date)) {
        throw new Error(`column "${column}" resolves to an object`);
    }
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "bigint") return escapeCell(value.toString());
    return escapeCell(value);
}

/**
 * Render one query's result as markdown.
 *
 * A `_ref` alias makes the row's **first rendered column** a wikilink to that
 * address; the reference is dropped when nothing can be linked, so a table never
 * ships a link that does not resolve. A `_section` alias splits the result into
 * a headed table per distinct value, in the order the rows arrive — so the
 * authored `ORDER BY` decides the section order too, and one query replaces the
 * forty near-identical blocks the language used to require.
 *
 * @param {{columns: string[], rows: object[]}} result - From
 *   {@link runSqlQuery}.
 * @param {object} [opts]
 * @param {(ref: string) => boolean} [opts.linkable] - Whether an address can be
 *   linked to; defaults to linking any non-empty `_ref`.
 * @param {number} [opts.sectionLevel=2] - Heading level for `_section`.
 * @returns {string} The markdown.
 */
export function renderSqlTable(result, { linkable = () => true, sectionLevel = 2 } = {}) {
    const { columns, rows } = result;
    if (!columns.length) throw new Error("query selects no rendered column");

    const groups = [];
    for (const row of rows) {
        const section =
            Object.hasOwn(row, RENDER_ALIASES.section) ?
                String(row[RENDER_ALIASES.section] ?? "")
            :   null;
        const last = groups[groups.length - 1];
        if (last && last.section === section) last.rows.push(row);
        else groups.push({ section, rows: [row] });
    }

    const out = [];
    for (const group of groups) {
        if (group.section !== null) {
            out.push(`${"#".repeat(sectionLevel)} ${group.section}`, "");
        }
        const cells = group.rows.map((row) =>
            columns.map((column, index) => {
                const text = cellText(row[column], column);
                const ref = row[RENDER_ALIASES.ref];
                if (index !== 0 || !ref || !linkable(String(ref))) return text;
                // A wikilink's own separator is a literal `|`, written `\|`
                // inside a table cell, so the label must not carry one.
                return `[[${ref}\\|${text.replace(/\\?\|/g, "/")}]]`;
            }),
        );
        const align = columns.map((_column, index) => {
            const shown = cells.map((row) => row[index]).filter((cell) => cell !== EMPTY_CELL);
            const numeric =
                shown.length > 0 &&
                shown.every((cell) => cell.trim() !== "" && Number.isFinite(Number(cell)));
            return numeric ? "---:" : "---";
        });
        const line = (values) => `| ${values.join(" | ")} |`;
        out.push(line(columns.map(escapeCell)), line(align), ...cells.map(line));
        if (group !== groups[groups.length - 1]) out.push("");
    }
    return out.join("\n");
}

/**
 * Run every `sql` directive in a set of note bodies, ahead of expansion.
 *
 * **Why a separate pass.** DuckDB's API is asynchronous and
 * {@link module:engine/content-tables.expandContentTables} is not — nor should
 * it become so: two of its three callers are synchronous, and one of those,
 * `renderPages`, is exported. Preparing the results first keeps every one of
 * those signatures intact, and it is the shape #243 is heading for anyway —
 * the corpus enumerated once, each pass reading the answer rather than
 * deriving it again.
 *
 * A query that fails is recorded rather than thrown, so one bad directive costs
 * its own table and not the whole build's report.
 *
 * @param {object} db - From {@link openNotesDatabase}.
 * @param {Array<{source: string, markdown: string}>} sources - The bodies to
 *   scan.
 * @param {object} [opts]
 * @param {(ref: string) => boolean} [opts.linkable] - Passed to
 *   {@link renderSqlTable}.
 * Keyed by note and then by line, rather than by a composite of the two: the
 * `source` a caller knows a note by is its *name*, which is not unique across a
 * tree, and the expander only ever needs the one note it is expanding.
 *
 * @returns {Promise<Map<string, Map<number, object>>>} Note to line to result,
 *   each carrying either a rendered `markdown` and its `rows`, or a `reason`.
 */
export async function prepareSqlTables(db, sources, { linkable } = {}) {
    const prepared = new Map();
    for (const { source, markdown } of sources) {
        const blocks = findSqlBlocks(markdown);
        if (!blocks.length) continue;
        const forNote = new Map();
        prepared.set(source, forNote);
        for (const block of blocks) {
            try {
                const result = await runSqlQuery(db, block.query);
                forNote.set(block.line, {
                    markdown: renderSqlTable(result, {
                        linkable,
                        sectionLevel: block.sectionLevel,
                    }),
                    rows: result.rows.length,
                    allowEmpty: block.allowEmpty,
                });
            } catch (err) {
                forNote.set(block.line, {
                    reason: String(err?.message ?? err).split("\n")[0],
                    allowEmpty: block.allowEmpty,
                });
            }
        }
    }
    return prepared;
}
