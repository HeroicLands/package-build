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
 * **One note, rendered as its site page's body.** {@link renderNoteFile}
 * reads one note of a repository and returns the body HTML
 * `package-build site build` writes for it, through the same page render the
 * site build runs, against the same records: the content tree's index
 * records, the dependencies' fetched indexes, and the note's own query
 * answers. The records and answers are kept under `build/` and reused while
 * every input they were derived from is unchanged; see
 * {@link module:engine/note-cache.noteTree}.
 *
 * @module
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expandContentTables } from "./content-tables.mjs";
import { scanFigures } from "./content-figures.mjs";
import { embedRole } from "./content-embeds.mjs";
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { figureIndexKeys } from "./site-index.mjs";
import { drawSiteMaps } from "./site-maps.mjs";
import { NoteInputsChanged, READ_ATTEMPTS, noteTree } from "./note-cache.mjs";
import { findConfigFile, readPackConfig } from "./pack-config.mjs";
import { recordSiteContext } from "./preview-index.mjs";
import {
    addressDiagnostic,
    contentPage,
    frontmatterLinkDiagnostic,
    pageDiagnostics,
    parseNote,
    renderSitePage,
    resolveSitePass,
    siteBodyRenderer,
    sitePageDecorator,
} from "./site-page.mjs";
import { groupDictionaryLists } from "./dictionary-html.mjs";
import { LEXICAL_LINK_CLASS } from "./dictionary-layout.mjs";
import { walkMarkdownFiles } from "./helpers.mjs";
import { pruneGenerated, splitContent, unlinkEntries } from "./site-reach.mjs";
import { noteBodyStylesheet } from "./content-styles.mjs";
import { isHomepage } from "./homepage.mjs";
import { normalizeCurrentDate } from "./current-date.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { siteBase } from "../content-config.mjs";

/**
 * A rendered note.
 *
 * @typedef {object} NotePage
 * @property {string} html - The page body, as the site theme receives it,
 *   with every page it links counted as reachable from the homepage.
 * @property {string} styles - The CSS the theme applies to a page body; see
 *   {@link module:engine/content-styles.noteBodyStylesheet}.
 * @property {Array<{file?: string, line?: number, column?: number,
 *   severity: string, message: string}>} findings - What the render found,
 *   each printing as `file:line:column: severity: message` through
 *   `formatDiagnostic`.
 * @property {{tree: "hit"|"miss"|"off", notes: number, tables: "hit"|"miss"|"off"}} cache -
 *   What the cache answered: `tree` whether the content tree's records were
 *   reused whole, `notes` how many notes derived their own records again, and
 *   `tables` whether the query answers of the note and of the notes it links
 *   were all reused.
 */

/**
 * Render one note of a repository to the body HTML of its site page.
 *
 * Loads the repository's `package-build.config.yaml`, its dependencies'
 * fetched indexes, the content tree's records and the note's own query
 * answers, and renders the note against them as `package-build site build`
 * renders its page. The records and answers come from
 * `build/cache/note-page/` while every input they were derived from is
 * unchanged; see {@link module:engine/note-cache.noteTree}. The note is read
 * from disk, so what is rendered is what is saved.
 *
 * @param {string} file - The note, relative to `root` or absolute.
 * @param {object} [options]
 * @param {string} [options.root] - The repository, or a directory inside it;
 *   the working directory by default.
 * @param {boolean} [options.cache=true] - Whether to read and write the cache;
 *   `false` derives everything and writes nothing.
 * @param {typeof import("./sql-tables.mjs").prepareTreeSqlTables} [options.prepareTables] -
 *   Prepares the query answers;
 *   {@link module:engine/sql-tables.prepareTreeSqlTables} by default. A host
 *   may wrap it, to time or observe the preparation.
 * @returns {Promise<NotePage>} The body, its styles, the findings and what the
 *   cache did.
 * @throws {Error} When there is no configuration; when the file is not a
 *   note of the content tree; when a dependency's index has not been fetched
 *   or cannot be read, naming `package-build deps fetch`; when a note of the
 *   tree cannot be indexed, as the content-index build reports it; and when
 *   the configuration, fonts or dependency indexes keep changing while they
 *   are read.
 */
export async function renderNoteFile(
    file,
    { root = process.cwd(), cache = true, prepareTables } = {},
) {
    for (let attempt = 1; ; attempt++) {
        try {
            // Everything is resolved afresh on each attempt: the
            // configuration, the ambient setup and the note's place in the
            // tree, so a retry answers as a fresh call would.
            const configPath = findConfigFile(root);
            if (!configPath) throw new Error(`no package-build configuration at or above ${root}`);
            const config = readPackConfig(configPath);
            return await renderInRepository(file, root, config, { cache, prepareTables });
        } catch (error) {
            if (!(error instanceof NoteInputsChanged) || attempt >= READ_ATTEMPTS) throw error;
        }
    }
}

