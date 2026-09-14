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
 *   {@link NOT_AVAILABLE}. A system that maps the type at all draws no box —
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
 * {@link NOTE_FIELD_PRESENTATION}. The field *set* comes from
 * {@link NOTE_VOCABULARY}, in its declared order, so a key added to a type
 * appears on every surface with no second edit. A field the overlay does not
 * mention still gets a row, humanised from its own name.
 *
 * ## Six rules that hold in every medium
 *
 * 1. **The infobox is generated content in document order** — prepended,
 *    before the prose. Not a floating sidebar. An image authored before it
 *    appears before it.
 * 2. **It contains no image.** A picture is authored in the text with its own
 *    directive, and its position governs. {@link NOTE_FIELD_PRESENTATION}
 *    withholds `portrait`, `img` and `overlay` for that reason and no other.
 * 3. **A section is the unit that flows.** Sections are whole and unbreakable;
 *    the panel breaks between them. This is what lets a long box cross a
 *    column or page boundary without splitting a stat grid.
 * 4. **An absent field is absent, not empty.** A row with no value is not
 *    emitted. An em-dash placeholder asserts a fact that is not there.
 * 5. **{@link NOT_AVAILABLE} is a different thing, and survives.** It is the
 *    whole box for a mapped system that produced no document — a statement
 *    about this note, not about a missing field. Rule 4 governs rows; this
 *    governs boxes.
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

import { getFrontmatter } from "./frontmatter.mjs";
import { currentType } from "./ids.mjs";
import { NOTE_VOCABULARY, dataFields } from "./note-vocabulary.mjs";
import { subtypeRow } from "./document-subtypes.mjs";

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

/** The note infobox's id, which is not a system id. @type {string} */
export const NOTE_BOX_ID = "note";

/** The note infobox's title. @type {string} */
export const NOTE_BOX_TITLE = "Profile";

/** The note infobox's single section id. @type {string} */
export const NOTE_SECTION_ID = "profile";

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
 * - `withheld` — why the field carries no row. Two reasons only: it is build
 *   plumbing, or it is an image, which rule 2 keeps out of the box.
 * - `group` / `phrase` — the field composes into one row with its group mates
 *   rather than taking a row of its own. `phrase` turns the value into its
 *   clause; without one the value stands alone, so a field added to a group
 *   still appears.
 *
 * @type {Readonly<Record<string, {label?: string, withheld?: string,
 *   group?: string, phrase?: (value: any) => string}>>}
 */
