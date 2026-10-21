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
 * **The link resolver.** One authored `[[…]]` is read the same way for every
 * target, and only the form it is written in differs: a Foundry journal gets
 * an `@UUID[…]{label}` content link, a web page a relative URL, the book a
 * cross-reference.
 *
 * Resolution is {@link resolveWikilinks}. It reads the link with the syntax
 * module, applies the rules every target shares — a link carries a label, a
 * same-page link names a section the page declares, a target is an address,
 * an address names one note — and hands back a {@link ResolvedLink}: what the
 * link names, independent of any target. The index a link is read against is a
 * {@link LinkView}, of the pack compile's index ({@link packLinkView}) or of
 * the site's ({@link siteLinkView}), and each target writes the resolution
 * through its {@link LINK_WRITERS} entry. {@link convertWikilinks} is the pack
 * compile's entry, {@link resolveWebWikilinks} the website's and the book's.
 *
 * `[[type-shortcode|Text]]` defaults to the readable `note` Address. A stated
 * game system names an Actor or Item; `none` names a systemless document.
 * `doc<type>` names an item's readable note. A link with an empty label
 * displays the target's current name.
 *
 * @module
 */

import { resolveShortcodeReference } from "./shortcode-references.mjs";

import crypto from "crypto";

import { compendiumUuid, ITEM_PACK, packForType, pageUuid, PACK_BY_TYPE } from "./ids.mjs";
import { expandAddress, readCanonicalKey } from "./content-address.mjs";
// The address grammar. A wikilink *contains* an Address, so what counts as one
// is stated there and read here — the anchor and the label are this module's,
// and the tuple inside them is not.
import {
    readQualifier,
    resolveItemDocType,
    parseAddress,
    renderAddress,
    completeAddress,
    ownDocumentSystem,
} from "./address.mjs";
import { collectAnchors } from "./anchors.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { resolveEmbeds } from "./content-embeds.mjs";
// One slug rule for the whole build — see `./content-slug.mjs`.
import { slugify } from "./content-slug.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";
import { hasDocEntry, itemDocEntryId } from "./item-docs.mjs";
import { replaceOutsideCode } from "./code-fences.mjs";
// The syntax lives in `./wikilink-syntax.mjs`, beside the vocabulary of link
// findings and the message for each, which the link checker reads too.
import {
    LINK_FINDING_REASONS,
    WIKILINK,
    authoredLabel,
    isEventAnchor,
    isSamePage,
    presentWikilink,
    readWikilink,
} from "./wikilink-syntax.mjs";

/** The heading and anchor slug: the rule that names a page names a section. */
export { slugify };

export { ITEM_PACK, PACK_BY_TYPE, packForType };

/**
 * The address grammar, under the names the link readers hold it by.
 *
 * {@link readQualifier} reads a link target as the partial Address the matchers
 * consume, and {@link resolveItemDocType} is the `doc<type>` reading it applies.
 */
export { readQualifier, resolveItemDocType };

const norm = (s) => String(s).toLowerCase().trim();

/**
 * The deterministic JournalEntryPage id for one anchor: SHA-256 of
 * `"<noteId>-<anchorSlug>"`, base64-encoded, reduced to the 16 alphanumeric
 * characters a Foundry id allows.
 *
 * Base64's `+`, `/`, and `=` are **not** legal in a Foundry document id
 * (`/^[A-Za-z0-9]{16}$/`), so they are dropped before the first 16 characters
 * are taken — the value stays a pure function of its two inputs, which is what
 * lets the link and the page be computed independently.
 *
 * @param {string} noteId - The owning JournalEntry's `_id`.
 * @param {string} anchorSlug - The slug declared by `{#slug}` on the heading.
 * @returns {string} A 16-character alphanumeric id.
 */
export function anchorPageId(noteId, anchorSlug) {
    return crypto
        .createHash("sha256")
        .update(`${noteId}-${anchorSlug}`)
        .digest("base64")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 16);
}

/**
 * Builds the link-resolution tables for a content tree.
 *
 * @param {Array<{type: string, id: string, shortcode?: string|null,
 *   name?: string, pack?: string, docPack?: string, none?: boolean,
 *   draft?: boolean, anchors?: Set<string>, eventAnchors?: Set<string>,
 *   anchorUuids?: Record<string,string>, docAnchorUuids?: Record<string,string>}>} docs -
 *   One entry per content note. `pack` / `docPack` name the packs the note's
 *   document and its documentation entry landed in; omitted, the conventional
 *   one-pack-per-type names stand in. `none` says the note declares
 *   `pack: none` and compiles into no document, so it has no UUID to link to.
 *   `draft` says the note carries the `draft` tag, which marks links *into* it
 *   and changes nothing else.
 * @param {string} packageId - The Foundry package shipping the packs; the first
 *   segment of every emitted UUID.
 * @param {Map<string, object>} [foreign] - Canonically keyed entries from
 *   vendored manifests of packages this build links into but does not publish.
 * @param {string} [contentPackage] - This build's *content* package, which an
 *   authored address may name explicitly. Defaults to `packageId`.
 * @param {object} [opts] - Options.
 * @param {Map<string, object>} [opts.assets] - The files this package ships, by
 *   canonical address. They resolve no link — an asset is not a document — and
 *   answer only the art fields, which name a file and never a document.
 * @param {Set<string>} [opts.noIndexPackages] - Packages declared
 *   `contentIndex: false` — a Foundry dependency only. A link naming one fails
 *   with `no-content-index` rather than resolving, ambiguously, as either a
 *   typo or an undeclared package.
 * @param {Map<string, object>} [opts.referenceTargets] - Local reference targets.
 * @param {Map<string, object>} [opts.foreignReferences] - Foreign reference targets.
 * @returns {{byShortcode: Map<string, object>, types: Set<string>}} `types` is
 *   every type the tree actually contains, so a qualifier naming no real type
 *   can be told apart from a missing target.
 */
