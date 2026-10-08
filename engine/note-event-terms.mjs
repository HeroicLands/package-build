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
 * The **terms of an event**: the closed value lists an event entry draws on,
 * and the declaration of every key an entry and each map inside it take.
 *
 * A leaf module, importing nothing. The note vocabulary reads
 * {@link EVENT_ENTRY} as it loads, so the frontmatter lint's inner-key check
 * closes every key of an entry the way it closes every other `data:` field's;
 * {@link module:engine/note-events} walks the same declaration for what the
 * values mean — closed lists, Addresses, identity and order — and reaches the
 * vocabulary through the Address reader.
 *
 * An entry is declared in the inner-key vocabulary of
 * {@link module:engine/data-keys} — `fields`, `entries`, `kind`, `shape`,
 * `required`, `describe` — with four properties of its own that the event
 * check reads:
 *
 * - `oneOf` — `{name, values}`: the value is one of `values`, a closed list the
 *   format reference states as the vocabulary table `name`;
 * - `ref`, `accepts`, `anchors`, `single`, `eventOrLore`, `calendar` on an
 *   Address: its default type, its accepted types, the anchor kinds it may
 *   name, and whether it must name exactly one event, an event or a `lore`
 *   note, or a calendar note;
 * - `own` — the key's value is judged by the event check's own code (`id`,
 *   `when`, `until`, `recurs`) rather than by the walker.
 *
 * @module
 */

/** What an event is, grouped for reading and closed for validation. */
export const EVENT_KINDS = Object.freeze([
    // peoples
    "arrival",
    "departure",
    "migration",
    "contact",
    "displacement",
    // polities
    "founding",
    "charter",
    "accession",
    "secession",
    "conquest",
    "treaty",
    "dissolution",
    // conflict
    "battle",
    "war",
    "siege",
    "revolt",
    // ruin
    "fall",
    "catastrophe",
    "plague",
    "famine",
    // works
    "raising",
    "ruin",
    "making",
    "loss",
    "discovery",
    // institutions and belief
    "schism",
    "law",
    "council",
    // persons
    "birth",
    "death",
]);

/** How far an event's history reaches. Set by hand. */
export const EVENT_DEPTHS = Object.freeze(["world", "region", "local"]);

/** What the world's evidence supports about an event. */
export const EVENT_STANDINGS = Object.freeze([
    "attested",
    "single-source",
    "reconstructed",
    "disputed",
    "legendary",
]);

/** Whether a place that felt an event knows what caused it. */
export const REACH_KNOWLEDGE = Object.freeze(["named", "misattributed", "unlinked"]);

/** What a participant was to an event. */
export const PARTICIPANT_ROLES = Object.freeze([
    "actor",
    "victim",
    "instrument",
    "witness",
    "founder",
    "ruler",
    "author",
    "signatory",
]);

/** How a later event follows from an earlier one. */
export const FOLLOWS_HOW = Object.freeze(["caused", "enabled", "ended", "answered"]);

/** How far an account agrees with the event's summary. */
export const ACCOUNT_AGREES = Object.freeze(["full", "partly", "disputes", "denies", "silent"]);

/**
 * Every closed list, by the name of the vocabulary table the format reference
 * and `engine/content-format.yaml` state it under. `eventKind` is not `kind`
 * because the infobox's row kinds already hold that name.
 */
export const EVENT_VOCABULARIES = Object.freeze({
    eventKind: EVENT_KINDS,
    depth: EVENT_DEPTHS,
    standing: EVENT_STANDINGS,
    knowledge: REACH_KNOWLEDGE,
    role: PARTICIPANT_ROLES,
    followsHow: FOLLOWS_HOW,
    agrees: ACCOUNT_AGREES,
});

/** A key holding text, stated with something in it. */
const text = (name, describe, required = false) =>
    Object.freeze({ name, kind: "string", shape: "a string", required, describe });

/** A key holding one value of a closed list. */
const oneOf = (name, vocabulary, describe, required = false) =>
    Object.freeze({
        name,
        kind: "string",
        shape: `one \`${vocabulary}\` value`,
        oneOf: Object.freeze({ name: vocabulary, values: EVENT_VOCABULARIES[vocabulary] }),
        required,
        describe,
    });

/** A key holding one Address, with what it may name. */
const address = (name, shape, describe, extra = {}, required = false) =>
    Object.freeze({ name, kind: "address", shape, required, describe, ...extra });

/** A key holding a list of maps, each closed to `fields`. */
const listOf = (name, shape, describe, fields) =>
    Object.freeze({
        name,
        kind: "list",
        shape,
        entries: Object.freeze({
            kind: "map",
            shape: `a map — ${shape.replace(/\[\]$/, "")}`,
            fields,
        }),
        describe,
    });

/** An Address naming a place; a bare shortcode is read as one. */
const PLACE = Object.freeze({ ref: "place", accepts: Object.freeze(["place"]) });

/**
 * One event entry, as an inner-key declaration: every key it takes, and every
 * key of each map nested in it.
 *
 * @type {Readonly<{kind: "map", shape: string, fields: readonly object[]}>}
 */
