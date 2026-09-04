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
 * **A type name and a subType value are held to the address charset** (#206), so
 * both are `^[A-Za-z0-9]+$` — the charset `engine/address-charset.mjs` states
 * and the shortcode is already held to. For a type that is literal: it is the
 * first segment of every address (`type-shortcode`), the hyphen is the
 * separator between segments and can therefore never occur inside one, and a
 * hyphenated name would be read back as two segments and resolve to nothing,
 * reporting nothing about why.
 *
 * A subType reaches no address of its own. It did when this rule was written —
 * a `doc`'s was its section, a path segment — and #204 retired sections from
 * the note format one release later. It keeps the rule regardless, and the
 * reason is not inertia: a subType is a vocabulary term the whole toolchain
 * keys on, it is one closed set away from being an address again, and a charset
 * that held for a type, a shortcode and a package but not for a subType would
 * be a rule nobody could state in one sentence. The registry below is checked
 * against it as this module loads, so a declaration that breaks it cannot be
 * imported, let alone shipped.
 *
 * @module
 */

// The one charset, read rather than restated. A second spelling of the pattern
// is how the three disagreements found in #202/#203 happened.
import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "./address-charset.mjs";

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
/**
 * The tags that **classify** a note, grouped by what they classify (#172).
 *
 * `tags:` lives at the open top level and most tags belong there: a theme, a
 * region, a working state is the author's own and this build has no opinion
 * about it. A classifying tag is different, because something queries it — a
 * settlement tagged `village` appears in the list of villages and an untagged
 * one does not, so `vilage` does not merely look wrong, it removes the note from
 * an index while the index still renders a table that looks complete.
 *
 * **This list is not a closed set.** An unrecognised tag is legal, because the
 * region is open; what is reported is a **near miss** — a tag close enough to a
 * declared one to be a typo of it.
 *
 * **Each group names the types it applies to**, and that scope is what makes the
 * check sound rather than noisy. A place's kinds are only a place's: `azravan`
 * on a faith, `barter` on an economy note and `secret` on three lore notes all
 * sit within a typo's distance of `caravan`, `border` and `sacred`, and not one
 * is a mistake. Checked against every group at once the rule was wrong on every
 * note it touched; scoped to the type it is wrong on none. `types: null` is a
 * group any note may carry.
 *
 * Kind and character are separate groups because one slot could not hold both: a
 * fishing village is a `village` that is `fishing`, and the single-valued field
 * this replaced had to spell it `Fishing Village` as a value of its own.
 */
/**
 * The declared tag that marks a note as **unfinished** (#183).
 *
 * Named once and referenced from the declaration below, because a second
 * spelling is how the two come apart: rename the tag in `DECLARED_TAGS` and a
 * private copy elsewhere keeps matching the old word, silently.
 *
 * It is a **presentation** fact and nothing more. A draft note compiles,
 * validates, publishes and resolves like any other; only a link *into* it
 * renders marked. What it emphatically is not is the retired `draft:` field,
 * whose entire effect was to move a note from published to unresolvable — see
 * {@link draftRetiredMessage}.
 */
export const DRAFT_TAG = "draft";

export const DECLARED_TAGS = Object.freeze({
    /** What a place *is*. */
    placeKind: Object.freeze({
        types: ["place"],
        tags: Object.freeze([
            "city",
            "city-state",
            "town",
            "village",
            "settlement",
            "port",
            "fortress",
            "citadel",
            "castle",
            "stronghold",
            "garrison",
            "camp",
            "oasis",
            "waypoint",
            "post",
            "precinct",
            "district",
            "necropolis",
            "hall",
            "capital",
        ]),
    }),
    /** What a place is known for. */
    placeCharacter: Object.freeze({
        types: ["place"],
        tags: Object.freeze([
            "fortified",
            "temple",
            "market",
            "trading",
            "merchant",
            "mining",
            "fishing",
            "naval",
            "military",
            "imperial",
            "provincial",
            "coastal",
            "river",
            "lakeside",
            "hill",
            "mountain",
            "valley",
            "forest",
            "woodland",
            "inland",
            "island",
            "frontier",
            "border",
            "craft",
            "caravan",
            "pilgrimage",
            "holy",
            "sacred",
            "free",
        ]),
    }),
    /** A place's scale, where the subtype does not distinguish it. */
    placeScale: Object.freeze({ types: ["place"], tags: Object.freeze(["continent"]) }),
    /** Which kind of body a being belongs to — a station rather than a rank. */
    beingStation: Object.freeze({
        types: ["being"],
        tags: Object.freeze([
            "tradesfolk",
            "common-folk",
            "soldiery",
            "administration",
            "clergy",
            "mages",
            "underworld",
            "dependents",
            "guilded",
            "unguilded",
        ]),
    }),
    /** A note's working state, which any note may carry. */
    state: Object.freeze({ types: null, tags: Object.freeze([DRAFT_TAG]) }),
});

/**
 * The declared tags a note of this type may carry, flattened.
 *
 * @param {string} type - The note's type.
 * @param {object} [groups] - The grouped declaration.
 * @returns {readonly string[]} The tags, in declaration order.
 */
export function declaredTags(type, groups = DECLARED_TAGS) {
    const applies = Object.values(groups).filter((g) => !g.types || g.types.includes(type));
    return Object.freeze(applies.flatMap((g) => g.tags));
}

/**
 * Whether a note carries a given tag, however the author wrote it.
 *
 * `tags:` is authored by hand and Obsidian is permissive about it: a single tag
 * may be a scalar rather than a list, a value may carry the leading `#` it is
 * written with in prose, and case and surrounding space are not significant.
 * The spelling of the tag *itself* still is — a near miss is a near miss, and
 * the frontmatter lint is what reports it; nothing here guesses.
 *
 * Reads `tags` and, as Dataview does, `tag` — the singular spelling Obsidian
 * also accepts.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} tag - The tag to look for, in its declared spelling.
 * @returns {boolean} Whether the note carries it.
 */
export function hasTag(fm, tag) {
    const raw = fm?.tags ?? fm?.tag;
    if (raw == null) return false;
    const wanted = String(tag).toLowerCase();
    for (const entry of Array.isArray(raw) ? raw : [raw]) {
        if (typeof entry !== "string") continue;
        if (entry.trim().replace(/^#/, "").toLowerCase() === wanted) return true;
    }
    return false;
}

/**
 * Whether a note is tagged as an unfinished **draft** (#183).
 *
 * The one reader of {@link DRAFT_TAG}, so both builds ask the same question of
 * the same field. Presentation only: a draft note is in the packs, in the
 * manifest and on the site exactly as any other, and this decides nothing but
 * whether a link into it renders marked.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {boolean} Whether the note carries the `draft` tag.
 */
export function isDraftNote(fm) {
    return hasTag(fm, DRAFT_TAG);
}

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
            {
                name: "governance.summary",
                ...TEXT,
                describe: "A sentence on how the governance actually works.",
            },
            {
                name: "governance.ranks",
                ...LIST,
                describe: "The ladder of ranks the body confers — level, title, description.",
            },
            {
                name: "governance.offices",
                ...ANY,
                describe: "The named offices it appoints, each with what the office does.",
            },
            {
                name: "commonSkills",
                ...LINKS,
                describe: "Skills common among members — languages first among them.",
            },
            { name: "seat", ...LINK, describe: "Where the affiliation's authority sits." },
            { name: "domains", ...LINKS, describe: "Places over which it holds sway." },
            { name: "population", ...NUM, describe: "How many people it counts." },
            {
                name: "economy",
                ...LINKS,
                describe: "What its economic life runs on — currencies, banking bodies, goods.",
            },
            { name: "peoples", ...LINKS, describe: "Peoples associated with it." },
            { name: "parents", ...LINKS, describe: "Affiliations it is subordinate to." },
            {
                name: "relations",
                ...ANY,
                describe: "Standing with other affiliations — aligned, unaligned, rival, nemesis.",
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
        subTypes: Object.freeze(["boon", "boost", "fate", "grace", "birthsign", "other", "piety"]),
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
        // `userguide`, not `user-guide`: a `doc` routes by its subType, so the
        // value is a path segment, and a segment carries no hyphen (#206). The
        // old spelling is accepted transitionally — see {@link RETIRED_SUBTYPES}
        // — but it is not declared here, because this list is what the format
        // says a note *should* write.
        subTypes: Object.freeze(["rules", "userguide", "reference"]),
        data: Object.freeze([]),
    }),

    macro: Object.freeze({ data: Object.freeze([]) }),

    homepage: Object.freeze({ data: Object.freeze([]) }),

    map: Object.freeze({
        // One type, three subTypes: they differ only in the canvas defaults
        // derived for them, which is precisely what a subType decides (#174).
        subTypes: Object.freeze(["battlemap", "localmap", "regionalmap"]),
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
                describe: "Map pins, each a grid location and an anchor in this note's own body.",
            },
            {
                name: "place",
                ...TEXT,
                describe:
                    "The place this map depicts. Named here and not on the place, " +
                    "because a place has several maps and a map depicts one place.",
            },
        ]),
    }),
});

