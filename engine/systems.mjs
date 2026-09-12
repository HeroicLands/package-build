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
 * The closed registry of system ids, and the `none` that stands for no system
 * at all.
 *
 * A canonical address carries the system in a fixed position —
 * `harnadventures-none-being-grod` — so "which systems exist" is a question the
 * address grammar asks on every note, and the issue's answer is that it comes
 * from a **registry rather than from a hardcoded set**: known system ids are
 * declared here, once, an unknown value is an error, and _adding a system is a
 * data change_. Before this module the same fact was spelled in as many places
 * as needed it — a `NO_SYSTEM` constant in the content index, a `map.system`
 * per document-subtype map, a system-keyed table per compiler — none of which
 * could refuse a value none of the others had heard of.
 *
 * **`none` is a word, deliberately.** It is not a YAML null (`null`, `~`, or an
 * empty value), because those spell "nobody filled this in", and a note that
 * belongs to no system has been answered rather than skipped — the distinction
 * the whole address grammar rests on, since a null cannot occupy a segment.
 * And it is not `any`, which reads as a wildcard: a `place` does not compile
 * into every system's document, it compiles into a Foundry core document that
 * belongs to none of them.
 *
 * **A leaf, so that anything may read it.** The only import is the address
 * charset, itself a leaf with no local imports, so this module can be named by
 * the configuration loader, by a compiler, and by a lint without closing a
 * cycle around any of them. In particular the ids are *declared* here rather
 * than derived from `KNOWN_DOCUMENT_SUBTYPE_MAPS` — deriving them would drag
 * `sohl/` and `hm3/` behind every import of this file, for a list of two
 * words. `tests/systems.test.ts` holds the two in step instead, which is where
 * the agreement between a registry and its implementations belongs.
 *
 * @module
 */

// The one charset, read rather than restated — a system id is an address
// segment like any other, and a second spelling of the pattern is how the
// disagreements in #202/#203 happened.
import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "./address-charset.mjs";

/**
 * The `<system>` segment of a note that belongs to no system.
 *
 * Most notes are that: a `doc`, a `place`, a `macro` or a map compiles into a
 * JournalEntry, a Scene or a Macro, which Foundry defines and no game system
 * does. `none` is the format's word for it, in the address and in the content
 * index alike, so the two say "no system" the same way.
 *
 * @type {string}
 */
export const NO_SYSTEM = "none";

/**
 * Every game system this toolchain compiles for.
 *
 * The registry, and the only place the list is written down. Adding a system
 * is an edit to this set plus the map and compilers that make it real — a data
 * change, not a search for every place a name was spelled.
 *
 * `none` is **not** a member: it marks the absence of a system, and a caller
 * asking "is this a system" and a caller asking "is this a well-formed
 * segment" want different answers. See {@link isSystemId} and
 * {@link isSystemSegment}.
 *
 * @type {ReadonlySet<string>}
 */
export const SYSTEM_IDS = Object.freeze(new Set(["sohl", "hm3"]));

/**
 * Everything the `<system>` segment of an address may say.
 *
 * The systems, plus {@link NO_SYSTEM}. Derived from the registry rather than
 * listed again, so the two cannot drift.
 *
 * @type {ReadonlySet<string>}
 */
export const SYSTEM_SEGMENTS = Object.freeze(new Set([...SYSTEM_IDS, NO_SYSTEM]));

/**
 * Whether a value names a game system this toolchain knows.
 *
 * `none` is rejected: it is a real answer to "which system", but it is not a
 * system, and a pack, a document-subtype map or a compiler table keyed by it
 * would be keyed by nothing.
 *
 * @param {unknown} value - The candidate id.
 * @returns {boolean} `true` when {@link SYSTEM_IDS} declares it.
 */
export function isSystemId(value) {
    return typeof value === "string" && SYSTEM_IDS.has(value);
}

/**
 * Whether a value is something the `<system>` segment may hold.
 *
 * The predicate an address parser wants: a declared system, or `none`.
 *
 * @param {unknown} value - The candidate segment.
 * @returns {boolean} `true` when {@link SYSTEM_SEGMENTS} declares it.
 */
