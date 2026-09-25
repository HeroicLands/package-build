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
 * **The infobox as a declared structure** — what a note's summary panel holds,
 * decided once here and rendered by each medium.
 *
 * A note carries an ordered list of boxes, and each medium lays that list out
 * its own way: the book flows it in the column measure, the website puts it in
 * a side rail, a Foundry Journal Page inlines it. None of them decides the
 * *content*, which is what stops the same panel being defined once per
 * renderer.
 *
 * **Two kinds of box**, exactly as `docs/content-format.md` states them:
 *
 * - A **note infobox** summarises the subject from `data:` — system-agnostic
 *   facts about the thing itself. Every type has one, because every note has a
 *   name.
 * - A **system infobox** summarises what one system makes of the note, from
 *   that system's block. There is one per system the note's type maps to, and
 *   a box whose system this note produces no document for reads
 *   {@link NOT_AVAILABLE}. A system that does not map the type at all draws
 *   no box —
 *   HM3 has no affiliations, mysteries or attributes, and a box reading "Not
 *   available" on those pages would suggest a gap in the note when the truth
 *   is about the system's scope.
 *
 * **Which boxes appear is derived, never declared a second time.** The note
 * box is the type's `data:` vocabulary; the system boxes are the note-type →
 * document-subtype map. That is what makes _every page carries exactly the
 * boxes its type maps to_ an assertion the build can make —
 * {@link assertInfoboxSet} — rather than a property nobody checks.
 *
 * **What a field is called and where it sits is the only thing declared**, in
 * {@link NOTE_FIELD_PRESENTATION} for the note box and in each system's own
 * `presentation` overlay for its box. The field *set* comes from
 * {@link NOTE_VOCABULARY} and from the system's field declaration, in their
 * declared order, so a key added to a type appears on every surface with no
 * second edit. A field an overlay does not mention still gets a row,
 * humanised from its own name.
 *
 * ## Six rules that hold in every medium
 *
 * 1. **The infobox is generated content in document order** — prepended,
 *    before the prose. Not a floating sidebar. An image authored before it
 *    appears before it.
 * 2. **It contains no image.** A picture is authored in the text with its own
 *    directive, and its position governs. {@link NOTE_FIELD_PRESENTATION}
 *    withholds the art slots and `overlay` for that reason and no other.
 * 3. **A section is the unit that flows.** Sections are whole and unbreakable;
 *    the panel breaks between them. This is what lets a long box cross a
 *    column or page boundary without splitting a stat grid.
 * 4. **An absent field is absent, not empty.** A row with no value is not
 *    emitted, and neither is a section with no rows — a creature carrying no
 *    equipment gets no equipment section rather than an empty one. An em-dash
 *    placeholder asserts a fact that is not there, and an empty heading asserts
 *    that something was expected and is missing.
 * 5. **A system box is never empty; it says which silence it is.** Rule 4
 *    governs rows, and a box is not a row. A mapped system that produced no
 *    document says {@link NOT_AVAILABLE}; one that produced a document holding
 *    nothing a reader has not already been shown says
 *    {@link NOTHING_BEYOND_PROFILE}. Both travel as the box's `statement`, so
 *    a medium draws one thing and decides neither.
 * 6. **Order is the toolchain's.** A medium renders boxes, sections and rows
 *    in the order given.
 *
 * ## The shape
 *
 * ```yaml
 * infoboxes:
 *   - id: note
 *     kind: note
 *     title: Profile
 *     sections:
 *       - id: profile
 *         layout: rows
 *         rows:
 *           - label: Name
 *             kind: text
 *             value: Brànwâal Dôrgaar
 *           - label: Affiliations
 *             kind: links
 *             value:
 *               - text: The Silent Talon Company
 *                 url: /thalorna/affiliation-slntlncmpny/
 *   - id: sohl
 *     kind: system
 *     system: sohl
 *     title: SoHL
 *     available: true
 *     sections:
 *       - id: attributes
 *         label: Attributes
 *         layout: grid
 *         cells: [{ label: STR, value: 14 }]
 * ```
 *
 * Four layouts, a closed set, each one the book prototype actually uses; five
 * value kinds. **A renderer switches on `layout` and `kind`, never on a field
 * name** — that is what stops the field list leaking back into a template.
 *
 * @module
 */

import { isAddressTuple, renderAddress } from "./address.mjs";
import { getFrontmatter } from "./frontmatter.mjs";
import { currentType } from "./ids.mjs";
import { NOTE_VOCABULARY, dataFields } from "./note-vocabulary.mjs";
import { readAliasedField } from "./retired-fields.mjs";
import { subtypeRow } from "./document-subtypes.mjs";
import { authoredKey } from "./system-block.mjs";

