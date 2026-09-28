/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** A private, reusable site renderer for an editor's active note. @module */

import path from "node:path";
import matter from "gray-matter";
import { indexRecordsFor, indexRecordsForNote } from "./content-index.mjs";
import { noteAddressContext, decodeNoteAddresses, encodeAddresses } from "./note-addresses.mjs";
import { noteFile } from "./index-records.mjs";
import { foundryIdentities } from "./foundry-entries.mjs";
import { applyComputedBeingAge, presentAmongRecords } from "./being-age.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { cachedMetadataIndexes, noContentIndexPackages } from "./metadata-index.mjs";
import { buildSiteIndex } from "./site-index.mjs";
import { openNotesDatabase, prepareSqlTables, findSqlBlocks } from "./sql-tables.mjs";
import { isGmNote } from "./note-vocabulary.mjs";
import { relatedPages } from "./related-pages.mjs";
import { holdingsNode, holdingsPages, foreignHoldingsNodes } from "./holdings.mjs";
import { assetAddressIndex } from "./art-fields.mjs";
import { frontmatterWikilinks } from "./web-wikilinks.mjs";
import { positionOfLiteral } from "./diagnostics.mjs";
import { addressSlug } from "./content-address.mjs";
import { homepageTitle } from "./homepage.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import {
    collectContentPages,
    collectHomepages,
    gatesFailed,
    renderPages,
    renderSitePage,
    resolveSitePass,
    siteGates,
    sitePageDecorator,
    tableUniverse,
} from "./site-build.mjs";

