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
 * **The severity is error**, because the ladder is what a being's `rank`
 * indexes into: a rung missing its `title` makes a standing that resolves to
 * nothing, and one missing its `description` ships a rung that says nothing on
 * a sheet or a page.
 *
 * Two things are deliberately **not** checked here, because something else
 * already does and a finding reported twice is a finding read once and fixed
 * neither time:
 *
 * - **that `ranks` is a list at all** — the field declares `kind: "list"`, and
 *   the shape check names it;
 * - **that `lore` resolves** — the reference checker reads every Address in the
 *   note, this one included.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The keys a rung may carry. */
const RUNG_KEYS = Object.freeze(["level", "title", "description", "lore"]);

/** The keys a rung must carry a value for. */
const REQUIRED_TEXT = Object.freeze(["title", "description"]);

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

    ranks.forEach((rung, index) => {
        const rungPath = [...base, index];
        // Named by its level where it states one, because a reader scanning a
        // ladder of fifteen rungs knows them by level and not by position.
        const which =
            integer(rung?.level) ? `rank ${rung.level}` : `rank ${index + 1} of the ladder`;

        if (!mapping(rung)) {
            at([rungPath, base], `${which} must be a map of level, title and description`);
            return;
        }

        for (const key of Object.keys(rung)) {
            if (RUNG_KEYS.includes(key)) continue;
            at(
                [[...rungPath, key], rungPath],
                `${which} has unknown key ${key}; a rung takes ${RUNG_KEYS.join(", ")}`,
            );
        }

        if (!integer(rung.level)) {
            at(
                [[...rungPath, "level"], rungPath],
                rung.level === undefined || rung.level === null ?
                    `${which} needs a level — the rung's position on this body's own ladder`
                :   `${which} has a level that is not a whole number`,
            );
        }

        for (const key of REQUIRED_TEXT) {
            if (stated(rung[key])) continue;
            at(
                [[...rungPath, key], rungPath],
                `${which} needs a ${key}: ` +
                    (key === "title" ? "what the standing is called" : "what the standing is"),
            );
        }
    });

    return findings;
}
