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
 * The book builds when the authored tree contains content pages. The same
 * {@link module:content-config.publishesContentPages} decision governs the
 * site and the content index.
 *
 * ## Every gate reports; none exits
 *
 * A filter that selects nothing, a `file:` that resolves nowhere, a table that
 * will not run and a missing Typst binary are all findings handed back to the
 * caller. `bin/package-build.mjs` decides what to do about them — which is the
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
 * ## The faces are the toolchain's and the compiler's, never the machine's
 *
 * Every face the book sets resolves from one of two places that travel with the
 * build: the faces this package ships — see {@link BOOK_FONTS_PATH} — and the
 * ones the compiler embeds. The compile passes the shipped directory as
 * `--font-path` and `--ignore-system-fonts` alongside it, so a machine carrying
 * its own copy of a named family cannot quietly set a different book from the
 * same source.
 *
 * `pdf.fonts.path` is searched as well, so a consumer naming a face of its own
 * in `pdf.fonts` still resolves it — and a name nothing resolves is reported,
 * because the compiler says so and a compile that says it still exits 0 with a
 * book set in the fallback.
 *
 * @module
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { loadPackConfig } from "./pack-config.mjs";
import { routerFor } from "./pack-router.mjs";
import { publishesContentPages } from "../content-config.mjs";
import { indexRecordsFor } from "./content-index.mjs";
import { isNoteRecord, isStub, noteFile } from "./index-records.mjs";
import { openNotesDatabase, prepareTreeSqlTables } from "./sql-tables.mjs";
import { parseDocumentTree, runTreeFilters, planDocument } from "./pdf-toc.mjs";
import {
    collectContentPages,
    siteGates,
    tableUniverse,
    gatesFailed,
    resolveSitePass,
} from "./site-build.mjs";
import { resolveInfoboxRef, wikiContext } from "./site-index.mjs";
import { resolveWebWikilinks } from "./web-wikilinks.mjs";
import { linkFindingMessage } from "./wikilink-syntax.mjs";
import { artPathname, assetAddressIndex } from "./art-fields.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { renderMarkdownExpressions } from "./markdown-expressions.mjs";
import { renderSecretBlocks } from "./content-secrets.mjs";
import { numberCaptions, scanCaptions } from "./content-captions.mjs";
import { protectCode } from "./code-fences.mjs";
import { imagesIn, parseImageDirective } from "./content-images.mjs";
import {
    PDF_IMAGE_INCHES,
    PDF_PAGE,
    pdfColumnWidth,
    pdfTextHeight,
    pdfTextWidth,
    resamplePdfImages,
} from "./pdf-images.mjs";
import { pathnameProblem, resolvePathname } from "./pathnames.mjs";
import {
    createParser,
    labelFor,
    markdownToTypst,
    renderBook,
    resolveDanglingLabels,
} from "./pdf-render.mjs";
import { draftNoticeTypst } from "./draft-notice.mjs";
import { isDraftNote } from "./note-vocabulary.mjs";
import { infoboxTypstPreamble, infoboxesToTypst, linkToTypst } from "./infobox-render.mjs";
import { noteInfoboxes } from "./infobox-registry.mjs";
import { resolveIconGlyphs } from "./pdf-fonts.mjs";
import { buildMaps, relatedPlaces } from "./map-build.mjs";
import { mapWorld } from "./map-places.mjs";

/**
 * The file on disk an authored image pathname names, or `null`.
 *
 * Two of the four forms {@link module:engine/pathnames.resolvePathname}
 * derives, used together: `local` is the file in this repository's own tree,
 * and `pdf` is where the book stages a copy of it.
 *
 * **Typst decides where that copy goes.** It resolves a path against its root —
 * the directory holding the source it is given — and refuses to read anything
 * above it. So a file reaches the compiler by being copied under the output
 * directory rather than by widening the root to the whole repository: the
 * emitted `.typ` and everything it opens sit in one directory, which is what
 * makes the source a consumer can compile by hand with no flags, and what keeps
 * a build from touching a path outside its own output.
 *
 * Only a file **this** package ships can be staged. A pathname naming another
 * package's file, or a URL, names something no build here can open — a build
 * reaches no network — and the caller reports it as a picture the book will not
 * carry.
 *
 * @param {string} src - The pathname, as authored.
 * @param {object} config - The resolved configuration.
 * @returns {{from: string, to: string}|null} The file, and where under the
 *   output directory it is staged.
 */
