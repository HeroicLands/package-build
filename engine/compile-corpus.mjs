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
 * The corpus one compile runs over, and everything derived from it.
 *
 * **A compile read every note twenty times.** Measured over `sohl`'s 1,685
 * notes: 33,700 reads, exactly twenty per note. Four per pass — the
 * content-wide link index, the table-search corpus, the `sql` directive scan,
 * and the pass's own walk — across five passes that convert wikilinks. Every
 * one of those four is a pure function of the same three things: the tree, the
 * scope, and the pack router. None of the three varies between the passes of a
 * single compile, because `generatePacksJson` resolves one router and hands it
 * to all of them.
 *
 * So they are derived **once**, here, and every pass is handed the result. That
 * is the claim stated at the point where it costs the most: not that
 * re-deriving is wasteful, but that N passes each answering "which files are
 * the corpus?" is N answers that can differ.
 *
 * **This module exists apart from the compilers for an import reason.**
 * Deriving the index reaches the pack router and the manifest emitter, and
 * those reach the compilers — so `base-compiler.mjs` cannot import
 * `content-index.mjs` without closing a cycle. `generate.mjs` can and does; a
 * compiler built directly by a consumer falls back to importing this module
 * from inside its `async prepare`, where a dynamic import is free.
 *
 * @module
 */

import { assertSettlementRecords } from "./settlement-tables.mjs";
import { loadForeignIndexes } from "./metadata-index.mjs";
import { routerFor } from "./pack-router.mjs";
import { authoredFrontmatter, isNoteRecord, noteFile } from "./index-records.mjs";
import { projectPopulationFrontmatter } from "./population-values.mjs";
import { collectAnchors } from "./anchors.mjs";
import { entriesForNote, foundryIdentities } from "./foundry-entries.mjs";
import { indexRecordsFor, preparePublicationBodies } from "./content-index.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { scanAlerts } from "./content-alerts.mjs";
import { scanSpans } from "./content-spans.mjs";
import { buildContentLinkIndex } from "./helpers.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { runContext } from "./content-scripts.mjs";
import { resolveReference } from "./wikilinks.mjs";
import { prepareTreeSqlTables } from "./sql-tables.mjs";

/**
 * Derive the corpus a compile runs over, and the three indexes built over it.
 *
 * @param {object} opts - Options.
 * @param {string} opts.contentBase - Root of the content tree.
 * @param {string} [opts.assetsBase] - The asset roots' parent, whose files the
 *   art addresses resolve against. Defaults to the configured one.
 * @param {readonly string[]} opts.skipDirectories - The scope, stated by the
 *   caller as every corpus read requires.
 * @param {object} opts.router - The pack router this compile resolved. Shared
 *   by every pass when selecting destination-specific prepared views.
 * @param {object} [opts.config] - The resolved configuration.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, so one of them does not abort the compile before it reports. One is
 *   created when none is passed, and returned on the corpus either way — a note
 *   the index refuses is a note the compile must still *report*, exactly as the
 *   compile loop reported it when the loop was the first to see it.
 * @param {import("./content-session.mjs").ContentSession} [opts.session] - Captured context shared with other operations.
 * @returns {Promise<{config: object, audiences: Record<"public"|"all", {linkIndex: object, sqlTables: Map<string, object[]>|undefined}>, currentDate: string, runs: import("./content-scripts.mjs").RunContext, records: object[], parsed: Map<string, object>, pageSources: Map<string, object>, linkIndex: object, sqlTables: Map<string, object[]>|undefined, problems: object[], syntax?: import("./content-session.mjs").ContentSyntax}>} The corpus,
 *   its indexes, and the notes it could not record.
 */
export async function buildCompileCorpus({
    contentBase,
    assetsBase,
    skipDirectories,
    router,
    config,
    problems,
    session,
}) {
    const resolved = config ?? loadPackConfig();
    if (session) {
        session.assertContext({
            config: resolved,
            contentBase,
            assetsBase,
            skipDirectories,
            router,
        });
        if (problems && problems !== session.problems) problems.push(...session.problems);
        return session.compileCorpus();
    }
    if (resolved.art?.archives?.length) {
        const { createContentSession } = await import("./content-session.mjs");
        const capture = await createContentSession({
            config: resolved,
            contentBase,
            assetsBase,
            skipDirectories,
            router,
        });
        try {
            if (problems && problems !== capture.problems) problems.push(...capture.problems);
            const corpus = await capture.compileCorpus();
            /** @type {Map<string, ReturnType<import("./content-session.mjs").ContentSyntax>>} */
            const scanned = new Map();
            /** @type {import("./content-session.mjs").ContentSyntax} */
            const syntax = (source) => {
                const text = String(source ?? "");
                if (!scanned.has(text))
                    scanned.set(text, {
                        blocks: scanBlocks(text),
                        alerts: scanAlerts(text),
                        spans: scanSpans(text),
                    });
                return scanned.get(text);
            };
            return { ...corpus, syntax };
        } finally {
            await capture.dispose();
        }
    }
    const collected = problems ?? [];
    const parsed = new Map();
    const records = indexRecordsFor({
        contentBase,
        assetsBase,
        config: resolved,
        skipDirectories,
        problems: collected,
        parsed,
    });
    const foreign = loadForeignIndexes(resolved, [resolved.contentPackage]);
    assertSettlementRecords(records, {
        fileOf: (record) => noteFile(contentBase, record),
        rawOf: (file) => parsed.get(file)?.raw,
        foreignIndex: foreign.index,
        config: resolved,
    });
    const corpusOptions = { config: resolved, records };
    const sqlOptions = { ...corpusOptions, skipDirectories, parsed };
    const tables = {};
    for (const audience of ["public", "all"])
        tables[audience] = await prepareTreeSqlTables(contentBase, { ...sqlOptions, audience });
    const bodies = await preparePublicationBodies({
        contentBase,
        config: resolved,
        records,
        parsed,
        foreign,
        router,
        prepareAudience: (audience) => tables[audience],
    });
    const audiences = buildCompileAudiences(contentBase, router, {
        config: resolved,
        records,
        tables,
        foreign,
        bodies,
    });
    const { sqlTables, linkIndex } = audiences.public;
    return {
        config: resolved,
        currentDate: resolved.currentDate,
        runs: runContext(resolved, records, {
            referenceName: (target) => resolveReference(linkIndex, target)?.name,
        }),
        records,
        parsed,
        pageSources: bodies.foundryBodies,
        problems: collected,
        linkIndex,
        sqlTables,
        audiences,
    };
}

