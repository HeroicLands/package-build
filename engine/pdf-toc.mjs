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
 * The document tree a PDF is built from, and the plan it resolves to (#316).
 *
 * The packs and the website both render the *whole* content tree: every note
 * becomes a document and a page, and the three surfaces agreeing about what the
 * content is, is the point. **A book is not that.** It is a selection — a
 * declared structure whose leaves pick notes out of the corpus by a `WHERE`
 * clause, interleaved with prose that may not live in the content tree at all.
 *
 * Three consequences follow, and they are behaviour rather than oversights:
 *
 * - **A note no clause selects is not in the book.** A project decides what its
 *   own volume carries, so an omission is an editorial act and this pass has no
 *   standing to call it a defect.
 * - **A note several clauses select appears several times.** A reference work
 *   may legitimately carry an entry under more than one heading, so each
 *   occurrence is its own page, its own outline node and its own anchor — and
 *   inbound links are pointed at the first, so a wikilink resolves to one place
 *   however often the book prints it.
 * - **Prose from `file:` is in the book but not of the tree.** It carries no
 *   address, so nothing can link *to* it, but it is anchored for the table of
 *   contents and its own links still resolve.
 *
 * **What is here is pure.** The tree is validated, flattened and planned without
 * reading a file or opening a database: the filters are run by the caller and
 * handed back as `selections`, the way `expandContentTables` is handed its
 * `sqlTables` because DuckDB is async and the pass is not. That is what lets the
 * whole structure of a 2,500-entry book be asserted in a unit test with no
 * renderer present, which is most of what #316 asks for.
 *
 * **Every gate reports; none exits.** A filter that will not parse, a `file:`
 * that resolves nowhere and a filter reaching another package's schema are
 * findings the command decides about, as everywhere else in this engine.
 *
 * @module
 */

import { slugify } from "./content-slug.mjs";
import { positionOfYamlPath } from "./diagnostics.mjs";

/**
 * Presentation a node may declare, and that its descendants inherit.
 *
 * Reserved now although the first release renders none of them, because the
 * shape of the file is the thing consumers commit to: a book that has to be
 * restructured to gain a running head has the wrong format, not the wrong
 * renderer. Inheritance is what makes them worth declaring at all — `Gear` says
 * once which infobox its entries use, and nine sections beneath it agree.
 *
 * @type {readonly string[]}
 */
export const PRESENTATION_KEYS = Object.freeze(["header", "footer", "infobox", "page"]);

/** Keys a section node may carry. @type {readonly string[]} */
const SECTION_KEYS = Object.freeze(["sectionName", "contents", ...PRESENTATION_KEYS]);

/** Keys a content entry may carry instead of being a section. */
const LEAF_KEYS = Object.freeze(["file", "filter"]);

/**
 * A qualified table name — `sohl.notes` rather than `notes`.
 *
 * The build owns the `SELECT … FROM notes`, so a filter cannot name a table at
 * all; the one way back out of that is a subquery in the `WHERE` clause, which
 * would reach a dependency's schema and put another package's notes in this
 * package's book. Matched loosely on purpose: this refuses a shape rather than
 * parsing SQL, and a false positive is a filter that has to be rewritten while a
 * false negative is a book quietly containing someone else's content.
 */
const QUALIFIED_TABLE = /\bfrom\s+["'`]?[A-Za-z_][\w-]*["'`]?\s*\./i;

/**
 * Validate the raw tree and flatten it into nodes.
 *
 * The format has no chapter/section distinction: every node is a section, and
 * the leaves of the *document* are the notes and prose its contents resolve to.
 * Depth is whatever the tree says, so nothing here caps or normalises it.
 *
 * `contents` is an **ordered, heterogeneous** list — prose, filters and child
 * sections interleave in the sequence written, and that sequence is preserved
 * exactly. A section that opens with a `file:` and then lists its entries is
 * saying something different from one that does the reverse.
 *
 * @param {unknown} raw - The parsed document, as YAML returns it.
 * @param {object} [opts] - Options.
 * @param {string} [opts.text] - The file's source, for finding positions. Every
 *   finding without one is still reported, just without a locator.
 * @returns {{nodes: object[], findings: object[]}} The flattened tree and what
 *   was wrong with it.
 */
export function parseDocumentTree(raw, { text } = {}) {
    const findings = [];
    const nodes = [];
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.contents)) {
        findings.push({
            severity: "error",
            message: "the document tree must be a mapping with a `contents:` list",
        });
        return { nodes, findings };
    }
    walkSections(raw.contents, ["contents"], [], {}, { nodes, findings, text });
    return { nodes, findings };
}

