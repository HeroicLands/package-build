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
 * The **closed** half of a note's frontmatter: the `data:` container, and the
 * `subType` each note type declares (#128).
 *
 * A note's frontmatter has three regions, and only one of them is open. The
 * **top level** describes the note as a published artefact, every key of it is
 * copied into the generated web page, and an unrecognised key there is a Hugo
 * or theme parameter this build has no standing to refuse. The **system
 * blocks** describe the subject as one system's documents. Between them sits
 * `data:` — the type-specific facts about the subject itself, system-agnostic,
 * and closed.
 *
 * Closed is the whole point. Those facts previously sat at the top level, where
 * the pass-through rule applied to them too, so a misspelled `wieght` became a
 * theme parameter rather than a finding — indistinguishable, from the outside,
 * from a weapon that simply weighs nothing. Under `data:` the same misspelling
 * is an error naming the note and the key it was probably meant to be.
 *
 * **`subType` rides along, and stays at the top level.** It is not a `data:`
 * key: a note's `(type, subType)` is what each system's map reads to derive a
 * document type, so it describes the note rather than the subject. But it is
 * the other per-type vocabulary the format closes, it is enumerated in the same
 * `### type:` section of the specification that enumerates the `data:` keys,
 * and keeping the two together means one entry per type rather than two
 * registries free to disagree about which types exist.
 *
 * **This is note-format knowledge, so it lives in `engine/`.** `data:` holds
 * what is true of the *thing* — a weapon's weight, an affliction's
 * transmission — and is true of it whichever system is reading. What each
 * system makes of that value is declared elsewhere, in that system's own half.
 *
 * **The type names here are today's**, which for four of them is not the name
 * the specification uses: `armor`, `weapon`, `projectile` and `concoction` are
 * still spelled `armorgear`, `weapongear`, `projectilegear` and
 * `concoctiongear`, and a `map` is still one of `battlemap` / `localmap` /
 * `regionalmap`. Those renames are a later slice (#78, #79), and declaring the
 * vocabulary under a name no note may yet carry would make it unreachable. The
 * specification's types with no name here at all — `place`, `scenario`,
 * `lore`, `vehicle`, `armorlocation` — are likewise deferred: a note carrying
 * one is already reported as a type no schema declares, which is the finding it
 * deserves until the type exists.
 *
 * @module
 */

/**
 * One `data:` key a note type may carry.
 *
 * A deliberate subset of {@link import("./field-spec.mjs").FieldSpec}: no `to`,
 * because nothing here builds anything yet. Reading `data.*` through into a
 * document's `system` block is the passthrough slice (#126), and claiming an
 * emitted path this does not produce would be a lie in the one place a reader
 * would trust it.
 *
 * @typedef {object} DataFieldSpec
 * @property {string} name - The key under `data:`, dotted for a nested one
 *   (`charges.value`).
 * @property {"string"|"number"|"boolean"|"list"|"map"} [kind] - The value's
 *   shape, for the lint. Absent means no claim is made about the value — which
 *   is the honest answer wherever the specification's stated shape and the
 *   shape notes are authored in today disagree.
 * @property {string} [shape] - Human-readable shape, for a finding and for
 *   documentation.
 * @property {string} describe - One line, for the author-facing reference.
 */

/**
 * What one note type declares.
 *
 * `subTypes` is three-valued, and the difference matters:
 *
 * - **omitted** — the type has no `subType` at all, and a note carrying one is
 *   a finding. A `weapon` is the deliberate case: SoHL distinguishes a
 *   weapon's uses by strike mode rather than by kind.
 * - **`null`** — the type has a `subType` whose values the specification does
 *   not yet enumerate. Presence is permitted and the value is unchecked.
 * - **a list** — the closed set of values, and anything else is a finding.
 *
 * @typedef {object} TypeVocabulary
 * @property {readonly DataFieldSpec[]} data - The `data:` keys, closed.
 * @property {readonly string[]|null} [subTypes] - The top-level `subType`
 *   values, as above.
 */

/* --------------------------------------------------------------------- */
/*  Shapes                                                                */
/* --------------------------------------------------------------------- */

/** A number. */
const NUM = Object.freeze({ shape: "number", kind: "number" });

/** A string, including the enumerated-value fields the format spells as one. */
const TEXT = Object.freeze({ shape: "string", kind: "string" });

/** A list. */
const LIST = Object.freeze({ shape: "list", kind: "list" });

/** A single wikilink, which is a string until it is resolved. */
const LINK = Object.freeze({ shape: "a wikilink", kind: "string" });

/** A list of wikilinks. */
const LINKS = Object.freeze({ shape: "list of wikilinks", kind: "list" });

/** Whatever the author wrote — declared, but with no claim about its shape. */
const ANY = Object.freeze({ shape: "as authored" });

/**
 * The template-priority key every document-producing type carries.
 *
 * Declared once and shared, rather than retyped in twenty tables where the one
 * that was mistyped would be the one nobody noticed.
 *
 * @type {DataFieldSpec}
 */
const TEMPLATE_PRIORITY = Object.freeze({
    name: "templatePriority",
    ...NUM,
    describe: "Template priority; unset means the note is not a template.",
});

/**
 * The four gear values every carried thing declares.
 *
 * @type {readonly DataFieldSpec[]}
 */
const GEAR = Object.freeze([
    { name: "weight", ...NUM, describe: "What the thing weighs." },
    { name: "value", ...NUM, describe: "What the thing is worth." },
    { name: "quality", ...NUM, describe: "How well it is made." },
    { name: "durability", ...NUM, describe: "How much wear it takes before it fails." },
]);

/** Gear that is counted rather than carried singly. */
const QUANTITY = Object.freeze({
    name: "quantity",
    ...NUM,
    describe: "How many of the thing there are; one when unstated.",
});

/**
 * The charges a mystery or mystical ability holds.
 *
 * @type {readonly DataFieldSpec[]}
 */
const CHARGES = Object.freeze([
    {
        name: "charges.value",
        ...NUM,
        describe: "Charges available now; unset means charges are not used.",
    },
    { name: "charges.max", ...NUM, describe: "Most charges it can hold; unset means no maximum." },
]);

/* --------------------------------------------------------------------- */
/*  The vocabulary                                                        */
/* --------------------------------------------------------------------- */

/**
 * Every note type this toolchain compiles, and the closed vocabulary it
 * declares.
 *
 * Taken from the content-format specification, one `### type:` section per
 * entry. Where the specification and the shape notes are authored in today
 * disagree, the specification wins on the **name** — that is what a `data:`
 * key will be called — and the disagreement is recorded on the field rather
 * than resolved silently.
 *
 * @type {Readonly<Record<string, TypeVocabulary>>}
 */
export const NOTE_VOCABULARY = Object.freeze({
    /* ----- actors --------------------------------------------------- */

    being: Object.freeze({
        // Derived from the note's `(type, subType)` by each system's map, which
        // lands with #79. Declared open until it does, because inventing the
        // values here would put a second, weaker answer beside the real one.
        subTypes: null,
        data: Object.freeze([
            { name: "portrait", ...TEXT, describe: "Path to the portrait image." },
            TEMPLATE_PRIORITY,
            { name: "archetypes", ...LIST, describe: "Archetypal behaviours the being fits." },
            { name: "occupation", ...TEXT, describe: "What the being does for a living." },
            { name: "stations", ...LINKS, describe: "Stations the being holds." },
            { name: "peoples", ...LINKS, describe: "Peoples the being belongs to." },
            { name: "homes", ...LINKS, describe: "Places the being calls home." },
            {
                name: "affiliations",
                ...LINKS,
                describe: "Affiliations the being belongs to — traditions, polities, and the rest.",
            },
            { name: "gender", ...TEXT, describe: "`male`, `female` or `other`." },
            { name: "species", ...LINK, describe: "The being's species, as a lore note." },
            { name: "age", ...NUM, describe: "Age in years." },
            { name: "birthday", ...TEXT, describe: "Date of birth, `YYYY/MM/DD`." },
            { name: "height", ...NUM, describe: "Height in metres." },
            { name: "weight", ...NUM, describe: "Weight in kilograms." },
            {
                name: "frame",
                ...TEXT,
                describe: "Relative frame — `scant`, `light`, `medium`, `large` or `massive`.",
            },
            { name: "appearance.eye_color", ...TEXT, describe: "Eye colour." },
            { name: "appearance.hair_color", ...TEXT, describe: "Hair colour." },
            { name: "appearance.skin_color", ...TEXT, describe: "Skin colour." },
            { name: "appearance.complexion", ...TEXT, describe: "Complexion." },
            {
                name: "appearance.extra_features",
                ...LIST,
                describe: "Anything else a stranger would notice.",
            },
        ]),
    }),

    /* ----- items ---------------------------------------------------- */

    affiliation: Object.freeze({
        subTypes: Object.freeze([
            "guild",
            "order",
            "polity",
            "faithtradition",
            "arcanetradition",
            "spirittradition",
            "lineage",
            "venture",
            "criminal",
            "governmental",
            "fellowship",
        ]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            {
                name: "demonym",
                ...TEXT,
                describe: "What one member is called — a Vylarian.",
            },
            {
                name: "governance.model",
                ...TEXT,
                describe: "How the affiliation is governed, where it is.",
            },
            // The specification spells this row `government.summary` while its
            // neighbour is `governance.model`. Declared as written rather than
            // silently corrected, because the vocabulary is closed and a
            // closed vocabulary is exactly the wrong place to guess: the two
            // roots have to be reconciled in the specification, not here.
            {
                name: "government.summary",
                ...TEXT,
                describe: "A sentence on how the governance actually works.",
            },
            { name: "languages", ...LINKS, describe: "Official languages, as skill notes." },
            { name: "seat", ...LINK, describe: "Where the affiliation's authority sits." },
            { name: "domain", ...LINKS, describe: "Places over which it holds sway." },
            { name: "population", ...NUM, describe: "How many people it counts." },
            { name: "pantheons", ...LINKS, describe: "Pantheons it is bound to." },
            { name: "peoples", ...LINKS, describe: "Peoples associated with it." },
            { name: "parents", ...LINKS, describe: "Affiliations it is subordinate to." },
            { name: "relations", ...ANY, describe: "Standing with other affiliations." },
            {
                name: "society",
                ...TEXT,
                describe: "The social order it operates within — feudal, tribal.",
            },
            {
                name: "office",
                ...TEXT,
                describe: "Membership: the office a member holds. Empty on a catalogue entry.",
            },
            {
                name: "title",
                ...TEXT,
                describe: "Membership: the title a member bears. Empty on a catalogue entry.",
            },
            {
                name: "level",
                ...NUM,
                describe: "Membership: the member's rank. Empty on a catalogue entry.",
            },
        ]),
    }),

    affliction: Object.freeze({
        subTypes: Object.freeze(["disease", "poisontoxin", "maladiction"]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            { name: "transmission", ...TEXT, describe: "How it passes from one host to another." },
            {
                name: "outcome",
                ...TEXT,
                describe: "Where it ends once it has run its course — `death` or `cured`.",
            },
            { name: "healingRate", ...NUM, describe: "How readily a healing test goes well." },
            { name: "contagionIndex", ...NUM, describe: "How contagious it is." },
            {
                name: "outcomeTraumas",
                ...TEXT,
                describe: "Expression returning the traumas recovery leaves behind.",
            },
            {
                name: "onsetDurationFormula",
                ...TEXT,
                describe: "Roll formula for the delay between contraction and onset.",
            },
            {
                name: "healingCheckDurationFormula",
                ...TEXT,
                describe: "Roll formula for the interval between healing checks.",
            },
            {
                name: "resolutionDurationFormula",
                ...TEXT,
                describe: "Roll formula for the time from onset to resolution.",
            },
        ]),
    }),

    armorgear: Object.freeze({
        // Quantity is always one, so the specification refuses the key rather
        // than defaulting it.
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR]),
    }),

    attribute: Object.freeze({
        data: Object.freeze([TEMPLATE_PRIORITY]),
    }),

    concoctiongear: Object.freeze({
        subTypes: Object.freeze(["mundane", "exotic", "elixir"]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            ...GEAR,
            QUANTITY,
            {
                name: "potency",
                ...TEXT,
                describe: "Potency — `na`, `mild`, `strong` or `great`.",
            },
            { name: "strength", ...NUM, describe: "Strength; the higher, the stronger." },
        ]),
    }),

    containergear: Object.freeze({
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            ...GEAR,
            { name: "capacity", ...NUM, describe: "How much it holds." },
        ]),
    }),

    miscgear: Object.freeze({
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR, QUANTITY]),
    }),

    mystery: Object.freeze({
        subTypes: Object.freeze(["boon", "boost", "fate", "grace", "other", "piety"]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            { name: "assocSkill", ...LINK, describe: "The skill it is associated with." },
            {
                name: "assocAffiliation",
                ...LINK,
                describe: "The affiliation it is associated with.",
            },
            {
                name: "skillAptitudes",
                ...ANY,
                describe:
                    "Bonuses and penalties, each naming a skill or a `subType:<skill-subtype>`.",
            },
            { name: "level", ...NUM, describe: "The magnitude of the mystery." },
            ...CHARGES,
        ]),
    }),

    mysticalability: Object.freeze({
        subTypes: Object.freeze([
            "spiritrite",
            "spiritaction",
            "spiritpower",
            "ritualaction",
            "divineincantation",
            "arcaneincantation",
            "arcanetalent",
            "spirittalent",
            "alchemy",
            "divination",
        ]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            { name: "assocSkill", ...LINK, describe: "The skill it is associated with." },
            {
                name: "assocAffiliation",
                ...LINK,
                describe: "The affiliation it is associated with.",
            },
            { name: "masteryLevel", ...NUM, describe: "Mastery before any modifier." },
            { name: "level", ...NUM, describe: "The magnitude of the ability." },
            ...CHARGES,
        ]),
    }),

    projectilegear: Object.freeze({
        subTypes: Object.freeze(["none", "arrow", "bolt", "bullet", "dart", "other"]),
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR, QUANTITY]),
    }),

    skill: Object.freeze({
        subTypes: Object.freeze([
            "social",
            "nature",
            "craft",
            "lore",
            "language",
            "script",
            "mystical",
            "physical",
            "combat",
            "combattechnique",
        ]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            { name: "masteryLevel", ...NUM, describe: "Mastery before any modifier." },
            { name: "parentSkill", ...LINK, describe: "The skill this one specialises." },
        ]),
    }),

    trauma: Object.freeze({
        subTypes: Object.freeze([
            "injury",
            "fear",
            "morale",
            "pall",
            "psycond",
            "physcond",
            "auralshock",
            "fatigue",
            "infection",
            "shock",
            "coma",
        ]),
        data: Object.freeze([TEMPLATE_PRIORITY]),
    }),

    weapongear: Object.freeze({
        // No `subTypes`, deliberately: SoHL distinguishes a weapon's uses with
        // strike modes rather than by kind, and HM3's document type follows
        // from which of those a note describes.
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR]),
    }),

    /* ----- core documents ------------------------------------------- */

    doc: Object.freeze({
        subTypes: Object.freeze(["rules", "user-guide", "reference"]),
        data: Object.freeze([]),
    }),

    macro: Object.freeze({ data: Object.freeze([]) }),

    homepage: Object.freeze({ data: Object.freeze([]) }),

    ...Object.fromEntries(
        ["battlemap", "localmap", "regionalmap"].map((type) => [
            type,
            Object.freeze({
                data: Object.freeze([
                    // The specification spells this `img`, matching every other
                    // note type, while the map compiler reads `image` from
                    // `sohl:` today. It says outright that one of the two has
                    // to move; the container takes the specification's name,
                    // and moving the authored key is the migration's business.
                    { name: "img", ...TEXT, describe: "Path to the map art." },
                    {
                        name: "dimensions",
                        ...LIST,
                        describe: "`[width, height]` in whole pixels — the art's own size.",
                    },
                    {
                        name: "pxPerGrid",
                        ...NUM,
                        describe: "Whole pixels per grid square; must match the art.",
                    },
                    { name: "navName", ...TEXT, describe: "Short name for the navigation bar." },
                    { name: "levelName", ...TEXT, describe: "Name of the embedded level." },
                    {
                        name: "backgroundColor",
                        ...TEXT,
                        describe: "Colour shown where the art does not reach.",
                    },
                    { name: "overlay", ...TEXT, describe: "Path to the foreground art." },
                    // Geometry carries no `kind`. The specification lists each
                    // as a sequence while the notes authoring them today write
                    // a map keyed by name, and a lint has no business picking
                    // the winner of a disagreement the format has not settled.
                    { name: "walls", ...ANY, describe: "Wall segments." },
                    { name: "doors", ...ANY, describe: "Doors." },
                    { name: "lights", ...ANY, describe: "Light sources." },
                    { name: "tiles", ...ANY, describe: "Tiles." },
                    { name: "sounds", ...ANY, describe: "Ambient sounds." },
                    { name: "regions", ...ANY, describe: "Regions and their behaviours." },
                    {
                        name: "notes",
                        ...ANY,
                        describe:
                            "Map pins, each a grid location and an anchor in this note's own body.",
                    },
                ]),
            }),
        ]),
    ),
});

