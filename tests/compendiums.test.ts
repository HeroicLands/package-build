/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Build-time pack library (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    compilePacks,
    unpackPacks,
    cleanPacks,
} from "../engine/compendiums.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = path.resolve(HERE, "../engine/compendiums.mjs");

/** A note the content walk will find, so the sandbox tree is not empty. */
const NOTE = `---
name:
  full: Sandbox Note
id: FFFFFFFFFFFFFFFF
shortcode: sandbox
type: doc
package: elsewhere
sohl:
  archetype: null
---

# Overview

A note that exists only so the guard-order test has a tree to compile.
`;

const LIBRARY_URL = pathToFileURL(LIBRARY).href;
// The configuration contract and the manifest reader, for the guard-order test
// below: it induces package-id drift through configuration (#1508), since the
// manifest is no longer located by the working directory.
const CONFIG_URL = pathToFileURL(path.resolve(HERE, "../config.mjs")).href;
const MANIFEST_URL = pathToFileURL(
    path.resolve(HERE, "../engine/package-manifest.mjs"),
).href;
// Resolved here, not in the child: the child runs from an empty temp
// directory, where a bare `loglevel` specifier has no `node_modules` to find.
const LOGLEVEL_URL = pathToFileURL(
    createRequire(import.meta.url).resolve("loglevel"),
).href;

/**
 * Import the library in a child process rooted at `cwd` — the only honest way
 * to observe module-scope side effects, since they happen once per process and
 * vitest has already imported the module.
 *
 * @param cwd     Working directory the child runs in.
 * @param script  Module source appended after the import, printing its findings.
 * @param argv    Arguments handed to the child, to catch stray argv parsing.
 */
function importInCwd(
    cwd: string,
    script: string,
    argv: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
    const source = `const lib = await import(${JSON.stringify(LIBRARY_URL)});\n${script}`;
    const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", source, ...argv],
        { cwd, encoding: "utf8" },
    );
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

/** {@link importInCwd} in a throwaway empty directory, returned for inspection. */
function importInEmptyCwd(
    script: string,
    argv: string[] = [],
): { cwd: string; status: number | null; stdout: string; stderr: string } {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-compendiums-"));
    return { cwd, ...importInCwd(cwd, script, argv) };
}

describe("the compendium library is importable", () => {
    it("exports compilePacks, unpackPacks, and cleanPacks", () => {
        expect(compilePacks).toBeTypeOf("function");
        expect(unpackPacks).toBeTypeOf("function");
        expect(cleanPacks).toBeTypeOf("function");
    });

    it("creates nothing in the caller's working directory", () => {
        const { cwd, status, stderr } = importInEmptyCwd(
            `process.stdout.write(Object.keys(lib).sort().join(","));`,
        );
        expect(stderr).toBe("");
        expect(status).toBe(0);
        // No `build/tmp/packs`, no stray anything: a library that is merely
        // imported must not touch the filesystem of whoever imported it.
        expect(fs.readdirSync(cwd)).toEqual([]);
    });

    it("imports from a tree with no Foundry package manifest", () => {
        // The hardest edge (#1507): a *module* repository ships
        // `module.json`, not `system.template.json`, and an empty directory
        // ships neither. Importing the library must not go looking for one in
        // the caller's tree — the eager `./assets/templates/system.template.json`
        // read used to throw here before the CLI took it over.
        //
        // (`helpers.mjs` still resolves that manifest by a *module*-relative
        // path, so this proves the caller's tree is untouched, not that the
        // pipeline is manifest-free. Hoisting that read into configuration is
        // #1508.)
        const { status, stdout, stderr } = importInEmptyCwd(
            `process.stdout.write(typeof lib.compilePacks);`,
        );
        expect(stderr).toBe("");
        expect(status).toBe(0);
        expect(stdout).toBe("function");
    });

    it("does not reconfigure the shared loglevel singleton", () => {
        const { status, stdout, stderr } = importInEmptyCwd(
            `const log = (await import(${JSON.stringify(LOGLEVEL_URL)})).default;
             process.stdout.write(String(log.getLevel()));`,
        );
        expect(stderr).toBe("");
        expect(status).toBe(0);
        // loglevel's untouched default is WARN (3). An import that configures
        // the singleton would leave INFO (2) behind for the whole process.
        expect(stdout).toBe("3");
    });

    it("does not parse argv or run a command", () => {
        const { cwd, status, stdout, stderr } = importInEmptyCwd(
            `process.stdout.write("imported");`,
            ["package", "compile", "--help"],
        );
        expect(stderr).toBe("");
        expect(status).toBe(0);
        // yargs would have printed usage and (for `compile`) started a build.
        expect(stdout).toBe("imported");
        expect(fs.readdirSync(cwd)).toEqual([]);
    });
});

describe("a prebuilt pack compiles without a content tree (#40)", () => {
    /**
     * A package whose packs are already Foundry JSON has no `assets/content`.
     * Generation refuses an empty tree, so before #40 the compile threw before
     * reaching the pack it was asked for. Here there is no tree at all.
     */
    it("compiles from the declared directory and never calls generation", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "prebuilt-"));
        const prebuilt = path.join(root, "assets/packs/adventure");
        fs.mkdirSync(prebuilt, { recursive: true });
        fs.writeFileSync(
            path.join(prebuilt, "Sandbox_AAAAAAAAAAAAAAAA.json"),
            JSON.stringify({
                _id: "AAAAAAAAAAAAAAAA",
                name: "Sandbox",
                journal: [],
                scenes: [],
                actors: [],
                folders: [],
            }),
        );

        const stage = path.join(root, "build/stage/packs");
        const config = {
            packs: [
                {
                    name: "adventures",
                    type: "Adventure",
                    label: "Adventures",
                    private: false,
                    companions: [],
                    prebuilt,
                    system: null,
                },
            ],
            packDirectories: ["adventures"],
            paths: {
                content: path.join(root, "assets/content"),
                packJson: path.join(root, "build/packs-json"),
                stage,
            },
            stats: { systemId: null, lastModifiedBy: "prebuilt00000000" },
        };

        await expect(
            compilePacks({ config, stageDest: stage }),
        ).resolves.not.toThrow();

        // The compiled pack exists, and generation wrote nothing.
        expect(fs.existsSync(path.join(stage, "adventures"))).toBe(true);
        expect(fs.existsSync(path.join(root, "build/packs-json"))).toBe(false);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