/**
 * One level of `contents`, recursing into the sections it holds.
 *
 * Presentation is resolved on the way down rather than looked up on the way
 * back: a node's own keys override what it inherits, and its children see the
 * merged result, so nothing downstream has to walk back up an ancestry chain to
 * learn which infobox an entry uses.
 *
 * @param {unknown[]} contents - The list to read.
 * @param {Array<string|number>} keyPath - Where it sits in the document.
 * @param {string[]} trail - Section titles above this level.
 * @param {object} inherited - Presentation from ancestors.
 * @param {object} ctx - `{ nodes, findings, text }`, accumulated.
 * @returns {void}
 */
function walkSections(contents, keyPath, trail, inherited, ctx) {
    contents.forEach((entry, i) => {
        const at = [...keyPath, i];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            ctx.findings.push(finding(ctx, at, "each entry in `contents:` must be a mapping"));
            return;
        }
        if (!("sectionName" in entry)) {
            // A bare `file:` or `filter:` at this level belongs to the enclosing
            // section and is collected there, not here.
            if (!LEAF_KEYS.some((k) => k in entry)) {
                ctx.findings.push(
                    finding(ctx, at, "expected `sectionName:`, `file:` or `filter:`"),
                );
            }
            return;
        }
        const title = entry.sectionName;
        if (typeof title !== "string" || !title.trim()) {
            ctx.findings.push(
                finding(ctx, [...at, "sectionName"], "`sectionName:` must be a name"),
            );
            return;
        }
        for (const key of Object.keys(entry)) {
            if (!SECTION_KEYS.includes(key)) {
                ctx.findings.push(
                    finding(ctx, [...at, key], `unknown key \`${key}:\` on a section`, {
                        key: true,
                    }),
                );
            }
        }

        const presentation = { ...inherited };
        for (const key of PRESENTATION_KEYS) {
            if (entry[key] !== undefined) presentation[key] = entry[key];
        }

        const here = [...trail, title];
        const list = Array.isArray(entry.contents) ? entry.contents : [];
        if (entry.contents !== undefined && !Array.isArray(entry.contents)) {
            ctx.findings.push(
                finding(ctx, [...at, "contents"], "`contents:` must be a list", { key: true }),
            );
        }

        ctx.nodes.push({
            title,
            trail: here,
            depth: here.length,
            keyPath: at,
            presentation,
            items: collectItems(list, [...at, "contents"], here, ctx),
        });

        walkSections(list, [...at, "contents"], here, presentation, ctx);
    });
}

/**
 * A section's own leaves, in the order written.
 *
 * Child sections are *not* included: they are walked separately so the flattened
 * node list stays in document order, and a section's items are only the prose
 * and the filters that belong to it directly.
 *
 * @param {unknown[]} contents - The section's `contents`.
 * @param {Array<string|number>} keyPath - Where that list sits.
 * @param {string[]} trail - The section's titles, for a stable item id.
 * @param {object} ctx - `{ findings, text }`.
 * @returns {object[]} Items, tagged by kind.
 */
function collectItems(contents, keyPath, trail, ctx) {
    const items = [];
    contents.forEach((entry, i) => {
        if (!entry || typeof entry !== "object" || "sectionName" in entry) return;
        const at = [...keyPath, i];
        if (typeof entry.file === "string" && entry.file.trim()) {
            items.push({ kind: "prose", file: entry.file.trim(), keyPath: at, id: id(trail, i) });
            return;
        }
        if (typeof entry.filter === "string" && entry.filter.trim()) {
            const where = entry.filter.trim();
            if (QUALIFIED_TABLE.test(where)) {
                ctx.findings.push(
                    finding(
                        ctx,
                        [...at, "filter"],
                        "a filter may not name another package's notes — a book " +
                            "selects from its own project only",
                    ),
                );
                return;
            }
            items.push({ kind: "filter", where, keyPath: at, id: id(trail, i) });
            return;
        }
        if ("file" in entry || "filter" in entry) {
            ctx.findings.push(finding(ctx, at, "`file:` and `filter:` must be non-empty strings"));
        }
    });
    return items;
}

/**
 * A stable identity for one item, so selections can be keyed without the tree.
 *
 * @param {string[]} trail - The owning section's titles.
 * @param {number} index - The item's place in `contents`.
 * @returns {string} The key.
 */
function id(trail, index) {
    return `${trail.join(" ")} ${index}`;
}

/**
 * A finding, positioned in the source when the source was supplied.
 *
 * Carries no `file`: only the caller knows which document this was, which is the
 * rule every rule in this engine follows.
 *
 * @param {object} ctx - `{ text }`.
 * @param {Array<string|number>} keyPath - Where the problem is.
 * @param {string} message - What is wrong.
 * @param {object} [opts] - Passed to {@link positionOfYamlPath}.
 * @returns {object} The finding.
 */
