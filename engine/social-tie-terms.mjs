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

/** Relationships a being states from its own point of view. */
export const SOCIAL_TIES = Object.freeze([
    { term: "patron", meaning: "Supports the subject from greater power, wealth, or status." },
    { term: "friend", meaning: "Supports the subject out of goodwill." },
    { term: "dependent", meaning: "Relies on the subject's support or protection." },
    { term: "acquaintance", meaning: "Knows the subject without a strong disposition." },
    { term: "rival", meaning: "Opposes the subject without implacable hostility." },
    { term: "nemesis", meaning: "Opposes the subject personally and implacably." },
]);

/** The note types a being can name as a social tie. */
export const SOCIAL_TIE_TARGET_TYPES = Object.freeze(["being", "affiliation"]);
