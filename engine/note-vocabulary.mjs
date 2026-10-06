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
 * The **closed vocabularies** of a note's frontmatter: the top-level keys, the
 * `data:` container, and the `subType` each note type declares.
 *
 * A note's frontmatter has three regions and every one of them is closed. The
 * **top level** describes the note as a published artefact and is a fixed list
 * — {@link NOTE_TOP_LEVEL_FIELDS} — so a key it does not name is a finding at
 * its own line rather than a value copied into the generated page. The
 * **system blocks** describe the subject as one system's documents, and are
 * checked against the published schema. Between them sits `data:` — the
 * type-specific facts about the subject itself, system-agnostic.
 *
 * Closed is the whole point, and the failure it answers is a misspelling. A
 * region that passes an unrecognised key through cannot tell `wieght` from a
 * weapon that weighs nothing: the note says one thing, the build does another,
 * and nothing says so. Under a closed vocabulary the same misspelling is an
 * error naming the note and the key it was probably meant to be.
 *
 * **`subType` is a top-level key with a per-type vocabulary**, which is why it
 * is declared twice over: once in {@link NOTE_TOP_LEVEL_FIELDS} as a key the
 * region accepts, and once per type below as the closed set of values that type
 * takes. It is not a `data:` key — a note's `(type, subType)` is what each
 * system's map reads to derive a document type, so it describes the note rather
 * than the subject — but its values are enumerated in the same `### type:`
 * section of the specification that enumerates the `data:` keys, and keeping
 * the two together means one entry per type rather than two registries free to
 * disagree about which types exist.
 *
 * **This is note-format knowledge, so it lives in `engine/`.** `data:` holds
 * what is true of the *thing* — a weapon's weight, an affliction's
 * transmission — and is true of it whichever system is reading. What each
 * system makes of that value is declared elsewhere, in that system's own half.
 *
 * **The type names here are the specification's**, which renamed `armor`,
 * `projectile` and `concoction` off the `…gear` spellings that named a SoHL
 * document subtype rather than the thing the note is about. `weapon` is the one
 * the specification and this registry still spell differently: both systems
 * call that document a `weapongear`, so the name says nothing system-specific
 * and the table has no row for it. A note left on a renamed spelling still
 * reaches its entry — every type-keyed lookup normalises through
 * `RENAMED_TYPES` — and is reported rather than refused until the content trees
 * have swept.
 *
 * **A type name and a subType value are held to the address charset**, so
 * both match `ADDRESS_SEGMENT_PATTERN` — the charset `engine/address-charset.mjs`
 * states and the shortcode is already held to. For a type that is literal: it is a
 * segment of every address — the first of the short form an author writes
 * (`type-shortcode`), the third of the canonical
 * `package-system-type-shortcode` — the hyphen is the separator between
 * segments and can therefore never occur inside one, and a hyphenated name
 * would be read back as two segments and resolve to nothing, reporting nothing
 * about why.
 *
 * A subType reaches no address of its own. It did when this rule was written —
 * a `doc`'s was its section, a path segment — and sections are retired from
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
// is how a disagreement between the three arises.
import { ART_SLOTS } from "./art-slots.mjs";
import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "./address-charset.mjs";
// The system registry, so the top-level block keys below are the systems this
// toolchain recognises rather than a second list of them.
import { SYSTEM_IDS } from "./systems.mjs";
// The retirement window for a renamed type, read rather than restated: a
// vocabulary that answered only to the current spelling would report every key
// of an unswept note as unknown.
import { currentType } from "./ids.mjs";
// What a place is next to and reachable from — the two relation lists and
// the checks that hold them to their closed sets and to each other.
import { checkBorders, checkRoutes } from "./place-relations.mjs";
import {
    CALENDAR_FIELDS,
    INVARIANT_FIELDS,
    checkCalendarNote,
    checkWorldFacts,
} from "./calendar-notes.mjs";
// Whether a being's authored `age` disagrees with what `born` and the
// package's declared present compute — the closed `data:` container's own
// question, asked the way `checkPlace` and `checkCalendarNote` are.
import { checkBeingAge } from "./being-age.mjs";
import { checkSocialTies } from "./social-ties.mjs";
import { checkStandings } from "./standings.mjs";
import { STANDING_BODY_TYPES } from "./standing-terms.mjs";
import { checkDatedOffices } from "./office-holders.mjs";
import { checkAffiliationRankFloor, checkRankLadder } from "./rank-ladder.mjs";
import { checkCalendarChoice } from "./calendar-choice.mjs";
import { checkLoreEvents } from "./lore-events.mjs";
import { checkCultureChoice } from "./culture-choice.mjs";
import { LITERATURE_FIELDS, checkLiteratureNote } from "./literature-notes.mjs";
import { SOCIAL_TIES, SOCIAL_TIE_TARGET_TYPES } from "./social-tie-terms.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { checkGovernment } from "./holdings.mjs";
import {
    checkBeingMeasurement,
    parseBeingHeight,
    parseBeingWeight,
} from "./being-measurements.mjs";
import { checkCitedPopulations, checkPopulation } from "./populations.mjs";
// What trade a settlement supports — the scale and the check that holds a
// value to it, read rather than restated, so the reference below and the
// finding an author meets state one list.
import { MARKET_CLASSES, checkMarket } from "./market-class.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * One `data:` key a note type may carry.
 *
 * A deliberate subset of {@link import("./field-spec.mjs").FieldSpec}: no `to`,
 * because nothing here builds anything yet. Reading `data.*` through into a
 * document's `system` block is the passthrough slice, and claiming an
 * emitted path this does not produce would be a lie in the one place a reader
 * would trust it.
 *
 * @typedef {object} DataFieldSpec
 * @property {string} name - The key under `data:`, dotted for a nested one
 *   (`charges.value`).
 * @property {"string"|"number"|"boolean"|"list"|"map"|"list-or-map"|"scalar-or-map"|"address"|"shortcode"} [kind] -
 *   The value's shape, for the lint. Absent means no claim is made about the
 *   value — which is the honest answer wherever the specification's stated
 *   shape and the shape notes are authored in today disagree.
 * @property {"address"|"shortcode"} [entryKind] - Type of each list or pack-map value.
 * @property {"address"|"shortcode"} [keyKind] - Type of each map key. On a
 *   `list-or-map` field it describes the map form alone, and `entryKind` the
 *   list form alone: reading both of one value would check a map's entries as
 *   if they were its keys.
 * @property {boolean} [standings] - The map's entries are standings held in the
 *   body each is keyed by, so a row names the two together — see
 *   {@link module:engine/standings}.
 * @property {boolean} [roster] - The map names posts, each with a description,
 *   so each takes a row labelled and anchored by the post's own name.
 * @property {"subType"} [keySelector] - An alternative `subType:<skill-subtype>` key.
 * @property {readonly string[]} [accepts] - Allowed Address types, separate from `ref`.
 * @property {string} [nullText] - Infobox text for an explicitly authored null with a declared meaning.
 * @property {string} [shape] - Human-readable shape, for a finding and for
 *   documentation.
 * @property {string} [entryShape] - For a `scalar-or-map` field, what one
 *   entry of the map is. A finding names the entry at fault rather than
 *   quoting the whole map back, so the string an author has to correct is the
 *   one the message holds.
 * @property {string} [ref] - The Address's default type, an art slot declares
 *   one — `icon` for `icon` and `tokenIcon`, `image` for `bgImage` and
 *   `banner` — so `icon: anvil` names `icon-anvil` while a value carrying the
 *   separator states its own address. Distinct from a `FieldSpec`'s `code`
 *   ({@link module:engine/field-spec}), which names a **Shortcode** instead.
 * @property {"pack"} [keys] - For a `scalar-or-map` field, what its keys name.
 *   `"pack"` means each is a pack this package declares, so a key naming none
 *   is a finding of its own: it addresses a hierarchy nothing will ever read.
 * @property {(note: object, opts: {index?: object}) => object[]} [check] - A
 *   check of the value beyond its shape, run by the frontmatter lint with the
 *   link index once the container has been checked. The lint stays
 *   vocabulary-agnostic this way: the rule lives beside the field that needs
 *   it, and the linter calls whatever it is handed. A place's `borders` and
 *   `routes` carry one, because what they state is checked against the note
 *   at the other end.
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
 * `stubbable` says whether an empty body suppresses this type's page. Every
 * type declares it, so adding one means answering the question rather than
 * inheriting a default nobody chose — and a guard derives the check from this
 * registry's own key list, so an omission is a red test.
 *
 * Two types answer **false**, and both are structural: a `folder` note's page
 * is a generated section index and a `homepage`'s is the site's front door, so
 * an empty body on one of them keeps its address and resolves as `full`.
 * This is classification only: author validation requires a body for every type.
 *
 * @typedef {object} TypeVocabulary
 * @property {readonly DataFieldSpec[]} data - The `data:` keys, closed.
 * @property {readonly string[]|null} [subTypes] - The top-level `subType`
 *   values, as above.
 * @property {boolean} stubbable - Whether an empty body makes a note of this
 *   type a stub — see {@link module:engine/note-state.isStubbableType}.
 * @property {(note: object, opts: {index?: object}) => object[]} [check] - A
 *   check of the whole note, run by the frontmatter lint beside the field
 *   checks with the same index. For a rule that is about the note rather than
 *   one of its fields, located at the note's `type:` line.
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