export function isSystemSegment(value) {
    return typeof value === "string" && SYSTEM_SEGMENTS.has(value);
}

/**
 * What a caller writing an unknown system is told.
 *
 * Separate from {@link assertSystemSegment} so that a pass collecting findings
 * can report the same sentence it would have thrown — the message is the part
 * worth sharing, and a reporter that had to invent its own wording is how two
 * halves of a build come to explain one rule two ways.
 *
 * The nullish case is called out by name because it is the likely mistake and
 * the least legible failure: a YAML `null`, a `~`, or a key written with no
 * value at all reaches here as `undefined`, and "expected one of sohl, hm3,
 * none" would leave a reader hunting for the value they cannot see.
 *
 * @param {unknown} value - The offending value.
 * @param {string} [where] - What carried it, for the message — a note path, a
 *   configuration key, an address.
 * @returns {string} The message, with no trailing period, in the style of the
 *   other vocabulary messages.
 */
export function unknownSystemMessage(value, where = "the system segment") {
    const known = [...SYSTEM_SEGMENTS].map((id) => `\`${id}\``).join(", ");
    if (value == null || value === "") {
        return (
            `${where} names no system — an absent value is not how "no system" ` +
            `is written. A note that belongs to no system says so, with ` +
            `\`${NO_SYSTEM}\`: the segment is positional, so a null cannot ` +
            `occupy it, and "answered as none" and "nobody filled this in" ` +
            `have to stay distinguishable. Known: ${known}`
        );
    }
    return (
        `${where} names \`${String(value)}\`, which is not a known system. ` +
        `Known systems come from a closed registry, so adding one is a data ` +
        `change rather than a value that starts working: ${known}. \`any\` is ` +
        `not among them either — it reads as a wildcard, and a note outside ` +
        `every system compiles into a core document rather than into all of them`
    );
}

/**
 * Refuse a value the `<system>` segment may not hold.
 *
 * Throws rather than returning a finding, matching the nearest neighbour —
 * `assertVocabularyCharset` in `engine/note-vocabulary.mjs`, and the
 * `configFromData` validators — because every caller of this is validating a
 * declaration rather than surveying content. A note's bad value belongs in a
 * report; a build asking to route, address or compile an undeclared system has
 * nowhere to continue to.
 *
 * @param {unknown} value - The candidate segment.
 * @param {string} [where] - What carried it, for the message.
 * @returns {string} The value, unchanged, so a caller may validate inline.
 * @throws {Error} Naming the value and the whole known vocabulary.
 */
export function assertSystemSegment(value, where = "the system segment") {
    if (!isSystemSegment(value)) throw new Error(`${unknownSystemMessage(value, where)}.`);
    return /** @type {string} */ (value);
}

/**
 * Refuse a registry declaring an id that could not be an address segment.
 *
 * Run over {@link SYSTEM_SEGMENTS} as this module loads, so a declaration that
 * breaks the charset cannot be imported, let alone shipped. Same reasoning as
 * `assertVocabularyCharset`: a bad value in one note is one author's mistake,
 * while a bad *declaration* puts an unreadable segment into every address that
 * names the system.
 *
 * @param {Iterable<string>} segments - The declared ids, including `none`.
 * @param {string} [where] - What declares them, for the message.
 * @throws {Error} Naming every offending id at once — a reader fixing a list
 *   wants the whole list.
 */
export function assertSystemCharset(segments, where = "the system registry") {
    const bad = [...(segments ?? [])].filter((id) => !isAddressSegment(id));
    if (!bad.length) return;
    throw new Error(
        `${where} declares ${bad.map((id) => `"${id}"`).join(", ")}, which ` +
            `${bad.length === 1 ? "is" : "are"} not ${ADDRESS_SEGMENT_PATTERN.source}. ` +
            `A system id is a segment of every address that names it, and the ` +
            `hyphen separates segments rather than occurring inside one.`,
    );
}

assertSystemCharset(SYSTEM_SEGMENTS);
