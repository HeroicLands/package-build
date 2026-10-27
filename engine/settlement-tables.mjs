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
 * A region's settlements table: one authored row per settlement, stating its
 * market, its people and who holds it, in the holding model the region
 * declares.
 *
 * **A row is the whole record of a settlement with no note**, and a link to the
 * note where one exists. A table is a second statement of whatever a linked
 * note's frontmatter already states, so a linked row's figure and market must
 * equal the note's, and a settlement note inside the region must have a row.
 *
 * **Where it is written.** A markdown table under a `## Settlements` heading on
 * a `place` note — the region the settlements stand in. A section answered by
 * an `sql` fence is generated from the notes themselves and is not read here.
 * A note with no such table is not read at all, so the table is optional for
 * a package.
 *
 * **The model is a tag.** A region names how its countryside is held by
 * carrying one or more of the {@link HOLDING_MODELS} tags.
 *
 * **Every rule's findings are errors**, each message beginning with the rule's
 * name from {@link SETTLEMENT_TABLE_RULES}. A wikilink that resolves nowhere is
 * the link audit's finding and is not reported a second time here.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { FENCE_LINE } from "./code-fences.mjs";
import { MARKET_CLASSES, marketClass } from "./market-class.mjs";
import { hasTag } from "./note-vocabulary.mjs";
import { shortcodesOf } from "./holdings.mjs";
import { WIKILINK, parseWikilink } from "./wikilink-syntax.mjs";
import { nameFormsOf } from "./name-forms.mjs";

/** The heading text a settlements table stands under, at level two. */
export const SETTLEMENTS_HEADING = "Settlements";

/**
 * How a region's countryside is held, each the tag a region carries to say so.
 *
 * `holder` is what the `Held by` cell names under that model. `person` says
 * whether that holder may be a person: only where land is held by a person or
 * a house may the cell link a `being`.
 *
 * **The tags stay open.** They are not a declared tag group: a group would
 * report every tag within a typo's distance of one — a region tagged `hellad`
 * reads as a near miss of `held` — and a misspelled model on a note with a
 * table is already reported, because the note then names no model at all.
 *
 * @type {ReadonlyArray<Readonly<{tag: string, holder: string, person: boolean}>>}
 */
export const HOLDING_MODELS = Object.freeze([
    Object.freeze({ tag: "held", holder: "a person or a house", person: true }),
    Object.freeze({ tag: "endowed", holder: "an institution", person: false }),
    Object.freeze({ tag: "registered", holder: "an office", person: false }),
    Object.freeze({ tag: "kin", holder: "a kindred", person: false }),
    Object.freeze({ tag: "polis", holder: "the city", person: false }),
]);

/**
 * The table's columns, in the order the header states them. An optional
 * column may be left out; the header carries no other column, and keeps this
 * order.
 *
 * @type {ReadonlyArray<Readonly<{name: string, required: boolean}>>}
 */
export const SETTLEMENT_COLUMNS = Object.freeze([
    Object.freeze({ name: "Name", required: true }),
    Object.freeze({ name: "Market", required: true }),
    Object.freeze({ name: "People", required: true }),
    Object.freeze({ name: "Held by", required: true }),
    Object.freeze({ name: "For", required: false }),
]);

/** The note types a `Held by` link may name. */
const HOLDER_TYPES = Object.freeze(["affiliation", "being"]);

/**
 * The rules this module enforces, each `name` the prefix its findings carry.
 *
 * @type {ReadonlyArray<Readonly<{name: string, describe: string}>>}
 */