export function buildWikilinkIndex(
    docs,
    packageId,
    foreign,
    contentPackage,
    { assets, noIndexPackages, referenceTargets, foreignReferences } = {},
) {
    if (!packageId) {
        throw new Error(
            "buildWikilinkIndex: packageId is required — it is the first " +
                "segment of every emitted UUID, and defaulting it is how links " +
                "came to address the wrong package.",
        );
    }

    const byShortcode = new Map();
    // The **asset** types join unconditionally, whether or not this tree holds
    // a file of each: they are a closed vocabulary rather than a census of what
    // was found, and an art field hands the resolver `icon-<shortcode>` whose
    // type has to parse before anything can be looked up.
    const types = new Set(ASSET_TYPE_NAMES);

    // Each note's address is computed once, here, and every reference to it is
    // that stored value. Nothing downstream assembles a UUID from parts, so a
    // link and its target cannot disagree about where the document lives.
    const uuidByDoc = new Map();
    const byId = new Map();

    for (const d of docs) {
        if (!d.id || !d.type) continue;
        byId.set(`${d.type}/${d.id}`, d);
        types.add(norm(d.type));

        uuidByDoc.set(
            d,
            // A note with no single Foundry document has no compendium UUID:
            // a link to it retains its label in a journal. Keep the indexed
            // address so the link resolves without a dead-link finding.
            d.none ?
                { uuid: undefined, docUuid: undefined }
            :   {
                    // `d.pack` is where this note's document actually landed,
                    // resolved by the pack router when the index was
                    // collected. A repository may ship several packs of one
                    // type and a UUID carries the pack name, so the address
                    // cannot be derived from the type alone.
                    uuid: compendiumUuid(packageId, d.type, d.id, d.pack),
                    anchors: d.anchorUuids,
                    docAnchors: d.docAnchorUuids,
                    // The readable note has a separate JournalEntry whose id
                    // is derived from the item's id.
                    docUuid: compendiumUuid(packageId, "doc", itemDocEntryId(d.id), d.docPack),
                },
        );

        if (d.shortcode) byShortcode.set(`${norm(d.type)}/${norm(d.shortcode)}`, d);
    }
    // Entries published by *other* packages, keyed canonically. Merged as one
    // map rather than consulted separately: the keys are globally unique, so a
    // foreign address resolves exactly like a local one and there is no
    // precedence rule to get wrong. A foreign package's types are added to
    // `types` too — without that, its addresses read as prose and silently lose
    // their link.
    const foreignByKey = new Map(foreign ?? []);
    const foreignTypes = [];
    for (const v of foreignByKey.values()) {
        if (v.type) foreignTypes.push(norm(v.type));
    }
    for (const t of foreignTypes) types.add(t);

    // Every package an address may name: this one, plus every package a
    // vendored manifest speaks for. What lets `thalorna-creature-grkrahk` be
    // read as an address at all.
    const packages = new Set([contentPackage ?? packageId]);
    for (const v of foreignByKey.values()) {
        if (v.package) packages.add(v.package);
    }

    return {
        byShortcode,
        referenceTargets,
        foreignReferences,
        types,
        uuidByDoc,
        byId,
        packageId,
        /** The content package this build publishes, which an art address defaults to. */
        contentPackage: contentPackage ?? packageId,
        packages,
        foreign: foreignByKey,
        /** The files this package ships, by canonical address. */
        assets: assets ?? new Map(),
        /** Packages declared `contentIndex: false`, a Foundry dependency only. */
        noIndexPackages: noIndexPackages ?? new Set(),
    };
}

/**
 * The foreign manifest entry an address names, or `null`.
 *
 * A target is a **partial** address, matched on the segments it supplies with
 * the rest wildcarded — so a package-qualified one is a scan rather than
 * a single lookup, and may still match one entry per system. An unqualified one
 * names no package either, so it resolves against whichever foreign package
 * publishes it — and, in both readings, only when exactly one entry matches.
 * Claimed by two, it is genuinely ambiguous and the author writes the qualified
 * form; guessing would make the build depend on which manifest happened to load
 * first.
 *
 * @param {object} index - From {@link buildWikilinkIndex}.
 * @param {object|null} read - The parsed qualifier, or `null` when the target
 *   did not parse as an address.
 * @returns {object|null} The manifest entry.
 */
function findForeign(index, read) {
    const hits = foreignHits(index, read);
    return hits.length === 1 ? hits[0] : null;
}

/**
 * Every foreign manifest entry an address names.
 *
 * The count is what separates *nothing publishes this* from *two packages do*,
 * and those are different findings with different fixes, so the caller
 * gets the list rather than a single answer that has already collapsed the
 * distinction.
 *
 * @param {object} index - From {@link buildWikilinkIndex}.
 * @param {object|null} read - The parsed qualifier, or `null` when the target
 *   did not parse as an address.
 * @returns {object[]} The manifest entries.
 */
function foreignHits(index, read) {
    if (!read || read.reason || !index.foreign?.size) return [];
    const tuple = completeAddress(read, { package: index.contentPackage, system: NOTE_SYSTEM });
    const wanted = norm(tuple.type);
    const shortcode = read.shortcode;

    // **An omitted package means this package**, so a short form
    // addresses nothing foreign and never reaches a dependency's index. A link
    // that resolved into another package only because no local note claimed the
    // address was resolving by accident, and would have retargeted silently the
    // day one did. Reaching another package is the fully qualified form's job.
    //
    // The system likewise comes from where the link is written — `none` in a
    // body — so both segments are known here and this is an exact lookup rather
    // than a filter. That is what makes a cross-package `ambiguous` impossible:
    // one key, one entry.
    if (!read.package) return [];
    const wantedSystem = norm(tuple.system);
    const hits = [];
    for (const [key, entry] of index.foreign) {
        const parts = readCanonicalKey(key);
        if (!parts) continue;
        if (parts.package !== norm(read.package)) continue;
        if (parts.system !== wantedSystem) continue;
        if (parts.type !== wanted || parts.shortcode !== shortcode) continue;
        hits.push(entry);
    }
    return hits;
}

/**
 * What a `shortcode-not-lowercase` finding carries: the shortcode as written,
 * and the lowercase spelling when a local note or a fetched dependency declares
 * it.
 *
 * @param {object} index - From {@link buildWikilinkIndex}.
 * @param {{shortcode: string, lowercase: object}} problem - The reader's verdict.
 * @returns {{shortcode: string, declared?: string}} The finding's fields.
 */
