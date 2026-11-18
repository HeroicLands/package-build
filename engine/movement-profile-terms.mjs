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
/** Authored movement profile declaration. @module */
/** Media for fixed movement profiles. */
export const MOVEMENT_PROFILE_MEDIA = Object.freeze([
    "none",
    "terrestrial",
    "aquatic",
    "aerial",
    "burrowing",
    "astral",
]);
/** Declaration shared by being and vehicle movement profiles. */
export const MOVEMENT_PROFILE_FIELD = Object.freeze({
    name: "movementProfiles",
    kind: "list",
    shape: "A list of movement profiles.",
    describe:
        "Movement profiles; each has a medium and optional speeds. Repeated media are allowed. No speed or active medium is inferred.",
    entries: {
        kind: "map",
        shape: "A movement profile.",
        fields: [
            {
                name: "medium",
                kind: "string",
                shape: "A movement medium.",
                required: true,
                describe: `Required: ${MOVEMENT_PROFILE_MEDIA.map((value) => `\`${value}\``).join(", ")}.`,
            },
            {
                name: "feetPerRound",
                kind: "number",
                shape: "Whole feet per round.",
                describe:
                    "Optional finite nonnegative whole feet per six-second round; ten rounds are one minute.",
            },
            {
                name: "leaguesPerWatch",
                kind: "number",
                shape: "Leagues per watch.",
                describe:
                    "Optional finite nonnegative leagues per four-hour watch, including fractions. One league is three nautical miles, or 5,556 meters.",
            },
        ],
    },
});
