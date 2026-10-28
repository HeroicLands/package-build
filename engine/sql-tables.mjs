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
 * **The query is SQL, run by DuckDB.** Its syntax and evaluation follow the
 * database rather than a separate parser in the toolchain.
 *
 * **What SQL cannot say, the projection says.** Rendering a table is not a
 * relational operation: which column links, and where a section breaks, are
 * decisions about output. They are carried as **underscore-prefixed aliases** —
 * `_ref` and `_section` — which are ordinary SQL, need no fence options, and are
 * visible in the query where an author is already looking.
 *
 * @module
 */

import { parseAddress, readCanonicalKey, renderAddress, isAddressTuple } from "./address.mjs";
import { collectAnchors } from "./anchors.mjs";
import { keyCaseCollisionDiagnostics } from "./key-case-collisions.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { NOTE_VOCABULARY, isGmNote } from "./note-vocabulary.mjs";
import { encodeAddresses, flattenPublishedAddresses } from "./address-values.mjs";
import { EVENT_COLUMNS, EVENT_SORT_COLUMNS, eventCalendars, eventRows } from "./event-rows.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { NAME_COLUMNS, namesRows } from "./name-rows.mjs";
import { RUN_COLUMNS, ownerOf, runsRows } from "./run-rows.mjs";
import { NATIVE_COLUMNS, nativeRows } from "./encoding-lexicon.mjs";
import {
    GLOSSARY_COLUMNS,
    AFFIX_COLUMNS,
    FIELD_COLUMNS,
    LINEAGE_COLUMNS,
    ROW_INTEGER_COLUMNS,
    WORD_COLUMNS,
    glossaryRows,
    lineageRows,
    affixRows,
    fieldRows,
    wordRows,
} from "./word-rows.mjs";
import { DICTIONARY_COLUMNS, TERM_COLUMNS, dictionaryAndTermRows } from "./dictionary-rows.mjs";
import { LANGUAGE_COLUMN_TYPES, LANGUAGE_RELATIONS } from "./language-rows.mjs";
import { VERB_PERSON_FIELDS } from "./language-terms.mjs";
import { renderDictionary, renderGlossary } from "./dictionary-layout.mjs";
import { glossaryLanguage } from "./glossary-language.mjs";
import { languageNotesByCode } from "./note-language.mjs";
import { lexicalSectionsFor } from "./lexical-sections.mjs";
import { eventViewSections } from "./event-views.mjs";
import { appendGeneratedSections, joinSections } from "./generated-sections.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FENCE_LINE, parseHeaderArgs } from "./code-fences.mjs";
import { booleanAttribute } from "./extension-attributes.mjs";
import { findPageListBlocks, preparePageLists } from "./page-lists.mjs";
import { MARKET_CLASSES } from "./market-class.mjs";
import { parseMarkdownFile } from "./helpers.mjs";
import { sqlQueriesInMarkdown } from "./markdown-expressions.mjs";
// The record accessors only — see `engine/index-records.mjs`.
import { authoredFrontmatter, isNoteRecord, noteFile, sortKeysDeep } from "./index-records.mjs";
import { nameSortOf } from "./name-sort.mjs";

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

/**
 * The attributes an SQL fence takes, with what each one is for.
 *
 * **This is the one list.** The fence is validated against it and the authoring
 * document is checked against it, so an attribute added here is one the document
 * must describe, and anything else an author writes is reported by name.
 *
 * @type {Readonly<Record<string, Readonly<{value: string, default: string, summary: string}>>>}
 */
export const SQL_FENCE_ATTRIBUTES = Object.freeze({
    "allow-empty": Object.freeze({
        value: "`true` or `false`",
        default: "`false`",
        summary:
            "Whether a query selecting no rows is allowed. A zero-row result is a finding " +
            "otherwise, because a table that silently prints nothing is the commonest way a " +
            "query goes wrong unnoticed.",
    }),
    "section-level": Object.freeze({
        value: "an integer from 1 through 6",
        default: "`2`",
        summary:
            "The heading level given to each group a `_section` column creates, and to each " +
            "letter of a dictionary or a glossary.",
    }),
    key: Object.freeze({
        value: "`true`, `false` or `only`",
        default: "`true`",
        summary:
            "Whether a dictionary or a glossary prints its key, the line of abbreviations it " +
            "uses. `false` leaves the key out, for a page that states it once above several " +
            "fences; `only` prints the key for the fence's rows and nothing else, which is how " +
            "that page states it. Refused on a fence set as a table.",
    }),
    layout: Object.freeze({
        value: "`table`, `dictionary` or `glossary`",
        default: "`table`",
        summary:
            "How the result is set: as a table; as a dictionary of words, read from the " +
            "`dictionary` relation; or as a glossary of terms, read from the `terms` relation. " +
            "A dictionary and a glossary are one paragraph per entry under letter headings, and " +
            "each needs the `name`, `senses` and `usage` columns.",
    }),
});

/** The values `layout` takes. */
const SQL_LAYOUTS = Object.freeze(["table", "dictionary", "glossary"]);

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
 *   allowEmpty: boolean, sectionLevel: number, showKey: boolean|"only", layout: string, block: string}>} One entry per
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
        const { language, args, problems } = parseHeaderArgs(info);
        if (language !== "sql") {
            // Not ours, but still a fence: skip its body so a `sql` line inside
            // some other block is never read as a directive.
            i = close;
            continue;
        }
        if (close >= lines.length) continue;
        const level = Number(args["section-level"] ?? 2);
        const errors = [...problems];
        for (const key of Object.keys(args)) {
            if (!Object.hasOwn(SQL_FENCE_ATTRIBUTES, key))
                errors.push(`${key} is not an SQL fence attribute`);
        }
        let allowEmpty = false;
        if (Object.hasOwn(args, "allow-empty")) {
            try {
                allowEmpty = booleanAttribute(args["allow-empty"], "allow-empty");
            } catch (error) {
                errors.push(error.message);
            }
        }
        /** @type {boolean|"only"} */
        let showKey = true;
        if (Object.hasOwn(args, "key")) {
            if (args.key === "only") showKey = "only";
            else if (args.key === "true" || args.key === "false") showKey = args.key === "true";
            else errors.push("key needs the literal value true, false or only");
        }
        if (!Number.isInteger(level) || level < 1 || level > 6)
            errors.push("section-level needs an integer from 1 through 6");
        const layout = String(args.layout ?? "table");
        if (!SQL_LAYOUTS.includes(layout))
            errors.push(`layout is \`table\`, \`dictionary\` or \`glossary\`, not \`${layout}\``);
        else if (Object.hasOwn(args, "key") && layout === "table")
            errors.push(
                "key sets a dictionary's or a glossary's key, and this fence's layout is `table`",
            );
        blocks.push({
            line: i,
            close,
            indent,
            query: lines.slice(i + 1, close).join("\n"),
            allowEmpty,
            sectionLevel: level,
            showKey,
            layout,
            problems: errors,
            args,
            block: lines.slice(i, close + 1).join("\n"),
        });
        i = close;
    }
    return blocks;
}