/**
 * One value, or several.
 *
 * The two are the same fact at different lengths rather than two different
 * facts, so a single value means a list of one and a consumer reads one shape.
 * That is what separates this from `list-or-map`, whose halves say different
 * things.
 */
const TEXT_OR_LIST = Object.freeze({ shape: "string or list", kind: "string-or-list" });

/** A single Address. */
const LINK = Object.freeze({ shape: "an Address", kind: "address" });

/** A list of Addresses. */
const LINKS = Object.freeze({ shape: "list of Addresses", kind: "list", entryKind: "address" });

/**
 * A being's memberships, and the standing it holds in each.
 *
 * A map keyed by the body's Address, whose entry is that membership's `rank`
 * and `office` — the pair a flat list of bodies cannot state, because it has
 * nowhere to say which body a standing is held in.
 *
 * **`list-or-map` is the sweep's shape**, and it says which half each
 * declaration describes: `entryKind` the list's entries, `keyKind` the map's
 * keys. A tree still writing the list form keeps the check it had, and the map
 * form earns the two the body can answer — see {@link module:engine/standings}.
 */
const STANDINGS = Object.freeze({
    shape: "a standing map keyed by Address, or a list of Addresses",
    kind: "list-or-map",
    entryKind: "address",
    keyKind: "address",
    standings: true,
    ref: "affiliation",
    accepts: STANDING_BODY_TYPES,
    check: checkStandings,
});

/**
 * A single Address, or one per pack.
 *
 * The map form is not a convenience spelling of the scalar: it says something
 * the scalar cannot, that the answer *differs by pack*. A folder's `parent` is
 * the case it exists for — a folder's identity is one thing and its hierarchy
 * another, and both large trees file the same folder under a different parent
 * in the items pack and the journals pack.
 *
 * Typing it as a bare {@link LINK} makes the compiler read both
 * forms and the lint rejected one of them, so every note using the form the
 * specification prescribes was a finding and no note using it was not.
 */
const LINK_BY_PACK = Object.freeze({
    shape: "an Address, or a map of Addresses keyed by pack",
    entryKind: "address",
    kind: "scalar-or-map",
    entryShape: "an Address",
    keys: "pack",
});

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
 * What a token on the canvas wears — an Actor type's second piece of art.
 *
 * Declared once and shared by the two Actor types, beside
 * {@link TEMPLATE_PRIORITY} and for the same reason. Unset it follows `icon`:
 * a token has to read at grid scale and when a map is zoomed out, so it is an
 * `icon` rather than an `image` and its fallback has to be `icon`-typed too.
 *
 * @type {DataFieldSpec}
 */
const TOKEN_ICON = Object.freeze({
    name: "tokenIcon",
    ...LINK,
    ref: "icon",
    accepts: ART_SLOTS.find((slot) => slot.key === "tokenIcon").accepts,
    describe: "What a token on the canvas wears — an `icon` address; unset, it follows `icon`.",
});

/**
 * One top-level frontmatter key.
 *
 * Narrower than a {@link DataFieldSpec}: the top level is a fixed list rather
 * than a per-type vocabulary, nothing there is keyed by pack or resolved as an
 * Address, and the value's shape is checked by whatever owns the region the key
 * opens — `name`, `tags` and each system block each have their own check.
 *
 * @typedef {object} TopLevelFieldSpec
 * @property {string} name - The key, as a note writes it.
 * @property {boolean} [system] - The key opens a game system's block, so it is
 *   one of {@link module:engine/systems.SYSTEM_IDS} rather than a fixed key.
 * @property {string} describe - One line, for the author-facing reference.
 */

