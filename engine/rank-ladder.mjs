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
 * What a **rung** of an affiliation's rank ladder has to state.
 *
 * A rung is a map of `level`, `title` and `description`, all three required,
 * plus an optional `lore` Address for a standing that needs more said about it
 * than a description can hold. Those three keys together are a complete
 * statement of a rung; nothing further is needed for a ladder to be correct.
 *
 * **A level belongs to one rung.** The ladder is read by level, so two rungs
 * claiming one level leave a member's `rank` answering to whichever is written
 * first — a standing whose name changes when two lines swap places. A body that
 * confers two titles at one standing writes them as one rung, or gives each its
 * own level.
 *
 * **The severity is error**, because the ladder is what a being's `rank`
 * indexes into: a rung missing its `title` makes a standing that resolves to
 * nothing, and one missing its `description` ships a rung that says nothing on
 * a sheet or a page.
 *
 * What a rung *holds* is declared in {@link RUNG_FIELDS} and checked by the
 * inner-key check: that `ranks` is a list of maps, that a rung carries no key
 * beyond the four, that `level`, `title` and `description` are stated, and that
 * each is the kind it is declared — a `level` a whole number. What is checked
 * here is what only a ladder can say — that a level is held by one rung — and nothing is
 * reported twice, because a finding reported twice is a finding read once and
 * fixed neither time. That `lore` resolves is the reference checker's.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";

import { RUNG_FIELDS } from "./standing-terms.mjs";

export { RUNG_FIELDS };

/** Every affiliation has an ordinary standing that a being can name as rank 1. */
export function checkAffiliationRankFloor(note) {
    if (note.fm?.type !== "affiliation") return [];
    const governance = note.fm?.data?.governance;
    const ranks = governance?.ranks;
    // A non-list already has a shape finding. Do not repeat it here.
    if (ranks !== undefined && ranks !== null && !Array.isArray(ranks)) return [];
    if (
        Array.isArray(ranks) &&
        ranks.some((rung) => integer(rung?.level) && Number(rung.level) === 1)
    )
        return [];

    const path = Array.isArray(ranks) ? ["data", "governance", "ranks"] : ["data", "governance"];
    const atRankOrGovernance = positionOfFrontmatterPath(note.raw ?? "", path, { key: true });
    const position =
        atRankOrGovernance.line !== undefined ?
            atRankOrGovernance
        :   positionOfFrontmatterPath(note.raw ?? "", ["data"], { key: true });
    return [
        {
            file: note.file,
            ...position,
            severity: "error",
            message:
                !Array.isArray(ranks) || ranks.length === 0 ?
                    "affiliation needs data.governance.ranks with a level 1 standing"
                :   "affiliation data.governance.ranks needs a level 1 standing",
        },
    ];
}

/**
 * Whether a value is a YAML mapping rather than a list or a scalar.
 *
 * @param {unknown} value - What was authored.
 * @returns {boolean} True for a mapping.
 */
function mapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Whether a value states a whole number.
 *
 * A quoted `"3"` counts, because YAML hands a quoted scalar back as a string
 * and the ladder reads it as a number either way — `3.5` does not, because a
 * rung sits on a rung and there is nothing between two of them.
 *
 * @param {unknown} value - The authored `level`.
 * @returns {boolean} True when it is an integer.
 */
function integer(value) {
    if (typeof value === "number") return Number.isInteger(value);
    if (typeof value !== "string" || value.trim() === "") return false;
    return Number.isInteger(Number(value));
}

/**
 * Whether a value states something rather than nothing.
 *
 * @param {unknown} value - The authored `title` or `description`.
 * @returns {boolean} True for a non-empty string.
 */
function stated(value) {
    return typeof value === "string" && value.trim() !== "";
}

/**
 * Check one affiliation's `data.governance.ranks` against the rung contract.
 *
 * Each problem is its own finding, so a rung missing all three of its required
 * keys reports three rather than the first: a reader fixing a ladder wants the
 * whole of it in one pass.
 *
 * **A finding is located by the node it is about**, through the frontmatter's
 * own YAML tree — a present-but-wrong value points at that value, and an absent
 * key points at the rung that should have carried it, since a key that was
 * never written has no position of its own. Where even the rung cannot be
 * located the position is dropped rather than guessed, and the finding names
 * the file alone.
 *
 * @param {object} note - The note being checked.
 * @param {string} note.file - Its path, as a diagnostic spells it.
 * @param {string} [note.raw] - Its source, for the position.
 * @param {object} [note.fm] - Its parsed frontmatter.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: string, message: string}>} The findings, in authored order.
 */
export function checkRankLadder(note) {
    const ranks = note.fm?.data?.governance?.ranks;
    // Absent is the ordinary case: most bodies confer no ranks at all. A value
    // that is not a list is the shape check's finding, not this one's.
    if (!Array.isArray(ranks)) return [];

    const findings = [];
    const base = ["data", "governance", "ranks"];

    /**
     * One finding, located at the first of the given paths that resolves.
     *
     * @param {Array<Array<string|number>>} paths - Candidates, most specific
     *   first.
     * @param {string} message - What is wrong.
     * @returns {void}
     */
    const at = (paths, message) => {
        let position = {};
        for (const path of paths) {
            position = positionOfFrontmatterPath(note.raw ?? "", path);
            if (position.line !== undefined) break;
        }
        findings.push({ file: note.file, ...position, severity: "error", message });
    };

    // Level → how the rung holding it is named, so a repeat can say which rung
    // already holds the level rather than only that something does.
    const held = new Map();

    ranks.forEach((rung, index) => {
        const rungPath = [...base, index];
        // Named by its level where it states one, because a reader scanning a
        // ladder of fifteen rungs knows them by level and not by position.
        const which =
            integer(rung?.level) ? `rank ${rung.level}` : `rank ${index + 1} of the ladder`;

        // Not a map, an undeclared key, and an absent or mistyped `level`,
        // `title` or `description` are the inner-key check's findings.
        if (!mapping(rung)) return;

        // A level that is not a whole number is the inner-key check's finding.
        if (integer(rung.level)) {
            // A level belongs to one rung. Two rungs claiming it leave a
            // member's `rank` answering to the one written first, so the
            // ladder's own order decides what the standing is called and
            // moving two lines renames it. Reported on the second rung,
            // naming the first, because the first is the one a reader has to
            // find to tell the two apart.
            const level = Number(rung.level);
            const named = stated(rung.title) ? JSON.stringify(rung.title) : which;
            const first = held.get(level);
            if (first === undefined) held.set(level, named);
            else
                at(
                    [[...rungPath, "level"], rungPath],
                    `rank ${level} is declared twice, as ${first} and ${named}; a level ` +
                        `is a rung's identity and a member's rank indexes into it, so ` +
                        `each rung states its own`,
                );
        }
    });

    return findings;
}