/** Keep encoding source keys as case-sensitive values in the SQL projection.
 * The canonical index retains its authored mapping object; DuckDB structs
 * cannot distinguish a and A as field names.
 */
function sqlRecord(record) {
    const mappings = record?.data?.mappings;
    if (
        record?.type !== "doc" ||
        !mappings ||
        typeof mappings !== "object" ||
        Array.isArray(mappings)
    )
        return record;
    return {
        ...record,
        data: {
            ...record.data,
            mappings: Object.entries(mappings).map(([from, value]) => ({
                from,
                codes: Array.isArray(value) ? value : [value],
            })),
        },
    };
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
 * @param {object} [opts.addressContext] - Address resolution context.
 * @param {"all"|"public"} [opts.audience] - Whether to exclude GM notes from
 *   local and dependency relations.
 * @param {string} [opts.contentBase] - The directory the records' paths are
 *   relative to, so a refused key is reported at its file and line.
 * @returns {Promise<{query: (sql: string) => Promise<object[]>,
 *   close: () => Promise<void>}>} The open database.
 */
export async function openNotesDatabase(
    records,
    { dir, dependencies = [], addressContext, audience = "all", contentBase } = {},
) {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const base = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "content-sql-"));
    fs.mkdirSync(base, { recursive: true });
    const jsonl = path.join(base, "notes.jsonl");
    const encoded = records.map((record) => sqlRecord(encodeAddresses(record)));

    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run("SET threads=1");
    try {
        await createRelations(connection, jsonl, encoded, "", audience);
    } catch (err) {
        // DuckDB names the clashing key but not the notes that spell it.
        if (/Duplicate name ".*" in struct/.test(String(err?.message))) {
            const lines = keyCaseCollisionDiagnostics(encoded, { contentBase });
            if (lines.length) {
                const located = new Error(lines.join("\n"));
                /** @type {any} */ (located).located = true;
                throw located;
            }
        }
        throw err;
    }
    await createEventRelation(connection, path.join(base, "events.jsonl"), encoded, "", audience);
    await createNameRelation(connection, path.join(base, "names.jsonl"), encoded, "", audience);
    await createRunRelation(connection, path.join(base, "runs.jsonl"), encoded, "", audience);
    await createNativeRelation(connection, path.join(base, "natives.jsonl"), encoded, "", audience);
    await createWordRelations(connection, path.join(base, "notes"), encoded, "", audience);

    // One schema per declared dependency, so `FROM sohl.notes` reads the notes
    // that package published. Quoted, because a package id may carry a hyphen
    // (`sohl-thalorna`) and an unquoted identifier may not. Both views are
    // created, so `FROM sohl.entries` reads a dependency's stubs the same way.
    for (const dep of dependencies) {
        if (!dep?.id || !dep?.file || !fs.existsSync(dep.file)) continue;
        const schema = `"${String(dep.id).replace(/"/g, '""')}"`;
        await connection.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        // A published index writes each Address as an object; a fence compares
        // the string an author writes, so each is flattened to it on load.
        const flat = path.join(
            base,
            `dependency-${String(dep.id).replace(/[^a-z0-9]/gi, "_")}.jsonl`,
        );
        const depRecords = fs
            .readFileSync(dep.file, "utf8")
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => sqlRecord(flattenPublishedAddresses(JSON.parse(line))));
        await createRelations(connection, flat, depRecords, `${schema}.`, audience);
        await createEventRelation(
            connection,
            flat.replace(/\.jsonl$/, "-events.jsonl"),
            depRecords,
            `${schema}.`,
            audience,
        );
        await createNameRelation(
            connection,
            flat.replace(/\.jsonl$/, "-names.jsonl"),
            depRecords,
            `${schema}.`,
            audience,
        );
        await createRunRelation(
            connection,
            flat.replace(/\.jsonl$/, "-runs.jsonl"),
            depRecords,
            `${schema}.`,
            audience,
        );
        await createNativeRelation(
            connection,
            flat.replace(/\.jsonl$/, "-natives.jsonl"),
            depRecords,
            `${schema}.`,
            audience,
        );
        await createWordRelations(
            connection,
            flat.replace(/\.jsonl$/, ""),
            depRecords,
            `${schema}.`,
            audience,
        );
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
    for (const relation of [
        "events",
        "names",
        "runs",
        "words",
        "affixes",
        "fields",
        "glossary",
        "language_lineage",
        "dictionary",
        "terms",
        ...LANGUAGE_RELATIONS.map(([name]) => name),
    ])
        await connection.run(
            `CREATE VIEW ${WITH_STUBS_SCHEMA}.${relation} AS SELECT * FROM main.${relation}`,
        );

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
            system: "note",
        },
        stubsExcluded,
        // Each language code's note, for a page whose language is read from
        // its frontmatter.
        languageNotes: languageNotesByCode(encoded, (record) =>
            (
                typeof record.package === "string" &&
                typeof record.type === "string" &&
                typeof record.shortcode === "string"
            ) ?
                renderAddress({
                    package: record.package,
                    system: "note",
                    type: record.type,
                    shortcode: record.shortcode,
                })
            :   undefined,
        ),
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
            connection.closeSync();
            instance.closeSync();
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
 * The record with its `nameSort` stated: the declared `name.sort`, otherwise
 * `name.full`. A record with no name has none.
 *
 * @param {object} record - An index record.
 * @returns {object} The record, with `nameSort` where it has a name.
 */
function withNameSort(record) {
    const key = nameSortOf(record);
    return key === undefined ? record : { ...record, nameSort: key };
}

/**
 * Create the two relations an index is read through, and the ladder one of them
 * derives.
 *
 * **`entries` is every row**, stubs included, plus a derived `nameSort` column
 * (the note's `name.sort`, otherwise its `name.full`) and a derived `state`
 * column:
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
 * @param {string} file - Where to write the audience's JSONL.
 * @param {object[]} records - Complete index records, every Address a string.
 * @param {string} [prefix] - A schema to qualify the view names with.
 * @param {"all"|"public"} [audience] - Whether to leave out GM notes.
 * @returns {Promise<void>}
 */
async function createRelations(connection, file, records, prefix = "", audience = "all") {
    // Every record contributes its schema; only visible records contribute rows.
    fs.writeFileSync(
        file,
        records
            .map((record) =>
                JSON.stringify({
                    record: sortKeysDeep(withNameSort(record)),
                    visible: audience !== "public" || !isGmNote(record),
                }),
            )
            .join("\n"),
    );
    const source = readJsonAuto(file);
    const read = records.length ? `SELECT record.* FROM (${source}) WHERE visible` : source;
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
    await createTableFromFile(
        connection,
        `${prefix}entries`,
        `SELECT *, CASE WHEN ${stub} THEN 'stub' WHEN ${draft} THEN 'draft' ` +
            `ELSE 'full' END AS state FROM (${read})`,
    );
    await connection.run(
        `CREATE VIEW ${prefix}notes AS SELECT * FROM ${prefix}entries WHERE state <> 'stub'`,
    );
}

