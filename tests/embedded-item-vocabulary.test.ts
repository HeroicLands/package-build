/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Which vocabulary an embedded-item reference speaks**.
 *
 * A being addresses its embedded items by `(type, shortcode)`, where `type` is
 * the *note's* type — the thing an author writes. The predefined items those
 * references resolve against are compiled documents, and a compiled document
 * carries its *subtype* — the thing Foundry stores. Until this change the two
 * were used interchangeably: the address map was keyed by `doc.type` and the
 * reference looked up verbatim, which agreed only because every SoHL row is
 * the identity.
 *
 * These tests hold the translation in place. They run against a **fixture
 * system**, not SoHL: every SoHL row is the identity — #78 briefly made three
 * of them otherwise and that rename is reversed — so SoHL alone cannot exercise
 * the translation. HM3's `projectilegear` → `missilegear` is the real
 * non-identity row, and the fixture stands in for that shape.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineDocumentSubtypes, referencedSubtype } from "../engine/document-subtypes.mjs";
import { RENAMED_TYPES } from "../engine/ids.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Actors } from "../sohl/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * A **fixture system** whose item rows are deliberately not the identity.
 *
 * `armorgear` → `armorgear` is the row #78 will add to SoHL; declaring it here
 * exercises the mechanism without moving a single compiled byte. It reads the
 * `sohl:` block so the frontmatter readers (`sohlField`) still find a being's
 * `items:` — the block a system writes and the vocabulary its types speak are
 * two independent questions, and only the second is under test.
 */
const DEMO = defineDocumentSubtypes({
    system: "demo",
    block: "sohl",
    types: {
        armorgear: { document: "Item", subType: "armorgear" },
        attribute: { document: "Item", subType: "attribute" },
        skill: { document: "Item", subType: "skill" },
        weapon: {
            document: "Item",
            discriminator: "kindOf",
            subTypes: ["weapongear", "missilegear"],
        },
        being: { document: "Actor", subType: "being" },
    },
});

describe("referencedSubtype (the note vocabulary → the document vocabulary)", () => {
    it("translates a reference's note type into the subtype the document carries", () => {
        // The whole defect in one assertion: an author writes `armorgear`, the
        // compiled document is an `armorgear`, and the address is the latter.
        expect(referencedSubtype(DEMO, "armorgear", "Item")).toEqual({ subType: "armorgear" });
    });

    it("leaves an identity row exactly where it was", () => {
        expect(referencedSubtype(DEMO, "skill", "Item")).toEqual({ subType: "skill" });
    });

    it("falls back to the note type for a type the system's map does not name", () => {
        // A consumer's own item type is declared in its `itemBuilders` table,
        // not in this system's map, and the Item pass stamps such a document
        // with the note type itself. The reference has to agree, or a
        // consumer's items would stop resolving the moment a map existed.
        expect(referencedSubtype(DEMO, "houserule", "Item")).toEqual({ subType: "houserule" });
    });

    it("refuses a type this system compiles into another document class", () => {
        const { subType, problem } = referencedSubtype(DEMO, "being", "Item");
        expect(subType).toBeUndefined();
        expect(problem).toMatch(/being/);
        expect(problem).toMatch(/Actor/);
    });

    it("refuses a one-to-many row, which a bare reference cannot resolve", () => {
        const { subType, problem } = referencedSubtype(DEMO, "weapon", "Item");
        expect(subType).toBeUndefined();
        expect(problem).toMatch(/weapongear/);
        expect(problem).toMatch(/missilegear/);
    });

    it("refuses a retired type by name, rather than letting it resolve as its own", () => {
        // Without this a reference in a retired spelling would take the
        // unmapped fallback and address a document of that name — which is
        // exactly what a rename leaves behind.
        const { subType, problem } = referencedSubtype(DEMO, "creature", "Item");
        expect(subType).toBeUndefined();
        expect(problem).toMatch(/being/);
    });

    it("refuses a reference that names no type at all", () => {
        expect(referencedSubtype(DEMO, "", "Item").problem).toBeTruthy();
        expect(referencedSubtype(DEMO, undefined, "Item").problem).toBeTruthy();
    });

    it("is the identity for every SoHL row", () => {
        // #78 briefly broke this for three rows; reversing that rename restores
        // it for all of them, so there is no exception list to carry.
        for (const type of Object.keys(SOHL_DOCUMENT_SUBTYPES.types)) {
            const row = SOHL_DOCUMENT_SUBTYPES.types[type];
            if (row.document !== "Item") continue;
            expect(referencedSubtype(SOHL_DOCUMENT_SUBTYPES, type, "Item"), type).toEqual({
                subType: type,
            });
        }
    });

    it("resolves a reference still on a renamed type's retired spelling", () => {
        // The half of the window that matters most: the old names occur ~1,000
        // times as often inside a being's `(type, shortcode)` items list as
        // they do as a note's own `type:`. A window that resolved notes but not
        // references would silently drop 30,000 embedded items.
        for (const [retired, current] of Object.entries(RENAMED_TYPES)) {
            expect(referencedSubtype(SOHL_DOCUMENT_SUBTYPES, retired, "Item"), retired).toEqual(
                referencedSubtype(SOHL_DOCUMENT_SUBTYPES, current, "Item"),
            );
        }
        expect(referencedSubtype(SOHL_DOCUMENT_SUBTYPES, "armorgear", "Item")).toEqual({
            subType: "armorgear",
        });
    });
});

