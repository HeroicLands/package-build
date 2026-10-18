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
 * A note's **event views**: generated sections — see
 * {@link module:engine/generated-sections} — each an H1 with a fixed anchor
 * holding a `sql` fence over the `events` relation.
 *
 * **Nothing here renders.** A view is Markdown an author could have written —
 * a heading and a fence — and it reaches every surface through the same table
 * expansion an authored fence does, so the website, the Foundry journal and the
 * book receive one text: Foundry starts a page at the heading, the website
 * sets a section, the book a chapter section.
 *
 * Three rules decide whether a view is generated:
 *
 * - **The view applies to the note** — see {@link EVENT_VIEWS}.
 * - **The note's own body declares no prose anchor with the view's slug.** An
 *   author who writes `# Chronology {#chronology}` keeps that section, and it
 *   is the one way to replace a view.
 * - **The view has rows.** The query is run before the view is written, and a
 *   view selecting nothing is left out rather than printed as an empty table.
 *   A region's chronology counts only its own rows: the world events set
 *   beside them as context make no chronology by themselves.
 *
 * A stub publishes no page and is given no view, and neither is a note's
 * documentation journal.
 *
 * @module
 */

import { ownDocumentSystem, renderAddress } from "./address.mjs";
import { authoredSection, sectionHeading } from "./generated-sections.mjs";

/** A literal SQL string. */
const literal = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** A list of SQL string literals, for an `IN (…)`. */
const literals = (texts) => texts.map(literal).join(", ");

/** The order every view sorts its rows in: by date, undated last. */
const BY_DATE = "ORDER BY e.whenSort NULLS LAST, e.address";

/**
 * The views, in the order
 * {@link module:engine/generated-sections.GENERATED_SECTIONS} sets them in.
 *
 * Each names its anchor `slug`, its `heading`, whether it `applies` to a note's
 * index record, and the `query` it writes for a note — given the note's
 * Address in each form an event may name it by, and the shape of the corpus —
 * or `null` where the corpus states nothing the view could select. A view's
 * `own` query, where it has one, is what decides whether the view has rows;
 * a view with `owners` answers that for many notes in one query, given each
 * note's Address forms.
 *
 * @type {ReadonlyArray<Readonly<{slug: string, heading: string,
 *   applies: (record: object) => boolean,
 *   query: (self: string[], shape: CorpusShape, columns?: {felt?: boolean}) => {fence: string, own?: string}|null,
 *   owners?: (db: object, selves: string[][], shape: CorpusShape) => Promise<Set<string>>,
 *   felt?: (db: object, selves: string[][], shape: CorpusShape) => Promise<Set<string>>}>>}
 */
export const EVENT_VIEWS = Object.freeze([
    Object.freeze({
        slug: "chronology",
        heading: "Chronology",
        applies: (record) => record.type === "place",
        query: chronologyQuery,
        owners: chronologyOwners,
        felt: chronologyFeltOwners,
    }),
    Object.freeze({
        slug: "events",
        heading: "Events",
        applies: (record) =>
            record.type === "being" ||
            record.type === "affiliation" ||
            (record.type === "lore" && record.subType === "culture"),
        owners: (db, selves, shape) =>
            namedOwners(db, selves, "SELECT unnest(who).ref AS ref FROM events", shape.who),
        query: (self, shape) => {
            if (!shape.who) return null;
            const named = `list_filter(e.who, w -> w.ref IN (${literals(self)}))`;
            return {
                fence: [
                    "SELECT e.note AS _ref,",
                    '       e.whenText AS "When",',
                    '       e.summary AS "What happened",',
                    `       array_to_string(list_transform(${named}, w -> w.role), ', ') AS "Role"`,
                    "FROM events e",
                    `WHERE len(${named}) > 0`,
                    BY_DATE,
                ].join("\n"),
            };
        },
    }),
    Object.freeze({
        slug: "accounts",
        heading: "Accounts",
        applies: (record) =>
            record.type === "affiliation" ||
            record.type === "place" ||
            (record.type === "lore" && record.subType === "culture"),
        owners: (db, selves, shape) =>
            namedOwners(
                db,
                selves,
                'SELECT account."by" AS ref FROM (SELECT unnest(accounts) AS account FROM events)',
                shape.accounts,
            ),
        query: (self, shape) => {
            if (!shape.accounts) return null;
            return {
                fence: [
                    "SELECT e.note AS _ref,",
                    '       e.whenText AS "When",',
                    '       e.summary AS "Event",',
                    '       e.account.says AS "What they say",',
                    '       e.account.agrees AS "Agrees"',
                    "FROM (SELECT *, unnest(accounts) AS account FROM events) e",
                    `WHERE e.account."by" IN (${literals(self)})`,
                    BY_DATE,
                ].join("\n"),
            };
        },
    }),
    Object.freeze({
        slug: "followed",
        heading: "What followed",
        applies: (record) => Array.isArray(record.data?.events) && record.data.events.length > 0,
        owners: (db, selves, shape) =>
            namedOwners(
                db,
                selves,
                "SELECT split_part(edge.event, '#', 1) AS ref " +
                    "FROM (SELECT unnest(follows) AS edge FROM events)",
                shape.follows,
            ),
        query: (self, shape) => {
            if (!shape.follows) return null;
            const edges =
                `list_filter(e.follows, f -> split_part(f.event, '#', 1) ` +
                `IN (${literals(self)}))`;
            return {
                fence: [
                    "SELECT e.note AS _ref,",
                    '       e.whenText AS "When",',
                    '       e.summary AS "What followed",',
                    `       array_to_string(list_transform(${edges}, f -> f.how), ', ') AS "How"`,
                    "FROM events e",
                    `WHERE len(${edges}) > 0`,
                    BY_DATE,
                ].join("\n"),
            };
        },
    }),
]);

