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
 * **Where HM3 records the template priority** — one statement, read by both of
 * this system's passes (#283).
 *
 * `data.templatePriority` is the shared fact that a note is a *starting
 * template*, and the specification states it as a row every type maps:
 * `system.templatePriority` in SoHL, `flags.hm3.templatePriority` here. It lands
 * in flags because HM3's data model declares no field for it, and an undeclared
 * `system` key is discarded at load without a word.
 *
 * It was written by the Actor pass alone. The Item pass emitted only whatever
 * `flags` the note itself authored, so an item note declaring the priority
 * compiled into a SoHL item that knew it was a template and an HM3 item that did
 * not — silently on both sides of the build, since an omitted flag is exactly how
 * this system says *not a template*, making a lost priority and a deliberate one
 * the same output. Nothing could report it either: the emitted-`system` check
 * compares against a declared schema, and a flag is declared by nothing.
 *
 * So the rule lives here rather than in either pass, and both call it. Two
 * copies of it would be two chances to diverge again, which is the failure this
 * module exists to close.
 *
 * @module
 */

import log from "loglevel";

import { resolveName, statedTemplatePriority } from "../engine/helpers.mjs";
import { blockProperty } from "../engine/system-block.mjs";

/**
 * A document's `flags`: whatever the note authors, plus this system's template
 * priority.
 *
 * A note that is not a template — or states nothing — writes nothing, rather
 * than a `null` nothing reads.
 *
 * **Read through the shared resolver, not a field declaration** (#266). A
 * `FieldSpec`'s shared source is a single position, and this value has five:
 * `data:`, this block, the top level, and the retiring `archetype` spelling in
 * the latter two. The resolver is the single implementation of what a note said,
 * so the two systems cannot disagree about it. It is read against **this**
 * block: the `sohl:` block is not a source for an HM3 document, so a tree that
 * still states the priority there (`harn-ensemble`, on 2,502 notes) writes no
 * HM3 flag until it sweeps to `data:`.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - This pass's system block.
 * @returns {object} The flags to emit.
 */
export function templateFlags(fm, block) {
    const authored = blockProperty(fm, block, "flags", {});
    const stated = statedTemplatePriority(fm, resolveName(fm), { block });
    if (stated == null) return authored;
    // Coerced, as the field declaration this replaced coerced it: a note may
    // state the priority as a YAML string, and `"3"` is a priority.
    const value = Number(stated);
    if (!Number.isFinite(value)) {
        log.warn(
            `${resolveName(fm)}: template priority ${JSON.stringify(stated)} is ` +
                `not a number; no template flag written.`,
        );
        return authored;
    }
    return {
        ...authored,
        [block]: {
            .../** @type {Record<string, unknown>} */ (authored)[block],
            templatePriority: value,
        },
    };
}
