/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The two guards a declared `role` and a measured `width`/`height` make
 * possible.
 *
 * **Shape** derives its expectation from the files themselves: the median
 * aspect ratio of every asset sharing one role, computed at runtime rather
 * than kept as a second, hand-copied table the corpus could drift away from.
 * **Resolution** checks a measured width against what the role's largest
 * print slot needs, and warns rather than errors because nothing in any tree
 * meets that target today.
 *
 * Both guards read the records {@link collectAssetRecords} already emits, so
 * a vector asset — blank `width` and `height`, no role-sharing shape to
 * depart from — joins neither check.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
    PROVENANCE_FILE,
    checkAssetResolutions,
    checkAssetShapes,
    collectAssetRecords,
} from "../engine/asset-index.mjs";

/** A throwaway asset tree: `<root>/<dir>/<file>` plus whatever provenance. */
function assetTree(files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-asset-guards-"));
    for (const [rel, body] of Object.entries(files)) {
        const full = path.join(base, ...rel.split("/"));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body, "utf8");
    }
    return base;
}

/** A minimal PNG whose header states the given pixel size, nothing else. */
function pngBytes(width: number, height: number): Buffer {
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(13, 0);
    const type = Buffer.from("IHDR", "ascii");
    const w = Buffer.alloc(4);
    w.writeUInt32BE(width, 0);
    const h = Buffer.alloc(4);
    h.writeUInt32BE(height, 0);
    return Buffer.concat([signature, length, type, w, h]);
}

/** A role-declaring provenance record, the one every fixture below reuses. */
function roleProvenance(role: string): string {
    return ["attribution: Tom Rodriguez", "license: CC-BY-SA-4.0", `role: ${role}`].join("\n");
}

describe("the shape guard derives a role's expected aspect from the group itself", () => {
    it("flags the asset whose aspect departs from the group's median", () => {
        const base = assetTree({
            [`images/portraits/${PROVENANCE_FILE}`]: roleProvenance("portrait"),
        });
        // Three ordinary portraits at one aspect ratio, and one outlier at a
        // visibly different one — the shape the tree already carries today:
        // one square file among several at a tall aspect.
        fs.writeFileSync(path.join(base, "images/portraits/thorn.png"), pngBytes(1000, 1400));
        fs.writeFileSync(path.join(base, "images/portraits/groa.png"), pngBytes(1000, 1400));
        fs.writeFileSync(path.join(base, "images/portraits/varn.png"), pngBytes(1000, 1400));
        fs.writeFileSync(path.join(base, "images/portraits/odd.png"), pngBytes(1000, 1000));

        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        const findings = checkAssetShapes(records);

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].file).toMatch(/odd\.png$/);
        expect(findings[0].message).toMatch(/portrait/);
        expect(findings[0].message).toMatch(/1000×1000/);
    });

    it("flags nothing when every asset in the group shares one aspect", () => {
        const base = assetTree({
            [`images/banners/${PROVENANCE_FILE}`]: roleProvenance("banner"),
        });
        fs.writeFileSync(path.join(base, "images/banners/a.png"), pngBytes(1792, 768));
        fs.writeFileSync(path.join(base, "images/banners/b.png"), pngBytes(1792, 768));

        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(checkAssetShapes(records)).toEqual([]);
    });
});

describe("the resolution guard warns, rather than errors, below a role's print floor", () => {
    it("warns when a role's pixel width falls short of its largest slot", () => {
        const base = assetTree({
            [`images/${PROVENANCE_FILE}`]: roleProvenance("portrait"),
        });
        fs.writeFileSync(path.join(base, "images/thorn.png"), pngBytes(100, 140));

        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        const findings = checkAssetResolutions(records);

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
        expect(findings[0].file).toMatch(/thorn\.png$/);
        expect(findings[0].message).toMatch(/portrait/);

        // A warning, never an error: nothing in any tree meets the largest
        // target today.
        expect(checkAssetShapes(records).every((f) => f.severity !== "error")).toBe(true);
    });
});

describe("a vector asset is exempt from both guards", () => {
    it("joins neither check, having no pixel dimensions to measure", () => {
        const base = assetTree({
            [`images/${PROVENANCE_FILE}`]: roleProvenance("plate"),
            "images/map.svg": '<svg viewBox="0 0 10 10"></svg>',
        });
        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(records[0].asset.role).toBe("plate");
        expect(records[0].asset.width).toBe("");
        expect(checkAssetShapes(records)).toEqual([]);
        expect(checkAssetResolutions(records)).toEqual([]);
    });
});
