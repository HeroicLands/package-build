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
 * Resolve body wikilinks for Foundry packs.
 *
 * `[[type-shortcode|Text]]` defaults to the readable `note` Address. A stated
 * game system names an Actor or Item; `none` names a systemless document.
 * Journal links can carry a heading anchor. Actor, Item and Macro links open
 * their sheets, so their anchors do not select a page.
 *
 * `doc<type>` is accepted as an input alias for the readable note Address.
 * A link with an empty label displays the target's current name.
 *
 * @module
 */

import { resolveShortcodeReference } from "./shortcode-references.mjs";

import { readWikilink } from "./wikilink-syntax.mjs";
import crypto from "crypto";

import { compendiumUuid, ITEM_PACK, packForType, pageUuid, PACK_BY_TYPE } from "./ids.mjs";
import { readCanonicalKey } from "./content-address.mjs";
// The address grammar. A wikilink *contains* an Address, so what counts as one
// is stated there and read here — the anchor and the label are this module's,
// and the tuple inside them is not.
import {
    ITEM_DOC_PREFIX,
    readQualifier,
    resolveItemDocType,
    parseAddress,
    renderAddress,
    isAddressTuple,
    completeAddress,
    ownDocumentSystem,
} from "./address.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";
import { systemOf } from "./document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";
import { hasDocEntry, itemDocEntryId } from "./item-docs.mjs";
import { replaceOutsideCode } from "./code-fences.mjs";
// The syntax lives in `./wikilink-syntax.mjs`, so the web resolver and this
// one cannot disagree about what counts as a link.
import {
    authoredLabel,
    WIKILINK,
    parseWikilink,
    unlabelledLinkMessage,
} from "./wikilink-syntax.mjs";

export { ITEM_PACK, PACK_BY_TYPE, packForType };

/**
 * The address grammar, under the names the link resolvers hold it by.
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
 *   draft?: boolean}>} docs -
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

    for (const d of docs) {
        if (!d.id || !d.type) continue;
        types.add(norm(d.type));

        uuidByDoc.set(
            d,
            // A note declaring `pack: none` compiles into no document, so it
            // has no address in any compendium: a link to it is a page on the
            // web and prose in a journal. Recorded as an entry with no UUIDs
            // rather than left out, so the address still resolves and a link
            // to it is never reported as dead.
            d.none ?
                { uuid: undefined, docUuid: undefined }
            :   {
                    // `d.pack` is where this note's document actually landed,
                    // resolved by the pack router when the index was
                    // collected. A repository may ship several packs of one
                    // type and a UUID carries the pack name, so the address
                    // cannot be derived from the type alone.
                    uuid: compendiumUuid(packageId, d.type, d.id, d.pack),
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
    // A legacy index may contain `doc<type>` records. Keep the authored type
    // vocabulary separate so the input alias can resolve to its base type.
    for (const t of foreignTypes) {
        if (!t.startsWith(ITEM_DOC_PREFIX)) types.add(t);
    }
    for (const t of foreignTypes) {
        if (!t.startsWith(ITEM_DOC_PREFIX)) continue;
        if (types.has(t.slice(ITEM_DOC_PREFIX.length))) continue;
        types.add(t);
    }

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
    const shortcode = norm(read.shortcode);

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
 * How an **unresolved** link renders.
 *
 * The author's text is kept, so the sentence still reads — dropping it would
 * silently rewrite the prose. It is marked so a reader can tell that something
 * was meant to be a link, and a maintainer can find it: the appearance lives in
 * `scss/components/_unresolved-link.scss`, not here.
 *
 * @param {string} text - The text to show, from the link's label or target.
 * @param {string} target - The address that resolved nowhere, for the tooltip.
 * @returns {string} An HTML span. The markdown renderer passes raw HTML through.
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
 * How a link to a **draft** note renders.
 *
 * A note tagged `draft` exists so a link into it is not dead, and nothing more.
 * Unmarked, a reader follows a promising link into an empty page and an author
 * cannot see which of their links still owe content.
 *
 * **The wrapper carries the cue and nothing else.** The link itself is
 * untouched — Foundry enriches inside HTML, so the `@UUID` still becomes a live
 * content link, and the note is in the packs, the manifest and the index
 * exactly as any other. Nothing here resembles the retired `draft:` field,
 * which moved a note from published to unresolvable without saying so.
 *
 * The appearance lives in `scss/components/_draft-link.scss`, beside the
 * unresolved-link partial, not here.
 *
 * **Byte-identical with the site build's copy** in `web-wikilinks.mjs`, down to
 * the class name and the `title` wording — one authored link renders on two
 * surfaces, and the two builds have drifted before over exactly this kind of
 * detail. The argument is already-built markup and is deliberately not
 * escaped; the *authored* text inside it was escaped, or made into a link, by
 * whichever resolver called this.
 *
 * @param {string} inner - The resolved link, as that build emits it.
 * @returns {string} An inline HTML span wrapping it.
 */
