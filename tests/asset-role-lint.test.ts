/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The role checks, as `package-build lint` runs them.
 *
 * {@link module:engine/asset-index.checkAssetShapes} and
 * {@link module:engine/asset-index.checkAssetResolutions} are tested directly
 * elsewhere. This file proves the lint command reaches them, which is the only
 * thing that makes either one a guard rather than an export.
 *
 * Run against a **fixture** tree, never a real package.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PKG_ROOT, "bin", "package-build.mjs");

/** A PNG header stating a size, which is all a dimension reader reads. */
function png(width: number, height: number): Buffer {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
}

/** One note, and a banner group whose third picture is square. */
function buildFixture(squareOutlier: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-role-lint-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets", "images", "banners"), { recursive: true });
    fs.writeFileSync(root + "/package.json", JSON.stringify({ name: "sohl", version: "1.0.0" }));
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: rolelinttestbuild0
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - { name: items, label: Items, type: Item, system: sohl, default: true }
`,
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Bowl.md"),
        "---\nname:\n  full: Bowl\ndescription: A bowl.\nid: bowlxxxxxxxxxxxx\n" +
            "shortcode: bowl\ntype: miscgear\nsohl:\n  archetype: 0\n  quality: 0\n" +
            "  durability: 2\n  kbcat: cooking\n  value: 6\n  weight: 3\n---\n\nProse.\n",
    );
    const banners = path.join(root, "assets", "images", "banners");
    fs.writeFileSync(path.join(banners, "dawn.png"), png(1792, 768));
    fs.writeFileSync(path.join(banners, "dusk.png"), png(1792, 768));
    fs.writeFileSync(
        path.join(banners, "noon.png"),
        squareOutlier ? png(1024, 1024) : png(1792, 768),
    );
    fs.writeFileSync(
        path.join(banners, "provenance.yaml"),
        "attribution: A painter\nlicense: CC-BY-SA-4.0\nrole: banner\n",
    );
    return root;
}

/** Run `package-build lint` against a fixture root. */
function runLint(root: string): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, [CLI, "lint"], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("the role checks under lint", () => {
    let diverging: string;
    let uniform: string;

    beforeAll(() => {
        diverging = buildFixture(true);
        uniform = buildFixture(false);
    });
    afterAll(() => {
        fs.rmSync(diverging, { recursive: true, force: true });
        fs.rmSync(uniform, { recursive: true, force: true });
    });

    it(
        "refuses the picture whose shape departs from its group, by name",
        () => {
            const { out } = runLint(diverging);
            // The path a finding names is the one a reader opens, from the
            // working directory — the asset root included.
            expect(out).toMatch(
                new RegExp(`${path.join("assets", "images", "banners", "noon.png")}[^\\n]*error:`),
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "says nothing about shape when every picture in the group agrees",
        () => {
            const { out } = runLint(uniform);
            expect(out).not.toMatch(/noon\.png[^\n]*error:/);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "warns, rather than refuses, a picture below its role's print target",
        () => {
            const { out } = runLint(uniform);
            expect(out).toMatch(
                new RegExp(
                    `${path.join("assets", "images", "banners")}[^\\n]*warning:[^\\n]*falls short`,
                ),
            );
            expect(out).not.toMatch(/dawn\.png[^\n]*error:/);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
