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
 * **SoHL's half of the infobox** — which of this system's facts a summary
 * panel carries, and how they group.
 *
 * The mechanism is `engine/infobox.mjs`; this is the declaration, which is the
 * `engine/` ÷ `sohl/` line everywhere else in the package. What a box looks
 * like is note-format knowledge. That an attribute score lives at
 * `system.scoreBase`, that a mystical ability is a practice or a knack, and
 * that a weapon strikes in modes is SoHL's.
 *
 * **Almost every type is read straight off its own field declaration.**
 * {@link NOTE_SCHEMAS} is the vocabulary the frontmatter linter checks against
 * and, for an item type, the very list the compiler obeys — so a field added
 * to a type reaches the box with no second edit anywhere.
 *
 * **Four types earn a builder of their own**, because their box is derived
 * rather than read field by field:
 *
 * - a **being**, whose attributes, skills, mystical abilities and carried gear
 *   are one flat `sohl.items` list that has to be sorted before it can be
 *   shown;
 * - **armour**, whose protection is shown as a full set of four aspects, with
 *   an unstated one rendered `0` rather than dropped — armour that stops
 *   nothing edged is a fact, not a gap;
 * - a **weapon**, whose strike modes are shown one per line, with an unstated
 *   value rendered `—` for the same reason;
 * - a **projectile**, whose impact is three declared fields composing into the
 *   one quantity a reader wants.
 *
 * Both placeholders are **data**, decided here, not a renderer's fallback.
 * That is what lets one generic renderer draw them without knowing which field
 * it is looking at.
 *
 * **What each field is called, and the few that carry no row**, is
 * {@link SOHL_FIELD_PRESENTATION} — an overlay on the declaration rather than
 * a list beside it.
 *
 * @module
 */

import { parseAddress, isAddressTuple, completeAddress } from "../engine/address.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import {
    DURATION_LABELS,
    GEAR_UNITS,
    defineInfobox,
    hasValue,
    humanizeFieldName,
    humanizeValue,
    systemRowsSection,
} from "../engine/infobox.mjs";
import { currentType } from "../engine/ids.mjs";
import { subTypes } from "../engine/note-vocabulary.mjs";
import { systemBlock, systemData } from "../engine/system-block.mjs";
import { readCanonicalKey } from "../engine/content-address.mjs";
import { readQualifier } from "../engine/address.mjs";
import { NOTE_SCHEMAS } from "./note-schemas.mjs";
import { GEAR_TYPE_TO_KEY } from "./being-info.mjs";

/** What this system's box is called. @type {string} */
export const SOHL_INFOBOX_TITLE = "Song of Heroic Lands";

/**
 * What a value nobody stated is shown as, where showing nothing would be the
 * wrong answer.
 *
 * Rule 4 drops an absent field, and that is right almost everywhere. It is
 * wrong in a table of strike modes, where a column left blank on one row and
 * filled on the next reads as a rendering fault rather than as a weapon that
 * cannot be used that way.
 *
 * @type {string}
 */
export const UNSTATED = "—";

/** The prefix every protection aspect's declared name carries. @type {string} */
const PROTECTION_PREFIX = "protection.";

/**
 * The declarations of the four aspects armour is rated against, in the order a
 * sheet shows them.
 *
 * Taken from the armour field declaration rather than listed: the declaration
 * names `protection.blunt`, `protection.edged` and the rest, so the set, its
 * order **and where each is authored** come from the same place the compiler
 * reads them. Carrying the whole declaration rather than the aspect's word is
 * what lets the grid resolve a value the way the compiler does — a note writes
 * `sohl.system.protectionBase.blunt`, and a grid that read the declared
 * *source* path instead would find nothing and call every aspect unstated.
 *
 * @type {readonly object[]}
 */
export const PROTECTION_FIELDS = Object.freeze(
    (NOTE_SCHEMAS.armorgear ?? []).filter(
        (field) => typeof field.name === "string" && field.name.startsWith(PROTECTION_PREFIX),
    ),
);

/** A skill family whose humanised name reads wrong. */
const SKILL_GROUP_LABELS = Object.freeze({ combattechnique: "Combat Techniques" });