/**
 * **The top-level vocabulary**, in the order a formatted note writes it.
 *
 * The region describes the note as a published artefact: what it is called,
 * what kind of thing it is about, how it is classified, and which of the other
 * two regions it opens. Everything else a note states is a fact about the
 * subject, which belongs under `data:`, or a fact about one system's document,
 * which belongs inside that system's block.
 *
 * **Closed, like the other two regions.** A key this list does not name is a
 * finding at its own line, because a region that passed one through would turn
 * a misspelling into a value nothing reads — `title` beside `name`, or `pack`
 * where `data.pack` was meant.
 *
 * **The system blocks are derived from the system registry**, so recognising a
 * further system is a change to {@link module:engine/systems.SYSTEM_IDS} and to
 * nothing else. They sort by name after the fixed keys: a block is the largest
 * thing a note writes, every one of them belongs at the end, and a rule a
 * reader can restate in one sentence is worth more than a hand-kept order.
 *
 * Five readers derive from this one list — the frontmatter lint's accepted set,
 * the message it prints, the formatter's key order, the content-format check,
 * and the author-facing reference — so none of them can fall behind the others.
 *
 * @type {readonly TopLevelFieldSpec[]}
 */
export const NOTE_TOP_LEVEL_FIELDS = Object.freeze([
    Object.freeze({
        name: "shortcode",
        describe: "The note's own address segment, unique within its type.",
    }),
    Object.freeze({
        name: "name",
        describe: "The display names — a required `full`, and any `aliases`.",
    }),
    Object.freeze({
        name: "type",
        describe: "What the note is about, which decides its vocabulary and its document.",
    }),
    Object.freeze({
        name: "subType",
        describe: "The type's own genre, where it declares one.",
    }),
    Object.freeze({
        name: "description",
        describe: "The short page summary.",
    }),
    Object.freeze({
        name: "tags",
        describe: "Draft state, GM routing, and the descriptive labels a page list reads.",
    }),
    Object.freeze({
        name: "data",
        describe: "The facts about the subject itself, shared by every system.",
    }),
    ...[...SYSTEM_IDS].sort().map((system) =>
        Object.freeze({
            name: system,
            system: true,
            describe:
                `What the \`${system}\` system makes of the subject — its ` +
                `document's mechanics, routing and art.`,
        }),
    ),
]);

/**
 * The top-level keys, in formatted order.
 *
 * @type {readonly string[]}
 */
export const NOTE_TOP_LEVEL_KEYS = Object.freeze(NOTE_TOP_LEVEL_FIELDS.map((field) => field.name));

/**
 * Membership test for the top-level vocabulary.
 *
 * @type {ReadonlySet<string>}
 */
export const NOTE_TOP_LEVEL_KEY_SET = Object.freeze(new Set(NOTE_TOP_LEVEL_KEYS));

/**
 * The `data:` keys **every** note type accepts, whatever it is.
 *
 * `data:` is a closed container and the per-type vocabularies are the only
 * lists there are, so a key legal on every type needs somewhere that is not one
 * type's list — including the types whose own vocabulary is empty. Repeating a
 * row in twenty-five tables would be twenty-five chances for one of them to
 * disagree with the rest.
 *
 * Both are art slots, and they are legal everywhere for different reasons.
 * `icon` is the document's profile art and most types compile into a document
 * that carries one; where a type's passes emit none, the frontmatter lint says
 * so as a warning rather than the vocabulary refusing the key, because the
 * value may still be read by a page template. `banner` reaches no compiled
 * document at all — it is the page's hero image — and a page is what every note
 * publishes.
 *
 * @type {readonly DataFieldSpec[]}
 */
export const SHARED_DATA_FIELDS = Object.freeze([
    Object.freeze({
        name: "id",
        ...TEXT,
        describe: "A fixed document identity when the derived identity is unsuitable.",
    }),
    Object.freeze({
        name: "pack",
        ...TEXT,
        describe: "The shared compendium route, with a system block overriding it.",
    }),
    Object.freeze({
        name: "packFolder",
        ...LINK_BY_PACK,
        ref: "folder",
        accepts: ["folder"],
        describe: "The shared compendium folder Address, with a system block overriding it.",
    }),
    Object.freeze({
        name: "harnworld",
        shape: "map",
        kind: "map",
        describe: "HârnWorld source details shared by every system.",
    }),
    Object.freeze({
        name: "icon",
        ...LINK,
        ref: "icon",
        accepts: ART_SLOTS.find((slot) => slot.key === "icon").accepts,
        describe: "The document's profile art — an `icon` address, resolved into `img`.",
    }),
    Object.freeze({
        name: "banner",
        ...LINK,
        ref: "image",
        accepts: ART_SLOTS.find((slot) => slot.key === "banner").accepts,
        describe:
            "The page's hero image — an `image` address, cut to 1792×768. " +
            "Reaches no compiled document.",
    }),
]);

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

/**
 * Everything `place` asks of a whole note.
 *
 * Two questions about one subject, and they are independent: who governs this
 * inhabited place, and — where the note is a body rather than somewhere within one — what
 * the body states about itself. A type declares one whole-note check, so the
 * two are composed here rather than either being folded into the other.
 *
 * @param {object} note - The note.
 * @param {object} [opts] - The lint's options, passed through unchanged.
 * @returns {object[]} Findings from both.
 */
function checkPlace(note, opts) {
    return [...checkGovernment(note), ...checkWorldFacts(note, opts)];
}

/** Validate a being's authored date using the shared note-date grammar. */
function checkBeingDate(key) {
    return (note, { index } = {}) =>
        parseNoteDate(note.fm?.data?.[key], {
            ...reckoningContext(index),
            field: `data.${key}`,
            file: note.file,
            raw: note.raw,
            keyPath: ["data", key],
        }).findings;
}

