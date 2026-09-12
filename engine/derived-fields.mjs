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
 * `system` keys a note may **never** author, because the *compiler* writes them
 * from the note itself.
 *
 * The third of three refusals that read alike and state different facts:
 *
 * | module | refuses a field | because |
 * | --- | --- | --- |
 * | `retired-fields.mjs` | a note may no longer declare | it has been withdrawn |
 * | `runtime-only-fields.mjs` | a note never could | the *document* writes it in play |
 * | this one | a note never could | the *compiler* writes it, from the note |
 *
 * The distinction between the last two is where the value comes from, and it
 * decides what an author is told. A runtime-only field has no compile-time
 * value at all, so the fix is to delete the key. A derived one **does** have a
 * compile-time value — it is already being written, from somewhere else in the
 * same note — so the fix is to move the content to wherever the compiler reads
 * it from, and the message has to say where that is.
 *
 * ## Why an authored value cannot be the source of anything
 *
 * The compiler writes the key unconditionally. An authored one is therefore at
 * best redundant, and at worst the wrong type in a shipped document: SoHL's
 * `docHtml` holds a `@UUID` pointing at the JournalEntry a note's prose
 * compiled into, so a note writing prose there ships a string where every
 * reader expects a pointer, with nothing to report it.
 *
 * Either way the text is not reaching a reader the way its author intended. It
 * was written as a description, and the field it was written into is not where
 * descriptions live — the note's own body is.
 *
 * ## Declared by the compiler, not named here
 *
 * A derived key is a fact about a *pass*, not about a schema: it exists because
 * that compiler chose to write it. So the list is a static on the compiler and
 * this module knows no key names, which is what lets a second system declare
 * its own — HM3 derives `description` from an anchored prose section exactly as
 * SoHL derives `docHtml` from the body.
 *
 * @module
 */

import { getFrontmatter } from "./frontmatter.mjs";
import { locateFrontmatterKey } from "./retired-fields.mjs";
import { SYSTEM_DATA_KEY, systemData } from "./system-block.mjs";

/**
 * What a note authoring a derived key is told, in one place.
 *
 * Shared by every caller that can meet one, so an author meets the same
 * sentence whichever runs first. It names the correction rather than only the
 * fault, because "delete this" is not the fix here: the text is wanted, and
 * there is somewhere it belongs.
 *
 * @param {string} key - The **whole key the note wrote**, from the region it
 *   sits in down to the field: `sohl.system.docHtml`. Composed by the caller,
 *   because only it knows where it found the value.
 * @param {string} from - Where the compiler reads the value from, completing
 *   "the compiler writes it from …". The declaration carries it.
 * @param {string} [file] - The note's path, named in the message. Omit it where
 *   the caller emits through a diagnostic, whose locator already starts the
 *   line — repeating it prints the path twice.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function derivedMessage(key, from, file) {
    return (
        `\`${key}:\` is written by the compiler, not authored` +
        (file ? ` — ${file}` : "") +
        `. It is derived from ${from}, and the compiler writes it ` +
        `unconditionally, so an authored value is overwritten or ships the ` +
        `wrong type. Move the text to ${from} and delete the key`
    );
}

/**
 * The derived keys a note actually writes, in declaration order.
 *
 * **Presence is the whole test**, as it is for a retired or a runtime-only
 * field: an authored empty string is as much a claim on the key as prose is,
 * and it is the same belief the message exists to correct. So the question is
 * whether the path resolves to anything at all, never whether the value is a
 * usable one.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {readonly {key: string, from: string}[]} [keys] - What the compiler
 *   derives. A pass that derives nothing passes.
 * @param {object} options - Options.
 * @param {string} options.block - The system block to look in.
 * @returns {{key: string, from: string}[]} The offending declarations.
 */
export function authoredDerivedKeys(fm, keys, { block } = {}) {
    if (!fm || typeof fm !== "object" || !block) return [];
    return derivedIn(systemData(fm, block), keys);
}

/**
 * The same question asked of a `system` block directly.
 *
 * A note's own block is reached through {@link authoredDerivedKeys}, but it is
 * not the only place an author writes one: an actor note's `items:` entries
 * carry a `system:` overlay that is deep-merged onto the template verbatim,
 * with no field declaration in the path at all. That overlay is a `system`
 * block by every meaning except where it sits, and a `docHtml` written there
 * ships exactly as one written on the item's own note.
 *
 * @param {Record<string, unknown>|null|undefined} data - The authored `system`
 *   data.
 * @param {readonly {key: string, from: string}[]} [keys] - What the compiler
 *   derives.
 * @returns {{key: string, from: string}[]} The offending declarations.
 */
export function derivedIn(data, keys) {
    if (!data || typeof data !== "object") return [];
    return (keys ?? []).filter(
        (entry) =>
            typeof entry?.key === "string" &&
            entry.key !== "" &&
            getFrontmatter(data, entry.key, undefined) !== undefined,
    );
}

/**
 * Refuse a note that authors any key its compiler derives.
 *
 * Refused rather than reported, for the reason its two siblings are: the note
 * is not compiled, so nothing it would have emitted reaches a pack, and each
 * caller counts the refused note and emits a located diagnostic — a refusal is
 * never a silent skip.
 *
 * The **first** offending key is thrown on. A note authoring two of them is one
 * mistake with one fix, and the build stops on this note either way.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter, or nothing when it
 *   could not be parsed.
 * @param {readonly {key: string, from: string}[]} [keys] - What the compiler
 *   derives.
 * @param {object} options - Options.
 * @param {string} options.block - The system block to look in.
 * @param {string} [options.file] - The note's path, named in the message. Omit
 *   it where the caller emits through a diagnostic, which puts the locator at
 *   the start of the line already.
 * @param {string} [options.absPath] - The note's file on disk, read only on the
 *   failing path to locate the offending line and column. The position rides on
 *   the thrown error as `position`, for a caller that emits a diagnostic.
 * @returns {void}
 * @throws {Error} When the note authors one.
 */
export function assertNoDerivedFields(fm, keys, { block, file, absPath } = {}) {
    const [entry] = authoredDerivedKeys(fm, keys, { block });
    if (!entry) return;

    const wrote = `${block}.${SYSTEM_DATA_KEY}.${entry.key}`;
    const err = new Error(`${derivedMessage(wrote, entry.from, file)}.`);
    // The **leaf** of the key, which is how the note writes it: a locator
    // handed a dotted path would find nothing. Deliberately not anchored at
    // column 1 — the key lives two levels in, under `<block>.system`.
    const leaf = entry.key.split(".").pop();
    const position = locateFrontmatterKey(absPath, /** @type {string} */ (leaf));
    if (position) err.position = position;
    throw err;
}