/**
 * @typedef {object} CorpusShape
 * @property {boolean} parents - Some place states `data.parents`.
 * @property {boolean} locus - Some event states `where.locus`.
 * @property {boolean} reach - Some event states `where.reach`.
 * @property {boolean} who - Some event states `who`.
 * @property {boolean} accounts - Some event states `accounts`.
 * @property {boolean} follows - Some event states `follows`.
 * @property {boolean} depth - Some event states `depth`.
 */

/**
 * Which notes an event names, asked of every note in one query rather than one
 * query per note: the references the events state are listed once and joined to
 * every note's Address forms.
 *
 * @param {object} db - From {@link module:engine/sql-tables.openNotesDatabase}.
 * @param {string[][]} selves - Each note's Address, in each form.
 * @param {string} refs - A query selecting one `ref` per reference an event
 *   states.
 * @param {boolean} stated - Whether the corpus states the field `refs` reads.
 * @returns {Promise<Set<string>>} The first form of each note some event names.
 */
async function namedOwners(db, selves, refs, stated) {
    if (!stated) return new Set();
    const values = selves
        .flatMap((forms) => forms.map((form) => `(${literal(forms[0])}, ${literal(form)})`))
        .join(", ");
    const { rows } = await db.query(
        [
            `WITH selves(root, form) AS (VALUES ${values}),`,
            `named AS (${refs})`,
            "SELECT DISTINCT selves.root AS root",
            "FROM named JOIN selves ON selves.form = named.ref",
        ].join("\n"),
    );
    return new Set(rows.map((row) => String(row.root)));
}

/** The `reach` clauses felt in the places `here` holds. */
function chronologyFelt() {
    return 'list_filter(e."where".reach, r -> list_contains(here.places, r.place))';
}

/**
 * The conditions under which an event is one of a place's own rows: it
 * happened at the place or below it, or it is felt there.
 *
 * @param {CorpusShape} shape - What the corpus states.
 * @returns {string[]} The alternatives, over `e` and `here.places`.
 */
function chronologyOwnRows(shape) {
    return [
        ...(shape.locus ?
            ['len(list_filter(e."where".locus, l -> list_contains(here.places, l))) > 0']
        :   []),
        ...(shape.reach ? [`len(${chronologyFelt()}) > 0`] : []),
    ];
}

/**
 * Which places have a chronology of their own rows, asked of every place in one
 * query rather than one query per place.
 *
 * The places below each root are walked together, so the walk over `entries`
 * is paid once for the whole corpus instead of once per place.
 *
 * @param {object} db - From {@link module:engine/sql-tables.openNotesDatabase}.
 * @param {string[][]} selves - Each place's Address, in each form; the `note`
 *   system's is the first.
 * @param {CorpusShape} shape - What the corpus states.
 * @returns {Promise<Set<string>>} The roots with at least one own row.
 */
async function chronologyOwners(db, selves, shape) {
    return chronologyRoots(db, selves, shape, chronologyOwnRows(shape));
}