/**
 * The retired spelling of a subType a type declares → what to write now (#206).
 *
 * Keyed by type, because a retirement is a statement about *that type's*
 * vocabulary: `user-guide` on a `doc` is the old spelling of `userguide`, while
 * the same string on any other type is nothing but a charset violation, and
 * saying "did you mean userguide" there would be a guess dressed as a fact.
 *
 * **Recorded here rather than left in `subTypes`** so the declared list stays
 * the list of values a note *should* write. A retired value is accepted, not
 * declared — the difference is exactly what makes the finding possible.
 *
 * **Deliberately not the shape of a type rename** ({@link
 * import("./ids.mjs").RETIRED_TYPES}), which is an error: a retired type routes
 * a note to the wrong pack, whereas a retired subType still compiles to the
 * correct page. The sweep is the consumer's, and the ordering is the reverse of
 * the usual — the acceptance ships *first*, because declaring only the new
 * spelling while 43 `sohl` notes still author the old one would invalidate all
 * 43 with a release they had no chance to sweep ahead of. A later change
 * removes this map, and the old spelling then falls through to the ordinary
 * undeclared-value error with no code left to remove.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const RETIRED_SUBTYPES = Object.freeze({
    doc: Object.freeze({ "user-guide": "userguide" }),
});

/**
 * What to write in place of a retired subType value, if it is one.
 *
 * @param {string} type - The note's `type`.
 * @param {string} value - The authored `subType`.
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} [retired]
 *   The map to read, defaulting to {@link RETIRED_SUBTYPES}.
 * @returns {string|undefined} The current spelling, or `undefined` when the
 *   value is not a retired one — which is not the same as it being valid.
 */
