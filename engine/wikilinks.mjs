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
 * Wikilink resolution for the pack compilers.
 *
 * Content notes link to one another with wikilinks rather than file paths:
 *
 *   `[[type-shortcode|Text]]`   a document of that type
 *   `[[type-shortcode|]]`       the same, showing the target's current name
 *   `[[type-shortcode#slug|T]]` a section (see below)
 *   `[[#slug|Text]]`            a section of the source note itself
 *   `[[doctype-shortcode|T]]`   an item's *documentation* (see below)
 *
 * **Every link is an address, and every address carries a label** (#180). A
 * link written without one addresses nothing and is reported — see
 * {@link unlabelledLinkMessage}, which states the rule for both builds. The
 * bare `[[Alias]]` form and the index it was looked up in are retired.
 *
 * The qualifier is the note's **type**, which with its shortcode is the system's
 * logical identity: `(type, shortcode)` is unique by rule (see the Shortcode
 * Integrity doc). It is deliberately not the note's directory — shortcodes are
 * unique per type, not per directory, so a directory qualifier would add nothing
 * to the address while breaking every inbound link the moment a note is refiled.
 *
 * Nothing narrower than `(type, shortcode)` is consulted — a note's directory
 * and its `category` play no part in resolution — and nothing wider: a note's
 * *name* is not an address, so two notes of a type may share a display name
 * ("Gear" as a rules page and as a user guide page) with nothing to disambiguate
 * (#179, #180).
 *
 * At compile time each becomes a Foundry UUID enricher, routed to the pack that
 * the target's type compiles into (see {@link packForType}):
 *
 *   `@UUID[Compendium.sohl.items.Item.<id>]{Text}`
 *   `@UUID[Compendium.sohl.journals.JournalEntry.<id>.JournalEntryPage.<anchorId>]{Text}`
 *
 * **Every address is computed once, when the target is indexed** — see
 * {@link buildWikilinkIndex} — and a link is resolved by looking that value up.
 * Nothing here concatenates a prefix at the point of use (#1498).
 *
 * Section links address a **JournalEntryPage**, because Foundry UUIDs cannot
 * target a position inside a page. A heading carrying `{#slug}` therefore starts
 * its own page, whose id is {@link anchorPageId} — derived from the note id and
 * the slug so that the link and the page agree without any shared state.
 *
 * **An anchor on an Item, an Actor or a Macro is a no-op** and is dropped. What
 * such a link does is open that document's **sheet** — not its documentation —
 * and a sheet has no sections to address. Only a JournalEntry link opens a
 * journal, at its first page or at the page an anchor names. An item's pages are
 * reached through its `doc<type>` counterpart, below.
 *
 * **A document and its documentation are two documents.** An item note
 * compiles into an item — and, separately, its prose compiles into a
 * JournalEntry in the journals pack (see
 * {@link sohl.utils.packs.itemDocEntryId}); a macro note works the same way
 * (#1514). `skill/wpnc` addresses the skill; the **virtual qualifier**
 * `docskill/wpnc` addresses that skill's documentation, and
 * `docskill/wpnc#crafting` a page within it. `docmacro/autoattack#script`
 * reaches a macro's source. Every doc-carrying type has a `doc<type>`
 * counterpart, formed by prefix and never enumerated; see
 * {@link resolveItemDocType}. Without it a section link to an item note
 * produced a UUID against the *items* pack, which cannot hold a
 * JournalEntryPage, and dead-ended (#1362).
 *
 * **The two builds read the qualifier differently, by design.** In Foundry the
 * item and its documentation are separate documents in separate packs, so the
 * two qualifiers resolve to two different UUIDs. On the knowledgebase the item
 * note renders as a single page which *is* its documentation, so `doc<type>` and
 * `<type>` are aliases for the same URL and an anchor on either is an ordinary
 * in-page anchor. One authored link, correct in both.
 *
 * Plain ESM with no Foundry and no filesystem access, so it is unit-testable.
 */

import crypto from "crypto";

import { compendiumUuid, ITEM_PACK, packForType, pageUuid, PACK_BY_TYPE } from "./ids.mjs";
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
 * The qualifier prefix that addresses an item's **documentation** rather than
 * the item: `docskill/wpnc` is the JournalEntry that `skill/wpnc`'s prose
 * compiled into. See {@link resolveItemDocType}.
 */
const ITEM_DOC_PREFIX = "doc";

const norm = (s) => String(s).toLowerCase().trim();

/**
 * Reads a qualifier as the **virtual `doc<type>`** form, or reports that it is
 * not one.
 *
 * A document and its documentation are two documents in two packs, so they
 * need two addresses (#1362). `skill/wpnc` is the item; `docskill/wpnc` is the
 * JournalEntry its prose compiled into, and `docmacro/autoattack` is the same
 * arrangement for a macro (#1514).
 *
 * The virtual form exists for a type that carries separate documentation
 * ({@link sohl.utils.packs.docEntryTypes} — the set the journals compiler and
 * the link manifest read too), **or** for one that routes to the items pack.
 * The second clause is the older rule and stays: types that compile into items
 * are the open, unenumerated set (#1276), and a foreign package may publish an
 * item type this build has never heard of. Dropping it would silently unlink
 * every `doc<type>` address into such a package.
 *
 * A **real** type of the same name always wins: the virtual reading is only
 * consulted for a qualifier no authored note claims.
 *
 * @param {string} qualifier - The already-normalised text before the `/`.
 * @param {Set<string>} types - Every type the content tree contains.
 * @returns {string|null} The underlying document type, or `null` when the
 *   qualifier is not a virtual one.
 */
export function resolveItemDocType(qualifier, types) {
    if (types.has(qualifier)) return null; // a real type owns its own name
    if (!qualifier.startsWith(ITEM_DOC_PREFIX)) return null;
    const base = qualifier.slice(ITEM_DOC_PREFIX.length);
    if (!base || !types.has(base)) return null;
    if (hasDocEntry(base)) return base;
    return packForType(base).docType === ITEM_PACK.docType ? base : null;
}

/**
 * Read a link target as a **qualified** `type-shortcode` reference, or report
 * that it does not parse as one.
 *
 * Two separators are accepted, and they are **not** interchangeable in how
 * confidently they mark a target as qualified:
 *
 * - **`type-shortcode`** — the canonical form (#1398). Obsidian reads `/` inside
 *   a wikilink as a *path* and resolves it against the vault's folders, so a
 *   slash-qualified link is a broken link in the editor where the content is now
 *   authored. A hyphen qualifies **only when what precedes it is a known type**:
 *   note names contain hyphens too (`Grukar-ahk`), and a target that is one is
 *   reported as not an address rather than split at an arbitrary place. The
 *   split is at the **first** hyphen, so a shortcode may itself contain one
 *   (`trauma-self-pro` → `trauma` + `self-pro`).
 * - **`type/shortcode`** — the legacy form, still resolved so that a link
 *   written before the vault migrated does not silently die. A slash is
 *   *unconditionally* a qualifier: nothing else uses one, so an unknown type
 *   before it is reported rather than guessed at. The split is at the **last**
 *   slash, as it always was.
 *
 * A leading **package** segment is optional and outermost: `sohl-skill-lang` is
 * `skill-lang` in the `sohl` package. It is read only when `packages` is given
 * and names the segment, and only when the remainder is itself a valid address,
 * so a note called "Grukar-ahk" is not mistaken for one (#1499).
 *
 * @param {string} target - The link target, anchor already removed.
 * @param {Set<string>} types - Every type the content tree contains.
 * @param {Set<string>} [packages] - Every package an address may name. Omitted
 *   by callers that resolve within one package, where the form cannot occur.
 * @returns {{type: string, shortcode: string, itemDoc: boolean,
 *   package?: string, reason?: undefined} | {reason: "unknown-type"} | null}
 *   The resolved qualifier; a `reason` when the target is definitely qualified
 *   but names no known type; or `null` when it is not an address at all.
 */
export function readQualifier(target, types, packages) {
    // A leading **package** segment is the optional outermost qualifier:
    // `sohl-skill-lang` is `skill-lang` in the `sohl` package. It is stripped
    // here so everything below reads the same `type`/`shortcode` it always did,
    // and it is recognised only when what precedes the hyphen is a package this
    // build knows *and* the remainder is itself a valid address — so a note
    // named "Sohl-something" is not mistaken for one (#1499).
    if (packages?.size) {
        const hyphen = target.indexOf("-");
        if (hyphen > 0) {
            const pkg = norm(target.slice(0, hyphen));
            if (packages.has(pkg)) {
                const rest = readQualifier(target.slice(hyphen + 1), types);
                if (rest && !rest.reason) return { ...rest, package: pkg };
            }
        }
    }

    const slash = target.lastIndexOf("/");
    if (slash > 0) {
        const read = readTypeAndCode(target.slice(0, slash), target.slice(slash + 1), types);
        // A slash means qualified whether or not the type is real.
        return read ?? { reason: "unknown-type" };
    }

    const hyphen = target.indexOf("-");
    if (hyphen > 0) {
        // A hyphen qualifies only on a known type; otherwise it is part of a
        // name, and a name is not an address.
        return readTypeAndCode(target.slice(0, hyphen), target.slice(hyphen + 1), types);
    }
    return null;
}

/**
 * Resolve a qualifier/shortcode pair, honouring the virtual `doc<type>` form.
 *
 * @param {string} rawType
 * @param {string} rawCode
 * @param {Set<string>} types
 * @returns {{type: string, shortcode: string, itemDoc: boolean} | null}
 *   `null` when the qualifier names no known type, or the shortcode is empty.
 */
function readTypeAndCode(rawType, rawCode, types) {
    const shortcode = norm(rawCode);
    if (!shortcode) return null;

    let type = norm(rawType);
    const base = resolveItemDocType(type, types);
    if (base) return { type: base, shortcode, itemDoc: true };
    if (!types.has(type)) return null;
    return { type, shortcode, itemDoc: false };
}

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
 *   name?: string, pack?: string, docPack?: string,
 *   draft?: boolean}>} docs -
 *   One entry per content note. `pack` / `docPack` name the packs the note's
 *   document and its documentation entry landed in; omitted, the conventional
 *   one-pack-per-type names stand in. `draft` says the note carries the `draft`
 *   tag, which marks links *into* it and changes nothing else (#183).
 * @param {string} packageId - The Foundry package shipping the packs; the first
 *   segment of every emitted UUID.
 * @param {Map<string, object>} [foreign] - Canonically keyed entries from
 *   vendored manifests of packages this build links into but does not publish.
 * @param {string} [contentPackage] - This build's *content* package, which an
 *   authored address may name explicitly. Defaults to `packageId`.
 * @returns {{byShortcode: Map<string, object>, types: Set<string>}} `types` is
 *   every type the tree actually contains, so a qualifier naming no real type
 *   can be told apart from a missing target.
 */
export function buildWikilinkIndex(docs, packageId, foreign, contentPackage) {
    if (!packageId) {
        throw new Error(
            "buildWikilinkIndex: packageId is required — it is the first " +
                "segment of every emitted UUID, and defaulting it is how links " +
                "came to address the wrong package (#1498).",
        );
    }

    const byShortcode = new Map();
    const types = new Set();

    // Each note's address is computed once, here, and every reference to it is
    // that stored value. Nothing downstream assembles a UUID from parts, so a
    // link and its target cannot disagree about where the document lives.
    const uuidByDoc = new Map();

    for (const d of docs) {
        if (!d.id || !d.type) continue;
        types.add(norm(d.type));

        uuidByDoc.set(d, {
            // `d.pack` is where this note's document actually landed, resolved
            // by the pack router when the index was collected. A repository may
            // ship several packs of one type (#1566) and a UUID carries the
            // pack name, so the address cannot be derived from the type alone.
            uuid: compendiumUuid(packageId, d.type, d.id, d.pack),
            // An item's prose compiles into a separate JournalEntry, addressed
            // by the virtual `doc<type>` qualifier. Its id is derived from the
            // item's, so its address is knowable here too.
            docUuid: compendiumUuid(packageId, "doc", itemDocEntryId(d.id), d.docPack),
        });

        if (d.shortcode) byShortcode.set(`${norm(d.type)}/${norm(d.shortcode)}`, d);
    }
    // Entries published by *other* packages, keyed canonically. Merged as one
    // map rather than consulted separately: the keys are globally unique, so a
    // foreign address resolves exactly like a local one and there is no
    // precedence rule to get wrong. A foreign package's types are added to
    // `types` too — without that, its addresses read as prose and silently lose
    // their link (#1499).
    const foreignByKey = new Map(foreign ?? []);
    const foreignTypes = [];
    for (const v of foreignByKey.values()) {
        if (v.type) foreignTypes.push(norm(v.type));
    }
    // A manifest publishes `doc<type>` addresses, but `doc<type>` is a
    // *virtual* qualifier formed by prefix — never a real type. Admitting it
    // here would make it one, and a real type owns its own name, so the
    // virtual reading would stop firing and every `[[docskill-wpnc]]` would
    // resolve nowhere. The virtual form still reaches a foreign documentation
    // entry: it reads as `skill` + `itemDoc`, which the manifest lookup then
    // asks for as `docskill`.
    //
    // Real types are admitted **first**, in a pass of their own, so the test
    // below sees the complete set. Done in one pass it would depend on
    // manifest iteration order wherever the base type is published only by a
    // foreign package — `docmacro` admitted or not according to whether
    // `macro` happened to come first.
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
        types,
        uuidByDoc,
        packageId,
        packages,
        foreign: foreignByKey,
    };
}

/**
 * The foreign manifest entry an address names, or `null`.
 *
 * A package-qualified address is one lookup. An unqualified one names no
 * package, so it
 * resolves against whichever foreign package publishes it — and only when
 * exactly one does. Claimed by two, it is genuinely ambiguous and the author
 * writes the qualified form; guessing would make the build depend on which
 * manifest happened to load first.
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
 * and those are different findings with different fixes (#184), so the caller
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
    const wanted = norm(read.itemDoc ? `doc${read.type}` : read.type);
    const shortcode = norm(read.shortcode);
    if (read.package) {
        const one = index.foreign.get(`${read.package}-${wanted}-${shortcode}`.toLowerCase());
        return one ? [one] : [];
    }
    const hits = [];
    for (const [key, v] of index.foreign) {
        const parts = key.split("-");
        if (parts.length !== 3) continue;
        if (parts[1] === wanted && parts[2] === shortcode) hits.push(v);
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
 * How a link to a **draft** note renders (#183).
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
 * detail (#1409). The argument is already-built markup and is deliberately not
 * escaped; the *authored* text inside it was escaped, or made into a link, by
 * whichever resolver called this.
 *
 * @param {string} inner - The resolved link, as that build emits it.
 * @returns {string} An inline HTML span wrapping it.
 */
function draftLink(inner) {
    return `<span class="sohl-draft-link" title="Draft — not yet written">${inner}</span>`;
}

/** Matches a whole wikilink, capturing its inner text. */

/**
 * Rewrites every wikilink in a markdown body as a Foundry UUID enricher.
 *
 * A link that cannot be resolved is left exactly as it was and reported in
 * `unresolved`, so a content gap degrades to visible literal text rather than
 * a broken link or a failed build.
 *
 * **Code is verbatim.** A `[[…]]` inside a fenced or indented code block, or
 * inside an inline code span, is source text an author wrote to be read as
 * written, so it is left alone and not reported (#1505). Without that, a
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
 *   three resolvers share (#184) — `ambiguous` carries the claiming `packages`
 *   and `unknown-anchor` the section it named. `offset` is the link's 0-based
 *   position in `markdown`, which is what lets a caller report the line and
 *   column it sits on (#17).
 */
export function convertWikilinks(markdown, { type, id, pack, docPack, index }) {
    const unresolved = [];

    // `offset` is the third replacer argument because the pattern has exactly
    // one capture group. It is what makes two identical unresolved links on
    // one note tellable apart, and a position reportable at all (#17).
    const out = replaceOutsideCode(markdown, WIKILINK, (all, rawInner, offset) => {
        const parsed = parseWikilink(rawInner);
        const target = parsed.target;
        const slug = parsed.anchor || null;

        // **Every link carries a label** (#180). Without one there is nothing
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
        // resolver cannot draw the line somewhere else (#113).
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
            const qualified = readQualifier(target, index.types, index.packages);
            qualifiedRead = qualified;
            // A target that does not parse as an address is a defect: there is
            // no second namespace left to fall through to (#180).
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
            itemDoc = qualified.itemDoc;
            doc = index.byShortcode.get(`${qualified.type}/${qualified.shortcode}`);
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
                // corrected shortcode (#184).
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
        // citation with no link edited (#1409). The knowledgebase build reads
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
        const entryId = itemDoc ? itemDocEntryId(doc.id) : doc.id;
        const isJournal = itemDoc || packForType(doc.type).docType === "JournalEntry";
        // A JournalEntry link opens a journal — at its first page, or at the
        // page an anchor names. An Item or Actor link opens that document's
        // *sheet*, which has no sections, so the anchor has nothing to address
        // and is dropped. Forging a JournalEntryPage id onto a document that
        // can never hold one is what made such links dead-end (#1362); an
        // item's pages are addressed through its `doc<type>` counterpart.
        const uuid =
            slug && isJournal ? pageUuid(entryUuid, anchorPageId(entryId, slug)) : entryUuid;
        const link = `@UUID[${uuid}]{${text}}`;
        // A link into a note that exists but is not written renders marked
        // (#183). Presentation only — the UUID above is unchanged, and a
        // `[[#slug]]` self-link is not marked because the reader is already in
        // the note it would be telling them about.
        return doc.draft ? draftLink(link) : link;
    });

    return { markdown: out, unresolved };
}