/**
 * Which places have a row felt there, asked of every place in one query. A
 * chronology prints its `Felt here` column only for these.
 *
 * @param {object} db - From {@link module:engine/sql-tables.openNotesDatabase}.
 * @param {string[][]} selves - Each place's Address, in each form.
 * @param {CorpusShape} shape - What the corpus states.
 * @returns {Promise<Set<string>>} The roots with at least one felt row.
 */
async function chronologyFeltOwners(db, selves, shape) {
    if (!shape.reach) return new Set();
    return chronologyRoots(db, selves, shape, [
        `len(list_filter(${chronologyFelt()}, r -> coalesce(r.how, '') <> '')) > 0`,
    ]);
}

/**
 * The roots among `selves` for which an event satisfies one of `conditions`,
 * over the places at or below each root.
 *
 * @param {object} db - From {@link module:engine/sql-tables.openNotesDatabase}.
 * @param {string[][]} selves - Each place's Address, in each form.
 * @param {CorpusShape} shape - What the corpus states.
 * @param {string[]} conditions - Alternatives over `e` and `here.places`.
 * @returns {Promise<Set<string>>} The roots with at least one such event.
 */
async function chronologyRoots(db, selves, shape, conditions) {
    const values = [...new Set(selves.map((self) => self[0]))]
        .map((root) => `(${literal(root)})`)
        .join(", ");
    const below =
        shape.parents ?
            [
                "WITH RECURSIVE below(root, place) AS (",
                `    SELECT r, r FROM (VALUES ${values}) AS t(r)`,
                "    UNION",
                "    SELECT b.root, lower(p.package || '-note-place-' || p.shortcode)",
                "    FROM entries p JOIN below b ON list_contains(p.data.parents, b.place)",
                "    WHERE p.type = 'place'",
                "),",
            ]
        :   [`WITH RECURSIVE below(root, place) AS (SELECT r, r FROM (VALUES ${values}) AS t(r)),`];
    const { rows } = await db.query(
        [
            ...below,
            "here AS (SELECT root, list(place) AS places FROM below GROUP BY root)",
            "SELECT DISTINCT here.root AS root",
            "FROM events e, here",
            `WHERE ${conditions.join(" OR ")}`,
        ].join("\n"),
    );
    return new Set(rows.map((row) => String(row.root)));
}

/**
 * A place's chronology: every event that happened at the place or anywhere
 * below it in `parents`, every event felt there — with the clause saying how —
 * and every `depth: world` event as context.
 *
 * The places below are found by walking `parents` downward from the place, so
 * an event felt in towns under two continents is in each continent's
 * chronology, and each region's, through the towns it names.
 *
 * @param {string[]} self - The place's Address, in each form.
 * @param {CorpusShape} shape - What the corpus states.
 * @param {{felt?: boolean}} [columns] - `felt: false` when no row of this
 *   place is felt there, which leaves the `Felt here` column out.
 * @returns {{fence: string, own: string}|null} The query, and the one that
 *   counts the place's own rows.
 */
function chronologyQuery(self, shape, columns = {}) {
    if (!shape.locus && !shape.reach) return null;
    const below =
        shape.parents ?
            [
                "WITH RECURSIVE below(place) AS (",
                `    SELECT ${literal(self[0])}`,
                "    UNION",
                "    SELECT lower(p.package || '-note-place-' || p.shortcode)",
                "    FROM entries p JOIN below b ON list_contains(p.data.parents, b.place)",
                "    WHERE p.type = 'place'",
                "),",
            ]
        :   [`WITH RECURSIVE below(place) AS (SELECT ${literal(self[0])}),`];
    const felt = chronologyFelt();
    const ownRows = chronologyOwnRows(shape);
    const head = [
        ...below,
        "here AS (SELECT list(place) AS places FROM below)",
        "SELECT e.note AS _ref,",
        '       e.whenText AS "When",',
        shape.reach && columns.felt !== false ?
            '       e.summary AS "What happened",'
        :   '       e.summary AS "What happened"',
        ...(shape.reach && columns.felt !== false ?
            [`       array_to_string(list_transform(${felt}, r -> r.how), '; ') AS "Felt here"`]
        :   []),
        "FROM events e, here",
    ];
    const context = shape.depth ? ["e.depth = 'world'"] : [];
    return {
        fence: [...head, `WHERE ${[...context, ...ownRows].join("\n   OR ")}`, BY_DATE].join("\n"),
        own: [...head, `WHERE ${ownRows.join("\n   OR ")}`].join("\n"),
    };
}

