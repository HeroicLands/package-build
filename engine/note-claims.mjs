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
 * **Which note types a configuration compiles at all** — the finding for a note
 * whose type nothing claims, and the one for a note that loses a
 * document while the rest of it compiles.
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
 * ## The partial case is a third condition, and it was invisible
 *
 * The table above asks whether a note is compiled *at all*, and a note that
 * compiles one of its two documents answers yes. But a note produces more than
 * one document as a matter of course — an item note an Item and the
 * JournalEntry its prose becomes, a map note a Scene and a JournalEntry, an
 * actor note an Actor and a JournalEntry since #337 — so a configuration
 * missing a pack for *one* of them dropped that document while the rest of the
 * note compiled into a pack that does exist. The build succeeded and shipped
 * half of what was written.
 *
 * | condition | what it means | whose fix |
 * | --- | --- | --- |
 * | some documents have a pack, one does not | this note compiles, and one of its documents is lost | configuration |
 *
 * {@link documentClassesFor} is the question this needs and the type-level
 * table could not answer: not "is anything claiming this note" but "which
 * documents does this note produce", asked per note, because documentation is
 * per note — a doc-carrying note with an empty body produces no JournalEntry at
 * all, and `Journals.skipNote` is where that is decided.
 *
 * ## The claim table mirrors `selects`, and a test holds them together
 *
 * Which note types a pass claims is stated by that pass's `selects`, and the
 * table below is a second statement of the same fact — the only form in which
 * the question can be asked of a pack that is *not* configured, which is exactly
 * the question here. `tests/unclaimed-note-types.test.ts` compares the two for
 * every type in the vocabulary, so the two statements cannot drift apart.
 *
 * @module
 */

import { assertSuppliedCorpus, parseMarkdownFile } from "./helpers.mjs";
// The record accessors only: this module is imported by the content index, so
// importing the index back would close a cycle.
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
 * holding a document that references it, and its ancestors with it. So
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
 *   compile and handed in — required, for the reason above. Defaults to the
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
        // The bundles pass: an Adventure is what a `bundle` note compiles into.
        // A **prebuilt** Adventure pack still claims nothing —
        // {@link claimedNoteTypes} passes over it, because no note is routed
        // into a pack whose JSON is checked in rather than compiled.
        case "Adventure":
            return Object.freeze(new Set([BUNDLE_TYPE]));
        default:
            return Object.freeze(new Set());
    }
}

/**
 * Every Foundry document class {@link noteTypesClaimedBy} answers for.
 *
 * The switch above, read the other way round. It is written out rather than
 * derived because a `switch` cannot be enumerated — and
 * `tests/unclaimed-note-types.test.ts` holds the two together by checking that
 * no class outside this list claims anything, so a row added there and not here
 * fails rather than going quiet.
 *
 * Order is the order a reader meets them in a message, not a precedence.
 *
 * @type {readonly string[]}
 */
export const CLAIMABLE_DOCUMENT_TYPES = Object.freeze([
    "Item",
    "Actor",
    "JournalEntry",
    "Macro",
    "Scene",
    "Adventure",
]);

/**
 * Every document class a note of one type compiles into.
 *
 * **A note produces more than one document, and that is the ordinary case.** An
 * item note compiles an Item *and* the JournalEntry its prose becomes; a map
 * note a Scene and a JournalEntry; since #337 an actor note an Actor and a
 * JournalEntry too. {@link claimedNoteTypes} unions over the configured packs
 * and so answers "is this note compiled *at all*", which is #146's question and
 * cannot see a note that compiles one of its two documents and loses the other.
 *
 * Asked of the **claim table** rather than of a list of its own, so the set of
 * documents a type produces and the set of passes that claim it are one
 * statement. A pass that starts claiming a type starts producing its document
 * here, with nothing to remember.
 *
 * **Union across systems, never per system.** A type one system maps and
 * another does not appears once, because the `Item` and `Actor` rows already
 * fold the maps together — so this cannot report a document class a system
 * deliberately declines to produce, which is the silence #79 requires.
 *
 * ## The JournalEntry row is the one that is per *note*
 *
 * Every other row is a property of the type: a `macro` note produces a Macro, a
 * map note a Scene, whatever either says. Documentation is not. `Journals`
 * declines a doc-carrying note whose body is empty — *"an item with no prose
 * gets no doc, and the items pass leaves its description empty rather than
 * pointing at nothing"* — so whether an item note produces a JournalEntry is
 * decided by the note, not by its type.
 *
 * That distinction is the whole difference between a useful finding and a
 * useless one. `sohl-kethira-basic` declares no JournalEntry pack and ships 393
 * notes whose descriptions are *deliberately* empty, under the Fan Material
 * Guidelines its configuration explains at length. A type-level answer would
 * report every one of them for losing a document none of them produces. Asking
 * per note, it reports none, and still reports `harn-ensemble`'s 2,517 beings,
 * whose `{#appearance}` and `{#dossier}` prose is real and is lost.
 *
 * `hasProse` is therefore how the caller answers that, and it is a **thunk** so
 * that the file is read only where the answer could change the outcome. Omitted,
 * the answer is the type's full potential — every document such a note *could*
 * produce — which is what a caller asking about a type rather than a note wants.
 *
 * @param {string} type - The note's declared `type`, current spelling.
 * @param {ClaimSources} [sources] - What to answer from.
 * @param {object} [opts] - Options.
 * @param {(() => boolean)|boolean} [opts.hasProse] - Whether *this note* carries
 *   a body. Omitted, the type's potential is reported.
 * @returns {string[]} The document classes, in {@link CLAIMABLE_DOCUMENT_TYPES}
 *   order. Empty for a type nothing compiles.
 */
