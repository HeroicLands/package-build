/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `package-build schema` publishes a build artifact, not a committed file.
 *
 * It writes under `build/`, the way every other generated file in this
 * toolchain does, and there is nothing at the repository root to compare
 * against — so `--check` is not a recognised option any more, and the CLI
 * must refuse it rather than silently ignoring it.
 *
 * Drives the real binary as a subprocess, for the same reason
 * `cli-content-commands.test.ts` does: what is under test is the CLI's own
 * argv handling and where the handler writes, neither of which survives
 * being called as a function — the top-level `yargs(...).argv` in
 * `bin/package-build.mjs` runs at import time.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PKG_ROOT, "bin", "package-build.mjs");

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb558-schema-cli-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: fixture
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: pb558testbuild0000
packs:
    - { name: items, label: Items, type: Item, default: true }
packageBuild:
    schema:
        Item: { from: models.mjs, registry: itemModels }
`,
    );
    fs.writeFileSync(
        path.join(root, "models.mjs"),
        `
const fields = foundry.data.fields;

export class GearModel extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            weight: new fields.NumberField({})
        };
    }
}

export const itemModels = { gear: GearModel };
`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run the real binary against the fixture repository. */
function run(...args: string[]) {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("package-build schema", () => {
    afterAll(() => {
        fs.rmSync(path.join(root, "build"), { recursive: true, force: true });
        fs.rmSync(path.join(root, "schema.json"), { force: true });
    });

    it("writes build/schema.json and leaves the repository root untouched", () => {
        const { code, err } = run("schema");

        expect(err).toBe("");
        expect(code).toBe(0);
        expect(fs.existsSync(path.join(root, "build", "schema.json"))).toBe(true);
        expect(fs.existsSync(path.join(root, "schema.json"))).toBe(false);
    });

    it("publishes an artifact `content-build content-format schema` can read", () => {
        run("schema");
        const artifact = JSON.parse(
            fs.readFileSync(path.join(root, "build", "schema.json"), "utf8"),
        );
        expect(artifact.documents.Item.gear.own).toEqual(["weight"]);
    });
});

describe("package-build schema --check", () => {
    it("is refused as an unknown argument, not silently accepted", () => {
        // `--check` compared against a committed copy that no longer exists —
        // accepting it quietly would mean a lint chain still gating on it
        // reports success having checked nothing.
        const { code, err } = run("schema", "--check");

        expect(code).not.toBe(0);
        expect(err).toMatch(/[Uu]nknown argument/);
        expect(err).toContain("check");
    });
});
