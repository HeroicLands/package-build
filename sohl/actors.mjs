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
 * **SoHL's Actor pass** — what a SoHL `being` document holds, and nothing else.
 *
 * The machinery an actor of any system needs — the predefined-item catalogue,
 * reference translation through the system's map, embedding and its stable ids,
 * the anchored prose sections — lives in
 * {@link module:engine/actor-compiler}, where a second system reaches it
 * (#139). What is left here is SoHL's data model: the body structure and its
 * movement profiles, the attributes-and-items frontmatter that becomes embedded
 * documents, the opening mastery level a skill is baked with, and the `system`
 * block itself.
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
 * Attributes (`sohl.attributes` map) become embedded attribute items with
 * `scoreBase` set from the map value. Each entry in `sohl.items` is similarly
 * resolved by `(type, shortcode)` and deep-merged with the entry's other
 * properties. `sohl.skills` is ignored.
 *
 * Not a standalone script — exports the `Actors` compiler class, imported and
 * driven by `engine/generate.mjs`. Must run after the items passes, since it
 * reads their generated JSON trees.
 *
 * @module
 */

import {
    sohlField,
    resolveName,
    resolveImg,
    systemArchetype,
    folderField,
} from "../engine/helpers.mjs";
import { openingMasteryLevel } from "./skill-base.mjs";
import { SystemActorCompiler, renderSection } from "../engine/actor-compiler.mjs";
// Which Foundry Actor subtype a note's `type` compiles into. Looked up in the
// system's declared map, never inferred from the type itself (#79).
import { documentSubtype } from "../engine/document-subtypes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";
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

export class Actors extends SystemActorCompiler {
    /**
     * SoHL's note-type → document-subtype map — the one declaration that says
     * which block this pass reads, which notes it claims, and what each
     * becomes (#79). It is also what every embedded reference is translated
     * through, which is why a subclass replaces one thing and not two.
     *
     * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
     */
    static documentSubtypes = SOHL_DOCUMENT_SUBTYPES;

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

        const { value: authoredFolder, isPath } = folderField(fm);
        const folder = this.folderResolver(authoredFolder, { isPath });

        const system = {
            // The frontmatter shortcode is the actor's stable `(type, shortcode)`
            // key — and, for a being that is an archetype, its archetype
            // identity (the dedup/override key of the Create-dialog picker, #604).
            shortcode: fm.shortcode || "",
            // Required nullable number: a priority, or `null` for a being that
            // is not an archetype (#126 / archetype contract #604).
            archetype: systemArchetype(fm, ctx),
            // Nullish, not `||` (#218): a note that names no portrait gets the
            // subtype's default, one that writes `""` ships blank on purpose.
            portrait: resolveImg(blockProperty(fm, SYSTEM, "portrait")) ?? defaultImg,
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
        // And what this pass wrote itself. There is no field declaration for a
        // being at all, so *every* key here is a compiler emission — including
        // `archetype` (#126), which nothing compared until #155.
        this.reportEmittedSystemData(system, {
            fm,
            block: SYSTEM,
            documentType: "Actor",
            subType,
            type: fm.type,
        });

        const effects = blockProperty(fm, SYSTEM, "effects");

        return {
            name,
            type: subType,
            // Nullish, not `||` — see the portrait above (#218).
            img: resolveImg(blockProperty(fm, SYSTEM, "img")) ?? defaultImg,
            _id: id,
            system,
            items,
            prototypeToken: {
                name,
                displayName: 0,
                actorLink: false,
                texture: { src: resolveImg(blockProperty(fm, SYSTEM, "img")) ?? defaultImg },
                width: 1,
                height: 1,
                sight: { enabled: false },
                detectionModes: [],
            },
            effects: Array.isArray(effects) ? [...effects] : [],
            folder,
            sort: 0,
            ownership: { default: 0 },
            // Whatever the note authors, and nothing else. `archetype` used to
            // be spliced in here as `flags.sohl.docArchetype`; it is a schema
            // field now and sits in `system` (#126).
            flags: blockProperty(fm, SYSTEM, "flags", {}),
            _stats: this.stats,
            _key: `!actors!${id}`,
        };
    }
}