/** A place's purpose selects one of its own character tags. */
function checkPlacePurpose(note) {
    const value = note.fm?.data?.purpose;
    if (value === undefined || value === null) return [];
    const at = () => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", "purpose"]),
        severity: "error",
    });
    const subType = note.fm?.subType;
    if (!["settlement", "site", "structure"].includes(subType))
        return [
            {
                ...at(),
                message: `data.purpose applies to a settlement, site, or structure; this place is ${subType ?? "untyped"}`,
            },
        ];
    if (!DECLARED_TAGS.placeCharacter.tags.includes(value))
        return [
            {
                ...at(),
                message: `data.purpose ${JSON.stringify(value)} is not a placeCharacter tag; choose one of ${DECLARED_TAGS.placeCharacter.tags.join(", ")}`,
            },
        ];
    if (hasTag(note.fm, value)) return [];
    const tags = note.fm?.tags;
    return [
        {
            ...at(),
            message: `data.purpose ${JSON.stringify(value)} must select one of this place's tags; it carries ${JSON.stringify(tags ?? [])}`,
        },
    ];
}

/* --------------------------------------------------------------------- */
/*  The vocabulary                                                        */
/* --------------------------------------------------------------------- */

/**
 * The declared tag that marks a note as **unfinished**.
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

/** A note intended for the GM rather than the player-facing outputs. */
export const GM_TAG = "gm";

/**
 * The tags that **classify** a note, grouped by what they classify.
 *
 * `tags:` holds an open vocabulary of *values*, and most tags belong there: a
 * theme, a region, a working state is the author's own and this build has no
 * opinion about it. A classifying tag is different, because something queries
 * it — a
 * settlement tagged `village` appears in the list of villages and an untagged
 * one does not, so `vilage` does not merely look wrong, it removes the note from
 * an index while the index still renders a table that looks complete.
 *
 * **This list is not a closed set.** An unrecognised tag is legal, because the
 * values are the author's; what is reported is a **near miss** — a tag close
 * enough to a
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
 *
 * **A group carrying `exclusive` is a single-valued slot**, and that is the one
 * closure a tag vocabulary can make. Its tags are not several things the subject
 * may be at once — they are the alternative answers to one question, so a note
 * naming two of them has named none, and both together are refused as an error.
 * The property is opt-in and changes nothing for a group without it: a place is
 * freely a `port` and a `town`, and `draft` is orthogonal to everything. The
 * value is what the slot is called, for the message a reader gets.
 *
 * **Closure stops at the slot, and deliberately.** A tag outside an exclusive
 * group's list does not fill that group's slot and is not refused for failing
 * to — `tags:` is open and a being tagged `undead` is describing the subject in
 * the author's own words. What is refused is a near miss of a declared value,
 * and two values of one slot; there is no third refusal to make without taking
 * back the openness of the region these tags sit in.
 */
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
            "ford",
            "portage",
            "pass",
            "well",
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
    /** Who may read a completed note. */
    audience: Object.freeze({ types: null, tags: Object.freeze([GM_TAG]) }),
});

/**
 * The declared tags a note of this type may carry, flattened.
 *
 * @param {string} type - The note's type.
 * @param {object} [groups] - The grouped declaration.
 * @returns {readonly string[]} The tags, in declaration order.
 */
export function declaredTags(type, groups = DECLARED_TAGS) {
    return Object.freeze(applicableTagGroups(type, groups).flatMap((g) => g.tags));
}

/**
 * The declared groups scoped to this type, in declaration order.
 *
 * The one reading of `types` that the flattened list and the slot check share,
 * so the two can never disagree about which groups a `being` is held to.
 *
 * @param {string} type - The note's type.
 * @param {object} [groups] - The grouped declaration.
 * @returns {object[]} The groups that apply.
 */
export function applicableTagGroups(type, groups = DECLARED_TAGS) {
    return Object.values(groups).filter((g) => !g.types || g.types.includes(type));
}

/**
 * The single-valued slots a note of this type has, in declaration order.
 *
 * A group carrying `exclusive` states alternatives rather than attributes, so a
 * note carrying two of its tags has answered one question twice. Only such a
 * group is returned: the check has nothing to say about a group whose tags
 * genuinely accumulate.
 *
 * @param {string} type - The note's type.
 * @param {object} [groups] - The grouped declaration.
 * @returns {{slot: string, tags: readonly string[]}[]} The slots and their values.
 */
export function exclusiveTagGroups(type, groups = DECLARED_TAGS) {
    return applicableTagGroups(type, groups)
        .filter((g) => g.exclusive)
        .map((g) => ({ slot: g.exclusive, tags: g.tags }));
}

/**
 * Whether a note carries a given tag, however the author wrote it.
 *
 * `tags:` accepts common YAML forms: a single tag
 * may be a scalar rather than a list, a value may carry the leading `#` it is
 * written with in prose, and case and surrounding space are not significant.
 * The spelling of the tag *itself* still is — a near miss is a near miss, and
 * the frontmatter lint is what reports it; nothing here guesses.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} tag - The tag to look for, in its declared spelling.
 * @returns {boolean} Whether the note carries it.
 */