/**
 * SoHL's presentation overlay: what one of this system's fields is called, and
 * the few that carry no row.
 *
 * **Not a second field list.** The fields come from {@link NOTE_SCHEMAS}, and
 * a field this overlay does not mention still gets a row under its own
 * humanised name — so a field added to a type reaches the box with no edit
 * here. What the overlay adds is the two things a compiler's field list cannot
 * say, because they are about a page rather than about a document:
 *
 * - **a reader's word** where the declaration's key is the compiler's. A key
 *   is named for the value it carries into a DataModel; `assocSkillCode` and
 *   `perceptionPenaltyBase` are exactly right there and wrong in a panel
 *   somebody reads.
 * - **which facts belong on a page at all.** A value shown whole somewhere
 *   else in the same box — protection, strike modes, a projectile's impact —
 *   would otherwise be said twice, the second time a row at a time and worse;
 *   and a flag that steers a character sheet is not a fact about the subject.
 *
 * @type {Readonly<Record<string, {label?: string, withheld?: string}>>}
 */
export const SOHL_FIELD_PRESENTATION = Object.freeze({
    ...DURATION_LABELS,
    ...GEAR_UNITS,

    "protection.blunt": Object.freeze({ withheld: "shown whole, in the Protection grid" }),
    "protection.edged": Object.freeze({ withheld: "shown whole, in the Protection grid" }),
    "protection.piercing": Object.freeze({ withheld: "shown whole, in the Protection grid" }),
    "protection.fire": Object.freeze({ withheld: "shown whole, in the Protection grid" }),
    strikeModes: Object.freeze({ withheld: "shown one per line, in the Strike Modes section" }),
    "impact.die": Object.freeze({ withheld: "shown whole, as the Impact row" }),
    "impact.modifier": Object.freeze({ withheld: "shown whole, as the Impact row" }),
    "impact.aspect": Object.freeze({ withheld: "shown whole, as the Impact row" }),
    improveFlag: Object.freeze({
        withheld: "character-sheet machinery — whether the item is flagged for improvement",
    }),
    facing: Object.freeze({
        withheld: "a body-location layout, which has no summary shape",
    }),

    subType: Object.freeze({ label: "Subtype" }),
    flexloc: Object.freeze({ label: "Flexible locations" }),
    rigidloc: Object.freeze({ label: "Rigid locations" }),
    perceptionPenaltyBase: Object.freeze({ label: "Perception penalty" }),
    detailMaterial: Object.freeze({ label: "Material detail" }),
    maxCapacity: Object.freeze({ label: "Max capacity", unit: " lbs" }),
    scoreBase: Object.freeze({ label: "Score" }),
    masteryLevelBase: Object.freeze({ label: "Mastery" }),
    levelBase: Object.freeze({ label: "Level" }),
    healingRateBase: Object.freeze({ label: "Healing rate" }),
    skillBaseFormula: Object.freeze({ label: "Skill base" }),
    initSkillMult: Object.freeze({ label: "Init multiplier" }),
    initDiceFormula: Object.freeze({ label: "Initiative dice" }),
    valueDesc: Object.freeze({ label: "Scale" }),
    parentSkillCode: Object.freeze({ label: "Specialises" }),
    assocSkillCode: Object.freeze({ label: "Associated skill" }),
    assocAffiliationCode: Object.freeze({ label: "Associated affiliation" }),
    bodyLocationCode: Object.freeze({ label: "Body location" }),
    impairedByRoles: Object.freeze({ label: "Impaired when" }),
});

