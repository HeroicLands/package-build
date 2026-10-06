/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const file = "assets/content/Lore/Skrildmyl.md";

/** The subType each Address in these cases resolves to. */
const TARGETS: Record<string, { type: string; subType: string }> = {
    "lore-nordmen": { type: "lore", subType: "culture" },
    "lore-nordlaw": { type: "lore", subType: "law" },
    "skill-nordmal": { type: "skill", subType: "language" },
    "skill-smithing": { type: "skill", subType: "craft" },
    "being-skrildmyl": { type: "being", subType: "npc" },
};

/** A lore note of the given subType, written exactly as its `raw` says. */
function lore(subType: string, data: Record<string, unknown>) {
    const lines = Object.entries(data).map(
        ([key, value]) => `    ${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`,
    );
    const raw = ["---", "type: lore", `subType: ${subType}`, "data:", ...lines, "---", ""].join(
        "\n",
    );
    return { file, raw, type: "lore", fm: { type: "lore", subType, data } };
}

function lint(note: ReturnType<typeof lore>) {
    const index = {
        notes: [note],
        contentPackage: "thalorna",
        types: new Set(["being", "lore", "place", "skill"]),
        packages: new Set(["thalorna"]),
        addressHit: (address: string) => {
            const target = TARGETS[address.replace(/^thalorna-note-/, "")];
            return target && { fm: target };
        },
    };
    return lintFrontmatter(index as any, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY })
        .findings;
}

describe("a work of literature", () => {
    it("is a lore subType", () => {
        expect(NOTE_VOCABULARY.lore.subTypes).toContain("literature");
    });

    it("declares four optional fields of the shapes the format names", () => {
        const fields = Object.fromEntries(
            dataFields("lore").map((field: { name: string }) => [field.name, field]),
        );
        expect(fields.culture).toMatchObject({ kind: "address", ref: "lore" });
        expect(fields.form).toMatchObject({ kind: "string" });
        expect(fields.subjects).toMatchObject({ kind: "list", entryKind: "address" });
        expect(fields.language).toMatchObject({ kind: "address", ref: "skill" });
        for (const name of ["culture", "form", "subjects", "language"])
            expect(fields[name].required, name).toBeFalsy();
    });

    it("lints clean with no field, and with all four", () => {
        expect(lint(lore("literature", {}))).toEqual([]);
        expect(
            lint(
                lore("literature", {
                    culture: "lore-nordmen",
                    form: "saga",
                    subjects: ["being-skrildmyl"],
                    language: "skill-nordmal",
                }),
            ),
        ).toEqual([]);
    });

    it("refuses each field on another lore subType, at its own key", () => {
        const findings = lint(lore("theology", { form: "saga", language: "skill-nordmal" }));
        expect(findings).toEqual([
            expect.objectContaining({
                file,
                line: 5,
                severity: "error",
                message: expect.stringContaining("`data.form` describes a work of literature"),
            }),
            expect.objectContaining({
                file,
                line: 6,
                severity: "error",
                message: expect.stringContaining("`data.language` describes a work of literature"),
            }),
        ]);
    });

    it("requires its culture to be a culture note", () => {
        expect(lint(lore("literature", { culture: "lore-nordlaw" }))).toContainEqual(
            expect.objectContaining({
                line: 5,
                severity: "error",
                message: expect.stringContaining("subType is not culture"),
            }),
        );
    });

    it("requires its language to be a language skill", () => {
        expect(lint(lore("literature", { language: "skill-smithing" }))).toContainEqual(
            expect.objectContaining({
                line: 5,
                severity: "error",
                message: expect.stringContaining("not a skill whose subType is language"),
            }),
        );
    });

    it("shows all four in its infobox, each Address as a link", () => {
        const resolve = (ref: unknown) => {
            const shortcode = (ref as { shortcode?: string })?.shortcode ?? String(ref);
            return { name: `Named ${shortcode}`, url: `/x/${shortcode}/` };
        };
        const box = noteInfobox(
            {
                type: "lore",
                subType: "literature",
                name: { full: "Saga of Skrildmyl" },
                data: {
                    culture: "lore-nordmen",
                    form: "saga",
                    subjects: ["being-skrildmyl"],
                    language: "skill-nordmal",
                },
            },
            { resolve, contentPackage: "thalorna" },
        );
        const rows = Object.fromEntries(
            box.sections[0].rows.map((row: { label: string }) => [row.label, row]),
        );
        expect(rows.Form).toMatchObject({ kind: "text", value: "Saga" });
        expect(rows.Culture).toMatchObject({
            kind: "link",
            value: { url: expect.stringContaining("nordmen") },
        });
        expect(rows.Language).toMatchObject({
            kind: "link",
            value: { url: expect.stringContaining("nordmal") },
        });
        expect(rows.Subjects).toMatchObject({
            kind: "links",
            value: [{ url: expect.stringContaining("skrildmyl") }],
        });
    });
});