function shortcodeCase(index, problem) {
    const read = problem.lowercase;
    const local =
        (read.package ?? index.contentPackage) === index.contentPackage &&
        index.byShortcode?.has(
            `${resolveItemDocType(read.type, index.types) ?? read.type}/${read.shortcode}`,
        );
    const declared = local || foreignHits(index, read).length > 0;
    return { shortcode: problem.shortcode, ...(declared ? { declared: read.shortcode } : {}) };
}

/**
 * A wikilink once it is resolved, before any target writes it.
 *
 * This is the link's **neutral form**: what it names and how it reads, with no
 * target's syntax in it. Each target writes it through its own
 * {@link LINK_WRITERS} entry, so one authored link reaches a Foundry journal as
 * an `@UUID` content link, a web page as a relative URL and the book as a
 * cross-reference, from the same resolution.
 *
 * @typedef {object} ResolvedLink
 * @property {"link"|"text"|"unresolved"} kind - `link`: the target has a
 *   destination the reader can open. `text`: the address is real and names a
 *   note with nothing to open — a note with no single Foundry document, or one
 *   a package publishing no pages holds — so the reader gets the words.
 *   `unresolved`: the link is a finding, and the words are kept, marked.
 * @property {string} text - What the reader sees.
 * @property {string} literal - The link exactly as authored.
 * @property {string} target - The target as authored, `""` for a link to a
 *   section of the same page.
 * @property {string} anchor - The `#section` named, `""` when none.
 * @property {boolean} samePage - Whether it names a section of its own page.
 * @property {string|undefined} address - The canonical address it names, the
 *   same on every target; `undefined` for a same-page link and for a target
 *   that is not an address.
 * @property {string} [uuid] - The Foundry document or page it opens.
 * @property {string} [href] - The URL it opens on the web and in the book,
 *   fragment included.
 * @property {boolean} draft - Whether it names a note tagged `draft`.
 * @property {object} [destination] - What it resolved to: an index entry,
 *   which decides whether the reference is concealed.
 * @property {object} parsed - The link's parts, from {@link readWikilink}.
 * @property {object} [finding] - For `unresolved`, what is wrong: a `reason`
 *   from {@link LINK_FINDING_REASONS}, the `target` the message names, and the
 *   fields that reason carries.
 */

/**
 * How an **unresolved** link renders on a page, in Foundry and on the web.
 *
 * The author's text is kept, so the sentence still reads — dropping it would
 * silently rewrite the prose. It is marked so a reader can tell that something
 * was meant to be a link, and a maintainer can find it: the appearance lives in
 * `scss/components/_unresolved-link.scss` and in the site theme, not here.
 *
 * The web page renders raw HTML, so escaping is obligatory: this is the one
 * path where *authored* text becomes markup rather than content.
 *
 * @param {string} text - The text to show, from the link's label or target.
 * @param {string} target - The address that resolved nowhere, for the tooltip.
 * @returns {string} An HTML span. The markdown renderers pass raw HTML through.
 */
function unresolvedLink(text, target) {
    const esc = (v) =>
        String(v)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    return (
        `<span class="sohl-unresolved-link" title="Unresolved link: ` +
        `${esc(target)}">${esc(text)}</span>`
    );
}

/**
 * How a link to a **draft** note renders, in Foundry and on the web.
 *
 * A note tagged `draft` exists so a link into it is not dead, and nothing more.
 * Unmarked, a reader follows a promising link into an empty page and an author
 * cannot see which of their links still owe content.
 *
 * **The wrapper carries the cue and nothing else.** The link itself is
 * untouched — Foundry enriches inside HTML, so the `@UUID` still becomes a live
 * content link, and the note is in the packs, the manifest and the index
 * exactly as any other. The appearance lives in
 * `scss/components/_draft-link.scss` and in the site theme, not here.
 *
 * The argument is already-built markup and is deliberately not escaped; the
 * *authored* text inside it was escaped, or made into a link, by the writer
 * that called this.
 *
 * @param {string} inner - The resolved link, as the target writes it.
 * @returns {string} An inline HTML span wrapping it.
 */
function draftLink(inner) {
    return `<span class="sohl-draft-link" title="Draft — not yet written">${inner}</span>`;
}

/**
 * How each target writes a {@link ResolvedLink}.
 *
 * | | `foundry` | `web` | `book` |
 * | --- | --- | --- | --- |
 * | a link | `@UUID[…]{text}`, a content link that survives import into a world | `[text](url)`, the page's relative URL | `[text](url)`, which the book sets as a cross-reference to the entry it prints, or as the page's address where it prints none |
 * | a draft target | the link in a `sohl-draft-link` span | the same span | the link, then `(draft)` |
 * | nothing to open | the text | the text, marked when the target is a draft | the text, then `(draft)` when the target is one |
 * | unresolved | the text in a `sohl-unresolved-link` span | the same span | the text, then `(unresolved link)` |
 *
 * A link to a GM-only note, or to a secret section, is concealed by
 * {@link presentWikilink} on every target alike.
 *
 * Foundry does not mark a link to a note another package publishes as a
 * draft: its `@UUID` names the document the dependency installed, and the
 * dependency's journal is what the reader opens.
 *
 * @type {Readonly<Record<"foundry"|"web"|"book", (link: ResolvedLink) => string>>}
 */
export const LINK_WRITERS = Object.freeze({
    foundry(link) {
        if (link.kind === "unresolved") return unresolvedLink(link.text, link.finding.target);
        if (link.kind === "text") return presentWikilink(link.text, link.parsed, link.destination);
        const reference = `@UUID[${link.uuid}]{${link.text}}`;
        return presentWikilink(
            link.draft ? draftLink(reference) : reference,
            link.parsed,
            link.destination,
        );
    },
    web(link) {
        if (link.kind === "unresolved") return unresolvedLink(link.text, link.finding.target);
        const reference = link.kind === "link" ? `[${link.text}](${link.href})` : link.text;
        return presentWikilink(
            link.draft ? draftLink(reference) : reference,
            link.parsed,
            link.destination,
        );
    },
    book(link) {
        if (link.kind === "unresolved") return `${link.text} (unresolved link)`;
        const reference = link.kind === "link" ? `[${link.text}](${link.href})` : link.text;
        return presentWikilink(
            link.draft ? `${reference} (draft)` : reference,
            link.parsed,
            link.destination,
        );
    },
});

