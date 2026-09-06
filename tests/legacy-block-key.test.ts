/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A field's shared source and its legacy in-block key are two declarations**
 * (#305).
 *
 * `FieldSpec.name` carried both jobs, and they came apart the moment `data:`
 * (#128) put every type-specific fact under a container. The resolution order
 * reads four positions, and steps 2 and 3 were both keyed on `name`:
 *
 * 1. `<block>.system.<to>`
 * 2. `<block>.<name>` — the legacy in-block position
 * 3. the shared top-level source `<name>` declares
 * 4. the field's default
 *
 * So `name: "species"` reached `hm3.species` and could not see `data.species`,
 * while `name: "data.species"` reached `data.species` and could not see
 * `hm3.species` — each spelling yielding the **default**, silently, wherever
 * only the other position was authored. No value of one property does both
 * jobs, which is why every other retirement in this package — `package:`,
 * `image`, `archetype` — could read both spellings during the sweep and this
 * one could not.
 *
 * `legacyKey` separates them: `name` is the shared source, `legacyKey` is the
 * key under the system block, and step 2 keys on it. Absent, it falls back to
 * `name`, so every declaration written before this change resolves exactly as
 * it did.
 */

import { describe, it, expect } from "vitest";

import { legacyKeyOf, resolveFieldValue } from "../engine/system-block.mjs";
import { buildFromFields, readField, readsLegacyKey, STRING } from "../engine/field-spec.mjs";
import { legacyKeyMessage } from "../engine/retired-fields.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { parseContentFormat } from "../engine/content-format.mjs";
import { checkDeclaredFields } from "../engine/content-format-check.mjs";

/** The field the issue is written about: HM3's species, mid-sweep. */
const SPECIES = Object.freeze({
    name: "data.species",
    legacyKey: "species",
    to: "species",
    ...STRING,
    default: "",
    describe: "The kind of creature this is.",
});

/* --------------------------------------------------------------------- */
/*  The four positions, for a field that declares both                    */
/* --------------------------------------------------------------------- */

describe("a field declaring a shared source and a legacy in-block key", () => {
    it("prefers `<block>.system.<to>`, authored at the destination", () => {
        const fm = {
            data: { species: "sindarin" },
            hm3: { species: "human", system: { species: "khuzdul" } },
        };
        expect(resolveFieldValue(SPECIES, fm, { block: "hm3" })).toEqual({
            value: "khuzdul",
            from: "system",
        });
    });

    it("reads the legacy in-block key ahead of the shared source", () => {
        // The current position wins: a note that has not been swept yet is
        // still saying what it means, and the sweep has not run.
        const fm = { data: { species: "sindarin" }, hm3: { species: "human" } };
        expect(resolveFieldValue(SPECIES, fm, { block: "hm3" })).toEqual({
            value: "human",
            from: "block",
        });
    });

    it("reads the shared source when the block carries no legacy key", () => {
        const fm = { data: { species: "sindarin" } };
        expect(resolveFieldValue(SPECIES, fm, { block: "hm3" })).toEqual({
            value: "sindarin",
            from: "shared",
        });
    });

    it("falls back to the field's own default", () => {
        expect(resolveFieldValue(SPECIES, { hm3: {} }, { block: "hm3" })).toEqual({
            value: "",
            from: "default",
        });
    });
});

/* --------------------------------------------------------------------- */
/*  The two silent defaults the issue measured                            */
/* --------------------------------------------------------------------- */

describe("neither spelling of `name` alone can read both positions", () => {
    const plain = { name: "species", to: "species", ...STRING, default: "", describe: "" };
    const dotted = { name: "data.species", to: "species", ...STRING, default: "", describe: "" };

    it("a plain name cannot see the shared source", () => {
        expect(
            resolveFieldValue(plain, { data: { species: "sindarin" } }, { block: "hm3" }),
        ).toEqual({ value: "", from: "default" });
    });

    it("a dotted name cannot see the legacy in-block key", () => {
        expect(resolveFieldValue(dotted, { hm3: { species: "human" } }, { block: "hm3" })).toEqual({
            value: "",
            from: "default",
        });
    });

    it("declaring both reads either, wherever the note wrote it", () => {
        expect(
            resolveFieldValue(SPECIES, { data: { species: "sindarin" } }, { block: "hm3" }).value,
        ).toBe("sindarin");
        expect(
            resolveFieldValue(SPECIES, { hm3: { species: "human" } }, { block: "hm3" }).value,
        ).toBe("human");
    });
});

/* --------------------------------------------------------------------- */
/*  Backwards compatibility                                               */
/* --------------------------------------------------------------------- */

describe("a declaration that names no legacy key", () => {
    it("keys the in-block position on `name`, as before", () => {
        const field = { name: "weight", to: "weightBase", ...STRING, default: "", describe: "" };
        expect(legacyKeyOf(field)).toBe("weight");
        expect(resolveFieldValue(field, { sohl: { weight: "7" } }).from).toBe("block");
    });

    it("keys it on a dotted `name` too — a literal key, as it always did", () => {
        const field = { name: "data.portrait", to: "portrait", default: "", describe: "" };
        expect(legacyKeyOf(field)).toBe("data.portrait");
    });
});

/* --------------------------------------------------------------------- */
/*  The sweep's progress signal                                           */
/* --------------------------------------------------------------------- */

describe("reading the legacy position is reported", () => {
    it("is true only for a field that declares a legacy key", () => {
        expect(readsLegacyKey(SPECIES, "block")).toBe(true);
        expect(readsLegacyKey(SPECIES, "shared")).toBe(false);
        expect(readsLegacyKey(SPECIES, "system")).toBe(false);
        // A field with no separate legacy key is not mid-sweep: the in-block
        // position is where it lives, and reporting it would be noise on every
        // note in every tree.
        expect(readsLegacyKey({ name: "weight" }, "block")).toBe(false);
    });

    it("names the key written, the source to write, and says the note compiles", () => {
        const message = legacyKeyMessage("hm3", SPECIES);
        expect(message).toContain("`hm3.species:`");
        expect(message).toContain("`data.species:`");
        expect(message).toContain("compiles");
    });

    it("hands the reader each field it read from the legacy position", () => {
        const seen: string[] = [];
        const build = buildFromFields([SPECIES], {
            block: "hm3",
            onLegacyKey: (field: any) => seen.push(field.name),
        });
        build({ hm3: { species: "human" } });
        expect(seen).toEqual(["data.species"]);

        seen.length = 0;
        build({ data: { species: "sindarin" } });
        expect(seen).toEqual([]);
    });
});

/* --------------------------------------------------------------------- */
/*  The coercion is the field's, wherever the value came from             */
/* --------------------------------------------------------------------- */

describe("the coercion does not depend on the position", () => {
    it("applies `read` to the legacy value and the shared one alike", () => {
        expect(readField(SPECIES, { hm3: { species: 7 } }, { block: "hm3" })).toBe("7");
        expect(readField(SPECIES, { data: { species: 7 } }, { block: "hm3" })).toBe("7");
    });
});

/* --------------------------------------------------------------------- */
/*  What the frontmatter lint makes of a field mid-sweep                  */
/* --------------------------------------------------------------------- */

describe("the frontmatter lint, for a field that declares both positions", () => {
    /** A `being` schema holding exactly the field under test. */
    const schemas = { being: [SPECIES] };

    const lint = (fm: object) =>
        lintNote(
            { file: "/tree/being.md", type: "being", raw: "---\ntype: being\n---\n", fm },
            { schemas: schemas as any, index: undefined as any, vocabulary: undefined as any },
        ).map((f: any) => `${f.severity}: ${f.message}`);

    it("accepts the legacy key as a key of the block", () => {
        // Without this the block vocabulary would be built from `data.species`
        // and report `sohl.species` as a property no `being` has — an error
        // against the exact notes the sweep has not reached yet.
        const findings = lint({ type: "being", sohl: { species: "human" } });
        expect(findings.join("\n")).not.toContain("is not a property of a being");
    });

    it("reports the legacy read as a warning, not an error", () => {
        // A warning because the note compiles to the correct document: failing
        // a build over it would red a tree that has done nothing wrong yet.
        const findings = lint({ type: "being", sohl: { species: "human" } });
        expect(findings.join("\n")).toContain("legacy position");
        expect(findings.some((f: string) => f.startsWith("warning:"))).toBe(true);
        expect(findings.some((f: string) => f.startsWith("error:"))).toBe(false);
    });

    it("says nothing once the note authors the shared source", () => {
        expect(lint({ type: "being", data: { species: "sindarin" } }).join("\n")).not.toContain(
            "legacy position",
        );
    });

    it("says nothing about a field that declares no legacy key", () => {
        const plain = {
            schemas: { being: [{ ...SPECIES, name: "species", legacyKey: undefined }] },
        };
        const findings = lintNote(
            {
                file: "/tree/being.md",
                type: "being",
                raw: "---\ntype: being\n---\n",
                fm: { type: "being", sohl: { species: "human" } },
            },
            { ...plain, index: undefined, vocabulary: undefined } as any,
        );
        expect(messagesOf(findings)).not.toContain("legacy position");
    });
});

/** The findings' messages, joined — the shape every assertion above reads. */
function messagesOf(findings: Array<{ message: string }>) {
    return findings.map((f) => f.message).join("\n");
}

/* --------------------------------------------------------------------- */
/*  The specification's own rows, matched against a moved declaration     */
/* --------------------------------------------------------------------- */

describe("the format check, for a declaration whose source moved under `data:`", () => {
    /** One `data.` row, as `docs/content-format.md` states them. */
    const SPEC = [
        "### type: affiliation",
        "",
        "| shared source | → sohl        |",
        "| ------------- | ------------- |",
        "| `data.seat`   | `system.seat` |",
        "",
    ].join("\n");

    const format = () => parseContentFormat(SPEC, { file: "spec.md" });

    it("pairs a `data.`-named field with the row that states it", () => {
        // The check strips `data.` off the specification's source; before #305
        // no declaration could carry the prefix, so a field that now does has
        // to normalize on both sides or the row would read as unmapped.
        const declared = {
            affiliation: [
                { name: "data.seat", legacyKey: "seat", to: "seat", describe: "Where it sits." },
            ],
        };
        const { findings, fields } = checkDeclaredFields({
            format: format(),
            itemFields: declared,
            system: "sohl",
        });
        expect(findings).toEqual([]);
        expect(fields).toBe(1);
    });

    it("still reports a moved field that writes somewhere else", () => {
        const drifted = {
            affiliation: [
                { name: "data.seat", legacyKey: "seat", to: "capital", describe: "Where it sits." },
            ],
        };
        const { findings } = checkDeclaredFields({
            format: format(),
            itemFields: drifted,
            system: "sohl",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].class).toBe("field-drift");
    });

    it("counts the field under its shared key, not under `data`", () => {
        const declared = {
            affiliation: [
                { name: "data.seat", legacyKey: "seat", to: "seat", describe: "Where it sits." },
            ],
        };
        const { coverage } = checkDeclaredFields({
            format: format(),
            itemFields: declared,
            system: "sohl",
        });
        expect(coverage[0].registryOnly).not.toContain("data");
        expect(coverage[0].specOnly).not.toContain("seat");
    });
});
