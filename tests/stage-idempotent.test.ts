/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Staging pictures is idempotent: a file at a picture's deployed path that is
 * byte-identical to what would be staged is the stage's own output and is
 * skipped, while a differing file is still a collision.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { stagePackageAssets } from "../engine/asset-shipping.mjs";

const PKG = "tpkg";
let base: string;
let assetsBase: string;
let stageDir: string;

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "package-build-idem-")));
    assetsBase = path.join(base, "assets");
    stageDir = path.join(base, "stage");
    fs.mkdirSync(path.join(assetsBase, "images", "places"), { recursive: true });
    fs.mkdirSync(path.join(assetsBase, "icons"), { recursive: true });
    fs.writeFileSync(
        path.join(assetsBase, "images", "provenance.yaml"),
        YAML.stringify({ attribution: "Someone", license: "CC-BY-4.0", ai: false }),
    );
    fs.writeFileSync(
        path.join(assetsBase, "icons", "provenance.yaml"),
        YAML.stringify({ attribution: "Someone", license: "CC-BY-4.0", ai: false }),
    );
    fs.writeFileSync(path.join(assetsBase, "images", "places", "gate.png"), "gate");
    fs.writeFileSync(path.join(assetsBase, "icons", "anvil.svg"), "<svg>anvil</svg>");
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

const stage = (transform?: (p: string) => string | null) =>
    stagePackageAssets({ assetsBase, contentPackage: PKG, stageDir, title: "T", transform });

/** Every staged file with its bytes. */
function snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else out[path.relative(stageDir, full)] = fs.readFileSync(full, "utf8");
        }
    };
    walk(stageDir);
    return out;
}

describe("staging twice into one directory", () => {
    it("reports no finding and leaves the files unchanged", () => {
        expect(stage().findings).toEqual([]);
        const first = snapshot();
        const again = stage();
        expect(again.findings).toEqual([]);
        expect(again.staged).toHaveLength(2);
        expect(snapshot()).toEqual(first);
    });

    it("is idempotent for a transformed picture, comparing the transformed bytes", () => {
        const transform = (p: string) => (p.endsWith("gate.png") ? "transformed" : null);
        expect(stage(transform).findings).toEqual([]);
        const again = stage(transform);
        expect(again.findings).toEqual([]);
        expect(snapshot()["images/gate.png"]).toBe("transformed");
    });

    it("treats a file matching the source but not the transformed bytes as a collision", () => {
        stage();
        const again = stage((p) => (p.endsWith("gate.png") ? "transformed" : null));
        expect(again.findings).toHaveLength(1);
        expect(snapshot()["images/gate.png"]).toBe("gate");
    });
});

describe("a file at a deployed path that differs", () => {
    it("is still a finding, and no picture is written", () => {
        fs.mkdirSync(path.join(stageDir, "images"), { recursive: true });
        fs.writeFileSync(path.join(stageDir, "images", "gate.png"), "from a row");
        const result = stage();
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].message).toContain("was not staged over it");
        expect(snapshot()).toEqual({ "images/gate.png": "from a row" });
    });
});
