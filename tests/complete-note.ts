/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The keys every note owes, supplied so a fixture can be about something
 * else.**
 *
 * Most of the suite builds the smallest note that exercises one rule. Every one
 * of those notes also owes a name, a summary and a tag list, and a fixture that
 * states them inline would be answering a question it is not asking — and would
 * have to be revisited the next time the contract moves.
 *
 * So the defaults are **derived** from
 * {@link module:engine/note-vocabulary.requiredNoteFields}: a key the
 * declaration gains appears here, in every fixture, with no second list to
 * edit. A fixture that cares about one of these keys states it, and what it
 * states wins.
 *
 * **Missing keys are appended rather than merged in front**, so a fixture's own
 * keys keep the lines they were written on and a test asserting a position
 * still names it.
 */

import YAML from "yaml";

import { requiredNoteFields, subTypes } from "../engine/note-vocabulary.mjs";

/** A plain frontmatter map. */
type Frontmatter = Record<string, unknown>;

/** What each requirement is satisfied with, where a fixture states nothing. */
function fill(name: string, type: string): unknown {
    switch (name) {
        case "shortcode":
            return "example";
        case "name":
            return { full: "Example", aliases: [] };
        case "description":
            return "A summary.";
        case "tags":
            return [];
        case "subType": {
            // The type's own first declared genre, or any segment where the
            // specification leaves the values open.
            const declared = subTypes(type);
            return declared?.[0] ?? "generic";
        }
        default:
            return "";
    }
}

/**
 * One fixture's frontmatter, with every required key it does not state.
 *
 * @param fm - The frontmatter a test wrote, including its `type`.
 * @returns The same map, plus the keys the note format requires.
 */
export function completeNote(fm: Frontmatter): Frontmatter {
    const type = String(fm.type ?? "");
    const added: Frontmatter = {};
    for (const field of requiredNoteFields(type)) {
        // An explicit `undefined` is how a fixture spells "I did not write
        // this", so it is filled like an absent key. A fixture meaning to omit
        // a required key states `null`, which the contract reports.
        if (fm[field.name] !== undefined) continue;
        added[field.name] = fill(field.name, type);
    }
    return { ...fm, ...added };
}

/**
 * One fixture's frontmatter *as text*, with every required key it does not
 * state appended.
 *
 * For the fixtures that author YAML rather than an object, so a test asserting
 * a line or a column still names the line it wrote. The appended keys land
 * after everything the fixture wrote, for the same reason.
 *
 * @param frontmatter - The YAML between the `---` fences.
 * @returns The same YAML, plus a line per required key it omits.
 */
export function completeFrontmatter(frontmatter: string): string {
    const authored = (YAML.parse(frontmatter) ?? {}) as Frontmatter;
    const completed = completeNote(authored);
    const added = Object.keys(completed).filter((key) => !Object.hasOwn(authored, key));
    if (!added.length) return frontmatter;
    const lines = added.map((key) =>
        YAML.stringify({ [key]: completed[key] }, { lineWidth: 0 }).trimEnd(),
    );
    return [frontmatter.trimEnd(), ...lines].join("\n");
}
