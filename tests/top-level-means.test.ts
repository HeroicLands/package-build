/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every field that declares `topLevelMeans` renders into one line of
 * `engine/field-reference.mjs`'s authoring reference: a bold lead-in the
 * frame supplies, followed by the field's own sentence. The frame does not
 * force that sentence into a clause fragment, so the one property a
 * declaration must hold is that it reads as one or more complete,
 * well-formed sentences on its own — not that it is accurate, which a shape
 * check cannot see.
 *
 * The surface is walked rather than copied: every field list this repository
 * registers, flattened, filtered to the ones declaring `topLevelMeans`. A
 * hand-kept second list of "the fields that declare this" would be one more
 * thing to drift from the registries themselves.
 */

import { describe, it, expect } from "vitest";

// Source is imported by relative path: this suite is self-contained and
// declares no alias tree (see `suite-is-self-contained.test.ts`).
import { topLevelExemptionLine } from "../engine/field-reference.mjs";
import { authoredFields } from "../engine/field-spec.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";
import { ACTOR_FIELDS, CHARACTER_FIELDS } from "../hm3/actors.mjs";

/** Every field list this repository registers, across both systems. */
const FIELD_LISTS: readonly (readonly unknown[])[] = [
    ...Object.values(ITEM_FIELDS),
    ...Object.values(HM3_ITEM_FIELDS),
    ACTOR_FIELDS,
    CHARACTER_FIELDS,
];

/** Every declared field, across every registry, that declares `topLevelMeans`. */
const fieldsWithTopLevelMeans = FIELD_LISTS.flatMap((fields) =>
    authoredFields(fields as never).filter(
        (field: { topLevelMeans?: string }) => field.topLevelMeans !== undefined,
    ),
) as { name: string; topLevelMeans: string }[];

/** A string split at each sentence boundary it already carries. */
function sentenceFragments(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/);
}

describe("every topLevelMeans composes into one or more grammatical sentences", () => {
    it("finds at least one declaration to check", () => {
        // Guards the guard: a registry that stopped being walked here would
        // otherwise leave this suite vacuously green.
        expect(fieldsWithTopLevelMeans.length).toBeGreaterThan(0);
    });

    it.each(fieldsWithTopLevelMeans.map((field) => [field.name, field] as const))(
        "%s reads as a sentence, not a clause fragment",
        (_name, field) => {
            const line = topLevelExemptionLine(field);
            expect(line).toContain(field.topLevelMeans);

            // Every sentence the declaration carries opens like a sentence —
            // a capital letter, a digit, or the backtick a code span opens
            // with. The frame no longer supplies leading words for the first
            // one to continue, so a lowercase start here is the tell that the
            // string was written as a clause fragment rather than a sentence.
            for (const fragment of sentenceFragments(field.topLevelMeans)) {
                expect(fragment).toMatch(/^[A-Z0-9`]/);
            }

            // No sentence boundary the frame cannot absorb: a lowercase word
            // straight after a mid-string `. `/`! `/`? ` is a run-on, not a
            // second sentence.
            expect(field.topLevelMeans).not.toMatch(/[.!?]\s+[a-z]/);

            // The whole declaration ends like a sentence.
            expect(field.topLevelMeans).toMatch(/[.!?]$/);
        },
    );
});