/**
 * Create the `events` relation: one row per `data.events` entry, across every
 * note type that carries events, with the columns
 * {@link module:engine/event-rows.EVENT_COLUMNS} names.
 *
 * Its rows are derived from the same records `entries` reads, stubs included —
 * an event a stub states is still an event — and a GM note's events are left
 * out on a public surface exactly as the note is. A corpus with no event at all
 * still has the relation, empty, so a fence over it reports no rows rather than
 * a missing table.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} file - Where to write the rows.
 * @param {object[]} records - Index records, every Address a string.
 * @param {string} prefix - A schema to qualify the view name with.
 * @param {"all"|"public"} audience - Whether to leave out GM notes.
 * @returns {Promise<void>}
 */
async function createEventRelation(connection, file, records, prefix, audience) {
    const visible = audience === "public" ? records.filter((record) => !isGmNote(record)) : records;
    const rows = eventRows(visible, reckoningContext({ notes: records }), eventCalendars(records));
    if (!rows.length) {
        const columns = EVENT_COLUMNS.map((column) => {
            const type = EVENT_SORT_COLUMNS.includes(column) ? "DOUBLE" : "VARCHAR";
            return `NULL::${type} AS "${column}"`;
        });
        await connection.run(
            `CREATE VIEW ${prefix}events AS SELECT ${columns.join(", ")} WHERE false`,
        );
        return;
    }
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
    // `whenIn` and `untilIn` are keyed by calendar Address, and read as structs
    // whatever their number of keys, so `whenIn['<calendar>']` always binds.
    await createTableFromFile(connection, `${prefix}events`, readJsonAuto(file));
}

/**
 * Create authored name rows from own-note records, with audience filtering and
 * fixed scalar types even when every optional classification is null.
 * @param {object} connection - An open DuckDB connection.
 * @param {string} file - Where to write the rows.
 * @param {object[]} records - Index records, every Address a string.
 * @param {string} prefix - A schema to qualify the relation name with.
 * @param {"all"|"public"} audience - Whether to leave out GM notes.
 * @returns {Promise<void>}
 */
async function createNameRelation(connection, file, records, prefix, audience) {
    const rows = namesRows(
        audience === "public" ? records.filter((record) => !isGmNote(record)) : records,
    );
    const columnTypes = NAME_COLUMNS.map((column) => [
        column,
        column === "line" || column === "column" ? "BIGINT" : "VARCHAR",
    ]);
    if (!rows.length) {
        const columns = columnTypes.map(([column, type]) => `NULL::${type} AS "${column}"`);
        await connection.run(
            `CREATE VIEW ${prefix}names AS SELECT ${columns.join(", ")} WHERE false`,
        );
        return;
    }
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
    const schema = columnTypes.map(([column, type]) => `'${column}': '${type}'`).join(", ");
    await createTableFromFile(
        connection,
        `${prefix}names`,
        `SELECT * FROM read_json('${file.replace(/'/g, "''")}', columns={${schema}}, ` +
            "format='newline_delimited', maximum_object_size=20000000)",
    );
}

/**
 * Create the `runs` relation: one row per span, div and verse div an own
 * note marks with `lang=`, `font=` or `enc=`, with the columns
 * {@link module:engine/run-rows.RUN_COLUMNS} names. The columns are declared
 * rather than inferred, so every value stays a string and none becomes a
 * struct key whose case DuckDB folds.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} file - Where to write the rows.
 * @param {object[]} records - Index records, every Address a string.
 * @param {string} prefix - A schema to qualify the relation name with.
 * @param {"all"|"public"} audience - Whether to leave out GM notes.
 * @returns {Promise<void>}
 */
async function createRunRelation(connection, file, records, prefix, audience) {
    const rows = runsRows(
        audience === "public" ? records.filter((record) => !isGmNote(record)) : records,
    );
    await createTypedRelation(connection, file, `${prefix}runs`, rows, RUN_COLUMNS, [
        "line",
        "column",
    ]);
}

/** Project authored native entries into the natives SQL relation. */
async function createNativeRelation(connection, file, records, prefix, audience) {
    const visible = audience === "public" ? records.filter((record) => !isGmNote(record)) : records;
    await createTypedRelation(
        connection,
        file,
        `${prefix}natives`,
        nativeRows(visible),
        NATIVE_COLUMNS,
        ["word", "native"],
    );
}

/**
 * Create a relation whose columns are declared rather than inferred, so every
 * value stays a string or a number and none becomes a struct key whose case
 * DuckDB folds. An empty relation keeps its columns.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} file - Where to write the rows.
 * @param {string} name - The relation, schema-qualified where it is a dependency's.
 * @param {object[]} rows - Its rows.
 * @param {readonly string[]} columns - Its columns, in order.
 * @param {readonly string[]} integers - The columns that are `BIGINT`; the
 *   rest are `VARCHAR`.
 * @returns {Promise<void>}
 */
async function createTypedRelation(connection, file, name, rows, columns, integers) {
    const columnTypes = columns.map((column) => [
        column,
        integers.includes(column) ? "BIGINT" : "VARCHAR",
    ]);
    if (!rows.length) {
        const nulls = columnTypes.map(([column, type]) => `NULL::${type} AS "${column}"`);
        await connection.run(`CREATE VIEW ${name} AS SELECT ${nulls.join(", ")} WHERE false`);
        return;
    }
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
    const schema = columnTypes.map(([column, type]) => `'${column}': '${type}'`).join(", ");
    await createTableFromFile(
        connection,
        name,
        `SELECT * FROM read_json('${file.replace(/'/g, "''")}', columns={${schema}}, ` +
            "format='newline_delimited', maximum_object_size=20000000)",
    );
}

/**
 * Create a relation as a table, so the JSONL behind it is parsed once when the
 * database opens rather than on every query. A view over `read_json_auto`
 * re-reads and re-parses the whole file for each query that touches it.
 *
 * Every relation built from a file goes through here; relations derived from
 * other relations stay views over them.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} name - The relation name, schema-qualified if needed.
 * @param {string} select - The `SELECT` that reads the file.
 * @returns {Promise<void>}
 */
async function createTableFromFile(connection, name, select) {
    await connection.run(`CREATE TABLE ${name} AS ${select}`);
}