export function stagedImagePath(src, config) {
    const forms = resolvePathname(src, config);
    if (!forms || forms.state !== "package" || !forms.own) return null;
    return {
        from: path.resolve(config.rootDir, forms.local),
        to: forms.pdf,
    };
}

/**
 * Where the book keeps the pictures its section plates are drawn over.
 *
 * Typst resolves a path against its root, which is the directory holding the
 * source it is given, and refuses to read anything above it. So a banner
 * reaches the compiler by being **copied under the output directory** rather
 * than by widening the root to the whole repository: the emitted `.typ` and
 * everything it opens then sit in one directory, which is what makes the
 * source a consumer can compile by hand with no flags.
 *
 * The declared path is mirrored beneath it, so two banners with the same base
 * name cannot land on each other.
 *
 * @type {string}
 */
const STAGED_PLATES = "plates";

/**
 * Copy every banner the document tree names into the output directory.
 *
 * **A missing banner is not a failure.** A section plate implies a banner per
 * section and art arrives later than rendering does, so a section that names
 * none draws its plate over the book's ink and says nothing about it. One that
 * names a file the build cannot read is a different matter — that is a
 * statement the tree makes and the build cannot honour — and it is reported.
 *
 * @param {object[]} entries - The plan's entries.
 * @param {object} config - The resolved configuration.
 * @param {string} outDir - Where the book is written.
 * @param {object[]} findings - Collected here rather than thrown.
 * @returns {Map<string, string>} Declared path → the staged file's path,
 *   relative to the `.typ`.
 */
