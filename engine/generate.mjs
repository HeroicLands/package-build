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
 * Pack JSON generation — in-repo Markdown → per-entry JSON (build-only).
 *
 * Reads the authoritative content tree at the configured content root and
 * compiles each pack's entries to per-entry JSON under its build directory
 * (`build/packs-json/<pack>/` in this repository). The JSON is
 * a disposable build intermediate consumed by `build:compiledb` (which turns it
 * into the shipped LevelDB packs) — it is never committed.
 *
 * Each `*` compiler walks the whole content tree and selects its own entries by
 * the note's `type` — every note in the tree belongs to this repository's
 * `contentPackage` (#56) — so routing is directory-agnostic: a file lands in a
 * pack because of its `type`, not its location. Which packs exist and which
 * folder hierarchy each one loads are declared in
 * `package-build.config.yaml`; folder files live under the content root and are
 * referenced from entry frontmatter via `sohl.folder: <id>`.
 *
 * **The order the passes run in is derived, not declared** — see
 * {@link orderPassesByDependency}. The declared list is the manifest's `packs`
 * array as well, so it is ordered for a reader; a pass that reads another's
 * output states that on its compiler and is scheduled after it (#73).
 *
 * This replaces the retired `packs:export` (vault → committed `_source/`); the
 * HeroicLands vault is no longer a build input for SoHL content.
 */

import fs from "fs";
import path from "path";
import log from "loglevel";

import { foreignItemCatalogDirs } from "./foreign-catalog.mjs";

import { Items } from "../sohl/items.mjs";
import { Journals } from "./journals.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Items } from "../hm3/items.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";
import { Macros } from "./macros.mjs";
import { Scenes } from "./scenes.mjs";
import { statsForPack, loadFolders, buildFolderResolver, writeFolderDocs } from "./helpers.mjs";
import { countContentNotes } from "./content-tree.mjs";
import { emitDiagnostic } from "./diagnostics.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { routerFor } from "./pack-router.mjs";
import { unclaimedNoteFindings } from "./note-claims.mjs";

/**
 * The compiler class for each Foundry document type a pack may hold.
 *
 * The pack list is data (`package-build.config.yaml`), so the one thing it
 * cannot carry is the code that compiles it — a document type maps to its
 * compiler here. Unknown types fail the build rather than defaulting, so a pack
 * declaring a type nothing can compile is loud at the first pass instead of
 * shipping empty.
 *
 * **Two of the five are a system's, and the SoHL pair is not a default.** An
 * Item or an Actor *is* a system's data — both passes declare
 * `requiresSystemBlock` — so which compiler a pack gets is decided together
 * with which system it declares; see {@link SYSTEM_COMPILERS}. The three
 * system-neutral passes have one implementation because a JournalEntry, a Macro
 * and a Scene are Foundry's documents rather than any system's.
 */
const COMPILERS = {
    Item: Items,
    JournalEntry: Journals,
    Actor: Actors,
    Macro: Macros,
    Scene: Scenes,
};

/**
 * The system-specific compilers, by the system a pack declares (#139).
 *
 * A repository feeding two systems declares one Item pack and one Actor pack
 * per system — `harn-ensemble` has `actors-hm3` and `actors-sohl` — and each
 * pack's `system:` is what says whose data model its documents are shaped for.
 * That is the same field the `_stats` stamp, the item-catalogue scope and the
 * `itemBuilders` lookup already read, so nothing new is declared to make the
 * compiler follow it.
 *
 * A system with no entry — or a pack that declares none — falls back to
 * {@link COMPILERS}. That keeps every single-system configuration meaning
 * exactly what it did: SoHL's passes were the only ones, so they stay the
 * answer where nothing says otherwise.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, Function>>>>}
 */
const SYSTEM_COMPILERS = Object.freeze({
    sohl: Object.freeze({ Item: Items, Actor: Actors }),
    hm3: Object.freeze({ Item: Hm3Items, Actor: Hm3Actors }),
});

/**
 * The compiler class a pack of one document type and one system gets.
 *
 * @param {string} docType - The Foundry document type the pack holds.
 * @param {string|null} [system] - The system the pack declares, if any.
 * @returns {Function|undefined} The compiler class, or `undefined` for a
 *   document type nothing here compiles — which {@link generatePack} reports
 *   rather than defaulting past.
 */
export function compilerFor(docType, system = null) {
    return (system && SYSTEM_COMPILERS[system]?.[docType]) || COMPILERS[docType];
}

/**
 * Root of the build-only JSON tree for one pack.
 *
 * @param {string} name - The pack name.
 * @param {object} [config] - The resolved build configuration. Defaults to this
 *   repository's.
 * @returns {string} The pack's JSON directory.
 */
export const packJsonDir = (name, config = loadPackConfig()) =>
    path.join(config.paths.packJson, name);

/**
 * The generated JSON of **every** configured Item pack — what the actors pass
 * reads its predefined items from.
 *
 * All of them, not the first: a repository may ship several Item packs (#1566),
 * and an actor's embedded items may be sourced from any of them. Finding one
 * pack and stopping is how embedded-item resolution would silently miss every
 * item that landed in another. Returned in configured order, which is also the
 * order they compile in — {@link orderPassesByDependency} keeps the declared
 * order among packs of one type — and every one of them is written before the
 * actors pass that reads them.
 *
 * **Scoped to one system when the caller has one (#58).** A being addresses an
 * item by `(type, shortcode)`, and that address is unique within one system and
 * not across two: `skill:sword` is an HM3 skill *and* a SoHL skill, with
 * different data models behind them. The reference itself is unambiguous — it
 * sits inside a system block, so position says which it means — but the
 * resolver has to know which catalogue it is searching, or it resolves the pair
 * by whichever pack was read first. So an Actor pass reads the Item packs of
 * **its own** system plus the system-neutral ones, which belong to every
 * system. Asking for no system reads them all, which is every single-system
 * build and the behaviour this always had.
 *
 * @param {object} [config] - The resolved build configuration. Defaults to this
 *   repository's.
 * @param {string|null} [system] - The system whose catalogue is wanted. Omitted
 *   or `null`, every Item pack is read.
 * @returns {string[]} Each Item pack's JSON directory. Empty when the
 *   repository ships no items at all, which is a legitimate package: the actors
 *   pass accepts an empty list and reports an item it cannot resolve per
 *   `(type, shortcode)` instead, naming the being (#49).
 */
export function itemPackJsonDirs(config = loadPackConfig(), system = null) {
    return config.packs
        .filter((pack) => pack.type === "Item")
        .filter((pack) => system == null || !pack.system || pack.system === system)
        .map((pack) => packJsonDir(pack.name, config));
}

/**
 * The document types whose compiled output a pass of this type reads.
 *
 * Asked of the compiler rather than held in a table here, so the dependency
 * lives in the class that does the reading and a consumer's own compiler can
 * declare its own. A type no compiler is registered for waits on nothing —
 * {@link generatePack} reports it as an unknown type, which is the better
 * message.
 *
 * @param {string} type - A pack's document type.
 * @returns {readonly string[]} The types it reads the output of.
 */
function readsOutputOf(type) {
    return COMPILERS[type]?.readsPackOutputOf ?? [];
}

/**
 * The passes to run, ordered so that each one follows the output it reads.
 *
 * **Declaration order is presentation, not compile order (#73).** The same
 * `packs:` list is the manifest's `packs` array, which a consumer orders for a
 * reader browsing compendiums; the actors pass, meanwhile, resolves each
 * being's embedded items against the item passes' *output*. Making one list
 * satisfy both meant an Actor pack declared first compiled only where a
 * previous run had already left `build/packs-json` populated — green on a warm
 * tree, exit 1 on every fresh checkout and every CI runner, and `build/` is
 * gitignored so that is the state CI always starts from.
 *
 * **The reordering is the smallest one that works.** Each step takes the
 * *earliest declared* pass whose dependencies are all already emitted, so a
 * list that was already in a workable order comes back untouched, and one that
 * was not moves exactly the passes that had to move. A dependency is satisfied
 * only when **every** pack of that type has run: a being addresses an item by
 * `(type, shortcode)` without knowing which Item pack ships it, so waiting for
 * one of several would resolve some beings and silently fail others.
 *
 * A dependency on a type this configuration declares no pack of is not waited
 * for. A package may ship an Actor pack and no Item pack; the pass that needs
 * one refuses on its own, with a message about items rather than about order.
 *
 * @param {readonly object[]} packs - The passes to be run, as declared.
 * @returns {object[]} A new list, in compile order. The input is untouched.
 * @throws {Error} If the passes read each other's output in a cycle, which no
 *   order can satisfy. Only reachable from a mis-declared compiler, so it names
 *   the passes rather than blaming the pack list.
 */
export function orderPassesByDependency(packs) {
    const declared = new Set(packs.map((pack) => pack.type));
    const remaining = [...packs];
    const emitted = new Set();
    /** @type {object[]} */
    const ordered = [];

    /** Whether every pack this pass reads the output of has already run. */
    const ready = (pack) =>
        readsOutputOf(pack.type).every(
            (dependency) =>
                !declared.has(dependency) ||
                packs.every((other) => other.type !== dependency || emitted.has(other.name)),
        );

    while (remaining.length) {
        const next = remaining.findIndex(ready);
        if (next === -1) {
            throw new Error(
                `package-build: the configured passes read each other's ` +
                    `output in a cycle (` +
                    `${remaining.map((pack) => `${pack.name} (${pack.type})`).join(", ")}` +
                    `); no compile order can satisfy that.`,
            );
        }
        const [pack] = remaining.splice(next, 1);
        emitted.add(pack.name);
        ordered.push(pack);
    }
    return ordered;
}

/**
 * The dependencies this run cannot satisfy by ordering, because the pass that
 * would produce them is not in it.
 *
 * Ordering answers the whole-package build; a run restricted to one pack
 * (`content-build package compile <name>`) cannot conjure the passes it left
 * out. Where their output is already on disk from an earlier run that is fine
 * — it is how compiling one pack at a time is meant to work — so this reports
 * only what is genuinely absent, and names the pack that would write it rather
 * than the directory that is missing.
 *
 * @param {readonly object[]} running - The passes this run will execute.
 * @param {object} config - The resolved build configuration.
 * @returns {string[]} One message per unsatisfiable dependency.
 */
export function unsatisfiedPassDependencies(running, config) {
    const included = new Set(running.map((pack) => pack.name));
    /** @type {string[]} */
    const messages = [];
    for (const pack of running) {
        for (const dependency of readsOutputOf(pack.type)) {
            for (const producer of config.packs) {
                if (producer.type !== dependency) continue;
                if (included.has(producer.name)) continue;
                const dir = packJsonDir(producer.name, config);
                if (fs.existsSync(dir)) continue;
                messages.push(
                    `pack "${pack.name}" (${pack.type}) reads the compiled ` +
                        `output of the ${producer.type} pack ` +
                        `"${producer.name}", which this run does not compile ` +
                        `and which ${dir} does not hold — compile the whole ` +
                        `package, or compile "${producer.name}" first`,
                );
            }
        }
    }
    return messages;
}

/**
 * Generate the per-entry JSON for one pack into `build/packs-json/<name>/`.
 *
 * @param {object} pack - One entry of the configured pack list.
 * @param {object} config - The resolved build configuration.
 * @param {object} router - The pack router, which decides which pack of this
 *     pass's document type each claimed note belongs in.
 * @param {boolean} routingReporter - Whether this pass reports a note of its
 *     document type that routes nowhere. True for the first configured pack of
 *     the type, so one unroutable note yields one error rather than one per
 *     pack.
 * @returns {Promise<{errors: number, compiled: number}>} The compiler's error
 *     count (0 on success) and the number of entries it wrote.
 */
async function generatePack(
    { name, type, folders, companions, system },
    config,
    router,
    routingReporter,
) {
    const contentBase = config.paths.content;
    const dest = packJsonDir(name, config);

    const packClass = compilerFor(type, system ?? null);
    if (!packClass) {
        log.error(
            `Pack ${name}: no compiler for document type "${type}" — the ` +
                `configured pack list names a type this toolchain cannot compile.`,
        );
        return { errors: 1, compiled: 0 };
    }

    log.info(`Pack ${name}: ${contentBase} → ${dest}`);

    let folderList;
    let resolver;
    try {
        folderList = folders ? loadFolders(path.join(contentBase, folders)) : [];
        ({ resolver } = buildFolderResolver(folderList));
    } catch (err) {
        log.error(`${name} ${folders} validation failed: ${err.message}`);
        return { errors: 1, compiled: 0 };
    }

    // Wipe and recreate so removed content notes leave no stale JSON.
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });

    // A companion pack is written by the same pass — the scenes pass also emits
    // the adventures that bundle them — so it is wiped on the same schedule.
    const companionDests = {};
    for (const companion of companions) {
        const companionDest = packJsonDir(companion.name, config);
        fs.rmSync(companionDest, { recursive: true, force: true });
        fs.mkdirSync(companionDest, { recursive: true });
        companionDests[companion.name] = companionDest;
    }

    // A folder document belongs to the pack it is written into, so it carries
    // that pack's system rather than the package-wide one (#48).
    writeFolderDocs(folderList, statsForPack(system, config), dest, type);

    const pack = new packClass({
        contentBase,
        dest,
        companionDests,
        // The actors pass resolves each being's embedded items against the items
        // passes' output. That used to be an unwritten sibling-directory contract
        // (`path.resolve(dest, "..", "items")`); the configured pack list names
        // the Item packs, so the dependency is stated rather than assumed
        // (#1508) — and it is every Item pack, since a repository may ship more
        // than one (#1566).
        // Scoped to this pack's system, so a being resolves `(type, shortcode)`
        // against its own system's catalogue and the neutral one (#58).
        itemsSourceDirs: itemPackJsonDirs(config, system ?? null),
        // The catalogue of a package this repository depends on but does
        // not contain, for a repository that authors beings without
        // holding the items they are assembled from. Cache-only: a cold
        // cache throws naming `content-build deps fetch` rather than
        // downloading inside a compile.
        foreignSourceDirs: foreignItemCatalogDirs(config),
        folderResolver: resolver,
        // One answer to "which files are the corpus?", from the configuration
        // this build resolved rather than from the working directory (#243).
        skipDirectories: config.skipDirectories,
        packName: name,
        // Which system this pack's documents are stamped for (#48).
        packSystem: system ?? null,
        docType: type,
        router,
        routingReporter,
    });
    await pack.compile();
    return { errors: pack.errorCount, compiled: pack.compiledCount };
}