function draftLink(inner) {
    return `<span class="sohl-draft-link" title="Draft — not yet written">${inner}</span>`;
}

/**
 * Rewrites every wikilink in a markdown body as a Foundry UUID enricher.
 *
 * A link that cannot be resolved is left exactly as it was and reported in
 * `unresolved`, so a content gap degrades to visible literal text rather than
 * a broken link or a failed build.
 *
 * **Code is verbatim.** A `[[…]]` inside a fenced or indented code block, or
 * inside an inline code span, is source text an author wrote to be read as
 * written, so it is left alone and not reported. Without that, a
 * script sample containing `grid[[0]]` became a link — and only for some
 * array shapes, `[[1,2],[3,4]]` having an inner `]` the pattern cannot cross,
 * so the corruption looked arbitrary. It reaches the reader through the
 * *documented* copy of a macro while the executable copy stays correct.
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
 * @returns {{markdown: string, unresolved: Array<{link: string, target: string,
 *   offset: number, reason: string, packages?: string[], anchor?: string}>}}
 *   Each `reason` is one of {@link LINK_FINDING_REASONS}, the vocabulary all
 *   three resolvers share — `ambiguous` carries the claiming `packages`
 *   and `unknown-anchor` the section it named. `offset` is the link's 0-based
 *   position in `markdown`, which is what lets a caller report the line and
 *   column it sits on.
 */
