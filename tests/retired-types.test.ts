/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The retirement has to be visible to a repository compiling any package, not
// just the toolchain's own default — a stale note in `thalorna` must fail the
// same way a stale note in `sohl` does.
vi.mock("../engine/content-package.mjs", () => ({
    contentPackage: () => "thalorna",
    foundryPackageId: () => "sohl-thalorna",
}));

import { PACK_BY_TYPE, RETIRED_TYPES, assertTypeNotRetired, packForType } from "../engine/ids.mjs";
import { Items } from "../sohl/items.mjs";

/**
 * `character` and `creature` compiled to the same `being` and were retired
 * (SoHL#1580). Deleting them outright is the one change that fails quietly:
 * `packForType` routes every unlisted type to the items pack by design, so a
 * note or link left on the old spelling would be answered — wrongly — instead
 * of reported.
 */
describe("retired content types", () => {
    it("names the replacement for every retired spelling", () => {
        expect(RETIRED_TYPES).toEqual({
            character: "being",
            creature: "being",
            battlemap: "map",
            localmap: "map",
            regionalmap: "map",
        });
    });

    it("routes the surviving type to the actors pack", () => {
        expect(packForType("being")).toEqual({
            pack: "actors",
            docType: "Actor",
        });
    });

    it("no longer carries the retired names in the pack map", () => {
        expect(PACK_BY_TYPE).not.toHaveProperty("character");
        expect(PACK_BY_TYPE).not.toHaveProperty("creature");
    });

    it.each(["character", "creature"])(
        "throws rather than routing `%s` to the items pack",
        (type) => {
            expect(() => packForType(type)).toThrow(/was retired/);
            // The failure this guards against is not an exception but a wrong
            // answer: without it, the open-set default would say "items".
            expect(() => packForType(type)).toThrow(/being/);
        },
    );

    it("says what to write instead, and where the offending value is", () => {
        expect(() => assertTypeNotRetired("creature", "/vault/Bestiary/Condor.md")).toThrow(
            /\/vault\/Bestiary\/Condor\.md/,
        );
    });

    it("leaves every live type alone", () => {
        expect(() => assertTypeNotRetired("being")).not.toThrow();
        expect(() => assertTypeNotRetired(undefined)).not.toThrow();
        expect(packForType("skill")).toEqual({
            pack: "items",
            docType: "Item",
        });
        expect(packForType("doc")).toEqual({
            pack: "journals",
            docType: "JournalEntry",
        });
    });
});

describe("a note left on a retired type fails the compile", () => {
    /** A tree holding one note, whose frontmatter the caller supplies. */
    function treeWith(frontmatter: string): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-retired-"));
        fs.mkdirSync(path.join(root, "content"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "content", "Condor.md"),
            `---\n${frontmatter}\n---\n\nA bird.\n`,
            "utf8",
        );
        return path.join(root, "content");
    }

    const NOTE = ["name:", "  full: Condor", "id: CCCCCCCCCCCCCCCC", "shortcode: condor"].join(
        "\n",
    );

    it("reports the file, from a pass that would not have claimed it anyway", async () => {
        // The Items pass never claimed a creature note, so before the guard it
        // would have skipped this silently — and so would every other pass,
        // leaving a build that is green and missing an actor.
        const content = treeWith(`${NOTE}\ntype: creature`);
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-retired-out-"));
        await expect(
            new Items({ skipDirectories: [], contentBase: content, dest }).compile(),
        ).rejects.toThrow(/Condor\.md/);
    });

    it("compiles the same note once it declares `being`", async () => {
        const content = treeWith(`${NOTE}\ntype: being`);
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-retired-out-"));
        await expect(
            new Items({ skipDirectories: [], contentBase: content, dest }).compile(),
        ).resolves.not.toThrow();
    });
});
