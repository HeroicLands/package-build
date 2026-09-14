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
 * **Three types earn a builder of their own**, because their box is derived
 * rather than read field by field:
 *
 * - a **being**, whose attributes, skills, mystical abilities and carried gear
 *   are one flat `sohl.items` list that has to be sorted before it can be
 *   shown;
 * - **armour**, whose protection is shown as a full set of four aspects, with
 *   an unstated one rendered `0` rather than dropped — armour that stops
 *   nothing edged is a fact, not a gap;
 * - a **weapon**, whose strike modes are shown one per line, with an unstated
 *   value rendered `—` for the same reason.
 *
 * Both placeholders are **data**, decided here, not a renderer's fallback.
 * That is what lets one generic renderer draw them without knowing which field
 * it is looking at.
 *
 * @module
 */

import {
    defineInfobox,
    hasValue,
    humanizeFieldName,
    humanizeValue,
    systemRowsSection,
} from "../engine/infobox.mjs";
import { currentType } from "../engine/ids.mjs";
import { subTypes } from "../engine/note-vocabulary.mjs";
import { systemBlock, systemData } from "../engine/system-block.mjs";
import { getFrontmatter } from "../engine/frontmatter.mjs";
import { NOTE_SCHEMAS } from "./note-schemas.mjs";
import { GEAR_TYPE_TO_KEY } from "./being-info.mjs";

/** What this system's box is called. @type {string} */
export const SOHL_INFOBOX_TITLE = "SoHL";

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

/**
 * The four aspects armour is rated against, in the order a sheet shows them.
 *
 * Read from the armour field declaration rather than listed: the declaration
 * names `protection.blunt`, `protection.edged` and the rest, so the set and
 * its order come from the same place the compiler reads them.
 *
 * @type {readonly string[]}
 */
export const PROTECTION_ASPECTS = Object.freeze(
    (NOTE_SCHEMAS.armorgear ?? [])
        .map((field) => field.name)
        .filter((name) => typeof name === "string" && name.startsWith("protection."))
        .map((name) => name.slice("protection.".length)),
);

/** A skill family whose humanised name reads wrong. */
const SKILL_GROUP_LABELS = Object.freeze({ combattechnique: "Combat Techniques" });

/** Whether a value is a plain mapping. */
function isMapping(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * What one entry of `sohl.items` names.
 *
 * An entry addresses its item three ways and every tree uses all three: a
 * `model` address whose last two hyphen-separated segments are always
 * `<type>-<shortcode>`, explicit `type` / `shortcode` keys, or a locally
 * authored item stating its type with the shortcode inside its own `system`
 * block. One decode covers all of them, so nothing downstream has to know
 * which form a note happened to use.
 *
 * @param {object} entry - One `sohl.items` entry.
 * @returns {{type: string, shortcode: string, name: string, system: object}|undefined}
 *   What it names, or `undefined` when it names nothing addressable.
 */
export function decodeItem(entry) {
    if (!isMapping(entry)) return undefined;
    let type = typeof entry.type === "string" ? entry.type : "";
    let shortcode = typeof entry.shortcode === "string" ? entry.shortcode : "";
    if (!type && typeof entry.model === "string") {
        const segments = entry.model.split("-");
        if (segments.length >= 2) {
            type = segments[segments.length - 2];
            if (!shortcode) shortcode = segments[segments.length - 1];
        }
    }
    const system = isMapping(entry.system) ? entry.system : {};
    if (!shortcode && typeof system.shortcode === "string") shortcode = system.shortcode;
    if (!type) return undefined;
    return {
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
 * One item as a value a renderer can draw: its name, and a link where the
 * index reached it.
 *
 * @param {object} item - A decoded item.
 * @param {(ref: unknown, hint?: object) => object|undefined} resolve - The
 *   medium's resolver.
 * @returns {{text: string, url?: string, uuid?: string, address?: string}} The value.
 */
function itemValue(item, resolve) {
    const found = item.shortcode ? resolve?.(item.shortcode, { type: item.type }) : undefined;
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
        const found = item.shortcode ? resolve?.(item.shortcode, { type: "skill" }) : undefined;
        const family = item.system.subType ?? found?.subType;
        const value = itemValue(item, resolve);
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
        mystical.push(itemValue(item, resolve));
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
        gear.get(key).push(itemValue(item, resolve));
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
    const data = systemData(fm, ctx.block);
    const cells = PROTECTION_ASPECTS.map((aspect) => ({
        label: humanizeFieldName(aspect),
        value: getFrontmatter(data, `protection.${aspect}`, 0) ?? 0,
    }));
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
    const declared = systemData(fm, ctx.block).strikeModes;
    const modes = isMapping(declared) ? Object.entries(declared) : [];
    const groups = [];
    for (const [key, mode] of modes) {
        if (!isMapping(mode)) continue;
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

/** A modifier with its sign, or {@link UNSTATED}. */
function signed(value) {
    if (!hasValue(value) && value !== 0) return UNSTATED;
    return Number(value) >= 0 ? `+${value}` : String(value);
}

/** An impact as dice and aspect, or {@link UNSTATED}. */
function impactOf(impact) {
    if (!isMapping(impact)) return UNSTATED;
    const dice = hasValue(impact.die) ? `${impact.numDice ?? 1}d${impact.die}` : "";
    const modifier = Number(impact.modifier ?? 0);
    const roll = dice ? `${dice}${modifier ? signed(modifier) : ""}` : "";
    const aspect = hasValue(impact.aspect) ? humanizeValue(impact.aspect) : "";
    const text = [roll, aspect].filter(Boolean).join(" ");
    return text || UNSTATED;
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

/**
 * SoHL's infobox declaration.
 *
 * @type {object}
 */
export const SOHL_INFOBOX = defineInfobox({
    system: "sohl",
    title: SOHL_INFOBOX_TITLE,
    fields: NOTE_SCHEMAS,
    sections: {
        being: beingSections,
        armorgear: armorSections,
        weapongear: weaponSections,
    },
});
