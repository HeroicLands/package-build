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

/** One invocation's authored sources and context-specific prepared views. */
import path from "node:path";
import fs from "node:fs";
import { DEPLOYED_ASSET_TYPES } from "./asset-types.mjs";
import { createContentTimings } from "./content-timings.mjs";
import * as contentIndex from "./content-index.mjs";
import * as blocks from "./content-blocks.mjs";
import * as alerts from "./content-alerts.mjs";
import * as spans from "./content-spans.mjs";
import * as sql from "./sql-tables.mjs";
import { captureContentSources } from "./content-sources.mjs";
import { buildLinkIndex } from "./content-links.mjs";
import { buildContentLinkIndex } from "./helpers.mjs";
import { runContext } from "./content-scripts.mjs";
import { loadForeignIndexes } from "./metadata-index.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { routerFor } from "./pack-router.mjs";
import { lintNoteStates } from "./stub-lint.mjs";

/**
 * @typedef {"index"|"lint"|"links"|"compile"} ContentTarget
 * @typedef {(source: string) => {blocks: ReturnType<typeof blocks.scanBlocks>, alerts: ReturnType<typeof alerts.scanAlerts>, spans: ReturnType<typeof spans.scanSpans>}} ContentSyntax
 * @typedef {{config?: import("../content-config.mjs").ContentBuildConfig, contentBase?: string, assetsBase?: string, skipDirectories?: readonly string[], router?: ReturnType<typeof routerFor>}} ContentSessionContext
 * @typedef {{frontmatter: object|null, body: string, raw: string, bodyLine?: number, bodyColumn?: number}} ContentNoteSource
 * @typedef {object} ContentSession
 * @property {import("../content-config.mjs").ContentBuildConfig} config
 * @property {string} contentBase
 * @property {string} assetsBase
 * @property {readonly string[]} skipDirectories
 * @property {ReturnType<typeof routerFor>} router
 * @property {ReturnType<typeof captureContentSources>} inventory
 * @property {Map<string, {raw: string}>} sources
 * @property {object[]} records
 * @property {Map<string, ContentNoteSource>} parsed
 * @property {object[]} problems
 * @property {ReturnType<typeof loadForeignIndexes>} foreign
 * @property {ContentSyntax} syntax
 * @property {(options?: ContentSessionContext) => void} assertContext
 * @property {(audience?: "all"|"public") => ReturnType<typeof sql.prepareTreeSqlTables>} sqlTables
 * @property {() => ReturnType<typeof sql.prepareLinkSqlTables>} linkTables
 * @property {(kind?: "lint"|"links") => Promise<ReturnType<typeof buildLinkIndex>>} audit
 * @property {() => Promise<import("./content-index.mjs").PreparedContentIndex>} publication
 * @property {() => ReturnType<import("./compile-corpus.mjs").buildCompileCorpus>} compileCorpus
 * @property {(targets: readonly ContentTarget[]) => Promise<ContentSession>} prepare
 * @property {ReturnType<typeof createContentTimings>} timings
 * @property {() => void} assertUnchanged
 * @property {() => void} dispose
 */

/**
 * The explicit runner's target vocabulary and execution order.
 * @type {readonly ContentTarget[]}
 */
export const CONTENT_TARGETS = Object.freeze(["index", "lint", "links", "compile"]);

/**
 * Capture one source tree for index, lint, links and compilation.
 * No source or parser state is persisted or reused by another invocation.
 * Prepared SQL databases close within their existing preparation functions.
 * @param {object} [options]
 * @param {import("../content-config.mjs").ContentBuildConfig} [options.config] - Exact resolved configuration.
 * @param {string} [options.contentBase] - Content root, defaulting to configuration.
 * @param {string} [options.assetsBase] - Assets root, defaulting to configuration.
 * @param {readonly string[]} [options.skipDirectories] - Resolved content scope.
 * @param {ReturnType<typeof routerFor>} [options.router] - One router shared by this session's compile.
 * @param {boolean} [options.trackChanges] - Snapshot physical input metadata for build phase guards.
 * @param {ReturnType<typeof createContentTimings>} [options.timings] - Invocation stage accounting.
 * @returns {Promise<ContentSession>} Captured sources and lazy prepared views; dispose after use.
 */