/**
 * How a section arranges what it holds.
 *
 * Closed, and keyed by the property the section carries its content in — a
 * renderer reads one of four keys and needs no other knowledge of the data.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const INFOBOX_LAYOUTS = Object.freeze({
    /** Label/value pairs, one per line. A profile. */
    rows: "rows",
    /** Short label/value cells packed into a grid. An attribute block. */
    grid: "cells",
    /** Groups of comma-joined entries, each run in after its label. */
    runin: "groups",
    /** One entry per line. */
    list: "entries",
});

/**
 * What a row's `value` is.
 *
 * Closed. `link` and `links` carry `{text, url?, uuid?, address?}` — the three
 * addresses a medium may need, whichever of them its own index could supply.
 *
 * @type {readonly string[]}
 */
export const INFOBOX_VALUE_KINDS = Object.freeze(["text", "number", "link", "links", "list"]);

/**
 * What a mapped system that produced no document for this note says.
 *
 * Stated rather than inferred from an empty block, because an absence is a
 * poor signal: noticing that something is missing requires already knowing it
 * should have been there, and a reader meeting one page has no way to know.
 *
 * @type {string}
 */
export const NOT_AVAILABLE = "Not available";

/**
 * What a system that does produce a document, and holds nothing a reader has
 * not already been shown, says.
 *
 * The third state of a system box, and the reason it is stated rather than
 * drawn as an empty panel: a heading over nothing asserts that something
 * should have been there. It is not {@link NOT_AVAILABLE} — the system
 * compiles this note, and a reader told otherwise would go looking for a
 * document that exists. It is that everything this system holds about the note
 * is either the subject's own fact, carried by the note box above, or a value
 * the compiler would have supplied anyway.
 *
 * @type {string}
 */
export const NOTHING_BEYOND_PROFILE = "Nothing beyond the profile";

/** The note infobox's id, which is not a system id. @type {string} */
export const NOTE_BOX_ID = "note";

/** The note infobox's title. @type {string} */
export const NOTE_BOX_TITLE = "Profile";

/** The note infobox's single section id. @type {string} */
export const NOTE_SECTION_ID = "profile";

/**
 * What a **duration pair** is called.
 *
 * A note states an interval twice over — once as a roll formula and once as a
 * flat number of seconds — and the declaration names the two by what they hold:
 * `courseDurationFormula` and `courseDurationBase`. A page wants the thing
 * being timed and which of the two it is reading.
 *
 * Shared by the note box's overlay and by a system's, because the two
 * declarations spell these fields identically and a reader meeting an
 * affliction written one way and one written the other should meet one word.
 *
 * @type {Readonly<Record<string, {label: string}>>}
 */
export const DURATION_LABELS = Object.freeze({
    onsetDurationFormula: Object.freeze({ label: "Onset roll" }),
    onsetDurationBase: Object.freeze({ label: "Onset" }),
    healingCheckDurationFormula: Object.freeze({ label: "Healing check roll" }),
    healingCheckDurationBase: Object.freeze({ label: "Healing check" }),
    resolutionDurationFormula: Object.freeze({ label: "Resolution roll" }),
    resolutionDurationBase: Object.freeze({ label: "Resolution" }),
    bloodLossAdvanceDurationFormula: Object.freeze({ label: "Blood loss roll" }),
    bloodLossAdvanceDurationBase: Object.freeze({ label: "Blood loss" }),
    courseDurationFormula: Object.freeze({ label: "Course roll" }),
    courseDurationBase: Object.freeze({ label: "Course" }),
});

/**
 * What a gear item's two measured quantities are called, and measured in.
 *
 * Price is in pence and weight in pounds throughout the corpus, and the same
 * fact is authored under `data:` on one note and at its destination path on
 * another — so both overlays read the one declaration and a reader meets one
 * word and one unit whichever box the row landed in.
 *
 * @type {Readonly<Record<string, {label?: string, unit: string}>>}
 */
export const GEAR_UNITS = Object.freeze({
    value: Object.freeze({ label: "Price", unit: "d" }),
    weight: Object.freeze({ unit: " lbs" }),
});