export const EVENT_ENTRY = Object.freeze({
    kind: "map",
    shape: "an event — a map of the keys below",
    fields: Object.freeze([
        Object.freeze({
            name: "id",
            kind: "shortcode",
            shape: "an address segment",
            own: true,
            describe: "The event's name within its note — lowercase letters and digits.",
        }),
        oneOf("kind", "eventKind", "What sort of thing happened."),
        oneOf("depth", "depth", "How far the event's history reaches."),
        Object.freeze({
            name: "when",
            kind: "date",
            shape: 'a date, or `"0.<day>"`',
            required: true,
            own: true,
            describe: "When it happened, or the anchor and first instance of an event that recurs.",
        }),
        Object.freeze({
            name: "until",
            kind: "date",
            shape: "a date",
            own: true,
            describe: "When a continuous event ended, or where a recurring series stopped.",
        }),
        Object.freeze({
            name: "recurs",
            kind: "map",
            shape: "`{ every }` or `{ on }`",
            own: true,
            fields: Object.freeze([
                Object.freeze({
                    name: "every",
                    kind: "integer",
                    shape: "a whole number of years, 1 or more",
                    describe: "A period counted on the canonical axis from `when`.",
                }),
                Object.freeze({
                    name: "on",
                    kind: "list",
                    shape: "a list of dates, strictly increasing, each later than `when`",
                    entries: Object.freeze({ kind: "date", shape: "a date" }),
                    describe: "Recorded occurrences beyond the first, in place of a period.",
                }),
            ]),
            describe: "How further occurrences are found; absent for an event that happened once.",
        }),
        text("summary", "What happened, stated plainly.", true),
        oneOf("standing", "standing", "What the world's evidence supports."),
        listOf(
            "names",
            "`{ name, by, gloss? }[]`",
            "The event's names in the world, each with who uses it.",
            [
                text("name", "One name the event goes by in the world.", true),
                address(
                    "by",
                    "an Address naming an `affiliation`, `lore`, `place`, `being` or `skill` note",
                    "Who uses that name — a people, a polity, a faith, a place, a tongue.",
                    { accepts: Object.freeze(["affiliation", "lore", "place", "being", "skill"]) },
                    true,
                ),
                text("gloss", "What the name means, or how it is used."),
            ],
        ),
        Object.freeze({
            name: "where",
            kind: "map",
            shape: "`{ locus?, reach? }`",
            fields: Object.freeze([
                Object.freeze({
                    name: "locus",
                    kind: "list",
                    shape: "a list of Addresses, each defaulting to `place`",
                    entries: Object.freeze({ kind: "address", shape: "a place Address", ...PLACE }),
                    describe: "Where the event physically happened; each resolves to a place.",
                }),
                listOf(
                    "reach",
                    "`{ place, how, knowledge, attributedTo? }[]`",
                    "Where the event was felt, and whether each place knows why.",
                    [
                        address(
                            "place",
                            "an Address, defaulting to `place`",
                            "A place where the event was felt.",
                            PLACE,
                            true,
                        ),
                        text(
                            "how",
                            "One clause: a consequence someone in that place could notice.",
                            true,
                        ),
                        oneOf(
                            "knowledge",
                            "knowledge",
                            "Whether that place connects what it felt to this event.",
                            true,
                        ),
                        address(
                            "attributedTo",
                            "an Address, defaulting to `lore`, naming an event or a `lore` note",
                            "Only beside `knowledge: misattributed` — the cause that place names instead.",
                            { ref: "lore", anchors: Object.freeze(["event"]), eventOrLore: true },
                        ),
                    ],
                ),
            ]),
            describe: "Where it happened, and where it was felt.",
        }),
        listOf("who", "`{ ref, role }[]`", "Who took part, and as what.", [
            address(
                "ref",
                "an Address naming a `being`, `affiliation` or `lore` note",
                "A participant — a being, a people, an affiliation.",
                { accepts: Object.freeze(["being", "affiliation", "lore"]) },
                true,
            ),
            oneOf("role", "role", "What the participant was to the event.", true),
        ]),
        listOf(
            "follows",
            "`{ event, how, note? }[]`",
            "The earlier events this one follows from.",
            [
                address(
                    "event",
                    "an Address, defaulting to `lore`, anchored to an `event` where its note holds several",
                    "The earlier event; it resolves to exactly one event.",
                    { ref: "lore", anchors: Object.freeze(["event"]), single: true },
                    true,
                ),
                oneOf("how", "followsHow", "How this event follows from it.", true),
                text("note", "One clause saying what connects the two."),
            ],
        ),
        listOf(
            "accounts",
            "`{ by, says, agrees, withholds? }[]`",
            "What each people, polity, faith or place says about it.",
            [
                address(
                    "by",
                    "an Address naming an `affiliation`, `lore`, `place` or `being` note",
                    "Who holds the account.",
                    { accepts: Object.freeze(["affiliation", "lore", "place", "being"]) },
                    true,
                ),
                text("says", "What they say happened, in their terms.", true),
                oneOf("agrees", "agrees", "How far their account agrees with `summary`.", true),
                text("withholds", "What they decline to say."),
            ],
        ),
        Object.freeze({
            name: "unresolved",
            kind: "list",
            shape: "a list of strings",
            entries: Object.freeze({ kind: "string", shape: "a string" }),
            describe: "What the world itself has not settled.",
        }),
        Object.freeze({
            name: "sources",
            kind: "list",
            shape: "a list of Addresses",
            entries: Object.freeze({ kind: "address", shape: "an Address, written with its type" }),
            describe: "The notes that state or support the event; each resolves.",
        }),
        Object.freeze({
            name: "stated",
            kind: "map",
            shape: "`{ calendar, text }`",
            fields: Object.freeze([
                address(
                    "calendar",
                    "an Address, or a lore shortcode",
                    "The calendar that tradition reckons in — a `lore` note with `subType: calendar`.",
                    { ref: "lore", accepts: Object.freeze(["lore"]), calendar: true },
                    true,
                ),
                text("text", "The date as that tradition writes it.", true),
            ]),
            describe: "The date as one tradition writes it in its own reckoning.",
        }),
    ]),
});

/** Every key an event entry admits, in the order the reference documents them. */
export const EVENT_ENTRY_KEYS = Object.freeze(EVENT_ENTRY.fields.map((field) => field.name));
