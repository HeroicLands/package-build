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
 * **Which note types a configuration compiles at all** — and the finding for a
 * note whose type nothing claims (#146), or whose *second* document nothing
 * claims (#152).
 *
 * Every compile pass answers one question about a note: _is this mine?_ A note
 * every pass answers "no" to is skipped as quietly as the thousands that
 * legitimately belong to another pass — and where **no** pass would have said
 * yes, that quiet is the whole of the report. `harn-ensemble` declares no
 * `itemBuilders`, so its five `affiliation` notes were claimed by nothing: the
 * journals pass rejected them, the Actor passes rejected them, and no Item pack
 * existed to claim them. They vanished from the build with no error, no warning
 * and no census line, while its 2,512 `being` notes each produced a routing
 * error — the same failure with more information, because some pass got far
 * enough to complain.
 *
 * This module supplies the missing complaint, and it is asked **once per
 * build** rather than once per pass. That is not an optimisation: it is the
 * only place the question can be answered correctly. #79's rule is that a
 * markdown type with no mapping in a given system produces no document *for
 * that system*, silently and correctly — so a per-pass check would report
 * `armorlocation` against every system that does not map it, which is precisely
 * the noise the rule forbids. "No system claims it at all" is a different
 * statement, and only the whole configuration can make it.
 *
 * ## The two conditions, and why they are not one
 *
 * | condition | what it means | whose fix |
 * | --- | --- | --- |
 * | in the **vocabulary**, claimed by no pack | this build knows the type; nothing here is configured to compile it | configuration |
 * | not in the vocabulary | nothing anywhere knows the type | authoring |
 *
 * The **vocabulary** is deliberately wider than one repository's
 * configuration: it is what this toolchain and the systems it ships know a note
 * type to be. `affiliation` is a SoHL Item however a given repository is
 * configured, so a tree full of `affiliation` notes with no Item pack behind
 * them is a repository that has not finished configuring itself — not an author
 * who invented a word. Collapsing the two would send `harn-ensemble` to correct
 * five perfectly good notes.
 *
 * ## The claim table mirrors `selects`, and a test holds them together
 *
 * Which note types a pass claims is stated by that pass's `selects`, and the
 * table below is a second statement of the same fact — the only form in which
 * the question can be asked of a pack that is *not* configured, which is exactly
 * the question here. `tests/unclaimed-note-types.test.ts` compares the two for
 * every type in the vocabulary, so the two statements cannot drift apart.
 *
 * ## The partial case, which the union above cannot see (#152)
 *
 * Everything above asks one question of the whole configuration — _does any
 * pack claim this type?_ — and a union answers it. That union is **blind to a
 * note that lands half of itself**, because one claiming pack satisfies it
 * however many documents the note actually produces.
 *
 * A note produces more than one. An item note compiles into an Item *and*, from
 * its prose, a JournalEntry; a `macro` note into a Macro and a JournalEntry; a
 * map note into a Scene and a JournalEntry. So two live configurations already
 * have the shape:
 *
 * | configuration | declares no | the note | what is lost |
 * | --- | --- | --- | --- |
 * | `sohl-thalorna` | `Macro`, `Scene` pack | a `macro` or a `map` note | the Macro, or the Scene |
 * | `sohl-kethira-basic` | `JournalEntry` pack | any item note with prose | the prose |
 *
 * In each the union says "claimed", every pass that runs succeeds, the build
 * exits 0, and the missing document is missing with nothing said about it.
 *
 * So this question is asked **per note and per document** rather than per type:
 * {@link documentsProducedBy} enumerates what one note compiles into, and
 * {@link unpackedDocumentFindings} asks the claim question once for each. The
 * two checks divide cleanly and neither can report the other's case — a type
 * *nothing* claims is #146's, and this one passes over such a note by name, so
 * none is ever reported twice.
 *
 * **#79's silence is preserved by staying type-wide about systems.** The
 * documents a note produces are the union across the systems that map its type,
 * exactly as above, so a type one system deliberately does not map produces
 * nothing for that system and is reported for nothing. The partial case is
 * about *document classes*, not about systems, and asking it per system would
 * reintroduce the noise #79 forbids.
 *
 * @module
 */

import { assertSuppliedCorpus, parseMarkdownFile } from "./helpers.mjs";
// The record accessors only: this module is imported by the content index, so
// importing the index back would close a cycle (#243).
import { authoredFrontmatter, isNoteRecord, noteFile } from "./index-records.mjs";
import { JOURNAL_TYPES, MAP_TYPES, PACK_BY_TYPE, RETIRED_TYPES, currentType } from "./ids.mjs";
import { itemTypes } from "./item-registry.mjs";
import { docEntryTypes } from "./item-docs.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";
import { noteTypesFor, subtypeRow } from "./document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";
import { HOMEPAGE_TYPE } from "./homepage.mjs";
import { FOLDER_TYPE } from "./folder-notes.mjs";
import { BUNDLE_TYPE } from "./bundle-notes.mjs";
import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";

/**
 * Note types that compile into **no compendium document, by design**.
 *
 * A homepage compiles into a *page*: it carries no compendium UUID, appears in
 * no pack and in no link-manifest entry, and every package that publishes one
 * would otherwise be told its front page is unclaimed. It is the one type whose
 * absence from every pack is the intended state rather than a gap.
 *
 * @type {ReadonlySet<string>}
 */
export const NEVER_PACKED_TYPES = Object.freeze(new Set([HOMEPAGE_TYPE]));

/**
 * Content types the specification states and this toolchain does not yet
 * compile.
 *
 * **Stated, never inferred, and that distinction is the whole point.** An
 * unimplemented type and a type somebody forgot to route look identical from
 * the outside: both are documented, both validate, and neither reaches a pass.
 * The only thing separating them is intent, so intent is written down here.
 *
 * Inferring it — "declared, but absent from the configured vocabulary" — reads
 * correctly and is worthless, because the configured vocabulary is *derived
 * from the routing*. Take a type's route away and it leaves the vocabulary too,
 * so the inference excuses precisely the mistake it was meant to catch. That is
 * not hypothetical: it is #241, where `place`, `lore` and `scenario` were
 * declared, validated and unrouted, and every gate reported success until a
 * downstream repository failed on 450 notes.
 *
 * A type leaves this set when it is implemented, the way `bundle` did in #259.
 * The membership is asserted, so it cannot be forgotten in either direction.
 *
 * @type {ReadonlySet<string>}
 */
export const UNIMPLEMENTED_TYPES = Object.freeze(new Set(["vehicle"]));

/**
 * Note types that reach a pack by a route **other than the pack router**.
 *
 * A folder is the only one, and it is not unclaimed: it compiles to a real
 * `Folder` document. What it has no answer to is *which* pack claims it, because
 * that is not a property of the note — a folder materialises in every pack
 * holding a document that references it, and its ancestors with it (#257). So
 * it is exempt from the claim check for the opposite reason a homepage is:
 * a homepage is in no pack, and a folder may be in several.
 *
 * @type {ReadonlySet<string>}
 */
export const DERIVED_PACKED_TYPES = Object.freeze(new Set([FOLDER_TYPE]));

/**
 * The note-type → document-subtype maps this toolchain ships.
 *
 * Declared in {@link module:engine/subtype-registry} and re-exported here,
 * where it has always been read from. It moved to a leaf in #270 so that
 * `helpers.mjs` could reach it: this module imports `walkMarkdownTree` from
 * there, so a dependency the other way would have closed a cycle.
 *
 * @type {readonly import("./document-subtypes.mjs").DocumentSubtypeMap[]}
 */
export { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";

/**
 * What a claim question is asked against.
 *
 * Each field defaults to what the compilers themselves read, so the answer here
 * and the answer a pass gives are drawn from one source. They are parameters so
 * that a test can pose a configuration this toolchain does not ship — two
 * systems cutting the vocabulary differently, a registry declaring nothing —
 * without a content tree or a config file on disk.
 *
 * @typedef {object} ClaimSources
 * @property {readonly import("./document-subtypes.mjs").DocumentSubtypeMap[]} [maps] -
 *   The systems' note-type → document-subtype maps.
 * @property {ReadonlySet<string>} [itemTypes] - The declared item vocabulary.
 * @property {ReadonlySet<string>} [docEntryTypes] - The doc-carrying types.
 */

/**
 * Fill in whatever a caller did not supply, from the configured registries.
 *
 * @param {ClaimSources} [sources] - What the caller supplied.
 * @returns {Required<ClaimSources>} Every source, resolved.
 */
function resolveSources(sources = {}) {
    return {
        maps: sources.maps ?? KNOWN_DOCUMENT_SUBTYPE_MAPS,
        itemTypes: sources.itemTypes ?? itemTypes(),
        docEntryTypes: sources.docEntryTypes ?? docEntryTypes(),
    };
}

/**
 * The Foundry document classes the systems say a note type compiles into.
 *
 * @param {readonly import("./document-subtypes.mjs").DocumentSubtypeMap[]} maps -
 *   The systems' maps.
 * @param {string} type - The note's declared `type`.
 * @returns {string[]} The document classes, deduplicated, in map order.
 */
function mappedDocuments(maps, type) {
    const documents = [];
    for (const map of maps) {
        const row = subtypeRow(map, type);
        if (row && !documents.includes(row.document)) documents.push(row.document);
    }
    return documents;
}

/**
 * The systems whose map names a note type.
 *
 * @param {readonly import("./document-subtypes.mjs").DocumentSubtypeMap[]} maps -
 *   The systems' maps.
 * @param {string} type - The note's declared `type`.
 * @returns {string[]} The system ids, in map order.
 */
function mappingSystems(maps, type) {
    return maps.filter((map) => subtypeRow(map, type)).map((map) => map.system);
}

/**
 * The Foundry document classes some pass of this build actually compiles.
 *
 * The claim table below answers for exactly these and returns the empty set for
 * everything else, which is what keeps a prebuilt `Cards` or `RollTable` pack
 * from appearing to answer for any note. Stated as a set as well, because
 * "claims nothing" and "nothing compiles it" are the same empty answer read two
 * ways, and #152 has to tell them apart: a document class with no pack is a line
 * a consumer can add to `packs:`, while a class this toolchain has no pass for
 * is a gap no configuration can close, and sending someone to edit
 * `package-build.config.yaml` for the second is sending them nowhere.
 *
 * It is `generate.mjs`'s `COMPILERS` keys restated — the same relationship the
 * claim table has to each pass's `selects`, and held together the same way, by
 * a test rather than by an import. `generate.mjs` imports *this* module, so the
 * arrow cannot point the other way.
 *
 * @type {ReadonlySet<string>}
 */
export const COMPILED_DOCUMENT_CLASSES = Object.freeze(
    new Set(["Item", "Actor", "JournalEntry", "Macro", "Scene", "Adventure"]),
);

/**
 * The note types a pass of one document type claims — the claim table.
 *
 * Each row restates one pass's `selects`, in the only form that can be asked of
 * a pack the configuration does not declare. A document type no compiler is
 * registered for claims nothing, which is what keeps a prebuilt `Adventure`
 * pack from appearing to answer for any note.
 *
 * @param {string} docType - The Foundry document type a pack holds.
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {readonly object[]} [opts.records] - The corpus, derived once by the
 *   compile and handed in — required, for the reason above (#243). Defaults to the
 *   configured registries and the systems this toolchain ships.
 * @returns {ReadonlySet<string>} The note types such a pass would claim.
 */
export function noteTypesClaimedBy(docType, sources) {
    const { maps, itemTypes: items, docEntryTypes: docs } = resolveSources(sources);
    switch (docType) {
        // The items pass: the declared registry's keys, filtered by the
        // systems' maps — a type a system sends to some *other* document class
        // is not an item however a registry spells it.
        case "Item":
            return Object.freeze(
                new Set(
                    [...items].filter((type) => {
                        const documents = mappedDocuments(maps, type);
                        return documents.length === 0 || documents.includes("Item");
                    }),
                ),
            );
        // The actors pass: every note type a system sends to an `Actor`.
        case "Actor":
            return Object.freeze(new Set(maps.flatMap((map) => noteTypesFor(map, "Actor"))));
        // The journals pass: every type whose whole document is a journal,
        // plus every doc-carrying type — an item's, a macro's and a map note's
        // description each compile into a JournalEntry of their own.
        case "JournalEntry":
            return Object.freeze(new Set([...JOURNAL_TYPES, ...docs]));
        case "Macro":
            return Object.freeze(new Set(["macro"]));
        case "Scene":
            return Object.freeze(new Set(MAP_TYPES));
        // The bundles pass: an Adventure is what a `bundle` note compiles into
        // (#259). A **prebuilt** Adventure pack still claims nothing —
        // {@link claimedNoteTypes} passes over it, because no note is routed
        // into a pack whose JSON is checked in rather than compiled.
        case "Adventure":
            return Object.freeze(new Set([BUNDLE_TYPE]));
        default:
            return Object.freeze(new Set());
    }
}

/**
 * Every note type some pack in a configuration would compile.
 *
 * The union across the configured pack list, so a type claimed by any one pack
 * is claimed — which is what keeps a type deliberately unmapped for one system,
 * and claimed for another, silent (#79).
 *
 * **A prebuilt pack claims nothing.** Its per-document JSON is checked in
 * rather than compiled, so it has no pass and no note is routed into one —
 * which `content-config.mjs` already states by refusing `default: true`
 * alongside `prebuilt`. Counting it would tell an author their note is claimed
 * by a pack that will never look at it. Before #259 the point could not arise:
 * the only prebuilt pack in the wild is `harn-adventures`'s Adventure pack, and
 * no compiler was registered for that document type, so the row answered for
 * nothing whatever it was asked. Now one is.
 *
 * @param {object} [config] - The resolved build configuration. Defaults to this
 *   repository's.
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {readonly object[]} [opts.records] - The corpus, derived once by the
 *   compile and handed in — required, for the reason above (#243).
 * @returns {ReadonlySet<string>} The claimed note types.
 */
export function claimedNoteTypes(config = loadPackConfig(), sources) {
    const claimed = new Set();
    for (const pack of config.packs ?? []) {
        if (pack.prebuilt) continue;
        for (const type of noteTypesClaimedBy(pack.type, sources)) claimed.add(type);
    }
    return Object.freeze(claimed);
}

/**
 * Every note type this build knows, whatever any one repository configures.
 *
 * Wider than {@link claimedNoteTypes} on purpose: it is what distinguishes a
 * repository that has not configured a pack for a real content type from an
 * author who wrote a word nothing anywhere compiles. The engine's own types,
 * the types every shipped system maps, and whatever the configured registries
 * declare on top.
 *
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {readonly object[]} [opts.records] - The corpus, derived once by the
 *   compile and handed in — required, for the reason above (#243).
 * @returns {ReadonlySet<string>} The vocabulary.
 */
export function noteTypeVocabulary(sources) {
    const { maps, itemTypes: items } = resolveSources(sources);
    return Object.freeze(
        new Set([
            ...Object.keys(PACK_BY_TYPE),
            ...MAP_TYPES,
            ...NEVER_PACKED_TYPES,
            ...items,
            ...maps.flatMap((map) => Object.keys(map.types)),
        ]),
    );
}

/**
 * The document a note's **own** `type:` compiles into, before any second one.
 *
 * Three sources, asked in the order that makes each one's answer the best
 * available: a system's map is the most specific statement there is, the item
 * registry answers for a type the shipped maps do not name, and
 * {@link PACK_BY_TYPE} holds the engine's own types, which belong to no system
 * and no registry.
 *
 * @param {Required<ClaimSources>} sources - What to answer from.
 * @param {string} current - The note's type, in its current spelling.
 * @returns {string[]} The document classes, deduplicated, in map order.
 */
function primaryDocuments(sources, current) {
    const documents = mappedDocuments(sources.maps, current);
    if (!documents.length && sources.itemTypes.has(current)) documents.push("Item");
    if (!documents.length && PACK_BY_TYPE[current]) documents.push(PACK_BY_TYPE[current].docType);
    return documents;
}

/**
 * Every document one note compiles into, and what each of them is to the note.
 *
 * **The question #146 could not ask.** That check needs one fact about a type —
 * does anything claim it — and this needs the list, because a note that lands
 * its Item and loses its prose is claimed and half-compiled at once. Two roles,
 * and they fail for different reasons and are remedied differently:
 *
 * - `"primary"` — the document the note's `type:` names. A `map` note's Scene,
 *   an item note's Item, a `being`'s Actor. Losing it loses the note.
 * - `"documentation"` — the JournalEntry the note's **prose** compiles into,
 *   for every type in `docEntryTypes` (#1348, #1514, #1525, #337). Losing it
 *   loses the words and leaves the document pointing at nothing.
 *
 * **The union across systems, never per system** — see the module comment.
 * A type one system maps and another does not produces exactly the documents
 * the mapping systems name, which is #79's rule stated as a list rather than as
 * a silence.
 *
 * @param {string} type - The note's declared `type`, authored spelling.
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {boolean} [opts.prose=true] - Whether the note body carries prose. A
 *   doc-carrying note with an empty body compiles **no** documentation entry —
 *   `Journals.skipNote` and the scenes pass apply that rule to the same body, so
 *   a caller that has read the note says so here and is told the truth about
 *   what the note produces rather than about what its type could.
 * @returns {Array<{document: string, role: "primary"|"documentation"}>} The
 *   documents, primaries first.
 */
export function documentsProducedBy(type, sources, { prose = true } = {}) {
    const resolved = resolveSources(sources);
    // Every table here is keyed by the current spelling of a note type; a note
    // on a renamed one compiles exactly the same documents (#78).
    const current = currentType(type);
    const produced = primaryDocuments(resolved, current).map((document) => ({
        document,
        role: /** @type {"primary"} */ ("primary"),
    }));
    if (prose && resolved.docEntryTypes.has(current)) {
        produced.push({
            document: "JournalEntry",
            role: /** @type {"documentation"} */ ("documentation"),
        });
    }
    return produced;
}

/**
 * A readable list — `"a", "b" or "c"`.
 *
 * @param {readonly string[]} values - The values.
 * @returns {string} The list.
 */
function list(values) {
    const quoted = values.map((value) => `"${value}"`);
    if (quoted.length <= 1) return quoted.join("");
    return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/**
 * `"a"` or `"an"`, so a document class reads as English wherever it is named.
 *
 * @param {string} word - The word the article precedes.
 * @returns {string} The article.
 */
function article(word) {
    return /^[AEIOUaeiou]/.test(word) ? "an" : "a";
}

/**
 * The **configuration** finding: this build knows the type, and nothing here
 * compiles it.
 *
 * The remedy names what is actually missing rather than a generic one, because
 * the two halves fail independently: `harn-ensemble` has neither the registry
 * entry nor the pack, and a repository that declares a registry and forgets the
 * pack has only the second.
 *
 * @param {string} type - The note's declared `type`.
 * @param {object} config - The resolved build configuration.
 * @param {Required<ClaimSources>} sources - What to answer from.
 * @returns {string} The message.
 */
function configurationMessage(type, config, sources) {
    // Every table below is keyed by the current spelling of a note type; the
    // message quotes the authored one, which is what the reader has in front of
    // them (#78).
    const current = currentType(type);
    const documents = primaryDocuments(sources, current);

    const systems = mappingSystems(sources.maps, type);
    const configured = new Set((config.packs ?? []).map((pack) => pack.type));
    const packless = documents.filter((document) => !configured.has(document));
    const needsBuilder = documents.includes("Item") && !sources.itemTypes.has(current);

    const into = documents.map((document) => `${article(document)} ${document}`).join(" or ");
    const becomes =
        documents.length ?
            systems.length ?
                `The ${list(systems)} system${systems.length > 1 ? "s" : ""} ` +
                `compile${systems.length > 1 ? "" : "s"} it into ${into}`
            :   `It compiles into ${into}`
        :   `Nothing configured here compiles it`;

    const remedy =
        packless.length && needsBuilder ?
            `\`packs:\` declares no ${packless.join(" or ")} pack and no ` +
            `\`itemBuilders\` registry declares "${type}" — declare both in ` +
            `package-build.config.yaml`
        : packless.length ?
            `\`packs:\` declares no ${packless.join(" or ")} pack — declare one in ` +
            `package-build.config.yaml`
        : needsBuilder ?
            `no \`itemBuilders\` registry declares "${type}" — declare it in ` +
            `package-build.config.yaml`
        :   `nothing in \`packs:\` claims it — check the pack list in ` +
            `package-build.config.yaml`;

    return (
        `no configured pack claims a note of type "${type}", so it compiles ` +
        `into nothing. ${becomes}, but ${remedy}, or stop authoring the type.`
    );
}

/**
 * The **specification** finding: the format states the type, nothing compiles it.
 *
 * A third thing that can be wrong, and the only one that is not the author's
 * fault. `docs/content-format.md` documents the type and the vocabulary declares
 * its properties, so a note written against the published specification is
 * correct — this toolchain simply has not implemented it yet.
 *
 * It earns its own message because the other two would both mislead here.
 * Naming a missing pack or registry sends an author to
 * `package-build.config.yaml`, where nothing they can write will help; saying
 * the type is unknown flatly contradicts the specification they read it in.
 *
 * @param {string} type - The note's declared `type`.
 * @returns {string} The message.
 */
function specifiedMessage(type) {
    return (
        `no configured pack claims a note of type "${type}", so it compiles ` +
        `into nothing. The content format specifies "${type}", so the note is ` +
        `not wrong — this toolchain has not implemented the type yet. Nothing ` +
        `in this repository's configuration will change that; do not author ` +
        `the type until a release compiles it.`
    );
}

/**
 * The **authoring** finding: nothing anywhere knows the type.
 *
 * @param {string} type - The note's declared `type`.
 * @returns {string} The message.
 */
function authoringMessage(type) {
    return (
        `no configured pack claims a note of type "${type}", so it compiles ` +
        `into nothing — and "${type}" is not a content type this build knows ` +
        `at all: no system maps it and no \`itemBuilders\` registry declares it. ` +
        `Correct the note's \`type:\`, or declare the type alongside the ones ` +
        `this repository already ships.`
    );
}

/**
 * Every note in the content tree that no configured pack would compile.
 *
 * **"No configured pack claims it" is the whole of the question here**, and it
 * is a union: a note half of whose documents land is claimed, and passes
 * through untouched. That case is {@link unpackedDocumentFindings}, which asks
 * per document instead (#152). The two partition the tree on exactly this
 * condition, so no note is reported by both.
 *
 * Read-only: it walks the tree and reports, and writes nothing. Three kinds of
 * note are passed over, each for a stated reason rather than by omission — a
 * file with no frontmatter is not a note; a note with no `type:` is the
 * frontmatter linter's finding, which can say what a type is *for*; and a
 * retired type is answered by `assertTypeNotRetired` in `ids.mjs`, which names the
 * replacement.
 *
 * @param {object} [config] - The resolved build configuration. Defaults to this
 *   repository's.
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {readonly object[]} [opts.records] - The corpus, derived once by the
 *   compile and handed in — required, for the reason above (#243).
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "error", message: string, type: string}>} One finding per note.
 */
export function unclaimedNoteFindings(config = loadPackConfig(), sources, { records } = {}) {
    const resolved = resolveSources(sources);
    const claimed = claimedNoteTypes(config, resolved);
    const vocabulary = noteTypeVocabulary(resolved);
    const findings = [];

    // The corpus this compile derived once (#243), required rather than
    // derived here: this module is imported *by* the content index, so it
    // could not derive one without closing a cycle — and the caller that wants
    // this answer is running a compile and already holds it.
    assertSuppliedCorpus(records, "unclaimedNoteFindings");

    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const fm = authoredFrontmatter(record);
        const absPath = noteFile(config.paths.content, record);
        if (!fm) continue;
        const type = typeof fm.type === "string" ? fm.type.trim() : "";
        if (!type) continue;
        if (NEVER_PACKED_TYPES.has(type)) continue;
        if (DERIVED_PACKED_TYPES.has(type)) continue;
        if (RETIRED_TYPES[type]) continue;
        // A **renamed** spelling is a live type, not an unknown one: it resolves
        // to the same row, the same registry entry and the same pack. So the
        // claim is asked of the current spelling while the finding quotes the
        // authored one (#78). The rename itself is reported by the frontmatter
        // lint, which can say what to write instead.
        const current = currentType(type);
        if (claimed.has(current)) continue;

        findings.push({
            file: absPath,
            ...locateFrontmatterKey(absPath, "type", type),
            severity: /** @type {"error"} */ ("error"),
            type,
            message:
                // The unimplemented set is asked *first*: such a type is
                // absent from the configured vocabulary precisely because
                // nothing routes it, so the `vocabulary.has` branch would never
                // reach it — and reading its absence as the reason is the
                // inference {@link UNIMPLEMENTED_TYPES} exists to replace.
                UNIMPLEMENTED_TYPES.has(current) ? specifiedMessage(type)
                : vocabulary.has(current) ? configurationMessage(type, config, resolved)
                : Object.hasOwn(NOTE_VOCABULARY, current) ? specifiedMessage(type)
                : authoringMessage(type),
        });
    }
    return findings;
}

/* ---------------------------------------------------------------------- */
/*  The partial case: one document lands, another has nowhere to go (#152) */
/* ---------------------------------------------------------------------- */

/**
 * How a document a note produces reads in a sentence.
 *
 * A primary is named by its class, because the class is what the reader has to
 * declare a pack of. The documentation entry is named by what it *holds* as
 * well, because "no JournalEntry pack" beside an item note reads as though the
 * item itself were a journal — and the thing actually being lost is the prose
 * the author typed into that file.
 *
 * @param {{document: string, role: string}} produced - One produced document.
 * @returns {string} The phrase.
 */
function documentPhrase({ document, role }) {
    return role === "documentation" ?
            `${article(document)} ${document} holding its prose`
        :   `${article(document)} ${document}`;
}

/**
 * Why one document a note produces reaches no pack, and what closes the gap.
 *
 * Three answers, and the whole point of the check is that they are different
 * answers. Only the first two are things a consumer can act on in
 * `package-build.config.yaml`; naming that file for the third would send
 * someone to write a line that changes nothing.
 *
 * @param {object} args - Arguments.
 * @param {string} args.type - The note's declared `type`, authored spelling.
 * @param {{document: string, role: string}} args.produced - The lost document.
 * @param {boolean} args.hasPack - Whether any pack of the class is configured.
 * @returns {{reason: string, remedy: string}} The two halves of the sentence.
 */
function lostDocumentReason({ type, produced, hasPack }) {
    const { document, role } = produced;

    // Nothing here compiles the class at all, so the pack list is not where the
    // answer is. A system map is free to name any Foundry document, and the day
    // one names a `RollTable` the honest report is that this toolchain has no
    // pass for it — not an invitation to declare a pack that would then fail
    // the build with "no compiler for document type".
    if (!COMPILED_DOCUMENT_CLASSES.has(document)) {
        return {
            reason: `this toolchain compiles no ${document} at all — no pass produces one`,
            remedy:
                `No entry in \`packs:\` will change that; a ${document} pack ` +
                `would fail the build for want of a compiler. Stop authoring ` +
                `the type until a release compiles it.`,
        };
    }

    // The class has packs, and none of them claims this type. Today that is
    // always the item registry: every other claim set is fixed by the engine and
    // matches what {@link documentsProducedBy} derives, so a produced Actor,
    // JournalEntry, Macro, Scene or Adventure is claimed wherever a pack exists.
    // Derived rather than asserted, so a registry that grows a second dimension
    // is reported rather than mis-reported.
    if (hasPack) {
        const registry =
            document === "Item" ?
                ` — no \`itemBuilders\` registry declares "${type}", and the ` +
                `items pass compiles only what a registry declares`
            :   "";
        return {
            reason: `no configured ${document} pack claims "${type}"${registry}`,
            remedy:
                document === "Item" ?
                    `Declare "${type}" in an \`itemBuilders\` registry in ` +
                    `package-build.config.yaml, or stop authoring the type.`
                :   `Check the pack list in package-build.config.yaml.`,
        };
    }

    return {
        reason: `\`packs:\` declares no ${document} pack`,
        remedy:
            role === "documentation" ?
                `Declare one in package-build.config.yaml, or stop authoring ` +
                `prose on a "${type}" note — a note with an empty body compiles ` +
                `no documentation and loses nothing.`
            :   `Declare one in package-build.config.yaml, or stop authoring the type.`,
    };
}

/**
 * The finding for one document a note produces and this configuration drops.
 *
 * It says three things in order, because a reader who sees only the first is
 * owed the second: **what is lost**, **that the rest of the note compiled
 * anyway** — which is the reason nothing else reported it and the build
 * succeeded — and **what to do**.
 *
 * @param {object} args - Arguments.
 * @param {string} args.type - The note's declared `type`, authored spelling.
 * @param {{document: string, role: string}} args.produced - The lost document.
 * @param {readonly {document: string, role: string}[]} args.landed - The
 *   documents this note does compile.
 * @param {string} args.reason - Why it reaches no pack.
 * @param {string} args.remedy - What closes the gap.
 * @returns {string} The message.
 */
function unpackedMessage({ type, produced, landed, reason, remedy }) {
    // {@link list} quotes what it joins, which is right for a type name and
    // wrong for a phrase, so the prose list is joined here.
    const phrases = landed.map((d) => documentPhrase(d));
    const joined =
        phrases.length <= 1 ?
            phrases.join("")
        :   `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
    const rest =
        landed.length ?
            `It still compiles ${joined}, which is why the build reports no ` + `other error`
        :   `Nothing else this note produces compiles either, so it leaves no ` +
            `trace in any pack`;

    return (
        `a note of type "${type}" compiles into ${documentPhrase(produced)}, ` +
        `and this configuration has nowhere to put it: ${reason}. ${rest}. ${remedy}`
    );
}

/**
 * Every note in the content tree that compiles **less than all** of itself.
 *
 * One finding per lost document, naming the note, the document class and what
 * is missing — a pack, a registry entry, or a pass this toolchain does not
 * have.
 *
 * **A note nothing claims is passed over by name**, because that is #146's
 * finding and it says strictly more: it can distinguish a configuration gap
 * from an authoring mistake from an unimplemented type, and it names the whole
 * note rather than one of its documents. Reporting the same note twice, in two
 * vocabularies, is worse than either report alone — so the two checks partition
 * the tree on `claimedNoteTypes`, which is the one condition #146 fires on.
 *
 * **A note's body is read only once something is already known to be lost**,
 * and only for a doc-carrying note. Whether it holds prose decides both halves
 * of the report — a bodyless note neither loses a documentation entry nor
 * compiles one, and the second half is what stops the finding for its Scene
 * claiming that a journal compiled in its place. That fact is in the file and
 * not in the index, which records a documentation entry for every doc-carrying
 * note whatever its body holds. So the read is on the error path alone: a
 * configuration that puts every document somewhere opens no note here at all.
 *
 * Read-only, like {@link unclaimedNoteFindings}: it reports and writes nothing.
 *
 * @param {object} [config] - The resolved build configuration. Defaults to this
 *   repository's.
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {readonly object[]} [opts.records] - The corpus, derived once by the
 *   compile and handed in (#243).
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "error", message: string, type: string, document: string,
 *   role: "primary"|"documentation"}>} One finding per lost document.
 */
export function unpackedDocumentFindings(config = loadPackConfig(), sources, { records } = {}) {
    const resolved = resolveSources(sources);
    const claimed = claimedNoteTypes(config, resolved);
    // The document classes that have a pass behind them here. A **prebuilt**
    // pack is not one: its per-document JSON is checked in rather than
    // compiled, so no note is routed into it — the same exemption
    // {@link claimedNoteTypes} makes, and for the same reason.
    const configured = new Set(
        (config.packs ?? []).filter((pack) => !pack.prebuilt).map((pack) => pack.type),
    );
    const findings = [];

    assertSuppliedCorpus(records, "unpackedDocumentFindings");

    /**
     * Whether a document this note produces reaches a pass that compiles it.
     *
     * Both halves, because they fail apart: an Item pack with no `itemBuilders`
     * entry for the type is a configured pack that claims nothing, and counting
     * it would call the item compiled when it is not.
     *
     * @param {{document: string}} produced - One produced document.
     * @param {string} current - The note's type, current spelling.
     * @returns {boolean} True when the document lands somewhere.
     */
    const lands = ({ document }, current) =>
        configured.has(document) && noteTypesClaimedBy(document, resolved).has(current);

    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const fm = authoredFrontmatter(record);
        if (!fm) continue;
        const type = typeof fm.type === "string" ? fm.type.trim() : "";
        if (!type) continue;
        // The same three exemptions {@link unclaimedNoteFindings} makes, for the
        // same reasons: a homepage is in no pack by design, a folder reaches one
        // by a route of its own, and a retired type is answered by name
        // elsewhere.
        if (NEVER_PACKED_TYPES.has(type)) continue;
        if (DERIVED_PACKED_TYPES.has(type)) continue;
        if (RETIRED_TYPES[type]) continue;

        const current = currentType(type);
        // #146's note, reported there and not here — see above.
        if (!claimed.has(current)) continue;

        let produced = documentsProducedBy(type, resolved);
        if (produced.every((d) => lands(d, current))) continue;

        // The one place a body is needed, and only now that something is
        // already known to be lost. It is read whichever side of the note the
        // documentation entry falls on: a bodyless note does not *lose* one,
        // and it does not compile one either — and the second half is what
        // keeps the finding for its Scene from claiming a journal compiled in
        // its place.
        const absPath = noteFile(config.paths.content, record);
        if (produced.some((d) => d.role === "documentation")) {
            const { body } = parseMarkdownFile(absPath);
            if (!String(body ?? "").trim()) {
                produced = produced.filter((d) => d.role !== "documentation");
            }
        }

        const landed = produced.filter((d) => lands(d, current));
        const lost = produced.filter((d) => !lands(d, current));
        if (!lost.length) continue;

        const position = locateFrontmatterKey(absPath, "type", type);
        for (const one of lost) {
            findings.push({
                file: absPath,
                ...position,
                severity: /** @type {"error"} */ ("error"),
                type,
                document: one.document,
                role: /** @type {"primary"|"documentation"} */ (one.role),
                message: unpackedMessage({
                    type,
                    produced: one,
                    landed,
                    ...lostDocumentReason({
                        type,
                        produced: one,
                        hasPack: configured.has(one.document),
                    }),
                }),
            });
        }
    }
    return findings;
}