export const SETTLEMENT_TABLE_RULES = Object.freeze([
    Object.freeze({
        name: "settlements columns",
        describe:
            "The header is not the declared columns in order. The table's rows are not " +
            "read until it is.",
    }),
    Object.freeze({
        name: "no holding model",
        describe: "The note carries a settlements table and no holding-model tag.",
    }),
    Object.freeze({
        name: "market class",
        describe:
            "A Market cell is not a class on the market scale written as its number " +
            "and its name, such as `2 village`.",
    }),
    Object.freeze({
        name: "people figure",
        describe: "A People cell is not a positive whole number.",
    }),
    Object.freeze({
        name: "no holder",
        describe: "A Held by cell is empty.",
    }),
    Object.freeze({
        name: "not a holder",
        describe: "A Held by link names a note that is neither an affiliation nor a being.",
    }),
    Object.freeze({
        name: "holder out of model",
        describe:
            "A Held by link names a being — a person — in a region none of whose " +
            "holding models lets a person hold land.",
    }),
    Object.freeze({
        name: "not a settlement",
        describe: "A Name link names a note that is not a place.",
    }),
    Object.freeze({
        name: "figure disagrees",
        describe:
            "A linked row's People differs from the `data.population` its note states, " +
            "or the note states none.",
    }),
    Object.freeze({
        name: "market disagrees",
        describe:
            "A linked row's Market differs from the `data.market` its note states, or " +
            "the note states none.",
    }),
    Object.freeze({
        name: "unlinked settlement",
        describe:
            "An unlinked Name is the name or an alias of a settlement note this table " +
            "covers. The row links the note.",
    }),
    Object.freeze({
        name: "missing row",
        describe:
            "A settlement note this table covers has no row. A settlement is covered by " +
            "the nearest place above it, by `parents`, that carries a settlements table.",
    }),
    Object.freeze({
        name: "duplicate settlement",
        describe:
            "A settlement has a second row in one table, or a row in a second table. " +
            "Its row belongs to the table covering it.",
    }),
    Object.freeze({
        name: "no tail",
        describe:
            "No sentence follows the table to state what it leaves out before the next " +
            "heading.",
    }),
]);

/* --------------------------------------------------------------------- */
/*  Reading the table                                                     */
/* --------------------------------------------------------------------- */

/**
 * One cell, as authored.
 *
 * @typedef {object} Cell
 * @property {string} text - The cell, trimmed.
 * @property {number} column - The 1-based column its text starts at.
 */

/**
 * One settlements table.
 *
 * @typedef {object} SettlementTable
 * @property {number} line - The 1-based line of its header.
 * @property {string[]} header - The header cells.
 * @property {boolean} wellFormed - Whether the header is the declared columns.
 * @property {Array<{line: number, cells: Record<string, Cell>}>} rows - Each
 *   row's cells keyed by column name; empty when the header is not well formed.
 * @property {number} last - The 1-based line of its last row.
 * @property {boolean} tailed - Whether prose follows it before the next heading.
 */

/** A GFM delimiter row. */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** An ATX heading, its level and text. */
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/**
 * A row's cells, split on every pipe a backslash does not escape.
 *
 * @param {string} line - The row.
 * @returns {Cell[]} The cells, in order.
 */
function cellsOf(line) {
    const first = line.indexOf("|");
    const cells = [];
    let start = first + 1;
    for (let i = start; i <= line.length; i += 1) {
        if (i < line.length && !(line[i] === "|" && line[i - 1] !== "\\")) continue;
        const raw = line.slice(start, i);
        const text = raw.trim();
        const lead = raw.length - raw.trimStart().length;
        cells.push({ text, column: text ? start + lead + 1 : start + 1 });
        start = i + 1;
    }
    if (line.trimEnd().endsWith("|") && cells.at(-1)?.text === "") cells.pop();
    return cells;
}

/**
 * Whether a header names the declared columns, in order, optional ones only
 * left out.
 *
 * @param {string[]} header - The header cells.
 * @returns {boolean} Whether it does.
 */
function isDeclaredHeader(header) {
    let at = 0;
    for (const column of SETTLEMENT_COLUMNS) {
        if (header[at] === column.name) at += 1;
        else if (column.required) return false;
    }
    return at === header.length;
}

/**
 * The header a finding asks for.
 *
 * @returns {string} The declared columns as a header row.
 */
function declaredHeader() {
    return `| ${SETTLEMENT_COLUMNS.map((c) => c.name).join(" | ")} |`;
}

/**
 * Every settlements table in a note, read from the raw file so each line
 * number is the file's own.
 *
 * @param {string} raw - The whole note, frontmatter included.
 * @returns {{heading: number, tables: SettlementTable[]}} The `## Settlements`
 *   heading's line, 0 when there is none, and its tables.
 */
