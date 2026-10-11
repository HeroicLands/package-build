/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `data.icon` is declared exactly for the types whose builder emits icon art.
 *
 * The expected set is derived from the passes' own `emitsArt` through
 * `emittedArtFor`, never listed here, so a pass that starts or stops emitting an
 * icon moves the vocabulary with it or fails this file.
 */

import { describe, expect, it } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { emittedArtFor } from "../engine/generate.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const types = Object.keys(NOTE_VOCABULARY);
const bearing = types.filter((t) => emittedArtFor(t)?.art.includes("icon"));
const bare = types.filter((t) => !bearing.includes(t));

function lint(type: string, lines: string[]) {
    const raw = ["---", `type: ${type}`, "data:", ...lines, "---", ""].join("\n");
    const data = Object.fromEntries(
        lines.map((line) => {
            const [key, ...rest] = line.trim().split(": ");
            const value = rest.join(": ");
            return [key, value === "[]" ? [] : value];
        }),
    );
    return lintNote({ file: "assets/content/Note.md", type, raw, fm: { type, data } } as any, {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    });
}

describe("icon scope is derived from what the builders emit", () => {
    it("is not vacuous", () => {
        expect(bearing).toEqual(expect.arrayContaining(["being", "macro", "bundle", "skill"]));
        expect(bare).toEqual(expect.arrayContaining(["doc", "map", "lore", "place"]));
    });

    it("declares icon on exactly the types that emit icon art", () => {
        const declared = types.filter((t) =>
            (dataFields(t) ?? []).some((f: { name: string }) => f.name === "icon"),
        );
        expect(declared.sort()).toEqual([...bearing].sort());
    });

    it("accepts icon on every type that emits it", () => {
        for (const type of bearing) {
            const found = lint(type, ["    icon: anvil"]).filter((f: any) =>
                /"icon"/.test(f.message),
            );
            expect(
                found.map((f: any) => f.message),
                type,
            ).toEqual([]);
        }
    });

    it("refuses icon with a located error on every other type", () => {
        for (const type of bare) {
            const found = lint(type, ["    icon: anvil"]).filter(
                (f: any) =>
                    f.severity === "error" && /"icon" is not a `data:` property/.test(f.message),
            );
            expect(found.length, type).toBeGreaterThan(0);
            expect(found[0].line, type).toBe(4);
        }
    });
});

describe("the being declares no stations", () => {
    it("refuses stations as an unknown key at its line", () => {
        const found = lint("being", ["    occupation: smith", "    stations: []"]).filter(
            (f: any) =>
                f.severity === "error" && /"stations" is not a `data:` property/.test(f.message),
        );
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].line).toBe(5);
    });
});
