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
 * The `hm3:` frontmatter vocabulary of every HM3 item type.
 *
 * The same arrangement `sohl/item-fields.mjs` describes: the declaration **is**
 * the builder — {@link buildFromFields} turns each list into the function that
 * runs — so a field that is not here is not emitted, and there is no second
 * statement of the mapping to drift.
 *
 * **Deliberately shorter than SoHL's, and that is the honest answer.** The
 * mapping tables in `docs/content-format.md` are the specification for what a
 * shared `data:` fact becomes in each system, and HM3's column is `NA` far more
 * often than SoHL's: a weapon's weight and value cross over, its quality and
 * durability do not. Every row below is one the specification states. Where it
 * says nothing — HM3's `armorlocation` has no `data:` row at all, and `trauma`
 * and `mysticalability` have none either — this file declares nothing rather
 * than inventing a plausible path. A guessed `to` compiles clean and is
 * discarded by Foundry at load without a word, which is exactly the failure the
 * schema check exists to catch and exactly the failure a guess would create.
 *
 * **One shared source, two destinations.** `name` is the shared property a
 * field draws from and `to` is where it lands, so a single authored `weight`
 * feeds `sohl.system.weightBase` *and* `hm3.system.weight` — one authored fact,
 * two documents (#58). That is the whole reason the two are declared
 * separately.
 *
 * The specification writes those sources as `data.weight`, and the sources here
 * are written bare, exactly as SoHL's are: the `data:` region is #128's
 * migration and neither half has moved to it. Spelling HM3's differently would
 * make a note feeding both systems author the same fact twice for no gain, and
 * would take these rows out of reach of `content-build content-format fields`,
 * which pairs a `data.<key>` claim with a bare declared `<key>`. Both halves
 * move together when #128 lands.
 *
 * **What a note authors under `hm3.system` is not declared here.** HM3 fields
 * that no shared `data:` property feeds — a skill's `type`, an armour's
 * `protection`, a character's `abilities` — are written at their own paths in
 * the note's `hm3.system` block and reach the document through the verbatim
 * passthrough. They are checked against HM3's published `schema.json` like
 * everything else; they simply have no shared source to declare.
 *
 * **A leaf**, like its SoHL counterpart: declaration primitives only, never the
 * resolved configuration.
 *
 * @module
 */

import { AS_AUTHORED, NUMBER } from "../engine/field-spec.mjs";

/* --------------------------------------------------------------------- */
/*  Rows shared by the four gear types                                    */
/* --------------------------------------------------------------------- */

/**
 * What HM3's gear template takes from the shared `data:` region.
 *
 * `weight` and `value` are the two rows every gear table in the content format
 * gives an HM3 destination. `quality` and `durability` are SoHL's alone — HM3
 * carries `weaponQuality` and `armorQuality` on the subtypes that have them,
 * which is a different fact about a different thing, so the shared row is `NA`
 * and nothing is emitted.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const GEAR_COMMON = Object.freeze([
    {
        name: "weight",
        to: "weight",
        ...AS_AUTHORED,
        kind: "number",
        default: 0,
        describe: "Weight of one, in pounds.",
    },
    {
        name: "value",
        to: "value",
        ...AS_AUTHORED,
        kind: "number",
        default: 0,
        describe: "Worth of one, in pence.",
    },
]);

/**
 * The stack count, for the gear types whose content-format table gives it an
 * HM3 destination.
 *
 * `armorgear`, `containergear` and `weapongear` are excluded on purpose: their
 * tables state that quantity is always 1 and may not be authored, so the note
 * has nothing to say and HM3's own `initial` is the right value to ship.
 *
 * @type {import("../engine/field-spec.mjs").FieldSpec}
 */
const QUANTITY = Object.freeze({
    name: "quantity",
    to: "quantity",
    ...NUMBER,
    default: 1,
    describe: "How many the stack holds.",
});

/* --------------------------------------------------------------------- */
/*  Per-type declarations                                                 */
/* --------------------------------------------------------------------- */

/**
 * Every HM3 item type's frontmatter vocabulary, in the order the `system` block
 * emits it.
 *
 * The keys are **note** types, not HM3 document subtypes — `projectilegear`
 * rather than `missilegear`, `mysticalability` rather than `psionic` — because
 * a registry is addressed by what a note calls itself. What the document is
 * called is the map's answer, and only the map's.
 *
 * @type {Readonly<Record<string, readonly import("../engine/field-spec.mjs").FieldSpec[]>>}
 */
export const HM3_ITEM_FIELDS = Object.freeze({
    armorgear: Object.freeze([...GEAR_COMMON]),

    // The one subtype that extends the Foundry base directly, with none of the
    // shared templates. Its content-format table has a single row, and that row
    // is `NA` on both sides — so an armour location is authored entirely under
    // `hm3.system` (`probWeight`, `impactType`, the per-aspect protections) and
    // there is nothing for a shared source to feed.
    armorlocation: Object.freeze([]),

    containergear: Object.freeze([
        ...GEAR_COMMON,
        {
            name: "capacity",
            to: "capacity.max",
            ...NUMBER,
            default: 0,
            describe: "How much the container holds, in pounds.",
        },
    ]),

    miscgear: Object.freeze([...GEAR_COMMON, QUANTITY]),

    // A note's `projectilegear` is HM3's `missilegear`; the fields are the gear
    // template's, and the aspect, impact and range that make it a missile are
    // authored under `hm3.system`.
    projectilegear: Object.freeze([...GEAR_COMMON, QUANTITY]),

    // `hm3.system.type` — "Craft", "Physical", "Communication", "Combat",
    // "Magic", "Ritual" — has no shared source: the content format states
    // outright that it does not map onto the note's `subType` and must be
    // written for each HM3 skill. So it is authored at its own path and passes
    // through, and only the mastery level is declared here.
    skill: Object.freeze([
        {
            name: "masteryLevel",
            to: "masteryLevel",
            ...NUMBER,
            default: 0,
            describe: "Mastery level, as a percentage.",
        },
    ]),

    // Both one-to-many item rows: every shared row in their content-format
    // tables is `NA`, so what an HM3 trauma or mystical ability carries — a
    // severity and heal rate, a convocation and level, a circle and deity — is
    // authored under `hm3.system` against whichever subtype `hm3.type` names.
    trauma: Object.freeze([]),
    mysticalability: Object.freeze([]),

    weapongear: Object.freeze([...GEAR_COMMON]),
});
