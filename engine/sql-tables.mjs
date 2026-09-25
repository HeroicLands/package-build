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
 * else's language, kept faithful to semantics nothing checked it against.
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

import { parseAddress, renderAddress, isAddressTuple } from "./address.mjs";
import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";
import { encodeAddresses } from "./address-values.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FENCE_LINE, parseHeaderArgs } from "./code-fences.mjs";
import { MARKET_CLASSES } from "./market-class.mjs";
import { parseMarkdownFile } from "./helpers.mjs";
// The record accessors only — see `engine/index-records.mjs`.
import { isNoteRecord, noteFile, sortKeysDeep } from "./index-records.mjs";

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
 * about a directive needs and what the expander uses to splice results
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
        const { language, args } = parseHeaderArgs(info);
        if (language !== "sql") {
            // Not ours, but still a fence: skip its body so a `sql` line inside
            // some other block is never read as a directive.
            i = close;
            continue;
        }
        if (close >= lines.length) continue;
        const level = Number(args["section-level"]);
        blocks.push({
            line: i,
            close,
            indent,
            query: lines.slice(i + 1, close).join("\n"),
            // `:allow-empty` says a table selecting nothing is intended.
            // Spelled on the fence rather than in the query because it is a
            // statement about this directive and not part of SQL.
            allowEmpty: args["allow-empty"] === true,
            sectionLevel: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2,
            // Every header argument, so a caller can read one this module makes
            // no use of — the point of taking a real grammar rather than a
            // regex per property.
            args,
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
 * ## A dependency is a schema
 *
 * A package that depends on another can tabulate what it depends on —
 * `FROM sohl.notes` — because each declared dependency's published index is
 * attached as a **schema** named after the package, with this package's own
 * notes staying at the unqualified `notes`.
 *
 * It is `FROM` rather than a fence property naming a file, for two reasons. A
 * path in authored content is a build artifact's name written into the corpus,
 * so renaming the artifact means sweeping every note that cites it — the
 * coupling the corpus move exists to undo. And *which dataset a query reads* is what
 * `FROM` is for: the same rule that keeps `_ref` and `_section` ordinary SQL,
 * visible where an author is already looking, rather than fence options.
 *
 * It costs no fetch. Every dependency's JSONL is already in the metadata cache
 * when a compile starts, because resolving addresses across packages needs it.
 *
 * @param {object[]} records - Content-index records, as
 *   {@link module:engine/content-index.collectContentIndex} returns them.
 * @param {object} [opts]
 * @param {string} [opts.dir] - Directory for the temporary file.
 * @param {Array<{id: string, file: string}>} [opts.dependencies] - Each
 *   declared dependency's cached index, attached as a schema named `id`.
 * @returns {Promise<{query: (sql: string) => Promise<object[]>,
 *   close: () => Promise<void>}>} The open database.
 */
export async function openNotesDatabase(records, { dir, dependencies = [], addressContext } = {}) {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const base = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "content-sql-"));
    fs.mkdirSync(base, { recursive: true });
    const jsonl = path.join(base, "notes.jsonl");
    fs.writeFileSync(
        jsonl,
        records.map((record) => JSON.stringify(sortKeysDeep(encodeAddresses(record)))).join("\n"),
    );

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run("SET threads=1");
    await createRelations(connection, jsonl);

    // One schema per declared dependency, so `FROM sohl.notes` reads the notes
    // that package published. Quoted, because a package id may carry a hyphen
    // (`sohl-thalorna`) and an unquoted identifier may not. Both views are
    // created, so `FROM sohl.entries` reads a dependency's stubs the same way.
    for (const dep of dependencies) {
        if (!dep?.id || !dep?.file || !fs.existsSync(dep.file)) continue;
        const schema = `"${String(dep.id).replace(/"/g, '""')}"`;
        await connection.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await createRelations(connection, dep.file, `${schema}.`);
    }

    // The market scale as a relation, so a table prints `village` beside the
    // number a note wrote without a second copy of the scale living in authored
    // content. Three columns, because the scale states three things and a join
    // that could only give back the name would send the next author to copy the
    // rest by hand.
    await connection.run(
        "CREATE VIEW market AS SELECT * FROM (VALUES " +
            MARKET_CLASSES.map(
                (c) =>
                    `(${c.value}, '${c.name.replace(/'/g, "''")}', ` +
                    `'${c.trade.replace(/'/g, "''")}')`,
            ).join(", ") +
            ") AS t(value, name, trade)",
    );

    // The stub-inclusive reading of `notes`, in a schema of its own. Putting it
    // on the search path re-runs an authored query with unqualified `notes`
    // resolving to `entries`, which is how a fence that would gain rows from
    // the wider relation is found without parsing anybody's SQL — see
    // {@link prepareSqlTables}.
    await connection.run(`CREATE SCHEMA IF NOT EXISTS ${WITH_STUBS_SCHEMA}`);
    await connection.run(`CREATE VIEW ${WITH_STUBS_SCHEMA}.notes AS SELECT * FROM entries`);

    // Whether this index holds a stub at all, asked once. A corpus with none
    // pays nothing for the comparison above, which is every package that has
    // not started writing them.
    const hasStubs =
        (
            await connection.runAndReadAll("SELECT count(*) AS n FROM entries WHERE state = 'stub'")
        ).getRowObjects()[0].n > 0;

    /**
     * How many rows a query loses by selecting `FROM notes` rather than
     * `FROM entries`.
     *
     * Answered by **running the author's query again** with unqualified `notes`
     * resolving to the stub-inclusive relation, rather than by reading the
     * `WHERE` clause. Reading it would mean parsing somebody else's SQL to work
     * out which types a fence covers, and being wrong about that is exactly the
     * silent failure the two views exist to prevent. Re-running is exact, and
     * it costs nothing at all for a corpus with no stub, which is the common
     * case and the only one that is asked twice for nothing.
     *
     * @param {string} sql - The query, as authored.
     * @param {number} rows - How many rows it selected as written.
     * @returns {Promise<number>} How many rows it would gain.
     */
    async function stubsExcluded(sql, rows) {
        if (!hasStubs) return 0;
        try {
            await connection.run(`SET search_path='${WITH_STUBS_SCHEMA}'`);
            const wider = await connection.runAndReadAll(sql);
            return Math.max(0, wider.getRowObjects().length - rows);
        } catch {
            // A query that cannot run under the wider relation has nothing to
            // say about stubs, and the failure it does have is reported by the
            // run that matters.
            return 0;
        } finally {
            await connection.run("RESET search_path");
        }
    }

    return {
        addressContext: addressContext ?? {
            package: records.find((record) => record.package)?.package,
            types: new Set(Object.keys(NOTE_VOCABULARY)),
            system: "none",
        },
        stubsExcluded,
        async query(sql) {
            const reader = await connection.runAndReadAll(sql);
            return {
                // From the result's schema, not from the rows: a query that
                // selects nothing still has columns, and reporting *that* is
                // what tells a stale query from an empty category.
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
 * The schema whose `notes` is the stub-inclusive relation.
 *
 * A name nothing authored would collide with, because it is put on the search
 * path underneath a query somebody else wrote.
 *
 * @type {string}
 */
const WITH_STUBS_SCHEMA = "__with_stubs";

/**
 * Create the two relations an index is read through, and the ladder one of them
 * derives.
 *
 * **`entries` is every row**, stubs included, plus a derived `state` column:
 *
 * ```text
 * address IS NULL                 → stub
 * list_contains(tags, 'draft')    → draft
 * otherwise                       → full
 * ```
 *
 * The derivation lives here and nowhere else. Nothing is stored in the index,
 * no note can author it, and no query repeats the `CASE` — the same rule that
 * keeps `_ref` and `_section` ordinary SQL rather than fence options. The stub
 * test is `address IS NULL` because the index carries no bodies, and it is
 * exact: an address is emitted if and only if the body is non-empty on a type
 * an empty body suppresses.
 *
 * **`notes` is `entries` without the stubs**, which is what every authored
 * fence already means by it. A `notes` that silently gained stubs would grow
 * every table selecting over it with nobody deciding, and a build that exits 0
 * and produces the wrong output is the costly kind of failure. Adopting stubs
 * in a given table is a one-word edit an author makes on purpose; the fences
 * that would gain rows are warned about rather than changed.
 *
 * **The columns are asked for rather than assumed.** `union_by_name` infers the
 * union of what the rows carry, so a corpus in which no note carries a tag has
 * no `tags` column at all and naming it would fail to bind — which is a real
 * index, not a hypothetical one. So the shape is described first and each half
 * of the ladder falls back to a constant where its column is absent.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} file - The JSONL to read.
 * @param {string} [prefix] - A schema to qualify the view names with.
 * @returns {Promise<void>}
 */
async function createRelations(connection, file, prefix = "") {
    const read = readJsonAuto(file);
    const described = await connection.runAndReadAll(`DESCRIBE ${read}`);
    const columns = new Set(described.getRowObjects().map((row) => String(row.column_name)));
    // A row with no address is a stub. With no address column anywhere, every
    // row is one — which is what an index of nothing but unaddressable notes
    // says, and saying it is more honest than calling them all full.
    const stub = columns.has("address") ? "address IS NULL" : "true";
    // `tags:` is authored by hand: a single tag may be a scalar rather than a
    // list, so both readings are asked.
    const draft =
        columns.has("tags") ?
            "COALESCE(list_contains(TRY_CAST(tags AS VARCHAR[]), 'draft'), false) " +
            "OR COALESCE(TRY_CAST(tags AS VARCHAR) = 'draft', false)"
        :   "false";
    await connection.run(
        `CREATE VIEW ${prefix}entries AS SELECT *, ` +
            `CASE WHEN ${stub} THEN 'stub' WHEN ${draft} THEN 'draft' ` +
            `ELSE 'full' END AS state FROM (${read})`,
    );
    await connection.run(
        `CREATE VIEW ${prefix}notes AS SELECT * FROM ${prefix}entries WHERE state <> 'stub'`,
    );
}

/**
 * The `read_json_auto` clause both the own-notes view and a dependency's use.
 *
 * Written once because the options are the load-bearing part, not the file:
 * `union_by_name` is what makes a heterogeneous corpus one relation — a `sohl:`
 * block differs by note type, and the inferred struct is the union of every
 * type's fields with `NULL` where a record lacks one. A dependency's index has
 * exactly the same shape and needs exactly the same reading.
 *
 * @param {string} file - The JSONL to read.
 * @returns {string} The `SELECT … FROM read_json_auto(…)` clause.
 */
function readJsonAuto(file) {
    return (
        `SELECT * FROM read_json_auto('${file.replace(/'/g, "''")}', ` +
        `format='newline_delimited', union_by_name=true, maximum_object_size=20000000)`
    );
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
    if (db.addressContext?.package) {
        for (const row of rows) {
            const value = row[RENDER_ALIASES.ref];
            if (!value) continue;
            const tuple = parseAddress(value, db.addressContext, { declared: true });
            if (tuple.reason) throw new Error(`SQL _ref is not an Address: ${value}`);
            row[RENDER_ALIASES.ref] = tuple;
        }
    }
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
 * **A result selecting nothing still renders its header and rule.** The finding
 * is the point, not withholding the output: an authored heading with an empty
 * table under it says the query ran and matched nothing, where a heading with
 * *nothing* under it reads as a page that failed to build.
 *
 * @param {{columns: string[], rows: object[]}} result - From
 *   {@link runSqlQuery}.
 * @param {object} [opts]
 * @param {(ref: string) => boolean} [opts.linkable] - Whether an address can be
 *   linked to; defaults to linking any non-empty `_ref`.
 * @param {number} [opts.sectionLevel=2] - Heading level for `_section`.
 * @returns {string} The markdown.
 */
export function renderSqlTable(
    result,
    { linkable = () => true, sectionLevel = 2, addressContext } = {},
) {
    const { columns, rows } = result;
    if (!columns.length) throw new Error("query selects no rendered column");

    // One group with no rows, so the header and the alignment rule are emitted
    // for a result that selects nothing.
    const groups = rows.length ? [] : [{ section: null, rows: [] }];
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
                const written = row[RENDER_ALIASES.ref];
                if (index !== 0 || !written) return text;
                const ref =
                    isAddressTuple(written) ? written : (
                        parseAddress(written, addressContext ?? {}, { declared: true })
                    );
                if (ref.reason)
                    throw new Error(`SQL _ref needs a complete Address context: ${written}`);
                if (!linkable(ref)) return text;
                // A wikilink's own separator is a literal `|`, written `\|`
                // inside a table cell, so the label must not carry one.
                return `[[${renderAddress(ref)}\\|${text.replace(/\\?\|/g, "/")}]]`;
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
 * those signatures intact, and it is the shape the index is heading for anyway —
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
 * **Keyed by note, then by the directive's ordinal within it** — not by its
 * line. The passes do not agree on what a body is: `walkMarkdownTree` trims it,
 * while the link checker strips the frontmatter fence and leaves the newlines
 * that followed, so the same directive sits on different lines in each. Its
 * position in the sequence of fences is the same in both.
 *
 * @returns {Promise<Map<string, object[]>>} Note to results, in document order,
 *   each carrying either a rendered `markdown` and its `rows`, or a `reason`.
 */
export async function prepareSqlTables(db, sources, { linkable } = {}) {
    const prepared = new Map();
    for (const { source, markdown } of sources) {
        const blocks = findSqlBlocks(markdown);
        if (!blocks.length) continue;
        const forNote = [];
        prepared.set(source, forNote);
        for (const block of blocks) {
            try {
                const result = await runSqlQuery(db, block.query);
                forNote.push({
                    markdown: renderSqlTable(result, {
                        linkable,
                        addressContext: db.addressContext,
                        sectionLevel: block.sectionLevel,
                    }),
                    rows: result.rows.length,
                    // How many rows this table would gain from the wider
                    // relation, so a fence that has not adopted stubs says so
                    // rather than quietly listing fewer settlements than the
                    // region has.
                    stubsExcluded: await db.stubsExcluded?.(block.query, result.rows.length),
                    allowEmpty: block.allowEmpty,
                });
            } catch (err) {
                forNote.push({
                    reason: String(err?.message ?? err).split("\n")[0],
                    allowEmpty: block.allowEmpty,
                });
            }
        }
    }
    return prepared;
}

/**
 * Answer every `sql` directive in a content tree.
 *
 * The one entry point each pass uses, so the compiler, the link checker and the
 * site build cannot disagree about what a table selects — the failure mode the
 * shared index
 * describes, where N passes each derive the corpus their own way.
 *
 * **Nothing is opened for a tree with no `sql` directive.** The corpus is still
 * written entirely in the retiring language, so until a table is converted this
 * costs one walk and no database at all — which is what lets every pass call it
 * unconditionally.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {object} [opts.config] - Resolved configuration, defaulting to ambient.
 * @param {readonly string[]} [opts.skipDirectories] - The walk's scope.
 * @param {object[]} [opts.records] - Index records the caller already derived.
 *   A command that also builds a link index holds them already, and deriving
 *   them twice is the duplicated-corpus failure this closes.
 * @returns {Promise<Map<string, object[]>|undefined>} Results by note path, or
 *   nothing when the tree has no such directive.
 */
export async function prepareTreeSqlTables(contentBase, { config, skipDirectories, records } = {}) {
    // Imported here rather than at module scope: the index reaches the pack
    // compilers through `manifest-emit` → `journals`, so a static import from a
    // module they load would close a cycle and leave `BasePackCompiler`
    // uninitialised for whichever module the runtime happened to load first.
    const { indexRecordsFor } = await import("./content-index.mjs");
    const indexRecords = records ?? indexRecordsFor({ contentBase, config, skipDirectories });

    // Which notes carry a directive, discovered over the same corpus every
    // other pass reads rather than over a walk of this one's own. The
    // body has to be read to find a fence — the index carries no note text —
    // but *which files* to read is no longer a second answer.
    //
    // `parseMarkdownFile` yields the body `walkMarkdownTree` yielded, trimmed
    // the same way, which matters: results are keyed by note and looked up by
    // the ordinal of the directive within it, so the two readings have to agree
    // about what a body is.
    const sources = [];
    for (const record of indexRecords) {
        if (!isNoteRecord(record)) continue;
        const absPath = noteFile(contentBase, record);
        const { body } = parseMarkdownFile(absPath);
        if (body && findSqlBlocks(body).length) sources.push({ source: absPath, markdown: body });
    }
    if (!sources.length) return undefined;
    // A cell links only where the address it would emit resolves, so a table
    // never ships a link the wikilink pass will then report dead.
    //
    // A documentation journal is left out, and that is the whole of the stub
    // rule here: its slug is its note's, so a written note supplies it anyway,
    // while a stub's journal would put back the very slug the stub withheld and
    // the cell would link to a page that does not exist.
    const addresses = new Set(
        indexRecords
            .filter((record) => !record.documents)
            .map((record) => record.documentation ?? record.address?.canonical)
            .map((target) => target && encodeAddresses(target))
            .filter(Boolean),
    );
    // Each declared dependency's published index, attached as its own schema so
    // a table can read `FROM <package>.notes`. Imported here for the
    // same cycle reason the index is, and tolerated when absent: a tree with no
    // `sql` directive never reaches this line, and one whose dependency has not
    // been fetched already fails earlier with a message naming the fetch.
    let dependencies = [];
    try {
        const { cachedMetadataIndexes } = await import("./metadata-index.mjs");
        const { loadPackConfig } = await import("./pack-config.mjs");
        dependencies = cachedMetadataIndexes(config ?? loadPackConfig());
    } catch {
        dependencies = [];
    }
    const db = await openNotesDatabase(indexRecords, { dependencies });
    try {
        return await prepareSqlTables(db, sources, {
            linkable: (ref) => addresses.has(renderAddress(ref)),
        });
    } finally {
        await db.close();
    }
}
