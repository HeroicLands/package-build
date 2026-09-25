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
 * **An authored Address, an emitted Shortcode.**
 *
 * A declared field may hold an Address where the document it compiles into
 * holds a **Shortcode**. An affiliation's `seat` is the worked case: the note
 * names a place at whatever length says what it means — `tashal`,
 * `place-tashal`, `none-place-tashal`, `kethira-none-place-tashal` — and the
 * compiled Item carries `tashal`, which is what the runtime resolves among the
 * items one actor holds, where packages do not exist.
 *
 * So the builder resolves the one into the other, and this module is that step.
 * Storing the written form instead would store a value plus a context that does
 * not travel with it: a four-segment string reaches a runtime that looks up one
 * segment and returns nothing, silently.
 *
 * ## The two questions stay separate
 *
 * A position declares both halves, and they are not the same statement:
 *
 * - **`type`** is what an omitted `<type>` segment takes — the default
 *   {@link module:engine/address.parseAddress} fills in.
 * - **`accepts`** is the set of types the position takes at all, tested by
 *   {@link module:engine/address.acceptsType} once the value parses.
 *
 * They coincide at every position here, and that is the common case rather than
 * the rule: an art slot defaults to `icon` and accepts `icon` or `image`. So the
 * set is read as its own input and never derived from the default, and a
 * position accepting several types is expressible without touching this module.
 *
 * The distinction is what a value like `being-foobar` turns on. With the package
 * and the system supplied from context it parses to a perfectly good Address —
 * and it is unacceptable to a field that takes a place. The parser does not
 * refuse it, because it is an Address; the **field** refuses it, with an error
 * naming what it accepts.
 *
 * ## The default `<system>` segment is the default type's own
 *
 * An affiliation compiles into a SoHL Item, so a bare `relations` key expands
 * to `<package>-sohl-affiliation-<shortcode>`; a place is a core document, so a
 * bare `seat` expands to `<package>-none-place-<shortcode>`. The segment is
 * therefore a property of what the position names rather than of the block the
 * value sits in, and it is derived from the declared default type by the same
 * rule {@link module:engine/address} applies.
 *
 * ## The reduction is lossy, and the collision it loses is legal
 *
 * A shortcode is unique only within one `package-system-type` space, so
 * `foo-sohl-affiliation-b` and `bar-sohl-affiliation-b` are both valid and are
 * two different affiliations. Reducing either to `b` throws away the only thing
 * that told them apart, and the emitted field cannot represent both.
 *
 * That is **an error naming both Addresses**, rather than a silent merge:
 * shipping a standing nobody authored is the worse outcome. It fires on content
 * that is entirely valid, so the message says so instead of implying a mistake.
 *
 * One Address written twice is a different finding, and only where the position
 * holds a map: two keys reducing to one emitted key claim two values for one
 * target, and the field carries one. In a **list** the same Address twice is an
 * ordinary duplicate — nothing is lost, so nothing is reported.
 *
 * ## What this module does not do
 *
 * It resolves nothing against the index: the shortcode is a segment of the
 * Address, so reducing one needs the grammar and the position's declarations
 * and nothing else. Whether the target exists is a separate question, asked
 * where the index is.
 *
 * A failure is a **finding**, never a diagnostic: the caller owns the file and
 * the severity, and locates the finding at the value inside the note.
 *
 * @module
 */

import { acceptsType, parseAddress, renderAddress } from "./address.mjs";
import { systemOf } from "./document-subtypes.mjs";
import { getFrontmatter } from "./frontmatter.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";
import { setPath } from "./system-block.mjs";

/**
 * How many values a position holds.
 *
 * - `value` — the field's value is one Address.
 * - `items` — every element of a list is one.
 * - `keys` — every **key** of a map is one, and the values are untouched.
 *
 * @type {readonly string[]}
 */
export const ADDRESS_FIELD_SHAPES = Object.freeze(["value", "items", "keys"]);

/**
 * An Address position, as a field declaration states it.
 *
 * @typedef {object} AddressPosition
 * @property {string} type - The type an omitted `<type>` segment takes.
 * @property {readonly string[]} accepts - Every type the position accepts.
 * @property {"value"|"items"|"keys"} [holds] - Where the Addresses are.
 *   Defaults to `value`.
 */

/**
 * What a reduction could not do, for a caller to report.
 *
 * @typedef {object} AddressFinding
 * @property {string} key - The field, named as an author writes it.
 * @property {string} written - The authored value, so the caller can locate the
 *   finding at the line carrying it rather than at the key.
 * @property {string} message - One sentence, naming the fix.
 */

