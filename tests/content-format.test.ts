/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { sectionOf } from "../engine/content-address.mjs";

import {
    CONTENT_FORMAT_PATH,
    loadContentFormat,
    parseContentFormat,
} from "../engine/content-format.mjs";
import {
    checkDeclaredFields,
    checkSchemaTargets,
    fieldDriftMessage,
    measureCorpus,
    measureNote,
    undeclaredTargetMessage,
} from "../engine/content-format-check.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SCHEMA = path.join(here, "fixtures", "content-format", "schema-sohl.json");

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

/** A miniature specification, in the shape the real one has. */
const MINI = [
    "## Content format",
    "",
    "### type: weapon",
    "",
    "| `data` property    | Values   | Description   |",
    "| ------------------ | -------- | ------------- |",
    "| `templatePriority` | `number` | Priority      |",
    "| `weight`           | `number` | Gear weight   |",
    "| `charges.value`    | `number` | Charges       |",
    "",
    "| shared source | → sohl              | → hm3           |",
    "| ------------- | ------------------- | --------------- |",
    "| `data.weight` | `system.weightBase` | `system.weight` |",
    "| `subType`     | `system.subType`    | NA              |",
    "",
    "### type: place",
    "",
    "| `data` property | Values       | Description |",
    "| --------------- | ------------ | ----------- |",
    "| `parents`       | `WikiLink[]` | Enclosing   |",
    "",
].join("\n");

describe("parsing the specification (#130)", () => {
    it("reads a type's `data` vocabulary from its own table", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        expect([...format.types.keys()].sort()).toEqual(["place", "weapon"]);
        expect([...format.types.get("weapon")!.dataKeys].sort()).toEqual([
            "charges",
            "templatePriority",
            "weight",
        ]);
        // The full path is kept beside the authored head segment: the head is
        // what a note writes, the path is what the table said.
        expect(format.types.get("weapon")!.dataPaths).toContain("charges.value");
    });

    it("reads every `system.*` target out of the mapping tables, with its position", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        expect(format.claims).toHaveLength(3);
        const sohl = format.claims.filter((c) => c.system === "sohl");
        expect(sohl.map((c) => c.target)).toEqual(["system.weightBase", "system.subType"]);
        const [first] = sohl;
        expect(first.noteType).toBe("weapon");
        expect(first.source).toBe("data.weight");
        // Positioned at the cell, so the finding opens where the claim is made.
        expect(first.line).toBe(13);
        expect(MINI.split("\n")[first.line - 1].slice(first.column - 1)).toMatch(
            /^`system\.weightBase`/,
        );
    });

    it("ignores the cells that name no field", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        // `NA` is a column that produces no document, not a target.
        expect(format.claims.some((c) => c.target === "NA")).toBe(false);
    });

    it("takes the system names from the table header, never from a list of its own", () => {
        const other = MINI.replace("→ hm3", "→ elsewhere");
        const format = parseContentFormat(other, { file: "spec.md" });
        expect(format.claims.some((c) => c.system === "elsewhere")).toBe(true);
    });
});

describe("the shipped specification (#130)", () => {
    const format = loadContentFormat();

    it("is the committed document", () => {
        expect(fs.existsSync(CONTENT_FORMAT_PATH)).toBe(true);
        expect(CONTENT_FORMAT_PATH.endsWith(path.join("docs", "content-format.md"))).toBe(true);
    });

    it("makes the 84 mapping claims the audit counted", () => {
        expect(format.claims).toHaveLength(84);
        expect([...new Set(format.claims.map((c) => c.system))].sort()).toEqual(["hm3", "sohl"]);
    });

    it("declares a `data` vocabulary for the types that have one", () => {
        expect(format.types.get("being")!.dataKeys.has("species")).toBe(true);
        expect(format.types.get("map")!.dataKeys.has("pxPerGrid")).toBe(true);
        // `appearance.eye_color` is authored as `appearance`.
        expect(format.types.get("being")!.dataKeys.has("appearance")).toBe(true);
    });
});

