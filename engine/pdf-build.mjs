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
 * The content tree, built into a book.
 *
 * The I/O half of the PDF surface: it reads the configuration, the document
 * tree and the notes, drives the passes the site build already owns, hands the
 * result to {@link module:engine/pdf-render} and runs Typst over what comes
 * back. Everything about *what the book says* is decided in the pure half; this
 * module is where the filesystem and the compiler live.
 *
 * ## The same passes, deliberately
 *
 * A reader who finds the book and the website describing the tree differently
 * has found a bug in one of them, so the book does not get its own walk, its
 * own frontmatter reader or its own link resolver. It collects pages with
 * {@link module:engine/site-build.collectContentPages}, indexes them with
 * `siteGates`, expands tables with `expandContentTables` and resolves links
 * with `resolveWebWikilinks` — the same four calls, in the same order, that
 * `renderPages` makes. What differs is only the last step and the *selection*:
 * the site publishes every page, and the book publishes what its document tree
 * asked for.
 *
 * ## `publish.site` is the switch, and it is the only switch
 *
 * `homepage` mode fences the content surfaces off: the tree is not walked and
 * `sections`, `trees` and `landing` emit nothing however they are declared. A
 * PDF of the content tree is a content surface by any reading — arguably the
 * most portable one there is — so it is fenced on exactly the same terms, by
 * asking the same {@link module:content-config.publishesContentPages} the
 * site build asks. Four of the six packages that would adopt this run
 * `homepage`, and a PDF that appeared there would breach the fence silently:
 * nothing in those packages' configuration would say so. So the fence is
 * checked **before** the tree is read, and the command says why it built
 * nothing rather than emitting an empty document.
 *
 * ## Every gate reports; none exits
 *
 * A filter that selects nothing, a `file:` that resolves nowhere, a table that
 * will not run and a missing Typst binary are all findings handed back to the
 * caller. `bin/content-build.mjs` decides what to do about them — which is the
 * rule the whole engine is built on, and what lets one pass serve a lint, a
 * build step and a unit test.
 *
 * ## Typst is a binary, not a dependency
 *
 * The compiler is invoked as an external program, found on `PATH` or named by
 * `pdf.binary`. The alternative — a native npm package — would put a
 * platform-specific compiled artefact into the dependency tree of three
 * repositories, only one of which is mostly a book, and would have to resolve
 * on every consumer's CI runner before any of them could install the
 * toolchain at all. A missing binary is reported as a finding and leaves the
 * `.typ` source on disk, which is both the diagnostic and the thing a consumer
 * can compile by hand.
 *
 * @module
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import YAML from "yaml";

import { loadPackConfig } from "./pack-config.mjs";
import { publishesContentPages } from "../content-config.mjs";
import { indexRecordsFor } from "./content-index.mjs";
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { openNotesDatabase, prepareTreeSqlTables } from "./sql-tables.mjs";
import { parseDocumentTree, runTreeFilters, planDocument } from "./pdf-toc.mjs";
import { collectContentPages, siteGates, tableUniverse, gatesFailed } from "./site-build.mjs";
import { wikiContext } from "./site-index.mjs";
import { resolveWebWikilinks } from "./web-wikilinks.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { protectCode } from "./code-fences.mjs";
import { createParser, markdownToTypst, renderBook, resolveDanglingLabels } from "./pdf-render.mjs";
import { resolveIconGlyphs } from "./pdf-fonts.mjs";

/**
 * The file name a downloaded book identifies itself by.
 *
 * The zip and the manifest take their names from the manifest, so an asset's
 * name and its advertised URL cannot disagree. A PDF has no advertised URL, so
 * its name is a free choice — which is exactly why it is fixed here rather than
 * left for each of six consumers to invent.
 *
 * @param {string} artifact - The package's artifact name.
 * @param {string} version - The version being released.
 * @returns {string} `<artifact>-<version>.pdf`, or `<artifact>.pdf` unversioned.
 */
export function pdfFileName(artifact, version) {
    const safe = String(artifact || "content").replace(/[^\w.-]+/g, "-");
    return version ? `${safe}-${version}.pdf` : `${safe}.pdf`;
}

/**
 * Read and parse the declared document tree.
 *
 * @param {string} file - Absolute path to the document tree.
 * @returns {{raw: unknown, text: string, findings: object[]}} What it held.
 */
function readDocumentTree(file) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        return {
            raw: null,
            text: "",
            findings: [
                {
                    file,
                    severity: "error",
                    message: "the document tree named by `pdf.document` cannot be read",
                },
            ],
        };
    }
    try {
        return { raw: YAML.parse(text), text, findings: [] };
    } catch (err) {
        return {
            raw: null,
            text,
            findings: [
                {
                    file,
                    severity: "error",
                    message: `the document tree is not readable YAML: ${err.message}`,
                },
            ],
        };
    }
}