export function hasTag(fm, tag) {
    const raw = fm?.tags;
    if (raw == null) return false;
    const wanted = String(tag).toLowerCase();
    for (const entry of Array.isArray(raw) ? raw : [raw]) {
        if (typeof entry !== "string") continue;
        if (entry.trim().replace(/^#/, "").toLowerCase() === wanted) return true;
    }
    return false;
}

/**
 * Whether a note is tagged as an unfinished **draft**.
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

/** Whether a note is restricted to GM-facing output. */
export function isGmNote(fm) {
    return hasTag(fm, GM_TAG);
}

/** The case-sensitive archetypes and their author-facing meanings. */
export const BEING_ARCHETYPES = Object.freeze({
    warrior: "Can hold a line and win a fight.",
    skirmisher: "Fights light — ambush, missile, mobility.",
    infiltrator: "Gets in unseen — locks, stealth, disguise.",
    mage: "Commands arcane practice.",
    cleric: "Commands religious practice and standing.",
    healer: "Treats wounds and illness.",
    scholar: "Reads, researches, and knows things.",
    courtier: "Navigates rank, negotiation, and intrigue.",
    woodsman: "Travels and survives wild country.",
    mariner: "Handles boats and blue water.",
    artisan: "Builds, repairs, and appraises craft work.",
    trader: "Moves goods, values them, and knows markets.",
    commoner: "Fits no more specific archetype; handles ordinary work and daily life.",
    entertainer: "Performs for an audience through acting, music, comedy, or similar arts.",
    guildsperson: "Has professional training, standing, or connections that open doors.",
});

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
        stubbable: true,
        subTypes: Object.freeze(["npc", "character", "creature"]),
        // Whether an authored `age` disagrees with what `born` and the
        // package's declared present compute — see `engine/being-age.mjs`.
        check: checkBeingAge,
        data: Object.freeze([
            { name: "social", shape: "map", kind: "map", describe: "The being's social profile." },
            TOKEN_ICON,
            TEMPLATE_PRIORITY,
            { name: "archetypes", ...LIST, describe: "Archetypal behaviours the being fits." },
            { name: "occupation", ...TEXT, describe: "What the being does for a living." },
            {
                name: "stations",
                ...LINKS,
                ref: "lore",
                accepts: ["lore"],
                describe: "Stations the being holds.",
            },
            {
                name: "lore",
                ...LINKS,
                ref: "lore",
                accepts: ["lore"],
                describe:
                    "Lore concerning this being — the law it lives under, the customs it is " +
                    "subject to, the traditions it was raised in.",
            },
            {
                name: "culture",
                ...LINK,
                ref: "lore",
                accepts: ["lore"],
                check: checkCultureChoice,
                describe: "The being's primary culture, as a culture lore note.",
            },
            {
                name: "homes",
                ...LINKS,
                ref: "place",
                accepts: ["place"],
                describe: "Places the being calls home.",
            },
            {
                name: "affiliations",
                ...STANDINGS,
                describe:
                    "Bodies the being belongs to, keyed by Address, each entry holding the " +
                    "standing it holds there — `rank`, required, a level on that body's own " +
                    "ladder, and `office`, optional, a post that body names.",
            },
            {
                name: "socialTies",
                kind: "map",
                keyKind: "address",
                accepts: SOCIAL_TIE_TARGET_TYPES,
                terms: SOCIAL_TIES,
                shape: "a map keyed by Address",
                check: checkSocialTies,
                describe: `Defining ties directed from this being to others: ${SOCIAL_TIES.map(({ term, meaning }) => `\`${term}\` (${meaning})`).join("; ")}`,
            },
            {
                name: "gender",
                ...TEXT,
                describe:
                    "One of `male`, `female`, `nonbinary`, `none` or `other`. " +
                    "`none` says the being has no gender; an absent field says its " +
                    "gender is unrecorded.",
            },
            {
                name: "species",
                ...LINK,
                ref: "lore",
                accepts: ["lore"],
                describe: "The being's species, as a lore note.",
            },
            {
                name: "born",
                ...TEXT,
                check: checkBeingDate("born"),
                describe:
                    "When the being was born — a date, or `unknown` where the birth is " +
                    "unrecorded. Absent, the being was never born.",
            },
            {
                name: "calendar",
                ...LINK,
                ref: "lore",
                accepts: ["lore"],
                check: checkCalendarChoice,
                describe: "Calendar used to display this being's dates.",
            },
            {
                name: "died",
                ...TEXT,
                check: checkBeingDate("died"),
                describe:
                    "When the being died — a date, or `unknown` where the death is " +
                    "unrecorded. Absent, the being is alive.",
            },
            // Ahead of `height` and behind the dates, because it opens the
            // appearance clause: a composed row stands where its group's first
            // field is declared, so the two dates read before the clause
            // whether or not a note states an age.
            {
                name: "age",
                ...TEXT,
                describe:
                    "Age in years, stated only to override what `born` says — `34`, or `~34` " +
                    "for an estimate. Unstated beside a dated `born` it is computed; unstated " +
                    "beside an unknown or absent `born` the age is unknown.",
            },
            {
                name: "ageYears",
                ...NUM,
                describe:
                    "Written by the compiler beside an `age` estimate — the `~` stripped, " +
                    "the magnitude alone. A note never authors this.",
            },
            {
                name: "height",
                shape: "metres or feet and inches",
                kind: "string",
                check: (note) => checkBeingMeasurement(note, "height", parseBeingHeight),
                describe: "Height in metres or feet and inches.",
            },
            {
                name: "weight",
                shape: "kilograms or pounds",
                kind: "string",
                check: (note) => checkBeingMeasurement(note, "weight", parseBeingWeight),
                describe: "Body weight in kilograms or pounds.",
            },
            {
                name: "frame",
                ...TEXT,
                describe:
                    "Relative frame — one of `scant`, `light`, `medium`, `heavy` or `massive`.",
            },
            { name: "appearance.eye_color", ...TEXT, describe: "Eye colour." },
            { name: "appearance.hair_color", ...TEXT, describe: "Hair colour." },
            { name: "appearance.skin_color", ...TEXT, describe: "Skin colour." },
            {
                name: "appearance.complexion",
                ...TEXT_OR_LIST,
                describe:
                    "The skin's condition — one value, or several, because a face " +
                    "carries more than one at once. A single value means a list of one.",
            },
            {
                name: "appearance.extra_features",
                ...LIST,
                describe: "Anything else a stranger would notice.",
            },
        ]),
    }),

    vehicle: Object.freeze({
        stubbable: true,
        subTypes: null,
        data: Object.freeze([TOKEN_ICON, TEMPLATE_PRIORITY]),
    }),

    /* ----- items ---------------------------------------------------- */

    affiliation: Object.freeze({
        stubbable: true,
        check: checkAffiliationRankFloor,
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
                name: "epithet",
                ...TEXT,
                describe: "The by-name it is known by — a god's, an order's, a company's.",
            },
            {
                name: "symbol",
                ...TEXT,
                describe:
                    "Its emblem in words: a feather atop a golden scale, a chisel carving " +
                    "a star.",
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
                // A rung is `{level, title, description}` with an optional
                // `lore`. The shape check sees a list and stops there, so the
                // rungs inside it are checked here — a ladder is what a being's
                // `rank` indexes into, and an incomplete rung resolves to a
                // standing with no name.
                check: checkRankLadder,
                // Each rung takes a row of its own, labelled and anchored by
                // its title, ordered by level — the ladder's parallel to
                // `governance.offices`' `roster`.
                ranks: true,
                describe: "The ladder of ranks the body confers — level, title, description.",
            },
            {
                name: "governance.offices",
                ...ANY,
                // A map of named posts: each takes a row of its own, labelled
                // by the post and anchored by it, so the description a body
                // declares is a destination a being's `office` can link to.
                roster: true,
                check: checkDatedOffices,
                describe: "Named offices, each with a description and optional dated holders.",
            },
            {
                name: "seat",
                ...LINK,
                ref: "place",
                accepts: ["place"],
                describe: "Where the affiliation's authority sits.",
            },
            { name: "population", ...NUM, describe: "How many people it counts." },
            {
                name: "economy",
                ...LINKS,
                accepts: ["affiliation", "lore"],
                describe: "What its economic life runs on — currencies, banking bodies, goods.",
            },
            {
                name: "lore",
                ...LINKS,
                ref: "lore",
                accepts: ["lore"],
                describe:
                    "Lore concerning it — the peoples it draws on, the god a faith " +
                    "venerates, its law, its calendar.",
            },
            {
                name: "parents",
                ...LINKS,
                ref: "affiliation",
                accepts: ["affiliation"],
                describe: "Affiliations it is subordinate to.",
            },
            {
                name: "relations",
                kind: "map",
                keyKind: "address",
                ref: "affiliation",
                accepts: ["affiliation"],
                shape: "a map keyed by Address",
                describe: "Standing with other affiliations — aligned, unaligned, rival, nemesis.",
            },
        ]),
    }),

    affliction: Object.freeze({
        stubbable: true,
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
                name: "onsetDurationBase",
                ...NUM,
                describe: "That delay in seconds, stated outright instead of rolled.",
            },
            {
                name: "healingCheckDurationFormula",
                ...TEXT,
                describe: "Roll formula for the interval between healing checks.",
            },
            {
                name: "healingCheckDurationBase",
                ...NUM,
                describe: "That interval in seconds, stated outright instead of rolled.",
            },
            {
                name: "resolutionDurationFormula",
                ...TEXT,
                describe: "Roll formula for the time from onset to resolution.",
            },
            {
                name: "resolutionDurationBase",
                ...NUM,
                describe: "That time in seconds, stated outright instead of rolled.",
            },
        ]),
    }),

    armorgear: Object.freeze({
        stubbable: true,
        // Quantity is always one, so the specification refuses the key rather
        // than defaulting it.
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR]),
    }),

    armorlocation: Object.freeze({
        stubbable: true,
        subTypes: null,
        data: Object.freeze([TEMPLATE_PRIORITY]),
    }),

    attribute: Object.freeze({
        stubbable: true,
        data: Object.freeze([TEMPLATE_PRIORITY]),
    }),

    concoctiongear: Object.freeze({
        stubbable: true,
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
        stubbable: true,
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            ...GEAR,
            { name: "capacity", ...NUM, describe: "How much it holds." },
        ]),
    }),

    miscgear: Object.freeze({
        stubbable: true,
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR, QUANTITY]),
    }),

    mystery: Object.freeze({
        stubbable: true,
        subTypes: Object.freeze(["boon", "boost", "fate", "grace", "birthsign", "other", "piety"]),
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            {
                name: "assocSkill",
                ...LINK,
                ref: "skill",
                accepts: ["skill"],
                describe: "The skill it is associated with.",
            },
            {
                name: "assocAffiliation",
                ...LINK,
                ref: "affiliation",
                accepts: ["affiliation"],
                describe: "The affiliation it is associated with.",
            },
            {
                name: "skillAptitudes",
                kind: "map",
                keyKind: "shortcode",
                keySelector: "subType",
                shape: "a map keyed by Shortcode or subType selector",
                describe:
                    "Bonuses and penalties, each naming a skill or a `subType:<skill-subtype>`.",
            },
            { name: "level", ...NUM, describe: "The magnitude of the mystery." },
            ...CHARGES,
        ]),
    }),

    mysticalability: Object.freeze({
        stubbable: true,
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
            {
                name: "assocSkill",
                ...LINK,
                ref: "skill",
                accepts: ["skill"],
                describe: "The skill it is associated with.",
            },
            {
                name: "assocAffiliation",
                ...LINK,
                ref: "affiliation",
                accepts: ["affiliation"],
                describe: "The affiliation it is associated with.",
            },
            { name: "masteryLevel", ...NUM, describe: "Mastery before any modifier." },
            { name: "level", ...NUM, describe: "The magnitude of the ability." },
            ...CHARGES,
        ]),
    }),

    projectilegear: Object.freeze({
        stubbable: true,
        subTypes: Object.freeze(["none", "arrow", "bolt", "bullet", "dart", "other"]),
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR, QUANTITY]),
    }),

    skill: Object.freeze({
        stubbable: true,
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
            {
                name: "parentSkill",
                ...LINK,
                ref: "skill",
                accepts: ["skill"],
                describe: "The skill this one specialises.",
            },
        ]),
    }),

    trauma: Object.freeze({
        stubbable: true,
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
        data: Object.freeze([
            TEMPLATE_PRIORITY,
            {
                name: "healingCheckDurationFormula",
                ...TEXT,
                describe: "Roll formula for the interval between healing checks.",
            },
            {
                name: "healingCheckDurationBase",
                ...NUM,
                describe: "That interval in seconds, stated outright instead of rolled.",
            },
            {
                name: "bloodLossAdvanceDurationFormula",
                ...TEXT,
                describe: "Roll formula for the interval between blood-loss advances.",
            },
            {
                name: "bloodLossAdvanceDurationBase",
                ...NUM,
                describe: "That interval in seconds. Setting it is what makes the wound bleed.",
            },
            {
                name: "courseDurationFormula",
                ...TEXT,
                describe: "Roll formula for the interval between course tests.",
            },
            {
                name: "courseDurationBase",
                ...NUM,
                describe: "That interval in seconds, stated outright instead of rolled.",
            },
        ]),
    }),

    weapongear: Object.freeze({
        stubbable: true,
        // No `subTypes`, deliberately: SoHL distinguishes a weapon's uses with
        // strike modes rather than by kind, and HM3's document type follows
        // from which of those a note describes.
        data: Object.freeze([TEMPLATE_PRIORITY, ...GEAR]),
    }),

    /* ----- core documents ------------------------------------------- */

    doc: Object.freeze({
        stubbable: true,
        // A genre is all this field carries: what kind of page
        // it is, never who reads it. An audience term alongside them would give
        // a developer how-to two valid values and no rule for choosing.
        //
        // `userguide` and `howto`, not `user-guide` and `how-to`: a subType is
        // held to the address charset, and a segment carries no hyphen.
        subTypes: Object.freeze([
            "rules",
            "userguide",
            "reference",
            "howto",
            "concept",
            "settingguide",
        ]),
        check: checkCitedPopulations,
        data: Object.freeze([]),
    }),

    macro: Object.freeze({ stubbable: true, data: Object.freeze([]) }),

    // Foundry's `Folder`, and the last document this package compiled from
    // bespoke configuration rather than from a note. It declares no
    // system-block fields, like a bundle: a `Folder` is a core Foundry
    // document, so its address carries the `none` system segment and
    // everything it says is a `data` property.
    //
    // Its required body produces no documentation journal and takes
    // no part in `docEntryTypes`.
    folder: Object.freeze({
        stubbable: false,
        data: Object.freeze([
            {
                name: "parent",
                ...LINK_BY_PACK,
                ref: "folder",
                accepts: ["folder"],
                describe:
                    "The folder this one sits in, as an address — or one " +
                    "address per pack, keyed by pack name with `default` for " +
                    "the rest. Unset at the root. A dead address is a " +
                    "dead-address finding and a cycle is refused, per pack.",
            },
            {
                name: "color",
                ...TEXT,
                describe: "The folder's colour, as a CSS hex code. Unset for Foundry's default.",
            },
        ]),
    }),

    // Foundry's `Adventure`, named for what it is rather than what Foundry
    // calls it: a set of documents taken as a unit. The document is an
    // installer — it carries copies, and importing one creates or updates each
    // document in the world — which is what separates a bundle from a folder,
    // a live grouping that persists in the pack.
    //
    // How many Adventures a bundle makes is decided by its system blocks, as
    // for every other type, and not by a property: an `Adventure` has no
    // `system` field, so a bundle spanning two systems is two documents, and
    // the pack each is written to is what carries the system.
    bundle: Object.freeze({
        stubbable: true,
        data: Object.freeze([
            {
                name: "contents",
                ...LINKS,
                describe:
                    "The documents the Adventure holds, as addresses. Empty " +
                    "when unstated. A document of neither `none` nor the " +
                    "system being compiled is left out rather than failing.",
            },
        ]),
    }),

    lore: Object.freeze({
        stubbable: true,
        subTypes: Object.freeze([
            "cosmology", // The structure and origin of reality.
            "deity", // An individual god and its attributed nature.
            "theology", // Beliefs about divinity, worship, and the afterlife.
            "arcana", // Beliefs and traditions concerning magic.
            "spirit", // Non-divine supernatural beings and their natures.
            "economy", // Trade, money, and the movement of wealth.
            "law", // Obligations, rights, courts, and tenure.
            "calendar", // The reckoning and marking of time.
            "history", // Events, eras, and chronicles of the past.
            "material", // Physical constituents and their qualities, including regional varieties.
            "folk", // A kindred or ancestry of related sapient beings.
            "culture", // A people sharing beliefs, mores, and values.
            "custom", // How a people practices a rite, observance, or usage.
            "bestiary", // A kind of creature that is not a people.
            "gathering", // A recurring public assembly, such as a fair or tournament.
            "literature", // A work a people tells, sings, or writes, such as an epic or legend.
        ]),
        // A lore note is prose, and what it *is* about is its subType — with
        // two exceptions. A calendar is a division of the year, and a division
        // is data; a work of literature states whose it is, in what tongue and
        // about what. The checks scope each family to the subType that means
        // it, because `DataFieldSpec` declares the keys a type accepts and not
        // the subType that may write them.
        check: (note, context) => [
            ...checkCalendarNote(note, context),
            ...checkLiteratureNote(note),
        ],
        data: Object.freeze([
            ...CALENDAR_FIELDS,
            ...LITERATURE_FIELDS,
            {
                name: "events",
                kind: "list",
                shape: "list of `{ when, until?, recurs? }`",
                check: checkLoreEvents,
                describe:
                    "This note's dated occurrences — a founding once, an anniversary " +
                    "that recurs, or a list of recorded happenings.",
            },
        ]),
    }),

    place: Object.freeze({
        stubbable: true,
        subTypes: Object.freeze([
            "world",
            "region",
            "settlement",
            "site",
            "structure",
            "feature",
            "celestial",
        ]),
        check: checkPlace,
        data: Object.freeze([
            {
                name: "calendar",
                ...LINK,
                ref: "lore",
                accepts: ["lore"],
                check: checkCalendarChoice,
                describe: "Calendar used to display this place's dates.",
            },
            {
                name: "demonym",
                ...TEXT,
                describe: "What a person from this place is called — a Vylarian.",
            },
            {
                name: "purpose",
                ...TEXT,
                check: checkPlacePurpose,
                describe:
                    "The reason this settlement, site, or structure exists, selected from its placeCharacter tags.",
            },
            {
                name: "lore",
                ...LINKS,
                ref: "lore",
                accepts: ["lore"],
                describe:
                    "Lore concerning this place — its peoples, its law, its calendar, " +
                    "its history.",
            },
            {
                name: "parents",
                ...LINKS,
                ref: "place",
                accepts: ["place"],
                describe: "Enclosing places this one sits within.",
            },
            {
                name: "population",
                ...NUM,
                check: checkPopulation,
                describe: "Approximate population, to two significant digits.",
            },
            {
                name: "government",
                ...LINK,
                shape: "an Address or null",
                ref: "affiliation",
                accepts: ["affiliation"],
                nullText: "Complete anarchy",
                describe:
                    "The governing affiliation Address; the default target type is affiliation. " +
                    "Explicit null means complete anarchy. " +
                    "A positive population with no government key produces an advisory.",
            },
            {
                name: "market",
                ...NUM,
                check: checkMarket,
                describe:
                    "What trade the settlement supports, on a scale of six: " +
                    `${MARKET_CLASSES.map((c) => `${c.value} ${c.name}`).join(", ")}.`,
            },
            {
                name: "borders",
                ...LIST,
                shape: "list of `{ to, bearing }` entries",
                check: checkBorders,
                describe:
                    "Places sharing a frontier with this one — each the other's shortcode " +
                    "and where it lies from here.",
            },
            {
                name: "routes",
                ...LIST,
                shape: "list of `{ to, bearing, mode, days, terrain?, leagues? }` entries",
                check: checkRoutes,
                describe:
                    "Journeys from this place's centre — where the destination lies, how " +
                    "it is travelled, and about how many days it takes.",
            },
            // What a body states about itself: its size, its year, its moon.
            // Legal on a `world` or a `celestial` and nowhere else, which the
            // type's own check is what enforces.
            ...INVARIANT_FIELDS,
        ]),
    }),

    scenario: Object.freeze({
        stubbable: true,
        subTypes: Object.freeze(["campaign", "adventure", "encounter"]),
        data: Object.freeze([
            {
                name: "parents",
                ...LINKS,
                ref: "scenario",
                accepts: ["scenario"],
                describe: "Scenarios this one sits within.",
            },
            {
                name: "locations",
                ...LINKS,
                ref: "place",
                accepts: ["place"],
                describe: "Places the scenario takes place in.",
            },
            {
                name: "cast",
                ...LINKS,
                ref: "being",
                accepts: ["being"],
                describe: "Beings who appear in it.",
            },
            {
                name: "factions",
                ...LINKS,
                ref: "affiliation",
                accepts: ["affiliation"],
                describe: "Affiliations with a stake in it.",
            },
            {
                name: "follows",
                ...LINKS,
                ref: "scenario",
                accepts: ["scenario"],
                describe: "Scenarios that should be played before this one.",
            },
            {
                name: "status",
                ...TEXT,
                describe: "`draft`, `playtested` or `published`.",
            },
            {
                name: "party.size",
                ...TEXT,
                describe: "`solo`, `small`, `standard`, `large` or `host`.",
            },
            {
                name: "party.archetypes",
                ...LIST,
                describe: "Archetypes the scenario is written for.",
            },
        ]),
    }),

    homepage: Object.freeze({ stubbable: false, data: Object.freeze([]) }),

    map: Object.freeze({
        stubbable: true,
        // The subType classifies the map; `data.scene` carries its canvas.
        subTypes: Object.freeze(["battlemap", "localmap", "regionalmap", "totm"]),
        data: Object.freeze([
            {
                name: "scene",
                ...ANY,
                describe: "A Foundry Scene export with all its authored fields.",
            },
            {
                name: "fixup",
                ...LIST,
                describe: "Asset address replacements in an exported Scene.",
            },
            // A Scene has no `img`, so the shared art key reaches nothing here:
            // a map's background is its own slot, and an `image` address.
            {
                name: "bgImage",
                ...LINK,
                ref: "image",
                accepts: ART_SLOTS.find((slot) => slot.key === "bgImage").accepts,
                describe: "The map's background art — an `image` address.",
            },
            {
                name: "scale",
                ...ANY,
                describe: "Regional map distance per grid unit: {distance, unit}.",
            },
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
                ...LINK,
                ref: "place",
                accepts: ["place"],
                describe:
                    "The place this map depicts. Named here and not on the place, " +
                    "because a place has several maps and a map depicts one place.",
            },
        ]),
    }),
});

/**
 * What a note carrying a subType outside the address charset is told.
 *
 * **Why the charset holds for a subType, which reaches no address.** The rule
 * said
 * "the hyphen separates the segments of an address", and that was true of a
 * subType when it shipped: `sectionOf` returned a `doc`'s subType, so the value
 * was a URL path segment. Sections are retired and it is not one. The rule
 * stays, on its own footing: a subType is a vocabulary term the whole toolchain
 * keys on, and it is one closed set away from being an address segment again —
 * so the reason to spell it in the address charset is that a charset holding
 * for a type, a shortcode and a `contentPackage` but not for a subType is a
 * rule nobody can state in a sentence.
 *
 * Contrast {@link typeCharsetMessage}, which keeps the address reasoning
 * because a type genuinely is the first segment of every address.
 *
 * @param {string} value - The authored `subType`.
 * @returns {string} The message.
 */
export function subTypeCharsetMessage(value) {
    return (
        `\`subType\` "${value}" is not a well-formed subType — a subType is ` +
        `letters and digits only (${ADDRESS_SEGMENT_PATTERN.source}), the same ` +
        `charset a type, a shortcode and a contentPackage are held to. It is a ` +
        `vocabulary term the whole toolchain keys on, and one closed set away ` +
        `from being an address segment again, so a charset that held for every ` +
        `term but this one would be a rule nobody could state in a sentence`
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
        `a shortcode is held to. A type is a segment of every address, and the ` +
        `first of the short form an author writes ("type-shortcode"), so a ` +
        `hyphenated one is read back as two segments and resolves to nothing`
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
 * The message states the reason **per key**, as {@link typeCharsetMessage} and
 * {@link subTypeCharsetMessage} do: a type is an address segment, and a subType
 * is not one, since sections are retired, so a single claim covering both
 * would be half wrong.
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
            `not ${ADDRESS_SEGMENT_PATTERN.source}. A type is an address segment, ` +
            `and the hyphen separates segments rather than occurring inside one. ` +
            `A subType reaches no address, and is ` +
            `held to the same charset anyway: it is a vocabulary term the whole ` +
            `toolchain keys on, one closed set away from being a segment again, ` +
            `and a charset holding for every term but that one would be a rule ` +
            `nobody could state in a sentence.`,
    );
}

assertVocabularyCharset(NOTE_VOCABULARY);

/**
 * The `data:` keys a note type may carry.
 *
 * @param {string} type - The note's `type`.
 * @param {Readonly<Record<string, TypeVocabulary>>} [vocabulary] - The registry
 *   to read, defaulting to {@link NOTE_VOCABULARY}.
 * {@link SHARED_DATA_FIELDS} come first, because they are part of every type's
 * declaration and a caller asking what a type accepts must be told all of it.
 *
 * @returns {readonly DataFieldSpec[]|undefined} The declaration, or `undefined`
 *   when the type declares none — which is not the same as declaring an empty
 *   one, and is why the lint makes no claim rather than refusing every key.
 */
export function dataFields(type, vocabulary = NOTE_VOCABULARY) {
    const entry = vocabulary?.[currentType(type)];
    if (!entry) return undefined;
    // The shared keys first, so a type's own declarations keep their authored
    // order behind them and a reader meets the art before the mechanics.
    return Object.freeze([...SHARED_DATA_FIELDS, ...(entry.data ?? [])]);
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
    const entry = vocabulary?.[currentType(type)];
    if (!entry || !Object.hasOwn(entry, "subTypes")) return undefined;
    return entry.subTypes;
}

/**
 * Accepted migration input with no canonical field or emitted value.
 *
 * Legacy affiliation domains are ignored. They never supply a government.
 * @param {string} type - The note type.
 * @param {string} key - An authored data key.
 * @returns {boolean} Whether the obsolete key is accepted during migration.
 */
export function isLegacyDataField(type, key) {
    return currentType(type) === "affiliation" && key === "domains";
}
