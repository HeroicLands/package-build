// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { STANDING_FIELDS, STANDING_KEYS } from "../engine/standing-terms.mjs";
import { checkDataKeys } from "../engine/data-keys.mjs";
import { dataFields } from "../engine/note-vocabulary.mjs";
import { decodeNoteAddresses } from "../engine/note-addresses.mjs";
import { catalogueKey } from "../engine/actor-compiler.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { Actors } from "../sohl/actors.mjs";

const raw = [
    "---",
    "shortcode: subject",
    "type: being",
    "data:",
    "  affiliations:",
    "    vrystwldtrbs:",
    "      rank: 4",
    "      societies: [Vrystwald, Kaldor]",
    "---",
].join("\n");

const note = (affiliations: unknown) => ({
    fm: { type: "being", shortcode: "subject", data: { affiliations } },
    file: "subject.md",
    raw,
});

const findings = (affiliations: unknown) => checkDataKeys(note(affiliations), dataFields("being")!);

describe("a membership names the societies it is held in", () => {
    it("declares societies as a list of names on the membership", () => {
        expect(STANDING_KEYS).toContain("societies");
        const spec: any = STANDING_FIELDS.find((field: any) => field.name === "societies");
        expect(spec.kind).toBe("list");
        expect(spec.entries.kind).toBe("string");
        expect(spec.required).toBeFalsy();
    });

    it("accepts a list of names", () => {
        expect(findings({ vrystwldtrbs: { rank: 4, societies: ["Vrystwald", "Kaldor"] } })).toEqual(
            [],
        );
    });

    it("refuses a single name written as a string, at its key", () => {
        const found = findings({ vrystwldtrbs: { rank: 4, societies: "Vrystwald" } });
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ file: "subject.md", line: 8, severity: "error" });
        expect(found[0].message).toMatch(/`data\.affiliations\.vrystwldtrbs\.societies` should be/);
    });

    it("refuses a name that is not text", () => {
        const found = findings({ vrystwldtrbs: { rank: 4, societies: ["Vrystwald", 7] } });
        expect(found).toHaveLength(1);
        expect(found[0].message).toMatch(/societies\[1\]` should be a string, but reads 7/);
    });

    it("refuses the singular spelling as an undeclared key", () => {
        const found = findings({ vrystwldtrbs: { rank: 4, society: "Vrystwald" } });
        expect(found).toHaveLength(1);
        expect(found[0].message).toMatch(/"society" is not a key of/);
    });
});

describe("SoHL reads the first society into the affiliation item", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-societies-"));
        fs.mkdirSync(path.join(dir, "content"));
        fs.mkdirSync(path.join(dir, "items"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const catalogue = () =>
        new Map([
            [
                catalogueKey("affiliation", "vrystwldtrbs", contentPackage()),
                {
                    type: "affiliation",
                    name: "Vrystwald Tribes",
                    system: {
                        shortcode: "vrystwldtrbs",
                        subType: "tribe",
                        society: "",
                        level: 0,
                        office: "",
                    },
                },
            ],
        ]);

    const build = (affiliations: unknown) => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });
        const fm: any = decodeNoteAddresses(
            { type: "being", shortcode: "subject", data: { affiliations } },
            { package: contentPackage(), system: "note" },
        );
        const items = compiler.buildEmbeddedItems(
            catalogue(),
            "actor0000000000",
            fm,
            'actor "A Person"',
        );
        return { items, errors: compiler.errorCount };
    };

    it("writes the first name to system.society", () => {
        const { items, errors } = build({
            vrystwldtrbs: { rank: 4, societies: ["Vrystwald", "Kaldor"] },
        });
        expect(errors).toBe(0);
        expect(items).toHaveLength(1);
        expect(items[0].system.society).toBe("Vrystwald");
        expect(items[0].system.level).toBe(4);
    });

    it("keeps the body's own society where the membership names none", () => {
        for (const written of [
            { vrystwldtrbs: { rank: 4 } },
            { vrystwldtrbs: { rank: 4, societies: [] } },
        ]) {
            const { items } = build(written);
            expect(items[0].system.society).toBe("");
        }
    });
});