/**
 * The declarations that state an Address position.
 *
 * @param {readonly object[]} fields - A field declaration.
 * @returns {object[]} Only the fields carrying an `address` statement.
 */
export function addressFields(fields) {
    return (fields ?? []).filter((field) => Boolean(field?.address));
}

/**
 * Reduce every Address a compiled block holds to the Shortcode it names.
 *
 * The block is edited in place, as {@link
 * module:engine/system-block.mergeSystemData} edits it: what the caller holds is
 * the document being assembled, and a field the reduction cannot read is left
 * exactly as authored — the findings stop the build, so nothing ships either
 * way, and an untouched value is what a reader of the failing note sees.
 *
 * @param {object} emitted - The `system` block, already built.
 * @param {readonly object[]} fields - The type's field declaration.
 * @param {import("./address.mjs").AddressVocabulary & {package?: string}}
 *   vocabulary - The tree's vocabularies and the package the values are written
 *   in.
 * @returns {AddressFinding[]} Every value that could not be reduced.
 */
export function reduceAddressFields(emitted, fields, vocabulary = {}) {
    const findings = [];
    for (const field of addressFields(fields)) {
        const value = getFrontmatter(emitted, field.to, undefined);
        const reduced = reduceOne(value, field, vocabulary, findings);
        if (reduced !== undefined) setPath(emitted, field.to, reduced);
    }
    return findings;
}

/**
 * Reduce one field's value, by the shape its position holds.
 *
 * @param {unknown} value - The emitted value.
 * @param {object} field - The declaration.
 * @param {object} vocabulary - As {@link reduceAddressFields} takes it.
 * @param {AddressFinding[]} findings - Collected, in the order they are found.
 * @returns {unknown} The reduced value, or `undefined` to leave it alone.
 */
function reduceOne(value, field, vocabulary, findings) {
    const position = field.address;
    const defaults = positionDefaults(position, vocabulary);
    const shape = position.holds ?? "value";
    // Two keys, or two list entries, reducing to one emitted shortcode: the
    // Address each of them named, by the shortcode all of them land on.
    const seen = new Map();
    const read = (written) => readOne(written, field, defaults, seen, findings, shape);

    if (shape === "keys") {
        if (!isMapping(value)) return undefined;
        const out = {};
        for (const [written, standing] of Object.entries(value)) {
            const code = read(written);
            // The first standing stands, so the emitted map does not depend on
            // which key the reduction reached first.
            if (code !== undefined && !Object.hasOwn(out, code)) out[code] = standing;
        }
        return out;
    }

    if (shape === "items") {
        if (!Array.isArray(value)) return undefined;
        return value.map((written) => read(written) ?? written);
    }

    // One Address, and the two empties of a scalar field: `null` and an absent
    // key mean *names nothing*, and `""` is the same statement a property editor
    // writes. Neither is an Address, and neither is a mistake.
    if (value == null || value === "") return undefined;
    return read(value);
}

/**
 * Read one written Address, reporting what stops it.
 *
 * @param {unknown} written - The value as authored.
 * @param {object} field - The declaration.
 * @param {object} defaults - What {@link positionDefaults} returns.
 * @param {Map<string, {address: string, written: string}>} seen - The Addresses
 *   already reduced at this position, by emitted shortcode.
 * @param {AddressFinding[]} findings - Collected.
 * @param {string} shape - What the position holds.
 * @returns {string|undefined} The shortcode, or `undefined` when nothing is
 *   emitted for this value.
 */
function readOne(written, field, defaults, seen, findings, shape) {
    const key = String(field.name ?? field.to);
    const value = typeof written === "string" ? written : String(written ?? "");
    const report = (message) => void findings.push({ key, written: value, message });

    const tuple = parseAddress(value, defaults);
    if (tuple.reason) {
        report(unreadableMessage(key, value, tuple, defaults));
        return undefined;
    }
    if (!acceptsType(tuple, defaults.accepts)) {
        report(unacceptedMessage(key, value, defaults.accepts));
        return undefined;
    }

    const address = renderAddress(tuple);
    const code = tuple.shortcode;
    const first = seen.get(code);
    if (first && first.address !== address) {
        report(collidingMessage(key, first.address, address, code));
        return undefined;
    }
    if (first && shape === "keys") {
        report(repeatedMessage(key, address, first.written, value));
        return undefined;
    }
    if (!first) seen.set(code, { address, written: value });
    return code;
}