/**
 * The `data:` keys a note type may carry.
 *
 * @param {string} type - The note's `type`.
 * @param {Readonly<Record<string, TypeVocabulary>>} [vocabulary] - The registry
 *   to read, defaulting to {@link NOTE_VOCABULARY}.
 * @returns {readonly DataFieldSpec[]|undefined} The declaration, or `undefined`
 *   when the type declares none — which is not the same as declaring an empty
 *   one, and is why the lint makes no claim rather than refusing every key.
 */
export function dataFields(type, vocabulary = NOTE_VOCABULARY) {
    return vocabulary?.[type]?.data;
}

/**
 * The `subType` values a note type declares.
 *
 * @param {string} type - The note's `type`.
 * @param {Readonly<Record<string, TypeVocabulary>>} [vocabulary] - The registry
 *   to read, defaulting to {@link NOTE_VOCABULARY}.
 * @returns {readonly string[]|null|undefined} The closed set; `null` when the
 *   type has a `subType` whose values are not yet enumerated; `undefined` when
 *   it has no `subType` at all — see {@link TypeVocabulary}.
 */
export function subTypes(type, vocabulary = NOTE_VOCABULARY) {
    const entry = vocabulary?.[type];
    if (!entry || !Object.hasOwn(entry, "subTypes")) return undefined;
    return entry.subTypes;
}