/**
 * The presentation overlay: what a `data:` field is called, and whether it
 * belongs in the box at all.
 *
 * **This is not a second field list.** The fields come from
 * {@link NOTE_VOCABULARY}; this says only what the vocabulary cannot — the
 * label where humanising the key is wrong, the group a field composes into,
 * and the handful of keys that are not reader-facing.
 *
 * Three properties, all optional:
 *
 * - `label` — what the row is called. Absent means the key, humanised.
 * - `withheld` — why the field carries no row. Two reasons only: it is
 *   machinery — something that steers a build or an interface rather than
 *   describing the subject — or it is an image, which rule 2 keeps out of the
 *   box.
 * - `unit` — what the quantity is measured in, appended to the value verbatim.
 *   See {@link applyUnit}.
 * - `group` / `phrase` — the field composes into one row with its group mates
 *   rather than taking a row of its own. `phrase` turns the value into its
 *   clause; without one the value stands alone, so a field added to a group
 *   still appears.
 *
 * A key is either a field name or `<type>.<field name>`, and the qualified one
 * wins. One spelling is not one quantity across the vocabulary: `data.weight`
 * is a being's body weight, which reads as a clause of its appearance, and a
 * gear item's mass, which is a row. An overlay keyed on the bare word would
 * compose a coin's weight into its appearance.
 *
 * @type {Readonly<Record<string, {label?: string, withheld?: string,
 *   unit?: string, group?: string, phrase?: (value: any) => string}>>}
 */
export const NOTE_FIELD_PRESENTATION = Object.freeze({
    ...DURATION_LABELS,
    ...GEAR_UNITS,

    templatePriority: Object.freeze({
        withheld: "template machinery, not a fact about the subject",
    }),
    color: Object.freeze({
        withheld: "sidebar machinery, not a fact about the subject",
    }),
    icon: Object.freeze({ withheld: "an image, which the box never carries" }),
    tokenIcon: Object.freeze({ withheld: "an image, which the box never carries" }),
    bgImage: Object.freeze({ withheld: "an image, which the box never carries" }),
    banner: Object.freeze({ withheld: "an image, which the box never carries" }),
    overlay: Object.freeze({ withheld: "an image, which the box never carries" }),

    assocSkill: Object.freeze({ label: "Skill" }),
    assocAffiliation: Object.freeze({ label: "Affiliation" }),
    parentSkill: Object.freeze({ label: "Specialises" }),
    "governance.model": Object.freeze({ label: "Government" }),
    "governance.summary": Object.freeze({ label: "How it governs" }),
    "governance.ranks": Object.freeze({ label: "Ranks" }),
    "governance.offices": Object.freeze({ label: "Offices" }),
    "party.size": Object.freeze({ label: "Party size" }),
    "party.archetypes": Object.freeze({ label: "Written for" }),
    seat: Object.freeze({ label: "Seat" }),
    parents: Object.freeze({ label: "Within" }),
    lore: Object.freeze({ label: "Lore" }),
    homes: Object.freeze({ label: "Home" }),

    // The appearance clause: a being's measurements read as a sentence rather
    // than as six rows of numbers, exactly as the book prototype sets them.
    // Qualified by type, because `weight` is also what a coin weighs.
    "being.age": Object.freeze({ group: "appearance", phrase: (v) => `Age ${v}` }),
    // The `~` estimate's numeric companion — beside `age` in the index for a
    // machine to sort or filter on, not a second row for a reader who already
    // meets it inside the appearance clause.
    "being.ageYears": Object.freeze({
        withheld: "the `age` row's own machinery, not a second fact about the subject",
    }),
    "being.height": Object.freeze({ group: "appearance", phrase: heightPhrase }),
    "being.weight": Object.freeze({ group: "appearance", phrase: weightPhrase }),
    "being.frame": Object.freeze({ group: "appearance", phrase: (v) => `${v} frame` }),
    "being.appearance.eye_color": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} eyes`,
    }),
    "being.appearance.hair_color": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} hair`,
    }),
    "being.appearance.skin_color": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} skin`,
    }),
    "being.appearance.complexion": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} complexion`,
    }),
    "being.appearance.extra_features": Object.freeze({ group: "appearance" }),
});

/**
 * One field's overlay entry, qualified by type where the declaration qualifies
 * it.
 *
 * `<type>.<field>` wins over the bare name, so a spelling two types use for two
 * quantities can be said differently on each without splitting the overlay.
 *
 * **Keyed by the key an author writes, not by the path a declaration names.**
 * One fact has two declarations — the note vocabulary's `weight` and an item
 * field's `data.weight` — and the overlay says what a *reader* is shown, which
 * is one word either way. So the container is dropped before the lookup, and
 * `GEAR_UNITS` answers for both sides with one entry.
 *
 * @param {Readonly<Record<string, object>>} presentation - The overlay.
 * @param {string|undefined} type - The note's type.
 * @param {string} name - The field's declared name.
 * @returns {object} The entry, or an empty one.
 */
export function overlayFor(presentation, type, name) {
    const key = authoredKey(name);
    return presentation?.[`${currentType(type)}.${key}`] ?? presentation?.[key] ?? {};
}

/** What a composed group's row is called. @type {Readonly<Record<string, string>>} */
const GROUP_LABELS = Object.freeze({ appearance: "Appearance" });

/** Metres as feet and inches, which is how the corpus reads a height. */
function heightPhrase(metres) {
    const inches = Math.round(Number(metres) * 39.3701);
    const feet = Math.floor(inches / 12);
    return `${feet}′ ${inches - feet * 12}″`;
}