/**
 * The defaults and vocabularies a position reads its values against.
 *
 * **The position's own types belong in the vocabulary.** A position declares
 * what it names, so a tree that happens to carry no note of that type still
 * reads the value: without this, an affiliation naming a `seat` in a tree whose
 * places are all in a dependency stops parsing, and the refusal describes the
 * tree rather than the value.
 *
 * @param {AddressPosition} position - The declaration's `address` statement.
 * @param {object} vocabulary - As {@link reduceAddressFields} takes it.
 * @returns {object} The defaults {@link parseAddress} takes, plus the accepted
 *   set the acceptability step reads.
 */
function positionDefaults(position, vocabulary) {
    const accepts = position.accepts ?? [position.type];
    return {
        ...vocabulary,
        types: new Set([...(vocabulary.types ?? []), position.type, ...accepts]),
        // Derived from the type rather than taken from the block the value sits
        // in: an affiliation address names a SoHL Item, a place address names a
        // core document, and both are written inside the same `sohl:` block.
        system: systemOf(position.type, KNOWN_DOCUMENT_SUBTYPE_MAPS),
        type: position.type,
        accepts,
    };
}

/** Whether a value is an authored map rather than a list or a scalar. */
function isMapping(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Format a closed set for a message: `a, b or c`.
 *
 * @param {readonly unknown[]} values - The set.
 * @returns {string} The values, joined.
 */
function oneOf(values) {
    const all = [...values].map((value) => `\`${String(value)}\``);
    return all.length < 2 ?
            all.join("")
        :   `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}`;
}

/**
 * What a value the grammar cannot read is reported as.
 *
 * @param {string} key - The field, as an author writes it.
 * @param {string} written - The authored value.
 * @param {import("./address.mjs").AddressProblem} problem - Why it does not
 *   parse.
 * @param {object} defaults - What {@link positionDefaults} returns.
 * @returns {string} The message.
 */
function unreadableMessage(key, written, problem, defaults) {
    if (problem.reason === "no-content-index") {
        return (
            `\`${key}\` names package "${problem.package}", which is declared ` +
            `\`contentIndex: false\` — a Foundry dependency only, with no content index ` +
            `fetched for it, so nothing it publishes can be named here`
        );
    }
    if (problem.reason === "not-lowercase") {
        return (
            `\`${key}\` names \`${written}\`, whose package, system or type segment ` +
            `carries a capital — those segments are lowercase, an address having one ` +
            `spelling`
        );
    }
    return (
        `\`${key}\` must name ${oneOf(defaults.accepts)} — its \`shortcode\`, or that ` +
        `address qualified by type, by system and type, or by package, system and ` +
        `type — but reads \`${written}\``
    );
}

/**
 * What a value naming a type the position does not take is reported as.
 *
 * An **error**: the value is a real Address, so no default repairs it, and the
 * position cannot do anything with what it names.
 *
 * **The value states its own type, and the message leaves it there.** A value
 * omitting the `<type>` segment takes the position's default and is therefore
 * acceptable, so this fires only where the author wrote a type — and naming the
 * parsed one instead would name the `doc<type>` a system-bearing type is
 * redirected to under `none`, sending a reader to look for a segment nobody
 * wrote.
 *
 * @param {string} key - The field, as an author writes it.
 * @param {string} written - The authored value.
 * @param {readonly string[]} accepts - The types the position accepts.
 * @returns {string} The message.
 */
function unacceptedMessage(key, written, accepts) {
    return (
        `\`${key}\` names \`${written}\`, whose type this field does not accept — it ` +
        `accepts ${oneOf(accepts)}`
    );
}

/**
 * What two Addresses reducing to one shortcode are reported as.
 *
 * The message states that both values are valid, because they are: a shortcode
 * is unique within one package's address space and these are two packages'. The
 * fault is in what the emitted field can hold, which is why the finding names
 * both Addresses rather than one of them.
 *
 * @param {string} key - The field, as an author writes it.
 * @param {string} first - The Address already reduced.
 * @param {string} second - The Address colliding with it.
 * @param {string} code - The shortcode they share.
 * @returns {string} The message.
 */
function collidingMessage(key, first, second, code) {
    return (
        `\`${key}\` names both \`${first}\` and \`${second}\`, which share the shortcode ` +
        `"${code}" — both addresses are valid, and the compiled field is keyed by the ` +
        `shortcode alone, so it carries one of the two and the other is lost`
    );
}

/**
 * What one Address written twice at a keyed position is reported as.
 *
 * @param {string} key - The field, as an author writes it.
 * @param {string} address - The Address both keys name.
 * @param {string} first - How the first key was written.
 * @param {string} second - How the second was written.
 * @returns {string} The message.
 */
function repeatedMessage(key, address, first, second) {
    return (
        `\`${key}\` names \`${address}\` twice, as \`${first}\` and as \`${second}\` — the ` +
        `compiled field carries one value per target, so the second is lost`
    );
}