export function convertWikilinks(markdown, { type, id, pack, docPack, index }) {
    const unresolved = [];

    // `offset` is the third replacer argument because the pattern has exactly
    // one capture group. It is what makes two identical unresolved links on
    // one note tellable apart, and a position reportable at all.
    const out = replaceOutsideCode(markdown, WIKILINK, (all, rawInner, offset) => {
        const parsed = readWikilink(rawInner, {
            package: index.contentPackage,
            system: "note",
            types: index.types,
            packages: index.packages,
            noIndexPackages: index.noIndexPackages,
        });
        const target = parsed.rawTarget;
        const slug = parsed.anchor || null;

        // **Every link carries a label**. Without one there is nothing
        // to resolve against: the alias namespace a bare `[[Text]]` was looked
        // up in is retired, and a shortcode is an address rather than prose, so
        // the link has neither a target this build can find nor text to show.
        // Reported before anything else, including the same-page form, because
        // it is a statement about how the link is *written* — `[[#slug]]` needs
        // the pipe exactly as `[[skill-clmb]]` does.
        if (!parsed.labelled) {
            unresolved.push({
                link: all,
                target: target || (slug ? `#${slug}` : ""),
                offset,
                reason: "unlabelled",
                addressed: false,
            });
            return unresolvedLink(parsed.inner, parsed.inner);
        }

        // An *empty* label is not a label — `[[x|]]` means "show the target's
        // name" — and that reading comes from {@link authoredLabel} so the web
        // resolver cannot draw the line somewhere else.
        let text = authoredLabel(parsed) ?? "";

        // Resolve the document: the source note itself for an empty target, or
        // the address the target parses as.
        let doc;
        // Set when the qualifier was the virtual `doc<type>` form, so the UUID
        // is built against the item doc entry rather than the item itself.
        let itemDoc = false;
        // Kept for the foreign fallback below, which needs the parsed address.
        let qualifiedRead = null;
        if (target === "" && slug) {
            doc = { type, id, pack, docPack };
        } else {
            const qualified = parsed.problem ?? parsed.target;
            qualifiedRead = qualified;
            // A target that does not parse as an address is a defect: there is
            // no second namespace left to fall through to.
            if (!qualified || qualified.reason) {
                unresolved.push({
                    link: all,
                    target,
                    offset,
                    reason: qualified?.reason ?? "not-an-address",
                    addressed: true,
                });
                return unresolvedLink(text || target, target);
            }
            // Ordinary wikilinks default to readable note content.
            const baseType = resolveItemDocType(qualified.type, index.types);
            const address = completeAddress(qualified, {
                package: index.contentPackage,
                system: NOTE_SYSTEM,
            });
            itemDoc = address.system === NOTE_SYSTEM && hasDocEntry(baseType ?? qualified.type);
            if (qualified.package === index.contentPackage)
                doc = index.byShortcode.get(`${baseType ?? qualified.type}/${qualified.shortcode}`);
        }
        if (!doc) {
            // Nothing local answers. A foreign package may publish this
            // address, in which case the manifest hands back a complete UUID —
            // including, for a section link, the anchor's own — so nothing is
            // derived here.
            const hits = foreignHits(index, qualifiedRead);
            if (hits.length > 1) {
                // Two packages publish the short address, so it names neither.
                // Its own class: the fix is the package-qualified form, not a
                // corrected shortcode.
                unresolved.push({
                    link: all,
                    target,
                    offset,
                    reason: "ambiguous",
                    packages: hits.map((h) => h.package).filter(Boolean),
                    addressed: true,
                });
                return unresolvedLink(text || target, target);
            }
            const hit = hits[0] ?? null;
            if (hit) {
                const uuid = slug ? hit.anchors?.[slug] : hit.uuid;
                if (uuid) {
                    return `@UUID[${uuid}]{${text || hit.name || target}}`;
                }
                unresolved.push({
                    link: all,
                    target,
                    offset,
                    reason: "unknown-anchor",
                    anchor: slug,
                    addressed: true,
                });
                return unresolvedLink(text || target, target);
            }
            unresolved.push({
                link: all,
                target,
                offset,
                reason: "unresolved",
                // An address that resolves nowhere is a typo: every package it
                // could name is either built here or vendored, so there is no
                // third possibility left.
                addressed: true,
            });
            return unresolvedLink(text || target, target);
        }

        // An address with an *empty* label — `[[skill-clmb|]]` — has no prose
        // to show, a shortcode being an address rather than display text, so
        // the document's **current** name stands in and a rename shows at every
        // citation with no link edited. The knowledgebase build reads
        // the same authored link the same way.
        if (!text) text = doc.name ?? target;

        // Both addresses were computed when the target was indexed. An item
        // doc lives in the journals pack under its own derived entry id, and
        // its pages hash against *that* id — not the item's.
        //
        // The one target with no index entry is the note itself: a `[[#slug]]`
        // self-link is resolved from the source's own type and id, which the
        // caller supplied, so it is addressed the same way here.
        const addresses = index.uuidByDoc.get(doc) ?? {
            uuid: compendiumUuid(index.packageId, doc.type, doc.id, doc.pack),
            docUuid: compendiumUuid(index.packageId, "doc", itemDocEntryId(doc.id), doc.docPack),
        };
        const entryUuid = itemDoc ? addresses.docUuid : addresses.uuid;
        // The target is a note that compiles into no document — `pack: none`.
        // The address is real and the page exists on the web, so this is not
        // a dead link and must not fail the build; but a compendium has
        // nothing to open, so the reader gets the prose and no `@UUID`. The
        // mirror of what the website does for an address that publishes a
        // document and no page.
        if (entryUuid === undefined) return text;
        const entryId = itemDoc ? itemDocEntryId(doc.id) : doc.id;
        const isJournal = itemDoc || packForType(doc.type).docType === "JournalEntry";
        // A JournalEntry link opens a journal — at its first page, or at the
        // page an anchor names. An Item or Actor link opens that document's
        // *sheet*, which has no sections, so the anchor has nothing to address
        // and is dropped. Forging a JournalEntryPage id onto a document that
        // can never hold one is what made such links dead-end; an
        // an item's pages are addressed through its `note` Address.
        // A `#section` the target declares no heading for. Checked here, and
        // not only by `content-build links`, because this is the build that
        // *emits* the link: `anchorPageId` will hash any slug into a page id,
        // so an undeclared one compiles to a `@UUID` that dead-ends for the
        // reader. A foreign anchor has always been checked this way —
        // the manifest carries the map — and a local one now is too, from the
        // anchor set the index carries.
        if (slug && isJournal && doc.anchors && !doc.anchors.has(slug)) {
            unresolved.push({
                link: all,
                target,
                offset,
                reason: "unknown-anchor",
                anchor: slug,
                addressed: true,
            });
            return unresolvedLink(text || doc.name || target, target);
        }
        const uuid =
            slug && isJournal ? pageUuid(entryUuid, anchorPageId(entryId, slug)) : entryUuid;
        const link = `@UUID[${uuid}]{${text}}`;
        // A link into a note that exists but is not written renders marked.
        // Presentation only — the UUID above is unchanged, and a
        // `[[#slug]]` self-link is not marked because the reader is already in
        // the note it would be telling them about.
        return doc.draft ? draftLink(link) : link;
    });

    return { markdown: out, unresolved };
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
 * @returns {{name?: string, uuid?: string, address?: import("./address.mjs").AddressTuple, subType?: string}|undefined}
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
            ...(uuid ? { uuid } : {}),
            address: tuple,
        };
    }
    return undefined;
}