export function documentClassesFor(type, sources, { hasProse } = {}) {
    const resolved = resolveSources(sources);
    return CLAIMABLE_DOCUMENT_TYPES.filter((docType) => {
        if (!noteTypesClaimedBy(docType, resolved).has(type)) return false;
        if (docType !== "JournalEntry") return true;
        // A type whose *whole* document is the journal always produces one;
        // there is no body condition, because the body is the document.
        if (JOURNAL_TYPES.has(type)) return true;
        if (hasProse === undefined) return true;
        return Boolean(typeof hasProse === "function" ? hasProse() : hasProse);
    });
}

/**
 * Whether a note carries a body at all — the condition `Journals.skipNote`
 * applies, asked from the outside.
 *
 * Read from the file rather than from the index record, because a record
 * carries a note's frontmatter and its derived address and not its prose. The
 * walk that calls this is already reading the same file to locate the `type:`
 * key for a finding's position, so this is the same cost in the same place —
 * and it is called only for a note whose documentation would otherwise be
 * reported as lost.
 *
 * @param {string} absPath - The note's path.
 * @returns {boolean} True when the body has content.
 */
function noteHasProse(absPath) {
    try {
        return Boolean(parseMarkdownFile(absPath).body);
    } catch {
        // Unreadable here means unreadable for the compile too, which reports
        // it with a message about the file rather than about its documentation.
        return false;
    }
}

/**
 * Every note type some pack in a configuration would compile.
 *
 * The union across the configured pack list, so a type claimed by any one pack
 * is claimed — which is what keeps a type deliberately unmapped for one system,
 * and claimed for another, silent.
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
 *   compile and handed in — required, for the reason above.
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
 *   compile and handed in — required, for the reason above.
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
    // them.
    const current = currentType(type);
    const documents = mappedDocuments(sources.maps, type);
    if (!documents.length && sources.itemTypes.has(current)) documents.push("Item");
    if (!documents.length && PACK_BY_TYPE[current]) documents.push(PACK_BY_TYPE[current].docType);

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
 * The **partial** finding: the note compiles, and one of its documents does not.
 *
 * #146's question is "does anything claim this note", and the answer is yes —
 * which is exactly why this went unreported. A note produces more than one
 * document, and a configuration missing a pack for one of them drops that
 * document while the rest of the note compiles into a pack that does exist. The
 * build succeeds, the compendium ships, and the missing half is discoverable
 * only by noticing it is not there.
 *
 * The message names the note, the document class with no pack, and the class
 * that *did* compile — the last because it is what distinguishes this from
 * #146's finding at a glance: the note is not unclaimed, it is half-claimed, and
 * the fix is a pack rather than a `type:`.
 *
 * @param {string} type - The note's declared `type`.
 * @param {readonly string[]} missing - Document classes with no pack.
 * @param {readonly string[]} compiled - Document classes that do have one.
 * @returns {string} The message.
 */
function partialMessage(type, missing, compiled) {
    // `Item`, `Actor` and `Adventure` take "an". Spelled out rather than left
    // to read as a typo in a message an author meets at the moment they are
    // being told something went wrong.
    const article = (name) => (/^[AEIOU]/.test(name) ? "an" : "a");
    const list = (classes) => classes.map((name) => `${article(name)} ${name}`).join(" and ");
    const names = (classes) => classes.join(" and ");
    return (
        `a note of type "${type}" compiles into ${list(missing)} as well as ` +
        `${list(compiled)}, and \`packs:\` declares no ${names(missing)} pack — ` +
        `so the ${names(missing)} is dropped with no error while the rest of the ` +
        `note compiles. Declare ${list(missing)} pack in ` +
        `package-build.config.yaml, or accept the loss deliberately by not ` +
        `authoring what it would have carried.`
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
 *   compile and handed in — required, for the reason above.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "error", message: string, type: string}>} One finding per note.
 */
export function unclaimedNoteFindings(config = loadPackConfig(), sources, { records } = {}) {
    const resolved = resolveSources(sources);
    const vocabulary = noteTypeVocabulary(resolved);
    const findings = [];
    // The document classes this configuration can actually receive a compiled
    // document into. A **prebuilt** pack is not one of them, for the reason
    // {@link claimedNoteTypes} states: its JSON is checked in, it has no pass,
    // and no note is routed into it.
    const configured = new Set((config.packs ?? []).filter((p) => !p.prebuilt).map((p) => p.type));

    // The corpus this compile derived once, required rather than
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
        // authored one. The rename itself is reported by the frontmatter
        // lint, which can say what to write instead.
        const current = currentType(type);

        // Every document this note produces, against the classes this
        // configuration has a pack for. Three outcomes, and the middle one is
        // #152's — it was invisible while the question was only "is anything
        // claiming this note", because the answer there is yes.
        const produces = documentClassesFor(current, resolved, {
            // Lazy: only a doc-carrying type whose JournalEntry has nowhere to
            // go asks, so a tree with a JournalEntry pack — which is most of
            // them — reads no bodies at all.
            hasProse: () => noteHasProse(absPath),
        });
        const missing = produces.filter((docType) => !configured.has(docType));
        const compiled = produces.filter((docType) => configured.has(docType));

        // Every document it produces has somewhere to go.
        if (produces.length && !missing.length) continue;

        // Some do and some do not: the note compiles, and one of its documents
        // is dropped in silence. A type nothing produces at all falls past this
        // to the #146 messages below, where `produces` being empty is itself
        // part of the answer.
        if (compiled.length) {
            findings.push({
                file: absPath,
                ...locateFrontmatterKey(absPath, "type", type),
                severity: /** @type {"error"} */ ("error"),
                type,
                message: partialMessage(type, missing, compiled),
            });
            continue;
        }

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
