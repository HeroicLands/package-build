/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The art an embedded item carries, and the container it does not.**
 *
 * A being's `<system>.items` entry is an item in every respect but where it is
 * written, so it compiles under the two rules an item note does: the `icon`
 * address it names under `data:` resolves into `img`, and an entry naming none
 * takes the default its type pairs in the `itemBuilders` registry. `data:`
 * itself is the authoring container and reaches no compiled document — an
 * entry's, a note's, anybody's.
 *
 * Both shapes of entry are covered, because they reach `img` differently: an
 * entry copying a `model:` inherits the catalogue document's art and may
 * override it, while an entry copying nothing has only its own `data:` and the
 * type's default to draw on.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Actors } from "../sohl/actors.mjs";
import { DEFAULT_ITEM_ART } from "../sohl/default-item-art.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The default a `miscgear` takes, in the form a compiled document carries. */
const MISCGEAR_ART = "systems/sohl/assets/icons/other/question-mark.svg";

/** The default a `skill` takes, likewise resolved. */
const SKILL_ART = "systems/sohl/assets/icons/other/head-gear.svg";

/**
 * A compile index holding one icon, so an entry naming its address resolves.
 *
 * Shaped as {@link module:engine/art-fields.assetAddressIndex}'s result is in
 * the parts the resolver reads.
 */
function indexWithIcon(shortcode: string, assetPath: string): any {
    return {
        types: new Set(["icon", "image", "audio"]),
        packages: new Set(["sohl"]),
        contentPackage: "sohl",
        assets: new Map([
            [`sohl-none-icon-${shortcode}`, { package: "sohl", asset: { path: assetPath } }],
        ]),
        foreign: new Map(),
    };
}

/** One compiled item document, as the Item pass leaves it in `build/packs-json`. */
function compiledItem(subType: string, shortcode: string, img: string) {
    return {
        _id: `${subType}0000000000000`.slice(0, 16),
        _key: `!items!${subType}`,
        name: `A ${subType}`,
        type: subType,
        img,
        system: { shortcode, notes: "" },
        effects: [],
        flags: {},
        ownership: { default: 0 },
        folder: null,
        _stats: {},
    };
}

/** A being note carrying the given `sohl.items` entries. */
function being(items: object[]) {
    return {
        id: "EEEEEEEEEEEEEEEE",
        type: "being",
        shortcode: "warr",
        name: { full: "Ancient Warrior" },
        sohl: { archetype: null, items },
    };
}

/**
 * An `Actors` pass reading a temporary Item-pack tree, with an index in which
 * `sohl-none-icon-quiver` is a real file.
 *
 * @param catalogue - The compiled documents an entry's `model:` may name.
 * @param run - What to assert, given the prepared pass.
 */