/**
 * The passes that compiled nothing when they were expected to compile
 * something — a build failure, not a quiet no-op.
 *
 * A pack ships blank whenever every note in a full tree was rejected — by a
 * `selects` that claims nothing, or a `pack:` that routes everything elsewhere
 * — and the build then exits 0 (#1502). The empty-tree guard in
 * {@link generatePacksJson} cannot see that: the tree is full, it is the
 * *output* that is empty.
 *
 * @param {Array<{name: string, compiled: number, mayBeEmpty?: boolean}>} passes -
 *     One entry per generated pack.
 * @returns {string[]} One message per pass that must not have been empty.
 */
export function emptyPassErrors(passes) {
    return passes
        .filter((pass) => !pass.mayBeEmpty && pass.compiled === 0)
        .map(
            (pass) =>
                `Pack "${pass.name}" compiled 0 entries from a non-empty ` +
                `content tree. Every note was rejected — check that the tree ` +
                `holds notes of the type this pack claims, and that their ` +
                `\`pack:\` routes here, or declare the pack \`mayBeEmpty\` if it ` +
                `genuinely ships nothing.`,
        );
}

/**
 * Generate the build-only JSON for every pack (or one, when `only` is given).
 *
 * @param {object} [opts]
 * @param {string} [opts.only] - Restrict to a single pack name.
 * @param {object} [opts.config] - The resolved build configuration. Defaults to
 *   this repository's. Supplying one is how a caller compiles a *different*
 *   package's tree — and how the guard-order test below induces id drift, now
 *   that the manifest is located by configuration rather than by the working
 *   directory.
 * @returns {Promise<number>} Total error count across the generated packs.
 * @throws {Error} If the configured Foundry package id has drifted from the
 *   shipped manifest's `id` (see `package-manifest.mjs`).
 */