/** Kilograms as pounds, which is how the corpus reads a weight. */
function weightPhrase(kilograms) {
    return `${Math.round(Number(kilograms) * 2.20462)} lbs`;
}

/** Whether a value is a plain mapping. */
function isMapping(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
/**
 * The words a note writes when it means "there is nothing here".
 *
 * A corpus states an absence three ways, and only two of them are the absence
 * of a value: the key is omitted, or it holds the field's own default. The
 * third is a **sentinel** — a token standing in for the unset state, spelled
 * however the note happened to spell it. `potency: na` and `category: none`
 * are not a sodium potion and a category called None; they are two authors
 * writing "not applicable" in the space a value would go.
 *
 * Compared after {@link normalizeToken} strips everything but letters, so
 * `n/a`, `N/A` and `not applicable` are one word and `none of the above` is
 * not one of them.
 *
 * @type {readonly string[]}
 */
export const UNSET_VALUES = Object.freeze([
    "na",
    "none",
    "notapplicable",
    "unset",
    "null",
    "undefined",
]);

/**
 * A value reduced to its letters, lowercased.
 *
 * @param {unknown} value - The authored value.
 * @returns {string} The token.
 */
function normalizeToken(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");
}

/**
 * Whether a value is a word meaning "nothing here" rather than a value.
 *
 * @param {unknown} value - The authored value.
 * @returns {boolean} Whether it is one of {@link UNSET_VALUES}.
 */
export function isUnsetSentinel(value) {
    if (typeof value !== "string") return false;
    return UNSET_VALUES.includes(normalizeToken(value));
}

/**
 * Whether a value is worth a row.
 *
 * Rule 4: an absent field is absent. `null`, `""` and `[]` are how the corpus
 * writes "nobody filled this in" — a note that declares every key of its type
 * and leaves most of them empty is the ordinary shape, not the exception — and
 * so is a sentinel, which is the same absence written as a word. Judged here
 * rather than per field, because a sentinel that reaches a page reaches it the
 * same way whichever box was building the row.
 *
 * @param {unknown} value - The authored value.
 * @returns {boolean} Whether to emit it.
 */
export function hasValue(value) {
    if (isAddressTuple(value)) return true;
    if (value == null) return false;
    if (typeof value === "string") return value.trim() !== "" && !isUnsetSentinel(value);
    if (Array.isArray(value)) return value.some((entry) => hasValue(entry));
    if (isMapping(value)) return false;
    return true;
}

/**
 * A key as a reader sees it: `healingRate` → `Healing rate`.
 *
 * The last dotted segment only — a nested key's container is already said by
 * the section it sits in, and "Appearance eye color" says it twice.
 *
 * @param {string} name - The declared key.
 * @returns {string} The label.
 */
export function humanizeFieldName(name) {
    const leaf =
        String(name ?? "")
            .split(".")
            .pop() ?? "";
    const words = leaf
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim()
        .toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * An enumerated value as a reader sees it: `graying_brown` → `graying brown`.
 *
 * @param {unknown} value - The authored value.
 * @returns {string} The text.
 */
export function humanizeValue(value) {
    if (isAddressTuple(value)) value = value.shortcode;
    return String(value ?? "")
        .replace(/[_-]+/g, " ")
        .trim();
}

/**
 * A value as a row shows it.
 *
 * A **single lowercase token** is an enumerated value — `male`, `medium`,
 * `city-state` — and a row reading "male" beside a name reads as a fault
 * rather than as a value, so its words are capitalised. Anything else is prose
 * the author wrote and is shown as written: title-casing "a dispossessed
 * noble" would be this build editing the corpus.
 *
 * @param {unknown} value - The authored value.
 * @returns {string} The text.
 */
export function presentValue(value) {
    if (isAddressTuple(value)) value = value.shortcode;
    const text = humanizeValue(value);
    if (!/^[a-z][a-z0-9_-]*$/.test(String(value ?? ""))) return text;
    return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * Whether a built value is worth a row.
 *
 * Separate from {@link hasValue}, which judges what an author wrote: a `link`
 * value is a mapping and a `links` value is a list of them, and both are
 * exactly what the authored form is not.
 *
 * @param {string} kind - One of {@link INFOBOX_VALUE_KINDS}.
 * @param {unknown} value - The built value.
 * @returns {boolean} Whether to emit the row.
 */
export function hasRenderableValue(kind, value) {
    if (kind === "link") return Boolean(value && value.text);
    if (kind === "links" || kind === "list") return Array.isArray(value) && value.length > 0;
    return hasValue(value);
}

/**
 * The value kind a `data:` declaration implies.
 *
 * Read from the declaration's own shape rather than from the value, so two
 * notes of one type describe the same field the same way — a one-entry list
 * and a two-entry list are both `links`.
 *
 * @param {object} field - A `DataFieldSpec`.
 * @param {unknown} value - The authored value, for the shapes the declaration
 *   makes no claim about.
 * @returns {string} One of {@link INFOBOX_VALUE_KINDS}.
 */
export function valueKindOf(field, value) {
    if (field?.kind === "address" || field?.shape === "a wikilink") return "link";
    if (
        (field?.kind === "list" && field?.entryKind === "address") ||
        field?.shape === "list of wikilinks"
    )
        return "links";
    if (field?.kind === "number") return "number";
    if (field?.kind === "list") return "list";
    if (field?.kind === "string") return "text";
    return Array.isArray(value) ? "list" : "text";
}

/**
 * Build one row's value, resolving whatever the kind says is a reference.
 *
 * @param {string} kind - One of {@link INFOBOX_VALUE_KINDS}.
 * @param {unknown} raw - The authored value.
 * @param {(ref: unknown, hint?: object) => object|undefined} resolve - The
 *   medium's resolver.
 * @param {object} [hint] - What the reference is expected to name.
 * @returns {unknown} The row value, shaped for the kind.
 */
function rowValue(kind, raw, resolve, hint) {
    if (kind === "link") return linkValue(raw, resolve, hint);
    if (kind === "links") {
        return (Array.isArray(raw) ? raw : [raw])
            .filter(hasValue)
            .map((r) => linkValue(r, resolve, hint));
    }
    if (kind === "list") {
        return (Array.isArray(raw) ? raw : [raw]).filter(hasValue).map((v) => presentValue(v));
    }
    if (kind === "number") return raw;
    return presentValue(raw);
}

/**
 * One row, with its unit on it.
 *
 * **The unit goes on the value, not on the label**, because it belongs to the
 * quantity rather than to the name of the quantity. A price is 160d and a
 * weight is 1.1 lbs; splitting that across two cells — `Price (d)` beside
 * `160` — makes a reader reassemble one fact from two places, and reads worst
 * in the book, whose label column is a narrow small-caps rule.
 *
 * A medium cannot supply it. Appending `d` to a price means knowing which row
 * is the price, which is the one thing a generic renderer must never know — so
 * the unit is declared here and travels as part of the value.
 *
 * The declared string is appended **verbatim**, which is what lets a symbol
 * hug its number (`160d`) and a word stand off it (`1.1 lbs`). The row's kind
 * becomes `text`: a number with a unit on it is no longer a number, and saying
 * otherwise would invite a medium to format it as one.
 *
 * @param {string} kind - The row's kind.
 * @param {unknown} value - The built value.
 * @param {string} [unit] - The declared unit, or nothing.
 * @returns {{kind: string, value: unknown}} The row's kind and value.
 */
export function applyUnit(kind, value, unit) {
    if (!unit || (kind !== "number" && kind !== "text")) return { kind, value };
    return { kind: "text", value: `${value}${unit}` };
}

/**
 * One reference, resolved as far as the medium's index reaches.
 *
 * An unresolved reference keeps its own text rather than being dropped: a page
 * that names something the index has not heard of is better than a page
 * silently missing a row.
 *
 * @param {unknown} ref - The authored reference — a shortcode or an address.
 * @param {(ref: unknown, hint?: object) => object|undefined} resolve - The
 *   medium's resolver.
 * @param {object} [hint] - What the reference is expected to name, where the
 *   declaration says: `{type}`. A shortcode is unique within a type and not
 *   across a tree, so a hint is what stops a region resolving to a polity.
 * @returns {{text: string, url?: string, uuid?: string, address?: string}} The value.
 */
export function linkValue(ref, resolve, hint) {
    const found = resolve?.(ref, hint);
    const value = { text: found?.name || humanizeValue(ref) };
    if (found?.url) value.url = found.url;
    if (found?.uuid) value.uuid = found.uuid;
    if (found?.address) value.address = found.address;
    return value;
}

/**
 * The note infobox: the subject from `data:`, plus the name every note has.
 *
 * The rows are {@link NOTE_VOCABULARY}'s declaration for the type, in its
 * order, minus what {@link NOTE_FIELD_PRESENTATION} withholds and minus every
 * field the note left empty. A type that declares no `data:` fields still gets
 * the box, because `Name` is a fact about every note.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} [options] - Options.
 * @param {(ref: unknown) => object|undefined} [options.resolve] - Resolves a
 *   reference to `{name, url?, uuid?, address?}`.
 * @param {object} [options.vocabulary] - The note vocabulary to read.
 * @param {object} [options.presentation] - The overlay to read.
 * @returns {object} The box.
 */
export function noteInfobox(fm, options = {}) {
    return noteBox(fm, options).box;
}

/**
 * The note infobox, and the names of the fields it actually shows.
 *
 * The second half is what a system box needs: a field is the note's to state
 * only where the note box **states** it, which is not the same as the
 * vocabulary declaring it. A gear item's weight is declared under `data:` and
 * authored at `sohl.system.weightBase`, so the note box shows nothing for it,
 * and a system box that stood down on the strength of the declaration alone
 * left the fact on no surface at all.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} [options] - As {@link noteInfobox}.
 * @returns {{box: object, shown: Set<string>}} The box, and the field names it
 *   put on the page.
 */
function noteBox(
    fm,
    { resolve, vocabulary = NOTE_VOCABULARY, presentation = NOTE_FIELD_PRESENTATION } = {},
) {
    const rows = [];
    /** @type {Set<string>} */
    const shown = new Set();
    const name = fm?.name?.full ?? fm?.title;
    if (hasValue(name)) rows.push({ label: "Name", kind: "text", value: String(name) });

    const data = isMapping(fm?.data) ? fm.data : {};
    /** @type {Map<string, {label: string, entries: string[]}>} */
    const groups = new Map();

    for (const field of dataFields(fm?.type, vocabulary) ?? []) {
        const overlay = overlayFor(presentation, fm?.type, field.name);
        if (overlay.withheld) continue;
        // The retired spelling underneath, so a note part-way through a rename
        // still shows its value rather than losing the row with nothing said.
        // The current name wins, which is the whole of the retirement window's
        // behaviour and is `readAliasedField`'s answer, not a second one.
        const own = getFrontmatter(data, field.name, undefined);
        const raw = hasValue(own) ? own : readAliasedField(fm, field.name, { inData: true });
        if (!hasValue(raw)) continue;

        if (overlay.group) {
            const group = groups.get(overlay.group) ?? {
                label: GROUP_LABELS[overlay.group] ?? humanizeFieldName(overlay.group),
                entries: [],
            };
            const parts = Array.isArray(raw) ? raw.filter(hasValue) : [raw];
            for (const part of parts) {
                group.entries.push(overlay.phrase ? overlay.phrase(part) : humanizeValue(part));
            }
            if (!groups.has(overlay.group)) {
                groups.set(overlay.group, group);
                // A composed row takes the place of its group's first field, so
                // the group appears where the vocabulary put it.
                rows.push({ label: group.label, kind: "list", value: group.entries });
            }
            shown.add(field.name);
            continue;
        }

        const declaredKind = valueKindOf(field, raw);
        const built = rowValue(declaredKind, raw, resolve);
        if (!hasRenderableValue(declaredKind, built)) continue;
        const { kind, value } = applyUnit(declaredKind, built, overlay.unit);
        rows.push({ label: overlay.label ?? humanizeFieldName(field.name), kind, value });
        shown.add(field.name);
    }

    return {
        box: {
            id: NOTE_BOX_ID,
            kind: "note",
            title: NOTE_BOX_TITLE,
            sections: [{ id: NOTE_SECTION_ID, layout: "rows", rows }],
        },
        shown,
    };
}

/**
 * Declare one system's half of the infobox.
 *
 * The **mechanism** is here and the **declaration** is the system's, which is
 * the `engine/` ÷ `sohl/` line everywhere else in this package: what a box
 * looks like is note-format knowledge, and which of a system's fields are
 * worth a row is that system's.
 *
 * A declaration is refused at module evaluation rather than when some note
 * reaches it: it is a small piece of authored data loaded once per build, so a
 * mistake in it should stop the build immediately and name the fault.
 *
 * @param {object} declaration - The system's declaration.
 * @param {string} declaration.system - The system id.
 * @param {string} declaration.title - What the box is called.
 * @param {Readonly<Record<string, readonly object[]>>} [declaration.fields] -
 *   Note type → that system's declared field list, read for the generic rows
 *   section. The same list the compiler obeys, never a copy of it.
 * @param {Readonly<Record<string, {label?: string, withheld?: string}>>} [declaration.presentation] -
 *   The presentation overlay: what one of this system's fields is called where
 *   humanising its key is wrong, and the fields that carry no row at all.
 *   **Not a second field list** — the fields come from `fields`, and a field
 *   the overlay does not mention still gets a row, so a field added to the
 *   system reaches the box with no edit here.
 * @param {Record<string, (fm: object, ctx: object) => object[]>} [declaration.sections] -
 *   Note type → a builder returning that type's sections, for a type whose box
 *   is derived rather than read field by field.
 * @returns {object} The frozen declaration.
 * @throws {Error} When it names no system or no title.
 */
export function defineInfobox(
    { system, title, fields, presentation, sections } = /** @type {never} */ ({}),
) {
    if (typeof system !== "string" || system === "") {
        throw new Error(
            "An infobox declaration must name the `system` it belongs to — a box " +
                "is built per system, and its rows are only meaningful against one.",
        );
    }
    if (typeof title !== "string" || title === "") {
        throw new Error(
            `The "${system}" infobox declares no \`title\` — the box carries a ` +
                "heading on every surface, and a heading nobody wrote would be " +
                "invented once per renderer.",
        );
    }
    return Object.freeze({
        system,
        title,
        fields: Object.freeze({ ...(fields ?? {}) }),
        presentation: Object.freeze({ ...(presentation ?? {}) }),
        sections: Object.freeze({ ...(sections ?? {}) }),
    });
}

/**
 * Whether two authored values say the same thing.
 *
 * Structural, because a declared default is as often `[]` or `{value: null}`
 * as it is a number.
 *
 * @param {unknown} a - One value.
 * @param {unknown} b - The other.
 * @returns {boolean} Whether they agree.
 */
function sameValue(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((entry, at) => sameValue(entry, b[at]));
    }
    if (isMapping(a) && isMapping(b)) {
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;
        return keys.every((key) => key in b && sameValue(a[key], b[key]));
    }
    return false;
}

/**
 * Whether a field's value is the one its own declaration would have supplied.
 *
 * _A field answered by its default is a fact about the compiler, not about the
 * note_ — and that is true of the **value**, not of where it was written. A
 * corpus writes its defaults out: `improveFlag: false`, `combatCategory: none`
 * and `initSkillMult: 0` are typed into hundreds of notes that mean nothing by
 * them, and a row for each says the compiler's word back to a reader who came
 * for the note's.
 *
 * A field declaring no default has nothing to be equal to, so every value it
 * holds is the note's.
 *
 * @param {object} field - The declaration.
 * @param {unknown} raw - The resolved value.
 * @returns {boolean} Whether the value is the declaration's own.
 */
export function isDeclaredDefault(field, raw) {
    return "default" in (field ?? {}) && sameValue(raw, field.default);
}

/**
 * The generic rows section: what this note authors in one system's block.
 *
 * Read through the system's own field declaration, in its order, and only
 * where the note said something the declaration does not already say — a value
 * equal to the field's own default is the compiler's answer wherever it was
 * typed.
 *
 * A field the **note box** already put on the page is skipped, so the panel
 * does not say one fact twice. It is what the note box *shows* rather than
 * what its vocabulary declares: a gear item's weight is declared under `data:`
 * and authored at `sohl.system.weightBase`, and standing down on the
 * declaration alone left the fact on no surface at all.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {readonly object[]} fields - The system's field declaration.
 * @param {object} ctx - `{ block, resolve, resolveField, taken, presentation }`.
 * @returns {object[]} Zero or one section.
 */
export function systemRowsSection(
    fm,
    fields,
    { block, resolve, resolveField, taken = new Set(), presentation = {} },
) {
    const rows = [];
    for (const field of fields ?? []) {
        // Asked on the authored key: the note box records what it showed by the
        // key a note writes, and a field whose shared source is a path into
        // `data:` names the container as well — so comparing the declared names
        // would put one fact on two surfaces.
        if (!field?.name || taken.has(authoredKey(field.name))) continue;
        const overlay = overlayFor(presentation, fm?.type, field.name);
        if (overlay.withheld) continue;
        const { value: raw, from } = resolveField(field, fm, { block });
        if (from === "default" || from === "value") continue;
        if (isDeclaredDefault(field, raw)) continue;
        if (!hasValue(raw)) continue;
        const declaredKind = field.code ? "link" : valueKindOf(field, raw);
        const built = rowValue(
            declaredKind,
            raw,
            resolve,
            field.code ? { kind: "shortcode", type: field.code, system: block } : undefined,
        );
        if (!hasRenderableValue(declaredKind, built)) continue;
        const { kind, value } = applyUnit(declaredKind, built, overlay.unit);
        rows.push({ label: overlay.label ?? humanizeFieldName(field.name), kind, value });
    }
    return rows.length ? [{ id: "profile", layout: "rows", rows }] : [];
}

/**
 * Every box a note carries, in the order every medium renders them.
 *
 * The note box first — it is the subject itself — then one box per system the
 * note's type maps to, in the order the maps are declared.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} options - Options.
 * @param {readonly object[]} options.maps - The document-subtype maps this
 *   build ships, which decide the box set.
 * @param {readonly object[]} [options.providers] - The systems' infobox
 *   declarations, keyed by `system`.
 * @param {(fm: object, map: object) => boolean} options.compilesDocument -
 *   Whether that system compiles a document for this note, which decides
 *   {@link NOT_AVAILABLE}. Asked of the routing and the passes rather than of
 *   the frontmatter: a pack declaring no `system:` compiles a note from `data:`
 *   and the field defaults, so the block's presence is not the question.
 * @param {(field: object, fm: object, opts: object) => object} options.resolveField -
 *   Resolves one declared field against the note.
 * @param {(ref: unknown) => object|undefined} [options.resolve] - Resolves a
 *   reference to `{name, url?, uuid?, address?}`.
 * @param {object} [options.vocabulary] - The note vocabulary to read.
 * @returns {object[]} The boxes.
 */
export function buildInfoboxes(fm, options) {
    const {
        maps,
        providers = [],
        compilesDocument,
        resolveField,
        resolve,
        vocabulary = NOTE_VOCABULARY,
    } = options;

    const { box: note, shown: taken } = noteBox(fm, { resolve, vocabulary });
    const boxes = [note];

    for (const map of maps ?? []) {
        if (!subtypeRow(map, fm?.type)) continue;
        const provider = providers.find((entry) => entry.system === map.system);
        const available = Boolean(compilesDocument(fm, map));
        const box = {
            id: map.system,
            kind: "system",
            system: map.system,
            title: provider?.title ?? map.system,
            available,
            sections: [],
        };
        if (available && provider) {
            const type = currentType(fm.type);
            const ctx = {
                block: map.block,
                resolve,
                resolveField,
                taken,
                presentation: provider.presentation ?? {},
            };
            const build = provider.sections[type];
            box.sections =
                build ? build(fm, ctx) : systemRowsSection(fm, provider.fields[type], ctx);
        }
        // A system box is never an empty panel. It either holds something, or
        // it says which of the two silences this is.
        if (!available) box.statement = NOT_AVAILABLE;
        else if (!box.sections.some(sectionHolds)) box.statement = NOTHING_BEYOND_PROFILE;
        boxes.push(box);
    }
    return boxes;
}

/**
 * Whether a section holds anything a medium would draw.
 *
 * Keyed by {@link INFOBOX_LAYOUTS}, so a layout added there is understood here
 * without a second edit.
 *
 * @param {object} section - The section.
 * @returns {boolean} Whether it holds anything.
 */
export function sectionHolds(section) {
    const key = INFOBOX_LAYOUTS[section?.layout];
    return Boolean(key && Array.isArray(section[key]) && section[key].length);
}

/**
 * The box ids a note's type requires, in order.
 *
 * Derived from the same two declarations {@link buildInfoboxes} reads, so the
 * assertion below compares an emitter's output against the format rather than
 * against a restatement of it.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} options - `{ maps }`.
 * @returns {string[]} The ids.
 */
export function requiredInfoboxIds(fm, { maps }) {
    const ids = [NOTE_BOX_ID];
    for (const map of maps ?? []) {
        if (subtypeRow(map, fm?.type)) ids.push(map.system);
    }
    return ids;
}

/**
 * Refuse a page carrying anything but the boxes its type maps to.
 *
 * _Every page carries exactly the boxes its type maps to_ is the property the
 * format states and the reason the box set is derived rather than declared.
 * Asserted where the boxes are emitted, in every medium, so a missing infobox
 * is a failure rather than something nobody notices — and so is a box for a
 * system that will compile no document, which is a note claiming a system it
 * does not reach.
 *
 * @param {readonly object[]} boxes - What was built.
 * @param {object} fm - The note's frontmatter.
 * @param {object} options - `{ maps, where }`.
 * @returns {readonly object[]} The boxes, unchanged, so a caller may assert
 *   inline.
 * @throws {Error} Naming the note, what is missing and what is extra.
 */
export function assertInfoboxSet(boxes, fm, { maps, where = "" } = {}) {
    const required = requiredInfoboxIds(fm, { maps });
    const got = (boxes ?? []).map((box) => box.id);
    const missing = required.filter((id) => !got.includes(id));
    const extra = got.filter((id) => !required.includes(id));
    if (!missing.length && !extra.length) return boxes;

    const subject = fm?.name?.full ?? fm?.shortcode ?? "this note";
    const parts = [];
    if (missing.length) parts.push(`is missing ${missing.map((id) => `\`${id}\``).join(", ")}`);
    if (extra.length) parts.push(`carries ${extra.map((id) => `\`${id}\``).join(", ")} as well`);
    throw new Error(
        `"${subject}" is a "${fm?.type}", whose type maps to the infoboxes ` +
            `${required.map((id) => `\`${id}\``).join(", ")}, and the page ${parts.join(" and ")}` +
            `${where ? ` — ${where}` : ""}. Which boxes a page carries is decided by ` +
            `the note-type → document-subtype map, so a set that disagrees with it ` +
            `means either a system block nothing will compile or a panel a reader ` +
            `is silently not shown.`,
    );
}