describe("checking a claim against a published schema (#130)", () => {
    const format = parseContentFormat(MINI, { file: "spec.md" });
    const artifact = (own: string[]) => ({
        version: 1,
        system: "sohl",
        systemVersion: "0.9.0",
        documents: { Item: { weapongear: { own, inherited: [] } } },
    });

    it("passes a target the schema declares, whichever subtype declares it", () => {
        const { findings } = checkSchemaTargets({
            format,
            schemas: { sohl: artifact(["weightBase", "subType"]) },
        });
        expect(findings).toEqual([]);
    });

    it("fails a target no subtype declares, naming the system and its version", () => {
        const { findings } = checkSchemaTargets({
            format,
            schemas: { sohl: artifact(["weightBase"]) },
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].file).toBe("spec.md");
        expect(findings[0].line).toBe(14);
        expect(messages(findings)).toContain("system.subType");
        expect(messages(findings)).toContain("sohl");
        expect(messages(findings)).toContain("0.9.0");
    });

    it("counts a system it was given no schema for as unchecked, not as passing", () => {
        const result = checkSchemaTargets({
            format,
            schemas: { sohl: artifact(["weightBase", "subType"]) },
        });
        expect(result.unchecked).toEqual({ hm3: 1 });
        expect(result.checked).toBe(2);
    });

    it("refuses a schema published under another artifact version", () => {
        expect(() =>
            checkSchemaTargets({
                format,
                schemas: { sohl: { ...artifact([]), version: 2 } },
            }),
        ).toThrow(/version 2/);
    });

    it("says what an undeclared target costs", () => {
        const message = undeclaredTargetMessage({
            system: "sohl",
            systemVersion: "0.9.0",
            noteType: "weapon",
            source: "subType",
            target: "system.subType",
        });
        expect(message).toContain("`weapon`");
        expect(message).toContain("`subType`");
    });
});

describe("the specification against the committed fixture schema (#130)", () => {
    it("names no SoHL field the fixture does not declare", () => {
        const format = loadContentFormat();
        const artifact = JSON.parse(fs.readFileSync(FIXTURE_SCHEMA, "utf8"));
        const { findings, checked } = checkSchemaTargets({ format, schemas: { sohl: artifact } });
        expect(messages(findings)).toBe("");
        expect(checked).toBe(66);
    });
});

describe("measuring a note against the declared vocabulary (#130)", () => {
    const format = parseContentFormat(MINI, { file: "spec.md" });
    const note = (fm: object) => ({
        file: "/tree/note.md",
        raw: `---\n${Object.keys(fm)
            .map((k) => `${k}: x`)
            .join("\n")}\n---\n`,
        fm,
    });

    it("says nothing about a conforming note", () => {
        const findings = measureNote(note({ type: "weapon", data: { weight: 3 } }), format);
        expect(findings).toEqual([]);
    });

    it("reports a key the type's `data` table does not declare, and guesses the one meant", () => {
        const findings = measureNote(note({ type: "weapon", data: { weigth: 3 } }), format);
        expect(findings).toHaveLength(1);
        expect(findings[0].class).toBe("unknown-data-key");
        expect(messages(findings)).toContain('Did you mean "weight"?');
    });

    it("reports a declared `data` property authored at top level", () => {
        const findings = measureNote(note({ type: "weapon", weight: 3 }), format);
        expect(findings).toHaveLength(1);
        expect(findings[0].class).toBe("top-level-data-key");
        expect(messages(findings)).toContain("`data.weight`");
    });

    it("reports a declared `data` property authored inside a system block", () => {
        const findings = measureNote(note({ type: "weapon", sohl: { weight: 3 } }), format);
        expect(findings).toHaveLength(1);
        expect(findings[0].class).toBe("system-block-data-key");
        expect(messages(findings)).toContain("sohl.system");
    });

    it("leaves a system block's own vocabulary alone", () => {
        // The format does not define the `sohl:` schema — the system does — so
        // a key it says nothing about is not this check's to refuse.
        const findings = measureNote(note({ type: "weapon", sohl: { heft: 12 } }), format);
        expect(findings).toEqual([]);
    });

    it("reports a note whose type the format declares no section for", () => {
        const findings = measureNote(note({ type: "weapongear" }), format);
        expect(findings).toHaveLength(1);
        expect(findings[0].class).toBe("unknown-type");
        expect(messages(findings)).toContain("weapongear");
    });

    it("counts findings by class across a corpus", () => {
        const result = measureCorpus(
            [
                note({ type: "weapon", weight: 3 }),
                note({ type: "weapon", data: { weigth: 3 } }),
                note({ type: "place", data: { parents: ["x"] } }),
            ],
            format,
        );
        expect(result.notes).toBe(3);
        expect(result.findings).toHaveLength(2);
        expect(result.byClass).toEqual({ "top-level-data-key": 1, "unknown-data-key": 1 });
    });

    it("emits findings as warnings, so the report is not a failing check", () => {
        const { findings } = measureCorpus([note({ type: "weapon", weight: 3 })], format);
        expect(findings.every((f) => f.severity === "warning")).toBe(true);
    });
});

