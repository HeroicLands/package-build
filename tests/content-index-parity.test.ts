/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The parity package's content index, byte for byte.** `package-build
 * content-index` builds the index of the parity fixture, and each file it
 * writes must equal the recorded one in `tests/fixtures/parity-index/`. A
 * change that alters the index on purpose re-records them with `vitest -u`,
 * and the diff of the recorded files is the change a consumer sees.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PACKAGE_ROOT, copyFixture } from "./helpers/parity";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDED = path.join(HERE, "fixtures", "parity-index");
const FILES = ["parity-metadata.jsonl", "parity-dictionary.jsonl", "parity-terms.jsonl"];

let root: string;
let report: string;

beforeAll(() => {
    root = copyFixture();
    const result = spawnSync(
        process.execPath,
        [path.join(PACKAGE_ROOT, "bin", "package-build.mjs"), "content-index"],
        {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
    report = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(result.status, report).toBe(0);
}, 120_000);

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("the parity package's content index", () => {
    it.each(FILES)("writes %s as recorded", async (file) => {
        const written = fs.readFileSync(path.join(root, "build", "content-index", file), "utf8");
        await expect(written).toMatchFileSnapshot(path.join(RECORDED, file));
    });

    it("reports how long each stage of the index took", () => {
        expect(report).toMatch(
            /Index timings: source capture \d+\.\d ms; .*index notes \d+\.\d ms;/,
        );
        expect(report).toMatch(/index emission \d+\.\d ms; total \d+\.\d ms\./);
    });
});
