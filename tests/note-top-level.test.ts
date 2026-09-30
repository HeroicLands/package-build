/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_TOP_LEVEL_KEYS } from "../engine/note-frontmatter.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

function findings(source: string) {
    const raw = `---\n${source}\n---\n\nBody.\n`;
    return lintNote(
        { file: "note.md", type: "lore", raw, fm: YAML.parse(source) },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
}

describe("addressed note top-level keys", () => {
    it("accepts the complete ordered vocabulary", () => {
        expect(NOTE_TOP_LEVEL_KEYS).toEqual([
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
    });

    it("reports an unknown field at its authored line", () => {
        const result = findings("shortcode: example\ntype: lore\nterran_analog: Earth");
        expect(result).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: "note.md",
                    line: 4,
                    column: 1,
                    severity: "error",
                    message: expect.stringContaining("unknown top-level frontmatter key"),
                }),
            ]),
        );
    });

    it("ignores commented-out fields", () => {
        const result = findings("shortcode: example\ntype: lore\n# terran_analog: Earth");
        expect(result).toEqual([]);
    });

    it("rejects underscore-prefixed fields", () => {
        const result = findings("shortcode: example\ntype: lore\n_editorial: Earth");
        expect(result.some((finding) => finding.message.includes('"_editorial"'))).toBe(true);
    });
});
