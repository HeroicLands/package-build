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

import { itemAddress, packagedItemAddress, loadItemsMap } from "../engine/actor-compiler.mjs";

/**
 * #334 — a being's items entry names the item it copies with `model:`, an
 * address, instead of a top-level `shortcode:` that meant something different
 * from the `system.shortcode` beside it and could not say which package the
 * template came from.
 */
describe("packagedItemAddress (#334)", () => {
    it("qualifies the document-vocabulary address with its package", () => {
        expect(packagedItemAddress("sohl", "weapongear", "dgr")).toBe("sohl:weapongear:dgr");
        // The unqualified form is unchanged, and still what a `model` naming no
        // package resolves through.
        expect(itemAddress("weapongear", "dgr")).toBe("weapongear:dgr");
    });
});

describe("loadItemsMap keys a dependency's items under its own package (#334)", () => {
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