export function findSettlementTables(raw) {
    const lines = String(raw ?? "").split("\n");
    let i = 0;
    if (lines[0] === "---") {
        i = lines.indexOf("---", 1);
        i = i === -1 ? lines.length : i + 1;
    }
    let heading = 0;
    /** @type {SettlementTable[]} */
    const tables = [];
    let inSection = false;
    /** @type {SettlementTable|undefined} */
    let awaitingTail;
    for (; i < lines.length; i += 1) {
        const line = lines[i];
        const fence = FENCE_LINE.exec(line);
        if (fence) {
            if (awaitingTail) awaitingTail = undefined;
            const closer = new RegExp(`^[ \\t]*${fence[2][0]}{${fence[2].length},}[ \\t]*$`);
            i += 1;
            while (i < lines.length && !closer.test(lines[i])) i += 1;
            continue;
        }
        const head = HEADING.exec(line);
        if (head) {
            awaitingTail = undefined;
            if (head[1].length <= 2) {
                inSection = head[1].length === 2 && head[2] === SETTLEMENTS_HEADING;
                if (inSection && !heading) heading = i + 1;
            }
            continue;
        }
        if (!inSection) continue;
        if (line.trim() === "") continue;
        if (line.trim().startsWith("|") && DELIMITER.test(lines[i + 1] ?? "")) {
            awaitingTail = undefined;
            const header = cellsOf(line).map((c) => c.text);
            const wellFormed = isDeclaredHeader(header);
            /** @type {SettlementTable} */
            const table = { line: i + 1, header, wellFormed, rows: [], last: i + 2, tailed: false };
            i += 2;
            for (; i < lines.length && lines[i].trim().startsWith("|"); i += 1) {
                table.last = i + 1;
                if (!wellFormed) continue;
                const cells = cellsOf(lines[i]);
                /** @type {Record<string, Cell>} */
                const byName = {};
                header.forEach((name, n) => {
                    byName[name] = cells[n] ?? { text: "", column: lines[i].length + 1 };
                });
                table.rows.push({ line: i + 1, cells: byName });
            }
            i -= 1;
            tables.push(table);
            awaitingTail = table;
            continue;
        }
        if (awaitingTail) {
            awaitingTail.tailed = true;
            awaitingTail = undefined;
        }
    }
    return { heading, tables };
}

/* --------------------------------------------------------------------- */
/*  The corpus                                                            */
/* --------------------------------------------------------------------- */

/**
 * One place note, as the rules read it.
 *
 * @typedef {object} PlaceNode
 * @property {object} note - The note.
 * @property {string} shortcode - Lower case.
 * @property {string} subType
 * @property {string} title
 * @property {Set<string>} names - Its name and listed forms, lower case.
 * @property {string[]} parents - Enclosing places' shortcodes.
 * @property {{heading: number, tables: SettlementTable[]}} section
 */

/**
 * Everything the rules ask of the whole tree.
 *
 * @typedef {object} Corpus
 * @property {Map<string, PlaceNode>} places - By shortcode.
 * @property {Map<object, PlaceNode>} byNote - By note.
 * @property {Map<string, PlaceNode[]>} covers - Region shortcode → the
 *   settlement notes its table covers.
 * @property {Map<object, object[]>} rowedIn - Settlement note → the region
 *   notes whose tables link it, in path order.
 */

/** @type {WeakMap<object, Corpus>} */
const CORPUS = new WeakMap();

/**
 * A note's name and listed forms, lower case.
 *
 * @param {object} fm - The frontmatter.
 * @returns {Set<string>} The names.
 */
function namesOf(fm) {
    const name = fm?.name;
    const out = new Set();
    const add = (value) => {
        if (typeof value === "string" && value.trim()) out.add(value.trim().toLowerCase());
    };
    if (typeof name === "string") add(name);
    else if (name && typeof name === "object") {
        add(name.full);
        for (const form of nameFormsOf(name)) add(form);
    }
    return out;
}

