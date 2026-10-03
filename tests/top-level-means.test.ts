/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every field that declares `topLevelMeans` renders into one line of
 * `engine/field-reference.mjs`'s authoring reference: a bold lead-in, then
 * `topLevelExemptionLine`'s frame completed by the field's own string. The
 * frame reads "There it means …", so the string must complete it as a
 * lowercase clause — not open as if it were a sentence of its own, and not
 * run a later sentence on without capitalizing it.
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

describe("every topLevelMeans completes the frame as one grammatical sentence", () => {
    it("finds at least one declaration to check", () => {
        // Guards the guard: a registry that stopped being walked here would
        // otherwise leave this suite vacuously green.
        expect(fieldsWithTopLevelMeans.length).toBeGreaterThan(0);
    });

    it.each(fieldsWithTopLevelMeans.map((field) => [field.name, field] as const))(
        "%s completes \"There it means …\" rather than opening a sentence of its own",
        (_name, field) => {
            const line = topLevelExemptionLine(field);
            expect(line).toContain(field.topLevelMeans);

            const [firstClause, ...rest] = sentenceFragments(field.topLevelMeans);

            // The declaration continues "There it means …", so its first
            // clause must not begin as if it opened a new sentence — a
            // capital letter there is the tell that it was written as a
            // standalone sentence instead.
            expect(firstClause).toMatch(/^[a-z0-9`]/);

            // Any further sentence the declaration adds after its first full
            // stop is a real sentence, not a run-on, so it opens properly.
            for (const fragment of rest) {
                expect(fragment).toMatch(/^[A-Z0-9`]/);
            }

            // The whole declaration ends like a sentence.
            expect(field.topLevelMeans).toMatch(/[.!?]$/);
        },
    );
});
