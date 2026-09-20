/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import {
    itemAddress,
    packagedItemAddress,
    catalogueKey,
    loadItemsMap,
    shortcodeOf,
    embeddedIdentity,
} from "../engine/actor-compiler.mjs";

/**
 * A being's items entry names the item it copies with `model:`, an
 * address, instead of a top-level `shortcode:` that meant something different
 * from the `system.shortcode` beside it and could not say which package the
 * template came from.
 */
describe("packagedItemAddress", () => {
    it("qualifies the document-vocabulary address with its package", () => {
        expect(packagedItemAddress("sohl", "weapongear", "dgr")).toBe("sohl:weapongear:dgr");
        // The unqualified form is unchanged, and still what a `model` naming no
        // package resolves through.
        expect(itemAddress("weapongear", "dgr")).toBe("weapongear:dgr");
    });
});

describe("the catalogue folds the shortcode's case", () => {
    it("finds `Clb` from the address `clb`", () => {
        // A shortcode is case-sensitive and routinely mixed; an address is not,
        // because `readQualifier` normalises what it reads. So a `model:` of
        // `weapongear-clb` has to find the document whose `system.shortcode` is
        // `Clb`. It did not, and every being carrying one of SoHL's six
        // mixed-case gear shortcodes failed to compile.
        expect(catalogueKey("weapongear", "Clb")).toBe(catalogueKey("weapongear", "clb"));
        expect(catalogueKey("weapongear", "Clb")).toBe("weapongear:clb");
        expect(catalogueKey("armorgear", "LtShoe", "sohl")).toBe("sohl:armorgear:ltshoe");
    });

    it("does NOT fold the id-bearing address", () => {
        // `itemAddress` seeds `embeddedItemId`, so folding there would change
        // the `_id` of every embedded item whose identity carries a capital —
        // silently re-identifying documents nothing about which had changed.
        expect(itemAddress("weapongear", "Dgr1")).toBe("weapongear:Dgr1");
        expect(itemAddress("weapongear", "Dgr1")).not.toBe(itemAddress("weapongear", "dgr1"));
    });
});