/** The Actors pass, compiling against the fixture system's map. */
class DemoActors extends Actors {
    static documentSubtypes = DEMO;
}

/**
 * One compiled item document, as an Item pass leaves it in `build/packs-json`.
 *
 * @param subType - The Foundry Item subtype the document carries.
 * @param shortcode - Its `system.shortcode`.
 */
function compiledItem(subType: string, shortcode: string) {
    return {
        _id: `${subType}0000000000000`.slice(0, 16),
        _key: `!items!${subType}`,
        name: `A ${subType}`,
        type: subType,
        system: { shortcode, notes: "" },
        effects: [],
        flags: {},
        ownership: { default: 0 },
        folder: null,
        _stats: {},
    };
}

/**
 * A temporary Item-pack JSON tree, plus a being note the diagnostics can point
 * at, wired into an `Actors` pass reading the fixture system's map.
 *
 * @param items - The compiled documents to write into the tree.
 * @param frontmatter - The being note's YAML frontmatter, verbatim.
 */
async function withDemoPass(
    items: object[],
    frontmatter: string,
    run: (pass: DemoActors, said: string[], absPath: string) => Promise<void> | void,
) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-embedded-"));
    const itemsDir = path.join(dir, "items");
    fs.mkdirSync(itemsDir);
    items.forEach((doc, index) => {
        fs.writeFileSync(path.join(itemsDir, `item_${index}.json`), JSON.stringify(doc), "utf8");
    });
    const absPath = path.join(dir, "Ancient_Warrior.md");
    fs.writeFileSync(absPath, `---\n${frontmatter}---\n\nA warrior.\n`, "utf8");

    const said: string[] = [];
    const error = vi
        .spyOn(console, "error")
        .mockImplementation((line: unknown) => void said.push(String(line)));
    const warn = vi
        .spyOn(console, "warn")
        .mockImplementation((line: unknown) => void said.push(String(line)));
    try {
        const pass = new DemoActors({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: loadPackConfig().paths.packJson,
            itemsSourceDirs: [itemsDir],
        });
        await pass.prepare();
        pass.currentNote = { absPath };
        await run(pass, said, absPath);
    } finally {
        error.mockRestore();
        warn.mockRestore();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** The frontmatter of a being carrying one `sohl.items` entry. */
function beingNote(entry: string): string {
    return [
        "id: EEEEEEEEEEEEEEEE",
        "type: being",
        "shortcode: warr",
        "name:",
        "    full: Ancient Warrior",
        "sohl:",
        "    archetype: null",
        "    items:",
        `        - ${entry}`,
        "",
    ].join("\n");
}

describe("a being's embedded items, end to end through the translation", () => {
    it("resolves a reference written in the note vocabulary", async () => {
        await withDemoPass(
            [compiledItem("armorgear", "hlmt")],
            beingNote("{ model: armor-hlmt }"),
            (pass) => {
                // Loaded from the compiled tree, keyed by the subtype the
                // document carries — and, since #334, under this package's name
                // as well, so a `model:` that states the package resolves to
                // the same item and nothing local can shadow it.
                expect([...pass.itemsMap.keys()].sort()).toEqual([
                    "armorgear:hlmt",
                    "sohl:armorgear:hlmt",
                ]);

                const doc = pass.buildEntry(
                    {
                        id: "EEEEEEEEEEEEEEEE",
                        type: "being",
                        shortcode: "warr",
                        name: { full: "Ancient Warrior" },
                        sohl: {
                            archetype: null,
                            items: [{ model: "armorgear-hlmt" }],
                        },
                    },
                    "",
                );
                expect(pass.errorCount).toBe(0);
                expect(doc.items).toHaveLength(1);
                // The *document* vocabulary on the embedded item, whatever the
                // note called the type.
                expect(doc.items[0].type).toBe("armorgear");
                expect(doc.items[0].system.shortcode).toBe("hlmt");
            },
        );
    });

    it("stamps a stand-alone entry with the subtype too, not the note type", async () => {
        // The half with no lookup to fail: an entry carrying no shortcode is
        // built from the reference alone, so the note type used to become the
        // document's subtype outright — a document of a subtype the system
        // does not define, and nothing said.
        await withDemoPass([], beingNote("{ type: armor, name: Scavenged Helm }"), (pass) => {
            const doc = pass.buildEntry(
                {
                    id: "EEEEEEEEEEEEEEEE",
                    type: "being",
                    shortcode: "warr",
                    name: { full: "Ancient Warrior" },
                    sohl: {
                        archetype: null,
                        items: [
                            { type: "armorgear", name: "Scavenged Helm", system: { quality: 1 } },
                        ],
                    },
                },
                "",
            );
            expect(pass.errorCount).toBe(0);
            expect(doc.items).toHaveLength(1);
            expect(doc.items[0].type).toBe("armorgear");
        });
    });

    it("refuses a retired top-level `shortcode`, naming `model`", async () => {
        await withDemoPass(
            [compiledItem("armorgear", "hlmt")],
            beingNote("{ model: armor-hlmt }"),
            (pass, said) => {
                pass.buildEntry(
                    {
                        id: "EEEEEEEEEEEEEEEE",
                        type: "being",
                        shortcode: "warr",
                        name: { full: "Ancient Warrior" },
                        sohl: {
                            archetype: null,
                            items: [{ shortcode: "hlmt", type: "armorgear" }],
                        },
                    },
                    "",
                );
                expect(pass.errorCount).toBe(1);
                const finding = said.find((l) => l.includes("shortcode"));
                // The message names the replacement and the distinction the old
                // key blurred: a selector versus this item's own identity.
                expect(finding).toContain("`model:`");
                expect(finding).toContain("system.shortcode");
            },
        );
    });

    it("refuses `type` beside a `model` — the address already names it", async () => {
        await withDemoPass(
            [compiledItem("armorgear", "hlmt")],
            beingNote("{ model: armor-hlmt }"),
            (pass, said) => {
                pass.buildEntry(
                    {
                        id: "EEEEEEEEEEEEEEEE",
                        type: "being",
                        shortcode: "warr",
                        name: { full: "Ancient Warrior" },
                        sohl: {
                            archetype: null,
                            items: [{ model: "armorgear-hlmt", type: "armorgear" }],
                        },
                    },
                    "",
                );
                expect(pass.errorCount).toBe(1);
                expect(said.find((l) => l.includes("both"))).toContain("Drop `type`");
            },
        );
    });

    it("reports a `model` that is not an address at all", async () => {
        await withDemoPass(
            [compiledItem("armorgear", "hlmt")],
            beingNote("{ model: armor-hlmt }"),
            (pass, said) => {
                pass.buildEntry(
                    {
                        id: "EEEEEEEEEEEEEEEE",
                        type: "being",
                        shortcode: "warr",
                        name: { full: "Ancient Warrior" },
                        sohl: { archetype: null, items: [{ model: "Helmet" }] },
                    },
                    "",
                );
                expect(pass.errorCount).toBe(1);
                expect(said.find((l) => l.includes("Helmet"))).toContain("is not an address");
            },
        );
    });

    it("reports a reference that resolves to nothing, naming the note and the reference", async () => {
        await withDemoPass(
            [compiledItem("armorgear", "hlmt")],
            beingNote("{ model: armor-brst }"),
            (pass, said, absPath) => {
                pass.buildEntry(
                    {
                        id: "EEEEEEEEEEEEEEEE",
                        type: "being",
                        shortcode: "warr",
                        name: { full: "Ancient Warrior" },
                        sohl: {
                            archetype: null,
                            items: [{ model: "armorgear-brst" }],
                        },
                    },
                    "",
                );
                expect(pass.errorCount).toBe(1);
                const finding = said.find((line) => line.includes("brst"));
                expect(finding).toBeTruthy();
                // `path:line:column: severity: message`, the path first.
                expect(
                    finding!.startsWith(absPath) || finding!.includes("Ancient_Warrior.md"),
                ).toBe(true);
                expect(finding).toMatch(/error:/);
                expect(finding).toContain("Ancient Warrior");
                // The reference as authored. SoHL's note and document
                // vocabularies spell every row the same word again now that
                // #78's rename is reversed, so there is no second spelling to
                // show here; HM3's `projectilegear` → `missilegear` is where
                // the two still differ.
                expect(finding).toContain("armorgear:brst");
                // Located at the reference, not merely at the note.
                expect(finding).toMatch(/Ancient_Warrior\.md:\d+/);
            },
        );
    });

    it("reports a reference whose type this system compiles into no item", async () => {
        await withDemoPass(
            [compiledItem("armorgear", "hlmt")],
            beingNote("{ model: weapon-swrd }"),
            (pass, said) => {
                pass.buildEntry(
                    {
                        id: "EEEEEEEEEEEEEEEE",
                        type: "being",
                        shortcode: "warr",
                        name: { full: "Ancient Warrior" },
                        sohl: {
                            archetype: null,
                            items: [{ model: "weapon-swrd" }],
                        },
                    },
                    "",
                );
                expect(pass.errorCount).toBe(1);
                const finding = said.find((line) => line.includes("weapon"));
                expect(finding).toMatch(/error:/);
                expect(finding).toContain("Ancient Warrior");
                expect(finding).toMatch(/weapongear/);
            },
        );
    });
});