describe("the specification against the declarations that compile it (#136)", () => {
    /** A declaration set in the shape `itemBuilders` entries carry. */
    const DECLARED = {
        weapon: [
            { name: "weight", to: "weightBase", shape: "number", describe: "Gear weight" },
            { name: "subType", to: "subType", shape: "string", describe: "Kind" },
            // Not authored — a constant is part of the emitted document and no
            // part of the vocabulary, so it is never a field pair.
            { to: "quantity", value: 1, describe: "Always one" },
        ],
        othergear: [{ name: "weight", to: "weightBase", shape: "number", describe: "Weight" }],
    };

    it("says nothing where the mapping and the declaration agree", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        const { findings, fields } = checkDeclaredFields({
            format,
            itemFields: DECLARED,
            system: "sohl",
        });
        expect(findings).toEqual([]);
        expect(fields).toBe(2);
    });

    it("fails on a target the declaration writes somewhere else, naming type and field", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        const drifted = {
            ...DECLARED,
            weapon: [{ name: "weight", to: "weight", shape: "number", describe: "Gear weight" }],
        };
        const { findings } = checkDeclaredFields({ format, itemFields: drifted, system: "sohl" });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].class).toBe("field-drift");
        expect(messages(findings)).toContain("`weapon`");
        expect(messages(findings)).toContain("`weight`");
        expect(messages(findings)).toContain("system.weightBase");
    });

    it("positions the finding at the cell in the specification that makes the claim", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        const drifted = {
            ...DECLARED,
            weapon: [{ name: "weight", to: "weight", shape: "number", describe: "Gear weight" }],
        };
        const { findings } = checkDeclaredFields({ format, itemFields: drifted, system: "sohl" });
        expect(findings[0].file).toBe("spec.md");
        expect(findings[0].line).toBe(13);
        expect(MINI.split("\n")[findings[0].line - 1].slice(findings[0].column - 1)).toMatch(
            /^`system\.weightBase`/,
        );
    });

    it("agrees when a declared field carries a nested target the mapping spells out", () => {
        const nested = [
            "### type: mystery",
            "",
            "| shared source        | → sohl                 |",
            "| -------------------- | ---------------------- |",
            "| `data.charges.value` | `system.charges.value` |",
            "",
        ].join("\n");
        const format = parseContentFormat(nested, { file: "spec.md" });
        const { findings, fields } = checkDeclaredFields({
            format,
            itemFields: { mystery: [{ name: "charges", to: "charges", describe: "Charges" }] },
            system: "sohl",
        });
        expect(findings).toEqual([]);
        expect(fields).toBe(1);
    });

    it("fails when the nested remainder differs, not merely the head", () => {
        const nested = [
            "### type: mystery",
            "",
            "| shared source        | → sohl               |",
            "| -------------------- | -------------------- |",
            "| `data.charges.value` | `system.charges.max` |",
            "",
        ].join("\n");
        const format = parseContentFormat(nested, { file: "spec.md" });
        const { findings } = checkDeclaredFields({
            format,
            itemFields: { mystery: [{ name: "charges", to: "charges", describe: "Charges" }] },
            system: "sohl",
        });
        expect(findings).toHaveLength(1);
        expect(messages(findings)).toContain("system.charges.max");
    });

    it("skips the types only one side describes, and names them rather than passing them", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        const result = checkDeclaredFields({ format, itemFields: DECLARED, system: "sohl" });
        expect(result.checked).toEqual(["weapon"]);
        // `place` produces a JournalEntry, not an item, so no `itemBuilders`
        // entry will ever cover it — out of reach, not undone.
        expect(result.skipped.spec).toEqual(["place"]);
        expect(result.skipped.registry).toEqual(["othergear"]);
        expect(result.findings.some((f) => /place|othergear/.test(f.message))).toBe(false);
    });

    it("reports the fields only one side names as coverage, never as a contradiction", () => {
        const format = parseContentFormat(MINI, { file: "spec.md" });
        const partial = {
            ...DECLARED,
            weapon: [
                { name: "weight", to: "weightBase", describe: "Gear weight" },
                { name: "heft", to: "heftBase", describe: "System-specific" },
            ],
        };
        const { findings, coverage } = checkDeclaredFields({
            format,
            itemFields: partial,
            system: "sohl",
        });
        expect(findings).toEqual([]);
        const weapon = coverage.find((c) => c.type === "weapon")!;
        expect(weapon.registryOnly).toContain("heft");
        // The document declares these; no declaration names them.
        expect(weapon.specOnly).toEqual(expect.arrayContaining(["templatePriority", "charges"]));
    });

    it("says what a drifted field costs", () => {
        expect(
            fieldDriftMessage({
                noteType: "weapon",
                source: "data.weight",
                target: "system.weightBase",
                name: "weight",
                to: "weight",
            }),
        ).toContain("`weapon`");
    });
});

