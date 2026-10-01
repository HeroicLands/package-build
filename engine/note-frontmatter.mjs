/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import YAML from "yaml";

/** The complete ordered top-level vocabulary for addressed content notes. */
export const NOTE_TOP_LEVEL_KEYS = Object.freeze([
    "shortcode",
    "name",
    "type",
    "subType",
    "description",
    "tags",
    "data",
    "hm3",
    "sohl",
    "dnd5e",
]);

/** Membership test for the top-level vocabulary. */
export const NOTE_TOP_LEVEL_KEY_SET = new Set(NOTE_TOP_LEVEL_KEYS);

/** The name properties every note accepts, in display order. */
export const NOTE_NAME_KEYS = Object.freeze(["full", "aliases"]);

/** Additional name components accepted by an individual character. */
export const CHARACTER_NAME_KEYS = Object.freeze(["given", "clan"]);

/** Return authored keys from an opening YAML frontmatter map. */
export function authoredNoteKeys(markdown) {
    const source = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (source === undefined) return [];
    const document = YAML.parseDocument(source);
    if (document.errors.length || !YAML.isMap(document.contents)) return [];
    return document.contents.items.map((pair) => String(pair.key?.value));
}