function finding(ctx, keyPath, message, opts) {
    return { severity: "error", message, ...position(ctx.text, keyPath, opts) };
}

/**
 * Run every filter, and report the ones that would not run.
 *
 * The I/O half, kept apart from the planner for the reason the whole engine
 * keeps them apart: the plan is then assertable without a database. The build
 * owns the statement — `SELECT * FROM notes WHERE <clause>` — which is what
 * makes a filter unable to reach another package's schema, unable to project
 * something that is not a note, and unable to pick up the `doc<type>`
 * documentation rows that ride the same index as the notes they document.
 *
 * **A filter that selects nothing is an error**, and the distinction that makes
 * that consistent is worth stating. A *note* no clause selects is expected: the
 * book is a selection and a project decides what its own volume carries. A
 * *clause* that selects no note is not the same thing — a filter is a deliberate
 * act, so one matching nothing is either wrong or left over from a structure
 * that has moved on, and in both cases the tree should not carry it. Reported
 * with the section's name and the filter's position, so the choice between
 * fixing it and deleting it is the author's.
 *
 * @param {object[]} nodes - From {@link parseDocumentTree}.
 * @param {{query: (sql: string) => Promise<{rows: object[]}>}} db - An open
 *   database, from {@link module:engine/sql-tables.openNotesDatabase}.
 * @param {object} [opts] - Options.
 * @param {(record: object) => boolean} [opts.keep] - Which rows are notes.
 * @param {string} [opts.text] - The document's source, for finding positions.
 * @returns {Promise<{selections: Map<string, object[]>, findings: object[]}>}
 */
export async function runTreeFilters(nodes, db, { keep = () => true, text } = {}) {
    const selections = new Map();
    const findings = [];
    for (const node of nodes) {
        for (const item of node.items) {
            if (item.kind !== "filter") continue;
            const where = `\`${node.trail.join(" › ")}\``;
            try {
                const { rows } = await db.query(`SELECT * FROM notes WHERE ${item.where}`);
                const kept = rows.filter(keep);
                selections.set(item.id, kept);
                if (!kept.length) {
                    findings.push({
                        severity: "error",
                        message:
                            `${where}: the filter selected no notes — ` +
                            `\`${item.where}\` matches nothing in this project, so ` +
                            `either it is wrong or the section should not be here`,
                        ...position(text, [...item.keyPath, "filter"]),
                    });
                }
            } catch (err) {
                findings.push({
                    severity: "error",
                    message:
                        `${where}: the filter did not run — ` + String(err.message).split("\n")[0],
                    ...position(text, [...item.keyPath, "filter"]),
                });
                selections.set(item.id, []);
            }
        }
    }
    return { selections, findings };
}

/**
 * Resolve the flattened tree into the document plan.
 *
 * The plan is an ordered list of entries — `section`, `prose`, `note` — and it
 * is the artifact worth having. Order, depth, the outline, the table of
 * contents, anchor uniqueness and every link destination are all readable from
 * it, so nearly the whole of what #316 asks for can be asserted here, on data,
 * without a renderer or a PDF. Only how the result *looks* needs eyes.
 *
 * **Notes are sorted, prose is not.** A section's entries come out in
 * `nameAscii` order — the ASCII fold `buildIndexRecord` already derives, so a
 * circumflex sorts with its letter instead of after `Z` as a raw codepoint
 * comparison would put it. Prose keeps the position it was written in, because
 * its place in the sequence is the author's statement.
 *
 * **A section with nothing in it does not print**, and emptiness is judged after
 * its descendants are: a section holding only sections that all resolved to
 * nothing is itself empty. In a correct tree this never fires — a filter that
 * selects nothing is reported by {@link runTreeFilters} as the error it is — so
 * this is the graceful half of that failure rather than a feature: a build whose
 * filters are broken still produces a readable document to look at while they
 * are fixed. A section holding only prose is not empty; it is a preface.
 *
 * @param {object[]} nodes - From {@link parseDocumentTree}.
 * @param {object} [opts] - Options.
 * @param {Map<string, object[]>} [opts.selections] - Records each filter
 *   selected, keyed by item id. Run by the caller: DuckDB is async and this is
 *   not.
 * @returns {{entries: object[], links: Map<string, string>, stats: object}}
 *   The plan, the address→anchor map inbound wikilinks resolve through, and
 *   what the selection came to.
 */