/**
 * What one index answers a link with: the half of resolution that depends on
 * which index is read. A pack compile reads {@link buildWikilinkIndex}'s
 * index and answers with UUIDs ({@link packLinkView}); the website and the
 * book read the site index and answer with URLs ({@link siteLinkView}).
 * Everything else — the syntax, the label rule, which failure is which, and
 * the order the checks run in — is {@link resolveWikilinks}'s, once.
 *
 * @typedef {object} LinkView
 * @property {object} context - The Address context a target is read in:
 *   `{package, system, types, packages, noIndexPackages}`.
 * @property {(markdown: string) => object} self - The page the link is written
 *   on, as a destination.
 * @property {(read: object, target: string) => ({destination: object,
 *   itemDoc?: boolean, foreign?: boolean}|{ambiguous: true, packages?:
 *   string[]}|undefined)} find - What an address names: a destination, which
 *   may be an item's readable note or another package's note; a claim by more
 *   than one package; or nothing.
 * @property {(read: object, target: string) => boolean} collides - Whether a
 *   target that is not an address is a short address two packages claim.
 * @property {(read: object) => boolean} declared - Whether a lowercase
 *   spelling of the shortcode names a note.
 * @property {(destination: object, anchor: string, how: {samePage: boolean,
 *   itemDoc?: boolean, foreign?: boolean}) => {reason?: string, uuid?: string, href?: string,
 *   draft?: boolean}} locate - Where a destination opens: a finding reason
 *   when the anchor does not belong to it, the UUID or URL it opens, or
 *   neither when there is nothing to open.
 */

/**
 * The reasons a target can fail to parse for, as a finding names them. A
 * reason the address grammar gives that the finding vocabulary has no entry
 * for means the target is not an address.
 *
 * @param {string|undefined} reason - The address grammar's reason.
 * @returns {string} A reason from {@link LINK_FINDING_REASONS}.
 */
function parseFailure(reason) {
    return (
            reason &&
                reason !== "unresolved" &&
                reason !== "ambiguous" &&
                LINK_FINDING_REASONS.has(reason)
        ) ?
            reason
        :   "not-an-address";
}

/**
 * Resolve one authored wikilink against a view of an index.
 *
 * @param {string} literal - The whole link, as authored.
 * @param {string} rawInner - Its interior.
 * @param {LinkView} view - The index's answers.
 * @param {object} opts
 * @param {string} opts.markdown - The text the link sits in.
 * @param {Map<string, string>} [opts.captionLabels] - Numbered caption labels
 *   by anchor, which an empty-labelled link to a figure on its own page shows.
 * @returns {ResolvedLink} The resolution.
 */
function resolveWikilink(literal, rawInner, view, { markdown, captionLabels }) {
    const parsed = readWikilink(rawInner, view.context, literal);
    const target = parsed.rawTarget;
    const anchor = parsed.anchor || "";
    // An empty label is not a label: `[[x|]]` addresses the target and shows
    // its name. One reading, from {@link authoredLabel}.
    const label = authoredLabel(parsed);
    const samePage = isSamePage({ target, anchor });
    const read = samePage ? null : (parsed.problem ?? parsed.target);
    const base = {
        literal,
        target,
        anchor,
        samePage,
        address: read && !read.reason ? renderAddress(read) : undefined,
        parsed,
        draft: false,
    };
    const unresolved = (finding, text) => ({
        ...base,
        kind: "unresolved",
        text,
        finding: { target, ...finding },
    });

    if (parsed.attributes?.problems.length)
        return unresolved(
            { reason: "invalid-attributes", problems: parsed.attributes.problems },
            label ?? target,
        );

    // **Every link carries a label**. Without one there is nothing to resolve
    // against, and nothing to show either, a shortcode being an address rather
    // than prose. Reported before the same-page form, because the rule is
    // about how the link is *written*: `[[#slug]]` needs the pipe exactly as
    // `[[skill-clmb]]` does.
    if (!parsed.labelled)
        return unresolved({ target: parsed.inner, reason: "unlabelled" }, parsed.inner);

    let found;
    if (samePage) {
        found = { destination: view.self(markdown) };
    } else {
        // A target that does not parse as an address is a defect: there is no
        // second namespace left to fall through to.
        if (!read || read.reason) {
            if (view.collides(read, target))
                return unresolved({ reason: "ambiguous" }, label ?? target);
            // A capital in the shortcode is refused, never lowercased. The
            // lowercase spelling is looked up only to name it in the finding.
            if (read?.reason === "shortcode-not-lowercase")
                return unresolved(
                    {
                        reason: "shortcode-not-lowercase",
                        shortcode: read.shortcode,
                        ...(view.declared(read.lowercase) ?
                            { declared: read.lowercase.shortcode }
                        :   {}),
                    },
                    label ?? target,
                );
            return unresolved({ reason: parseFailure(read?.reason) }, label ?? target);
        }
        found = view.find(read, target);
        // Two packages publish the short address, so it names neither. Its own
        // class: the fix is the package-qualified form, not a corrected
        // shortcode.
        if (found?.ambiguous)
            return unresolved(
                {
                    reason: "ambiguous",
                    ...(found.packages ? { packages: found.packages } : {}),
                },
                label ?? target,
            );
        // An address that resolves nowhere is a typo or an undeclared
        // dependency: every package it could name is either built here or
        // fetched, so there is no third possibility left.
        if (!found) return unresolved({ reason: "unresolved" }, label ?? target);
    }

    const { destination, itemDoc, foreign } = found;
    // An address with an *empty* label has no prose to show, a shortcode not
    // being display text, so the target's **current** name stands in and a
    // rename shows at every citation with no link edited. A link to a
    // captioned item on its own page shows the item's number.
    const named =
        samePage ?
            (captionLabels?.get(anchor) ?? destination.name ?? anchor)
        :   (destination.name ?? target);
    const located = view.locate(destination, anchor, { samePage, itemDoc, foreign });
    if (located.reason)
        return unresolved(
            { reason: located.reason, anchor },
            label ?? (samePage ? anchor : (destination.name ?? target)),
        );
    const text = label ?? named;
    const opens = located.uuid ?? located.href;
    return {
        ...base,
        kind: opens === undefined ? "text" : "link",
        text,
        ...(located.uuid !== undefined ? { uuid: located.uuid } : {}),
        ...(located.href !== undefined ? { href: located.href } : {}),
        // A link into a note that exists but is not written renders marked.
        // Presentation only — the address is unchanged — and a link to a
        // section of its own page is not marked, because the reader is already
        // in the note it would be telling them about.
        draft: !samePage && Boolean(located.draft),
        destination,
    };
}

