/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The note type a standing is held in.
 *
 * A standing is always held in a body: the entry is keyed by that body's
 * Address, which is what lets the rung and the post be checked against what
 * the body itself declares.
 */
export const STANDING_BODY_TYPES = Object.freeze(["affiliation"]);

/**
 * The two keys one standing carries.
 *
 * `rank` is the level on the body's own `governance.ranks` ladder, as a number.
 * `office` is a key of its `governance.offices` map, as a string. Both are
 * optional — a membership with neither is the ordinary shape.
 */
export const STANDING_KEYS = Object.freeze(["rank", "office"]);