export function retiredSubType(type, value, retired = RETIRED_SUBTYPES) {
    const forType = retired?.[type];
    if (!forType || !Object.hasOwn(forType, value)) return undefined;
    return forType[value];
}

/**
 * What a note carrying a retired subType is told.
 *
 * One message, so the lint and any later refusal cannot describe the same
 * retirement differently.
 *
 * @param {string} type - The note's `type`.
 * @param {string} value - The retired spelling the note carries.
 * @param {string} replacement - What to write instead.
 * @returns {string} The message.
 */
export function retiredSubTypeMessage(type, value, replacement) {
    return (
        `\`subType\` "${value}" is a retired spelling of "${replacement}" on a ` +
        `${type}; write "${replacement}". A subType is an address segment, and ` +
        `a segment is ${ADDRESS_SEGMENT_PATTERN.source} — the hyphen separates ` +
        `segments, so it can never occur inside one. The old spelling is still ` +
        `accepted, and will stop being accepted once the trees have swept`
    );
}

/**
 * What a note carrying a subType outside the address charset is told.
 *
 * @param {string} value - The authored `subType`.
 * @returns {string} The message.
 */
export function subTypeCharsetMessage(value) {
    return (
        `\`subType\` "${value}" is not an address segment — a subType is ` +
        `letters and digits only (${ADDRESS_SEGMENT_PATTERN.source}), the same ` +
        `charset a shortcode is held to. The hyphen separates the segments of ` +
        `an address, so a value containing one is read back as two segments ` +
        `and resolves to nothing`
    );
}

/**
 * What a note carrying a type outside the address charset is told.
 *
 * @param {string} type - The authored `type`.
 * @returns {string} The message.
 */
export function typeCharsetMessage(type) {
    return (
        `content type "${type}" is not an address segment — a type is letters ` +
        `and digits only (${ADDRESS_SEGMENT_PATTERN.source}), the same charset ` +
        `a shortcode is held to. A type is the first segment of every address ` +
        `("type-shortcode"), so a hyphenated one is read back as two segments ` +
        `and resolves to nothing`
    );
}

/**
 * Refuse a vocabulary that declares a type or subType outside the charset.
 *
 * Run over {@link NOTE_VOCABULARY} as this module loads, so a declaration that
 * breaks the rule cannot be imported. That is stricter than a lint on purpose:
 * a note's bad value is one author's mistake and belongs in a report, while a
 * bad *declaration* would tell every author to write something unaddressable.
 *
 * @param {Readonly<Record<string, TypeVocabulary>>} vocabulary - The registry.
 * @param {string} [where] - What declares it, for the message.
 * @throws {Error} Naming every offending type and subType at once, rather than
 *   stopping at the first — a reader fixing a list wants the whole list.
 */
export function assertVocabularyCharset(vocabulary, where = "the note vocabulary") {
    const bad = [];
    for (const [type, entry] of Object.entries(vocabulary ?? {})) {
        if (!isAddressSegment(type)) bad.push(`type "${type}"`);
        const values = entry?.subTypes;
        if (!Array.isArray(values)) continue;
        for (const value of values) {
            if (!isAddressSegment(value)) bad.push(`subType "${value}" on ${type}`);
        }
    }
    if (!bad.length) return;
    throw new Error(
        `${where} declares ${bad.join(", ")}, which ${bad.length === 1 ? "is" : "are"} ` +
            `not ${ADDRESS_SEGMENT_PATTERN.source}. A type and a subType are both ` +
            `address segments, and the hyphen separates segments rather than ` +
            `occurring inside one.`,
    );
}

assertVocabularyCharset(NOTE_VOCABULARY);

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
