/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `content-config.mjs`'s own top-of-file `@module` docstring carries a worked
 * example of a `package-build.config.yaml`, offered to a reader as something
 * to copy. Read from the running source rather than retyped, so a future edit
 * to the example is checked as written rather than against a second,
 * hand-copied transcription that could quietly drift from it.
 *
 * The example is fed through the real loader (`configFromData`), the same
 * path a consumer's YAML file takes, rather than `defineConfig` directly —
 * the example itself documents that `rootDir`, `foundryPackage`,
 * `stats.systemVersion` and the `itemBuilders` table are absent from the YAML
 * and derived by the loader, so calling `defineConfig` with the example's
 * literal keys would be testing a shape no consumer ever passes.
 */

import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import YAML from "yaml";

import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";

const SOURCE = readFileSync(path.resolve(__dirname, "../content-config.mjs"), "utf8");

/** The fenced ```yaml block in the module's top-of-file `@module` docstring. */
function moduleDocExample(): string {
    const match = /```yaml\n([\s\S]*?)\n \*\s*```/.exec(SOURCE);
    if (!match) {
        throw new Error(
            "could not find a fenced ```yaml block in content-config.mjs's module docstring",
        );
    }
    return match[1]
        .split("\n")
        .map((line) => line.replace(/^\s*\* ?/, ""))
        .join("\n");
}

describe("the module docstring's worked example", () => {
    it("is a configuration `configFromData` accepts, unmodified", () => {
        const yaml = moduleDocExample();
        const data = YAML.parse(yaml);

        // Sanity check on the extraction: the regression this guards is an
        // example that authors a key `defineConfig` refuses, so an empty or
        // truncated match would pass trivially.
        expect(data.contentPackage).toBe("sohl");
        expect(data.stats).toEqual({ lastModifiedBy: "sohlbuilder00000" });

        const root = mkdtempSync(path.join(tmpdir(), "pb-docstring-example-"));
        writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sohl", version: "1.2.3" }),
            "utf8",
        );
        const configPath = path.join(root, `${CONFIG_BASENAME}.yaml`);
        writeFileSync(configPath, yaml, "utf8");

        expect(() => configFromData(data, configPath)).not.toThrow();
    });
});
