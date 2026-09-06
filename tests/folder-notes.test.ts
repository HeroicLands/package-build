/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A folder is a note (#256), addressed like every other note, and the defects
 * that made it worth changing are asserted here as *unrepresentable* rather
 * than merely fixed:
 *
 * - a dead `parent` is a dead-address finding, not a special-cased
 *   `Unknown folder id`;
 * - a parent cycle is refused, at index time, whether or not anything
 *   references the folder carrying it;
 * - an id is derived from the address when none is authored (#258), and an
 *   authored one still wins, so a world already holding these folders keeps
 *   resolving them.
 */

import { describe, it, expect } from "vitest";

import {
    FOLDER_TYPE,
    bareAddress,
    buildFolderNoteIndex,
    collectFolderNotes,
    folderAddress,
    folderDocument,
} from "../engine/folder-notes.mjs";
import { makeId } from "../engine/ids.mjs";

/** One walk entry, as `walkMarkdownTree` yields it. */
const note = (fm: Record<string, unknown>, absPath = `/content/${fm.shortcode}.md`) => ({
    frontmatter: { type: FOLDER_TYPE, ...fm },
    absPath,
});

/** The three folders every hierarchy test below uses. */
const TREE = [
    note({ shortcode: "possessions", name: { full: "Possessions" }, data: {} }),
    note({
        shortcode: "miscgear",
        name: { full: "Misc Gear" },
        data: { parent: "possessions" },
    }),
    note({
        shortcode: "cooking",
        name: { full: "Cooking" },
        data: { parent: "miscgear", color: "#7a4b2a" },
    }),
];

describe("collectFolderNotes", () => {
    it("reads only folder notes, and takes parent and color from `data:`", () => {
        const folders = collectFolderNotes(
            [...TREE, note({ type: "skill", shortcode: "melee" })],
            "sohl",
        );
        expect(folders.map((f) => f.shortcode)).toEqual(["possessions", "miscgear", "cooking"]);
        const cooking = folders[2];
        expect(cooking.name).toBe("Cooking");
        expect(cooking.color).toBe("#7a4b2a");
        expect(cooking.parent).toEqual({ default: "miscgear" });
    });

    it("addresses a folder `<package>-none-folder-<shortcode>`", () => {
        // `none`, because a Folder is a core Foundry document like a
        // JournalEntry — not a system's.
        const [possessions] = collectFolderNotes(TREE, "sohl");
        expect(possessions.address).toBe("sohl-none-folder-possessions");
        expect(folderAddress("thalorna", "cooking")).toBe("thalorna-none-folder-cooking");
    });

    it("refuses a shortcode carrying the address separator", () => {
        // #256's own example wrote `possessions-cooking`, which cannot be an
        // address: parsing counts separators, so it would read as two segments
        // and resolve to nothing.
        expect(() =>
            collectFolderNotes([note({ shortcode: "possessions-cooking" })], "sohl"),
        ).toThrow(/not strictly alphanumeric/);
    });

    it("refuses a folder note with no shortcode", () => {
        expect(() => collectFolderNotes([note({ name: { full: "Nameless" } })], "sohl")).toThrow(
            /no shortcode/,
        );
    });

    it("accepts parent and color at the top level as well as under `data:`", () => {
        // The specification puts them under `data:`; #256's example wrote them
        // at the top level. An author following either should get a folder.
        const [folder] = collectFolderNotes(
            [note({ shortcode: "cooking", parent: "miscgear", color: "#123456" })],
            "sohl",
        );
        expect(folder.parent).toEqual({ default: "miscgear" });
        expect(folder.color).toBe("#123456");
    });
});

describe("a folder's Foundry id (#258)", () => {
    it("is derived from the canonical address when none is authored", () => {
        const [possessions] = collectFolderNotes(TREE, "sohl");
        expect(possessions.derivedId).toBe(true);
        expect(possessions.id).toBe(makeId("folder", "sohl-none-folder-possessions"));
    });

    it("is stable across runs, and distinct per folder", () => {
        const first = collectFolderNotes(TREE, "sohl").map((f) => f.id);
        const second = collectFolderNotes(TREE, "sohl").map((f) => f.id);
        expect(first).toEqual(second);
        expect(new Set(first).size).toBe(3);
    });

    it("keeps an authored id, so an existing world keeps resolving", () => {
        const [folder] = collectFolderNotes(
            [note({ shortcode: "poisons", id: "ONXsqZAIZr2qzxTb" })],
            "sohl",
        );
        expect(folder.id).toBe("ONXsqZAIZr2qzxTb");
        expect(folder.derivedId).toBe(false);
    });

    it("refuses two folders claiming one id", () => {
        expect(() =>
            buildFolderNoteIndex(
                collectFolderNotes(
                    [
                        note({ shortcode: "one", id: "SHAREDIDSHAREDID" }),
                        note({ shortcode: "two", id: "SHAREDIDSHAREDID" }),
                    ],
                    "sohl",
                ),
            ),
        ).toThrow(/claimed twice/);
    });
});

describe("buildFolderNoteIndex", () => {
    const index = () => buildFolderNoteIndex(collectFolderNotes(TREE, "sohl"));

    it("resolves every admitted form of the address", () => {
        const idx = index();
        for (const form of [
            "cooking",
            "folder-cooking",
            "sohl-none-folder-cooking",
            "[[folder-cooking]]",
            "[[cooking|Cooking]]",
        ]) {
            expect(idx.resolve(form).shortcode).toBe("cooking");
        }
    });

    it("reports a dead address as a dead address, naming what it does declare", () => {
        expect(() => index().resolve("kitchen")).toThrow(/no folder note is addressed "kitchen"/);
        expect(() => index().resolve("kitchen")).toThrow(/cooking, miscgear, possessions/);
    });

    it("refuses a dangling parent when the index is built, not when it is used", () => {
        expect(() =>
            buildFolderNoteIndex(
                collectFolderNotes(
                    [note({ shortcode: "orphan", data: { parent: "nowhere" } })],
                    "sohl",
                ),
            ),
        ).toThrow(/names a parent that/);
    });

    it("refuses a parent cycle", () => {
        expect(() =>
            buildFolderNoteIndex(
                collectFolderNotes(
                    [
                        note({ shortcode: "a", data: { parent: "b" } }),
                        note({ shortcode: "b", data: { parent: "a" } }),
                    ],
                    "sohl",
                ),
            ),
        ).toThrow(/parent cycle/);
    });

    it("refuses two folders sharing a shortcode", () => {
        expect(() =>
            buildFolderNoteIndex(
                collectFolderNotes(
                    [note({ shortcode: "dup" }, "/a.md"), note({ shortcode: "dup" }, "/b.md")],
                    "sohl",
                ),
            ),
        ).toThrow(/share the shortcode/);
    });

    it("walks ancestors nearest-first, so a pack can materialise the whole chain", () => {
        const idx = index();
        const chain = idx.ancestorsOf(idx.resolve("cooking"));
        expect(chain.map((f) => f.shortcode)).toEqual(["miscgear", "possessions"]);
        expect(idx.ancestorsOf(idx.resolve("possessions"))).toEqual([]);
    });
});

describe("folderDocument", () => {
    const stats = { createdTime: 0 };

    it("carries the parent's id, and the key Foundry files it under", () => {
        const idx = buildFolderNoteIndex(collectFolderNotes(TREE, "sohl"));
        const cooking = idx.resolve("cooking");
        const doc = folderDocument(cooking, idx.parentOf(cooking), "Item", stats);
        expect(doc).toMatchObject({
            name: "Cooking",
            type: "Item",
            _id: cooking.id,
            folder: idx.resolve("miscgear").id,
            color: "#7a4b2a",
            sorting: "a",
            _key: `!folders!${cooking.id}`,
        });
    });

    it("gives a root folder a null parent", () => {
        const idx = buildFolderNoteIndex(collectFolderNotes(TREE, "sohl"));
        const root = idx.resolve("possessions");
        expect(folderDocument(root, idx.parentOf(root), "Item", stats).folder).toBeNull();
    });

    it("shares one id across the packs it materialises in", () => {
        // The whole point of #257: a documentation journal filed beside its
        // item must land in the *same* folder, not one that looks alike.
        const idx = buildFolderNoteIndex(collectFolderNotes(TREE, "sohl"));
        const cooking = idx.resolve("cooking");
        const asItem = folderDocument(cooking, idx.parentOf(cooking), "Item", stats);
        const asJournal = folderDocument(cooking, idx.parentOf(cooking), "JournalEntry", stats);
        expect(asItem._id).toBe(asJournal._id);
        expect(asItem.type).toBe("Item");
        expect(asJournal.type).toBe("JournalEntry");
    });
});

describe("bareAddress", () => {
    it("strips brackets and a label, and treats blank as absent", () => {
        expect(bareAddress("[[folder-cooking|Cooking]]")).toBe("folder-cooking");
        expect(bareAddress("  cooking  ")).toBe("cooking");
        expect(bareAddress("")).toBeNull();
        expect(bareAddress(null)).toBeNull();
    });
});

describe("a folder's hierarchy is per-pack, its identity is not", () => {
    // Both large trees rely on this deliberately: this repository files the
    // three item roots one level deeper in the journals pack, and
    // `sohl-thalorna` groups the items pack by document kind and the journals
    // pack by setting geography — 46 of its 75 shared folders differ. A single
    // scalar cannot express either.
    const PER_PACK = [
        note({ shortcode: "rules", name: { full: "Rules" } }),
        note({
            shortcode: "descriptions",
            name: { full: "Descriptions" },
            data: { parent: "rules" },
        }),
        note({
            shortcode: "possessions",
            name: { full: "Possessions" },
            // Root in the items pack; under Rules/Descriptions in journals.
            data: { parent: { default: null, journals: "descriptions" } },
        }),
    ];

    const index = () => buildFolderNoteIndex(collectFolderNotes(PER_PACK, "sohl"));

    it("reads a parent map, keeping an explicit null as `root here`", () => {
        const [, , possessions] = collectFolderNotes(PER_PACK, "sohl");
        expect(possessions.parent).toEqual({ default: null, journals: "descriptions" });
    });

    it("gives one folder a different parent in each pack", () => {
        const idx = index();
        const possessions = idx.resolve("possessions");
        expect(idx.parentOf(possessions, "items")).toBeNull();
        expect(idx.parentOf(possessions, "journals")?.shortcode).toBe("descriptions");
    });

    it("walks the chain the folder has in that pack", () => {
        const idx = index();
        const possessions = idx.resolve("possessions");
        expect(idx.ancestorsOf(possessions, "items")).toEqual([]);
        expect(idx.ancestorsOf(possessions, "journals").map((f) => f.shortcode)).toEqual([
            "descriptions",
            "rules",
        ]);
    });

    it("keeps the same id in both, which is what files a doc beside its item", () => {
        const idx = index();
        const possessions = idx.resolve("possessions");
        const asItem = folderDocument(possessions, idx.parentOf(possessions, "items"), "Item", {});
        const asJournal = folderDocument(
            possessions,
            idx.parentOf(possessions, "journals"),
            "JournalEntry",
            {},
        );
        expect(asItem._id).toBe(asJournal._id);
        expect(asItem.folder).toBeNull();
        expect(asJournal.folder).toBe(idx.resolve("descriptions").id);
    });

    it("refuses a cycle that exists only in one pack", () => {
        // Sound by default, circular in the journals pack — still a broken
        // tree, and nothing else would look at it until that pack compiled.
        expect(() =>
            buildFolderNoteIndex(
                collectFolderNotes(
                    [
                        note({ shortcode: "a", data: { parent: { journals: "b" } } }),
                        note({ shortcode: "b", data: { parent: { journals: "a" } } }),
                    ],
                    "sohl",
                ),
            ),
        ).toThrow(/parent cycle in pack "journals"/);
    });
});
