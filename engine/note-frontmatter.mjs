/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import YAML from "yaml";

// The top-level vocabulary itself is declared beside the other two closed
// regions, so the lint, the formatter and the reference read one list.
export {
    NOTE_TOP_LEVEL_FIELDS,
    NOTE_TOP_LEVEL_KEYS,
    NOTE_TOP_LEVEL_KEY_SET,
} from "./note-vocabulary.mjs";

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
