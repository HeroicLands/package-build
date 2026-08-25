/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Nothing this package ships may read the consuming repository's configuration
 * at import (#2).
 *
 * A toolchain that resolves its configuration while its modules evaluate cannot
 * answer `--version`, cannot be imported for one pure helper, and cannot be
 * imported by a test — every entry point requires a whole consumer repository
 * to exist first. It did: `engine/pack-config.mjs` imported the consumer's
 * config file at module evaluation and threw when there was none, and
 * `engine/journals.mjs` read the Foundry package manifest to build a `_stats`
 * block nobody had asked for yet. Vendored inside the system repository the
 * walk always found *that* repository's root config, so none of it showed;
 * extracting the package is what exposed it.
 *
 * The check runs against a **copy of the files the package actually ships**,
 * placed outside this repository so that no `package-build.config.mjs` and no
 * `assets/templates/` sit anywhere above it — the situation a consumer is in
 * before configuring anything, and the one the report reproduced by hand with
 * `npm pack`. This repository's own development fixture config sits at its
 * root, so only a copy placed outside it proves anything. It is deliberately blunt and self-extending: every
 * shipped module is imported on its own, so a module added later is covered
 * without anyone remembering to list it, and the moment one of them hoists a
 * configured value its import fails.
 *
 * The counterpart of `dependencies-are-declared.test.ts`: that one
 * proves every import *resolves* when the package is installed elsewhere, this
 * one proves that importing does not *demand* anything of where it was
 * installed.
 *
 * Absence stays loud — the last case asserts that reading a configured value
 * still throws, and still names the file it looked for.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CONFIG_BASENAME, findConfigFile } from "../engine/pack-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.dirname(HERE);

const manifest = JSON.parse(
    fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
) as { version: string; files: string[] };

/** Where the copy lives, and the package root inside it. */
let sandbox: string;
let installed: string;

/** Every `.mjs` under `dir`, recursively, as absolute paths. */
function walkModules(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkModules(full);
        return entry.isFile() && entry.name.endsWith(".mjs") ? [full] : [];
    });
}

/**
 * The shipped modules to import, package-relative.
 *
 * `bin/` is left out on purpose: importing the command line *runs* it, and the
 * `--version` / `--help` cases below cover it properly.
 */
const MODULES = ["engine", "sohl"]
    .flatMap((dir) => walkModules(path.join(PKG_ROOT, dir)))
    .map((full) => path.relative(PKG_ROOT, full))
    .concat("index.mjs", "config.mjs")
    .sort();

/**
 * Run a Node process with the environment a bare consumer has: no
 * `PACKAGE_BUILD_CONFIG` pointing the toolchain at a configuration it would
 * otherwise never find.
 */
function run(args: string[]): {
    status: number;
    stdout: string;
    stderr: string;
} {
    const env = { ...process.env };
    delete env.PACKAGE_BUILD_CONFIG;
    const result = spawnSync(process.execPath, args, {
        cwd: sandbox,
        encoding: "utf8",
        env,
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
    };
}

/** The path to something inside the copied package, as a `file:` URL. */
function installedUrl(...parts: string[]): string {
    return pathToFileURL(path.join(installed, ...parts)).href;
}

beforeAll(() => {
    // `os.tmpdir()` is outside the repository on every platform this runs on,
    // which is the whole point: the config walk climbs from the module's own
    // directory, so a copy left inside the repository would find this
    // repository's configuration and prove nothing.
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "content-build-bare-"));
    installed = path.join(sandbox, "pkg");
    fs.mkdirSync(installed);

    for (const entry of manifest.files) {
        const from = path.join(PKG_ROOT, entry);
        // `types/` is generated at `prepack`, so it is absent from a checkout.
        if (fs.existsSync(from)) {
            fs.cpSync(from, path.join(installed, entry), { recursive: true });
        }
    }
    fs.cpSync(
        path.join(PKG_ROOT, "package.json"),
        path.join(installed, "package.json"),
    );

    // The runtime dependencies still have to resolve; only the *configuration*
    // is meant to be missing.
    fs.symlinkSync(
        path.join(PKG_ROOT, "node_modules"),
        path.join(sandbox, "node_modules"),
        "dir",
    );
});

afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("the shipped package needs no configuration to be imported (#2)", () => {
    it("puts the copy somewhere with no configuration above it", () => {
        // Guards the guard: were a configuration reachable from the copy,
        // every case below would pass without proving anything.
        expect(findConfigFile(installed)).toBeUndefined();
        expect(fs.existsSync(path.join(installed, "assets"))).toBe(false);
        expect(MODULES.length).toBeGreaterThan(20);
    });

    it("imports every shipped module on its own", () => {
        // One process, importing each module in isolation with a fresh
        // registry, so a module that only works because another was loaded
        // first is caught too.
        const probe = `
            const modules = ${JSON.stringify(MODULES)};
            const failures = [];
            for (const rel of modules) {
                const url = new URL(rel, ${JSON.stringify(installedUrl("/"))});
                // A distinct query per module defeats the module cache, so
                // each import evaluates the file again from scratch.
                try { await import(url.href + "?probe=" + encodeURIComponent(rel)); }
                catch (err) { failures.push(rel + ": " + err.message); }
            }
            console.log(JSON.stringify(failures));
        `;
        const { status, stdout, stderr } = run([
            "--input-type=module",
            "-e",
            probe,
        ]);
        expect(status, stderr).toBe(0);
        expect(JSON.parse(stdout.trim())).toEqual([]);
    });

    it("answers --version", () => {
        const { status, stdout, stderr } = run([
            path.join(installed, "bin", "content-build.mjs"),
            "--version",
        ]);
        expect(status, stderr).toBe(0);
        expect(stdout.trim()).toBe(manifest.version);
    });

    it("answers --help", () => {
        const { status, stdout, stderr } = run([
            path.join(installed, "bin", "content-build.mjs"),
            "--help",
        ]);
        expect(status, stderr).toBe(0);
        expect(stdout).toContain("package");
    });

    it("still fails loudly when a configured value is read", () => {
        // *When* it throws is what moved, not *whether*: a build that actually
        // needs configuration must not limp along on a default.
        const probe = `
            const { loadPackConfig } = await import(${JSON.stringify(
                installedUrl("engine", "pack-config.mjs"),
            )});
            try { loadPackConfig(); console.log("NO THROW"); }
            catch (err) { console.log(err.message); }
        `;
        const { status, stdout, stderr } = run([
            "--input-type=module",
            "-e",
            probe,
        ]);
        expect(status, stderr).toBe(0);
        expect(stdout).toContain(CONFIG_BASENAME);
        expect(stdout).toContain("PACKAGE_BUILD_CONFIG");
    });
});
