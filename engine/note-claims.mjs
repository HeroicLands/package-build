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
 * note whose type nothing claims (#146).
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
 * @module
 */

import { walkMarkdownTree } from "./helpers.mjs";
import { JOURNAL_TYPES, MAP_TYPES, PACK_BY_TYPE, RETIRED_TYPES } from "./ids.mjs";
import { itemTypes } from "./item-registry.mjs";
import { docEntryTypes } from "./item-docs.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";
import { noteTypesFor, subtypeRow } from "./document-subtypes.mjs";
import { HOMEPAGE_TYPE } from "./homepage.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "../hm3/document-subtypes.mjs";

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
 * The note-type → document-subtype maps this toolchain ships.
 *
 * Two, since `hm3/` landed (#139) — and it joined this list rather than the
 * claim table below growing a second copy of the same fact, which is what the
 * list was for.
 *
 * The union is what makes the vocabulary wider than any one repository's
 * configuration: `armorlocation` is a real content type because HM3 maps it,
 * however a given repository is configured, so a tree full of them is a
 * repository that has not finished configuring itself rather than an author who
 * invented a word.
 *
 * `engine/` importing from `sohl/` is the arrangement `generate.mjs` already
 * has — its `COMPILERS` table names the SoHL compilers by class — and for the
 * same reason: the engine owns the *mechanism* that asks each system what it
 * compiles, and the systems own the answers.
 *
 * @type {readonly import("./document-subtypes.mjs").DocumentSubtypeMap[]}
 */
export const KNOWN_DOCUMENT_SUBTYPE_MAPS = Object.freeze([
    SOHL_DOCUMENT_SUBTYPES,
    HM3_DOCUMENT_SUBTYPES,
]);

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
 * @param {ClaimSources} [sources] - What to answer from. Defaults to the
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
 * @param {object} [config] - The resolved build configuration. Defaults to this
 *   repository's.
 * @param {ClaimSources} [sources] - What to answer from.
 * @returns {ReadonlySet<string>} The claimed note types.
 */
export function claimedNoteTypes(config = loadPackConfig(), sources) {
    const claimed = new Set();
    for (const pack of config.packs ?? []) {
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
    const documents = mappedDocuments(sources.maps, type);
    if (!documents.length && sources.itemTypes.has(type)) documents.push("Item");
    if (!documents.length && PACK_BY_TYPE[type]) documents.push(PACK_BY_TYPE[type].docType);

    const systems = mappingSystems(sources.maps, type);
    const configured = new Set((config.packs ?? []).map((pack) => pack.type));
    const packless = documents.filter((document) => !configured.has(document));
    const needsBuilder = documents.includes("Item") && !sources.itemTypes.has(type);

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
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "error", message: string, type: string}>} One finding per note.
 */
export function unclaimedNoteFindings(config = loadPackConfig(), sources) {
    const resolved = resolveSources(sources);
    const claimed = claimedNoteTypes(config, resolved);
    const vocabulary = noteTypeVocabulary(resolved);
    const findings = [];

    for (const { frontmatter: fm, absPath } of walkMarkdownTree(config.paths.content)) {
        if (!fm) continue;
        const type = typeof fm.type === "string" ? fm.type.trim() : "";
        if (!type) continue;
        if (NEVER_PACKED_TYPES.has(type)) continue;
        if (RETIRED_TYPES[type]) continue;
        if (claimed.has(type)) continue;

        findings.push({
            file: absPath,
            ...locateFrontmatterKey(absPath, "type", type),
            severity: /** @type {"error"} */ ("error"),
            type,
            message:
                vocabulary.has(type) ? configurationMessage(type, config, resolved)
                : Object.hasOwn(NOTE_VOCABULARY, type) ? specifiedMessage(type)
                : authoringMessage(type),
        });
    }
    return findings;
}