/** Whether a value is a plain mapping. */
function isMapping(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Every content type `model:` may name — the note vocabulary this system
 * declares, engine types included.
 *
 * @type {ReadonlySet<string>}
 */
const MODEL_TYPES = new Set(Object.keys(NOTE_SCHEMAS));

/**
 * The `(type, shortcode)` an entry's `model:` names, or `undefined`.
 *
 * `model` is an Address, read by the same grammar every wikilink is —
 * `type-shortcode` within this package, `package-system-type-shortcode` to
 * name a dependency's catalogue. This decode answers neither of the two
 * questions {@link module:engine/address} asks about the package: a runtime
 * lookup among one actor's embedded items resolves by `(type, shortcode)`
 * alone, where packages do not exist, so a fully qualified `model` is read for
 * its last two segments exactly as a bare one is.
 *
 * @param {unknown} model - The authored value.
 * @returns {{type: string, shortcode: string}|undefined} What it names.
 */
function modelAddress(model) {
    const target = parseAddress(
        model,
        { package: contentPackage(), system: "sohl", types: MODEL_TYPES },
        { declared: true, legacyShortcodeCase: true },
    );
    return target.reason ? undefined : target;
}

/**
 * What one entry of `sohl.items` names.
 *
 * An entry addresses its item three ways and every tree uses all three: a
 * `model` address, explicit `type` / `shortcode` keys, or a locally authored
 * item stating its type with the shortcode inside its own `system` block. One
 * decode covers all of them, so nothing downstream has to know which form a
 * note happened to use.
 *
 * @param {object} entry - One `sohl.items` entry.
 * @returns {{type: string, shortcode: string, name: string, system: object}|undefined}
 *   What it names, or `undefined` when it names nothing addressable.
 */
export function decodeItem(entry) {
    if (!isMapping(entry)) return undefined;
    const address = entry.model ? modelAddress(entry.model) : undefined;
    let type = typeof entry.type === "string" ? entry.type : "";
    let shortcode = typeof entry.shortcode === "string" ? entry.shortcode : "";
    if (!type) {
        const named = address;
        if (named) {
            type = named.type;
            if (!shortcode) shortcode = named.shortcode;
        }
    }
    const system = isMapping(entry.system) ? entry.system : {};
    if (!shortcode && typeof system.shortcode === "string") shortcode = system.shortcode;
    if (!type) return undefined;
    return {
        ...(address ? { address } : {}),
        type: currentType(type),
        shortcode,
        name: typeof entry.name === "string" ? entry.name : "",
        system,
    };
}

/**
 * Every decoded item a being embeds, in the order the note wrote them.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The system's block key.
 * @returns {object[]} The items.
 */
function itemsOf(fm, block) {
    const declared = systemBlock(fm, block)?.items;
    return (Array.isArray(declared) ? declared : []).map(decodeItem).filter(Boolean);
}

/**
 * A model's documentation presentation, with its native name as plain text
 * when no documentation is published. The model keeps its native identity.
 * @param {object} item - Decoded native item.
 * @param {Function} resolve - The medium's reference resolver.
 * @param {string} block - The native system.
 * @returns {object|undefined} Documentation links and display metadata.
 */
function itemPresentation(item, resolve, block) {
    if (!item.shortcode) return undefined;
    if (!item.address)
        return resolve?.(item.shortcode, { kind: "shortcode", type: item.type, system: block });
    const documentation = completeAddress({ ...item.address, system: "none" });
    const found = resolve?.(documentation, { type: documentation.type });
    const native =
        !found?.name || !found?.subType ? resolve?.(item.address, { type: item.type }) : undefined;
    if (!found && !native) return undefined;
    return {
        name: found?.name ?? native?.name,
        subType: found?.subType ?? native?.subType,
        address: documentation,
        ...(found?.url ? { url: found.url } : {}),
        ...(found?.uuid ? { uuid: found.uuid } : {}),
    };
}

/**
 * One item as a value a renderer can draw: its name, and a link where the
 * index reached it.
 *
 * @param {object} item - A decoded item.
 * @param {(ref: unknown, hint?: object) => object|undefined} resolve - The
 *   medium's resolver.
 * @param {string} block - The native system.
 * @returns {{text: string, url?: string, uuid?: string, address?: import("../engine/address.mjs").AddressTuple}} The value.
 */
function itemValue(item, resolve, block) {
    const found = itemPresentation(item, resolve, block);
    const value = { text: item.name || found?.name || humanizeValue(item.shortcode) };
    if (found?.url) value.url = found.url;
    if (found?.uuid) value.uuid = found.uuid;
    if (found?.address) value.address = found.address;
    return value;
}

/**
 * A being's box: attributes, skills, mystical abilities and equipment.
 *
 * Each is a section of its own, because a section is the unit that flows — the
 * panel breaks between `ATTRIBUTES` and `SKILLS` rather than through either.
 * A section with nothing in it is not emitted at all, which is what makes a
 * sparse creature's box short rather than mostly empty.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} ctx - `{ block, resolve }`.
 * @returns {object[]} The sections.
 */
export function beingSections(fm, { block, resolve }) {
    const items = itemsOf(fm, block);
    const sections = [];

    const cells = [];
    for (const item of items) {
        if (item.type !== "attribute") continue;
        const score = item.system.scoreBase;
        if (!hasValue(score)) continue;
        cells.push({ label: String(item.shortcode).toUpperCase(), value: score });
    }
    if (cells.length) {
        sections.push({ id: "attributes", label: "Attributes", layout: "grid", cells });
    }

    // Skill families come from the note vocabulary's own `subType` set, in its
    // declared order — a family added to the format groups here with no second
    // list to edit. A skill the index cannot place falls to the end under its
    // own heading rather than vanishing from the panel.
    const families = new Map((subTypes("skill") ?? []).map((value) => [value, []]));
    const unplaced = [];
    for (const item of items) {
        if (item.type !== "skill") continue;
        const mastery = item.system.masteryLevelBase;
        if (!hasValue(mastery)) continue;
        const found = itemPresentation(item, resolve, block);
        const family = item.system.subType ?? found?.subType;
        const value = itemValue(item, resolve, block);
        const entry = { ...value, text: `${value.text} ${mastery}` };
        if (family && families.has(family)) families.get(family).push(entry);
        else unplaced.push(entry);
    }
    const groups = [];
    for (const [family, entries] of families) {
        if (!entries.length) continue;
        groups.push({
            label: SKILL_GROUP_LABELS[family] ?? humanizeFieldName(family),
            entries,
        });
    }
    if (unplaced.length) groups.push({ label: "Other", entries: unplaced });
    if (groups.length) sections.push({ id: "skills", label: "Skills", layout: "runin", groups });

    const mystical = [];
    for (const item of items) {
        if (item.type !== "mysticalability") continue;
        mystical.push(itemValue(item, resolve, block));
    }
    if (mystical.length) {
        sections.push({
            id: "mysticalabilities",
            label: "Mystical Abilities",
            layout: "list",
            entries: mystical,
        });
    }

    const gear = new Map(Object.values(GEAR_TYPE_TO_KEY).map((key) => [key, []]));
    for (const item of items) {
        const key = GEAR_TYPE_TO_KEY[item.type];
        if (!key) continue;
        gear.get(key).push(itemValue(item, resolve, block));
    }
    const gearGroups = [];
    for (const [key, entries] of gear) {
        if (entries.length) gearGroups.push({ label: humanizeFieldName(key), entries });
    }
    if (gearGroups.length) {
        sections.push({ id: "equipment", label: "Equipment", layout: "runin", groups: gearGroups });
    }

    return sections;
}

/**
 * Armour's box: whatever the note states, then the protection it gives.
 *
 * Protection is shown whole, with an aspect nobody stated rendered `0`. Armour
 * that stops nothing edged is a fact about the armour, and dropping the row
 * would leave a reader to guess whether it was unstated or nil.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} ctx - The section context.
 * @returns {object[]} The sections.
 */
export function armorSections(fm, ctx) {
    const sections = genericSections(fm, "armorgear", ctx);
    const cells = PROTECTION_FIELDS.map((field) => {
        const { value } = ctx.resolveField(field, fm, { block: ctx.block });
        return {
            label: humanizeFieldName(field.name),
            value: hasValue(value) ? value : 0,
        };
    });
    if (cells.length) {
        sections.push({ id: "protection", label: "Protection", layout: "grid", cells });
    }
    return sections;
}

/**
 * A weapon's box: whatever the note states, then one line per strike mode.
 *
 * A mode that states no attack modifier, no impact or no length is shown with
 * {@link UNSTATED} in that place rather than with the clause missing: the
 * modes are read against each other, and a line that is shorter than its
 * neighbour for no visible reason reads as a fault.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} ctx - The section context.
 * @returns {object[]} The sections.
 */
export function weaponSections(fm, ctx) {
    const sections = genericSections(fm, "weapongear", ctx);
    const groups = [];
    for (const [key, mode] of strikeModes(systemData(fm, ctx.block).strikeModes)) {
        groups.push({
            label: mode.name || humanizeValue(key),
            entries: [
                { text: `Attack ${signed(mode.attack?.modifier)}` },
                { text: `Impact ${impactOf(mode.impactBase)}` },
                { text: `Length ${hasValue(mode.lengthBase) ? mode.lengthBase : UNSTATED}` },
            ],
        });
    }
    if (groups.length) {
        sections.push({ id: "strikemodes", label: "Strike Modes", layout: "runin", groups });
    }
    return sections;
}

/**
 * A projectile's box: whatever the note states, then what it hits for.
 *
 * Impact is three declared fields — dice, modifier and aspect — and a reader
 * wants the one quantity they compose into. Three rows reading `Die 6`,
 * `Modifier 2`, `Aspect Piercing` say the declaration's structure rather than
 * the projectile's, so the three are withheld and the row they make is added
 * in their place.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} ctx - The section context.
 * @returns {object[]} The sections.
 */
export function projectileSections(fm, ctx) {
    const sections = genericSections(fm, "projectilegear", ctx);
    const impact = impactOf(systemData(fm, ctx.block).impactBase);
    if (impact !== UNSTATED) {
        const rows = sections[0]?.rows;
        const row = { label: "Impact", kind: "text", value: impact };
        if (rows) rows.push(row);
        else sections.push({ id: "profile", layout: "rows", rows: [row] });
    }
    return sections;
}

/**
 * A weapon's strike modes, whichever of the two shapes the note wrote.
 *
 * Both are live in the corpus and both name the same thing. A **list** carries
 * the mode's identity inside it, as `shortcode`, which is the shape a
 * compendium document holds; a **mapping** carries it as the key. So the
 * fallback name comes from the shortcode in one and from the key in the other,
 * and everything downstream sees one shape.
 *
 * @param {unknown} declared - What the note wrote at `strikeModes`.
 * @returns {[string, object][]} Mode name → the mode.
 */
export function strikeModes(declared) {
    if (Array.isArray(declared)) {
        return declared
            .filter(isMapping)
            .map((mode, at) => [String(mode.shortcode ?? at + 1), mode]);
    }
    if (isMapping(declared)) return Object.entries(declared).filter(([, mode]) => isMapping(mode));
    return [];
}

/** A modifier with its sign, or {@link UNSTATED}. */
function signed(value) {
    if (!hasValue(value) && value !== 0) return UNSTATED;
    return Number(value) >= 0 ? `+${value}` : String(value);
}

/**
 * An impact as dice and aspect, or {@link UNSTATED}.
 *
 * **A die of `0` is no die**, which is how the schema says a strike mode rolls
 * nothing — a net envelops and does no damage. Read as a number it would print
 * `1d0`, a roll nobody can make, so it composes to a flat modifier or to
 * nothing at all.
 *
 * **An aspect alone is not an impact.** Without a die or a modifier there is no
 * magnitude, and a line reading `Impact blunt` states the kind of a quantity
 * that was never given. That is {@link UNSTATED}'s whole job.
 *
 * @param {unknown} impact - The authored `impactBase`.
 * @returns {string} The impact, or {@link UNSTATED}.
 */
function impactOf(impact) {
    if (!isMapping(impact)) return UNSTATED;
    const die = Number(impact.die ?? 0);
    const modifier = Number(impact.modifier ?? 0);
    const dice = die > 0 ? `${impact.numDice ?? 1}d${die}` : "";
    const roll =
        dice ? `${dice}${modifier ? signed(modifier) : ""}`
        : modifier ? signed(modifier)
        : "";
    if (!roll) return UNSTATED;
    const aspect = hasValue(impact.aspect) ? humanizeValue(impact.aspect) : "";
    return [roll, aspect].filter(Boolean).join(" ");
}

/**
 * The rows a type's own field declaration yields, as a section.
 *
 * Shared by the three builders above so each adds to what its type states
 * rather than replacing it.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} type - The note type.
 * @param {object} ctx - The section context.
 * @returns {object[]} Zero or one section.
 */
function genericSections(fm, type, ctx) {
    return systemRowsSection(fm, NOTE_SCHEMAS[type], ctx);
}

/** An affiliation presents skill documentation while retaining native Item identity. */
export function affiliationSections(fm, ctx) {
    const field = NOTE_SCHEMAS.affiliation.find((entry) => entry.to === "commonSkills");
    const sections = systemRowsSection(
        fm,
        NOTE_SCHEMAS.affiliation.filter((entry) => entry !== field),
        ctx,
    );
    const { value } = ctx.resolveField(field, fm, { block: ctx.block });
    if (!Array.isArray(value) || value.length === 0) return sections;
    const entries = value.map((skill) => {
        const native = ctx.resolve?.(skill, { type: "skill", system: "sohl" });
        const docAddress =
            isAddressTuple(skill) ? completeAddress({ ...skill, system: "none" }) : undefined;
        const doc = docAddress ? ctx.resolve?.(docAddress, { type: docAddress.type }) : undefined;
        return {
            text: doc?.name || native?.name || humanizeValue(skill),
            ...(doc?.url ? { url: doc.url } : {}),
            ...(doc?.uuid ? { uuid: doc.uuid } : {}),
            ...(docAddress && (doc?.url || doc?.uuid) ? { address: docAddress } : {}),
        };
    });
    sections.push({
        id: "commonskills",
        layout: "rows",
        rows: [{ label: "Common skills", kind: "links", value: entries }],
    });
    return sections;
}

/**
 * SoHL's infobox declaration.
 *
 * @type {object}
 */
export const SOHL_INFOBOX = defineInfobox({
    system: "sohl",
    title: SOHL_INFOBOX_TITLE,
    fields: NOTE_SCHEMAS,
    presentation: SOHL_FIELD_PRESENTATION,
    sections: {
        being: beingSections,
        affiliation: affiliationSections,
        armorgear: armorSections,
        weapongear: weaponSections,
        projectilegear: projectileSections,
    },
});
