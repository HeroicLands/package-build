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
 * **The Actor pass, for any system** — the parts of compiling a note into a
 * Foundry Actor that belong to the note format rather than to a game system
 * (#139).
 *
 * The whole of it lived in `sohl/actors.mjs`, where the system-specific facts
 * were already funnelled through one map (`static documentSubtypes`, added by
 * #79) and one block constant. A second system needs everything except the
 * shape of the `system` block itself, so that everything moved here and each
 * half declares what differs:
 *
 * | stated by the subclass | what it decides |
 * | --- | --- |
 * | `static documentSubtypes` | the block its notes write, the types it claims, the subtype each becomes |
 * | `buildEntry()` | the document its system's data model actually wants |
 *
 * What is shared is the machinery an actor of *any* system needs:
 *
 * - **The predefined-item catalogue.** Every Item pack's compiled output, read
 *   as one address space keyed by `subType:shortcode`, with a dependency
 *   catalogue behind it as a fallback rather than a peer.
 * - **Reference translation.** A being addresses its embedded items in the
 *   *note* vocabulary and the catalogue is keyed in the *document's*, so
 *   {@link SystemActorCompiler#embeddedSubtype} translates each reference
 *   forward through this system's map before the lookup (#140).
 * - **Embedding.** Merging a note's overlay onto a catalogue entry, deriving a
 *   stable embedded id from the owning actor and the address, and re-keying the
 *   embedded document and its effects for the LevelDB flattening.
 * - **Anchored prose.** `{#appearance}` / `{#dossier}` are pulled out by
 *   {@link module:engine/anchored-sections}, re-exported here for the passes
 *   that reach it through this module; *which document field* each lands in is
 *   the system's, and is decided in `buildEntry`.
 *
 * @module
 */

import fs from "fs";
import path from "path";
import log from "loglevel";

import { makeId } from "./helpers.mjs";
import { emitDiagnostic } from "./diagnostics.mjs";
// The `{#appearance}` / `{#dossier}` convention is the note format's, so the
// extraction is shared; which field a section lands in stays the system's.
export { extractAnchorSection, renderSection } from "./anchored-sections.mjs";
import { BasePackCompiler } from "./base-compiler.mjs";
import { contentPackage } from "./content-package.mjs";
// Which Foundry Actor subtype a note's `type` compiles into, and which note
// types are actors at all. Looked up in the system's declared map, never
// inferred from the type itself (#79).
import { mapsNoteType, noteTypesFor, referencedSubtype } from "./document-subtypes.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";
// An `items:` entry's `system:` overlay is merged verbatim, so it reaches the
// document by a path no field declaration sits on — including, until #330, the
// fields the document is supposed to write for itself in play.
import { itemFields } from "./item-registry.mjs";
import { runtimeOnlyIn, runtimeOnlyMessage } from "./runtime-only-fields.mjs";
// A `model:` is an address, read by the same grammar every wikilink is (#336),
// so an author writes one form and meets one set of messages.
import { readQualifier } from "./wikilinks.mjs";

/**
 * Strip compendium-only fields from a predefined item before embedding it
 * inside an actor's `items[]`. These fields belong on a top-level
 * compendium document, not on an embedded one.
 *
 * @param {object} item - The catalogue entry.
 * @returns {object} The entry, without its compendium-only fields.
 */
export function stripCompendiumFields(item) {
    // eslint-disable-next-line no-unused-vars
    const { _key, _stats, ownership, folder, ...rest } = item;
    return rest;
}

/**
 * Whether a value is a plain object, for {@link deepMerge}.
 *
 * @param {unknown} v - The value.
 * @returns {boolean} True for a plain object.
 */
export function isPlainObject(v) {
    return (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) === Object.prototype
    );
}

/**
 * Recursively merge `overlay` onto `base`. Plain objects merge key-by-key;
 * everything else (arrays, primitives, null) replaces. Inputs are not
 * mutated.
 *
 * @param {any} base - The catalogue entry.
 * @param {any} overlay - The note's own values.
 * @returns {any} The merged value.
 */
export function deepMerge(base, overlay) {
    if (overlay === undefined) return base;
    if (!isPlainObject(base) || !isPlainObject(overlay)) {
        return overlay;
    }
    const out = { ...base };
    for (const [k, v] of Object.entries(overlay)) {
        out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
}

/**
 * The key one predefined item is held under, and every place that spells it.
 *
 * **The vocabulary is the document's, not the note's** — `subType` is the
 * Foundry Item subtype the compiled document carries, which is the only thing a
 * compiled pack (or an extracted dependency catalogue) records about what an
 * item *is*. An actor's frontmatter addresses the same item in the *note*
 * vocabulary, so a reference is translated forward through the system's map
 * before it reaches this function; see
 * {@link SystemActorCompiler#embeddedSubtype} for why the translation goes that
 * way and not the other (#140).
 *
 * @param {string} subType - The Foundry Item subtype.
 * @param {string} shortcode - The item's `system.shortcode`.
 * @returns {string} The address, `subType:shortcode`.
 */
export function itemAddress(subType, shortcode) {
    return `${subType}:${shortcode}`;
}

/**
 * The key one predefined item is held under **for the package that publishes
 * it** — the address a `model:` naming that package resolves through (#334).
 *
 * The unqualified {@link itemAddress} stays beside it, and the two answer
 * different questions. A `model` that names no package means *this* one and
 * takes the unqualified key, where a local definition still shadows a
 * dependency's. A `model` that names a package takes this one, which nothing
 * can shadow: that is the whole point of writing the package down.
 *
 * Not the canonical wikilink address, because this map is keyed in the
 * **document's** vocabulary — a Foundry Item subtype — while a canonical address
 * carries the *note* type. The two differ wherever a system maps a type to a
 * differently-named subtype, and translating here would put the translation in
 * two places.
 *
 * @param {string} pkg - The content package that publishes the item.
 * @param {string} subType - The Foundry Item subtype.
 * @param {string} shortcode - The item's `system.shortcode`.
 * @returns {string} The address, `package:subType:shortcode`.
 */
export function packagedItemAddress(pkg, subType, shortcode) {
    return `${pkg}:${subType}:${shortcode}`;
}

/**
 * The key one predefined item is held under **in the catalogue**, with the
 * shortcode folded to lower case.
 *
 * A shortcode is case-sensitive and routinely mixed — `Clb`, `LtShoe`,
 * `HsTunic` — while an **address** is not: `readQualifier` normalises what it
 * reads, and every canonical address is lowercase. So the moment a `model:` is
 * read as an address (#334), `weapongear-clb` has to find the document whose
 * `system.shortcode` is `Clb`, and an exact match cannot (#346).
 *
 * Folding is safe because the fold is already the address: no two items in any
 * published tree differ only by the case of their shortcode, and #340 will make
 * that impossible rather than merely true.
 *
 * **This is not {@link itemAddress}, and must not become it.** That one seeds
 * {@link embeddedItemId}, so folding there would change the `_id` of every
 * embedded item whose identity carries a capital — a silent re-identification of
 * documents nothing about which had changed. The catalogue is a lookup table;
 * an id is a promise.
 *
 * @param {string} subType - The Foundry Item subtype.
 * @param {string} shortcode - The item's `system.shortcode`, in any case.
 * @param {string} [pkg] - The publishing package, for the qualified form.
 * @returns {string} The catalogue key.
 */
export function catalogueKey(subType, shortcode, pkg) {
    const folded = String(shortcode).toLowerCase();
    return pkg ? packagedItemAddress(pkg, subType, folded) : itemAddress(subType, folded);
}

/**
 * What identifies one embedded item on its actor.
 *
 * **Its own `system.shortcode`** — not the entry's top-level `shortcode`, which
 * merely *selects* the catalogue template the entry is written from and is
 * never written to the document. Two daggers may share a selector; they are two
 * embodiments and each must declare its own.
 *
 * The name is a last resort, for a **stand-alone** entry that names no template
 * and states no shortcode. It is a poor identity — presentation, and free to be
 * localized or to diverge — so it is not a fallback the compiler is content
 * with: two entries reducing to one identity is refused either way, and the
 * message says to state a `system.shortcode`.
 *
 * @param {object} item - The merged embedded item.
 * @returns {string} The identity, for {@link embeddedItemId}.
 */
export function embeddedIdentity(item) {
    const own = item?.system?.shortcode;
    if (typeof own === "string" && own.trim()) return own.trim();
    return typeof item?.name === "string" ? item.name : "";
}

/**
 * The `_id` of one item embedded on an actor.
 *
 * Seeded by the owning actor, because an embedded id must be unique within its
 * **parent document** and nothing wider — so the namespace is already exactly
 * the scope the uniqueness is required in, and the largest namespace in the
 * four corpora holds 180 items, at which 64 bits collide with probability
 * around 10⁻¹⁵.
 *
 * **It takes no index** (#268). Keying on a position meant reordering a being's
 * item list renumbered every id after the change, so a re-import created new
 * documents beside the old ones — while nothing about those documents had
 * changed, only their neighbours. The identity always exists or must be stated;
 * see {@link embeddedIdentity}.
 *
 * Keyed by the **document subtype**, so renaming a note type (#78) leaves every
 * embedded id where it was.
 *
 * @param {string} actorId - The owning actor's id.
 * @param {string} subType - The Foundry Item subtype.
 * @param {string} identity - From {@link embeddedIdentity}.
 * @returns {string} A 16-character Foundry id.
 */
export function embeddedItemId(actorId, subType, identity) {
    return makeId(actorId, itemAddress(subType, identity));
}

/**
 * Load every JSON file under each of `itemsSourceDirs`, returning one Map keyed
 * by {@link itemAddress} — the compiled document's **subtype** and its
 * `system.shortcode`. Folder docs and entries without a shortcode are skipped.
 * The `_key` field is stripped from each entry — it is not part of the item
 * data model.
 *
 * The directories are read as one address space, because an actor names an item
 * by `(type, shortcode)` and never by the pack it happens to ship in. Two local
 * Item packs claiming the same address is therefore ambiguous rather than a
 * last-one-wins ordering detail, and fails here.
 *
 * A **foreign** directory — the extracted item catalogue of a package this
 * repository depends on but does not contain — is a fallback rather than a
 * peer. A repository must be able to ship its own `skill:awar` that stands in
 * front of the system's, so a local address shadows a foreign one instead of
 * colliding with it. Local directories are therefore read first, and anything
 * already claimed is left alone.
 *
 * @param {readonly string[]} itemsSourceDirs - Every local Item pack's JSON tree.
 * @param {readonly string[]} [foreignSourceDirs] - Extracted dependency
 *   catalogues, consulted only for addresses no local pack defines.
 * @returns {Map<string, object>} The predefined items, by address.
 */
export function loadItemsMap(itemsSourceDirs, foreignSourceDirs = []) {
    const map = new Map();
    const source = new Map();
    const shadowed = [];
    for (const itemsSourceDir of itemsSourceDirs) {
        if (!fs.existsSync(itemsSourceDir)) {
            // The generator orders the actors pass after every Item pass (#73),
            // so a whole-package build cannot reach this. What can is a run
            // restricted to this one pack, or a caller constructing the
            // compiler itself — neither of which reordering a pack list fixes,
            // so the message no longer suggests it.
            throw new Error(
                `Items source directory ${itemsSourceDir} does not exist — ` +
                    `an actor resolves its embedded items against the Item ` +
                    `packs' compiled output, so those packs must be compiled ` +
                    `before this one`,
            );
        }
        for (const name of fs.readdirSync(itemsSourceDir)) {
            if (!name.endsWith(".json")) continue;
            if (name.startsWith("folder_")) continue;
            const full = path.join(itemsSourceDir, name);
            let doc;
            try {
                doc = JSON.parse(fs.readFileSync(full, "utf8"));
            } catch (err) {
                emitDiagnostic({
                    file: full,
                    severity: "warning",
                    message: `unparseable item JSON, skipping: ${err.message}`,
                });
                continue;
            }
            const shortcode = doc?.system?.shortcode;
            if (!doc?.type || !shortcode) continue;
            const address = catalogueKey(doc.type, shortcode);
            const owner = source.get(address);
            if (owner && owner !== itemsSourceDir) {
                throw new Error(
                    `Two Item packs both define "${address}" (${owner} and ` +
                        `${itemsSourceDir}); an actor addresses an item by ` +
                        `(type, shortcode), so the address must be unique across ` +
                        `every Item pack`,
                );
            }
            source.set(address, itemsSourceDir);
            // eslint-disable-next-line no-unused-vars
            const { _key, ...rest } = doc;
            map.set(address, rest);
            // And under this package's own name, so a `model:` that names this
            // package explicitly resolves to the same item (#334).
            map.set(catalogueKey(doc.type, shortcode, contentPackage()), rest);
        }
    }
    for (const foreignEntry of foreignSourceDirs) {
        // Each dependency's directory arrives with the package that published
        // it (#334), so a foreign template gets its own canonical address
        // rather than sharing the local address space.
        const foreignDir = typeof foreignEntry === "string" ? foreignEntry : foreignEntry.dir;
        const foreignPackage = typeof foreignEntry === "string" ? null : foreignEntry.package;
        for (const name of fs.readdirSync(foreignDir)) {
            if (!name.endsWith(".json")) continue;
            if (name.startsWith("folder_")) continue;
            const full = path.join(foreignDir, name);
            let doc;
            try {
                doc = JSON.parse(fs.readFileSync(full, "utf8"));
            } catch (err) {
                emitDiagnostic({
                    file: full,
                    severity: "warning",
                    message: `unparseable item JSON, skipping: ${err.message}`,
                });
                continue;
            }
            const shortcode = doc?.system?.shortcode;
            if (!doc?.type || !shortcode) continue;
            const address = catalogueKey(doc.type, shortcode);
            // eslint-disable-next-line no-unused-vars
            const { _key, ...rest } = doc;
            // Its own package-qualified address, which a `model:` naming that
            // package resolves through and nothing local can shadow (#334).
            if (foreignPackage) {
                map.set(catalogueKey(doc.type, shortcode, foreignPackage), rest);
            }
            if (map.has(address)) {
                // Deliberate: this repository defines it, so its version wins.
                if (source.has(address)) shadowed.push(address);
                continue;
            }
            map.set(address, rest);
        }
    }
    if (shadowed.length) {
        log.info(
            `${shadowed.length} dependency item(s) shadowed by this ` +
                `repository's own: ${shadowed.slice(0, 5).join(", ")}` +
                (shadowed.length > 5 ? ", …" : ""),
        );
    }
    return map;
}

/**
 * The Actor compile pass of one game system.
 *
 * A subclass declares its {@link SystemActorCompiler.documentSubtypes} and
 * implements `buildEntry`, which is where the system's own data model is: what
 * an actor's `system` block holds, which art it defaults to, which frontmatter
 * becomes embedded items. Nothing above that line is a system's business.
 */
export class SystemActorCompiler extends BasePackCompiler {
    static id = "actors";
    static label = "actor";

    /**
     * Which `(actor, subType:identity)` each resolved entry claimed, and the
     * entry that claimed it first.
     *
     * The scope the check needs is **one note**, and the actor's id supplies it
     * for free: it is unique per note, so keying the map by it scopes the claim
     * without this having to be told where a note begins and ends. That matters
     * because {@link SystemActorCompiler#resolveEmbedded} is called per entry
     * and has no note lifecycle of its own.
     *
     * `frontmatter-lint.mjs` makes the same finding from frontmatter alone
     * (#228), and this does not replace it — the lint is a separate command, so
     * without a check here a colliding pair would compile to two documents with
     * one `_id` and reach the LevelDB packer as an opaque duplicate key.
     *
     * @type {Map<string, string>}
     */
    #embeddedClaims = new Map();

    // An actor's embedded items are resolved against the *output* of the item
    // passes, so every Item pack compiles before this one. Declared rather than
    // left to the order `packs:` happens to list (#73).
    static readsPackOutputOf = Object.freeze(["Item"]);

    /**
     * An Actor **is** a system's data, so this pack takes only notes carrying
     * this system's block (#58).
     */
    static requiresSystemBlock = true;

    /**
     * The note-type → document-subtype map this pass compiles against.
     *
     * Stated by the class rather than reached for through a module import, so
     * every subtype decision the pass makes — the actor's own, and each
     * embedded item reference's — reads one declaration that a subclass
     * compiling for another system replaces.
     *
     * @type {import("./document-subtypes.mjs").DocumentSubtypeMap|undefined}
     */
    static documentSubtypes = undefined;

    /** @type {readonly string[]} */
    itemsSourceDirs;
    foreignSourceDirs;

    /**
     * Every package a `model:` may name besides this one — the dependencies
     * whose item catalogues were supplied (#334).
     *
     * @returns {Set<string>} The dependency package ids.
     */
    get foreignPackages() {
        return new Set(
            (this.foreignSourceDirs ?? [])
                .map((entry) => (typeof entry === "string" ? null : entry?.package))
                .filter(Boolean),
        );
    }

    constructor({ itemsSourceDirs = [], foreignSourceDirs = [], ...options }) {
        super(options);
        // Where the items passes wrote their JSON. Stated by the caller rather
        // than assumed to be this pack's sibling: the packs' locations are
        // configuration, and a consumer may put them anywhere (#1508). Every
        // Item pack, because a repository may ship more than one (#1566).
        //
        // **Optional, and empty is a legitimate package (#49).** This used to
        // throw unless at least one Item pack was declared, which asked a
        // package to declare the very thing it may exist not to have. An Item
        // pack is system-bound by construction — Foundry requires `system` on
        // Item packs — so a deliberately system-agnostic module could satisfy
        // the guard only by naming a system. `harn-ensemble` is the case:
        // 2,512 beings whose embedded items address the `sohl` and `hm3`
        // catalogues, and five affiliation notes of its own.
        //
        // The guard also did not test what it claimed. It counted *declared
        // directories*, not resolvable items, so an empty Item pack satisfied
        // it while a being naming a missing item still failed later. The
        // condition actually cared about is checked where it can be reported
        // precisely: {@link SystemActorCompiler#resolveEmbedded} already errors
        // per unresolved `(type, shortcode)`, naming the actor. A package whose
        // actors embed nothing, or whose every address resolves against a
        // dependency catalogue through `foreignSourceDirs`, now compiles with
        // no Item pack at all — and one that is genuinely missing an item
        // still fails, saying which item and which actor rather than which
        // pack is absent.
        Object.defineProperty(this, "itemsSourceDirs", {
            value: Object.freeze([...itemsSourceDirs]),
            writable: false,
        });
        // The dependency catalogues, if any. Not required: a repository that
        // holds every item its actors name needs none, and one that declares
        // no `itemCatalog: true` relationship gets an empty list.
        Object.defineProperty(this, "foreignSourceDirs", {
            value: Object.freeze([...foreignSourceDirs]),
            writable: false,
        });
    }

    /**
     * This pass's system map, or a message naming the class that forgot it.
     *
     * @returns {import("./document-subtypes.mjs").DocumentSubtypeMap} The map.
     */
    get documentSubtypes() {
        const map = /** @type {typeof SystemActorCompiler} */ (this.constructor).documentSubtypes;
        if (!map) {
            throw new Error(
                `${this.constructor.name} declares no \`documentSubtypes\` — an ` +
                    `Actor pass reads its system's map to know which notes it ` +
                    `claims and what each becomes.`,
            );
        }
        return map;
    }

    /**
     * The frontmatter block this pass reads.
     *
     * @returns {string} The system's block name.
     */
    get system() {
        return this.documentSubtypes.block;
    }

    /**
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a note type the system maps onto an `Actor`.
     */
    selects(fm) {
        return mapsNoteType(this.documentSubtypes, fm.type, "Actor");
    }

    /**
     * The predefined items each actor's embedded items resolve against, loaded
     * before the walk from the items passes' output.
     *
     * @returns {Promise<void>}
     */
    async prepare() {
        await super.prepare();
        this.itemsMap = loadItemsMap(this.itemsSourceDirs, this.foreignSourceDirs);
        log.info(`Loaded ${this.itemsMap.size} predefined items for actor resolution`);
    }

    /** @inheritdoc */
    reportDetail(stats) {
        log.debug(
            `Skipped ${stats.skippedOther} non-actor file(s) ` +
                `(not ${noteTypesFor(this.documentSubtypes, "Actor").join("/")}, ` +
                `package:${contentPackage()})`,
        );
    }

    /**
     * The Foundry Item subtype an embedded reference's `type` addresses.
     *
     * **The reference is in the note vocabulary; the address is in the
     * document's** (#140). An actor writes `(type, shortcode)` with the type an
     * author authors, while {@link itemAddress} keys the predefined items by
     * the subtype each compiled document carries — so exactly one of the two
     * sides has to translate, and it is this one. The system's map is a
     * function from note type to subtype by construction; the reverse is not,
     * and a compiled document records nothing about the note that produced it,
     * so there is no honest way to key the addresses the other way round.
     *
     * @param {string} type - The type the reference names.
     * @returns {import("./document-subtypes.mjs").ReferencedSubtype} The
     *   subtype, or why the reference names none.
     */
    embeddedSubtype(type) {
        return referencedSubtype(this.documentSubtypes, type, "Item");
    }

    /**
     * Resolve one embedded item from a `(type, shortcode?, overlay)`
     * descriptor. If `shortcode` is given, the predefined item is fetched
     * from `itemsMap` and the overlay deep-merged on top. If absent, the
     * descriptor must carry enough fields to stand alone. The embedded
     * item's `_id` is regenerated deterministically from
     * `(actorId, subType, shortcode, indexKey)` so re-exports are stable —
     * from the **document subtype**, so that renaming a note type (#78) leaves
     * every embedded id exactly where it was.
     * Returns null if the descriptor cannot be resolved.
     *
     * @param {Map<string, object>} itemsMap - The predefined items, by address.
     * @param {string} actorId - The owning actor's id, seeding embedded ids.
     * @param {string} type - The **note** type the reference names.
     * @param {string|null} shortcode - The referenced item's shortcode, or
     *   `null` for a stand-alone entry.
     * @param {object} [overlay] - The entry's remaining properties.
     * @param {string} indexKey - Where the reference sits, for a diagnostic.
     *   It no longer reaches the id (#268) — it names the entry in a message.
     * @param {string} ctx - Diagnostic context (the actor's label).
     * @param {object} [at] - Where to locate a finding.
     * @param {string} [at.fmKey] - The frontmatter key the reference sits
     *   under, so an unresolved one is reported at the reference rather than
     *   at the note.
     * @returns {object|null} The embedded item, or null when it resolved to
     *   nothing — always with a finding emitted.
     */
    /**
     * Read an entry's `model:` — the address of the item it is a copy of.
     *
     * The address grammar is the wikilink one (#336), so a `model` is written at
     * whatever length says what it means: `skill-wpnc` within this package,
     * `sohl-sohl-skill-wpnc` to reach another. The system segment defaults from
     * the block the entry sits in — `<system>.items` — which is what makes the
     * short form name an *Item* here while the same string in body prose names
     * a page.
     *
     * It replaced a top-level `shortcode:` that meant something different from
     * the `system.shortcode` beside it and could not say which package a
     * template came from (#334).
     *
     * @param {unknown} model - The authored value.
     * @param {number} index - The entry's position, for the message.
     * @param {string} ctx - Diagnostic context (the actor's label).
     * @returns {{type: string, shortcode: string, package: string|null}|null}
     *   The parsed address, or `null` after reporting why it is not one.
     */
    readModel(model, index, ctx) {
        const key = `${this.documentSubtypes.block}.items`;
        const where = () =>
            locateFrontmatterKey(this.currentNote?.absPath, "items", String(model ?? ""));
        if (typeof model !== "string" || !model.trim()) {
            this.noteError(`${ctx}: ${key}[${index}] \`model\` must be an address`, where());
            this.errorCount++;
            return null;
        }
        // The types this system maps, which are the ones a `model` may name, and
        // every package one may reach: this repository's own plus each
        // dependency whose item catalogue was loaded.
        const types = new Set(Object.keys(this.documentSubtypes.types));
        const packages = new Set([contentPackage(), ...this.foreignPackages]);
        const read = readQualifier(model.trim(), types, packages);
        if (!read || read.reason) {
            const why =
                read?.reason === "not-lowercase" ?
                    "capitalises a package, system or type segment — those three " +
                    "are lowercase, and only the shortcode keeps its case"
                : read?.reason === "unknown-type" ? "names no known content type"
                : "is not an address — write `type-shortcode`, or " +
                    "`package-system-type-shortcode` for another package's item";
            this.noteError(`${ctx}: ${key}[${index}] \`model: ${model}\` ${why}`, where());
            this.errorCount++;
            return null;
        }
        return { type: read.type, shortcode: read.shortcode, package: read.package ?? null };
    }

    resolveEmbedded(
        itemsMap,
        actorId,
        type,
        shortcode,
        overlay,
        indexKey,
        ctx,
        { fmKey, modelPackage = null } = {},
    ) {
        // Where a finding about this reference points. The value locates the
        // exact entry in a list; the key is the fallback when it cannot be
        // found, which still beats naming the note alone.
        const where = () =>
            locateFrontmatterKey(this.currentNote?.absPath, fmKey ?? "items", shortcode || type);

        const { subType, problem } = this.embeddedSubtype(type);
        if (problem) {
            this.noteError(`${ctx}: ${indexKey}: ${problem}`, where());
            this.errorCount++;
            return null;
        }
        // A `model:` may name the package its template comes from (#334). Where
        // it does, the packaged address is used and nothing local can shadow
        // it; where it does not, the unqualified one is, and a local definition
        // still wins over a dependency's as it always has.
        const address = catalogueKey(
            /** @type {string} */ (subType),
            shortcode ?? "",
            modelPackage ?? undefined,
        );

        // The entry's `system:` overlay is merged verbatim, so it reaches the
        // document without passing a single field declaration — which left it
        // the one position a runtime-only field stayed authorable at once #330
        // closed the item note's own. Asked of the **overlay** rather than of
        // the merged result: the template it merges onto is a compiled
        // document, which by then carries none, and a finding has to name what
        // this note wrote.
        const [runtimeOnly] = runtimeOnlyIn(overlay?.system, itemFields(type, this.system));
        if (runtimeOnly) {
            this.noteError(
                `${ctx}: ${indexKey}: ` +
                    `${runtimeOnlyMessage(`${indexKey}.system.${runtimeOnly.to}`, runtimeOnly)}.`,
                where(),
            );
            this.errorCount++;
            return null;
        }

        let base = null;
        if (shortcode) {
            base = itemsMap.get(address);
            if (!base) {
                // Both vocabularies where they differ, so an author sees why an
                // address they wrote did not land where they expected.
                const translated =
                    subType === type ? "" : (
                        ` (looked up as "${address}", the ` +
                        `${this.documentSubtypes.system} Item subtype a ` +
                        `"${type}" note compiles into)`
                    );
                this.noteError(
                    `${ctx}: no predefined item for "${type}:${shortcode}"${translated}`,
                    where(),
                );
                this.errorCount++;
                return null;
            }
            base = stripCompendiumFields(base);
        } else if (overlay && overlay.name && overlay.system) {
            base = { type: subType, name: overlay.name, system: {} };
        } else {
            this.noteError(
                `${ctx}: embedded item missing shortcode and not enough fields to stand alone`,
                where(),
            );
            this.errorCount++;
            return null;
        }
        const merged = overlay ? deepMerge(base, overlay) : base;
        merged.type = subType;
        const identity = embeddedIdentity(merged);
        const claim = `${actorId}\u0000${itemAddress(/** @type {string} */ (subType), identity)}`;
        const first = this.#embeddedClaims.get(claim);
        if (first !== undefined) {
            this.noteError(
                `${ctx}: ${indexKey}: ` +
                    `"${itemAddress(/** @type {string} */ (subType), identity)}" is ` +
                    `already the identity of "${first}" on this actor. ` +
                    `(type, shortcode) says *which entity* an embedded item is, ` +
                    `so two entries sharing one denote a single thing and every ` +
                    `lookup by it is ambiguous. Give this entry its own ` +
                    `\`system.shortcode\`` +
                    (shortcode ?
                        ` — a top-level \`shortcode\` only selects the template ` +
                        `this entry is written from and never reaches the document`
                    :   "") +
                    `, or delete it if it is a duplicate.`,
                where(),
            );
            this.errorCount++;
            return null;
        }
        this.#embeddedClaims.set(claim, indexKey);
        merged._id = embeddedItemId(actorId, /** @type {string} */ (subType), identity);
        // Foundry's pack compiler flattens the document hierarchy into LevelDB,
        // storing each embedded document under its own `_key`. Embedded items
        // therefore need a hierarchical key, as do any effects they carry
        // (re-keyed under this actor's item rather than the items-pack key they
        // inherited). Mirrors the items pack convention in the Item compiler.
        merged._key = `!actors.items!${actorId}.${merged._id}`;
        if (Array.isArray(merged.effects)) {
            for (const effect of merged.effects) {
                if (!effect?._id) continue;
                effect._key = `!actors.items.effects!${actorId}.${merged._id}.${effect._id}`;
            }
        }
        return merged;
    }
}