/**
 * The note or entry a wikilink in a cell names, or `undefined`.
 *
 * @param {object} index - The link index.
 * @param {string} target - The link target.
 * @returns {object|undefined} The hit.
 */
function resolveTarget(index, target) {
    if (!target) return undefined;
    return index.resolve?.(target) ?? index.addressHit?.(target);
}

/**
 * The type of what a link resolved to.
 *
 * @param {object} hit - A local note or a fetched entry.
 * @returns {string} The type, lower case.
 */
function typeOf(hit) {
    return String(hit?.fm?.type ?? hit?.type ?? "").toLowerCase();
}

/**
 * The wikilink targets a cell carries.
 *
 * @param {string} text - The cell.
 * @returns {string[]} The targets, in order.
 */
function targetsIn(text) {
    return [...text.matchAll(new RegExp(WIKILINK.source, "g"))].map(
        (match) => parseWikilink(match[1]).target,
    );
}

/**
 * The places above one, nearest first.
 *
 * @param {Map<string, PlaceNode>} places - By shortcode.
 * @param {PlaceNode} node - Where to start.
 * @returns {PlaceNode[]} The ancestors, a cycle broken.
 */
function ancestorsOf(places, node) {
    const seen = new Set([node.shortcode]);
    const out = [];
    const queue = [...node.parents];
    while (queue.length) {
        const next = queue.shift();
        if (!next || seen.has(next)) continue;
        seen.add(next);
        const above = places.get(next);
        if (!above) continue;
        out.push(above);
        queue.push(...above.parents);
    }
    return out;
}

/**
 * The corpus a link index describes, derived once.
 *
 * @param {object} index - The link index.
 * @returns {Corpus} The corpus.
 */
function corpusOf(index) {
    let found = CORPUS.get(index);
    if (found) return found;
    /** @type {Map<string, PlaceNode>} */
    const places = new Map();
    /** @type {Map<object, PlaceNode>} */
    const byNote = new Map();
    for (const note of index.notes ?? []) {
        const fm = note.fm ?? {};
        if (String(fm.type ?? note.type ?? "") !== "place") continue;
        const shortcode = String(fm.shortcode ?? "").toLowerCase();
        if (!shortcode) continue;
        const data =
            fm.data && typeof fm.data === "object" && !Array.isArray(fm.data) ? fm.data : {};
        const node = {
            note,
            shortcode,
            subType: String(fm.subType ?? ""),
            title: String(fm.name?.full ?? fm.name ?? shortcode),
            names: namesOf(fm),
            parents: shortcodesOf(data.parents),
            section: findSettlementTables(note.raw ?? ""),
        };
        byNote.set(note, node);
        // Shortcode identity: `parents` names places by shortcode, as populations reads it.
        if (!places.has(shortcode)) places.set(shortcode, node);
    }

    /** @type {Map<string, PlaceNode[]>} */
    const covers = new Map();
    for (const node of places.values()) {
        if (node.subType !== "settlement") continue;
        const owner = ancestorsOf(places, node).find((above) => above.section.tables.length);
        if (!owner) continue;
        const list = covers.get(owner.shortcode);
        if (list) list.push(node);
        else covers.set(owner.shortcode, [node]);
    }

    /** @type {Map<object, object[]>} */
    const rowedIn = new Map();
    const regions = [...byNote.values()]
        .filter((node) => node.section.tables.length)
        .sort((a, b) => String(a.note.file).localeCompare(String(b.note.file), "en"));
    for (const region of regions) {
        for (const table of region.section.tables) {
            for (const { cells } of table.rows) {
                const [target] = targetsIn(cells.Name?.text ?? "");
                const hit = resolveTarget(index, target);
                if (!hit?.fm || typeOf(hit) !== "place") continue;
                const list = rowedIn.get(hit) ?? [];
                if (!list.includes(region.note)) list.push(region.note);
                rowedIn.set(hit, list);
            }
        }
    }

    found = { places, byNote, covers, rowedIn };
    CORPUS.set(index, found);
    return found;
}

/* --------------------------------------------------------------------- */
/*  The check                                                             */
/* --------------------------------------------------------------------- */

