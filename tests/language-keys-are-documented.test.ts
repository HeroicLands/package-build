/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Every key a skill note's `data` declares is a row of the format
 * reference's skill table.** The keys are read from the vocabulary at every
 * depth — a map's own keys, a list's entries, a keyed map's values — so a key
 * added to a language note's vocabulary and left out of the reference fails
 * here.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DETAILS = fs.readFileSync(
    path.join(HERE, "..", "docs", "reference", "format-details.md"),
    "utf8",
);

type Spec = {
    name: string;
    kind?: string;
    fields?: readonly Spec[];
    entries?: Spec & { fields?: readonly Spec[] };
    values?: Spec & { fields?: readonly Spec[] };
};

/**
 * Every path a declaration reaches, as the reference writes it: `words[].form`.
 * A map keyed by data reaches `<name>`; a value that is a scalar or a map of
 * them, such as `names.pattern`, is one row.
 */
function paths(spec: Spec, at: string): string[] {
    const out = [at];
    for (const inner of spec.fields ?? []) out.push(...paths(inner, `${at}.${inner.name}`));
    for (const inner of spec.entries?.fields ?? [])
        out.push(...paths(inner, `${at}[].${inner.name}`));
    if (spec.kind === "map" && spec.values)
        out.push(...paths({ ...spec.values, name: "<name>" }, `${at}.<name>`));
    return out;
}

/** The skill section of the reference, from its heading to the next type's. */
const SECTION = DETAILS.slice(
    DETAILS.indexOf("### type: skill"),
    DETAILS.indexOf("### type: trauma"),
);

describe("the keys of a skill note's data", () => {
    const keys = (NOTE_VOCABULARY.skill.data as readonly Spec[]).flatMap((field) =>
        paths(field, field.name),
    );

    it("are read from the vocabulary, the language keys among them", () => {
        expect(keys).toEqual(
            expect.arrayContaining([
                "words[].form",
                "register[].name",
                "sounds.edges[].edge",
                "cognates[].forms.<name>",
            ]),
        );
    });

    it("are each a row of the skill table in the format reference", () => {
        const missing = keys.filter(
            (key) =>
                !new RegExp(`^\\| \`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` `, "m").test(
                    SECTION,
                ),
        );
        expect(missing).toEqual([]);
    });
});