describe("the shipped specification against the shipped declarations (#136)", () => {
    it("contradicts none of the SoHL item-field declarations", () => {
        const format = loadContentFormat();
        const result = checkDeclaredFields({ format, itemFields: ITEM_FIELDS, system: "sohl" });
        expect(messages(result.findings)).toBe("");
        expect(result.checked.length).toBeGreaterThan(0);
        // Every type is accounted for: checked, or named as out of reach.
        expect(result.checked.length + result.skipped.spec.length).toBe(format.types.size);
        expect(result.checked.length + result.skipped.registry.length).toBe(
            Object.keys(ITEM_FIELDS).length,
        );
    });
});

describe("a doc routes by its subtype (#168)", () => {
    // The address engine read `category` until the content format retired it,
    // at which point every `doc` note silently lost its address: `sectionOf`
    // answered `undefined`, and a note with no section is not published. Only
    // `doc` was affected, being the one type that routes by its subtype label
    // rather than by its type.
    it("gives each doc subtype its own section", () => {
        expect(sectionOf({ type: "doc", subType: "rules" })).toBe("rules");
        expect(sectionOf({ type: "doc", subType: "user-guide" })).toBe("user-guide");
        expect(sectionOf({ type: "doc", subType: "reference" })).toBe("reference");
        expect(sectionOf({ type: "doc", subType: "reference" })).toBe("reference");
    });

    it("routes every other type by its type, subtype or none", () => {
        expect(sectionOf({ type: "place", subType: "region" })).toBe("place");
        expect(sectionOf({ type: "affiliation", subType: "faithtradition" })).toBe("affiliation");
        expect(sectionOf({ type: "lore", subType: "deity" })).toBe("lore");
    });

    it("gives a doc with no subtype no section, and so no address", () => {
        expect(sectionOf({ type: "doc" })).toBeUndefined();
    });

    it("ignores the retired `category` key entirely", () => {
        expect(sectionOf({ type: "doc", category: "rules" })).toBeUndefined();
    });
});