export async function generatePacksJson({ only, config = loadPackConfig() } = {}) {
    // Before anything is generated: every UUID written below is addressed to
    // the configured `foundryPackage`, so a value that has drifted from the shipped
    // manifest's `id` produces a whole pack of links that resolve nowhere.
    // Throws rather than counting an error — there is nothing worth compiling.
    //
    const contentBase = config.paths.content;
    if (!fs.existsSync(contentBase)) {
        log.error(`Content tree not found at ${contentBase}.`);
        return 1;
    }
    // A tree that is present but empty compiles zero documents *without an
    // error*, and ships blank compendiums. Refuse instead: this only happens
    // when the generated tree was never exported, or exported from the wrong
    // place, and neither is something to build on.
    const noteCount = countContentNotes(contentBase);
    if (noteCount === 0) {
        log.error(
            `Content tree at ${contentBase} holds no notes, so every pack would ` +
                `compile empty. The configured content root is ` +
                `this repository's own source — check out the tree.`,
        );
        return 1;
    }
    log.info(`Content tree: ${noteCount} note(s) at ${contentBase}`);

    // A note whose `type:` no configured pack claims compiles into nothing, and
    // used to say nothing (#146) — no pass got far enough to reject it, so the
    // silence had no owner. Asked once, of the whole configuration, because
    // that is the only place it can be answered: a per-pass check would report
    // every type a system deliberately does not map, which is exactly the
    // silence #79 requires. Independent of `only`, since it is a fact about the
    // configured pack list rather than about which passes this run executes.
    const unclaimed = unclaimedNoteFindings(config);
    for (const finding of unclaimed) emitDiagnostic(finding);

    fs.mkdirSync(config.paths.packJson, { recursive: true });

    // A companion pack has no pass of its own — naming it selects the pass that
    // writes it, so `compile adventures` is not a silent no-op.
    const packs = config.packs.filter(
        (pack) =>
            !only ||
            pack.name === only ||
            pack.companions.some((companion) => companion.name === only),
    );
    // One router per configuration, so every pass agrees about where a note
    // goes, and the first pack of each document type owns the error message for
    // a note of that type that goes nowhere.
    const router = routerFor(config);
    const firstOfType = new Map();
    for (const pack of config.packs) {
        if (!firstOfType.has(pack.type)) firstOfType.set(pack.type, pack.name);
    }

    // Compile order is derived from what each pass reads, not from the order
    // `packs:` declares — that list is also the manifest's, which a consumer
    // orders for a reader (#73).
    const ordered = orderPassesByDependency(packs);
    if (ordered.some((pack, index) => pack !== packs[index])) {
        log.info(
            `Pass order: ${ordered.map((pack) => pack.name).join(", ")} — a ` +
                `pass that reads another's output compiles after it, whatever ` +
                `order \`packs:\` declares.`,
        );
    }

    // What ordering cannot reach: a run restricted to one pack, whose
    // dependencies are simply not in it and not on disk either.
    const unsatisfied = unsatisfiedPassDependencies(ordered, config);
    if (unsatisfied.length) {
        for (const message of unsatisfied) {
            emitDiagnostic({ severity: "error", message });
        }
        return unsatisfied.length + unclaimed.length;
    }

    let totalErrors = unclaimed.length;
    const passes = [];
    for (const pack of ordered) {
        const { errors, compiled } = await generatePack(
            pack,
            config,
            router,
            firstOfType.get(pack.type) === pack.name,
        );
        totalErrors += errors;
        passes.push({
            name: pack.name,
            compiled,
            mayBeEmpty: pack.mayBeEmpty,
        });
    }

    for (const message of emptyPassErrors(passes)) {
        log.error(message);
        totalErrors++;
    }
    return totalErrors;
}