export const NOTE_FIELD_PRESENTATION = Object.freeze({
    templatePriority: Object.freeze({
        withheld: "template machinery, not a fact about the subject",
    }),
    portrait: Object.freeze({ withheld: "an image, which the box never carries" }),
    img: Object.freeze({ withheld: "an image, which the box never carries" }),
    overlay: Object.freeze({ withheld: "an image, which the box never carries" }),

    birthday: Object.freeze({ label: "Born" }),
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
    age: Object.freeze({ group: "appearance", phrase: (v) => `Age ${v}` }),
    height: Object.freeze({ group: "appearance", phrase: heightPhrase }),
    weight: Object.freeze({ group: "appearance", phrase: weightPhrase }),
    frame: Object.freeze({ group: "appearance", phrase: (v) => `${v} frame` }),
    "appearance.eye_color": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} eyes`,
    }),
    "appearance.hair_color": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} hair`,
    }),
    "appearance.skin_color": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} skin`,
    }),
    "appearance.complexion": Object.freeze({
        group: "appearance",
        phrase: (v) => `${humanizeValue(v)} complexion`,
    }),
    "appearance.extra_features": Object.freeze({ group: "appearance" }),
});

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
 * Whether a value is worth a row.
 *
 * Rule 4: an absent field is absent. `null`, `""` and `[]` are how the corpus
 * writes "nobody filled this in" — a note that declares every key of its type
 * and leaves most of them empty is the ordinary shape, not the exception.
 *
 * @param {unknown} value - The authored value.
 * @returns {boolean} Whether to emit it.
 */
export function hasValue(value) {
    if (value == null) return false;
    if (typeof value === "string") return value.trim() !== "";
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
    if (field?.shape === "a wikilink") return "link";
    if (field?.shape === "list of wikilinks") return "links";
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
export function noteInfobox(
    fm,
    { resolve, vocabulary = NOTE_VOCABULARY, presentation = NOTE_FIELD_PRESENTATION } = {},
) {
    const rows = [];
    const name = fm?.name?.full ?? fm?.title;
    if (hasValue(name)) rows.push({ label: "Name", kind: "text", value: String(name) });

    const data = isMapping(fm?.data) ? fm.data : {};
    /** @type {Map<string, {label: string, entries: string[]}>} */
    const groups = new Map();

    for (const field of dataFields(fm?.type, vocabulary) ?? []) {
        const overlay = presentation[field.name] ?? {};
        if (overlay.withheld) continue;
        const raw = getFrontmatter(data, field.name, undefined);
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
            continue;
        }

        const kind = valueKindOf(field, raw);
        const value = rowValue(kind, raw, resolve);
        if (!hasRenderableValue(kind, value)) continue;
        rows.push({ label: overlay.label ?? humanizeFieldName(field.name), kind, value });
    }

    return {
        id: NOTE_BOX_ID,
        kind: "note",
        title: NOTE_BOX_TITLE,
        sections: [{ id: NOTE_SECTION_ID, layout: "rows", rows }],
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
 * @param {Record<string, (fm: object, ctx: object) => object[]>} [declaration.sections] -
 *   Note type → a builder returning that type's sections, for a type whose box
 *   is derived rather than read field by field.
 * @returns {object} The frozen declaration.
 * @throws {Error} When it names no system or no title.
 */
export function defineInfobox({ system, title, fields, sections } = /** @type {never} */ ({})) {
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
        sections: Object.freeze({ ...(sections ?? {}) }),
    });
}

/**
 * The generic rows section: what this note authors in one system's block.
 *
 * Read through the system's own field declaration, in its order, and only
 * where the note actually wrote a value — a field answered by its default is a
 * fact about the compiler, not about the note.
 *
 * A field the **note box** already carries is skipped. A shared source such as
 * a gear item's `weight` is authored under `data:` on one note and at its
 * destination path on another, and the note box is where a system-agnostic
 * fact belongs; showing it twice on the notes that write it one way would make
 * the panel disagree with itself across two pages of the same type.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {readonly object[]} fields - The system's field declaration.
 * @param {object} ctx - `{ block, resolve, resolveFieldValue, taken }`.
 * @returns {object[]} Zero or one section.
 */
export function systemRowsSection(fm, fields, { block, resolve, resolveField, taken = new Set() }) {
    const rows = [];
    for (const field of fields ?? []) {
        if (!field?.name || taken.has(field.name)) continue;
        const { value: raw, from } = resolveField(field, fm, { block });
        if (from === "default" || from === "value") continue;
        if (!hasValue(raw)) continue;
        const kind = field.ref ? "link" : valueKindOf(field, raw);
        const value = rowValue(kind, raw, resolve, field.ref ? { type: field.ref } : undefined);
        if (!hasRenderableValue(kind, value)) continue;
        rows.push({ label: humanizeFieldName(field.name), kind, value });
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
 * @param {(fm: object, block: string) => boolean} options.carriesBlock -
 *   Whether the note says anything about a system, which decides
 *   {@link NOT_AVAILABLE}.
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
        carriesBlock,
        resolveField,
        resolve,
        vocabulary = NOTE_VOCABULARY,
    } = options;

    const boxes = [noteInfobox(fm, { resolve, vocabulary })];
    const taken = new Set((dataFields(fm?.type, vocabulary) ?? []).map((field) => field.name));

    for (const map of maps ?? []) {
        if (!subtypeRow(map, fm?.type)) continue;
        const provider = providers.find((entry) => entry.system === map.system);
        const available = Boolean(carriesBlock(fm, map.block));
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
            const build = provider.sections[type];
            box.sections =
                build ?
                    build(fm, { block: map.block, resolve, resolveField, taken })
                :   systemRowsSection(fm, provider.fields[type], {
                        block: map.block,
                        resolve,
                        resolveField,
                        taken,
                    });
        }
        boxes.push(box);
    }
    return boxes;
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