/**
 * A count as a finding spells it.
 *
 * @param {number} n - The figure.
 * @returns {string} Grouped in threes.
 */
function counted(n) {
    return n.toLocaleString("en-US");
}

/**
 * A People cell as a figure, or `undefined`.
 *
 * @param {string} text - The cell.
 * @returns {number|undefined} The figure.
 */
function figureOf(text) {
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(text)) return undefined;
    const n = Number(text.replace(/,/g, ""));
    return n > 0 ? n : undefined;
}

/**
 * A Market cell as a class, or `undefined`.
 *
 * @param {string} text - The cell.
 * @returns {import("./market-class.mjs").MarketClass|undefined} The class.
 */
function classOf(text) {
    const match = /^(\d+) (.+)$/.exec(text);
    const entry = match ? marketClass(match[1]) : undefined;
    return entry && entry.name === match?.[2] ? entry : undefined;
}

/**
 * A class as a cell writes it.
 *
 * @param {import("./market-class.mjs").MarketClass} entry - The class.
 * @returns {string} The cell.
 */
function cellOf(entry) {
    return `${entry.value} ${entry.name}`;
}

/**
 * Check a place note's settlements tables.
 *
 * Declared as part of the `place` vocabulary's whole-note check, so the lint
 * runs it with the index every reference resolves through. Without an index
 * nothing is reported.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, holding the whole corpus.
 * @returns {object[]} Findings.
 */
