/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { collectAssetRecords } from "../engine/asset-index.mjs";

it("uses explicit own artwork without falling back to local image files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-input-"));
    try {
        fs.mkdirSync(path.join(root, "images"));
        fs.writeFileSync(path.join(root, "images", "legacy.webp"), "legacy");
        const own = {
            package: "sample",
            type: "image",
            shortcode: "chosen",
            address: { canonical: "sample-none-image-chosen" },
            asset: { path: "images/chosen.webp", ai: false },
        };
        const findings: object[] = [];
        const records = collectAssetRecords(root, {
            contentPackage: "sample",
            assetRecords: [own],
            problems: findings,
        });
        expect(records).toEqual([own]);
        expect(findings).toEqual([]);
        expect(() =>
            collectAssetRecords(root, {
                contentPackage: "sample",
                assetRecords: [{ ...own, type: "being" }],
            }),
        ).toThrow();
        expect(() =>
            collectAssetRecords(root, { contentPackage: "sample", assetRecords: [own, own] }),
        ).toThrow();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