/**
 * Build the book.
 *
 * @param {object} [opts] - Options.
 * @param {object} [opts.config] - A resolved configuration; loaded when absent.
 * @param {string} [opts.out] - Where to write, overriding `pdf.out`.
 * @param {string} [opts.version] - Stamped on the title page and the file name.
 * @param {boolean} [opts.compile] - Whether to run Typst. False leaves the
 *   `.typ` source, which is what the unit tests read.
 * @returns {Promise<object>} `{ built, reason, findings, typ, pdf, stats }`.
 */
export async function buildPdf({ config, out, version = "", compile = true } = {}) {
    const resolved = config ?? loadPackConfig();
    const findings = [];

    // The fence, first — before the tree is read, before anything is walked.
    if (!publishesContentPages(resolved)) {
        return {
            built: false,
            reason:
                "`publish.site` is `homepage`, which fences the content surfaces off — " +
                "the tree is not walked and no book is built. Publish content to build one.",
            findings,
            typ: null,
            pdf: null,
            stats: null,
        };
    }
    if (!resolved.pdf) {
        return {
            built: false,
            reason: "no `pdf:` block is configured, so this package publishes no book",
            findings,
            typ: null,
            pdf: null,
            stats: null,
        };
    }

    const contentBase = resolved.paths.content;
    if (!fs.existsSync(contentBase)) {
        return {
            built: false,
            reason: "this package has no content tree, so there is nothing to print",
            findings,
            typ: null,
            pdf: null,
            stats: null,
        };
    }

    const tree = readDocumentTree(resolved.pdf.document);
    findings.push(...tree.findings);
    if (!tree.raw) {
        return { built: false, reason: null, findings, typ: null, pdf: null, stats: null };
    }

    const parsed = parseDocumentTree(tree.raw, { text: tree.text });
    findings.push(...parsed.findings.map((f) => ({ file: resolved.pdf.document, ...f })));

    // The corpus, once — the same records the index, the site and the SQL
    // tables read, so the book cannot select a note the other surfaces do not
    // have.
    const records = indexRecordsFor({
        contentBase,
        config: resolved,
        skipDirectories: resolved.skipDirectories,
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-pdf-"));
    const db = await openNotesDatabase(records, { dir });
    const ran = await runTreeFilters(parsed.nodes, db, {
        keep: isNoteRecord,
        text: tree.text,
    });
    findings.push(...ran.findings.map((f) => ({ file: resolved.pdf.document, ...f })));

    const plan = planDocument(parsed.nodes, { selections: ran.selections });

    // Pages, indexed and gated exactly as the site does. A book of a tree whose
    // addresses collide would print the wrong entry under the right name.
    const scheme = resolved.publish.address;
    const base = resolved.site.base || `/${resolved.contentPackage}/`;
    const ctx = {
        packages: new Set(
            resolved.site.packages.length ? resolved.site.packages : [resolved.contentPackage],
        ),
        contentPackage: resolved.contentPackage,
        skipDirectories: resolved.skipDirectories,
        config: resolved,
        records,
        base,
        mount: `${base}${scheme.prefix}`,
        scheme,
    };
    const collected = collectContentPages(contentBase, ctx);
    const gates = siteGates(collected.pages, collected, { config: resolved });
    if (gatesFailed(gates)) {
        for (const [name, list] of Object.entries(gates)) {
            if (!Array.isArray(list)) continue;
            for (const f of list) {
                findings.push({
                    file: f.file ?? contentBase,
                    severity: "error",
                    message: f.message ?? `${name}: ${JSON.stringify(f)}`,
                });
            }
        }
        return { built: false, reason: null, findings, typ: null, pdf: null, stats: null };
    }

    const byFile = new Map(collected.pages.map((page) => [page.file, page]));
    const universe = tableUniverse(collected.pages);
    const sqlTables = await prepareTreeSqlTables(contentBase, {
        config: resolved,
        skipDirectories: resolved.skipDirectories,
        records,
    });
    const md = createParser(resolved.icons);
    const glyphs = resolveIconGlyphs(resolved.icons, resolved.pdf.iconFonts, findings);

    /**
     * One note's markdown, through the same passes the site runs.
     *
     * @param {object} page - A collected page.
     * @param {number} headingOffset - Where the book put this entry.
     * @param {string} anchorPrefix - The entry's anchor, namespacing its sections.
     * @returns {string} Typst markup.
     */
    const renderPage = (page, headingOffset, anchorPrefix) => {
        const src = page.relPath ?? page.rel ?? page.base;
        const wikiErrors = [];
        const { markdown, errors } = expandContentTables(page.body, {
            docs: universe.get(page.pkg) ?? [],
            linkable: (d) => Boolean(d.fm.shortcode),
            source: src,
            sqlTables: sqlTables?.get(page.file),
            self: { fm: page.fm, path: page.relPath },
        });
        for (const err of errors) {
            findings.push({
                file: page.file,
                severity: "error",
                message: String(err.message ?? err),
            });
        }
        const linkCtx = wikiContext(gates.index, {
            src,
            file: page.file,
            type: page.fm.type ?? null,
            errors: wikiErrors,
            foreignIndex: gates.foreign.index,
        });
        // Code fences are protected for the same reason every other pass
        // protects them: a wikilink shown as an example is prose about a
        // wikilink, and resolving it would make the example impossible to write.
        const resolvedBody = protectCode(markdown, (text) => resolveWebWikilinks(text, linkCtx));
        for (const err of wikiErrors) {
            findings.push({
                file: page.file,
                severity: "warning",
                message: String(err.message ?? err),
            });
        }
        return markdownToTypst(resolvedBody, {
            md,
            links: plan.links,
            glyphs,
            headingOffset,
            anchorPrefix,
        });
    };

    const bodies = new Map();
    let missing = 0;
    for (const entry of plan.entries) {
        if (entry.kind === "note") {
            const file = noteFile(contentBase, entry.record);
            const page = byFile.get(file);
            if (!page) {
                missing += 1;
                continue;
            }
            // The note's own headings nest *under* the heading the book gave its
            // entry. A note's body starts at `##` — its name is frontmatter, not
            // an H1 — so an offset of the entry's depth puts that `##` one level
            // below the entry heading at `depth + 1`, which is where it belongs.
            bodies.set(entry.anchor, renderPage(page, entry.depth, entry.anchor));
            continue;
        }
        if (entry.kind === "prose") {
            const file = path.resolve(resolved.rootDir, entry.file);
            let text;
            try {
                text = fs.readFileSync(file, "utf8");
            } catch {
                findings.push({
                    file: resolved.pdf.document,
                    severity: "error",
                    message: `the prose file \`${entry.file}\` cannot be read`,
                });
                continue;
            }
            bodies.set(
                entry.anchor,
                markdownToTypst(text, {
                    md,
                    links: plan.links,
                    glyphs,
                    headingOffset: entry.depth,
                    anchorPrefix: entry.anchor,
                }),
            );
        }
    }
    if (missing) {
        findings.push({
            file: contentBase,
            severity: "warning",
            message:
                `${missing} selected note(s) have an index record but no collected page, ` +
                "so they print as a heading with no body",
        });
    }

    const front = resolved.pdf.front.map((file) => {
        try {
            return markdownToTypst(fs.readFileSync(file, "utf8"), {
                md,
                links: plan.links,
                glyphs,
            });
        } catch {
            findings.push({
                file,
                severity: "error",
                message: "the front-matter file named by `pdf.front` cannot be read",
            });
            return "";
        }
    });

    const assembled = renderBook({
        plan,
        bodies,
        title: resolved.pdf.title,
        subtitle: resolved.pdf.subtitle,
        front,
        fonts: resolved.pdf.fonts,
        version,
    });
    // Last, over the whole document: a reference can only be checked once every
    // declaration is in one string, and Typst treats a dangling one as fatal.
    const source = resolveDanglingLabels(assembled, findings);

    const outDir = path.resolve(
        resolved.rootDir,
        out || resolved.pdf.out || path.join("build", "dist"),
    );
    fs.mkdirSync(outDir, { recursive: true });
    const stem = pdfFileName(resolved.foundryPackage?.id ?? resolved.contentPackage, version);
    const typPath = path.join(outDir, stem.replace(/\.pdf$/, ".typ"));
    const pdfPath = path.join(outDir, stem);
    fs.writeFileSync(typPath, source);

    const stats = { ...plan.stats, entries: plan.entries.length, bytes: source.length };
    if (!compile) {
        return { built: true, reason: null, findings, typ: typPath, pdf: null, stats };
    }

    const compiled = compileTypst(typPath, pdfPath, resolved.pdf);
    if (!compiled.ok) {
        findings.push({ file: typPath, severity: "error", message: compiled.message });
        return { built: false, reason: null, findings, typ: typPath, pdf: null, stats };
    }
    return { built: true, reason: null, findings, typ: typPath, pdf: pdfPath, stats };
}

/**
 * Run Typst over the emitted source.
 *
 * @param {string} typPath - The `.typ` file.
 * @param {string} pdfPath - Where the PDF goes.
 * @param {object} pdf - The resolved `pdf:` block.
 * @returns {{ok: boolean, message: string}} What happened.
 */
export function compileTypst(typPath, pdfPath, pdf = {}) {
    const binary = pdf.binary || "typst";
    const args = ["compile"];
    if (pdf.fonts?.path) args.push("--font-path", pdf.fonts.path);
    args.push(typPath, pdfPath);
    let result;
    try {
        result = spawnSync(binary, args, { encoding: "utf8" });
    } catch (err) {
        return { ok: false, message: `could not run \`${binary}\`: ${err.message}` };
    }
    if (result.error) {
        const missing = /** @type {any} */ (result.error).code === "ENOENT";
        return {
            ok: false,
            message:
                missing ?
                    `\`${binary}\` is not installed — the Typst source was written, and ` +
                    "`typst compile` over it produces the book. Name another binary with " +
                    "`pdf.binary`."
                :   `could not run \`${binary}\`: ${result.error.message}`,
        };
    }
    if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || "")
            .trim()
            .split("\n")[0];
        return { ok: false, message: `\`${binary} compile\` failed: ${detail}` };
    }
    return { ok: true, message: "" };
}