export async function createContentSession({
    config = loadPackConfig(),
    contentBase = config.paths.content,
    assetsBase = config.paths.assets,
    skipDirectories = config.skipDirectories,
    router = routerFor(config),
    timings = createContentTimings(),
    trackChanges = false,
} = {}) {
    const tree = path.resolve(contentBase);
    const assets = path.resolve(assetsBase);
    const scope = [...skipDirectories];
    const inventory = timings.sync("source capture", () =>
        captureContentSources(tree, assets, scope),
    );
    const fingerprint = (file) => {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : "absent";
    };
    const fingerprints =
        trackChanges ?
            new Map(
                [
                    ...new Set([
                        tree,
                        ...DEPLOYED_ASSET_TYPES.map((entry) => path.resolve(assets, entry.root)),
                        ...inventory.paths.map((entry) => entry.file),
                    ]),
                ].map((file) => [file, fingerprint(file)]),
            )
        :   undefined;
    const parsed = new Map();
    const problems = [];
    const foreign = timings.sync("dependency indexes", () =>
        loadForeignIndexes(config, [config.contentPackage]),
    );
    const syntaxCache = new Map();
    const prepared = new Map();
    let disposed = false;
    const active = () => {
        if (disposed) throw new Error("Content session has been disposed");
    };
    const syntax = (source) => {
        active();
        const text = String(source ?? "");
        if (!syntaxCache.has(text))
            syntaxCache.set(text, {
                blocks: blocks.scanBlocks(text),
                alerts: alerts.scanAlerts(text),
                spans: spans.scanSpans(text),
            });
        return syntaxCache.get(text);
    };
    const records = timings.sync("index derivation", () =>
        contentIndex.indexRecordsFor({
            config,
            contentBase: tree,
            assetsBase: assets,
            skipDirectories: scope,
            sources: inventory.indexSources,
            parsed,
            problems,
            foreignIndex: foreign.index,
            syntax,
        }),
    );
    const memo = (key, make) => {
        active();
        if (!prepared.has(key))
            prepared.set(
                key,
                Promise.resolve().then(() => timings.measure(key, make)),
            );
        else timings.hit(key);
        return prepared.get(key);
    };
    const session = {
        timings,
        config,
        contentBase: tree,
        assetsBase: assets,
        skipDirectories: scope,
        router,
        inventory,
        sources: inventory.sources,
        records,
        parsed,
        problems,
        foreign,
        syntax,
        /** Refuse a stale capture after any build phase changes an input. */
        assertUnchanged() {
            active();
            if (!fingerprints)
                throw new Error("Content change tracking was not enabled for this session");
            for (const [file, before] of fingerprints)
                if (fingerprint(file) !== before)
                    throw new Error(
                        `Content sources changed during the build: ${file}. Finish source generation before content build.`,
                    );
        },
        /** Refuse use with a different configuration, root, scope or router. */
        assertContext(options = {}) {
            active();
            if (
                (options.config !== undefined && options.config !== config) ||
                (options.contentBase !== undefined && path.resolve(options.contentBase) !== tree) ||
                (options.assetsBase !== undefined && path.resolve(options.assetsBase) !== assets) ||
                (options.skipDirectories !== undefined &&
                    JSON.stringify(options.skipDirectories) !== JSON.stringify(scope)) ||
                (options.router !== undefined && options.router !== router)
            )
                throw new Error(
                    "Content session context does not match configuration, roots, scope or router",
                );
        },
        async sqlTables(audience = "all") {
            if (audience !== "all" && audience !== "public")
                throw new Error(`Unknown SQL audience: ${audience}`);
            return memo(`sql:${audience}`, () =>
                sql.prepareTreeSqlTables(tree, {
                    config,
                    records,
                    parsed,
                    audience,
                    skipDirectories: scope,
                    foreignIndex: foreign.index,
                    syntax,
                }),
            );
        },
        async linkTables() {
            return memo("link-tables", () =>
                sql.prepareLinkSqlTables(tree, {
                    config,
                    records,
                    parsed,
                    skipDirectories: scope,
                    foreignIndex: foreign.index,
                    prepareAudience: (audience) => session.sqlTables(audience),
                }),
            );
        },
        async audit(kind = "links") {
            if (kind !== "lint" && kind !== "links") throw new Error(`Unknown audit view: ${kind}`);
            return memo(`audit:${kind}`, async () =>
                buildLinkIndex(tree, {
                    config,
                    records,
                    parsed,
                    skipDirectories: scope,
                    foreign,
                    sqlTables:
                        kind === "lint" ?
                            await session.sqlTables("all")
                        :   await session.linkTables(),
                }),
            );
        },
        async publication() {
            return memo("publication", () =>
                contentIndex.prepareContentIndex({ config, contentBase: tree, session }),
            );
        },
        async compileCorpus() {
            return memo("compile", async () => {
                const sqlTables = await session.sqlTables("all");
                return {
                    runs: runContext(config, records),
                    records,
                    parsed,
                    problems,
                    sqlTables,
                    syntax,
                    linkIndex: buildContentLinkIndex(tree, router, {
                        config,
                        records,
                        sqlTables,
                        foreign,
                    }),
                };
            });
        },
        /** Complete selected preparations before a caller starts a writer. */
        async prepare(targets) {
            active();
            for (const target of targets)
                if (!CONTENT_TARGETS.includes(target))
                    throw new Error(`Unknown content target: ${target}`);
            if (targets.includes("index") || targets.includes("compile")) {
                const stateErrors = lintNoteStates(tree, {
                    records,
                    parsed,
                    contentPackage: config.contentPackage,
                }).findings.filter((finding) => finding.severity === "error");
                const findings = [...problems, ...stateErrors];
                if (findings.length)
                    throw Object.assign(new Error("Content preparation failed"), { findings });
            }
            for (const target of CONTENT_TARGETS.filter((target) => targets.includes(target))) {
                if (target === "index") await session.publication();
                else if (target === "compile") await session.compileCorpus();
                else await session.audit(target);
            }
            return session;
        },
        /** Release this invocation's derived views; captured inputs stay unchanged. */
        dispose() {
            disposed = true;
            prepared.clear();
            syntaxCache.clear();
        },
    };
    return session;
}
