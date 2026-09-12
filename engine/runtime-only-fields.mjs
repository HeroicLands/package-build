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
 * Schema fields a note may **never** author, because the document writes them
 * in play.
 *
 * `retired-fields.mjs` refuses a field a note may no longer declare; this
 * refuses one it never could. The two read alike deliberately — a note says one
 * thing, the build does another, and nothing says so — but they are different
 * facts, and only one of them is ever swept: a retired field goes away, while
 * `onsetDate` is a permanent part of `affliction`'s schema that simply is not
 * content.
 *
 * ## What was going wrong
 *
 * A DataModel declares plenty of fields a *compiled* document has no business
 * carrying. SoHL's timed phases are the case that prompted this: each phase of
 * an `affliction` or a `trauma` stores a `{…DurationFormula, …DurationBase,
 * …Date}` triplet, and the third of them is instance state, crystallized when
 * the phase fires. World time does not exist while content is compiled, and `0`
 * is itself a valid world time — which is why the field is nullable rather than
 * sentinelled, and why no default could stand in for the missing value.
 *
 * Nothing stopped a note writing one, and the build emitted it. Three checks
 * each declined to catch it, every one of them for its own correct reason:
 *
 * - {@link module:engine/system-block.unknownBlockKeys} inspects the **top
 *   level** of a system block and deliberately never descends into `system:`,
 *   which is a passthrough for the system's own vocabulary.
 * - {@link module:engine/system-block.mergeSystemData} writes every authored
 *   `system.*` path that no declared field claims — and no field claimed
 *   `contractDate`, so it passed through verbatim.
 * - The schema check's fatal direction is *undeclared* — emitting a key the
 *   system does not define. `contractDate` **is** in the schema, so as far as
 *   that check can see the emitted key is legitimate.
 *
 * The gap was that no rule expressed "declared by the system, but never
 * authorable". This module is that rule, and it is **declarative**: it knows no
 * field names, only the {@link module:engine/field-spec.FieldSpec} property
 * `runtimeOnly`, so it holds for any future runtime-only field of any system
 * without being taught about it.
 *
 * ## Why a refusal rather than a drop
 *
 * Declaring the field claims its path, so the passthrough would leave it alone
 * and the authored value would simply vanish — which is the silent-disagreement
 * failure this package spends its time removing. And the consequence of getting
 * it wrong is not a missing value but a shipped one: a compiled document
 * carrying a world-time stamp is one world's play state, installed into every
 * world that loads the pack.
 *
 * @module
 */

import { runtimeOnlyFields } from "./field-spec.mjs";
import { getFrontmatter } from "./frontmatter.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";
import { SYSTEM_DATA_KEY, systemData } from "./system-block.mjs";

/**
 * What a note authoring a runtime-only field is told, in one place.
 *
 * Shared by every caller that can meet one, because an author meets whichever
 * runs first and they should read the same. It says what the field holds and
 * that deleting the key is the whole fix — there is no value to correct, which
 * is what separates this from an out-of-range one.
 *
 * The reason comes from the declaration rather than from here: this module
 * knows no field names, and a message written per field would be a second
 * statement of the fact the declaration already carries.
 *
 * @param {string} key - The **whole key the note wrote**, from the region it
 *   sits in down to the field: `sohl.system.onsetDate` on the item's own note,
 *   `sohl.items[2].system.contractDate` on an actor's embedded entry. Composed
 *   by the caller, because only it knows where it found the value — and a
 *   message naming the leaf alone leaves an author a note to search.
 * @param {import("./field-spec.mjs").FieldSpec} field - The declaration, which
 *   carries the reason.
 * @param {string} [file] - The note's path, named in the message. Omit it where
 *   the caller emits through a diagnostic, whose locator already starts the
 *   line — repeating it prints the path twice.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function runtimeOnlyMessage(key, field, file) {
    return (
        `\`${key}:\` is runtime state, not ` +
        `content — delete it` +
        (file ? ` — ${file}` : "") +
        `. It holds ${field.runtimeOnly}, so no value for it exists at compile ` +
        `time, and a compiled document carrying one ships a fact about a world ` +
        `the pack has never been loaded into. The key is left out of the ` +
        `document entirely, so the DataModel's own initial value stands`
    );
}

/**
 * The runtime-only fields a note actually writes, in declaration order.
 *
 * **Presence is the whole test**, as it is for every retired field: an authored
 * `onsetDate: null` is as much a claim about play state as a number is, and it
 * is exactly the belief the message exists to correct. So the question is
 * whether the path resolves to anything at all, never whether the value is a
 * usable one.
 *
 * Only `<block>.system.<to>` is searched, because it is the only position a
 * runtime-only field is reachable at. Such a declaration carries no `name`, so
 * it has neither a legacy in-block key nor a shared top-level source — and a
 * bare `<block>.onsetDate` is an unrecognized block key, which
 * {@link module:engine/system-block.unknownBlockKeys} already reports as an
 * error naming the note and the line.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {readonly import("./field-spec.mjs").FieldSpec[]} [fields] - The
 *   type's field declaration.
 * @param {object} options - Options.
 * @param {string} options.block - The system block to look in.
 * @returns {import("./field-spec.mjs").FieldSpec[]} The offending declarations.
 */
