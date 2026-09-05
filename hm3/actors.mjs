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
 * **HM3's Actor pass** — what an HM3 `character` or `creature` holds.
 *
 * The machinery is {@link module:engine/actor-compiler}'s and is shared with
 * the SoHL pass: the predefined-item catalogue, the note-vocabulary →
 * document-subtype translation each embedded reference goes through (#140), the
 * merge and the stable embedded ids. This module states HM3's data model and
 * nothing else.
 *
 * **A being note is one Actor per system, and the subtype is authored.** HM3
 * splits what a note calls a `being` into a `character` and a `creature`, and
 * nothing in the note's own vocabulary partitions cleanly onto that split — so
 * the note says which, by writing `hm3.type`. An absent one is an error naming
 * the note, never a default (#139).
 *
 * **What is emitted, and what is deliberately not.** Four rows of the content
 * format's `being` mapping table give HM3 a destination — `data.portrait` →
 * `system.bioImage`, `data.species`, `data.gender`, `data.occupation`, and
 * `data.templatePriority` → `flags.hm3.templatePriority` — plus the two anchored
 * prose sections: `{#appearance}` is HM3's `description` and `{#dossier}` its
 * `biography`. Everything else an HM3 actor carries — the thirteen abilities,
 * the sunsign, `move`, `fatigue`, `shockIndex`, a creature's `loadRating` — has
 * no shared source stated anywhere, so it is authored at its own path under
 * `hm3.system` and reaches the document through the verbatim passthrough. It is
 * checked against HM3's published `schema.json` like everything else; it simply
 * is not invented here.
 *
 * `gender` and `occupation` are written **only on a `character`**, because that
 * is the only subtype HM3 declares them on. Emitting them on a creature would
 * be a key Foundry discards at load without a word — which is exactly what the
 * emitted-`system` check would report, on every creature in the pack.
 *
 * @module
 */

import log from "loglevel";

import { resolveName, resolveImg } from "../engine/helpers.mjs";
import { buildFromFields, readField, STRING } from "../engine/field-spec.mjs";
import { SystemActorCompiler } from "../engine/actor-compiler.mjs";
import { renderSection } from "../engine/anchored-sections.mjs";
import { documentSubtype } from "../engine/document-subtypes.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";
// The note-level `hm3:` block: `hm3.system` onto the document's `system`
// verbatim, and `hm3.img` / `hm3.items` / `hm3.effects` / `hm3.flags`
// overriding their shared top-level forms for this system alone (#58).
import { blockField, blockProperty, mergeSystemData } from "../engine/system-block.mjs";

/**
 * The shared `data:` facts every HM3 actor takes, whatever its subtype.
 *
 * Declared rather than read by hand, so a value resolves by the same order
 * every other declared field does — `hm3.system.<to>` first, then the in-block
 * position, then the shared source, then the default (#58) — and so the
 * author-facing reference can be generated from the same statement the compiler
 * obeys (#22).
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const ACTOR_FIELDS = Object.freeze([
    {
        name: "species",
        to: "species",
        ...STRING,
        default: "",
        describe: "The kind of creature this is.",
    },
]);

/**
 * The two `data:` facts HM3 declares on a `character` and not on a `creature`.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const CHARACTER_FIELDS = Object.freeze([
    {
        name: "gender",
        to: "gender",
        ...STRING,
        default: "",
        describe: "The character's gender.",
    },
    {
        name: "occupation",
        to: "occupation",
        ...STRING,
        default: "",
        describe: "What the character does for a living.",
    },
]);

/**
 * The template priority a note declares, which HM3 keeps in flags.
 *
 * @type {import("../engine/field-spec.mjs").FieldSpec}
 */
const TEMPLATE_PRIORITY = Object.freeze({
    name: "templatePriority",
    to: "templatePriority",
    shape: "number or unset",
    kind: "number",
    read: (raw) => (raw == null || raw === "" ? null : Number(raw)),
    default: null,
    describe: "Template priority; unset for an actor that is not a template.",
});

/**
 * Default art per HM3 actor **subtype**, applied when the note supplies no
 * `img` / `portrait`.
 *
 * The two paths HM3's own actor model and migration use, so a compiled actor
 * looks like one created in the client.
 *
 * @type {Readonly<Record<string, string>>}
 */
const DEFAULT_IMG = Object.freeze({
    character: "systems/hm3/images/svg/knight-silhouette.svg",
    creature: "systems/hm3/images/svg/monster-silhouette.svg",
});

/**
 * The default art for an HM3 actor subtype.
 *
 * Fail-fast, for the reason the item art map is: a subtype with no art would
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
            `No default art for HM3 actor subtype "${subType}" — add an entry ` +
                `to \`DEFAULT_IMG\` in hm3/actors.mjs, beside the map row that ` +
                `introduced the subtype.`,
        );
    }
    return img;
}

export class Hm3Actors extends SystemActorCompiler {
    /**
     * HM3's note-type → document-subtype map — the one declaration that says
     * which block this pass reads, which notes it claims, and what each
     * becomes. It is also what every embedded reference is translated through.
     *
     * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
     */
    static documentSubtypes = HM3_DOCUMENT_SUBTYPES;

    /**
     * Compile one `being` note into its HM3 actor document.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved.
     * @returns {object} The actor document, keyed for the pack.
     */
    buildEntry(fm, markdown) {
        return this.buildActor(this.itemsMap, fm, markdown);
    }

    /**
     * Build every embedded item an HM3 actor carries, from `hm3.items`.
     *
     * One list, not two: HM3 keeps a character's abilities in `system.abilities`
     * rather than as embedded documents, so there is no attributes map to
     * expand the way SoHL's pass expands `sohl.attributes`.
     *
     * @param {Map<string, object>} itemsMap - The predefined items, by address.
     * @param {string} actorId - The owning actor's id, seeding embedded ids.
     * @param {object} fm - The note's frontmatter.
     * @param {string} ctx - Diagnostic context (the actor's label).
     * @returns {object[]} The embedded items.
     */
    buildEmbeddedItems(itemsMap, actorId, fm, ctx) {
        const items = [];
        const declared = blockField(fm, this.system, "items", null);
        if (!Array.isArray(declared)) return items;

        declared.forEach((entry, index) => {
            if (!entry || typeof entry !== "object") {
                this.noteError(`${ctx}: ${this.system}.items[${index}] is not an object`);
                this.errorCount++;
                return;
            }
            const { shortcode, type, ...rest } = entry;
            if (!type) {
                this.noteError(`${ctx}: ${this.system}.items[${index}] missing type`);
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
        return items;
    }

    /**
     * Build one HM3 actor document from a `being` note.
     *
     * @param {Map<string, object>} itemsMap - The predefined items, by address.
     * @param {object} fm - The note's frontmatter.
     * @param {string} body - The note body, converted.
     * @returns {object} The actor document, keyed for the pack.
     */
    buildActor(itemsMap, fm, body) {
        const block = this.system;
        const name = resolveName(fm);
        const id = fm.id;
        const ctx = `actor "${name}"`;
        // The document's own subtype, and the art that goes with it. Both are
        // looked up from the note's `type` rather than spelled here (#79); for
        // HM3 the row is one-to-many, so the note's `hm3.type` decides.
        const subType = /** @type {string} */ (
            documentSubtype(this.documentSubtypes, fm.type, fm, {
                absPath: this.currentNote?.absPath,
            })
        );
        const defaultImg = defaultActorImg(subType);

        const items = this.buildEmbeddedItems(itemsMap, id, fm, ctx);

        const folderId = blockField(fm, block, "folder", null);
        const folder = this.folderResolver(folderId);

        const system = {
            // Nullish, not `||` (#218): a note that names no portrait gets the
            // subtype's default, one that writes `""` ships blank on purpose.
            bioImage: resolveImg(blockProperty(fm, block, "portrait")) ?? defaultImg,
            description: renderSection(body || "", "appearance"),
            biography: renderSection(body || "", "dossier"),
            ...buildFromFields(ACTOR_FIELDS, { block })(fm),
            // Declared on `character` alone, so written there alone — see the
            // module note.
            ...(subType === "character" ? buildFromFields(CHARACTER_FIELDS, { block })(fm) : {}),
        };

        // Whatever the note authors under `hm3.system`, at the DataModel's own
        // paths (#58). This pass has no field declaration, so it claims
        // nothing: every authored path is the author's, and the fields above
        // are what a note that authors none still gets.
        mergeSystemData(system, fm, { block });
        this.reportUndeclaredSystemData(fm, block, "Actor", subType);
        // And what this pass wrote itself — there is no field declaration for a
        // being at all, so every key above is a compiler emission (#155).
        this.reportEmittedSystemData(system, {
            fm,
            block,
            documentType: "Actor",
            subType,
            type: fm.type,
        });

        const effects = blockProperty(fm, block, "effects");
        const img = resolveImg(blockProperty(fm, block, "img")) ?? defaultImg;

        return {
            name,
            type: subType,
            img,
            _id: id,
            system,
            items,
            prototypeToken: {
                name,
                displayName: 0,
                actorLink: false,
                texture: { src: img },
                width: 1,
                height: 1,
                sight: { enabled: false },
                detectionModes: [],
            },
            effects: Array.isArray(effects) ? [...effects] : [],
            folder,
            sort: 0,
            ownership: { default: 0 },
            // Whatever the note authors, plus the template priority — which HM3
            // keeps in flags rather than in `system`, so there is nowhere in
            // the data model for it to go.
            flags: this.actorFlags(fm, block),
            _stats: this.stats,
            _key: `!actors!${id}`,
        };
    }

    /**
     * The document's `flags`: whatever the note authors, plus this system's
     * template priority.
     *
     * `data.templatePriority` is the shared statement that a note is a
     * *template* — SoHL records the same fact as `system.archetype` — and HM3's
     * data model declares no field for it, so it lands under this system's own
     * flag scope. A note that is not a template writes nothing, rather than a
     * `null` nothing reads.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} block - This pass's system block.
     * @returns {object} The flags to emit.
     */
    actorFlags(fm, block) {
        const authored = blockProperty(fm, block, "flags", {});
        const value = readField(TEMPLATE_PRIORITY, fm, { block });
        if (value == null) return authored;
        if (!Number.isFinite(value)) {
            log.warn(
                `${resolveName(fm)}: \`data.templatePriority\` is not a ` +
                    `number; no template flag written.`,
            );
            return authored;
        }
        return {
            ...authored,
            [block]: {
                .../** @type {Record<string, unknown>} */ (authored)[block],
                templatePriority: value,
            },
        };
    }
}
