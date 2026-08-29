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
 * `BasePackCompiler` — the one compile loop every pack pass runs.
 *
 * Walking the content tree, rejecting what this build does not own, expanding
 * generated tables, converting wikilinks, writing the JSON and counting what
 * failed are the same in every pass. They were written out
 * once per pass — three times when this was filed, five by the time it landed —
 * so a fix to any of them had to be made everywhere, and the passes drifted
 * apart in exactly the places nobody was comparing (#1509).
 *
 * A pass now states only what makes it that pass:
 *
 * | Hook | What it decides |
 * | ---- | --------------- |
 * | {@link BasePackCompiler#selects} | Which notes this pack claims. **Required.** |
 * | {@link BasePackCompiler#buildEntry} | One note → one document. **Required.** |
 * | {@link BasePackCompiler#prepare} | Anything the walk needs first (an index, a prior pack's output). |
 * | {@link BasePackCompiler#skipNote} | A further rejection the type filter cannot express. |
 * | {@link BasePackCompiler#compileNote} | A note that emits *more* than its own document. |
 * | {@link BasePackCompiler#onCompiled} | Per-note tallies for the summary. |
 * | {@link BasePackCompiler#finish} | Work that needs every note first. |
 * | {@link BasePackCompiler#reportCompiled} / {@link BasePackCompiler#reportDetail} | The pass's own log lines. |
 *
 * plus three static switches — `requiresId` (a note with no id is fatal, or
 * merely skipped), `convertsWikilinks` (whether the body reaching
 * `buildEntry` is converted or exactly as authored) and `readsPackOutputOf`
 * (the document types whose compiled output this pass reads, which is what the
 * generator derives the compile order from).
 *
 * `selects` answers *which document type* a pass claims, and it is the same
 * answer for every pack of that type. Which **pack of that type** a claimed
 * note lands in is a second question, answered by the pack router from the
 * note's own `pack:` declaration (#1566) — so a subclass never has to know that
 * its type ships in more than one pack.
 *
 * **This is the extension point.** The pack list is data
 * (`package-build.config.yaml`) and each entry names a document type; a consumer
 * adding a document type this toolchain does not ship writes a subclass of this
 * and registers it, rather than copying a pass and editing it. The contract the
 * generator relies on stays small: construct, `await compile()`, read
 * `errorCount` and `compiledCount`.
 *
 * **This class knows nothing about any game system.** Which types a pack claims
 * arrives through `selects`, so the type membership stays in the one place that
 * owns it — for the doc-carrying types, the single `docEntryTypes` set in
 * `item-docs.mjs` that the compilers and the link manifest both read.
 *
 * @module
 */

import fs from "fs";
import path from "path";
import log from "loglevel";

import {
    walkMarkdownTree,
    makeFilename,
    resolveName,
    buildContentLinkIndex,
    convertNoteWikilinks,
    collectContentDocs,
    expandNoteTables,
} from "./helpers.mjs";
import { emitDiagnostic } from "./diagnostics.mjs";
import { assertNoDeclaredPackage } from "./note-package.mjs";
import { assertNoDraftField } from "./retired-fields.mjs";
import { assertTypeNotRetired, packForType } from "./ids.mjs";

/**
 * The tallies one pass accumulates while walking the tree.
 *
 * `declined` and `skippedOther` are deliberately separate numbers. A declined
 * note is one this build **refused** — it declares a retired frontmatter field
 * — and it is an error; a skipped one legitimately belongs to another pass, and
 * there are thousands of those. Folding the first into the second is what let a
 * whole tree be filtered out in silence (#56).
 *
 * @typedef {object} PassStats
 * @property {number} compiled - Notes that became a document.
 * @property {number} skippedNoId - Notes with no `id`, where that is tolerated.
 * @property {number} skippedOther - Notes this pass does not claim.
 * @property {number} declined - Notes refused because they declare a retired
 *   frontmatter field. Counted as errors, never as skips.
 */

/**
 * The shared walk → filter → expand → convert → build → write → count loop.
 *
 * Subclass it, implement {@link BasePackCompiler#selects} and
 * {@link BasePackCompiler#buildEntry}, and override the hooks the pass needs.
 */
export class BasePackCompiler {
    /**
     * The pack this pass writes. Subclasses state their own.
     *
     * @type {string}
     */
    static id = "";

    /**
     * The singular noun this pass calls one of its notes, in log messages —
     * "item", "journal", "actor", "macro", "map". Capitalized for the
     * missing-id error.
     *
     * @type {string}
     */
    static label = "entry";

    /**
     * Whether a claimed note with no `id` fails the build.
     *
     * True everywhere but the journals pass: a skipped document silently
     * vanishes from the compendium while its knowledgebase page still builds,
     * so the omission is invisible until someone looks for it.
     *
     * @type {boolean}
     */
    static requiresId = true;

    /**
     * Whether the body handed to {@link BasePackCompiler#buildEntry} has had
     * its generated tables expanded and its wikilinks converted.
     *
     * False for a pass whose output must be exactly what the author typed —
     * the macros pass, whose `command` is executable source (#1514). A pass
     * that says so also skips building the content-wide link index it would
     * never read.
     *
     * @type {boolean}
     */
    static convertsWikilinks = true;

    /**
     * The document types whose **compiled output** this pass reads.
     *
     * Empty for every pass that reads only the content tree. The actors pass
     * is the exception: a being names its embedded items by
     * `(type, shortcode)`, and it resolves them against the JSON the item
     * passes wrote — so an Actor pass must run after every Item pass, and it
     * says so here.
     *
     * The generator derives the compile order from this (#73), so the order
     * `packs:` declares is presentation only — it is the manifest's `packs`
     * array as well, and a consumer orders that for a reader. A pass that
     * reads another's output states the dependency once, in the class that
     * does the reading, instead of every consuming repository having to know
     * it when writing its pack list.
     *
     * A consumer registering a compiler of its own declares its dependencies
     * the same way; a type no pack declares is simply not waited for.
     *
     * @type {readonly string[]}
     */
    static readsPackOutputOf = Object.freeze([]);

    /** @type {string} */
    contentBase;
    /** @type {string} */
    outputDir;
    /** @type {(path: string|null) => string|null} */
    folderResolver;
    /** @type {number} */
    errorCount = 0;

    /**
     * The pack this pass writes, and the Foundry document type it holds.
     *
     * Supplied by the generator from the configured pack list. Left undefined
     * by a caller constructing a compiler directly (the unit suite), which
     * turns routing off: with one pack there is nothing to route between.
     *
     * @type {string|undefined}
     */
    packName;
    /** @type {string|undefined} */
    docType;
    /** @type {{resolve: Function}|undefined} */
    router;

    /**
     * Whether this pass reports a note of its document type that routes
     * nowhere.
     *
     * Every pack of a type claims the same notes, so all of them would report
     * the same unroutable note. The **first configured pack of the type** owns
     * the message, and the rest stay quiet — one error, named once, and the
     * build still fails.
     *
     * @type {boolean}
     */
    routingReporter = false;

    /**
     * Entries this pass wrote to its own pack. Zero from a non-empty content
     * tree is a build failure, not a quiet no-op — see `generate.mjs`.
     *
     * @type {number}
     */
    compiledCount = 0;

    /**
     * Wikilinks left as literal text because nothing in the tree (or in a
     * vendored manifest) publishes their target.
     *
     * @type {number}
     */
    unresolvedLinks = 0;

    /**
     * @param {object} options
     * @param {string} options.contentBase - Root of the content tree.
     * @param {string} options.dest - Where this pass writes its JSON.
     * @param {(path: string|null) => string|null} [options.folderResolver] -
     *   Resolves a `sohl.folder` id against this pack's folder hierarchy.
     * @param {string} [options.packName] - The pack this pass writes.
     * @param {string} [options.docType] - The Foundry document type it holds.
     * @param {{resolve: Function}} [options.router] - The pack router. Omit it
     *   — as the unit suite does — and every claimed note is compiled here.
     * @param {boolean} [options.routingReporter] - Whether this pass reports a
     *   note of its type that routes nowhere.
     */
    constructor({
        contentBase,
        dest,
        folderResolver = () => null,
        packName,
        docType,
        router,
        routingReporter = false,
    } = {}) {
        if (!contentBase) {
            throw new Error(
                `${this.constructor.name} compiler requires \`contentBase\``,
            );
        }
        if (!fs.existsSync(contentBase)) {
            throw new Error(`Content tree not found at ${contentBase}`);
        }
        Object.defineProperty(this, "contentBase", {
            value: contentBase,
            writable: false,
        });
        Object.defineProperty(this, "outputDir", {
            value: dest,
            writable: false,
        });
        Object.defineProperty(this, "folderResolver", {
            value: folderResolver,
            writable: false,
        });
        this.packName = packName;
        this.docType = docType;
        this.router = router;
        this.routingReporter = routingReporter;
    }

    /**
     * Whether this pass's pack is the one a claimed note belongs in.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True to compile it here.
     * @throws {import("./pack-router.mjs").PackRoutingError} When the note
     *   routes to no pack at all — a build failure, never a silent drop.
     */
    routesHere(fm) {
        if (!this.router || !this.packName || !this.docType) return true;
        return this.router.resolve(fm, this.docType) === this.packName;
    }

    /**
     * Whether this pass claims a note. **Required.**
     *
     * Called only for a note this build compiles — every note in the tree
     * belongs to the configured content package (#56) — so a subclass decides
     * on `type` alone.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True to compile it.
     */
    // eslint-disable-next-line no-unused-vars
    selects(fm) {
        throw new Error(
            `${this.constructor.name} must implement selects(fm) — which notes this pack claims`,
        );
    }

    /**
     * A further rejection the type filter cannot express, applied after the
     * id check. The journals pass uses it to skip a doc-carrying note with no
     * prose: there is no documentation to compile, and the document's own pass
     * leaves its pointer empty to match.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} body - The note body, as authored.
     * @returns {boolean} True to skip the note.
     */
    // eslint-disable-next-line no-unused-vars
    skipNote(fm, body) {
        return false;
    }

    /**
     * What one note is called in this pass's log lines. The items pass names
     * the item's type, which is more use than "item".
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {string} The label.
     */
    // eslint-disable-next-line no-unused-vars
    noteLabel(fm) {
        return this.constructor.label;
    }

    /**
     * Everything the walk needs before it starts: the content-wide link index
     * and table-search corpus here, plus whatever a subclass adds (a prior
     * pack's output, an index of cross-references).
     *
     * @returns {Promise<void>}
     */
    async prepare() {
        if (this.constructor.convertsWikilinks) {
            this.linkIndex = buildContentLinkIndex(
                this.contentBase,
                this.router,
            );
            this.contentDocs = collectContentDocs(this.contentBase);
        }
        this.unresolvedLinks = 0;
    }

    /**
     * The body {@link BasePackCompiler#buildEntry} receives.
     *
     * Generated tables expand before wikilinks are converted, so a cell a
     * table emits is resolved along with the authored links.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} body - The note body, as authored.
     * @returns {string} The converted markdown, or `body` itself for a pass
     *   that does not convert.
     */
    convertBody(fm, body) {
        if (!this.constructor.convertsWikilinks) return body;
        const name = resolveName(fm);
        const { absPath, bodyLine, bodyColumn } = this.currentNote ?? {};
        const { markdown: tabulated, lineMap } = expandNoteTables(body, {
            docs: this.contentDocs,
            name,
            fm,
            bodyLine,
        });
        const { markdown, unresolved } = convertNoteWikilinks(tabulated, {
            type: fm.type,
            id: fm.id,
            // Where this note is, so a link that resolves nowhere is reported
            // at a position an author can open rather than by note name (#17).
            file: absPath,
            bodyLine,
            bodyColumn,
            lineMap,
            // A `[[#slug]]` self-link addresses the source note, which has no
            // entry in the index — so where its own documents landed has to
            // travel with it (#1566).
            pack: this.router?.resolveOrNull(fm, packForType(fm.type).docType),
            docPack: this.router?.resolveOrNull(fm, "JournalEntry"),
            index: this.linkIndex,
            name,
        });
        this.unresolvedLinks += unresolved.length;
        return markdown;
    }

    /**
     * Reports a warning about the note being compiled.
     *
     * The file comes from the walk, so no caller has to carry it; a `position`
     * is used when the caller could establish one and omitted otherwise —
     * naming the file alone beats naming a line that is not the problem.
     *
     * @param {string} message - What is wrong, in one sentence.
     * @param {{line?: number, column?: number}} [position] - Where, if known.
     * @returns {void}
     */
    noteWarn(message, position) {
        emitDiagnostic({
            file: this.currentNote?.absPath,
            line: position?.line,
            column: position?.column,
            severity: "warning",
            message,
        });
    }

    /**
     * Reports an error about the note being compiled.
     *
     * @param {string} message - What is wrong, in one sentence.
     * @param {{line?: number, column?: number}} [position] - Where, if known.
     * @returns {void}
     */
    noteError(message, position) {
        emitDiagnostic({
            file: this.currentNote?.absPath,
            line: position?.line,
            column: position?.column,
            severity: "error",
            message,
        });
    }

    /**
     * One note → one document. **Required.**
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, from
     *   {@link BasePackCompiler#convertBody}.
     * @returns {object} The document, keyed for the pack.
     */
    // eslint-disable-next-line no-unused-vars
    buildEntry(fm, markdown) {
        throw new Error(
            `${this.constructor.name} must implement buildEntry(fm, markdown)`,
        );
    }

    /**
     * Write one document into a directory, named for its name and id.
     *
     * @param {string} dir - The destination directory.
     * @param {object} doc - The document.
     */
    writeTo(dir, doc) {
        fs.writeFileSync(
            path.join(dir, makeFilename(doc.name, doc._id)),
            JSON.stringify(doc, null, 2),
            "utf8",
        );
    }

    /**
     * Write one document into this pass's own pack.
     *
     * @param {object} doc - The document.
     */
    writeEntry(doc) {
        this.writeTo(this.outputDir, doc);
    }

    /**
     * Compile one claimed note. The default builds its document and writes it;
     * a pass whose note emits more than that (the scenes pass, which also
     * bundles an Adventure) overrides this.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, from
     *   {@link BasePackCompiler#convertBody}.
     * @returns {object} The document written to this pass's own pack.
     */
    compileNote(fm, markdown) {
        const doc = this.buildEntry(fm, markdown);
        this.writeEntry(doc);
        return doc;
    }

    /**
     * A note compiled successfully — where a pass keeps its own tallies.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {object} doc - The document just written.
     */
    // eslint-disable-next-line no-unused-vars
    onCompiled(fm, doc) {}

    /**
     * Work that needs every note compiled first, before the summary is logged.
     *
     * @param {PassStats} stats - The pass's tallies.
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async finish(stats) {}

    /**
     * The pass's headline count.
     *
     * @param {PassStats} stats - The pass's tallies.
     */
    reportCompiled(stats) {
        const label = this.constructor.label;
        log.info(
            `Compiled ${stats.compiled} ${label}${stats.compiled === 1 ? "" : "s"}`,
        );
    }

    /**
     * The pass's own trailing detail line, which names what it rejected in the
     * terms that pass uses.
     *
     * @param {PassStats} stats - The pass's tallies.
     */
    reportDetail(stats) {
        log.debug(
            `Skipped ${stats.skippedOther} file(s) this pack does not claim`,
        );
    }

    /**
     * Log what the pass did.
     *
     * @param {PassStats} stats - The pass's tallies.
     */
    report(stats) {
        this.reportCompiled(stats);
        if (this.unresolvedLinks) {
            log.info(
                `${this.unresolvedLinks} wikilink(s) left as literal text (no target in the content tree)`,
            );
        }
        if (stats.skippedNoId) {
            log.info(`Skipped ${stats.skippedNoId} note(s) missing id`);
        }
        if (stats.declined) {
            // Its own line, at error level: these are not skips, and burying
            // them in the skipped tally is the defect (#56). Each one has
            // already been named individually as a diagnostic.
            log.error(
                `Declined ${stats.declined} note(s) declaring a retired ` +
                    `frontmatter field`,
            );
        }
        this.reportDetail(stats);
    }

    /**
     * Walk the content tree and compile every note this pass claims.
     *
     * @returns {Promise<void>}
     */
    async compile() {
        /** @type {PassStats} */
        const stats = {
            compiled: 0,
            skippedNoId: 0,
            skippedOther: 0,
            declined: 0,
        };
        await this.prepare();

        const label = this.constructor.label;
        const Label = label.charAt(0).toUpperCase() + label.slice(1);

        for (const {
            frontmatter: fm,
            body,
            absPath,
            bodyLine,
            bodyColumn,
        } of walkMarkdownTree(this.contentBase)) {
            // Which note this pass is on, so anything it calls can report a
            // position without every method having to be handed one (#17).
            this.currentNote = { absPath, bodyLine, bodyColumn };
            // A file carrying no frontmatter at all is not a note.
            if (!fm) {
                stats.skippedOther++;
                continue;
            }
            // The retired frontmatter fields, refused before `selects` so a
            // note is answered whichever pass would have claimed it — and
            // whatever the declared value says.
            //
            // - `package:` (#56): a note's package is the repository's
            //   configured one, so declaring it restates a constant.
            // - `draft:` (#69): it excluded the note from the packs, the
            //   manifest and the site, and no checker reported the links that
            //   left dangling.
            //
            // Both are reported and counted — never skipped, which is how a
            // tree naming a package nothing answers to used to compile zero
            // notes and exit 0. The file comes from the diagnostic locator, so
            // neither message may repeat it.
            try {
                assertNoDeclaredPackage(fm, { absPath });
                assertNoDraftField(fm, { absPath });
            } catch (err) {
                stats.declined++;
                this.errorCount++;
                this.noteError(err.message, err.position);
                continue;
            }
            // Checked before `selects`, and therefore for every note this
            // package owns rather than only the ones some pass claims. A
            // retired type is claimed by no pass, so the alternative is not a
            // wrong document — it is no document, skipped as quietly as the
            // thousands of notes that legitimately belong to another pass.
            assertTypeNotRetired(fm.type, absPath);
            if (!this.selects(fm)) {
                stats.skippedOther++;
                continue;
            }
            if (!fm.id) {
                if (this.constructor.requiresId) {
                    throw new Error(`${Label} missing id: ${absPath}`);
                }
                stats.skippedNoId++;
                this.noteWarn(`${label} note has no id, skipping`);
                continue;
            }
            // Which pack of this type takes it. Applied after the id check —
            // a note with no id is nobody's document, so its routing is
            // nobody's business — and before `skipNote`, so a note this pack
            // does not own never reaches this pass's own rejection rules.
            try {
                if (!this.routesHere(fm)) {
                    stats.skippedOther++;
                    continue;
                }
            } catch (err) {
                if (this.routingReporter) {
                    this.errorCount++;
                    this.noteError(err.message, err.position);
                }
                continue;
            }
            if (this.skipNote(fm, body)) {
                stats.skippedOther++;
                continue;
            }

            log.debug(
                `Processing ${this.noteLabel(fm)}: ${resolveName(fm)} (${absPath})`,
            );
            try {
                const doc = this.compileNote(fm, this.convertBody(fm, body));
                stats.compiled++;
                this.onCompiled(fm, doc);
            } catch (err) {
                this.errorCount++;
                // `position` is set by whatever failed if it knew where — an
                // unresolved address, a bad table directive — so the report
                // points at the line rather than at the note (#17).
                this.noteError(
                    `${this.noteLabel(fm)} failed to compile: ${err.message}`,
                    err.position,
                );
            }
        }

        this.compiledCount = stats.compiled;
        await this.finish(stats);
        this.report(stats);
    }
}