/**
 * Give each output audience its projected metadata and each target its real page IDs.
 * Private preparation contributes only permitted anchor identities to a public index.
 * @param {string} contentBase - Captured source root.
 * @param {object} router - The compile's pack router.
 * @param {object} options
 * @param {object} options.config - Resolved configuration.
 * @param {object[]} options.records - Complete source records.
 * @param {Record<"public"|"all", Map<string, object[]>|undefined>} options.tables - Isolated prepared views.
 * @param {object} [options.foreign] - Captured dependency metadata.
 * @param {Awaited<ReturnType<typeof preparePublicationBodies>>} options.bodies - Complete prepared bodies and native source provenance.
 * @param {Function} [options.syntax] - Captured syntax scanner.
 * @returns {Record<"public"|"all", {linkIndex: object, sqlTables: Map<string, object[]>|undefined}>} Prepared views.
 */
export function buildCompileAudiences(
    contentBase,
    router,
    { config, records, tables, foreign, bodies, syntax },
) {
    router ??= routerFor(config);
    const identities = { ...foundryIdentities(config), packRouter: router, syntax };
    const audiences = {};
    for (const audience of ["public", "all"]) {
        const links = new Map();
        for (const record of records) {
            if (!isNoteRecord(record)) continue;
            const file = noteFile(contentBase, record);
            const nativeBody = bodies.foundryBodies.get(file)?.markdown;
            const publicBody = bodies.expandedBodies.get(file)?.markdown;
            if (nativeBody === undefined || !record.address?.slug) continue;
            const fm = authoredFrontmatter(record);
            const entries = entriesForNote(
                fm,
                fm.name?.full ?? record.file.name,
                record.address.slug,
                nativeBody,
                { ...identities, pageSource: bodies.foundryBodies.get(file), file },
            );
            const nativeAnchors = collectAnchors(nativeBody, 1, undefined, syntax);
            const publicAnchors = collectAnchors(publicBody ?? "", 1, undefined, syntax).filter(
                (anchor) => anchor.kind === "prose",
            );
            const allowed = bodies.foundryBodies.get(file).publicAnchors;
            const visible = (slug) => audience === "all" || allowed.has(slug);
            const filterIdentities = (values) =>
                values &&
                Object.fromEntries(Object.entries(values).filter(([slug]) => visible(slug)));
            const entry = [];
            entry.anchors = audience === "all" ? nativeAnchors : publicAnchors;
            entry.anchorUuids = filterIdentities(entries[0]?.anchors);
            entry.docAnchorUuids = filterIdentities(entries[1]?.anchors);
            links.set(file, entry);
        }
        const prepared = tables[audience];
        const sqlTables = prepared && Object.assign(new Map(prepared), prepared);
        if (sqlTables)
            for (const [file, result] of prepared) {
                const targets = links.get(file);
                if (targets)
                    sqlTables.set(
                        file,
                        Object.assign([...result], result, {
                            anchors: targets.anchors,
                            anchorUuids: targets.anchorUuids,
                            docAnchorUuids: targets.docAnchorUuids,
                            privatePageSourcePending: undefined,
                        }),
                    );
            }
        audiences[audience] = {
            sqlTables,
            linkIndex: buildContentLinkIndex(contentBase, router, {
                config,
                records: records.map((record) => {
                    const projected = projectPopulationFrontmatter(record, audience);
                    if (audience !== "public" || !isNoteRecord(record)) return projected;
                    const file = noteFile(contentBase, record);
                    const anchors =
                        links.get(file)?.anchors ??
                        collectAnchors(
                            bodies.expandedBodies.get(file)?.markdown ?? "",
                            1,
                            undefined,
                            syntax,
                        );
                    return {
                        ...projected,
                        anchors: [
                            ...anchors.filter((anchor) => anchor.kind === "prose"),
                            ...(record.anchors ?? []).filter((anchor) => anchor.kind === "event"),
                        ],
                    };
                }),
                sqlTables: links,
                foreign,
            }),
        };
    }
    return audiences;
}