export function authoredRuntimeOnlyFields(fm, fields, { block } = {}) {
    if (!fm || typeof fm !== "object" || !block) return [];
    return runtimeOnlyIn(systemData(fm, block), fields);
}

/**
 * The same question asked of a `system` block directly.
 *
 * A note's own block is reached through {@link authoredRuntimeOnlyFields}, but
 * it is not the only place an author writes one: an actor note's `items:`
 * entries carry a `system:` overlay that is deep-merged onto the template
 * verbatim, with no field declaration in the path at all. That overlay is a
 * `system` block by every meaning except where it sits, and a `contractDate`
 * written there ships exactly as one written on the trauma's own note.
 *
 * @param {Record<string, unknown>|null|undefined} data - The authored `system`
 *   data.
 * @param {readonly import("./field-spec.mjs").FieldSpec[]} [fields] - The
 *   type's field declaration.
 * @returns {import("./field-spec.mjs").FieldSpec[]} The offending declarations.
 */
export function runtimeOnlyIn(data, fields) {
    if (!data || typeof data !== "object") return [];
    return runtimeOnlyFields(fields).filter(
        (field) =>
            typeof field.to === "string" &&
            field.to !== "" &&
            getFrontmatter(data, field.to, undefined) !== undefined,
    );
}

/**
 * Refuse a note that authors any of its type's runtime-only fields.
 *
 * Refused rather than reported: the note is not compiled, so nothing it would
 * have emitted reaches a pack. What that costs is the caller's to decide — each
 * of them counts the refused note and emits a located diagnostic, so a refusal
 * is never a silent skip.
 *
 * The **first** offending field is thrown on. A note authoring a whole phase
 * triplet would otherwise produce three findings that are one mistake, and the
 * build stops on this note either way; the fix for the first is the fix for all
 * of them.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter, or nothing when it
 *   could not be parsed.
 * @param {readonly import("./field-spec.mjs").FieldSpec[]} [fields] - The
 *   type's field declaration. A type that declares none — or declares no
 *   runtime-only field — passes.
 * @param {object} options - Options.
 * @param {string} options.block - The system block to look in.
 * @param {string} [options.file] - The note's path, named in the message. Omit
 *   it where the caller emits through a diagnostic, which puts the locator at
 *   the start of the line already — repeating it prints the path twice.
 * @param {string} [options.absPath] - The note's file on disk, read only on the
 *   failing path to locate the offending line and column. The position rides on
 *   the thrown error as `position`, for a caller that emits a diagnostic.
 * @returns {void}
 * @throws {Error} When the note authors one.
 */
export function assertNoRuntimeOnlyFields(fm, fields, { block, file, absPath } = {}) {
    const [field] = authoredRuntimeOnlyFields(fm, fields, { block });
    if (!field) return;

    const key = `${block}.${SYSTEM_DATA_KEY}.${field.to}`;
    const err = new Error(`${runtimeOnlyMessage(key, field, file)}.`);
    // The **leaf** of the destination path, which is the key as the note writes
    // it: `to` is dotted for a nested field, and a locator handed
    // `charges.value` would find nothing. Deliberately not anchored at column 1
    // — the key lives two levels in, under `<block>.system`.
    const leaf = /** @type {string} */ (field.to).split(".").pop();
    const position = locateFrontmatterKey(absPath, /** @type {string} */ (leaf));
    if (position) err.position = position;
    throw err;
}
