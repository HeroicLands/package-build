/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { addressPositions, decodeNoteAddresses } from "../engine/note-addresses.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { reduceAddressFields } from "../engine/address-fields.mjs";
import { affiliationSections } from "../sohl/infobox.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { noteAddressContext, encodeAddresses } from "../engine/note-addresses.mjs";

const fields = ITEM_FIELDS.affiliation;
const item = "Compendium.native-module.unusual-skills.Item.aaaaaaaaaaaaaaaa";
const foreign = "Compendium.foreign-module.mixed-pack.Item.bbbbbbbbbbbbbbbb";
const localTargets = new Map([["world-sohl-skill-herb", { uuid: item }]]);
const foreignTargets = new Map([["sohl-sohl-skill-herb", { uuid: foreign }]]);
const vocabulary = {
    package: "world",
    types: new Set(["skill", "place"]),
    packages: new Set(["world", "sohl"]),
    referenceTargets: localTargets,
    foreignReferences: foreignTargets,
};

function compileSkills(skills: unknown[], options = {}) {
    const emitted: any = { commonSkills: skills };
    const findings = reduceAddressFields(emitted, fields, { ...vocabulary, ...options });
    return { emitted, findings };
}

describe("native UUID field declarations", () => {
    it("derives every emitted UUID field from an Address read position", () => {
        for (const [type, fields] of Object.entries(ITEM_FIELDS)) {
            const positions = addressPositions(
                { type },
                { package: "world", systemBlocks: { sohl: { fields: ITEM_FIELDS } } },
            );
            for (const field of fields.filter(
                (candidate: any) => candidate.address?.emit === "uuid",
            )) {
                expect(
                    positions.some(
                        (position: any) => position.path.join(".") === `sohl.system.${field.to}`,
                    ),
                    `${type}:${field.to}`,
                ).toBe(true);
            }
        }
        expect(
            ITEM_FIELDS.affiliation.some(
                (field: any) => field.to === "commonSkills" && field.address?.emit === "uuid",
            ),
        ).toBe(true);
    });
    it("emits exact local and foreign Item UUIDs, retaining distinct packages", () => {
        const written = ["herb", "sohl-sohl-skill-herb"];
        const { emitted, findings } = compileSkills(written);
        expect(findings).toEqual([]);
        expect(emitted.commonSkills).toEqual([item, foreign]);
        expect(written).toEqual(["herb", "sohl-sohl-skill-herb"]);
        expect(compileSkills([]).emitted.commonSkills).toEqual([]);
        expect(compileSkills([item]).emitted.commonSkills).toEqual([item]);
    });
    it("accepts decoded Address tuples without changing source identity", () => {
        const source = decodeNoteAddresses(
            { type: "affiliation", sohl: { system: { commonSkills: ["sohl-sohl-skill-herb"] } } },
            { package: "world", systemBlocks: { sohl: { fields: ITEM_FIELDS } } },
        );
        const tuple = source.sohl.system.commonSkills[0];
        const { emitted, findings } = compileSkills([tuple]);
        expect(findings).toEqual([]);
        expect(emitted.commonSkills).toEqual([foreign]);
        expect(tuple).toMatchObject({ package: "sohl", system: "sohl", type: "skill" });
    });
    it("publishes complete Addresses from a module's declared system registry", () => {
        const config = {
            contentPackage: "world",
            relationships: { systems: [{ id: "sohl" }] },
            itemFields: ITEM_FIELDS,
        };
        const record = decodeNoteAddresses(
            {
                type: "affiliation",
                sohl: { system: { commonSkills: ["herb", "sohl-sohl-skill-herb"] } },
            },
            noteAddressContext(config),
        );
        expect(encodeAddresses(record).sohl.system.commonSkills).toEqual([
            "world-sohl-skill-herb",
            "sohl-sohl-skill-herb",
        ]);
    });
    it("reports missing, unpublished and non-Item native targets", () => {
        expect(compileSkills(["missing"]).findings[0].message).toContain("no published Item UUID");
        expect(
            compileSkills(["herb"], { referenceTargets: new Map([["world-sohl-skill-herb", {}]]) })
                .findings[0].message,
        ).toContain("no published Item UUID");
        expect(
            compileSkills(["herb"], {
                referenceTargets: new Map([
                    [
                        "world-sohl-skill-herb",
                        { uuid: "Compendium.world.journals.JournalEntry.aaa" },
                    ],
                ]),
            }).findings[0].message,
        ).toContain("no published Item UUID");
    });
    it("refuses wrong system, type and undeclared foreign packages", () => {
        expect(compileSkills(["world-none-skill-herb"]).findings[0].message).toContain(
            "no published Item UUID",
        );
        expect(compileSkills(["world-sohl-place-herb"]).findings[0].message).toContain(
            "does not accept",
        );
        expect(compileSkills(["other-sohl-skill-herb"]).findings.length).toBeGreaterThan(0);
        expect(
            compileSkills(["sohl-sohl-skill-herb"], {
                noIndexPackages: new Set(["sohl"]),
                foreignReferences: new Map(),
            }).findings.length,
        ).toBeGreaterThan(0);
    });
    it("links published skill journals and names unpublished documentation plainly", () => {
        const source = decodeNoteAddresses(
            {
                type: "affiliation",
                sohl: { system: { commonSkills: ["herb", "sohl-sohl-skill-herb"] } },
            },
            { package: "world", systemBlocks: { sohl: { fields: ITEM_FIELDS } } },
        );
        const sections = affiliationSections(source, {
            block: "sohl",
            resolveField: (field: any) =>
                field.to === "commonSkills" ?
                    { value: source.sohl.system.commonSkills, from: "system" }
                :   { value: undefined, from: "default" },
            resolve: (address: any) => {
                const key = `${address.package}-${address.system}-${address.type}-${address.shortcode}`;
                if (key === "world-sohl-skill-herb") return { name: "Local Herb", uuid: item };
                if (key === "sohl-sohl-skill-herb") return { name: "Foreign Herb", uuid: foreign };
                if (key === "world-note-skill-herb")
                    return {
                        name: "Local Herb",
                        uuid: "Compendium.world.journals.JournalEntry.cccccccccccccccc",
                    };
                return undefined;
            },
        });
        const row: any = sections.find((section: any) => section.id === "commonskills")?.rows[0];
        expect(row.value[0]).toMatchObject({
            text: "Local Herb",
            uuid: "Compendium.world.journals.JournalEntry.cccccccccccccccc",
        });
        expect(row.value[1]).toEqual({ text: "Foreign Herb" });
    });
    it("locates a shared common-skills declaration and names the SoHL destination", () => {
        const raw = "---\ntype: affiliation\ndata:\n  commonSkills:\n    - herb\n---\n";
        const findings = lintNote(
            {
                file: "affiliation.md",
                type: "affiliation",
                fm: { type: "affiliation", data: { commonSkills: ["herb"] } },
                raw,
            },
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        );
        expect(findings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: "affiliation.md",
                    line: 4,
                    column: 3,
                    severity: "error",
                    message: expect.stringContaining("sohl.system.commonSkills"),
                }),
            ]),
        );
    });
});
