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
 * Actors pack compiler — produces JSON pack files for the "actors" Foundry
 * compendium from markdown `being` notes in the `assets/content/` tree.
 *
 * One content type today, and the actor subtype it produces is **declared**
 * rather than assumed to be the same word: `sohl/document-subtypes.mjs` maps
 * `being` → `Actor` / `being`, and this pass looks it up (#79). It read
 * `ACTOR_VAULT_TYPE = "being"` here and emitted `type: "being"` several hundred
 * lines below, which made the two vocabularies agree by coincidence.
 *
 * It was two content types — `character` and `creature` — which compiled to the
 * same `being` with no branch anywhere between them; they were retired in
 * SoHL#1580 and are now reported by `assertTypeNotRetired` in
 * `engine/ids.mjs`.
 *
 * Each actor's embedded items are resolved by looking `(type, shortcode)` up
 * against the generated JSON tree of every Item pack (built in prior items
 * passes and named by the caller as `itemsSourceDirs`). All of them, because a
 * repository may group its items into several Item packs (#1566) and a being
 * may hold items from any of them.
 * Attributes (`sohl.attributes` map) become embedded attribute items with
 * `scoreBase` set from the map value. Each entry in `sohl.items` is similarly
 * resolved by `(type, shortcode)` and deep-merged with the entry's other
 * properties. `sohl.skills` is ignored.
 *
 * **Those references are in the note vocabulary and the addresses are in the
 * document's**, and the difference is stated rather than assumed away (#140):
 * {@link itemAddress} keys a predefined item by the subtype its compiled
 * document carries, and {@link Actors#embeddedSubtype} translates each
 * authored reference forward through the system's map before the lookup. A
 * reference that then resolves to nothing is a finding naming the note and the
 * reference — never an item quietly missing from the compiled actor.
 *
 * Not a standalone script — exports the `Actors` compiler class, imported and
 * driven by `packages/content-build/engine/generate.mjs` (via `npm run build:compiledb`). Must run
 * after the items pass, since it reads the items pack's generated JSON tree.
 *
 * The walk itself — filtering by type, expanding tables, converting
 * wikilinks, writing the JSON and counting errors — belongs to {@link sohl.utils.packs.BasePackCompiler}; this module
 * states only what makes this pass its own (#1509).
 */

import fs from "fs";
import path from "path";
import log from "loglevel";

import {
    sohlField,
    getFrontmatter,
    makeId,
    resolveName,
    resolveImg,
    defaultStats,
    withArchetypeFlag,
    md,
} from "../engine/helpers.mjs";
import { emitDiagnostic } from "../engine/diagnostics.mjs";
import { openingMasteryLevel } from "./skill-base.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { contentPackage } from "../engine/content-package.mjs";
// Which Foundry Actor subtype a note's `type` compiles into, and which note
// types are actors at all. Looked up in the system's declared map, never
// inferred from the type itself (#79).
import {
    documentSubtype,
    mapsNoteType,
    noteTypesFor,
    referencedSubtype,
} from "../engine/document-subtypes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";
import { locateFrontmatterKey } from "../engine/retired-fields.mjs";
// The note-level `sohl:` block: `sohl.system` onto the document's `system`
// verbatim, and `sohl.img` / `sohl.effects` / `sohl.flags` overriding their
// shared top-level forms for this system alone (#58).
import { blockProperty, mergeSystemData } from "../engine/system-block.mjs";

/**
 * The system this pass compiles for — the block its notes write.
 *
 * Read from the map rather than spelled here, so the block name and the subtype
 * map are one statement (#58/#79).
 *
 * @type {string}
 */
const SYSTEM = SOHL_DOCUMENT_SUBTYPES.block;

/**
 * The note types this pass claims — every one the system's map sends to an
 * `Actor`.
 *
 * Read from the map rather than restated as a constant. It *was* a constant:
 * `ACTOR_VAULT_TYPE = "being"` sat here and `type: "being"` was emitted several
 * hundred lines below, with nothing relating them, so a change to either
 * followed the other only by coincidence (#79).
 *
 * @type {readonly string[]}
 */
const ACTOR_NOTE_TYPES = Object.freeze(noteTypesFor(SOHL_DOCUMENT_SUBTYPES, "Actor"));

// Default art per actor **subtype**, applied when frontmatter supplies no `img`
// / `portrait`. Beings default to the generic person icon; another subtype adds
// its own entry here as the map gains a row for it.
const DEFAULT_IMG = {
    being: "systems/sohl/assets/icons/game-icons/delapouite/person.svg",
};

/**
 * The default art for an actor subtype.
 *
 * Fail-fast, for the reason {@link itemArt} is: a subtype with no art would
 * otherwise ship a document with no image and nothing said about it.
 *
 * @param {string} subType - The Foundry actor subtype.
 * @returns {string} The default image path.
 * @throws {Error} When this map pairs no art with the subtype.
 */
function defaultActorImg(subType) {
    const img = /** @type {Record<string, string|undefined>} */ (DEFAULT_IMG)[subType];
    if (!img) {
        throw new Error(
            `No default art for actor subtype "${subType}" — add an entry to ` +
                `\`DEFAULT_IMG\` in sohl/actors.mjs, beside the map row that ` +
                `introduced the subtype.`,
        );
    }
    return img;
}

/**
 * Strip compendium-only fields from a predefined item before embedding it
 * inside an actor's `items[]`. These fields belong on a top-level
 * compendium document, not on an embedded one.
 */
function stripCompendiumFields(item) {
    // eslint-disable-next-line no-unused-vars
    const { _key, _stats, ownership, folder, ...rest } = item;
    return rest;
}

/**
 * Recursively merge `overlay` onto `base`. Plain objects merge key-by-key;
 * everything else (arrays, primitives, null) replaces. Inputs are not
 * mutated.
 */
function deepMerge(base, overlay) {
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

function isPlainObject(v) {
    return (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) === Object.prototype
    );
}

/**
 * Normalize a being's persisted `system.body` from a `sohl.body` block. The
 * authoring frontmatter mirrors the schema field-for-field: `sohl.body` nests
 * `structure` / `weight` / `reachBase` / `bodyScaleBase` / `personalFatigue`,
 * exactly like `system.body`.
 */
function normalizeBody(bodyObj) {
    const b = bodyObj && typeof bodyObj === "object" ? bodyObj : {};
    const weight = b.weight || {};
    return {
        structure: b.structure ?? { parts: [], adjacent: [] },
        weight: {
            base: weight.base == null ? null : Number(weight.base),
            calc: String(weight.calc ?? "0"),
        },
        reachBase: Number(b.reachBase ?? 0) || 0,
        bodyScaleBase: Number(b.bodyScaleBase ?? 1) || 1,
        personalFatigue: String(b.personalFatigue ?? "enc"),
    };
}

/** Normalize per-medium movement profiles from a `sohl.movementProfiles` list. */
function normalizeMovementProfiles(list) {
    return (Array.isArray(list) ? list : []).map((p) => ({
        medium: String(p.medium ?? "terrestrial"),
        feetPerRound: Number(p.feetPerRound ?? 0) || 0,
        leaguesPerWatch: Number(p.leaguesPerWatch ?? 0) || 0,
        encumbrance: String(p.encumbrance ?? "0"),
        strMod: String(p.strMod ?? "0"),
        disabled: Boolean(p.disabled ?? false),
    }));
}

/**
 * Extract a being's body (+ its movement) from a `sohl` block that mirrors the
 * schema: `sohl.body` (nested → `system.body`) and the flat
 * `sohl.currentMoveMedium` / `sohl.movementProfiles` (→ the base-actor movement
 * fields; movement is a universal actor capability, not part of the body).
 */
function extractBodyAndMovement(fm) {
    return {
        body: normalizeBody(sohlField(fm, "body", {})),
        currentMoveMedium: String(sohlField(fm, "currentMoveMedium", "none")),
        movementProfiles: normalizeMovementProfiles(sohlField(fm, "movementProfiles", [])),
    };
}

/**
 * The key one predefined item is held under, and every place that spells it.
 *
 * **The vocabulary is the document's, not the note's** — `subType` is the
 * Foundry Item subtype the compiled document carries, which is the only thing a
 * compiled pack (or an extracted dependency catalogue) records about what an
 * item *is*. A being's frontmatter addresses the same item in the *note*
 * vocabulary, so a reference is translated forward through the system's map
 * before it reaches this function; see {@link Actors#embeddedSubtype} for why
 * the translation goes that way and not the other (#140).
 *
 * @param {string} subType - The Foundry Item subtype.
 * @param {string} shortcode - The item's `system.shortcode`.
 * @returns {string} The address, `subType:shortcode`.
 */
function itemAddress(subType, shortcode) {
    return `${subType}:${shortcode}`;
}

/**
 * Load every JSON file under each of `itemsSourceDirs`, returning one Map keyed
 * by {@link itemAddress} — the compiled document's **subtype** and its
 * `system.shortcode`. Folder docs and entries without a shortcode are skipped.
 * The `_key` field is stripped from each entry — it is not part of the item
 * data model.
 *
 * The directories are read as one address space, because a being names an item
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
function loadItemsMap(itemsSourceDirs, foreignSourceDirs = []) {
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
                    `a being resolves its embedded items against the Item ` +
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
            const address = itemAddress(doc.type, shortcode);
            const owner = source.get(address);
            if (owner && owner !== itemsSourceDir) {
                throw new Error(
                    `Two Item packs both define "${address}" (${owner} and ` +
                        `${itemsSourceDir}); a being addresses an item by ` +
                        `(type, shortcode), so the address must be unique across ` +
                        `every Item pack`,
                );
            }
            source.set(address, itemsSourceDir);
            // eslint-disable-next-line no-unused-vars
            const { _key, ...rest } = doc;
            map.set(address, rest);
        }
    }
    for (const foreignDir of foreignSourceDirs) {
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
            const address = itemAddress(doc.type, shortcode);
            if (map.has(address)) {
                // Deliberate: this repository defines it, so its version wins.
                if (source.has(address)) shadowed.push(address);
                continue;
            }
            // eslint-disable-next-line no-unused-vars
            const { _key, ...rest } = doc;
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
 * Extract the body of an H1 section whose heading carries the explicit
 * anchor decorator `{#<anchorId>}`. Captures every line after the H1 up
 * to (but not including) the next H1 — nested H2/H3 etc. and their bodies
 * are included. The H1 line itself is discarded. Returns "" if no such
 * heading exists. Fenced code blocks are respected so `# foo` inside
 * ``` blocks does not trigger a match.
 */
function extractAnchorSection(body, anchorId) {
    const lines = body.split("\n");
    const captured = [];
    let inCodeBlock = false;
    let capturing = false;
    const wanted = String(anchorId).toLowerCase();
    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            if (capturing) captured.push(line);
            continue;
        }
        const h1Match = !inCodeBlock ? line.match(/^\s*#\s+(.+?)\s*#*\s*$/) : null;
        if (h1Match) {
            const anchor = h1Match[1].match(/\{#([^}]+)\}\s*$/);
            const id = anchor?.[1]?.trim().toLowerCase() || null;
            if (capturing) break;
            if (id === wanted) {
                capturing = true;
                continue;
            }
        }
        if (capturing) captured.push(line);
    }
    return captured.join("\n").trim();
}

/**
 * Render an extracted markdown section to HTML, or "" if empty.
 */
function renderSection(body, anchorId) {
    const slice = extractAnchorSection(body, anchorId);
    return slice ? md.render(slice) : "";
}

export class Actors extends BasePackCompiler {
    static id = "actors";
    static label = "actor";

    // A being's embedded items are resolved against the *output* of the item
    // passes, so every Item pack compiles before this one. Declared rather than
    // left to the order `packs:` happens to list (#73).
    static readsPackOutputOf = Object.freeze(["Item"]);

    /** @type {readonly string[]} */
    itemsSourceDirs;
    foreignSourceDirs;

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
        // precisely: {@link Actors#resolveEmbedded} already errors per
        // unresolved `(type, shortcode)`, naming the being. A package whose
        // beings embed nothing, or whose every address resolves against a
        // dependency catalogue through `foreignSourceDirs`, now compiles with
        // no Item pack at all — and one that is genuinely missing an item
        // still fails, saying which item and which actor rather than which
        // pack is absent.
        Object.defineProperty(this, "itemsSourceDirs", {
            value: Object.freeze([...itemsSourceDirs]),
            writable: false,
        });
        // The dependency catalogues, if any. Not required: a repository that
        // holds every item its beings name needs none, and one that declares
        // no `itemCatalog: true` relationship gets an empty list.
        Object.defineProperty(this, "foreignSourceDirs", {
            value: Object.freeze([...foreignSourceDirs]),
            writable: false,
        });
    }

    /**
     * The note-type → document-subtype map this pass compiles against.
     *
     * Stated by the class rather than reached for through the module import, so
     * every subtype decision the pass makes — the actor's own, and each
     * embedded item reference's — reads one declaration that a subclass
     * compiling for another system can replace. That is also what lets the
     * non-identity behaviour be exercised without introducing a non-identity
     * row into SoHL's own map, which is #78's job and moves compiled bytes.
     *
     * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
     */
    static documentSubtypes = SOHL_DOCUMENT_SUBTYPES;

    /**
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a note type the system maps onto an `Actor`.
     */
    selects(fm) {
        return mapsNoteType(this.constructor.documentSubtypes, fm.type, "Actor");
    }

    /**
     * An Actor **is** a system's data, so this pack takes only notes carrying
     * this system's block (#58).
     */
    static requiresSystemBlock = true;

    /**
     * The predefined items each being's embedded items resolve against, loaded
     * before the walk from the items passes' output.
     *
     * @returns {Promise<void>}
     */
    async prepare() {
        await super.prepare();
        this.itemsMap = loadItemsMap(this.itemsSourceDirs, this.foreignSourceDirs);
        log.info(`Loaded ${this.itemsMap.size} predefined items for actor resolution`);
    }

    /**
     * Compile one `being` note into its actor document.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved.
     * @returns {object} The actor document, keyed for the pack.
     */
    buildEntry(fm, markdown) {
        return this.buildBeing(this.itemsMap, fm, markdown);
    }

    /** @inheritdoc */
    reportDetail(stats) {
        log.debug(
            `Skipped ${stats.skippedOther} non-actor file(s) ` +
                `(not ${ACTOR_NOTE_TYPES.join("/")}, package:${contentPackage()})`,
        );
    }

    /**
     * The Foundry Item subtype an embedded reference's `type` addresses.
     *
     * **The reference is in the note vocabulary; the address is in the
     * document's** (#140). A being writes `(type, shortcode)` with the type an
     * author authors, while {@link itemAddress} keys the predefined items by
     * the subtype each compiled document carries — so exactly one of the two
     * sides has to translate, and it is this one. The system's map is a
     * function from note type to subtype by construction; the reverse is not,
     * and a compiled document records nothing about the note that produced it,
     * so there is no honest way to key the addresses the other way round.
     *
     * The two vocabularies are the same string in every SoHL row today, which
     * is why looking a reference up verbatim worked. The first non-identity row
     * (#78: `armor` → `armorgear`) ends that, and a reference resolving to
     * nothing must be a finding rather than an item quietly missing from the
     * compiled actor.
     *
     * @param {string} type - The type the reference names.
     * @returns {import("../engine/document-subtypes.mjs").ReferencedSubtype}
     *   The subtype, or why the reference names none.
     */
    embeddedSubtype(type) {
        return referencedSubtype(this.constructor.documentSubtypes, type, "Item");
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
     * @param {string} indexKey - Distinguishes two references to one item.
     * @param {string} ctx - Diagnostic context (the actor's label).
     * @param {object} [at] - Where to locate a finding.
     * @param {string} [at.fmKey] - The frontmatter key the reference sits
     *   under, so an unresolved one is reported at the reference rather than
     *   at the note.
     * @returns {object|null} The embedded item, or null when it resolved to
     *   nothing — always with a finding emitted.
     */
    resolveEmbedded(itemsMap, actorId, type, shortcode, overlay, indexKey, ctx, { fmKey } = {}) {
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
        const address = itemAddress(/** @type {string} */ (subType), shortcode ?? "");

        let base = null;
        if (shortcode) {
            base = itemsMap.get(address);
            if (!base) {
                // Both vocabularies where they differ, so an author sees why an
                // address they wrote did not land where they expected.
                const translated =
                    subType === type ? "" : (
                        ` (looked up as "${address}", the ` +
                        `${this.constructor.documentSubtypes.system} Item subtype a ` +
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
        merged._id = makeId(
            actorId,
            `${itemAddress(/** @type {string} */ (subType), shortcode || merged.name)}:${indexKey}`,
        );
        // Foundry's pack compiler flattens the document hierarchy into LevelDB,
        // storing each embedded document under its own `_key`. Embedded items
        // therefore need a hierarchical key, as do any effects they carry
        // (re-keyed under this actor's item rather than the items-pack key they
        // inherited). Mirrors the items pack convention in items.mjs.
        merged._key = `!actors.items!${actorId}.${merged._id}`;
        if (Array.isArray(merged.effects)) {
            for (const effect of merged.effects) {
                if (!effect?._id) continue;
                effect._key = `!actors.items.effects!${actorId}.${merged._id}.${effect._id}`;
            }
        }
        return merged;
    }

    /**
     * Build all embedded items for an actor: one per `sohl.attributes`
     * entry plus one per `sohl.items` entry. `sohl.skills` is ignored.
     */
    buildEmbeddedItems(itemsMap, actorId, fm, ctx) {
        const items = [];

        const attributes = sohlField(fm, "attributes", null);
        if (attributes && typeof attributes === "object") {
            for (const [shortcode, value] of Object.entries(attributes)) {
                const overlay = { system: { scoreBase: Number(value) || 0 } };
                const embedded = this.resolveEmbedded(
                    itemsMap,
                    actorId,
                    "attribute",
                    shortcode,
                    overlay,
                    `attr:${shortcode}`,
                    ctx,
                    { fmKey: "attributes" },
                );
                if (embedded) items.push(embedded);
            }
        }

        const sohlItems = sohlField(fm, "items", null);
        if (Array.isArray(sohlItems)) {
            sohlItems.forEach((entry, index) => {
                if (!entry || typeof entry !== "object") {
                    this.noteError(`${ctx}: sohl.items[${index}] is not an object`);
                    this.errorCount++;
                    return;
                }
                const { shortcode, type, ...rest } = entry;
                if (!type) {
                    this.noteError(`${ctx}: sohl.items[${index}] missing type`);
                    this.errorCount++;
                    return;
                }
                const embedded = this.resolveEmbedded(
                    itemsMap,
                    actorId,
                    type,
                    shortcode || null,
                    rest,
                    `items:${index}`,
                    ctx,
                    { fmKey: "items" },
                );
                if (embedded) items.push(embedded);
            });
        }

        this.openUnopenedSkills(items, ctx);
        return items;
    }

    /**
     * Bake each unopened skill's opening mastery level into the document (#46).
     *
     * A skill whose `masteryLevelBase` is still null once the note's frontmatter
     * has been merged onto the catalogue entry is *not yet opened*, and the
     * client fills it in on import — `Skill Base × initSkillMult`, in
     * `SkillLogic.initialize`. Computing it here instead leaves the compiled
     * pack self-describing: what a being's skills open at is visible in the
     * document, reviewable in a diff, and testable without standing up Foundry.
     *
     * This runs last because the Skill Base formula reads the actor's
     * attributes, so every attribute item has to exist first. It only ever
     * fills nulls — a skill that states a `masteryLevelBase`, whether from the
     * catalogue or the note, keeps it untouched.
     *
     * **The scores used are the ones just written.** `SkillLogic` resolves
     * `attr.<code>` to an attribute's *effective* score, after active effects;
     * all this pass has is the `scoreBase` it set from `sohl.attributes`. For a
     * compiled being carrying no attribute-altering effects the two agree,
     * which is every being in content today. One that did carry such an effect
     * would bake a Skill Base its client then disagrees with — that is the
     * limit of doing this at build time, and the point to revisit if it bites.
     *
     * @param {object[]} items - The actor's embedded items, attributes included.
     * @param {string} ctx - Diagnostic context (the actor's label).
     */
    openUnopenedSkills(items, ctx) {
        const skills = items.filter(
            (item) => item.type === "skill" && item.system && item.system.masteryLevelBase == null,
        );
        if (!skills.length) return;

        const attrs = {};
        for (const item of items) {
            if (item.type !== "attribute") continue;
            const code = item.system?.shortcode?.toLowerCase();
            if (code) attrs[code] = Number(item.system.scoreBase) || 0;
        }

        for (const skill of skills) {
            const { value, error } = openingMasteryLevel(skill.system, attrs);
            if (error) {
                this.noteError(`${ctx}: skill "${skill.name}": ${error}`);
                this.errorCount++;
                continue;
            }
            if (value !== null) skill.system.masteryLevelBase = value;
        }
    }

    buildBeing(itemsMap, fm, body) {
        const name = resolveName(fm);
        const id = fm.id;
        const ctx = `actor "${name}"`;
        // The document's own subtype, and the art that goes with it. Both are
        // looked up from the note's `type` rather than spelled here (#79).
        const subType = /** @type {string} */ (
            documentSubtype(this.constructor.documentSubtypes, fm.type, fm, {
                absPath: this.currentNote?.absPath,
            })
        );
        const defaultImg = defaultActorImg(subType);

        const items = this.buildEmbeddedItems(itemsMap, id, fm, ctx);

        const folderId = sohlField(fm, "folder", null);
        const folder = this.folderResolver(folderId);

        const system = {
            // The frontmatter shortcode is the actor's stable `(type, shortcode)`
            // key — and, for a `docArchetype`-flagged being, its archetype
            // identity (the dedup/override key of the Create-dialog picker, #604).
            shortcode: fm.shortcode || "",
            portrait: resolveImg(blockProperty(fm, SYSTEM, "portrait")) || defaultImg,
            appearance: renderSection(body || "", "appearance"),
            dossier: renderSection(body || "", "dossier"),
        };

        // Fill `system.body` (+ the base-actor movement fields) from the being's
        // frontmatter, rather than embedding a corpus item (#535). The `sohl`
        // block mirrors `system` field-for-field: `sohl.body` nests the body
        // (`structure` / `weight` / …), with `currentMoveMedium` /
        // `movementProfiles` flat alongside it. An **incorporeal** being omits
        // `sohl.body` and keeps the schema's empty body.
        const bodyField = sohlField(fm, "body", null);
        if (bodyField && typeof bodyField === "object") {
            const bodyData = extractBodyAndMovement(fm);
            system.body = bodyData.body;
            system.currentMoveMedium = bodyData.currentMoveMedium;
            system.movementProfiles = bodyData.movementProfiles;
        } else if (bodyField != null) {
            this.noteError(
                `${ctx}: sohl.body must be an inline object (structure/weight/…), got ${typeof bodyField}`,
            );
            this.errorCount++;
        }

        // Being-only combat grouping (mirrors `system.defaultCombatGroup`).
        const defaultCombatGroup = sohlField(fm, "defaultCombatGroup", undefined);
        if (defaultCombatGroup !== undefined) {
            system.defaultCombatGroup = defaultCombatGroup;
        }

        // Whatever the note authors under `sohl.system`, at the DataModel's own
        // paths (#58). This pass has no field declaration, so it claims
        // nothing: every authored path is the author's, and the fields above
        // are what a note that authors none still gets.
        mergeSystemData(system, fm, { block: SYSTEM });
        this.reportUndeclaredSystemData(fm, SYSTEM, "Actor", subType);

        const effects = blockProperty(fm, SYSTEM, "effects");

        return {
            name,
            type: subType,
            img: resolveImg(blockProperty(fm, SYSTEM, "img")) || defaultImg,
            _id: id,
            system,
            items,
            prototypeToken: {
                name,
                displayName: 0,
                actorLink: false,
                texture: { src: resolveImg(blockProperty(fm, SYSTEM, "img")) || defaultImg },
                width: 1,
                height: 1,
                sight: { enabled: false },
                detectionModes: [],
            },
            effects: Array.isArray(effects) ? [...effects] : [],
            folder,
            sort: 0,
            ownership: { default: 0 },
            // `sohl.archetype` (required nullable number) drives
            // `flags.sohl.docArchetype` (#640 / archetype contract #604).
            flags: withArchetypeFlag(fm, blockProperty(fm, SYSTEM, "flags"), ctx),
            _stats: this.stats,
            _key: `!actors!${id}`,
        };
    }
}