describe("loadItemsMap keys a dependency's items under its own package", () => {
    /** A compiled item document, as an Item pack's JSON tree holds one. */
    const doc = (type: string, shortcode: string, name: string) => ({
        _id: "AAAAAAAAAAAAAAAA",
        _key: "!items!AAAAAAAAAAAAAAAA",
        type,
        name,
        system: { shortcode },
    });

    it("gives a foreign item an address nothing local can shadow", async () => {
        const fs = await import("node:fs");
        const os = await import("node:os");
        const path = await import("node:path");

        const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-addresses-"));
        const localDir = path.join(root, "local");
        const foreignDir = path.join(root, "foreign");
        fs.mkdirSync(localDir);
        fs.mkdirSync(foreignDir);
        // Both packages publish `weapongear:dgr` — the collision the old flat
        // address space could not express, and resolved by silent shadowing.
        fs.writeFileSync(
            path.join(localDir, "a.json"),
            JSON.stringify(doc("weapongear", "dgr", "Our Dagger")),
        );
        fs.writeFileSync(
            path.join(foreignDir, "b.json"),
            JSON.stringify(doc("weapongear", "dgr", "Their Dagger")),
        );

        const map = loadItemsMap([localDir], [{ dir: foreignDir, package: "sohl" }]);

        // The unqualified address still resolves locally-first, as it always
        // has: a `model` naming no package means this one.
        expect(map.get(itemAddress("weapongear", "dgr")).name).toBe("Our Dagger");
        // And each package's own address names its own item, so a `model` that
        // states the package gets what it asked for rather than whatever the
        // shadowing happened to leave.
        expect(map.get(packagedItemAddress("sohl", "weapongear", "dgr")).name).toBe("Their Dagger");

        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe("shortcodeOf", () => {
    it("reads `system.shortcode` regardless of `systemId`", () => {
        expect(shortcodeOf({ system: { shortcode: "awar" } }, "hm3")).toBe("awar");
        expect(shortcodeOf({ system: { shortcode: "awar" } })).toBe("awar");
    });

    it("falls back to `flags.<systemId>.shortcode` where `system.shortcode` is absent", () => {
        // HM3's data model has no `system.shortcode` field, so its published
        // Item compendium carries the handle at `flags.hm3.shortcode` instead.
        expect(shortcodeOf({ system: {}, flags: { hm3: { shortcode: "awar" } } }, "hm3")).toBe(
            "awar",
        );
    });

    it("`system.shortcode` wins where both are present", () => {
        expect(
            shortcodeOf(
                { system: { shortcode: "sys" }, flags: { hm3: { shortcode: "flag" } } },
                "hm3",
            ),
        ).toBe("sys");
    });

    it("reads no flag namespace without a `systemId`", () => {
        expect(shortcodeOf({ system: {}, flags: { hm3: { shortcode: "awar" } } })).toBeUndefined();
        expect(
            shortcodeOf({ system: {}, flags: { hm3: { shortcode: "awar" } } }, null),
        ).toBeUndefined();
    });

    it("never reads another system's flag namespace", () => {
        // The defect this reader must not grow back: HM3 ships its handle at
        // `flags.sohl.shortcode` today, a system writing outside its own
        // namespace. An `hm3` catalogue reader must not honour it.
        expect(
            shortcodeOf({ system: {}, flags: { sohl: { shortcode: "awar" } } }, "hm3"),
        ).toBeUndefined();
    });

    it("returns undefined where a document states no shortcode at all", () => {
        expect(shortcodeOf({ system: {}, flags: {} }, "hm3")).toBeUndefined();
        expect(shortcodeOf({}, "hm3")).toBeUndefined();
    });
});

describe("embeddedIdentity reads the same shortcode shortcodeOf does", () => {
    it("prefers `system.shortcode` to the entry's name", () => {
        expect(embeddedIdentity({ system: { shortcode: "Dgr" }, name: "A Dagger" })).toBe("Dgr");
    });

    it("falls back to the flag namespace named by `systemId`", () => {
        expect(
            embeddedIdentity(
                { system: {}, flags: { hm3: { shortcode: "awar" } }, name: "Awareness" },
                "hm3",
            ),
        ).toBe("awar");
    });

    it("falls back to the entry's name when neither namespace names one", () => {
        expect(
            embeddedIdentity(
                { system: {}, flags: { sohl: { shortcode: "awar" } }, name: "Awareness" },
                "hm3",
            ),
        ).toBe("Awareness");
    });
});

describe("loadItemsMap resolves an item whose shortcode lives in its system's flags", () => {
    /** A compiled item document carrying no `system.shortcode` field, as HM3's do. */
    const flagItem = (type: string, systemId: string, shortcode: string, name: string) => ({
        _id: "BBBBBBBBBBBBBBBB",
        _key: "!items!BBBBBBBBBBBBBBBB",
        type,
        name,
        system: {},
        flags: { [systemId]: { shortcode } },
    });

    /** A fresh `{ localDir, foreignDir }`, cleaned up by the caller. */
    async function tempDirs() {
        const fs = await import("node:fs");
        const os = await import("node:os");
        const path = await import("node:path");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-addresses-flags-"));
        const localDir = path.join(root, "local");
        const foreignDir = path.join(root, "foreign");
        fs.mkdirSync(localDir);
        fs.mkdirSync(foreignDir);
        return { fs, path, root, localDir, foreignDir };
    }

    it("resolves a foreign HM3-shaped entry (`flags.hm3.shortcode`, no `system.shortcode`)", async () => {
        const { fs, path, root, foreignDir } = await tempDirs();
        fs.writeFileSync(
            path.join(foreignDir, "a.json"),
            JSON.stringify(flagItem("skill", "hm3", "awar", "Awareness")),
        );

        const map = loadItemsMap([], [{ dir: foreignDir, package: "hm3" }]);
        expect(map.get(itemAddress("skill", "awar"))?.name).toBe("Awareness");

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("does NOT resolve an entry carrying the wrong system's flag namespace", async () => {
        // The defect being guarded against: HM3 ships its handle at
        // `flags.sohl.shortcode` today, and an `hm3` catalogue reader must
        // ignore it rather than silently honour a system writing outside its
        // own namespace. This stays red until HM3 ships the rename.
        const { fs, path, root, foreignDir } = await tempDirs();
        fs.writeFileSync(
            path.join(foreignDir, "a.json"),
            JSON.stringify(flagItem("skill", "sohl", "awar", "Awareness")),
        );

        const map = loadItemsMap([], [{ dir: foreignDir, package: "hm3" }]);
        expect(map.has(itemAddress("skill", "awar"))).toBe(false);

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("still skips a document carrying neither field", async () => {
        const { fs, path, root, foreignDir } = await tempDirs();
        fs.writeFileSync(
            path.join(foreignDir, "a.json"),
            JSON.stringify({
                _id: "BBBBBBBBBBBBBBBB",
                type: "skill",
                name: "Awareness",
                system: {},
            }),
        );

        const map = loadItemsMap([], [{ dir: foreignDir, package: "hm3" }]);
        expect(map.size).toBe(0);

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("resolves a local Item pack entry the same way, given its system", async () => {
        const { fs, path, root, localDir } = await tempDirs();
        fs.writeFileSync(
            path.join(localDir, "a.json"),
            JSON.stringify(flagItem("skill", "hm3", "awar", "Awareness")),
        );

        const map = loadItemsMap([localDir], [], "hm3");
        expect(map.get(itemAddress("skill", "awar"))?.name).toBe("Awareness");

        fs.rmSync(root, { recursive: true, force: true });
    });

    it("leaves a local flags-only entry unresolved when no system is named", async () => {
        const { fs, path, root, localDir } = await tempDirs();
        fs.writeFileSync(
            path.join(localDir, "a.json"),
            JSON.stringify(flagItem("skill", "hm3", "awar", "Awareness")),
        );

        const map = loadItemsMap([localDir]);
        expect(map.size).toBe(0);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
