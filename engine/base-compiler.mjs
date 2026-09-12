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
 * apart in exactly the places nobody was comparing.
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
 * note's own `pack:` declaration — so a subclass never has to know that
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
    parseMarkdownFile,
    makeFilename,
    resolveName,
    convertNoteWikilinks,
    expandNoteTables,
    statsForPack,
} from "./helpers.mjs";
// The record accessors only — see `engine/index-records.mjs` for why they live
// apart from the index that builds them.
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { emitDiagnostic } from "./diagnostics.mjs";
import { assertNoDeclaredPackage } from "./note-package.mjs";
import { assertNoDeclaredFolder } from "./folder-notes.mjs";
import {
    assertNoAliasesField,
    assertNoDraftField,
    assertNoSectionField,
    assertNoTraitsField,
} from "./retired-fields.mjs";
import { assertTypeNotRetired, packForType } from "./ids.mjs";
import { resolveNoteId } from "./note-ids.mjs";
import { carriesSystemBlock } from "./system-block.mjs";
import { checkAuthoredSystemData, checkEmittedSystemData } from "./schema-check.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";

/**
 * The tallies one pass accumulates while walking the tree.
 *
 * `declined` and `skippedOther` are deliberately separate numbers. A declined
 * note is one this build **refused** — it declares a retired frontmatter field
 * — and it is an error; a skipped one legitimately belongs to another pass, and
 * there are thousands of those. Folding the first into the second is what let a
 * whole tree be filtered out in silence.
 *
 * @typedef {object} PassStats
 * @property {number} compiled - Notes that became a document.
 * @property {number} skippedNoId - Notes with no `id`, where that is tolerated.
 * @property {number} skippedOther - Notes this pass does not claim.
 * @property {number} declined - Notes this pack **refused** — one declaring a
 *   retired frontmatter field, or one routed to a system pack whose system it
 *   says nothing about. Counted as errors, never as skips.
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
     * the macros pass, whose `command` is executable source. A pass
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
     * The generator derives the compile order from this, so the order
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

    /**
     * Whether this pass's document **is** a system's data, and therefore takes
     * only notes that carry that system's block.
     *
     * A pack may declare a `system:` — `harn-ensemble` ships an `actors-hm3`
     * and an `actors-sohl` from one tree — and the note-side half of that is
     * the block named after the system. A note carrying no such block has
     * nothing to say about it, so compiling it there would emit a **hollow
     * document**: a subtype, and none of the fields the subtype exists for.
     *
     * False by default, because most passes write documents that are not
     * system data at all. A JournalEntry of prose is the same document under
     * either system, and a journals pack that declared one must not turn every
     * doc note in the tree into a finding. The Item and Actor passes say so;
     * anything else that genuinely writes a system's data says so too.
     *
     * @type {boolean}
     */
    static requiresSystemBlock = false;

    /**
     * The **art fields** this pass reads off a note and writes onto its
     * document — `img`, `portrait`, whichever of them reaches the output.
     *
     * Empty by default, and every shipped pass states its own, for the reason
     * {@link BasePackCompiler.readsPackOutputOf} does: the fact belongs to the
     * class that does the writing, and a second list of it somewhere else is a
     * list free to disagree with what is actually emitted.
     *
     * The reader is the frontmatter lint. `img` is a *shared top-level* field —
     * legal on every note whatever its type, because
     * `BLOCK_DOCUMENT_PROPERTIES` maps it onto `document.img` — so a note whose
     * document has no such property authors it, validates, compiles, and loses
     * the value with nothing said: `Parrot` in `sohl-thalorna`
     * had declared `img:` since long before the art rule existed and compiled
     * `img: null` exactly as a note declaring nothing does. Naming the fields
     * here is what lets the lint tell an inert key from a live one.
     *
     * A pass that emits art **anywhere** in its document declares it, not only
     * one that writes a top-level `img`: the scenes pass puts the path on the
     * scene's background rather than on a property called `img`, and the value
     * is no less live for it. The question this answers is whether the authored
     * path reaches the output at all.
     *
     * @type {readonly string[]}
     */
    static emitsArt = Object.freeze([]);

    /** @type {string} */
    contentBase;
    /** @type {string} */
    outputDir;
    /** @type {(path: string|null) => string|null} */
    folderResolver;
    /** @type {number} */
    errorCount = 0;

    /**
     * Emitted-`system` findings, one per `documentType|subtype|field`.
     *
     * A key the compiler writes is on **every** document of a subtype, so
     * reporting it where it is found would print the same sentence 3,126 times
     * and bury the one that is not systemic. Collected here instead and flushed
     * once at the end of the pass, keyed so the class of defect is reported
     * once and the first document carrying it names a file a reader can open.
     *
     * @type {Map<string, {message: string, file: string|undefined}>}
     */
    emittedFindings = new Map();

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
     * @param {readonly string[]} options.skipDirectories - Directories the walk
     *   never descends into. Required: see {@link assertStatedScope}.
     * @param {(address: string|null) => string|null} [options.folderResolver] -
     *   Resolves a `packFolder` — a folder note's address — to the Foundry
     *   folder id it materialises as in this pack.
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
        skipDirectories,
        folderResolver = () => null,
        packName,
        packSystem = null,
        docType,
        router,
        routingReporter = false,
        corpus,
    } = {}) {
        if (!contentBase) {
            throw new Error(`${this.constructor.name} compiler requires \`contentBase\``);
        }
        if (!fs.existsSync(contentBase)) {
            throw new Error(`Content tree not found at ${contentBase}`);
        }
        if (skipDirectories === undefined) {
            throw new Error(
                `${this.constructor.name} compiler requires \`skipDirectories\`: ` +
                    `the walk's scope is stated by whoever builds the pass, not ` +
                    `resolved from the working directory`,
            );
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
        // The walk's scope, stated by whoever built this pass rather than
        // resolved from the working directory. Every walk this compiler
        // makes — its own, the table corpus, the link index, the SQL tables —
        // uses this one answer.
        Object.defineProperty(this, "skipDirectories", {
            value: skipDirectories,
            writable: false,
        });
        this.packName = packName;
        this.packSystem = packSystem;
        this.docType = docType;
        this.router = router;
        this.routingReporter = routingReporter;
        // The corpus this compile is running over, derived once by
        // `generatePacksJson` and shared by every pass. A pass that is
        // handed none derives its own in `prepare`, which is what a consumer
        // constructing one compiler directly does.
        this.corpus = corpus;
    }

    /**
     * The `_stats` block every entry this pass emits is stamped with.
     *
     * Per pack rather than per package, because a module may ship the same
     * content for two systems — `harn-ensemble` has an `actors-hm3` pack and an
     * `actors-sohl` pack — and those documents were built against different
     * system versions. A single global block stamped both identically.
     *
     * Memoised on the instance: one pass, one pack, one system, so the block is
     * constant for the life of the compiler. The previous module-level memo
     * could not be, because it was shared across passes for different packs.
     *
     * @returns {object} The block, built once per compiler.
     */
    get stats() {
        this.#stats ??= statsForPack(this.packSystem);
        return this.#stats;
    }

    /** @type {object|undefined} */
    #stats;

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
        return (
            this.router.resolve(fm, this.docType, this.packSystem ?? undefined) === this.packName
        );
    }

    /**
     * Whether a claimed, routed note may become this pack's document at all.
     *
     * The pack-eligibility gate, and it fails rather than skipping: a note that
     * routed *here* and carries nothing for this pack's system is an authoring
     * mistake with a hollow document at the end of it, not a note that belongs
     * to another pass. Skipping it quietly is how a whole tree compiles to
     * documents nobody can use.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True when the note may be compiled here; `false` when
     *   it belongs to another system's pass of the same document type, which is
     *   skipped as quietly as any other note this pack does not own.
     * @throws {Error} When this pack's system is absent from the note and no
     *   other configured system claims it. The error carries a `position` where
     *   the note's own file can be read.
     */
    eligibleFor(fm) {
        if (!this.constructor.requiresSystemBlock || !this.packSystem) return true;
        if (carriesSystemBlock(fm, this.packSystem)) return true;
        // Another system's pack of this document type will claim it. A
        // note carrying only `hm3:` routes here because this pack is the
        // *default* of its document type, and defaults are declared per type
        // rather than per system — but it is not an incomplete note, it is
        // another pass's. The single-system case is untouched: with no second
        // system declared there is nothing for this to find, and the error
        // below still fires.
        const claimant = (this.router?.systemsOfType?.(this.docType) ?? []).find(
            (system) => system !== this.packSystem && carriesSystemBlock(fm, system),
        );
        if (claimant) return false;
        const label = fm?.name?.full ?? fm?.shortcode ?? fm?.id ?? "this note";
        throw new Error(
            `${label} carries no \`${this.packSystem}:\` block, so it has no ` +
                `${this.packSystem} data to compile — but it routes to pack ` +
                `"${this.packName}", which declares \`system: ${this.packSystem}\`. ` +
                `Add the block, or route the note to a pack of another system.`,
        );
    }

    /**
     * A refusal only this pass can make, because its subject is the note's
     * **type**.
     *
     * The `assertNo*Field` family above it in the walk is type-agnostic by
     * construction: it runs before `selects`, so that a note declaring a
     * retired field is answered whichever pass would have claimed it. A rule
     * about what a *`trauma`* may write cannot live there — it needs the type's
     * field declaration, which only the pass that compiles the type can reach.
     *
     * So it is a hook, called once the note is known to be this pass's, and its
     * throw is counted and located exactly as the family's is: the note is
     * declined rather than skipped, and the build fails naming the line.
     *
     * The default refuses nothing, which is the honest position for a pass
     * whose documents have no schema to have opinions about.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {void}
     * @throws {Error} When the note authors something its type forbids. The
     *   error may carry a `position` for the diagnostic.
     */
    // eslint-disable-next-line no-unused-vars
    assertAuthorable(fm) {}

    /**
     * Whether this pass claims a note. **Required.**
     *
     * Called only for a note this build compiles — every note in the tree
     * belongs to the configured content package — so a subclass decides
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
        // The corpus, and the three whole-tree derivations built over it. Every
        // one of them is a pure function of (tree, scope, router), which do not
        // vary between the passes of a single compile — so `generatePacksJson`
        // derives them once and hands them to each pass.
        //
        // The measurement that motivated it: compiling `sohl` read every note
        // **20 times**, four per pass — this link index, the table corpus, the
        // `sql` scan, and the pass's own walk — across five passes.
        // Imported here rather than at module scope: deriving the corpus
        // reaches the pack router and the manifest emitter, which reach this
        // module, so a static import would close a cycle. `generate.mjs`
        // normally supplies the corpus and this path never runs.
        const { buildCompileCorpus } = await import("./compile-corpus.mjs");
        if (!this.corpus) {
            this.corpus = await buildCompileCorpus({
                contentBase: this.contentBase,
                skipDirectories: this.skipDirectories,
                router: this.router,
            });
            // Derived here, so reported here. A corpus handed in was derived by
            // `generatePacksJson`, which has already reported its problems
            // once — and reporting them again in each of five passes would say
            // the same thing six times.
            this.reportsCorpusProblems = true;
        }
        if (this.constructor.convertsWikilinks) {
            this.linkIndex = this.corpus.linkIndex;
            this.contentDocs = this.corpus.contentDocs;
            this.sqlTables = this.corpus.sqlTables;
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
            sqlTables: absPath ? this.sqlTables?.get(absPath) : undefined,
        });
        const { markdown, unresolved } = convertNoteWikilinks(tabulated, {
            type: fm.type,
            id: fm.id,
            // Where this note is, so a link that resolves nowhere is reported
            // at a position an author can open rather than by note name.
            file: absPath,
            bodyLine,
            bodyColumn,
            lineMap,
            // A `[[#slug]]` self-link addresses the source note, which has no
            // entry in the index — so where its own documents landed has to
            // travel with it.
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
     * Report every `<system>.system` key the receiving subtype does not declare.
     *
     * An **error**, not a warning: Foundry drops an unknown `system` key at
     * construction without a word, so the alternative is a document shipped
     * with a field the author wrote and nobody will ever see. Each finding is
     * located at the offending key where the file can be read, so it points at
     * a line rather than at a note.
     *
     * Silent where nothing can answer — no published schema, or a subtype the
     * artifact does not name. `content-build lint` says that out loud once for
     * the whole build rather than once per note.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} block - The system block to read.
     * @param {string} documentType - `Item`, `Actor`, …
     * @param {string} subType - The subtype this note compiles into.
     * @returns {number} How many findings were reported.
     */
    reportUndeclaredSystemData(fm, block, documentType, subType) {
        const absPath = this.currentNote?.absPath;
        // Whose schema, where a build has more than one system: this pack's.
        // `undefined` — a pack that declares no system — keeps the
        // package-wide answer this always used.
        const findings = checkAuthoredSystemData(fm, {
            block,
            documentType,
            subType,
            system: this.packSystem ?? undefined,
        });
        for (const finding of findings) {
            this.errorCount++;
            const leaf = finding.path.split(".").pop();
            this.noteError(finding.message, locateFrontmatterKey(absPath, leaf));
        }
        return findings.length;
    }

    /**
     * Record every `system` key the *compiled document* carries that the
     * receiving subtype does not declare.
     *
     * The sibling of {@link BasePackCompiler#reportUndeclaredSystemData}, and
     * the half that sees what no declaration states. A compiler writes keys of
     * its own alongside the declared fields — `shortcode`, `actionDefs`,
     * `notes`, `docHtml`, `templatePriority` — and neither the field-declaration check
     * nor the authored-`system` check can see them, so until this nothing
     * compared them at all. Foundry's discard is the same silent one either
     * way.
     *
     * Called with the block **after** the builder, the authored merge and any
     * conditional fields have all written into it, so what is checked is what
     * the pack file receives.
     *
     * Recorded rather than reported: see {@link BasePackCompiler#emittedFindings}
     * for why, and {@link BasePackCompiler#reportEmittedFindings} for where they
     * come out.
     *
     * @param {object} system - The `system` block just assembled.
     * @param {object} opts
     * @param {object} opts.fm - The note's frontmatter.
     * @param {string} opts.block - The system block the note writes.
     * @param {string} opts.documentType - `Item`, `Actor`, …
     * @param {string} opts.subType - The subtype this note compiles into.
     * @param {string} opts.type - The note's content type.
     * @param {readonly {to?: string}[]} [opts.fields] - The type's field
     *   declaration, which tells a builder emission from a compiler one.
     * @param {object} [opts.config] - The resolved build configuration.
     * @returns {number} How many findings were new to this pass.
     */
    reportEmittedSystemData(emitted, { fm, block, documentType, subType, type, fields, config }) {
        const findings = checkEmittedSystemData(emitted, {
            fm,
            block,
            documentType,
            subType,
            type,
            fields,
            // See the sibling above: this pack's system, where there is one.
            system: this.packSystem ?? undefined,
            ...(config ? { config } : {}),
        });
        let added = 0;
        for (const finding of findings) {
            const key = `${finding.documentType}|${finding.subtype}|${finding.field}`;
            if (this.emittedFindings.has(key)) continue;
            this.emittedFindings.set(key, {
                message: finding.message,
                file: this.currentNote?.absPath,
            });
            added++;
        }
        return added;
    }

    /**
     * Emit the collected emitted-`system` findings, once each.
     *
     * An **error**, for the reason its sibling is one: the value is gone
     * at load and the build says nothing, and severity that varied by *which
     * part of the build wrote the key* would make the less fixable half the
     * quieter one. What varies is the message, which says whose fix it is —
     * see {@link module:engine/schema-check.emittedUndeclaredMessage}.
     *
     * @returns {number} How many were reported.
     */
    reportEmittedFindings() {
        const found = this.emittedFindings;
        this.emittedFindings = new Map();
        for (const finding of found.values()) {
            this.errorCount++;
            emitDiagnostic({ file: finding.file, severity: "error", message: finding.message });
        }
        return found.size;
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
        throw new Error(`${this.constructor.name} must implement buildEntry(fm, markdown)`);
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
        log.info(`Compiled ${stats.compiled} ${label}${stats.compiled === 1 ? "" : "s"}`);
    }

    /**
     * The pass's own trailing detail line, which names what it rejected in the
     * terms that pass uses.
     *
     * @param {PassStats} stats - The pass's tallies.
     */
    reportDetail(stats) {
        log.debug(`Skipped ${stats.skippedOther} file(s) this pack does not claim`);
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
            // them in the skipped tally is the defect. Each one has
            // already been named individually as a diagnostic.
            log.error(
                `Declined ${stats.declined} note(s) — each named above, with ` +
                    `the reason this pack would not compile it`,
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

        // A note the index could not record is a note this pass declines —
        // counted and reported exactly as the loop below does for the same
        // refusal, because it *is* the same refusal: the index defers to
        // `assertNoDeclaredPackage` for a retired `package:`, which is the
        // check this loop makes a few lines further down. All that changed is
        // which pass sees the note first.
        if (this.reportsCorpusProblems) {
            for (const problem of this.corpus.problems ?? []) {
                stats.declined++;
                this.errorCount++;
                // Emitted directly rather than through `noteError`, which reads
                // the file from `currentNote` — the loop has not started, so
                // there is no current note and the problem carries its own.
                emitDiagnostic({
                    file: problem.file,
                    line: problem.line,
                    column: problem.column,
                    severity: "error",
                    message: problem.message,
                });
            }
        }

        // The corpus, from the index this compile derived once — not a walk of
        // this pass's own. Each note is then read for its **prose**: the
        // index carries what is *about* a note and deliberately not its text,
        // nor the `bodyLine`/`bodyColumn` a diagnostic needs, and this pass has
        // to have the body anyway. So the read is one this pass was already
        // making; what it no longer does is decide for itself which files to
        // make it over.
        for (const record of this.corpus.records) {
            if (!isNoteRecord(record)) continue;
            const absPath = noteFile(this.contentBase, record);
            const { frontmatter: fm, body, bodyLine, bodyColumn } = parseMarkdownFile(absPath);
            // Which note this pass is on, so anything it calls can report a
            // position without every method having to be handed one.
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
            // - `package:`: a note's package is the repository's
            //   configured one, so declaring it restates a constant.
            // - `draft:`: it excluded the note from the packs, the
            //   manifest and the site, and no checker reported the links that
            //   left dangling.
            // - `aliases:`: it fed the alias index, which the bare
            //   `[[Alias]]` form was looked up in; the form is retired, so the
            //   list has no reader left. The nested `name.aliases` is a
            //   different field and is **not** refused — it is reserved, and
            //   deliberately neither read nor validated.
            //
            // Both are reported and counted — never skipped, which is how a
            // tree naming a package nothing answers to used to compile zero
            // notes and exit 0. The file comes from the diagnostic locator, so
            // neither message may repeat it.
            try {
                assertNoDeclaredPackage(fm, { absPath });
                assertNoDeclaredFolder(fm, { absPath });
                assertNoDraftField(fm, { absPath });
                assertNoAliasesField(fm, { absPath });
                assertNoSectionField(fm, { absPath });
                assertNoTraitsField(fm, { absPath });
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
            // The id this note's document is filed under: its authored `id`
            // if it pins one, otherwise the id derived from its canonical
            // address. Resolved for every note this pass claims, and
            // through the one function every other corpus reader calls — the
            // wikilink index, the content index and the Foundry-address pass
            // must all compute the id this pass compiles under, and none of
            // them can see this answer.
            resolveNoteId(fm);
            if (!fm.id) {
                // What is left is a note with **no address** — no `type`, or no
                // `shortcode`. It is not addressable, so there is nothing to
                // derive from and nothing for a link to point at; the message
                // names the reason rather than the missing field, because the
                // field is no longer something an author writes.
                if (this.constructor.requiresId) {
                    throw new Error(
                        `${Label} note has no address, so it has no document id: ` +
                            `${absPath} — a note is addressed as ` +
                            `"<type>-<shortcode>" and must declare both`,
                    );
                }
                stats.skippedNoId++;
                this.noteWarn(`${label} note has no address to derive an id from, skipping`);
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
            // Whether this pack's system is one the note speaks for. Checked
            // after routing — a note bound for another pack is none of this
            // pass's business — and before `skipNote`, so a pass's own
            // rejection rules never run on a note it may not compile.
            try {
                if (!this.eligibleFor(fm)) {
                    stats.skippedOther++;
                    continue;
                }
                // The type-specific half of the retired-field family:
                // what a note of *this* type may not write, which needs the
                // type's own field declaration and so cannot be asked before
                // `selects`. Counted as a declined note for the same reason
                // they are — the alternative is a tree that compiles fewer
                // documents than it has notes and exits 0.
                this.assertAuthorable(fm);
            } catch (err) {
                stats.declined++;
                this.errorCount++;
                this.noteError(err.message, err.position);
                continue;
            }
            if (this.skipNote(fm, body)) {
                stats.skippedOther++;
                continue;
            }

            log.debug(`Processing ${this.noteLabel(fm)}: ${resolveName(fm)} (${absPath})`);
            try {
                const doc = this.compileNote(fm, this.convertBody(fm, body));
                stats.compiled++;
                this.onCompiled(fm, doc);
            } catch (err) {
                this.errorCount++;
                // `position` is set by whatever failed if it knew where — an
                // unresolved address, a bad table directive — so the report
                // points at the line rather than at the note.
                this.noteError(
                    `${this.noteLabel(fm)} failed to compile: ${err.message}`,
                    err.position,
                );
            }
        }

        this.compiledCount = stats.compiled;
        await this.finish(stats);
        // After `finish`, because a pass that writes documents there (the
        // scenes pass bundles an Adventure) has emitted them by now; before
        // `report`, so the pass's summary counts them.
        this.reportEmittedFindings();
        this.report(stats);
    }
}
