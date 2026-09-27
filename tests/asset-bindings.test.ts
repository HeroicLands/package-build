/* SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkForeignAssetBindings } from "../engine/asset-bindings.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("foreign asset bindings", () => {
    it("checks files under the configured root against the fetched Address set", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-binding-"));
        roots.push(root);
        const dir = path.join(root, "art", "portraits");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "known.webp"), "a");
        fs.writeFileSync(path.join(dir, "missing.webp"), "b");
        const config = {
            rootDir: root,
            contentPackage: "art",
            relationships: { requires: [{ id: "thalorna", contentIndex: true }] },
            packageBuild: {
                assets: [
                    {
                        from: "art",
                        to: "assets/images",
                        bindsTo: { package: "thalorna", system: "note", type: "being" },
                    },
                ],
            },
        };
        const foreignIndex = new Map([["thalorna-note-being-known", {}]]);
        expect(checkForeignAssetBindings(config, { foreignIndex })).toEqual([
            {
                file: path.join("art", "portraits", "missing.webp"),
                severity: "error",
                message:
                    "asset binding thalorna-note-being-missing resolves to no being in thalorna",
            },
        ]);
        config.relationships.requires[0].contentIndex = false;
        expect(checkForeignAssetBindings(config)).toEqual([]);
    });
});