/**
 * What the corpus states, read from the relations' own types, so a view never
 * names a field no note writes — which would fail to bind rather than select
 * nothing.
 *
 * @param {object} db - From {@link module:engine/sql-tables.openNotesDatabase}.
 * @returns {Promise<CorpusShape>} The shape.
 */
async function corpusShape(db) {
    const typeOf = async (relation) => {
        const { rows } = await db.query(`DESCRIBE ${relation}`);
        return new Map(rows.map((row) => [String(row.column_name), String(row.column_type)]));
    };
    const events = await typeOf("events");
    const entries = await typeOf("entries");
    const has = (type, field) => new RegExp(`\\b"?${field}"? `).test(type ?? "");
    const where = events.get("where");
    return {
        parents: has(entries.get("data"), "parents"),
        locus: has(where, "locus"),
        reach: has(where, "reach"),
        who: /STRUCT/.test(events.get("who") ?? ""),
        accounts: /STRUCT/.test(events.get("accounts") ?? ""),
        follows: /STRUCT/.test(events.get("follows") ?? ""),
        depth: /VARCHAR/.test(events.get("depth") ?? ""),
    };
}

/**
 * Every form an event may name a note by: its Address in the `note` system,
 * and in its own document's system where that differs.
 *
 * @param {object} record - The note's index record.
 * @returns {string[]} The forms, the `note` one first.
 */
export function selfForms(record) {
    const tuple = {
        package: String(record.package),
        type: String(record.type),
        shortcode: String(record.shortcode),
    };
    return [
        ...new Set([
            renderAddress({ ...tuple, system: "note" }),
            renderAddress({ ...tuple, system: ownDocumentSystem(tuple.type) }),
        ]),
    ];
}

/**
 * The Markdown of one view: its heading, with its anchor, and its fence.
 *
 * @param {object} view - One of {@link EVENT_VIEWS}.
 * @param {string} query - The fence's query.
 * @returns {string} The section.
 */
function section(view, query) {
    return `${sectionHeading(view.slug)}\n\n\`\`\`sql\n${query}\n\`\`\`\n`;
}

/**
 * The views each note is given, by section.
 *
 * @param {object} db - From {@link module:engine/sql-tables.openNotesDatabase},
 *   over the same records.
 * @param {Iterable<object>} records - The content-index records.
 * @param {(record: object) => string} fileOf - A record's note file, as the
 *   prepared results are keyed.
 * @param {string} [only] - One note file to give views to, every note's being
 *   read for them; absent, every note is given its views.
 * @returns {Promise<Map<string, Map<string, string>>>} Note file to its views,
 *   each keyed by its slug, for every note given at least one.
 */
export async function eventViewSections(db, records, fileOf, only) {
    const out = new Map();
    const all = [...records];
    if (!all.some((record) => Array.isArray(record?.data?.events) && record.data.events.length))
        return out;
    const shape = await corpusShape(db);
    // A view that can say which notes have rows in one query is asked once, over
    // every note it will be given, and the per-note count is skipped.
    const owned = new Map();
    const felt = new Map();
    for (const view of EVENT_VIEWS) {
        if (!view.owners) continue;
        const selves = [];
        for (const record of all) {
            if (!record?.address || record.documents || !record.shortcode) continue;
            if (only !== undefined && fileOf(record) !== only) continue;
            if (!view.applies(record) || authoredSection(record, view.slug)) continue;
            const self = selfForms(record);
            if (view.query(self, shape)) selves.push(self);
        }
        if (selves.length) {
            owned.set(view.slug, await view.owners(db, selves, shape));
            if (view.felt) felt.set(view.slug, await view.felt(db, selves, shape));
        }
    }
    for (const record of all) {
        if (!record?.address || record.documents || !record.shortcode) continue;
        if (only !== undefined && fileOf(record) !== only) continue;
        const self = selfForms(record);
        const sections = new Map();
        for (const view of EVENT_VIEWS) {
            if (!view.applies(record) || authoredSection(record, view.slug)) continue;
            const query = view.query(
                self,
                shape,
                felt.has(view.slug) ? { felt: felt.get(view.slug).has(self[0]) } : undefined,
            );
            if (!query) continue;
            const has =
                owned.has(view.slug) ?
                    owned.get(view.slug).has(self[0])
                :   Number(
                        (await db.query(`SELECT count(*) AS n FROM (${query.own ?? query.fence})`))
                            .rows[0]?.n ?? 0,
                    ) > 0;
            if (has) sections.set(view.slug, section(view, query.fence));
        }
        if (sections.size) out.set(fileOf(record), sections);
    }
    return out;
}