async function withPass(catalogue: object[], run: (pass: any) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-embedded-art-"));
    const itemsDir = path.join(dir, "items");
    fs.mkdirSync(itemsDir);
    catalogue.forEach((doc, index) => {
        fs.writeFileSync(path.join(itemsDir, `item_${index}.json`), JSON.stringify(doc), "utf8");
    });
    const absPath = path.join(dir, "Ancient_Warrior.md");
    fs.writeFileSync(absPath, "---\ntype: being\n---\n\nA warrior.\n", "utf8");
    try {
        const pass = new Actors({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: loadPackConfig().paths.packJson,
            itemsSourceDirs: [itemsDir],
        });
        await pass.prepare();
        // After `prepare`, which builds the corpus index this replaces.
        pass.linkIndex = indexWithIcon("quiver", "icons/other/quiver.svg");
        pass.currentNote = { absPath };
        run(pass);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("an entry that copies nothing", () => {
    it("resolves the `icon` address it names into `img`", async () => {
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Quiver (leather)",
                        type: "miscgear",
                        data: { icon: "sohl-none-icon-quiver" },
                        system: { shortcode: "quiver" },
                    },
                ]),
                "",
            );
            expect(pass.errorCount).toBe(0);
            expect(doc.items[0].img).toBe("systems/sohl/assets/icons/other/quiver.svg");
        });
    });

    it("reads a bare shortcode as an `icon`, the slot's declared type", async () => {
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Quiver (leather)",
                        type: "miscgear",
                        data: { icon: "quiver" },
                        system: { shortcode: "quiver" },
                    },
                ]),
                "",
            );
            expect(doc.items[0].img).toBe("systems/sohl/assets/icons/other/quiver.svg");
        });
    });

    it("takes its type's default art when it names none", async () => {
        // The contrast the defect turned on: an entry copying a `model:`
        // inherited art, an entry copying nothing shipped a document with no
        // `img` at all and Foundry's fallback on the sheet.
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([
                    { name: "Whetstone", type: "miscgear", system: { shortcode: "whetstone" } },
                    { name: "Haggling", type: "skill", system: { shortcode: "hagl" } },
                ]),
                "",
            );
            expect(pass.errorCount).toBe(0);
            expect(DEFAULT_ITEM_ART.miscgear).toBe("sohl/assets/icons/other/question-mark.svg");
            expect(doc.items[0].img).toBe(MISCGEAR_ART);
            expect(doc.items[1].img).toBe(SKILL_ART);
        });
    });

    it("ships blank on purpose where it writes an empty `icon`", async () => {
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Whetstone",
                        type: "miscgear",
                        data: { icon: "" },
                        system: { shortcode: "whetstone" },
                    },
                ]),
                "",
            );
            expect(doc.items[0].img).toBe("");
        });
    });

    it("takes the default where the address it names answers nothing", async () => {
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Whetstone",
                        type: "miscgear",
                        data: { icon: "sohl-none-icon-nosuchfile" },
                        system: { shortcode: "whetstone" },
                    },
                ]),
                "",
            );
            // Reported, and the document takes its default rather than a path
            // that installs nowhere.
            expect(doc.items[0].img).toBe(MISCGEAR_ART);
        });
    });
});

describe("an entry that copies a `model:`", () => {
    it("keeps the catalogue document's art when it names none of its own", async () => {
        await withPass(
            [compiledItem("miscgear", "sack", "systems/sohl/assets/icons/other/sack.svg")],
            (pass) => {
                const doc = pass.buildEntry(being([{ model: "miscgear-sack" }]), "");
                expect(pass.errorCount).toBe(0);
                expect(doc.items[0].img).toBe("systems/sohl/assets/icons/other/sack.svg");
            },
        );
    });

    it("overrides it with the address the entry names", async () => {
        await withPass(
            [compiledItem("miscgear", "sack", "systems/sohl/assets/icons/other/sack.svg")],
            (pass) => {
                const doc = pass.buildEntry(
                    being([{ model: "miscgear-sack", data: { icon: "quiver" } }]),
                    "",
                );
                expect(doc.items[0].img).toBe("systems/sohl/assets/icons/other/quiver.svg");
            },
        );
    });
});

describe("`data:` reaches no compiled document", () => {
    it("is held back from a stand-alone entry", async () => {
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Quiver (leather)",
                        type: "miscgear",
                        data: { icon: "quiver" },
                        system: { shortcode: "quiver" },
                    },
                ]),
                "",
            );
            expect(doc.items[0]).not.toHaveProperty("data");
        });
    });

    it("is held back from an entry copying a `model:`", async () => {
        await withPass(
            [compiledItem("miscgear", "sack", "systems/sohl/assets/icons/other/sack.svg")],
            (pass) => {
                const doc = pass.buildEntry(
                    being([{ model: "miscgear-sack", data: { icon: "quiver" } }]),
                    "",
                );
                expect(doc.items[0]).not.toHaveProperty("data");
            },
        );
    });

    it("leaves nothing behind on the actor either", async () => {
        await withPass([], (pass) => {
            const doc = pass.buildEntry(
                being([{ name: "Whetstone", type: "miscgear", system: { shortcode: "whet" } }]),
                "",
            );
            expect(doc).not.toHaveProperty("data");
            for (const item of doc.items) expect(item).not.toHaveProperty("data");
        });
    });
});