/**
 * Resolve every wikilink in a markdown body, and write each in one target's
 * form.
 *
 * The one link resolver. The two indexes a link is read against differ, and
 * only that differs, so the index is a {@link LinkView} and the target a
 * writer: {@link convertWikilinks} and {@link resolveWebWikilinks} are this,
 * with their own view and writer.
 *
 * **Code is verbatim.** A `[[…]]` inside a fenced or indented code block, or
 * inside an inline code span, is source text an author wrote to be read as
 * written, so it is left alone and not reported. Without that, a script sample
 * containing `grid[[0]]` would become a link — and only for some array shapes,
 * `[[1,2],[3,4]]` having an inner `]` the pattern cannot cross.
 *
 * **Every failure is a finding**, classified into the vocabulary
 * {@link LINK_FINDING_REASONS} names for every reader of a link. A finding
 * keeps the link's `offset` in `markdown` and its `occurrence` — the how-many-th
 * finding on that literal — so a caller can report the line and column it sits
 * on by either.
 *
 * @param {string} markdown - The body.
 * @param {object} opts
 * @param {LinkView} opts.view - The index the links resolve against.
 * @param {(link: ResolvedLink) => string} opts.write - The target's writer,
 *   from {@link LINK_WRITERS}.
 * @param {Map<string, string>} [opts.captionLabels] - Numbered caption labels.
 * @returns {{markdown: string, links: ResolvedLink[], findings: Array<{link:
 *   string, offset: number, occurrence: number, target: string, reason:
 *   string}>, resolved: object[]}} The written body; every link in body order;
 *   the findings; and every destination a link outside its own page resolved
 *   to, in body order, repeats included — the page's edges.
 */
export function resolveWikilinks(markdown, { view, write, captionLabels }) {
    const links = [];
    const findings = [];
    const resolved = [];
    const seen = new Map();
    const source = String(markdown ?? "");
    // `offset` is the third replacer argument because the pattern has exactly
    // one capture group. It is what makes two identical links on one note
    // tellable apart, and a position reportable at all.
    const out = replaceOutsideCode(source, WIKILINK, (literal, rawInner, offset) => {
        const link = resolveWikilink(literal, rawInner, view, { markdown: source, captionLabels });
        links.push(link);
        if (link.finding) {
            const occurrence = (seen.get(literal) ?? 0) + 1;
            seen.set(literal, occurrence);
            findings.push({ link: literal, offset, occurrence, ...link.finding });
        } else if (!link.samePage) resolved.push(link.destination);
        return write(link);
    });
    return { markdown: out, links, findings, resolved };
}

/**
 * The pack compile's view of a link: {@link buildWikilinkIndex}'s index,
 * answered with compendium UUIDs.
 *
 * `[[type-shortcode|Text]]` defaults to the readable `note` Address. A stated
 * game system names an Actor or Item; `none` names a systemless document.
 * `doc<type>` names the readable note of an item. A journal link may carry a
 * heading anchor, which addresses the journal's page for it; an Actor, Item or
 * Macro link opens a sheet, which has no sections, so its anchor addresses
 * nothing and is dropped.
 *
 * @param {object} index - From {@link buildWikilinkIndex}.
 * @param {object} source - The note the links are written on.
 * @param {string} source.type - Its type.
 * @param {string} source.id - Its document id.
 * @param {string} [source.pack] - The pack its own document lands in.
 * @param {string} [source.docPack] - The pack its documentation entry lands in.
 * @returns {LinkView} The view.
 */