export function stageBanners(entries, config, outDir, findings = []) {
    const staged = new Map();
    const seen = new Set();
    for (const entry of entries ?? []) {
        const declared = entry?.presentation?.page?.banner;
        if (typeof declared !== "string" || !declared.trim() || seen.has(declared)) continue;
        seen.add(declared);
        const from = path.resolve(config.rootDir, declared);
        const within = path.relative(config.rootDir, from);
        if (within.startsWith("..") || path.isAbsolute(within)) {
            findings.push({
                file: config.pdf.document,
                severity: "warning",
                message:
                    `the banner \`${declared}\` is outside this package, so the section ` +
                    "plate is drawn without a picture — a banner is a file this repository ships",
            });
            continue;
        }
        const to = `${STAGED_PLATES}/${within.split(path.sep).join("/")}`;
        const dest = path.join(outDir, to);
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(from, dest);
        } catch (err) {
            findings.push({
                file: config.pdf.document,
                severity: "warning",
                message:
                    `the banner \`${declared}\` cannot be read, so the section plate is ` +
                    `drawn without a picture: ${err.message}`,
            });
            continue;
        }
        staged.set(declared, to);
    }
    return staged;
}

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
                fs.existsSync(resolved.paths.content) ?
                    "The content tree contains only a homepage, so there is no book to build."
                :   "this package has no content tree, so there is nothing to print",
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
        // A stub is a note and is deliberately in the corpus, but it has no
        // body — selecting one would print a blank page under its name.
        keep: (record) => isNoteRecord(record) && !isStub(record),
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
    const gates = siteGates(collected.pages, collected, { config: resolved, records });
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
    // The address space an `![[…]]` embed resolves against — the same one the
    // site builds, so one authored picture reaches both surfaces or neither.
    const assets = assetAddressIndex(records, {
        config: resolved,
        foreign: gates.foreign,
        types: gates.index?.contentTypes ?? [],
    });
    const md = createParser(resolved.icons);
    const glyphs = resolveIconGlyphs(resolved.icons, resolved.pdf.iconFonts, findings);

    const outDir = path.resolve(
        resolved.rootDir,
        out || resolved.pdf.out || path.join("build", "dist"),
    );
    fs.mkdirSync(outDir, { recursive: true });

    /** @type {Map<string, string>} Authored address → the staged file's path. */
    const images = new Map();
    /** @type {Map<string, {from: string, to: string, relative: string, file: string, uses: Array<{width: number, height: number}>}>} */
    const imageCandidates = new Map();
    /** @type {Set<string>} Addresses already looked for, staged or not. */
    const seenImages = new Set();

    /**
     * Copy every picture one body names into the output directory.
     *
     * Run per body rather than in a pass of its own, because the addresses are
     * read from the markdown *after* its tables have expanded — a generated
     * table is as free to carry an image as prose is.
     *
     * @param {string} body - The rendered markdown.
     * @param {string} file - The note, for the finding.
     * @param {number} columns - The page's column count.
     * @returns {void}
     */
    const stageImages = (body, file, columns = 2) => {
        for (const image of imagesIn(body)) {
            const src = image.src;
            const directive = parseImageDirective(image.directive);
            const wide =
                directive.size === "full-width" || directive.classes.includes("full-width");
            const availableWidth = wide ? pdfTextWidth : pdfColumnWidth(columns);
            const use = {
                width: Math.min(PDF_IMAGE_INCHES[directive.size] ?? availableWidth, availableWidth),
                height: pdfTextHeight * 0.8,
            };
            if (seenImages.has(src)) {
                const stagedTo = images.get(src);
                if (stagedTo) imageCandidates.get(stagedTo)?.uses.push(use);
                continue;
            }
            seenImages.add(src);
            // An **error**, where a picture the book cannot carry is a warning:
            // this pathname resolves on no surface at all, and the replacement
            // is mechanical and named in the message.
            const problem = pathnameProblem(src);
            if (problem) {
                findings.push({ file, severity: "error", message: problem });
                continue;
            }
            const staged = stagedImagePath(src, resolved);
            if (!staged) {
                findings.push({
                    file,
                    severity: "warning",
                    message:
                        `\`${src}\` names a file this package does not ship, so the book ` +
                        "prints the caption where the picture would be — an image the book " +
                        "carries is addressed inside this package",
                });
                continue;
            }
            const dest = path.join(outDir, staged.to);
            try {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.copyFileSync(staged.from, dest);
            } catch (err) {
                findings.push({
                    file,
                    severity: "warning",
                    message:
                        `\`${src}\` cannot be read from ` +
                        `\`${path.relative(resolved.rootDir, staged.from)}\`, so the book ` +
                        `prints the caption where the picture would be: ${err.message}`,
                });
                continue;
            }
            images.set(src, staged.to);
            const candidate = imageCandidates.get(staged.to);
            if (candidate) candidate.uses.push(use);
            else
                imageCandidates.set(staged.to, {
                    ...staged,
                    relative: path.relative(resolved.rootDir, staged.from),
                    file,
                    uses: [use],
                });
        }
    };

    /**
     * One note's markdown, through the same passes the site runs.
     *
     * @param {object} page - A collected page.
     * @param {number} headingOffset - Where the book put this entry.
     * @param {string} anchorPrefix - The entry's anchor, namespacing its sections.
     * @param {number} columns - The entry's page columns.
     * @returns {string} Typst markup.
     */
    const captionCounts = { code: 0, table: 0, figure: 0, prose: 0 };
    const frontCaptions = new Map();
    for (const file of resolved.pdf.front) {
        try {
            const scan = scanCaptions(fs.readFileSync(file, "utf8"));
            frontCaptions.set(file, numberCaptions(scan.captions, captionCounts));
            for (const error of scan.errors)
                findings.push({
                    file,
                    line: error.line,
                    column: error.column,
                    severity: "error",
                    message: error.message,
                });
        } catch {
            // The rendering pass reports an unreadable front-matter file.
        }
    }
    const pass = resolveSitePass(resolved.site?.pass, {
        ...resolved.site?.passOptions,
        repoRoot: resolved.rootDir,
        config: resolved,
        book: true,
    });
    const renderPage = (page, headingOffset, anchorPrefix, columns) => {
        const src = page.relPath ?? page.base;
        const wikiErrors = [];
        const { markdown, errors, lineMap } = expandContentTables(page.body, {
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
            assets,
        });
        const captionScan = scanCaptions(markdown);
        const numberedCaptions = numberCaptions(captionScan.captions, captionCounts);
        linkCtx.captionLabels = new Map(
            numberedCaptions.map((caption) => [caption.id, caption.label]),
        );
        for (const error of captionScan.errors)
            findings.push({
                file: page.file,
                line: (page.bodyLine ?? 1) + (lineMap[error.line - 1]?.line ?? error.line - 1),
                column: error.column,
                severity: "error",
                message: error.message,
            });
        linkCtx.output = "book";
        // Code fences are protected for the same reason every other pass
        // protects them: a wikilink shown as an example is prose about a
        // wikilink, and resolving it would make the example impossible to write.
        const expressions = renderMarkdownExpressions(markdown, {
            fm: page.fm,
            dates: gates.index.dateContext,
            sqlResults: sqlTables?.inline?.get(page.file),
            file: page.file,
            bodyLine: page.bodyLine,
        });
        findings.push(...expressions.findings);
        const resolvedBody = protectCode(expressions.markdown, (text) =>
            resolveWebWikilinks(pass.beforeLinks ? pass.beforeLinks(text, page) : text, linkCtx),
        );
        for (const err of wikiErrors) {
            findings.push({
                file: page.file,
                severity: "warning",
                // A link finding names a `reason` from the shared table and no
                // sentence of its own; an embed's directive complaint carries
                // the sentence instead.
                message: err.message ?? (err.reason ? linkFindingMessage(err) : String(err)),
            });
        }
        const secrets = renderSecretBlocks(resolvedBody, "book");
        for (const error of renderSecretBlocks(page.body, "book").errors) {
            findings.push({
                file: page.file,
                line: (page.bodyLine ?? 1) + error.line - 1,
                column: error.column,
                severity: "error",
                message: error.message,
            });
        }
        stageImages(secrets.markdown, page.file, columns);
        const prose = markdownToTypst(secrets.markdown, {
            md,
            links: plan.links,
            glyphs,
            images,
            headingOffset,
            anchorPrefix,
            captions: numberedCaptions,
        });
        // The infobox is generated content in document order — prepended,
        // before the prose. An image the note authored ahead of it still comes
        // first, because the image lives in the body and the body follows.
        const boxes = noteInfoboxes(page.fm, {
            resolve: (ref, hint) => resolveInfoboxRef(gates.index, ref, hint),
            router: routerFor(resolved),
            dates: gates.index.dateContext,
        });
        const panel = infoboxesToTypst(boxes, {
            link: (value) => linkToTypst(value, plan.links, labelFor),
        });
        // Whether the entry is settled comes before anything it says: the
        // notice leads the leaf, ahead of the panel, which is the position it
        // holds on every other surface.
        const notice = isDraftNote(page.fm) ? draftNoticeTypst() : "";
        const parts = [notice, panel, prose].filter((part) => part);
        return parts.join("\n\n");
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
            bodies.set(
                entry.anchor,
                renderPage(page, entry.depth, entry.anchor, entry.presentation?.page?.columns ?? 2),
            );
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
            stageImages(text, file, entry.presentation?.page?.columns ?? 2);
            bodies.set(
                entry.anchor,
                markdownToTypst(text, {
                    md,
                    links: plan.links,
                    glyphs,
                    images,
                    headingOffset: entry.depth,
                    anchorPrefix: entry.anchor,
                    captions: numberCaptions(scanCaptions(text).captions, captionCounts),
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
            const text = fs.readFileSync(file, "utf8");
            stageImages(text, file, 1);
            return markdownToTypst(text, {
                md,
                links: plan.links,
                glyphs,
                images,
                captions: frontCaptions.get(file),
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

    const banners = stageBanners(plan.entries, resolved, outDir, findings);
    for (const [declared, to] of banners) {
        const from = path.resolve(resolved.rootDir, declared);
        imageCandidates.set(`banner:${declared}`, {
            from,
            to,
            relative: path.relative(resolved.rootDir, from),
            file: resolved.pdf.document,
            uses: [{ width: PDF_PAGE.width, height: Infinity }],
        });
    }

    /** @type {Map<string, Array<{path: string, title: string}>>} Entry anchor → map pages. */
    const maps = new Map();
    const addMapPage = (anchor, page) => {
        if (!maps.has(anchor)) maps.set(anchor, []);
        maps.get(anchor).push(page);
    };
    const stageMapBackground = (entry, value, title) => {
        const file = noteFile(contentBase, entry.record);
        const found = artPathname(assets, value, "image", ["image", "icon"]);
        const staged = stagedImagePath(found.pathname ?? value, resolved);
        if (!staged || !fs.existsSync(staged.from)) {
            findings.push({
                file,
                severity: "warning",
                message: `the map background "${value}" cannot be resolved for the book`,
            });
            return;
        }
        const target = path.join(outDir, staged.to);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(staged.from, target);
        addMapPage(entry.anchor, { path: staged.to, title });
        const candidate = imageCandidates.get(staged.to);
        const use = {
            width: PDF_PAGE.height - 2 * PDF_PAGE.margin,
            height: pdfTextWidth - 2 / 2.54,
        };
        if (candidate) candidate.uses.push(use);
        else
            imageCandidates.set(staged.to, {
                ...staged,
                relative: path.relative(resolved.rootDir, staged.from),
                file,
                uses: [use],
            });
    };
    const world = mapWorld({
        records,
        foreignIndex: gates.foreign.index,
        contentBase,
        config: resolved,
    });
    const related = new Set(relatedPlaces(world.places));
    const mapDir = path.join(outDir, "maps");
    fs.rmSync(mapDir, { recursive: true, force: true });
    const mappedEntries = plan.entries.filter(
        (entry) =>
            entry.kind === "note" &&
            entry.record?.type === "place" &&
            related.has(String(entry.record.shortcode ?? "").toLowerCase()),
    );
    if (mappedEntries.length) {
        const centres = [...new Set(mappedEntries.map((entry) => entry.record.shortcode))];
        const drawn = buildMaps({ world, outDir: mapDir, from: centres });
        findings.push(...drawn.findings);
        for (const entry of mappedEntries) {
            addMapPage(entry.anchor, {
                path: `maps/from-${entry.record.shortcode}.svg`,
                title: `From here: ${entry.record.name?.full ?? entry.record.shortcode}`,
            });
        }
    }
    for (const entry of plan.entries) {
        if (entry.kind !== "note" || entry.record?.type !== "map") continue;
        const title = entry.record.name?.full ?? entry.record.shortcode;
        if (["regionalmap", "totm"].includes(entry.record.subType)) {
            if (entry.record.data?.bgImage) {
                stageMapBackground(entry, entry.record.data.bgImage, title);
            }
            continue;
        }
        if (!["battlemap", "localmap"].includes(entry.record.subType)) continue;
        for (const [index, level] of (entry.record.data?.scene?.levels ?? []).entries()) {
            const paths = [
                `.levels[${index}].background.src`,
                ...(level._id ? [`.levels[${level._id}].background.src`] : []),
            ];
            const fixup = (entry.record.data?.fixup ?? []).find((item) =>
                paths.includes(item.path),
            );
            const value = fixup?.value ?? level.background?.src;
            if (value)
                stageMapBackground(entry, value, level.name ? `${title}: ${level.name}` : title);
        }
    }

    const assembled = renderBook({
        plan,
        bodies,
        title: resolved.pdf.title,
        subtitle: resolved.pdf.subtitle,
        front,
        fonts: resolved.pdf.fonts,
        version,
        preamble: infoboxTypstPreamble(),
        banners,
        maps,
    });
    // Last, over the whole document: a reference can only be checked once every
    // declaration is in one string, and Typst treats a dangling one as fatal.
    const source = resolveDanglingLabels(assembled, findings);

    const stem = pdfFileName(resolved.foundryPackage?.id ?? resolved.contentPackage, version);
    const typPath = path.join(outDir, stem.replace(/\.pdf$/, ".typ"));
    const pdfPath = path.join(outDir, stem);
    fs.writeFileSync(typPath, source);

    const imageReports = await resamplePdfImages(imageCandidates, outDir);

    const stats = { ...plan.stats, entries: plan.entries.length, bytes: source.length };
    if (!compile) {
        return {
            built: true,
            reason: null,
            findings,
            imageReports,
            typ: typPath,
            pdf: null,
            stats,
        };
    }

    const compiled = compileTypst(typPath, pdfPath, resolved.pdf);
    findings.push(...compiled.findings);
    if (!compiled.ok) {
        findings.push({ file: typPath, severity: "error", message: compiled.message });
        return {
            built: false,
            reason: null,
            findings,
            imageReports,
            typ: typPath,
            pdf: null,
            stats,
        };
    }
    return { built: true, reason: null, findings, imageReports, typ: typPath, pdf: pdfPath, stats };
}

/**
 * The faces the book is set in that the compiler does not carry itself.
 *
 * Resolved from this module rather than from the working directory, on the same
 * rule the specification and `--version` follow: a consumer runs the build
 * inside its own repository, and the faces it sets the book in are the ones
 * that came with the toolchain version it resolved.
 *
 * What is here is the **sans**, in the three styles a heading can ask for, the
 * superfamily's **mono** for a package that names it, and the licence they
 * travel under. The serif is not: the compiler embeds one, and a second copy of
 * a face it already carries is a file nothing selects.
 *
 * It is **not** an addressable asset root: the compiler matches a face by
 * family name, so nothing addresses these files and nothing needs to.
 *
 * @type {string}
 */
export const BOOK_FONTS_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "fonts",
);

/**
 * The command line the compile runs, as data.
 *
 * Separate from running it so the flags that decide which faces are in play
 * can be asserted without a compiler installed — which is the half of the
 * invocation that changes what the book looks like.
 *
 * @param {string} typPath - The `.typ` file.
 * @param {string} pdfPath - Where the PDF goes.
 * @param {object} [pdf] - The resolved `pdf:` block.
 * @returns {string[]} The arguments, in order.
 */
export function typstArgs(typPath, pdfPath, pdf = {}) {
    // One flag, the paths joined by the platform's separator: the compiler
    // takes a list, and the shipped faces come first so a consumer's own
    // directory extends the set rather than standing in for it.
    const fontPaths = [BOOK_FONTS_PATH];
    if (pdf.fonts?.path) fontPaths.push(pdf.fonts.path);
    return [
        "compile",
        "--ignore-system-fonts",
        "--font-path",
        fontPaths.join(path.delimiter),
        typPath,
        pdfPath,
    ];
}

/**
 * The compiler's own warnings, as findings.
 *
 * A compile that says `unknown font family` still exits 0 and still writes a
 * book — one set in whatever face the fallback reached. That is the failure
 * this surface is least able to see, so the compiler's warnings are read back
 * and reported on the same terms as everything else the build finds.
 *
 * Typst writes a warning as a `warning:` line followed by a `┌─ file:line:col`
 * locator over a source excerpt. The message and the position are taken; the
 * excerpt is not, since the reader has the file.
 *
 * @param {string} output - What the compiler wrote to stderr.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: string, message: string}>} One finding per warning.
 */
export function typstWarnings(output) {
    const lines = String(output || "").split("\n");
    const findings = [];
    for (let i = 0; i < lines.length; i += 1) {
        const warned = /^warning: (.+)$/.exec(lines[i]);
        if (!warned) continue;
        const finding = { file: "", severity: "warning", message: warned[1].trim() };
        const at = /^\s*┌─ (.+):(\d+):(\d+)\s*$/.exec(lines[i + 1] ?? "");
        if (at) {
            // The compiler writes the path relative to its own working
            // directory, which is this process's, so resolving it there is what
            // recovers the file a reader can open.
            finding.file = path.resolve(at[1]);
            finding.line = Number(at[2]);
            finding.column = Number(at[3]);
        }
        findings.push(finding);
    }
    return findings;
}

/**
 * Run Typst over the emitted source.
 *
 * @param {string} typPath - The `.typ` file.
 * @param {string} pdfPath - Where the PDF goes.
 * @param {object} pdf - The resolved `pdf:` block.
 * @returns {{ok: boolean, message: string, findings: object[]}} What happened,
 *   and what the compiler warned about on the way.
 */
export function compileTypst(typPath, pdfPath, pdf = {}) {
    const binary = pdf.binary || "typst";
    const args = typstArgs(typPath, pdfPath, pdf);
    let result;
    try {
        result = spawnSync(binary, args, { encoding: "utf8" });
    } catch (err) {
        return { ok: false, message: `could not run \`${binary}\`: ${err.message}`, findings: [] };
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
            findings: [],
        };
    }
    if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || "")
            .trim()
            .split("\n")[0];
        return {
            ok: false,
            message: `\`${binary} compile\` failed: ${detail}`,
            findings: [],
        };
    }
    return { ok: true, message: "", findings: typstWarnings(result.stderr) };
}
