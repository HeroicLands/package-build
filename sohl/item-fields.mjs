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
 * The `sohl:` frontmatter vocabulary of every SoHL item type.
 *
 * This is the authority for what an item note may write, and — because
 * {@link buildFromFields} turns each list into the builder that runs — it is
 * the same authority the compiler obeys. A field that is not here is not
 * emitted; a description here is a description of the thing that executes
 * (#22). The per-type authoring reference on the knowledgebase is generated
 * from this file.
 *
 * **SoHL type vocabulary, so it lives in `sohl/`.** `engine/` holds the
 * machinery — the declaration primitives, the coercions, the builder factory —
 * because a consuming package declares *its own* types the same way. Moving
 * this list into `engine/` would hand an adventure module a vocabulary for
 * types it does not have.
 *
 * **A leaf, like the builders it feeds.** It imports the declaration
 * primitives and the frontmatter readers, and never the resolved
 * configuration: reading configuration back out is what closes the cycle the
 * item-builders module note warns about.
 *
 * @module
 */

import {
    AS_AUTHORED,
    BLANK_IS_DEFAULT,
    BLANK_IS_NULL,
    BOOLEAN,
    NULLABLE_COUNT,
    NULLABLE_NUMBER,
    NUMBER,
    STRING,
} from "../engine/field-spec.mjs";
import {
    parseValueDesc,
    requireSubType,
    resolveCharges,
    resolveRelation,
    resolveSkillAptitudes,
    sohlSystemField,
} from "../engine/frontmatter.mjs";

/* --------------------------------------------------------------------- */
/*  SoHL-specific coercions                                               */
/* --------------------------------------------------------------------- */

/**
 * The item's kind within its type — mandatory, and never defaulted.
 *
 * `requireSubType` re-reads the frontmatter rather than taking the raw value,
 * so the error names the note and says what to add.
 */
const SUB_TYPE = Object.freeze({
    shape: "string",
    read: (_raw, { fm }) => requireSubType(fm),
});

/** A charge pool, read from `charges.value` / `charges.max` together. */
const CHARGES = Object.freeze({
    shape: "`{value, max}`, both whole numbers or unset",
    read: (_raw, { fm }) => resolveCharges(fm),
});

/** Label/threshold pairs, authored as `"Label: max"` strings or as objects. */
const VALUE_DESC = Object.freeze({
    shape: "list of `Label: max` strings, or `{label, maxValue}` objects",
    read: (raw) => parseValueDesc(raw),
});

/** Armour facings, each naming a body location and the side it covers. */
const FACING = Object.freeze({
    shape: "list of `{location, side}`",
    read: (raw) =>
        (raw || []).map((entry) => ({
            location: String(entry.location ?? ""),
            side: String(entry.side ?? "all"),
        })),
});

/**
 * Name the note in an error the way its author will recognise it — by title,
 * falling back to the shortcode.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} type - The item type, for the leading phrase.
 * @returns {string} A context string for a thrown message.
 */
function noteContext(fm, type) {
    return `${type} "${fm?.name?.full ?? fm?.shortcode ?? "?"}"`;
}

/**
 * A timed phase's duration **formula** — what is rolled to seed the interval.
 *
 * SoHL's own field is a nullable, non-blank `StringField`, and the interval it
 * yields is in **seconds** (`"432000"` is the five days the world setting
 * defaults to). A bare number is as valid as a dice expression, and both are
 * stringified here so a note may write either — which is also why no `kind` is
 * declared: a lint claiming this must be a string would report `86400` as an
 * authoring mistake when it is the commonest thing to write.
 *
 * Blank reads as unset rather than as `""`, matching the field's `blank: false`
 * — but a field declaring {@link FieldSpec.omitWhenAbsent} skips before this
 * runs when the note carries nothing, so the `null` is only ever reached by a
 * note that cleared the key on purpose.
 */
const DURATION_FORMULA = Object.freeze({
    shape: "roll formula, or a whole number of seconds",
    read: (raw) => (raw == null || raw === "" ? null : String(raw)),
});

/**
 * A timed phase's rolled duration, in **seconds** — the fact, where the formula
 * above is the definition.
 *
 * Authoring it states the interval outright instead of leaving it to a roll,
 * which is what a fixed-cadence phase wants. Non-numeric reads `0` rather than
 * `NaN`, as every other count in this vocabulary does.
 */
const DURATION_BASE = Object.freeze({
    shape: "whole number of seconds",
    kind: "number",
    read: (raw) => (raw == null || raw === "" ? null : Number(raw) || 0),
});

/** Aptitude weights per skill selector, validated as whole numbers. */
const SKILL_APTITUDES = Object.freeze({
    shape: "map of skill selector → whole number",
    read: (_raw, { fm }) => resolveSkillAptitudes(fm, noteContext(fm, "mystery")),
});

/** Standings toward other affiliations, validated against the closed list. */
const RELATION = Object.freeze({
    shape: "map of affiliation shortcode → standing",
    read: (_raw, { fm }) => resolveRelation(fm, noteContext(fm, "affiliation")),
});

/**
 * A list of references, each a bare shortcode.
 *
 * Blank entries are dropped rather than emitted: a list that has been edited
 * down in a property editor keeps its empty rows, and an empty string is not a
 * reference to anything. Absent reads as `[]`, because "refers to nothing" is a
 * value here — a sovereign polity is subordinate to nobody — rather than an
 * unset one.
 */
const SHORTCODE_LIST = Object.freeze({
    shape: "list of shortcodes",
    kind: "list",
    read: (raw) =>
        (Array.isArray(raw) ? raw
        : raw == null || raw === "" ? []
        : [raw]
        )
            .map((entry) => String(entry ?? "").trim())
            .filter((entry) => entry !== ""),
});

/**
 * Every element must carry a non-blank `shortcode`, unique on the weapon — the
 * shortcode is the mode's identity. The list is otherwise emitted verbatim.
 */
const STRIKE_MODES = Object.freeze({
    shape: "list of strike modes, each with a unique `shortcode`",
    read: (raw) => {
        if (!Array.isArray(raw)) return [];
        const seen = new Set();
        for (const { shortcode } of raw) {
            if (!shortcode) {
                throw new Error("weapongear strikeModes array element requires a 'shortcode'");
            }
            if (seen.has(shortcode)) {
                throw new Error(`weapongear has duplicate strike-mode shortcode "${shortcode}"`);
            }
            seen.add(shortcode);
        }
        return raw;
    },
});

/**
 * A projectile's impact die, read wherever the default of another impact field
 * depends on it.
 *
 * Authored `impact.die`, stored `impactBase.die` — the one re-reading field
 * whose two positions are spelled differently, so both are named (#126).
 *
 * @param {object} fm - The note's frontmatter.
 * @returns {number} The die size, `0` when the projectile declares none.
 */
function impactDie(fm) {
    return Number(sohlSystemField(fm, "impactBase.die", 0, { legacyKey: "impact.die" })) || 0;
}

/** A strike mode discriminated by `type`, mandatory on a combat technique. */
const STRIKE_MODE = Object.freeze({
    shape: '`{type: "melee" | "missile", …}`',
    read: (raw) => {
        if (!raw || typeof raw !== "object" || !raw.type) {
            throw new Error(
                `combattechnique skill requires sohl.strikeMode with a 'type' discriminator ("melee" or "missile")`,
            );
        }
        return raw;
    },
});

/* --------------------------------------------------------------------- */
/*  Shared groups                                                         */
/* --------------------------------------------------------------------- */

/**
 * The fields every `*gear` type carries — the physical properties of a thing
 * you can pick up, plus the possession state a compendium copy always starts
 * in.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const GEAR_COMMON = Object.freeze([
    {
        to: "quantity",
        value: 1,
        describe: "How many the stack holds. A compendium article ships one.",
    },
    {
        name: "weight",
        to: "weightBase",
        ...AS_AUTHORED,
        kind: "number",
        default: 0,
        describe: "Weight of one, in pounds.",
    },
    {
        name: "value",
        to: "valueBase",
        ...AS_AUTHORED,
        kind: "number",
        default: 0,
        describe: "Worth of one, in pence.",
    },
    {
        name: "quality",
        to: "qualityBase",
        ...AS_AUTHORED,
        kind: "number",
        default: 0,
        describe: "Craftsmanship, as a modifier to what the article does.",
    },
    {
        name: "durability",
        to: "durabilityBase",
        ...AS_AUTHORED,
        kind: "number",
        default: 0,
        describe: "How much punishment the article takes before it fails.",
    },
    {
        to: "sharedWithCohortIds",
        value: () => [],
        describe: "Cohorts sharing the article. Possession state, never authored.",
    },
    {
        to: "containerId",
        value: null,
        describe: "The container holding it. Possession state, never authored.",
    },
    {
        to: "isCarried",
        value: true,
        describe: "Whether it is being carried. Possession state.",
    },
]);

/* --------------------------------------------------------------------- */
/*  Per-type declarations                                                 */
/* --------------------------------------------------------------------- */

/**
 * Every item type's frontmatter vocabulary, in the order the `system` block
 * emits it.
 *
 * @type {Readonly<Record<string, readonly import("../engine/field-spec.mjs").FieldSpec[]>>}
 */
export const ITEM_FIELDS = Object.freeze({
    affiliation: Object.freeze([
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "Which kind of affiliation this is — the society's character.",
        },
        {
            name: "society",
            to: "society",
            ...STRING,
            default: "",
            describe: "The body a member belongs to.",
        },
        {
            name: "office",
            to: "office",
            ...STRING,
            default: "",
            describe: "The post a member holds within it.",
        },
        {
            name: "title",
            to: "title",
            ...STRING,
            default: "",
            topLevelMeans:
                "the note's own title — the heading its page is published under, " +
                "which has nothing to do with the style of address an office " +
                "carries. Author this on the membership instead: `sohl.system.title` " +
                "on the item, or the `system.title` of the entry in a being's " +
                "`sohl.items`.",
            describe: "The style of address the office carries.",
        },
        {
            name: "level",
            to: "level",
            ...NUMBER,
            default: 0,
            describe: "Standing within the society.",
        },
        {
            // Plural because the field holds a map of many standings, one per
            // affiliation — the singular was a misnomer every author read past
            // (SoHL#1781).
            name: "relations",
            to: "relations",
            ...RELATION,
            default: {},
            describe: "How this society regards others: aligned, unaligned, rival or nemesis.",
        },
        {
            // The organisational relation: which bodies this one answers to.
            // A list, because an affiliation may sit under more than one at
            // once — an arcane tradition within an order, say.
            name: "parents",
            to: "parents",
            ...SHORTCODE_LIST,
            default: [],
            describe: "Affiliations this one is subordinate to, by shortcode.",
        },
        {
            // Not `capital` or `headquarters`: each fits about half the eleven
            // subTypes, while a seat covers a polity, a guild, an order and a
            // faith alike.
            name: "seat",
            to: "seat",
            ...BLANK_IS_NULL,
            default: null,
            describe: "Where the affiliation's authority sits, by place shortcode.",
        },
        {
            // The geographic relation, kept apart from the organisational one
            // above: `parents` is *subordinate to*, this is *holds sway over*.
            //
            // Authored plural and emitted singular, as the content format's
            // mapping row states (`data.domains` → `system.domain`). The two
            // spellings are deliberate rather than a slip, so the declaration
            // carries both rather than either side guessing.
            name: "domains",
            to: "domain",
            ...SHORTCODE_LIST,
            default: [],
            describe: "Places this affiliation holds sway over, by shortcode.",
        },
    ]),

    affliction: Object.freeze([
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "What kind of affliction it is.",
        },
        {
            name: "category",
            to: "category",
            ...AS_AUTHORED,
            default: "",
            describe: "The grouping it belongs to within its subtype.",
        },
        {
            to: "isDormant",
            value: false,
            describe: "Whether it is currently dormant. Play state.",
        },
        {
            name: "levelBase",
            to: "levelBase",
            ...NUMBER,
            default: 0,
            describe: "Severity, before any modifier.",
        },
        {
            name: "healingRateBase",
            to: "healingRateBase",
            ...NUMBER,
            default: 0,
            describe: "How readily the host throws it off.",
        },
        {
            name: "contagionIndex",
            to: "contagionIndexBase",
            ...NUMBER,
            default: 0,
            describe: "How readily it passes to someone else.",
        },
        {
            name: "transmission",
            to: "transmission",
            ...AS_AUTHORED,
            default: "none",
            describe: "The route by which it spreads.",
        },
        {
            name: "onsetFormula",
            to: "onsetFormula",
            ...BLANK_IS_NULL,
            default: null,
            describe:
                "Days from contracting to onset, rolled by the receiving actor. Unset means no incubation.",
        },
        {
            name: "outcome",
            to: "outcome",
            ...BLANK_IS_DEFAULT,
            default: "cured",
            describe:
                "What running the course to the end does to the host: `death`, or the benign default `cured`.",
        },
        // The two **authored** thirds of each timed-phase triplet (#329). Every
        // one omits its key when the note does not carry it, because the value
        // that stands otherwise is the DataModel's `initial: null` — writing a
        // compile-time `null` over it would claim the phase takes no time,
        // which is a different statement than the note not setting the phase at
        // all, and `AfflictionLogic.rollDuration()` opens `if (!formula) return 0`.
        //
        // Until they were declared here the only way to author one was the raw
        // `system:` passthrough — undocumented, uncoerced, and absent from the
        // field list every author-facing surface is built from — so no note in
        // any tree wrote one and every shipped affliction had zero-length
        // phases.
        // Spelled out, one entry per field, for the reason the dates below are:
        // a name assembled from a phase argument is not in the source, so it
        // cannot be grepped, and each phase's prose differs anyway — which is
        // the whole content of the declaration.
        {
            name: "onsetDurationFormula",
            to: "onsetDurationFormula",
            ...DURATION_FORMULA,
            omitWhenAbsent: true,
            describe:
                "Interval from contracting the affliction to the start of onset. Omitted when unset, leaving no incubation.",
        },
        {
            name: "onsetDurationBase",
            to: "onsetDurationBase",
            ...DURATION_BASE,
            omitWhenAbsent: true,
            describe:
                "The onset interval in seconds, standing in for a roll of the formula. Omitted when unset.",
        },
        {
            name: "healingCheckDurationFormula",
            to: "healingCheckDurationFormula",
            ...DURATION_FORMULA,
            omitWhenAbsent: true,
            describe:
                "Interval between healing checks, once the affliction is symptomatic. Omitted when unset.",
        },
        {
            name: "healingCheckDurationBase",
            to: "healingCheckDurationBase",
            ...DURATION_BASE,
            omitWhenAbsent: true,
            describe:
                "The healing-check interval in seconds, standing in for a roll of the formula. Omitted when unset.",
        },
        {
            name: "resolutionDurationFormula",
            to: "resolutionDurationFormula",
            ...DURATION_FORMULA,
            omitWhenAbsent: true,
            describe:
                "Interval from onset to the affliction running its course. Omitted when unset.",
        },
        {
            name: "resolutionDurationBase",
            to: "resolutionDurationBase",
            ...DURATION_BASE,
            omitWhenAbsent: true,
            describe:
                "The resolution interval in seconds, standing in for a roll of the formula. Omitted when unset.",
        },
        // The `…Date` third of every timed-phase triplet, declared as **runtime
        // state** (#330). A phase is authored as its `…DurationFormula`; the
        // `…DurationBase` records what that rolled to; the date records *when
        // it happened*, and only play can know that. All four are
        // `worldTimeDateField()`s in SoHL's schema — nullable rather than
        // sentinelled precisely because `0` is itself a valid world time — so
        // there is no blank an author could honestly write either.
        //
        // Declaring them does two things at once: the key is left out of the
        // compiled document, so SoHL's own `initial: null` stands, and a note
        // authoring one is refused with a message naming the field and its
        // reason. Written out rather than generated from a phase name, as the
        // schema they mirror now is: a field name assembled from an argument is
        // not in the source, and cannot be grepped, read or reported on.
        {
            to: "contractDate",
            runtimeOnly: "the world time the host contracted the affliction",
            describe: "When the host contracted it. Play state, never authored.",
        },
        {
            to: "onsetDate",
            runtimeOnly: "the world time onset fired at",
            describe: "When onset fired. Play state, never authored.",
        },
        {
            to: "treatmentDate",
            runtimeOnly: "the world time the affliction was last treated",
            describe: "When it was last treated. Play state, never authored.",
        },
        {
            to: "resolutionDate",
            runtimeOnly: "the world time the affliction ran its course",
            describe: "When it resolved. Play state, never authored.",
        },
    ]),

    armorgear: Object.freeze([
        ...GEAR_COMMON,
        {
            name: "material",
            to: "material",
            ...AS_AUTHORED,
            default: "",
            describe: "What the article is made of.",
        },
        {
            name: "flexloc",
            to: "locations.flexible",
            ...BLANK_IS_DEFAULT,
            default: [],
            describe: "Body locations the article covers flexibly, by location shortcode.",
        },
        {
            name: "rigidloc",
            to: "locations.rigid",
            ...BLANK_IS_DEFAULT,
            default: [],
            describe: "Body locations the article covers rigidly, by location shortcode.",
        },
        {
            name: "facing",
            to: "locations.facing",
            ...FACING,
            default: [],
            describe:
                "For a one-sided article, which side of each location it protects. Everything else protects from any direction and leaves this empty.",
        },
        {
            name: "protection.blunt",
            to: "protectionBase.blunt",
            ...NUMBER,
            default: 0,
            describe: "Protection against blunt impact.",
        },
        {
            name: "protection.edged",
            to: "protectionBase.edged",
            ...NUMBER,
            default: 0,
            describe: "Protection against edged impact.",
        },
        {
            name: "protection.piercing",
            to: "protectionBase.piercing",
            ...NUMBER,
            default: 0,
            describe: "Protection against piercing impact.",
        },
        {
            name: "protection.fire",
            to: "protectionBase.fire",
            ...NUMBER,
            default: 0,
            describe: "Protection against fire and heat.",
        },
        {
            name: "encumbrance",
            to: "encumbrance",
            ...NUMBER,
            default: 0,
            describe: "What wearing it costs in encumbrance.",
        },
        {
            name: "encumbranceGroup",
            to: "encumbranceGroup",
            ...BLANK_IS_NULL,
            default: null,
            describe:
                "The set an article's encumbrance is charged to instead of carrying its own — the arm harness.",
        },
        {
            name: "perceptionPenaltyBase",
            to: "perceptionPenaltyBase",
            ...NUMBER,
            default: 0,
            describe: "What wearing it costs in perception.",
        },
    ]),

    attribute: Object.freeze([
        {
            name: "scoreBase",
            to: "scoreBase",
            ...NUMBER,
            default: 0,
            describe: "The attribute's score before any modifier.",
        },
        {
            name: "valueDesc",
            to: "valueDesc",
            ...VALUE_DESC,
            default: [],
            describe:
                "Descriptive bands for the score, each a label and the highest value it covers.",
        },
        {
            name: "initDiceFormula",
            to: "initDiceFormula",
            ...AS_AUTHORED,
            default: "",
            describe: "Dice expression rolled to generate the score during character creation.",
        },
        {
            name: "impairedByRoles",
            to: "impairedByRoles",
            ...AS_AUTHORED,
            default: [],
            describe: "Body-part roles whose impairment penalises tests against this attribute.",
        },
    ]),

    concoctiongear: Object.freeze([
        ...GEAR_COMMON,
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "What kind of concoction it is.",
        },
        {
            name: "potency",
            to: "potency",
            ...AS_AUTHORED,
            default: "notApplicable",
            describe: "How concentrated the preparation is.",
        },
        {
            name: "strength",
            to: "strength",
            ...NUMBER,
            default: 0,
            describe: "How strongly it acts when it does.",
        },
    ]),

    containergear: Object.freeze([
        ...GEAR_COMMON,
        {
            name: "maxCapacity",
            to: "maxCapacityBase",
            ...NUMBER,
            default: 0,
            describe: "How much the container holds, in pounds.",
        },
    ]),

    miscgear: Object.freeze([...GEAR_COMMON]),

    mystery: Object.freeze([
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "Which tradition the mystery belongs to.",
        },
        {
            name: "assocSkillCode",
            to: "assocSkillCode",
            ref: "skill",
            ...BLANK_IS_NULL,
            default: null,
            describe: "Shortcode of the skill the mystery is tested against.",
        },
        {
            name: "assocAffiliationCode",
            to: "assocAffiliationCode",
            ref: "affiliation",
            ...BLANK_IS_NULL,
            default: null,
            describe:
                "Shortcode of the affiliation whose standing confers the mystery — a religion, school, or ancestor/totem/spirit.",
        },
        {
            name: "levelBase",
            to: "levelBase",
            ...NUMBER,
            default: 0,
            describe: "The mystery's level before any modifier.",
        },
        {
            name: "skillAptitudes",
            to: "skillAptitudes",
            ...SKILL_APTITUDES,
            default: {},
            describe: "Aptitude the mystery grants, per skill selector.",
        },
        {
            name: "charges",
            to: "charges",
            ...CHARGES,
            default: { value: null, max: null },
            describe:
                "Uses available and the pool's size. A blank maximum means the mystery does not use charges.",
        },
    ]),

    mysticalability: Object.freeze([
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "Which tradition the ability belongs to.",
        },
        {
            name: "assocSkillCode",
            to: "assocSkillCode",
            ref: "skill",
            ...AS_AUTHORED,
            default: "",
            describe: "Shortcode of the skill the ability is tested against.",
        },
        {
            name: "assocAffiliationCode",
            to: "assocAffiliationCode",
            ref: "affiliation",
            ...BLANK_IS_NULL,
            default: null,
            describe:
                "Shortcode of the affiliation whose standing confers the ability — a religion, school, or ancestor/totem/spirit.",
        },
        {
            name: "masteryLevelBase",
            to: "masteryLevelBase",
            ...NUMBER,
            default: 0,
            describe: "Mastery in the ability before any modifier.",
        },
        {
            name: "improveFlag",
            to: "improveFlag",
            ...BOOLEAN,
            default: false,
            describe: "Whether it is flagged for improvement.",
        },
        {
            name: "levelBase",
            to: "levelBase",
            ...NUMBER,
            default: 0,
            describe: "The ability's level before any modifier.",
        },
        {
            name: "charges",
            to: "charges",
            ...CHARGES,
            default: { value: null, max: null },
            describe:
                "Uses available and the pool's size. A blank maximum means the ability does not use charges.",
        },
    ]),

    projectilegear: Object.freeze([
        ...GEAR_COMMON,
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "What kind of projectile it is.",
        },
        {
            to: "impactBase.numDice",
            value: (fm) => (impactDie(fm) > 0 ? 1 : 0),
            describe:
                "How many dice are rolled. Derived: one when a die is declared, none otherwise.",
        },
        {
            name: "impact.die",
            to: "impactBase.die",
            ...NUMBER,
            default: 0,
            describe: "The impact die's size.",
        },
        {
            name: "impact.modifier",
            to: "impactBase.modifier",
            ...NUMBER,
            default: 0,
            describe: "Flat addition to the impact roll.",
        },
        {
            name: "impact.aspect",
            to: "impactBase.aspect",
            ...BLANK_IS_DEFAULT,
            default: "piercing",
            describe: "How the projectile wounds.",
        },
    ]),

    skill: Object.freeze([
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "Which family of skill it is.",
        },
        {
            name: "skillBaseFormula",
            to: "skillBaseFormula",
            ...AS_AUTHORED,
            default: "",
            describe:
                "Expression deriving the skill's base from the actor's attributes, e.g. `sb(attr.str, attr.agl)`.",
        },
        {
            name: "masteryLevelBase",
            to: "masteryLevelBase",
            ...NULLABLE_NUMBER,
            default: null,
            describe:
                "Opened mastery level. Unset means _not yet opened_ — an embedded copy opens on its actor at Skill Base × `initSkillMult`.",
        },
        {
            name: "improveFlag",
            to: "improveFlag",
            ...BOOLEAN,
            default: false,
            describe: "Whether it is flagged for improvement.",
        },
        {
            name: "combatCategory",
            to: "combatCategory",
            ...AS_AUTHORED,
            default: "none",
            describe: "Which combat role the skill fills, if any.",
        },
        {
            name: "parentSkillCode",
            to: "parentSkillCode",
            ref: "skill",
            ...AS_AUTHORED,
            default: "",
            describe: "Shortcode of the skill this one specialises, for a specialisation.",
        },
        {
            name: "initSkillMult",
            to: "initSkillMult",
            ...NUMBER,
            default: 0,
            describe: "Multiplier applied to Skill Base when the skill opens on an actor.",
        },
        {
            name: "impairedByRoles",
            to: "impairedByRoles",
            ...AS_AUTHORED,
            default: [],
            describe: "Body-part roles whose impairment penalises tests against this skill.",
        },
    ]),

    trauma: Object.freeze([
        {
            name: "subType",
            to: "subType",
            ...SUB_TYPE,
            required: true,
            describe: "What kind of trauma it is.",
        },
        {
            name: "category",
            to: "category",
            ...AS_AUTHORED,
            default: null,
            describe: "The grouping it belongs to within its subtype.",
        },
        {
            name: "levelBase",
            to: "levelBase",
            ...NULLABLE_COUNT,
            default: null,
            describe: "Injury level. Unset on a descriptive condition, which has no level.",
        },
        {
            name: "healingRateBase",
            to: "healingRateBase",
            ...NUMBER,
            default: 0,
            describe: "How readily it heals.",
        },
        {
            name: "aspect",
            to: "aspect",
            ...AS_AUTHORED,
            default: null,
            describe: "How the injury was inflicted. Unset on a descriptive condition.",
        },
        {
            name: "bodyLocationCode",
            to: "bodyLocationCode",
            ...AS_AUTHORED,
            default: null,
            describe: "Shortcode of the body location injured. Unset on a descriptive condition.",
        },
        // A trauma's three timed phases (#329). Its healing check and course
        // both fall back to a **world setting** when the trauma sets neither
        // half, which is the sharper reason these omit rather than default: a
        // compile-time `null` written here is still a value, and the seeding in
        // `TraumaDataModel._preCreate` reads `data.courseDurationFormula == null`
        // to decide whether the GM's configured interval applies. A default
        // would answer that question for every trauma in every world.
        //
        // `bloodLossAdvance*` is the one an author reaches for most: a trauma
        // that sets it bleeds, and one that leaves it unset does not.
        {
            name: "healingCheckDurationFormula",
            to: "healingCheckDurationFormula",
            ...DURATION_FORMULA,
            omitWhenAbsent: true,
            describe:
                "Interval between healing checks. Omitted when unset, leaving the world's configured interval to apply.",
        },
        {
            name: "healingCheckDurationBase",
            to: "healingCheckDurationBase",
            ...DURATION_BASE,
            omitWhenAbsent: true,
            describe:
                "The healing-check interval in seconds, standing in for a roll of the formula. Omitted when unset.",
        },
        {
            name: "bloodLossAdvanceDurationFormula",
            to: "bloodLossAdvanceDurationFormula",
            ...DURATION_FORMULA,
            omitWhenAbsent: true,
            describe:
                "Interval between blood-loss advances. Omitted when unset, leaving the world's configured interval to apply.",
        },
        {
            name: "bloodLossAdvanceDurationBase",
            to: "bloodLossAdvanceDurationBase",
            ...DURATION_BASE,
            omitWhenAbsent: true,
            describe:
                "The blood-loss interval in seconds. Setting it is what makes the wound bleed; omitted when unset, and the wound does not.",
        },
        {
            name: "courseDurationFormula",
            to: "courseDurationFormula",
            ...DURATION_FORMULA,
            omitWhenAbsent: true,
            describe:
                "Interval between course tests, for a condition that runs one — shock, coma, infection. Omitted when unset.",
        },
        {
            name: "courseDurationBase",
            to: "courseDurationBase",
            ...DURATION_BASE,
            omitWhenAbsent: true,
            describe:
                "The course-test interval in seconds, standing in for a roll of the formula. Omitted when unset.",
        },
        // Runtime state, for the reason `affliction`'s four are (#330): a
        // trauma's dates are crystallized when the phase fires, and world time
        // does not exist while content is compiled.
        {
            to: "contractDate",
            runtimeOnly: "the world time the injury was taken",
            describe: "When the injury was taken. Play state, never authored.",
        },
        {
            to: "treatmentDate",
            runtimeOnly: "the world time the injury was last treated",
            describe: "When it was last treated. Play state, never authored.",
        },
    ]),

    weapongear: Object.freeze([
        ...GEAR_COMMON,
        {
            name: "encumbrance",
            to: "encumbranceBase",
            ...NUMBER,
            default: 0,
            describe: "What carrying it costs in encumbrance.",
        },
        {
            name: "heft",
            to: "heftBase",
            ...NUMBER,
            default: 0,
            describe: "How unwieldy it is in the hand.",
        },
        {
            name: "strikeModes",
            to: "strikeModes",
            ...STRIKE_MODES,
            default: [],
            describe: "The ways the weapon can be used to strike.",
        },
    ]),
});

/**
 * The one conditional field in the vocabulary: a combat technique's strike
 * mode.
 *
 * A combat technique is authored as a `skill` of subtype `combattechnique` —
 * the standalone item type was merged into Skill — and carries an embedded,
 * discriminated strike mode. It is mandatory for that subtype and absent from
 * every other skill, which is a conditional a flat field list cannot state, so
 * it is applied after the declaration runs.
 *
 * @type {import("../engine/field-spec.mjs").FieldSpec}
 */
export const COMBAT_TECHNIQUE_STRIKE_MODE = Object.freeze({
    name: "strikeMode",
    to: "strikeMode",
    ...STRIKE_MODE,
    required: true,
    default: null,
    describe:
        "The strike mode the technique trains. Required on a `combattechnique` skill, and set on no other.",
});