/**
 * {@link renderNoteFile}, with the resolved configuration.
 *
 * @param {string} file - The note, relative to `root` or absolute.
 * @param {string} root - The directory `file` is relative to.
 * @param {object} config - The repository's resolved configuration.
 * @param {{cache: boolean, prepareTables?: Function}} options - Whether to
 *   read and write the cache, and what prepares the answers.
 * @returns {Promise<NotePage>} The rendered note.
 * @throws {NoteInputsChanged} When the inputs moved while they were read.
 */
async function renderInRepository(file, root, config, options) {
    const absolute = path.resolve(root, file);
    const contentBase = path.resolve(config.paths.content);
    const inTree = [...walkMarkdownFiles(contentBase, { skipDirectories: config.skipDirectories })];
    if (!inTree.includes(absolute))
        throw new Error(
            `${absolute}: not a note of the content tree at ${contentBase}, so it has no site page`,
        );
    return renderOnce(absolute, contentBase, config, options);
}

/**
 * One reading and render of {@link renderInRepository}.
 *
 * @param {string} absolute - The note.
 * @param {string} contentBase - The content tree.
 * @param {object} config - The repository's resolved configuration.
 * @param {{cache: boolean, prepareTables?: Function}} options - Whether to
 *   read and write the cache, and what prepares the answers.
 * @returns {Promise<NotePage>} The rendered note.
 * @throws {NoteInputsChanged} When the inputs moved under the answers.
 */
async function renderOnce(absolute, contentBase, config, { cache, prepareTables }) {
    const tree = await noteTree(config, { cache, prepareTables });
    const text = tree.textOf(absolute);
    const context = {
        file: absolute,
        config,
        records: tree.records,
        foreign: tree.foreign,
        contentBase,
        textOf: tree.textOf,
    };
    // The page resolves against the notes it links, as their own pages emit
    // them: so it is rendered once to learn which notes those are, and again
    // with their query answers and generated sections in hand.
    const own = await tree.answers([absolute], absolute);
    const first = renderNote(text, { ...context, sqlTables: own.sqlTables });
    const linked = await tree.answers([absolute, ...first.consulted], absolute);
    const page = renderNote(text, {
        ...context,
        sqlTables: linked.sqlTables,
        linked: new Set([absolute, ...first.consulted]),
    });
    const { consulted: _, ...result } = page;
    return {
        ...result,
        cache: {
            ...tree.cache,
            tables:
                own.tables === "off" ? "off"
                : own.tables === "hit" && linked.tables === "hit" ? "hit"
                : "miss",
        },
    };
}

/**
 * Each linked note's figures, by the addresses a cross-note `ref` writes, as
 * the site build numbers them: from the note's body with its query answers
 * and generated sections expanded.
 *
 * @param {Iterable<object>} targets - The linked notes' records.
 * @param {object} options
 * @param {string} options.contentBase - The content tree.
 * @param {(file: string) => string} options.textOf - A note's text.
 * @param {Map<string, object[]>} options.sqlTables - The prepared answers.
 * @param {object} options.config - The resolved configuration.
 * @param {object} options.assets - The asset address space.
 * @returns {Map<string, Map<string, object>>} The figures.
 */
function linkedFigures(targets, { contentBase, textOf, sqlTables, config, assets }) {
    const figures = new Map();
    for (const record of targets) {
        const file = noteFile(contentBase, record);
        const note = parseNote(textOf(file), file, { config });
        const shortcode = note?.fm?.shortcode;
        if (typeof shortcode !== "string" || !shortcode) continue;
        const { markdown } = expandContentTables(note.body, {
            source: record.file?.path,
            sqlTables: sqlTables.get(file),
            pageLists: sqlTables.pageLists?.get(file),
        });
        const byId = new Map(
            scanFigures(markdown, { resolveRole: (address) => embedRole(assets, address) })
                .figures.filter((figure) => figure.id)
                .map((figure) => [
                    figure.id,
                    { label: figure.label, caption: figure.caption, hasCaption: figure.hasCaption },
                ]),
        );
        const pkg = record.package ?? config.contentPackage;
        const type = String(note.fm.type ?? "").toLowerCase();
        for (const key of figureIndexKeys(pkg, type, shortcode)) figures.set(key, byId);
    }
    return figures;
}

/**
 * The drawing a generated **From here** section names, drawn for this note
 * alone as the site build draws it, in a scratch directory that is removed
 * once the drawing is read.
 *
 * @param {object} options
 * @param {object} options.config - The resolved configuration.
 * @param {object[]} options.records - The tree's records.
 * @param {object} options.foreign - The dependencies' indexes.
 * @param {string} options.shortcode - The note's shortcode.
 * @returns {(name: string) => string|undefined} The drawing's SVG text by the
 *   file name the section names.
 */
function noteDrawing({ config, records, foreign, shortcode }) {
    let drawn;
    return (name) => {
        if (!drawn) {
            const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "note-page-map-"));
            try {
                const { maps } = drawSiteMaps({
                    records,
                    foreignIndex: foreign.index,
                    config,
                    base: siteBase(config),
                    only: [shortcode],
                    outDir,
                });
                drawn = new Map(
                    [...maps].map(([key, map]) => [key, fs.readFileSync(map.file, "utf8")]),
                );
            } finally {
                fs.rmSync(outDir, { recursive: true, force: true });
            }
        }
        return drawn.get(name);
    };
}

