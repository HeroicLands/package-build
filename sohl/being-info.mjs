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
 * **A being's info-block fields**, derived from the items it embeds.
 *
 * A `being` note carries its embedded documents as `sohl.items` — a flat list
 * of `{ shortcode, type, system? }` — but the shared theme's sidebar reads
 * *resolved* shapes: a `skills` map, `gear` grouped by kind, and `spells` /
 * `talents` split out of the mystical abilities. This is the translation
 * between the two, and it is SoHL data-model knowledge: which item type is a
 * skill, where a mastery level lives, what distinguishes a spell from a talent.
 *
 * **It lives here because it was living in two places.** Both
 * `Song-of-Heroic-Lands-FoundryVTT` and `sohl-thalorna` carried a copy, and the
 * copies drifted: SoHL's caller still gated the derivation on `character` and
 * `creature`, the two types #1580 merged into `being`, so it had matched
 * nothing since the merge and all 95 of its being pages published with empty
 * sidebar sections (SoHL#1696). thalorna's copy checked `being` and was right.
 * Nothing failed in either repository; the pages built and shipped.
 *
 * {@link isBeing} exists for that reason. The bug was not in the derivation —
 * it was in each caller's idea of what a being *is*, written out per repository
 * where it could rot independently. One definition, imported.
 *
 * @module
 */

/**
 * The note `type` whose pages carry a being info block.
 *
 * One name, since #1580 merged `character` and `creature` into the `being` they
 * had always compiled into. The retired names are deliberately **not** accepted
 * as aliases: they throw elsewhere in the system, and tolerating them here
 * would hide the next drift of this kind rather than surface it.
 */
export const BEING_TYPE = "being";

/**
 * Whether a note's frontmatter describes a being.
 *
 * @param {{type?: unknown}|null|undefined} fm - A note's frontmatter.
 * @returns {boolean} `true` when the note is a being.
 */
export function isBeing(fm) {
    return Boolean(fm) && fm.type === BEING_TYPE;
}

/**
 * The sidebar group each gear item type is displayed under.
 *
 * Presentation naming, not data-model naming: the model says `weapongear`, the
 * sidebar heading says "weapons". Kept as one table so a new gear type is added
 * in a single place rather than in each consumer's site build.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GEAR_TYPE_TO_KEY = Object.freeze({
    weapongear: "weapons",
    armorgear: "armor",
    projectilegear: "projectiles",
    miscgear: "misc",
    containergear: "containers",
    concoctiongear: "concoctions",
});

/** Whether a value is a plain mapping. */
const isMap = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Whether a value is a non-empty array. */
const nonEmpty = (v) => Array.isArray(v) && v.length > 0;

/**
 * Derive a being's info-block fields from its raw `sohl.items[]`.
 *
 * Each item's `shortcode` is resolved against `index` — keyed
 * `"<type>:<shortcode>"` — for a display name and a link to the item's own
 * page. `attributes` already match the sidebar shape and pass through
 * untouched.
 *
 * **Authored values win.** Only fields the author did not supply are derived,
 * so a note that hand-writes `sohl.skills` keeps exactly what it wrote. An
 * item's inline `name` beats the index, and an unresolved shortcode falls back
 * to *itself* rather than being dropped — a page that names an item the index
 * has not heard of is better than a page silently missing a row.
 *
 * Returns a new object; the input is not mutated.
 *
 * @param {object|null|undefined} sohl - The note's `sohl` frontmatter block.
 * @param {Map<string, {name?: string, url?: string}>} index - Content index,
 *   `"<type>:<shortcode>"` → the item's page.
 * @returns {object|null|undefined} The block with its info-block fields filled
 *   in, or the input unchanged when there is nothing to derive from.
 */
export function deriveBeingInfo(sohl, index) {
    if (!isMap(sohl)) return sohl;
    const out = { ...sohl };
    const items = Array.isArray(out.items) ? out.items : [];
    if (items.length === 0) return out;

    const lookup = (type, shortcode) =>
        shortcode ? index.get(`${type}:${shortcode}`) : undefined;

    /** An item's display name: its own, then the index's, then its shortcode. */
    const displayName = (it, ref, shortcode) =>
        (typeof it.name === "string" && it.name) || ref?.name || shortcode;

    // Skills: { shortcode: masteryLevelBase }.
    if (!(isMap(out.skills) && Object.keys(out.skills).length > 0)) {
        const skills = {};
        for (const it of items) {
            if (!isMap(it) || it.type !== "skill") continue;
            const level = it.system?.masteryLevelBase;
            if (typeof it.shortcode === "string" && typeof level === "number") {
                skills[it.shortcode] = level;
            }
        }
        if (Object.keys(skills).length > 0) out.skills = skills;
    }

    // Gear: { weapons: [{ name, shortcode?, url? }], armor: [...], … }.
    if (!isMap(out.gear)) {
        const gear = {};
        for (const it of items) {
            if (!isMap(it)) continue;
            const key = GEAR_TYPE_TO_KEY[it.type];
            if (!key) continue;
            const shortcode =
                typeof it.shortcode === "string" ? it.shortcode : undefined;
            const ref = lookup(it.type, shortcode);
            const name = displayName(it, ref, shortcode);
            if (!name) continue;
            const entry = { name };
            if (shortcode) entry.shortcode = shortcode;
            if (ref?.url) entry.url = ref.url;
            (gear[key] ??= []).push(entry);
        }
        if (Object.keys(gear).length > 0) out.gear = gear;
    }

    // Mystical abilities, split by subType into spells / talents.
    const spells = [];
    const talents = [];
    for (const it of items) {
        if (!isMap(it) || it.type !== "mysticalability") continue;
        const shortcode =
            typeof it.shortcode === "string" ? it.shortcode : undefined;
        const ref = lookup("mysticalability", shortcode);
        // No shortcode fallback here: an ability with neither an inline name
        // nor an index entry has nothing to show, and a row reading like a
        // shortcode is worse than no row.
        const name = (typeof it.name === "string" && it.name) || ref?.name;
        if (!name) continue;
        const entry = { name };
        if (ref?.url) entry.url = ref.url;
        if (it.subType === "arcaneincantation") spells.push(entry);
        else if (it.subType === "arcanetalent") talents.push(entry);
    }
    if (spells.length > 0 && !nonEmpty(out.spells)) out.spells = spells;
    if (talents.length > 0 && !nonEmpty(out.talents)) out.talents = talents;

    return out;
}