/**
 * Create the `words`, `affixes`, `fields`, `glossary`, `language_lineage`,
 * `dictionary` and `terms` relations: one row per language note's word, one per
 * its affix, one per its field, one per culture's or
 * affiliation's glossary entry as authored, one per language and ancestor, one
 * per word per language it is listed under, and one per term per owning note,
 * with the columns {@link module:engine/word-rows.WORD_COLUMNS},
 * {@link module:engine/word-rows.AFFIX_COLUMNS},
 * {@link module:engine/word-rows.FIELD_COLUMNS},
 * {@link module:engine/word-rows.GLOSSARY_COLUMNS},
 * {@link module:engine/word-rows.LINEAGE_COLUMNS},
 * {@link module:engine/dictionary-rows.DICTIONARY_COLUMNS} and
 * {@link module:engine/dictionary-rows.TERM_COLUMNS} name; then each relation
 * of a language's register, sounds, history and names, as
 * {@link module:engine/language-rows} derives them.
 *
 * Derived from the same records `entries` reads, stubs included, and a GM
 * note's rows are left out on a public surface exactly as the note is, while a
 * glossary entry's language still resolves through it. A corpus with no word
 * or no glossary entry still has the relation, empty.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} stem - Where to write the rows, before `-words.jsonl`,
 *   `-glossary.jsonl`, `-lineage.jsonl`, `-dictionary.jsonl` and `-terms.jsonl`.
 * @param {object[]} records - Index records, every Address a string.
 * @param {string} prefix - A schema to qualify the view names with.
 * @param {"all"|"public"} audience - Whether to leave out GM notes.
 * @returns {Promise<void>}
 */
async function createWordRelations(connection, stem, records, prefix, audience) {
    const visible = audience === "public" ? records.filter((record) => !isGmNote(record)) : records;
    await createRowRelation(
        connection,
        `${stem}-words.jsonl`,
        wordRows(visible, records),
        `${prefix}words`,
        WORD_COLUMNS,
    );
    await createRowRelation(
        connection,
        `${stem}-affixes.jsonl`,
        affixRows(visible),
        `${prefix}affixes`,
        AFFIX_COLUMNS,
    );
    await createRowRelation(
        connection,
        `${stem}-fields.jsonl`,
        fieldRows(visible),
        `${prefix}fields`,
        FIELD_COLUMNS,
    );
    await createRowRelation(
        connection,
        `${stem}-glossary.jsonl`,
        glossaryRows(visible, records),
        `${prefix}glossary`,
        GLOSSARY_COLUMNS,
    );
    await createRowRelation(
        connection,
        `${stem}-lineage.jsonl`,
        lineageRows(visible, records),
        `${prefix}language_lineage`,
        LINEAGE_COLUMNS,
    );
    const { dictionary, terms } = dictionaryAndTermRows(visible, records);
    const dictionaryTypes = {
        etymology:
            "STRUCT(kind VARCHAR, language VARCHAR, language_tag VARCHAR, form VARCHAR, " +
            "parts STRUCT(form VARCHAR, gloss VARCHAR)[], root VARCHAR, frame VARCHAR)",
        senses: "STRUCT(text VARCHAR, bodies VARCHAR[])[]",
        usage: "VARCHAR[]",
        depth: "BIGINT",
        verbs: `STRUCT(invariant BOOLEAN, replaces VARCHAR, persons STRUCT(${VERB_PERSON_FIELDS.map((person) => `"${person.name}" VARCHAR`).join(", ")}))`,
    };
    const dictionaryFile = `${stem}-dictionary.jsonl`;
    if (dictionary.length) {
        // Only the dictionary's declared schema: optional patterns must not
        // change its nested/list types when a corpus has no stated grammar.
        fs.writeFileSync(dictionaryFile, dictionary.map((row) => JSON.stringify(row)).join("\n"));
        const columns = DICTIONARY_COLUMNS.map(
            (column) =>
                `CAST("${column}" AS ${dictionaryTypes[column] ?? "VARCHAR"}) AS "${column}"`,
        );
        await createTableFromFile(
            connection,
            `${prefix}dictionary`,
            `SELECT ${columns.join(", ")} FROM (${readJsonAuto(dictionaryFile)})`,
        );
    } else {
        await createRowRelation(
            connection,
            dictionaryFile,
            dictionary,
            `${prefix}dictionary`,
            DICTIONARY_COLUMNS,
            dictionaryTypes,
        );
    }
    const termTypes = {
        senses: "STRUCT(text VARCHAR, bodies VARCHAR[])[]",
        usage: "VARCHAR[]",
        common: "BOOLEAN",
        origins: "VARCHAR[]",
        cultures: "VARCHAR[]",
    };
    const termsFile = `${stem}-terms.jsonl`;
    if (terms.length) {
        // Terms retain declared types even when every value of a column is null.
        fs.writeFileSync(termsFile, terms.map((row) => JSON.stringify(row)).join("\n"));
        const columns = TERM_COLUMNS.map(
            (column) => `CAST("${column}" AS ${termTypes[column] ?? "VARCHAR"}) AS "${column}"`,
        );
        await createTableFromFile(
            connection,
            `${prefix}terms`,
            `SELECT ${columns.join(", ")} FROM (${readJsonAuto(termsFile)})`,
        );
    } else {
        await createRowRelation(
            connection,
            termsFile,
            terms,
            `${prefix}terms`,
            TERM_COLUMNS,
            termTypes,
        );
    }
    for (const [name, rowsOf, columns] of LANGUAGE_RELATIONS)
        await createRowRelation(
            connection,
            `${stem}-${name}.jsonl`,
            rowsOf(visible, records),
            `${prefix}${name}`,
            columns,
            LANGUAGE_COLUMN_TYPES[name],
        );
}

/**
 * Create one derived relation from its rows, or an empty one of its columns
 * when there are none, so a fence over it reports no rows rather than a
 * missing table.
 *
 * @param {object} connection - An open DuckDB connection.
 * @param {string} file - Where to write the rows.
 * @param {object[]} rows - The rows, each carrying every column.
 * @param {string} view - The qualified view name.
 * @param {readonly string[]} columns - Its columns, for the empty case.
 * @param {Readonly<Record<string, string>>} [types] - Each column's type, for
 *   the empty case; a column it leaves out is text. Without it, a whole-number
 *   column is a number and every other column text. A `DOUBLE` column is cast
 *   whatever the rows hold, because a fraction written whole reads as an
 *   integer.
 * @returns {Promise<void>}
 */
