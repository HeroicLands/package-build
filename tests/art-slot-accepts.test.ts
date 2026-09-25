/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **An art slot's accepted set, proved through a real compile.**
 *
 * `sohl-kethira-basic` authors `icon: image-…` twenty times over — one full
 * illustration per faith tradition, on a slot whose default type is `icon`.
 * The cases here reproduce that shape in miniature, through the same
 * `Actors` pass an embedded item's art resolves through: an `icon` slot
 * resolving a value naming `image`, and the same slot refusing one naming
 * `audio` as an **error**, naming the accepted set, rather than falling back
 * to the item's default art the way an address nothing answers does.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Actors } from "../sohl/actors.mjs";
import { DEFAULT_ITEM_ART } from "../sohl/default-item-art.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** An `affiliation`'s default art, in the form a compiled document carries. */
const AFFILIATION_ART = `systems/${DEFAULT_ITEM_ART.affiliation}`;

/**
 * A compile index carrying one `image` asset, so an `icon` slot's authored
 * `image-…` value resolves — the deity-symbol shape, in miniature.
 */
function indexWithDeitySymbol(): object {
    return {
        types: new Set(["icon", "image", "audio"]),
        packages: new Set(["sohl"]),
        contentPackage: "sohl",
        assets: new Map([
            [
                "sohl-none-image-kpagrik",
                { package: "sohl", asset: { path: "images/deities/agrik.webp" } },
            ],
        ]),
        foreign: new Map(),
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
 * An `Actors` pass with an index carrying one deity-symbol image, and every
 * diagnostic it emits captured rather than printed.
 *
 * @param run - What to assert, given the prepared pass and what it said.
 */
async function withPass(run: (pass: any, said: string[]) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-art-accepts-"));
    fs.mkdirSync(path.join(dir, "items"));
    const absPath = path.join(dir, "Ancient_Warrior.md");
    fs.writeFileSync(absPath, "---\ntype: being\n---\n\nA warrior.\n", "utf8");

    const said: string[] = [];
    const error = vi
        .spyOn(console, "error")
        .mockImplementation((line: unknown) => void said.push(String(line)));
    const warn = vi
        .spyOn(console, "warn")
        .mockImplementation((line: unknown) => void said.push(String(line)));
    try {
        const pass = new Actors({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: loadPackConfig().paths.packJson,
            itemsSourceDirs: [path.join(dir, "items")],
        });
        await pass.prepare();
        // After `prepare`, which builds the corpus index this replaces.
        pass.linkIndex = indexWithDeitySymbol();
        pass.currentNote = { absPath };
        run(pass, said);
    } finally {
        error.mockRestore();
        warn.mockRestore();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("an icon slot naming a type outside its default", () => {
    it("resolves `image`, the deity-symbol case", async () => {
        await withPass((pass) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Agrik",
                        type: "affiliation",
                        data: { icon: "sohl-none-image-kpagrik" },
                        system: { shortcode: "agrik" },
                    },
                ]),
                "",
            );
            expect(pass.errorCount).toBe(0);
            expect(doc.items[0].img).toBe("systems/sohl/assets/images/deities/agrik.webp");
        });
    });

    it("refuses `audio` as an error naming the accepted set, taking the type's default art", async () => {
        await withPass((pass, said) => {
            const doc = pass.buildEntry(
                being([
                    {
                        name: "Agrik",
                        type: "affiliation",
                        data: { icon: "sohl-none-audio-kpagrik" },
                        system: { shortcode: "agrik" },
                    },
                ]),
                "",
            );
            // An error, not a warning: no default repairs an author naming a
            // sound where the slot takes an icon or an image.
            expect(pass.errorCount).toBe(1);
            expect(doc.items[0].img).toBe(AFFILIATION_ART);
            const message = said.find((line) => line.includes("does not accept"));
            expect(message, said.join("\n")).toBeDefined();
            expect(message).toContain("icon");
            expect(message).toContain("image");
            expect(message).not.toContain("audio or");
        });
    });
});