export function packLinkView(index, { type, id, pack, docPack }) {
    return {
        context: {
            package: index.contentPackage,
            system: NOTE_SYSTEM,
            types: index.types,
            packages: index.packages,
            noIndexPackages: index.noIndexPackages,
        },
        // The one target with no index entry of its own may be the note
        // itself, so its own type, id and packs stand in for one.
        self: () => index.byId?.get(`${type}/${id}`) ?? { type, id, pack, docPack },
        find(read) {
            // Ordinary wikilinks default to readable note content.
            const baseType = resolveItemDocType(read.type, index.types);
            const address = completeAddress(read, {
                package: index.contentPackage,
                system: NOTE_SYSTEM,
            });
            const itemDoc = address.system === NOTE_SYSTEM && hasDocEntry(baseType ?? read.type);
            const local =
                read.package === index.contentPackage ?
                    index.byShortcode.get(`${baseType ?? read.type}/${read.shortcode}`)
                :   undefined;
            if (local) return { destination: local, itemDoc };
            // Nothing local answers. A foreign package may publish this
            // address, in which case its manifest hands back a complete UUID —
            // including, for a section link, the anchor's own.
            const hits = foreignHits(index, read);
            if (hits.length > 1)
                return { ambiguous: true, packages: hits.map((h) => h.package).filter(Boolean) };
            return hits.length ? { destination: hits[0], foreign: true } : undefined;
        },
        collides: () => false,
        declared: (read) =>
            Boolean(shortcodeCase(index, { shortcode: "", lowercase: read }).declared),
        locate(doc, anchor, { itemDoc = false, foreign = false } = {}) {
            if (foreign) {
                if (anchor && isEventAnchor(doc, anchor)) return { reason: "event-anchor" };
                const uuid = anchor ? doc.anchors?.[anchor] : doc.uuid;
                return uuid ? { uuid } : { reason: "unknown-anchor" };
            }
            // Both addresses were computed when the target was indexed. An
            // item's readable note lives in the journals pack under its own
            // derived entry id, and its pages hash against *that* id.
            const addresses = index.uuidByDoc.get(doc) ?? {
                uuid: compendiumUuid(index.packageId, doc.type, doc.id, doc.pack),
                docUuid: compendiumUuid(
                    index.packageId,
                    "doc",
                    itemDocEntryId(doc.id),
                    doc.docPack,
                ),
            };
            const entryUuid = itemDoc ? addresses.docUuid : addresses.uuid;
            // The target has no single Foundry document. Its address is real,
            // but a compendium has nothing to open, so the reader gets the
            // label.
            if (entryUuid === undefined) return {};
            const entryId = itemDoc ? itemDocEntryId(doc.id) : doc.id;
            const isJournal = itemDoc || packForType(doc.type).docType === "JournalEntry";
            const anchorUuids = itemDoc ? addresses.docAnchors : addresses.anchors;
            // A wikilink names a prose anchor; an event's id is refused here,
            // before any surface renders a link to it.
            if (anchor && isEventAnchor(doc, anchor)) return { reason: "event-anchor" };
            // A `#section` the target declares no heading for. Checked here
            // because this is the build that *emits* the link:
            // `anchorPageId` hashes any slug into a page id, so an undeclared
            // one compiles to a `@UUID` that dead-ends for the reader.
            if (
                anchor &&
                isJournal &&
                ((doc.anchors && !doc.anchors.has(anchor)) ||
                    (anchorUuids && !Object.hasOwn(anchorUuids, anchor)))
            )
                return { reason: "unknown-anchor" };
            return {
                uuid:
                    anchor && isJournal ?
                        (anchorUuids?.[anchor] ??
                        pageUuid(entryUuid, anchorPageId(entryId, anchor)))
                    :   entryUuid,
                draft: Boolean(doc.draft),
            };
        },
    };
}

/**
 * Rewrites every wikilink in a markdown body as a Foundry UUID enricher — see
 * {@link resolveWikilinks}, with the pack compile's {@link packLinkView} and
 * the `foundry` {@link LINK_WRITERS} entry.
 *
 * A link that cannot be resolved renders marked and is reported in
 * `unresolved`.
 *
 * @param {string} markdown - The note body (frontmatter already stripped).
 * @param {object} ctx
 * @param {string} ctx.type - The source note's `type`, which addresses a
 *   `[[#slug]]` self-link.
 * @param {string} ctx.id - The source note's document id.
 * @param {string} [ctx.pack] - The pack the source note's own document landed
 *   in, which addresses a `[[#slug]]` self-link — the one target with no index
 *   entry.
 * @param {string} [ctx.docPack] - The pack the source note's documentation
 *   entry landed in.
 * @param {{byShortcode: Map, types: Set}} ctx.index - From
 *   {@link buildWikilinkIndex}.
 * @param {Map<string, string>} [ctx.captionLabels] - Numbered caption references.
 * @returns {{markdown: string, links: ResolvedLink[], unresolved: Array<{link:
 *   string, target: string, offset: number, reason: string, packages?:
 *   string[], anchor?: string}>}} Each `reason` is one of
 *   {@link LINK_FINDING_REASONS} — `ambiguous` carries the claiming `packages`
 *   and `unknown-anchor` the section it named. `offset` is the link's 0-based
 *   position in `markdown`, which is what lets a caller report the line and
 *   column it sits on.
 */
export function convertWikilinks(markdown, { type, id, pack, docPack, index, captionLabels }) {
    const result = resolveWikilinks(markdown, {
        view: packLinkView(index, { type, id, pack, docPack }),
        write: LINK_WRITERS.foundry,
        captionLabels,
    });
    return {
        markdown: result.markdown,
        links: result.links,
        unresolved: result.findings.map(({ occurrence, ...finding }) => finding),
    };
}

/**
 * Resolve one reference against a compile's address index.
 *
 * The compile-time counterpart of
 * {@link module:engine/site-index.resolveInfoboxRef}: the same three authored
 * forms — a bare shortcode, a short address, a canonical one — answered with
 * what a **compendium** can use. A local target answers with the UUID its own
 * document was addressed by; a foreign one with the UUID its package
 * published.
 *
 * @param {object} index - From {@link buildWikilinkIndex}.
 * @param {unknown} ref - The reference, as authored.
 * @param {object} [hint] - `{type}`, where the caller knows what it expects.
 * @returns {{name?: string, uuid?: string, address?: import("./address.mjs").AddressTuple, subType?: string, standings?: object}|undefined}
 *   The target, or `undefined` where nothing answers.
 */
export function resolveReference(index, ref, hint) {
    if (hint?.kind === "shortcode")
        return resolveShortcodeReference(
            [index.referenceTargets, index.foreignReferences ?? index.foreign],
            ref,
            hint,
        );
    const tuple = parseAddress(ref, {
        package: index.contentPackage,
        system: "note",
        types: index.types,
        packages: index.packages,
        noIndexPackages: index.noIndexPackages,
        type: hint?.type,
    });
    if (tuple.reason) return undefined;
    const key = renderAddress(tuple);
    const published =
        index.referenceTargets?.get(key) ??
        index.foreignReferences?.get(key) ??
        index.foreign?.get(key);
    if (published)
        return {
            name: published.name,
            subType: published.subType,
            ...(published.standings ? { standings: published.standings } : {}),
            ...(published.uuid ? { uuid: published.uuid } : {}),
            address: tuple,
        };
    if (index.referenceTargets) return undefined;
    {
        const key = renderAddress(tuple);
        if (tuple.package !== index.contentPackage) {
            const foreign = index.foreign?.get(key);
            if (foreign) return { ...foreign, address: tuple };
            return undefined;
        }
        const type = tuple.type;
        const documentation = tuple.system === NOTE_SYSTEM && hasDocEntry(type);
        if (tuple.system !== (documentation ? NOTE_SYSTEM : ownDocumentSystem(type)))
            return undefined;
        const local = index.byShortcode?.get(`${type}/${tuple.shortcode}`);
        if (!local) return undefined;
        const addresses = index.uuidByDoc?.get(local);
        const uuid =
            documentation ?
                Object.hasOwn(local, "documentationUuid") ?
                    local.documentationUuid
                :   addresses?.docUuid
            :   addresses?.uuid;
        return {
            name: local.name,
            subType: local.subType,
            ...(local.standings ? { standings: local.standings } : {}),
            ...(uuid ? { uuid } : {}),
            address: tuple,
        };
    }
    return undefined;
}