export function planDocument(nodes, { selections = new Map() } = {}) {
    const entries = [];
    const links = new Map();
    const seen = new Map();
    let selected = 0;

    // Depth-first in document order. `nodes` is already in that order, so a
    // section's children are every later node whose trail begins with its own.
    const roots = nodes.filter((n) => n.depth === 1);
    for (const root of roots) emitSection(root, nodes, { entries, links, seen, selections });

    for (const node of nodes) {
        for (const item of node.items) {
            if (item.kind === "filter") selected += (selections.get(item.id) ?? []).length;
        }
    }

    return {
        entries,
        links,
        stats: {
            sections: entries.filter((e) => e.kind === "section").length,
            prose: entries.filter((e) => e.kind === "prose").length,
            notes: entries.filter((e) => e.kind === "note").length,
            distinct: links.size,
            repeated: selected - links.size,
            skipped: nodes.length - entries.filter((e) => e.kind === "section").length,
        },
    };
}

/**
 * Emit one section and everything beneath it, or nothing if it is empty.
 *
 * Builds the section's own entries into a scratch list first, so the decision to
 * drop it can be made after its children have answered — which is the only way
 * a section of empty sections is itself recognised as empty.
 *
 * @param {object} node - The section.
 * @param {object[]} nodes - Every node, in document order.
 * @param {object} ctx - `{ entries, links, seen, selections }`.
 * @returns {number} How many entries it contributed.
 */
function emitSection(node, nodes, ctx) {
    const start = ctx.entries.length;
    ctx.entries.push({
        kind: "section",
        title: node.title,
        trail: node.trail,
        depth: node.depth,
        presentation: node.presentation,
        anchor: anchorFor(slugify(node.trail.join(" ")) || "section", ctx.seen),
    });

    const children = nodes.filter(
        (n) =>
            n.depth === node.depth + 1 &&
            n.trail.length === node.trail.length + 1 &&
            node.trail.every((t, i) => n.trail[i] === t),
    );
    let contributed = 0;

    for (const item of node.items) {
        if (item.kind === "prose") {
            ctx.entries.push({
                kind: "prose",
                file: item.file,
                trail: node.trail,
                depth: node.depth,
                presentation: node.presentation,
                anchor: anchorFor(slugify(item.file.replace(/\.md$/i, "")) || "prose", ctx.seen),
            });
            contributed++;
            continue;
        }
        for (const record of sortRecords(ctx.selections.get(item.id) ?? [])) {
            const slug = record?.address?.slug ?? record?.shortcode ?? String(ctx.entries.length);
            const anchor = anchorFor(slug, ctx.seen);
            // First occurrence wins the address: however many times the book
            // prints an entry, `[[weapongear-dagger]]` reaches one page.
            if (!ctx.links.has(slug)) ctx.links.set(slug, anchor);
            ctx.entries.push({
                kind: "note",
                record,
                trail: node.trail,
                depth: node.depth,
                presentation: node.presentation,
                anchor,
            });
            contributed++;
        }
    }

    for (const child of children) contributed += emitSection(child, nodes, ctx);

    if (!contributed) {
        ctx.entries.length = start;
        return 0;
    }
    return contributed + 1;
}

/**
 * A section's notes, in the order the book prints them.
 *
 * Ordering is deliberately not in the file format: a filter says *which* notes,
 * never in what sequence. The tiebreak on address keeps the result stable when
 * two entries share a name, which a corpus of 2,500 does eventually.
 *
 * @param {object[]} records - Selected records.
 * @returns {object[]} A sorted copy.
 */
function sortRecords(records) {
    return [...records].sort((a, b) => {
        const an = a?.nameAscii ?? a?.name?.full ?? "";
        const bn = b?.nameAscii ?? b?.name?.full ?? "";
        if (an !== bn) return an < bn ? -1 : 1;
        const as = a?.address?.slug ?? "";
        const bs = b?.address?.slug ?? "";
        return (
            as < bs ? -1
            : as > bs ? 1
            : 0
        );
    });
}

/**
 * A unique anchor, suffixed when the base is already taken.
 *
 * A note selected by two sections is two pages, and two pages cannot share a
 * destination: the outline, the table of contents and any link would all reach
 * whichever the renderer happened to emit last.
 *
 * @param {string} base - The preferred anchor.
 * @param {Map<string, number>} seen - How many times each base has been used.
 * @returns {string} The anchor.
 */
function anchorFor(base, seen) {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
}

/**
 * Where a node sits in the source, when the source was supplied.
 *
 * @param {string|undefined} text - The document source.
 * @param {Array<string|number>} keyPath - Path to the node.
 * @param {object} [opts] - Options.
 * @returns {object} Spreadable position fields.
 */
function position(text, keyPath, opts) {
    return text ? positionOfYamlPath(text, keyPath, opts) : {};
}