async function createRowRelation(connection, file, rows, view, columns, types) {
    if (!rows.length) {
        const typed = columns.map((column) => {
            const type =
                types ? (types[column] ?? "VARCHAR")
                : ROW_INTEGER_COLUMNS.includes(column) ? "BIGINT"
                : "VARCHAR";
            return `NULL::${type} AS "${column}"`;
        });
        await connection.run(`CREATE VIEW ${view} AS SELECT ${typed.join(", ")} WHERE false`);
        return;
    }
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
    const fractions = Object.entries(types ?? {})
        .filter(([, type]) => type === "DOUBLE")
        .map(([column]) => `CAST("${column}" AS DOUBLE) AS "${column}"`);
    const source = readJsonAuto(file);
    await createTableFromFile(
        connection,
        view,
        fractions.length ? `SELECT * REPLACE (${fractions.join(", ")}) FROM (${source})` : source,
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
 * `map_inference_threshold=-1` keeps every object a struct. Left at its default,
 * DuckDB reads an object whose keys are sparsely spread across rows (the mean
 * share of rows carrying a key falls under `field_appearance_threshold`) as a
 * map, so `data.<key>` changes meaning with the corpus: one more field on one
 * note can turn a plain comparison into a JSON conversion error.
 *
 * @param {string} file - The JSONL to read.
 * @returns {string} The `SELECT … FROM read_json_auto(…)` clause.
 */
function readJsonAuto(file) {
    return (
        `SELECT * FROM read_json_auto('${file.replace(/'/g, "''")}', ` +
        `format='newline_delimited', union_by_name=true, maximum_object_size=20000000, ` +
        `map_inference_threshold=-1)`
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
 * what a `tags` column means.
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
 * forty near-identical blocks it would otherwise take.
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
 * @param {object} [opts.addressContext] - Address resolution context.
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
 * @param {Array<{source: string, markdown: string, frontmatter?: object, authoredSqlBlocks?: number}>} sources -
 *   The bodies to scan. `joinGeneratedSections` records the number of authored
 *   fences; following generated event fences need no stub comparison.
 * @param {object} [opts]
 * @param {(ref: string) => boolean} [opts.linkable] - Passed to
 *   {@link renderSqlTable}.
 * @param {(source: string, frontmatter?: object) => string|undefined} [opts.pageLanguage] -
 *   The language of the note a body belongs to, which a dictionary or a
 *   glossary does not tag; absent, it is read from the body's frontmatter.
 * @param {object[]} [opts.records] - Content-index records, narrowed to the
 *   audience this surface publishes to. Given them, the result also carries
 *   `pageLists`, so one prepared object answers every corpus-reading directive
 *   a body can hold and a caller looks results up in one place.
 * **Keyed by note, then by the directive's ordinal within it** — not by its
 * line. The passes do not agree on what a body is: `walkMarkdownTree` trims it,
 * while the link checker strips the frontmatter fence and leaves the newlines
 * that followed, so the same directive sits on different lines in each. Its
 * position in the sequence of fences is the same in both.
 *
 * @returns {Promise<Map<string, object[]>>} Note to results, in document order,
 *   each carrying either a rendered `markdown` and its `rows`, or a `reason`.
 */
export async function prepareSqlTables(db, sources, { linkable, records, pageLanguage } = {}) {
    const prepared = new Map();
    if (records) prepared.pageLists = preparePageLists(records, sources);
    // The corpus does not change while a preparation runs, so a query written
    // twice has one answer in each stub context. The normal result and the
    // inclusive comparison occupy separate fields of the same cache entry.
    // Each result use gets a copy because a caller rewrites the rows.
    const answers = new Map();
    const reader = {
        ...db,
        async query(sql) {
            if (!answers.has(sql)) answers.set(sql, { result: await db.query(sql) });
            return structuredClone(answers.get(sql).result);
        },
        async stubsExcluded(sql, rows) {
            const answer = answers.get(sql);
            if (!Object.hasOwn(answer, "excluded"))
                answer.excluded = await db.stubsExcluded?.(sql, rows);
            return answer.excluded;
        },
    };
    let labels;
    const labelOf = (address) => labels.get(address);
    const languageOf =
        pageLanguage ?? ((_source, frontmatter) => frontmatterLanguage(frontmatter, db));
    for (const { source, markdown, frontmatter, authoredSqlBlocks = Infinity } of sources) {
        const blocks = findSqlBlocks(markdown);
        if (!blocks.length) continue;
        const forNote = [];
        prepared.set(source, forNote);
        for (const [ordinal, block] of blocks.entries()) {
            try {
                if (block.problems.length) throw new Error(block.problems.join("; "));
                const result = await runSqlQuery(reader, block.query);
                const options = {
                    linkable,
                    addressContext: db.addressContext,
                    sectionLevel: block.sectionLevel,
                };
                const setAs =
                    block.layout === "dictionary" ? renderDictionary
                    : block.layout === "glossary" ? renderGlossary
                    : undefined;
                if (setAs) labels ??= await noteLabels(db);
                forNote.push({
                    markdown:
                        setAs ?
                            setAs(result, {
                                ...options,
                                labelOf,
                                showKey: block.showKey,
                                pageLanguage: languageOf(source, frontmatter),
                                pageOwner:
                                    (
                                        typeof frontmatter?.type === "string" &&
                                        typeof frontmatter.shortcode === "string" &&
                                        db.addressContext?.package
                                    ) ?
                                        renderAddress({
                                            package: db.addressContext.package,
                                            system: "note",
                                            type: frontmatter.type,
                                            shortcode: frontmatter.shortcode,
                                        })
                                    :   undefined,
                                entryAnchors: false,
                            })
                        :   renderSqlTable(result, options),
                    rows: result.rows.length,
                    // How many rows this table would gain from the wider
                    // relation, so a fence that has not adopted stubs says so
                    // rather than quietly listing fewer settlements than the
                    // region has.
                    // Generated event views read entries and events, whose
                    // meaning is identical in both stub contexts.
                    stubsExcluded:
                        ordinal >= authoredSqlBlocks ? 0 : (
                            await reader.stubsExcluded(block.query, result.rows.length)
                        ),
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
 * Every note's `name.full`, by its Address in the `note` system, across this
 * package's relations and each dependency's: what a dictionary prints for a
 * citation, a body and a language.
 *
 * @param {object} db - From {@link openNotesDatabase}.
 * @returns {Promise<Map<string, string>>} Address to name.
 */
async function noteLabels(db) {
    const labels = new Map();
    let schemas = [];
    try {
        schemas = (
            await db.query(
                "SELECT DISTINCT schema_name FROM duckdb_tables() WHERE table_name = 'entries' " +
                    "ORDER BY schema_name",
            )
        ).rows.map((row) => String(row.schema_name));
    } catch {
        return labels;
    }
    for (const schema of schemas) {
        try {
            const { rows } = await db.query(
                `SELECT package, type, shortcode, name.full AS label ` +
                    `FROM "${schema.replace(/"/g, '""')}".entries WHERE name.full IS NOT NULL`,
            );
            for (const row of rows) {
                if (!row.package || !row.type || !row.shortcode) continue;
                const key = renderAddress({
                    package: String(row.package),
                    system: "note",
                    type: String(row.type),
                    shortcode: String(row.shortcode),
                });
                if (!labels.has(key)) labels.set(key, String(row.label));
            }
        } catch {
            // A relation whose records carry no name has no label to give.
        }
    }
    return labels;
}

/**
 * The language a note's frontmatter says it is in: a language note's own
 * Address, else the note of its language — the code the content index derived
 * for it where the frontmatter is its record, else its own `data.lang`.
 *
 * @param {object|undefined} frontmatter - The note's frontmatter or record.
 * @param {object} db - From {@link openNotesDatabase}, for its Address context
 *   and its language notes.
 * @returns {string|undefined} The language's Address.
 */
function frontmatterLanguage(frontmatter, db) {
    if (!frontmatter || typeof frontmatter !== "object") return undefined;
    const context = db.addressContext ?? {};
    if (
        String(frontmatter.type ?? "").toLowerCase() === "skill" &&
        frontmatter.subType === "language" &&
        context.package &&
        typeof frontmatter.shortcode === "string"
    )
        return renderAddress({
            package: context.package,
            system: "note",
            type: "skill",
            shortcode: frontmatter.shortcode,
        });
    const code = frontmatter.lang ?? frontmatter.data?.lang;
    return typeof code === "string" ? db.languageNotes?.get(code) : undefined;
}

/** Evaluate scalar SQL calls before synchronous Markdown renderers run. */
export async function prepareInlineSqlExpressions(db, sources) {
    const byNote = new Map();
    const cache = new Map();
    for (const { source, markdown, frontmatter } of sources) {
        const queries = sqlQueriesInMarkdown(markdown, frontmatter);
        if (!queries.length) continue;
        const values = new Map();
        byNote.set(source, values);
        for (const query of queries) {
            if (!cache.has(query)) {
                try {
                    const result = await db.query(query);
                    if (result.columnNames.length !== 1 || result.rows.length !== 1)
                        throw new RangeError("scalar SQL needs exactly one column and one row");
                    const value = result.rows[0][result.columnNames[0]];
                    if (value === null || value === undefined || value === "")
                        throw new RangeError("scalar SQL result is empty");
                    if (
                        value !== null &&
                        !["string", "number", "boolean", "bigint"].includes(typeof value)
                    )
                        throw new TypeError(
                            "scalar SQL result must be a number, string, Boolean, or null",
                        );
                    cache.set(query, { value });
                } catch (error) {
                    cache.set(query, { error: String(error?.message ?? error).split("\n")[0] });
                }
            }
            values.set(query, cache.get(query));
        }
    }
    return byNote;
}

/**
 * Each note's generated sections — the derived lists and the event views — see
 * {@link module:engine/generated-sections}.
 *
 * @param {object|undefined} db - From {@link openNotesDatabase}, over
 *   `records`; absent, no event view is asked for.
 * @param {object[]} records - Content-index records, of the audience the
 *   surface publishes to.
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {string} [opts.only] - One note file to give sections to; absent,
 *   every note.
 * @param {Map<string, object>} [opts.foreignIndex] - The fetched indexes, whose
 *   places, affiliations and works the lists take in.
 * @param {object} [opts.config] - The resolved configuration.
 * @param {Map<string, Map<string, string>>} [opts.derived] - The derived
 *   lists, from an earlier call over the same records, which are not derived
 *   again.
 * @param {object[]} [opts.all=records] - Complete records for lexical lineage
 *   traversal through providers outside the surface's audience.
 * @returns {Promise<{sections: Map<string, string>, views: Set<string>,
 *   derived: Map<string, Map<string, string>>,
 *   lexical: Map<string, import("./lexical-sections.mjs").LexicalSection[]>}>} Note file to its sections,
 *   joined in order; the files whose sections hold an event view's fence; and
 *   the derived lists alone.
 */
export async function generatedSectionsFor(
    db,
    records,
    contentBase,
    { only, foreignIndex, config, derived: given, all = records } = {},
) {
    const notes = records.filter((record) => isNoteRecord(record));
    const fileOf = (record) => noteFile(contentBase, record);
    // Imported here for the cycle reason the index is: the derivations read
    // the map world, which reaches the content index.
    const derived =
        given ??
        (await import("./derived-sections.mjs")).derivedSections(notes, {
            fileOf,
            foreignIndex,
            config,
            only,
        });
    const views = db ? await eventViewSections(db, notes, fileOf, only) : new Map();
    const sections = new Map();
    for (const file of new Set([...derived.keys(), ...views.keys()]))
        sections.set(file, joinSections([derived.get(file), views.get(file)]));
    // Automatic sections follow their source's audience even in a Foundry
    // corpus containing both public and private packs. Explicit SQL keeps
    // the database audience the caller requested.
    const publicRecords = records.filter((record) => !isGmNote(record));
    const publicOwners = lexicalSectionsFor(publicRecords, all);
    const allOwners =
        publicRecords.length === records.length ? publicOwners : lexicalSectionsFor(records, all);
    const lexical = new Map();
    for (const note of notes) {
        const owners = isGmNote(note) ? allOwners : publicOwners;
        const key = renderAddress({
            package: note.package,
            system: "note",
            type: note.type,
            shortcode: note.shortcode,
        });
        if (owners.has(key) && (only === undefined || fileOf(note) === only))
            lexical.set(fileOf(note), owners.get(key));
    }
    return { sections, views: new Set(views.keys()), derived, lexical };
}

/**
 * Join each note's generated sections to its body among the sources a
 * preparation answers, so the fences the event views hold are answered with
 * the author's own, in order after them. A note whose sections hold a fence
 * and whose body holds no directive of its own joins the sources, its body
 * read as {@link prepareTreeSqlTables} reads one.
 *
 * The expansion every surface runs appends the same text again, from the
 * `generated` {@link attachGeneratedSections} sets on the note's results —
 * see {@link module:engine/content-tables.expandContentTables}.
 *
 * @param {{sections: Map<string, string>, views: Set<string>}} generated -
 *   From {@link generatedSectionsFor}.
 * @param {Array<{source: string, markdown: string, frontmatter?: object, authoredSqlBlocks?: number}>} sources -
 *   The bodies to answer, extended in place.
 * @param {Map<string, {body: string, frontmatter: object|null}>} [parsed] -
 *   Notes already parsed, keyed by file; a note absent from it is read.
 * @returns {void}
 */
export function joinGeneratedSections(generated, sources, parsed) {
    for (const [absPath, text] of generated.sections) {
        const source = sources.find((one) => one.source === absPath);
        if (source) {
            source.authoredSqlBlocks ??= findSqlBlocks(source.markdown).length;
            source.markdown = appendGeneratedSections(source.markdown, text);
            continue;
        }
        if (!generated.views.has(absPath)) continue;
        const { body, frontmatter } = parsed?.get(absPath) ?? parseMarkdownFile(absPath);
        sources.push({
            source: absPath,
            markdown: appendGeneratedSections(body, text),
            frontmatter,
            authoredSqlBlocks: findSqlBlocks(body).length,
        });
    }
}

/**
 * Record each note's generated sections on its prepared results, where the
 * table expansion reads them. A note with no results of its own is given an
 * empty set carrying them.
 *
 * @param {Map<string, object[]>} prepared - From {@link prepareSqlTables}.
 * @param {{sections: Map<string, string>, lexical?: Map<string, import("./lexical-sections.mjs").LexicalSection[]>}} generated - From
 *   {@link generatedSectionsFor}.
 * @returns {void}
 */
export function attachGeneratedSections(prepared, generated) {
    for (const [absPath, text] of generated.sections) {
        let results = prepared.get(absPath);
        if (!results) prepared.set(absPath, (results = []));
        results.generated = text;
    }
    for (const [absPath, sections] of generated.lexical ?? []) {
        let results = prepared.get(absPath);
        if (!results) prepared.set(absPath, (results = []));
        results.lexical = sections;
    }
}

/**
 * Index the anchors the prepared bodies actually emit, including anchors in
 * SQL results. Foundry maps use the same expanded body the compiler splits.
 *
 * @param {Map<string, object[]>} prepared - The prepared directives.
 * @param {object[]} records - The visible content-index records.
 * @param {string} contentBase - Root of the content tree.
 * @param {Map<string, object>} parsed - Notes already parsed.
 * @param {object} [config] - The resolved build configuration.
 * @returns {Promise<void>}
 */
async function attachPreparedAnchors(prepared, records, contentBase, parsed, config, syntax) {
    const { entriesForNote, foundryIdentities } = await import("./foundry-entries.mjs");
    const identities = config ? { ...foundryIdentities(config), syntax } : undefined;
    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const file = noteFile(contentBase, record);
        const results = prepared.get(file);
        if (!results) continue;
        if (syntax) results.syntax = syntax;
        const { body } = parsed.get(file) ?? parseMarkdownFile(file);
        const expanded = expandContentTables(body, {
            source: file,
            sqlTables: results,
            pageLists: prepared.pageLists?.get(file),
        }).markdown;
        results.anchors = collectAnchors(expanded, 1, undefined, syntax);
        if (!identities || !record.address?.slug) continue;
        const frontmatter = authoredFrontmatter(record);
        const entries = entriesForNote(
            frontmatter,
            frontmatter.name?.full ?? record.file.name,
            record.address.slug,
            expanded,
            identities,
        );
        results.anchorUuids = entries[0]?.anchors;
        results.docAnchorUuids = entries[1]?.anchors;
    }
}

/**
 * The language each note of a tree is in, by its file: a language note itself,
 * and every other note the note of the language the content index derived for
 * it — see {@link module:engine/glossary-language}.
 *
 * @param {object[]} records - Content-index records.
 * @param {string} contentBase - Root of the content tree.
 * @returns {(source: string) => string|undefined} The language of a note's file.
 */
function pageLanguages(records, contentBase) {
    const notes = records
        .filter((record) => isNoteRecord(record))
        .map((record) => encodeAddresses(record));
    const byKey = new Map();
    const keyOf = (record) =>
        record.package && record.type && record.shortcode ?
            renderAddress({
                package: String(record.package),
                system: "note",
                type: String(record.type),
                shortcode: String(record.shortcode),
            })
        :   undefined;
    for (const record of notes) {
        const key = keyOf(record);
        if (key && !byKey.has(key)) byKey.set(key, record);
    }
    const byFile = new Map(
        records
            .filter((record) => isNoteRecord(record))
            .map((record, i) => [noteFile(contentBase, record), notes[i]]),
    );
    const languageNotes = languageNotesByCode(byKey.values(), keyOf);
    return (source) => {
        const record = byFile.get(source);
        if (!record) return undefined;
        return glossaryLanguage(undefined, record, {
            keyOf: (value) => (typeof value === "string" && value ? value : undefined),
            noteOf: (code) => languageNotes.get(code),
            self: keyOf(record),
        });
    };
}

/**
 * Each declared dependency's cached index, as {@link openNotesDatabase} attaches
 * them. Empty where none has been fetched.
 *
 * @param {object} [config] - Resolved configuration, defaulting to ambient.
 * @returns {Promise<Array<{id: string, file: string}>>} The dependencies.
 */
export async function cachedDependencies(config) {
    try {
        const { cachedMetadataIndexes } = await import("./metadata-index.mjs");
        const { loadPackConfig } = await import("./pack-config.mjs");
        return cachedMetadataIndexes(config ?? loadPackConfig());
    } catch {
        return [];
    }
}

/**
 * Answer every `sql` directive in a content tree.
 *
 * The one entry point each pass uses, so the compiler, the link checker and the
 * site build cannot disagree about what a table selects — the failure mode the
 * shared index
 * describes, where N passes each derive the corpus their own way.
 *
 * **Every corpus-reading directive is answered here**, which is why one call
 * precedes every pass: the `sql` tables, the inline scalar queries, and the
 * page lists, whose results ride on the same object as `pageLists`.
 *
 * **Nothing is opened for a tree that asks no query.** A tree with no `sql`
 * directive costs one walk and no database at all, and so does one whose only
 * directive is a page list — a page list is a filter over the records. That is
 * what lets every pass call this unconditionally.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {object} [opts.config] - Resolved configuration, defaulting to ambient.
 * @param {readonly string[]} [opts.skipDirectories] - The walk's scope.
 * @param {object[]} [opts.records] - Index records the caller already derived.
 *   A command that also builds a link index holds them already, and deriving
 *   them twice is the duplicated-corpus failure this closes.
 * @param {Map<string, {body: string, frontmatter: object|null}>} [opts.parsed] -
 *   The notes {@link module:engine/content-index.indexRecordsFor} parsed for
 *   `records`, keyed by file, so no note is parsed twice. A note absent from it
 *   is read.
 * @param {object} [opts.database] - An open notes database over `records`, from
 *   {@link openNotesDatabase} with this call's `audience` and the declared
 *   dependencies from {@link cachedDependencies}. It is queried and left open;
 *   absent, one is opened and closed here.
 * @param {"all"|"public"} [opts.audience] - Whether to exclude GM notes.
 * @param {Map<string, object>} [opts.foreignIndex] - The fetched indexes the
 *   generated sections take in, where the caller holds them already; absent,
 *   they are read from the cache.
 * @param {import("./content-session.mjs").ContentSyntax} [opts.syntax] - Exact-text scanner projections.
 * @returns {Promise<Map<string, object[]>|undefined>} Results by note path,
 *   carrying `inline` and `pageLists` beside them, or nothing when the tree
 *   holds no such directive and no note is given a generated section.
 */
export async function prepareTreeSqlTables(
    contentBase,
    {
        config,
        skipDirectories,
        records,
        parsed,
        database,
        audience = "all",
        foreignIndex,
        syntax,
    } = {},
) {
    // Imported here rather than at module scope: the index reaches the pack
    // compilers through `manifest-emit` → `journals`, so a static import from a
    // module they load would close a cycle and leave `BasePackCompiler`
    // uninitialised for whichever module the runtime happened to load first.
    const { indexRecordsFor } = await import("./content-index.mjs");
    const notes = parsed ?? new Map();
    const allRecords =
        records ?? indexRecordsFor({ contentBase, config, skipDirectories, parsed: notes });
    const indexRecords = allRecords.filter((record) => audience !== "public" || !isGmNote(record));

    // Which notes carry a directive, discovered over the same corpus every
    // other pass reads rather than over a walk of this one's own. The
    // body has to be read to find a fence — the index carries no note text —
    // but *which files* to read is not a second answer.
    //
    // `parseMarkdownFile` yields the body `walkMarkdownTree` yielded, trimmed
    // the same way, which matters: results are keyed by note and looked up by
    // the ordinal of the directive within it, so the two readings have to agree
    // about what a body is.
    const sources = [];
    for (const record of indexRecords) {
        if (!isNoteRecord(record)) continue;
        const absPath = noteFile(contentBase, record);
        const { body, frontmatter } = notes.get(absPath) ?? parseMarkdownFile(absPath);
        if (
            body &&
            (findSqlBlocks(body).length ||
                findPageListBlocks(body).length ||
                sqlQueriesInMarkdown(body, frontmatter).length)
        )
            sources.push({ source: absPath, markdown: body, frontmatter });
    }
    // A note's event views are fences too, so a tree whose notes carry events
    // asks a query even where no author wrote one.
    const hasEvents = indexRecords.some(
        (record) =>
            isNoteRecord(record) &&
            Array.isArray(record.data?.events) &&
            record.data.events.length > 0,
    );
    // The derived lists read no database, so they are found before one is
    // opened, and a tree whose notes are given only those opens none.
    let foreign = foreignIndex;
    if (!foreign) {
        try {
            const { loadForeignIndexes } = await import("./metadata-index.mjs");
            foreign =
                config ? loadForeignIndexes(config, [config.contentPackage]).index : new Map();
        } catch {
            foreign = new Map();
        }
    }
    const derivedOnly = await generatedSectionsFor(undefined, indexRecords, contentBase, {
        foreignIndex: foreign,
        config,
        all: allRecords,
    });
    if (!sources.length && !hasEvents && !derivedOnly.sections.size && !derivedOnly.lexical.size)
        return undefined;

    // A page list is a filter over the records, so it needs no database. A tree
    // whose only corpus-reading directive is one therefore opens none — which
    // is the same bargain the early return above makes for a tree with no
    // directive at all.
    const needsDatabase =
        hasEvents ||
        sources.some(
            ({ markdown, frontmatter }) =>
                findSqlBlocks(markdown).length ||
                sqlQueriesInMarkdown(markdown, frontmatter).length,
        );
    if (!needsDatabase) {
        const pageOnly = new Map();
        joinGeneratedSections(derivedOnly, sources, notes);
        pageOnly.inline = new Map();
        pageOnly.pageLists = preparePageLists(indexRecords, sources);
        attachGeneratedSections(pageOnly, derivedOnly);
        await attachPreparedAnchors(pageOnly, indexRecords, contentBase, notes, config, syntax);
        return pageOnly;
    }
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
            .filter(Boolean)
            .flatMap((target) => [
                target,
                renderAddress({ ...readCanonicalKey(target), system: "note" }),
            ]),
    );
    // Each declared dependency's published index, attached as its own schema so
    // a table can read `FROM <package>.notes`. Imported here for the
    // same cycle reason the index is, and tolerated when absent: a tree with no
    // `sql` directive never reaches this line, and one whose dependency has not
    // been fetched already fails earlier with a message naming the fetch.
    const db =
        database ??
        (await openNotesDatabase(allRecords, {
            dependencies: await cachedDependencies(config),
            audience,
            contentBase,
        }));
    try {
        const generated = await generatedSectionsFor(db, indexRecords, contentBase, {
            derived: derivedOnly.derived,
            all: allRecords,
        });
        joinGeneratedSections(generated, sources, notes);
        const prepared = await prepareSqlTables(db, sources, {
            linkable: (ref) => addresses.has(renderAddress(ref)),
            records: indexRecords,
            pageLanguage: pageLanguages(indexRecords, contentBase),
        });
        prepared.inline = await prepareInlineSqlExpressions(db, sources);
        attachGeneratedSections(prepared, generated);
        await attachPreparedAnchors(prepared, indexRecords, contentBase, notes, config, syntax);
        return prepared;
    } finally {
        if (!database) await db.close();
    }
}

/**
 * Prepare authored link-check tables in each source note's audience. Public
 * sources share one public database; GM sources share one complete database.
 * Complete records remain available for authored-link checks.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {object} [opts.config] - Resolved configuration.
 * @param {readonly string[]} [opts.skipDirectories] - The walk's scope.
 * @param {object[]} [opts.records] - Complete index records already derived.
 * @param {Map<string, {body: string, frontmatter: object|null}>} [opts.parsed] - Parsed notes.
 * @param {Map<string, object>} [opts.foreignIndex] - Published dependency indexes.
 * @param {(audience: "all"|"public") => Promise<Map<string, object[]>|undefined>} [opts.prepareAudience] -
 *   Context-bound preparation shared with other operations in the same session.
 * @returns {Promise<Map<string, object[]>|undefined>} Prepared tables by source.
 */
export async function prepareLinkSqlTables(
    contentBase,
    { config, skipDirectories, records, parsed, foreignIndex, prepareAudience } = {},
) {
    const { indexRecordsFor } = await import("./content-index.mjs");
    const notes = parsed ?? new Map();
    const allRecords =
        records ?? indexRecordsFor({ contentBase, config, skipDirectories, parsed: notes });
    const sources = new Map();
    const lexicalOwners = lexicalSectionsFor(allRecords);
    for (const record of allRecords) {
        if (!isNoteRecord(record)) continue;
        const file = noteFile(contentBase, record);
        let note = notes.get(file);
        if (!note) {
            note = parseMarkdownFile(file);
            notes.set(file, note);
        }
        const body = note.body ?? "";
        if (
            findSqlBlocks(body).length ||
            findPageListBlocks(body).length ||
            sqlQueriesInMarkdown(body, note.frontmatter).length ||
            lexicalOwners.has(
                renderAddress({
                    package: record.package,
                    system: "note",
                    type: record.type,
                    shortcode: record.shortcode,
                }),
            )
        )
            sources.set(file, isGmNote(record) ? "all" : "public");
    }
    if (!sources.size) return undefined;
    const selected = new Map();
    selected.pageLists = new Map();
    selected.inline = new Map();
    for (const audience of new Set(sources.values())) {
        const prepared =
            prepareAudience ?
                await prepareAudience(audience)
            :   await prepareTreeSqlTables(contentBase, {
                    config,
                    skipDirectories,
                    records: allRecords,
                    parsed: notes,
                    foreignIndex,
                    audience,
                });
        for (const [file, sourceAudience] of sources) {
            if (sourceAudience !== audience) continue;
            if (prepared?.has(file)) selected.set(file, prepared.get(file));
            if (prepared?.pageLists?.has(file))
                selected.pageLists.set(file, prepared.pageLists.get(file));
            if (prepared?.inline?.has(file)) selected.inline.set(file, prepared.inline.get(file));
        }
    }
    return selected;
}