export function checkSettlementTables(note, { index } = {}) {
    if (!index) return [];
    if (String(note.fm?.type ?? "") !== "place") return [];
    const corpus = corpusOf(index);
    const self = corpus.byNote.get(note);
    const section = self?.section ?? findSettlementTables(note.raw ?? "");
    if (!section.tables.length) return [];

    const findings = [];
    const report = (rule, position, message) =>
        findings.push({
            file: note.file,
            ...position,
            severity: "error",
            message: `${rule}: ${message}`,
        });
    const at = (line, cell) => (cell ? { line, column: cell.column } : { line });

    const models = HOLDING_MODELS.filter((model) => hasTag(note.fm, model.tag));
    if (!models.length) {
        const tags = positionOfFrontmatterPath(note.raw ?? "", ["tags"], { key: true });
        report(
            "no holding model",
            tags.line ? tags : { line: section.heading },
            `a settlements table is written in a holding model, and this note carries none of ` +
                `the tags ${HOLDING_MODELS.map((m) => m.tag).join(", ")}`,
        );
    }

    const covered = self ? (corpus.covers.get(self.shortcode) ?? []) : [];
    const rowed = new Set();
    let readable = true;

    for (const table of section.tables) {
        if (!table.tailed) {
            report(
                "no tail",
                { line: table.last },
                "a sentence follows a settlements table, stating what the table leaves out",
            );
        }
        if (!table.wellFormed) {
            readable = false;
            report(
                "settlements columns",
                { line: table.line },
                `the header reads \`| ${table.header.join(" | ")} |\`; a settlements table's ` +
                    `columns are \`${declaredHeader()}\`, and only ` +
                    `${SETTLEMENT_COLUMNS.filter((c) => !c.required)
                        .map((c) => c.name)
                        .join(", ")} may be left out`,
            );
            continue;
        }

        const seen = new Set();
        for (const { line, cells } of table.rows) {
            const name = cells.Name;
            const [nameTarget] = targetsIn(name.text);
            const label = name.text.replace(/\\\|/g, "|");
            let identity = `name:${name.text.toLowerCase()}`;
            /** @type {object|undefined} */
            let settlement;

            if (nameTarget) {
                const hit = resolveTarget(index, nameTarget);
                identity = `link:${nameTarget.toLowerCase()}`;
                if (hit) {
                    identity = hit.file ? `file:${hit.file}` : identity;
                    if (typeOf(hit) !== "place") {
                        report(
                            "not a settlement",
                            at(line, name),
                            `${label} names a ${typeOf(hit) || "document"}; a row's Name ` +
                                "links the place note of the settlement it describes",
                        );
                    } else if (hit.fm) {
                        settlement = hit;
                    }
                }
            } else if (name.text) {
                const match = covered.find((node) => node.names.has(name.text.toLowerCase()));
                if (match) {
                    rowed.add(match.note);
                    report(
                        "unlinked settlement",
                        at(line, name),
                        `${name.text} has a note; write the Name as ` +
                            `\`[[place-${match.shortcode}\\|${name.text}]]\``,
                    );
                }
            }

            const repeated = seen.has(identity);
            seen.add(identity);
            const title = settlement ? String(settlement.fm.name?.full ?? label) : label;
            if (repeated) {
                report(
                    "duplicate settlement",
                    at(line, name),
                    `${label} already has a row in this table`,
                );
            } else if (settlement) {
                // The row belongs to the nearest region above the settlement
                // that rows it, or else to the first table, in path order,
                // that does.
                const tables = corpus.rowedIn.get(settlement) ?? [];
                const owner = corpus.byNote.get(settlement);
                const home =
                    (owner &&
                        ancestorsOf(corpus.places, owner)
                            .map((node) => node.note)
                            .find((region) => tables.includes(region))) ??
                    tables[0];
                if (home && home !== note) {
                    report(
                        "duplicate settlement",
                        at(line, name),
                        `${title} already has a row in ${corpus.byNote.get(home)?.title ?? home.file}`,
                    );
                }
            }
            if (settlement) rowed.add(settlement);

            const market = cells.Market;
            const marketEntry = classOf(market.text);
            if (!marketEntry) {
                const number = /^(\d+)\b/.exec(market.text);
                const named = number ? marketClass(number[1]) : undefined;
                report(
                    "market class",
                    at(line, market),
                    named ?
                        `"${market.text}" — class ${named.value} is written \`${cellOf(named)}\``
                    :   `"${market.text}" is not a class on the market scale; write one of ` +
                            MARKET_CLASSES.map((c) => `\`${cellOf(c)}\``).join(", "),
                );
            }

            const people = cells.People;
            const figure = figureOf(people.text);
            if (figure === undefined) {
                report(
                    "people figure",
                    at(line, people),
                    `"${people.text}" is not a figure; a People cell is a positive whole ` +
                        "number, such as `420` or `3,400`",
                );
            }

            if (settlement) {
                const data = settlement.fm.data ?? {};
                const stated = Number(data.population);
                const has = Number.isFinite(stated) && stated > 0;
                if (figure !== undefined && (!has || stated !== figure)) {
                    report(
                        "figure disagrees",
                        at(line, people),
                        `${title} is carried at ${counted(figure)} here and ` +
                            (has ?
                                `${counted(stated)} on its own note`
                            :   "its own note states none"),
                    );
                }
                const own = marketClass(data.market);
                if (marketEntry && (!own || own.value !== marketEntry.value)) {
                    report(
                        "market disagrees",
                        at(line, market),
                        `${title} is carried as \`${cellOf(marketEntry)}\` here and ` +
                            (own ?
                                `\`${cellOf(own)}\` on its own note`
                            :   "its own note states none"),
                    );
                }
            }

            const holder = cells["Held by"];
            if (!holder.text) {
                report("no holder", at(line, holder), `${label} names no holder`);
                continue;
            }
            for (const target of targetsIn(holder.text)) {
                const hit = resolveTarget(index, target);
                if (!hit) continue;
                const type = typeOf(hit);
                if (!HOLDER_TYPES.includes(type)) {
                    report(
                        "not a holder",
                        at(line, holder),
                        `${target} is a ${type || "document"}; a holder is an affiliation ` +
                            "or a being",
                    );
                } else if (type === "being" && models.length && !models.some((m) => m.person)) {
                    report(
                        "holder out of model",
                        at(line, holder),
                        `${target} is a person, and this region is ` +
                            models.map((m) => `${m.tag}, held by ${m.holder}`).join("; "),
                    );
                }
            }
        }
    }

    if (readable) {
        for (const node of covered) {
            if (rowed.has(node.note)) continue;
            report(
                "missing row",
                { line: section.tables[0].line },
                `${node.title} (\`place-${node.shortcode}\`) stands in this region and has no row`,
            );
        }
    }

    return findings;
}