/** Split a path on either separator. */
const segments = (file) => String(file).split(/[\\/]/).filter(Boolean);

/**
 * Render one note to the body HTML of its site page, with `config` as the
 * ambient configuration.
 *
 * @param {string} text - The note, frontmatter and body.
 * @param {object} options
 * @param {string} options.file - The note's absolute path, which findings
 *   name and `sqlTables` is keyed by.
 * @param {object} options.config - The package's resolved configuration.
 * @param {object[]} options.records - The content tree's index records.
 * @param {object} options.foreign - The dependencies' indexes, as
 *   {@link module:engine/metadata-index.loadForeignIndexes} returns them.
 * @param {Map<string, object[]>} [options.sqlTables] - The prepared answers to
 *   the note's queries and its generated sections.
 * @returns {Omit<NotePage, "cache">} The body, its styles and the findings.
 */
function renderNote(
    text,
    { file, config, records, foreign, sqlTables, contentBase, textOf, linked },
) {
    const findings = [];
    const styles = noteBodyStylesheet();
    const consulted = new Set();
    const done = (html = "") => ({ html, styles, findings, consulted });

    let note;
    try {
        note = parseNote(String(text ?? ""), file, { config });
    } catch (error) {
        findings.push({ file, ...error.position, severity: "error", message: error.message });
        return done();
    }
    if (!note) {
        findings.push({ file, severity: "error", message: "not a note: no frontmatter" });
        return done();
    }

    // A linked note's anchors are those its own page emits, generated
    // sections included, wherever its answers are in hand.
    const { site, assets, events, runs, pages } = recordSiteContext({
        config,
        records,
        foreign,
        anchorsOf: (record) => sqlTables?.get(noteFile(contentBase, record))?.anchors,
    });
    // Which of the package's pages the render looks up, so their answers can
    // be prepared for the render that is kept.
    const lookups = site.index;
    const recording = new Map(lookups);
    recording.get = (key) => {
        const entry = Map.prototype.get.call(recording, key);
        const record = entry?.url ? pages.get(entry.url) : undefined;
        if (record) consulted.add(noteFile(contentBase, record));
        return entry;
    };
    site.index = recording;
    const renderBody = siteBodyRenderer(config);

    // A homepage is published as authored: no expansion, no link resolution.
    if (isHomepage(note.fm)) return done(renderBody(note.body, { runs }));

    const contentRoot = segments(config.paths?.content ?? "");
    const parts = segments(file);
    const below =
        contentRoot.length > 0 &&
        parts.length > contentRoot.length &&
        contentRoot.every((part, at) => parts[at] === part);
    const made = contentPage(note, {
        file,
        fileBase: parts.at(-1) ?? "",
        relPath: (below ? parts.slice(contentRoot.length) : parts).join("/"),
        folder: parts.at(-2) ?? contentRoot.at(-1) ?? "",
        base: siteBase(config),
        packages: new Set(
            config.site?.packages?.length ? config.site.packages : [config.contentPackage],
        ),
        contentPackage: config.contentPackage,
        sectionPages: new Map(
            Object.entries(config.site?.sections ?? {}).map(([name, address]) => [address, name]),
        ),
        present: normalizeCurrentDate(config.currentDate),
        dates: reckoningContext({ notes: records }),
    });
    if (!made) {
        findings.push({
            file,
            severity: "error",
            message: "publishes no page: a stub, a GM note, or a note with no type",
        });
        return done();
    }
    findings.push(...made.fmLinks.map(frontmatterLinkDiagnostic));
    if (made.addressFinding) {
        findings.push(addressDiagnostic(made.addressFinding));
        return done();
    }

    const result = renderSitePage(made.page, {
        index: site,
        foreign,
        pass: resolveSitePass(config.site?.pass, {
            ...config.site?.passOptions,
            repoRoot: config.rootDir,
            config,
        }),
        decorate: sitePageDecorator(config, site),
        sqlTables,
        config,
        artIndex: assets,
        events,
        runs,
        ...(linked ?
            {
                figuresByAddress: linkedFigures(
                    records.filter(
                        (record) =>
                            isNoteRecord(record) && linked.has(noteFile(contentBase, record)),
                    ),
                    { contentBase, textOf, sqlTables, config, assets },
                ),
                drawing: noteDrawing({ config, records, foreign, shortcode: note.fm.shortcode }),
            }
        :   {}),
    });
    findings.push(...pageDiagnostics(result, (at) => (at === file ? String(text) : "")));
    // The body as the site writer hands it to the theme, with every page it
    // links counted as reachable: which pages the homepage reaches is a fact
    // about the whole site.
    const { authored, generated } = splitContent(
        renderBody(result.markdown, { runs, figures: result.figures }),
    );
    const outside = () => false;
    return done(
        groupDictionaryLists(
            unlinkEntries(authored, outside, LEXICAL_LINK_CLASS) +
                pruneGenerated(generated, outside),
        ),
    );
}