/**
 * Whether a page's declared anchors include the slug a link names.
 *
 * A local page carries a `Set` built by {@link module:engine/site-index}.
 * A foreign page declares prose anchors in its note metadata, independently
 * of whether it has a Foundry target map. An empty collection declares none.
 * An absent collection leaves the target unchecked.
 *
 * @param {Set<string>|Record<string, string>|Array<{slug: string, kind: string}>|undefined} anchors - The page's
 *   declared anchors, or `undefined` where none were recorded.
 * @param {string} slug - The anchor a link names.
 * @returns {boolean} Whether the anchor is declared, or `true` when `anchors`
 *   is `undefined` — which reads as "nothing to check against" rather than
 *   "declares none".
 */
function hasAnchor(anchors, slug) {
    if (!anchors) return true;
    if (Array.isArray(anchors))
        return anchors.some((anchor) => anchor.kind === "prose" && anchor.slug === slug);
    return anchors instanceof Set ? anchors.has(slug) : Object.hasOwn(anchors, slug);
}

/**
 * The site index entry an address names, or `undefined`.
 *
 * Every omitted segment defaults from where the link is written — the package
 * from the citing package, the system from the block, which on a page body is
 * `note` — so the target expands to exactly one canonical address and this is
 * a plain lookup: one key names one entry.
 *
 * A local target may also be keyed by its short form. On the web that is not a
 * second answer: an item note renders as **one page** which is its own
 * documentation, so `skill/climb`, `docskill/climb` and both canonical
 * addresses are all the same value.
 *
 * @param {Map<string, object>} index - The page index to look in.
 * @param {object|null} read - The parsed target.
 * @param {string} contentPackage - The citing package, which an omitted package
 *   segment defaults from.
 * @returns {object|undefined} The indexed page, or `undefined` when the target
 *   is not an address or nothing publishes it.
 */
function lookupRead(index, read, contentPackage) {
    if (!read || read.reason) return undefined;
    const key = expandAddress(read, { package: contentPackage, system: NOTE_SYSTEM });
    const found = index.get(key);
    if (found || read.package) return found;
    return (
        index.get(`${read.itemDoc ? "doc" : ""}${read.type}/${read.shortcode}`.toLowerCase()) ??
        undefined
    );
}

/**
 * The website's and the book's view of a link: the site index, answered with
 * URLs.
 *
 * The site index is keyed case-insensitively by the canonical
 * `package-system-type-shortcode` address, by `type/shortcode` and by the
 * site's own `section/slug`; a fully qualified address another package
 * publishes is looked up in its fetched index. Local wins: a live build is
 * authoritative and a fetched index can only be staler. A short address two
 * packages claim is in the index's `ambiguous` set, and is a finding of its
 * own.
 *
 * A target that **resolved** to an entry with no page is not unresolved: a
 * pack-only package publishes Foundry addresses and no web pages, so the
 * author wrote a real address and there is simply nothing to link to.
 *
 * @param {object} ctx - What {@link module:engine/site-index.wikiContext}
 *   returns, with the page's own `anchors` and `eventAnchors`.
 * @param {string} body - The page's text, which a link to its own section is
 *   concealed by when the section is secret.
 * @returns {LinkView} The view.
 */
export function siteLinkView(ctx, body) {
    let ownAnchors = ctx.noteAnchors;
    // The bucket an ambiguity is recorded under is the *short* address — the
    // only form two packages can collide on, since a qualified one names its
    // package.
    const collideKey = (read, target) =>
        read && !read.reason && read.package === ctx.contentPackage ?
            `${read.type}/${read.shortcode}`.toLowerCase()
        :   target.toLowerCase();
    const lookup = (read) =>
        lookupRead(ctx.index, read, ctx.contentPackage) ??
        // A short form names *this* package, so it never reaches a fetched
        // index; only a fully qualified address does.
        (ctx.foreign && read?.package ?
            lookupRead(ctx.foreign, read, ctx.contentPackage)
        :   undefined);
    return {
        context: {
            package: ctx.contentPackage,
            system: NOTE_SYSTEM,
            types: ctx.contentTypes ?? new Set(),
            packages: ctx.packages,
            noIndexPackages: ctx.noIndexPackages,
        },
        self: () => ({ noteAnchors: (ownAnchors ??= collectAnchors(body)) }),
        find(read, target) {
            const hit = lookup(read);
            if (hit) return { destination: hit };
            return ctx.collide?.has(collideKey(read, target)) ? { ambiguous: true } : undefined;
        },
        collides: (read, target) => Boolean(ctx.collide?.has(collideKey(read, target))),
        declared: (read) => Boolean(lookup(read)),
        locate(hit, anchor, { samePage }) {
            // Checked against this page's own anchors, exactly as a link into
            // another page is: a self-link naming a section the page does not
            // declare is as dead as one naming a section nowhere does.
            if (samePage) {
                if (isEventAnchor(ctx, anchor)) return { reason: "event-anchor" };
                if (!hasAnchor(ctx.anchors, anchor)) return { reason: "unknown-anchor" };
                return { href: `#${slugify(anchor)}` };
            }
            if (anchor && isEventAnchor(hit, anchor)) return { reason: "event-anchor" };
            // A `#section` the target declares no heading for joins onto the
            // URL unchecked otherwise, and dead-ends for the reader.
            if (anchor && !hasAnchor(hit.noteAnchors ?? hit.anchors, anchor))
                return { reason: "unknown-anchor" };
            // A pack-only package's entries carry no URL: the reader gets the
            // text and no href, rather than `[Name](undefined)`.
            return {
                ...(hit.url ? { href: anchor ? `${hit.url}#${slugify(anchor)}` : hit.url } : {}),
                draft: Boolean(hit.draft),
            };
        },
    };
}

