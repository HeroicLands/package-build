/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `forbidGeneratedArt` — the opt-in guard that refuses an `ai: true` asset
 * record.
 *
 * Run against a **fixture** tree, never a real package: no package in this
 * toolchain's tree declares the key, so this is the only place it is
 * exercised.
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

/** A minimal buildable tree: one note, one `ai: true` icon. */
function buildFixture(forbid: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forbid-generated-art-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets", "icons"), { recursive: true });
    fs.writeFileSync(root + "/package.json", JSON.stringify({ name: "sohl", version: "1.0.0" }));
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: forbidtestbuild000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - { name: items, label: Items, type: Item, system: sohl, default: true }
${forbid ? "forbidGeneratedArt: true\n" : ""}`,
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Bowl.md"),
        "---\nname:\n  full: Bowl\ndescription: A bowl.\nid: bowlxxxxxxxxxxxx\n" +
            "shortcode: bowl\ntype: miscgear\nsohl:\n  archetype: 0\n  quality: 0\n" +
            "  durability: 2\n  kbcat: cooking\n  value: 6\n  weight: 3\n---\n\nProse.\n",
    );
    fs.writeFileSync(path.join(root, "assets", "icons", "anvil.svg"), "<svg/>");
    fs.writeFileSync(path.join(root, "assets", "icons", "provenance.yaml"), "ai: true\n");
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

describe("forbidGeneratedArt", () => {
    let forbidding: string;
    let permitting: string;

    beforeAll(() => {
        forbidding = buildFixture(true);
        permitting = buildFixture(false);
    });
    afterAll(() => {
        fs.rmSync(forbidding, { recursive: true, force: true });
        fs.rmSync(permitting, { recursive: true, force: true });
    });

    it(
        "fails the build and names the record and its file when `true`",
        () => {
            const { status, out } = runLint(forbidding);
            expect(status).not.toBe(0);
            expect(out).toContain("sohl-none-icon-anvil");
            expect(out).toContain(path.join("assets", "icons", "anvil.svg"));
            expect(out).toMatch(/error:.*machine-generated/);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "reports nothing extra about the same tree when the key is absent",
        () => {
            const { out } = runLint(permitting);
            expect(out).not.toMatch(/machine-generated/);
            expect(out).not.toContain("forbidGeneratedArt");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