/** Prepare saved project state once, then render live text without writing a site. */
export async function prepareSitePreview({ config = loadPackConfig() } = {}) {
    const contentBase = config.paths.content;
    const base = config.site.base || `/${config.contentPackage}/`;
    const dependencies = cachedMetadataIndexes(config);
    const pass = resolveSitePass(config.site.pass, {
        ...config.site.passOptions,
        repoRoot: config.rootDir,
    });
    const context = {
        config,
        packages: new Set(
            config.site.packages.length ? config.site.packages : [config.contentPackage],
        ),
        contentPackage: config.contentPackage,
        skipDirectories: config.skipDirectories,
        base,
        mount: `${base}${config.publish.address.prefix}`,
        scheme: config.publish.address,
    };
    let snapshot;

    async function load() {
        const records = indexRecordsFor({ config });
        const ctx = { ...context, records };
        const { pages, ...findings } = collectContentPages(contentBase, ctx);
        const homepages = collectHomepages(contentBase, ctx).pages;
        const homeEntries = homepages.map((home) => ({
            kind: "content",
            fm: home.fm,
            body: home.body,
            pkg: config.contentPackage,
            name: home.fm.name?.full ?? homepageTitle(home.fm, config),
            title: homepageTitle(home.fm, config),
            slug: addressSlug(home.fm),
            base: path.basename(home.file),
            url: base,
        }));
        const gates = siteGates([...pages, ...homeEntries], findings, { config, records });
        if (gatesFailed(gates))
            throw new Error("site preview cannot prepare: site integrity gates failed");
        const db = await openNotesDatabase(
            records.filter((record) => !isGmNote(record)),
            {
                dependencies,
                addressContext: noteAddressContext(config),
                audience: "public",
            },
        );
        try {
            const sources = pages
                .filter((page) => findSqlBlocks(page.body).length)
                .map((page) => ({ source: page.file, markdown: page.body }));
            const sqlTables = await prepareSqlTables(db, sources);
            const rendered = renderPages(pages, {
                index: gates.index,
                foreign: gates.foreign,
                universe: tableUniverse(pages),
                pass,
                decorate: sitePageDecorator(config, gates.index),
                sqlTables,
                config,
                records,
                homepages: homeEntries,
                write: false,
                capture: "graph",
            });
            return { records, pages, homeEntries, gates, db, rendered };
        } catch (error) {
            await db.close();
            throw error;
        }
    }

    snapshot = await load();

    return {
        /** Render the active buffer. Other local and foreign notes remain saved. */
        async render(file, text) {
            const absolute = path.resolve(file);
            const original = snapshot.pages.find((page) => page.file === absolute);
            if (!original)
                return {
                    ok: false,
                    findings: [
                        {
                            file: absolute,
                            severity: "error",
                            message: "note is not a published site page",
                        },
                    ],
                };
            let fm;
            let parsed;
            try {
                parsed = matter(text);
                fm = decodeNoteAddresses(parsed.data, {
                    ...noteAddressContext(config),
                    package: config.contentPackage,
                });
                applyComputedBeingAge(
                    fm,
                    presentAmongRecords(snapshot.records),
                    reckoningContext({ notes: snapshot.records }),
                );
            } catch (error) {
                return {
                    ok: false,
                    findings: [
                        { file: absolute, severity: "error", message: String(error.message) },
                    ],
                };
            }
            const body = parsed.content;
            const bodyLine = text.slice(0, text.length - body.length).split("\n").length;
            const findings = frontmatterWikilinks(fm).map((hit) => ({
                file: absolute,
                severity: "error",
                ...hit,
            }));
            let slug;
            try {
                slug = addressSlug(fm);
            } catch (error) {
                findings.push({ file: absolute, severity: "error", message: error.message });
            }
            if (findings.length) return { ok: false, findings };
            const page = {
                ...original,
                fm,
                body,
                bodyLine,
                name: fm.name?.full ?? path.basename(absolute, ".md"),
                slug,
                url: `${base}${slug}/`,
            };
            const changedMetadata = JSON.stringify(fm) !== JSON.stringify(original.fm);
            let records = snapshot.records;
            let db = snapshot.db;
            let index = snapshot.gates.index;
            try {
                if (changedMetadata) {
                    const overlayRecords = indexRecordsForNote({
                        frontmatter: fm,
                        relPath: original.relPath,
                        absPath: absolute,
                        contentPackage: config.contentPackage,
                        body,
                        bodyLine,
                        manifest: foundryIdentities(config),
                        addressContext: noteAddressContext(config),
                    });
                    records = snapshot.records.filter(
                        (entry) => noteFile(contentBase, entry) !== absolute,
                    );
                    records.push(...overlayRecords);
                    const allPages = snapshot.pages.map((item) =>
                        item.file === absolute ? page : item,
                    );
                    index = buildSiteIndex([...allPages, ...snapshot.homeEntries], {
                        package: config.contentPackage,
                        foreignIndex: snapshot.gates.foreign.index,
                        foreignReferences: snapshot.gates.foreign.references,
                        records,
                        noIndexPackages: noContentIndexPackages(config),
                    });
                    db = await openNotesDatabase(
                        records.filter((record) => !isGmNote(record)),
                        {
                            dependencies,
                            addressContext: noteAddressContext(config),
                            audience: "public",
                        },
                    );
                }
                const sqlTables = await prepareSqlTables(db, [
                    { source: absolute, markdown: body },
                ]);
                const allPages = snapshot.pages.map((item) =>
                    item.file === absolute ? page : item,
                );
                const result = renderSitePage(page, {
                    index,
                    foreign: snapshot.gates.foreign,
                    universe: tableUniverse(allPages),
                    pass,
                    decorate: sitePageDecorator(config, index),
                    sqlTables,
                    config,
                    artIndex: assetAddressIndex(records, {
                        config,
                        foreign: snapshot.gates.foreign,
                        types: index.contentTypes,
                    }),
                });
                for (const error of result.tableErrors)
                    findings.push({
                        file: absolute,
                        line: bodyLine + error.line,
                        column: 1,
                        severity: "error",
                        message: error.reason ?? error.message,
                    });
                for (const error of result.secretErrors)
                    findings.push({ ...error, severity: "error" });
                for (const error of result.captionErrors)
                    findings.push({ ...error, severity: "error" });
                for (const error of result.wikiErrors) {
                    const pos = positionOfLiteral(text, error.link, error.occurrence);
                    findings.push({
                        ...error,
                        ...pos,
                        severity: "error",
                        message: error.message ?? error.reason ?? "unresolved wikilink",
                    });
                }
                for (const error of result.imageErrors) {
                    const pos = positionOfLiteral(text, error.src, error.occurrence);
                    findings.push({ ...error, ...pos, severity: "error" });
                }
                if (findings.length) return { ok: false, findings };
                const edges = snapshot.rendered.edges.filter(([source]) => source !== original.url);
                for (const hit of result.resolved) if (hit.url) edges.push([page.url, hit.url]);
                const entries = new Map(snapshot.rendered.entries);
                entries.delete(original.url);
                entries.set(page.url, {
                    title: fm.title ?? page.name,
                    url: page.url,
                    type: String(fm.type),
                });
                const related = relatedPages(edges, entries).get(page.url);
                if (related) result.data.related = related;
                const holdings = holdingsPages([
                    ...allPages.map((item) =>
                        holdingsNode(item.fm, { title: item.fm.title ?? item.name, url: item.url }),
                    ),
                    ...foreignHoldingsNodes(snapshot.gates.foreign.index),
                ]);
                Object.assign(result.data, holdings.get(page.url));
                return {
                    ok: true,
                    markdown: result.body,
                    frontmatter: encodeAddresses(result.data),
                    findings: [],
                };
            } catch (error) {
                return {
                    ok: false,
                    findings: [
                        { file: absolute, severity: "error", message: String(error.message) },
                    ],
                };
            } finally {
                if (db !== snapshot.db) await db.close();
            }
        },
        /** Re-read saved notes and dependency indexes after a save. */
        async refresh() {
            const next = await load();
            const previous = snapshot;
            snapshot = next;
            await previous.db.close();
        },
        async close() {
            await snapshot.db.close();
        },
    };
}