/**
 * A wikilink, as it is written, anywhere in a value that is not markdown.
 *
 * Deliberately its own pattern rather than the body resolver's: nothing here is
 * markdown, so there is no fence or code span to step around, and a frontmatter
 * value is a single line by construction.
 */
// The same syntax the body scan reads — see `./wikilink-syntax.mjs`.
const FRONTMATTER_WIKILINK = new RegExp(WIKILINK.source, "g");

/**
 * Every wikilink authored inside a frontmatter value.
 *
 * Wikilinks are resolved in a note's **body**. Frontmatter is not markdown and
 * is never walked by the resolver, so a link written in one would be copied
 * through verbatim and reach the reader as literal `[[…]]` text, in whatever the
 * theme renders that field as (an infobox row, a description, a card
 * subtitle). Nothing downstream notices: the value is a valid string, the page
 * builds, and the defect is visible only to someone who looks at it.
 *
 * So the form is refused rather than resolved. Resolving it would mean choosing
 * an output syntax for a field whose renderer is unknown to this build — a
 * markdown link is inert in a template that prints the value as text, and an
 * `<a>` is unusable in one that escapes it — and would quietly bless an
 * authoring habit that the pack build has no way to honour at all. Frontmatter
 * carries data; a link belongs in prose.
 *
 * Values are read from the *parsed* frontmatter, so a `[[` inside a YAML comment
 * is not a hit, and every hit can be named by the path a reader would look at.
 *
 * @param {unknown} fm - Parsed frontmatter, as `readMatter` returns it.
 * @returns {Array<{path: string, link: string}>} In reading order; `path` is the
 *   dotted key path of the offending value (`government.summary`, `aliases.1`).
 */
export function frontmatterWikilinks(fm) {
    const hits = [];
    const visit = (value, trail) => {
        if (typeof value === "string") {
            for (const m of value.matchAll(FRONTMATTER_WIKILINK)) {
                hits.push({ path: trail, link: m[0] });
            }
        } else if (Array.isArray(value)) {
            value.forEach((v, i) => visit(v, `${trail}.${i}`));
        } else if (isPlainMap(value)) {
            for (const [k, v] of Object.entries(value)) {
                visit(v, trail ? `${trail}.${k}` : k);
            }
        }
    };
    if (!isPlainMap(fm)) return hits;
    visit(fm, "");
    return hits;
}

/**
 * Whether a value is a YAML mapping rather than a scalar the parser built into
 * an object of its own (a `Date`, which is what an unquoted date becomes).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainMap(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date)
    );
}

/**
 * Rewrites the embeds and wikilinks in a markdown body for the website or the
 * book — see {@link resolveWikilinks}, with {@link siteLinkView} and the `web`
 * or `book` {@link LINK_WRITERS} entry.
 *
 *   `[[type-shortcode|Text]]`       → `[Text](/section/slug/)`
 *   `[[type-shortcode|]]`           → the same, showing the target's own name
 *   `[[type-shortcode#slug|Text]]`  → `[Text](/section/slug/#slug)`
 *   `[[#slug|Text]]`                → `[Text](#slug)`
 *
 * **Every target that resolves nowhere fails the build.** Failures are
 * collected in `ctx.errors`, each carrying the authored `link` and its
 * `occurrence` so a caller can report the line and column it sits on. The
 * link still renders, marked: the mark is for whoever reads the page, the
 * failure for its author.
 *
 * ## Embeds first, and they are not links
 *
 * `![[address|label]]` names a file rather than a note, so it is resolved into
 * an ordinary markdown image before anything looks for a link — which is what
 * stops the link pass reading an embed's interior as a link to a note nobody
 * wrote. The image the rewrite leaves behind is what
 * {@link module:engine/content-images.renderImageFigures} turns into a figure
 * for the website, and what the book reads its staging list out of.
 *
 * ## Every hit is recorded, so the page's edges come out of one pass
 *
 * A caller that hands in `ctx.resolved` is given every index entry a link on
 * the page resolved to, in body order, repeats included. Nothing is recorded
 * for a same-page anchor or for a target that resolved nowhere.
 *
 * @param {string} body - The markdown body.
 * @param {object} ctx - `{ index, assets, collide, contentTypes, packages,
 *   noIndexPackages, foreign, errors, src, file, resolved, output, anchors,
 *   eventAnchors, captionLabels }`, as
 *   {@link module:engine/site-index.wikiContext} builds it. `output` is
 *   `"book"` for the book and defaults to the website. `anchors` and
 *   `eventAnchors` are what *this* page declares, which a `[[#slug]]`
 *   self-link is checked against; absent, a self-link is not checked. `src`
 *   is the page's display path and `file` the source file a diagnostic names
 *   — absent, `src` stands in.
 * @returns {string} The body with embeds and wikilinks rewritten.
 */
export function resolveWebWikilinks(body, ctx) {
    const seen = new Map();
    const record = (literal, finding) => {
        const occurrence = (seen.get(literal) ?? 0) + 1;
        seen.set(literal, occurrence);
        ctx.errors.push({
            file: ctx.file ?? ctx.src,
            src: ctx.src,
            link: literal,
            occurrence,
            ...finding,
        });
    };
    // An embed names a file, so it resolves before anything looks for a link.
    // Its findings are recorded rather than rendered: the rewrite already
    // leaves an embed it cannot resolve exactly as authored.
    const embedded = resolveEmbeds(body, { index: ctx.assets });
    for (const u of embedded.unresolved) {
        record(u.link, { target: u.target, reason: u.reason, ...(u.type ? { type: u.type } : {}) });
    }
    for (const problem of embedded.problems) {
        record(problem.link, { target: problem.link, message: problem.message });
    }
    const result = resolveWikilinks(embedded.markdown, {
        view: siteLinkView(ctx, body),
        write: ctx.output === "book" ? LINK_WRITERS.book : LINK_WRITERS.web,
        captionLabels: ctx.captionLabels,
    });
    for (const { link, offset, occurrence, ...finding } of result.findings) record(link, finding);
    ctx.resolved?.push(...result.resolved);
    return result.markdown;
}
