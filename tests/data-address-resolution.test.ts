/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { ART_SLOTS } from "../engine/art-slots.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";

const artKeys = new Set(ART_SLOTS.map((slot) => slot.key));
const referenceFields = Object.keys(NOTE_VOCABULARY).flatMap((type) =>
    (dataFields(type) ?? [])
        .filter(
            (field) =>
                !artKeys.has(field.name) &&
                (field.kind === "address" ||
                    field.entryKind === "address" ||
                    field.keyKind === "address"),
        )
        .map((field) => ({ type, field })),
);

function fixture(type: string, field: any, written: string) {
    const value =
        field.keyKind === "address" ? { [written]: "neutral" }
        : field.kind === "list" ? [written]
        : written;
    return {
        file: `/tree/${type}.md`,
        raw: `---\ntype: ${type}\ndata:\n  ${field.name}: ${written}\n---\n`,
        fm: { type, data: { [field.name]: value } },
    };
}

function check(type: string, field: any, written: string, addressHit: (value: string) => unknown) {
    return lintNote(fixture(type, field, written), {
        schemas: { [type]: [] },
        vocabulary: NOTE_VOCABULARY,
        index: {
            contentPackage: "local",
            types: new Set(Object.keys(NOTE_VOCABULARY)),
            addressHit,
        },
    });
}

describe("declared data Address targets", () => {
    it("reports every unresolved non-art Address position", () => {
        expect(referenceFields.length).toBeGreaterThan(20);
        for (const { type, field } of referenceFields) {
            const written = field.ref ? "missing" : `${field.accepts?.[0] ?? "lore"}-missing`;
            const findings = check(type, field, written, () => undefined);
            expect(
                findings.some(
                    (finding: any) =>
                        finding.severity === "error" &&
                        finding.message.includes("does not resolve") &&
                        finding.message.includes(`data.${field.name}`),
                ),
                `${type}.data.${field.name}`,
            ).toBe(true);
        }
    });

    it("looks up the complete Address and accepts its exact target", () => {
        const field = dataFields("being").find((entry) => entry.name === "species");
        const lookedUp: string[] = [];
        const findings = check("being", field, "humanflk", (address) => {
            lookedUp.push(address);
            return address === "local-note-lore-humanflk" ? {} : undefined;
        });
        expect(lookedUp).toEqual(["local-note-lore-humanflk"]);
        expect(findings.some((finding: any) => finding.message.includes("does not resolve"))).toBe(
            false,
        );
    });

    it("does not search another package for an omitted package segment", () => {
        const field = dataFields("being").find((entry) => entry.name === "species");
        const findings = check("being", field, "humanflk", (address) =>
            address === "foreign-none-lore-humanflk" ? {} : undefined,
        );
        expect(findings.some((finding: any) => finding.message.includes("does not resolve"))).toBe(
            true,
        );
    });

    it("accepts a fully qualified target in a declared dependency", () => {
        const field = dataFields("being").find((entry) => entry.name === "species");
        const lookedUp: string[] = [];
        const findings = check("being", field, "foreign-none-lore-humanflk", (address) => {
            lookedUp.push(address);
            return address === "foreign-none-lore-humanflk" ? {} : undefined;
        });
        expect(lookedUp).toEqual(["foreign-none-lore-humanflk"]);
        expect(findings.some((finding: any) => finding.message.includes("does not resolve"))).toBe(
            false,
        );
    });

    it("locates an unresolved Address used as a relation key", () => {
        const note = {
            file: "/tree/group.md",
            raw: "---\ntype: affiliation\ndata:\n  relations:\n    absent: rival\n---\n",
            fm: { type: "affiliation", data: { relations: { absent: "rival" } } },
        };
        const findings = lintNote(note, {
            schemas: { affiliation: [] },
            vocabulary: NOTE_VOCABULARY,
            index: {
                contentPackage: "local",
                types: new Set(Object.keys(NOTE_VOCABULARY)),
                addressHit: () => undefined,
            },
        });
        expect(
            findings.find((finding: any) => finding.message.includes("does not resolve")),
        ).toMatchObject({
            file: "/tree/group.md",
            line: 5,
            severity: "error",
        });
    });

    it("leaves target existence unchecked without a reference index", () => {
        const note = fixture(
            "being",
            dataFields("being").find((entry) => entry.name === "species"),
            "missing",
        );
        const findings = lintNote(note, {
            schemas: { being: [] },
            vocabulary: NOTE_VOCABULARY,
        });
        expect(findings.some((finding: any) => finding.message.includes("does not resolve"))).toBe(
            false,
        );
    });
});
