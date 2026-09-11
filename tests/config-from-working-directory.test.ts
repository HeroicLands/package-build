/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A build reads the configuration of the tree it was run in (#364).
 *
 * The defect these cases describe needs a shape no unit test can fake, so they
 * build it: a repository with the toolchain installed under it, and a second
 * checkout **nested inside that repository** with its own configuration and no
 * `node_modules` of its own. Node's resolution walks parent directories, so the
 * nested tree resolves `@heroiclands/package-build` out of the parent's
 * `node_modules` — `import.meta.dirname` is then inside the parent, and the
 * walk that used to start there landed on the *parent's* configuration. The
 * build compiled the parent's content tree into the parent's `build/` and
 * exited 0.
 *
 * That is a git worktree created under `.claude/worktrees/` before anyone has
 * run `npm ci` in it, which is why it went unnoticed for so long: a worktree
 * that *has* had `npm ci` run carries its own copy and resolved correctly, and
 * two runs in the same nested shape differed only in that.
 *
 * **A zero diff cannot catch it.** The usual tell of a wrong-tree build is an
 * unexpected zero diff, and an output-preserving sweep — the very work that
 * provokes the nested-worktree shape — expects zero differences. So the
 * assertions here are about *which configuration was read*, which is the only
 * thing that separates the two outcomes.
 *
 * Driven as subprocesses, because that is the only honest way to vary
 * `process.cwd()` and `import.meta.dirname` together; `resolveConfigFile` is
 * also asked directly, since it takes both origins as parameters.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { CONFIG_BASENAME, resolveConfigFile } from "../engine/pack-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.dirname(HERE);

const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
    files: string[];
};

/** The sandbox, the outer checkout, the nested one, and the installed copy. */
let sandbox: string;
let parent: string;
let nested: string;
let installed: string;

/**
 * The smallest configuration that resolves, written where a repository keeps it.
 *
 * `name` is the npm name the Foundry package id is derived from, and
 * `contentPackage` has to be alphanumeric — it is the first segment of every
 * address — so the two differ by more than spelling and both are stated.
 */
function writeRepo(dir: string, name: string, contentPackage: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name, version: "1.2.3", private: true }),
        "utf8",
    );
    fs.writeFileSync(
        path.join(dir, `${CONFIG_BASENAME}.yaml`),
        YAML.stringify({
            contentPackage,
            packageKind: "systems",
            compatibility: { minimum: "14.359" },
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
        }),
        "utf8",
    );
}

/**
 * What `loadPackConfig()` resolves, run from a given directory.
 *
 * The copy under `parent/node_modules/` is imported by path rather than by
 * specifier, which is what an installed `bin/` entry point amounts to — what
 * matters is where the *module* sits, not how the caller spelled it.
 */
function loadFrom(
    cwd: string,
    env: NodeJS.ProcessEnv = {},
): {
    status: number;
    config: { rootDir?: string; foundryPackage?: string; error?: string };
    stderr: string;
} {
    const probe = `
        const { loadPackConfig } = await import(${JSON.stringify(
            path.join(installed, "engine", "pack-config.mjs"),
        )});
        try {
            const c = loadPackConfig();
            console.log(JSON.stringify({ rootDir: c.rootDir, foundryPackage: c.foundryPackage }));
        } catch (err) {
            console.log(JSON.stringify({ error: err.message }));
        }
    `;
    const merged = { ...process.env, ...env };
    if (!("PACKAGE_BUILD_CONFIG" in env)) delete merged.PACKAGE_BUILD_CONFIG;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        cwd,
        env: merged,
        encoding: "utf8",
    });
    return {
        status: r.status ?? 1,
        config: JSON.parse((r.stdout ?? "{}").trim() || "{}"),
        stderr: r.stderr ?? "",
    };
}

beforeAll(() => {
    // Outside the repository, so neither walk can reach this package's own
    // fixture configuration and pass for the wrong reason. Resolved through
    // `realpathSync` because `os.tmpdir()` is itself a symlink on macOS, and
    // every path the child process reports — `process.cwd()`,
    // `import.meta.dirname` — is a real one: comparing the two forms would fail
    // on a difference that is not the one under test.
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "package-build-nested-")));
    parent = path.join(sandbox, "outer-checkout");
    nested = path.join(parent, ".claude", "worktrees", "wt");
    writeRepo(parent, "outer-tree", "outertree");
    writeRepo(nested, "nested-tree", "nestedtree");

    // The toolchain, installed under the parent only — the nested tree having
    // no `node_modules` of its own is the entire trigger.
    const modules = path.join(parent, "node_modules");
    fs.mkdirSync(path.join(modules, "@heroiclands"), { recursive: true });
    installed = path.join(modules, "@heroiclands", "package-build");
    fs.mkdirSync(installed);
    for (const entry of manifest.files) {
        const from = path.join(PKG_ROOT, entry);
        // `types/` is generated at `prepack`, so it is absent from a checkout.
        if (fs.existsSync(from)) fs.cpSync(from, path.join(installed, entry), { recursive: true });
    }
    fs.cpSync(path.join(PKG_ROOT, "package.json"), path.join(installed, "package.json"));

    // A *copy*, not a symlink: Node resolves a symlinked module to its real
    // path, so a linked one would sit back inside this repository and the shape
    // under test would not exist. Its own dependencies are linked, since only
    // the toolchain's own location matters here.
    for (const dep of fs.readdirSync(path.join(PKG_ROOT, "node_modules"))) {
        if (dep === "@heroiclands") continue;
        fs.symlinkSync(path.join(PKG_ROOT, "node_modules", dep), path.join(modules, dep), "dir");
    }
});

afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("a build run in a nested worktree with no node_modules of its own", () => {
    it("reads the worktree's configuration, not the parent checkout's", () => {
        // The whole defect in one assertion: this was `parent`, and the build
        // said so only in absolute paths that are easy to read past.
        const { status, config, stderr } = loadFrom(nested);
        expect(status, stderr).toBe(0);
        expect(config.rootDir).toBe(nested);
        expect(config.foundryPackage).toBe("nested-tree");
    });

    it("names both configurations rather than passing over the one it ignored", () => {
        // The disagreement is also the only cheap signal that this tree is
        // compiling on another checkout's `node_modules`, so it is said out
        // loud even though the answer is now the right one.
        const { stderr } = loadFrom(nested);
        expect(stderr).toContain("warning:");
        expect(stderr).toContain(path.join(nested, `${CONFIG_BASENAME}.yaml`));
        expect(stderr).toContain(path.join(parent, `${CONFIG_BASENAME}.yaml`));
    });
});

describe("every other shape resolves as it always did", () => {
    it("reads its own configuration from the checkout that installed the toolchain", () => {
        const { config, stderr } = loadFrom(parent);
        expect(config.rootDir).toBe(parent);
        expect(stderr).not.toContain("warning:");
    });

    it("reads it from a subdirectory too, since the walk climbs", () => {
        // What #1508 bought was one tree per build however it was launched, and
        // an upward walk from the working directory keeps exactly that.
        const deep = path.join(parent, "assets", "content", "Items");
        fs.mkdirSync(deep, { recursive: true });
        expect(loadFrom(deep).config.rootDir).toBe(parent);
    });

    it("falls back to the installed package's own when the working directory has none", () => {
        // Launched from outside any repository: the module walk is the only one
        // with an answer, so it is still the one used — and silently, because
        // nothing is being passed over.
        const { config, stderr } = loadFrom(sandbox);
        expect(config.rootDir).toBe(parent);
        expect(stderr).not.toContain("warning:");
    });

    it("still lets PACKAGE_BUILD_CONFIG override both walks, without a warning", () => {
        // An explicit name is not a search result, so there is no disagreement
        // to report — which is what made it the workaround for #364.
        const named = path.join(parent, `${CONFIG_BASENAME}.yaml`);
        const { config, stderr } = loadFrom(nested, { PACKAGE_BUILD_CONFIG: named });
        expect(config.rootDir).toBe(parent);
        expect(stderr).not.toContain("warning:");
    });
});

describe("resolveConfigFile, asked about a tree it is not standing in", () => {
    it("reports each walk's own answer, and prefers the working directory's", () => {
        const found = resolveConfigFile({ cwd: nested, moduleDir: path.join(installed, "engine") });
        expect(found.fromCwd).toBe(path.join(nested, `${CONFIG_BASENAME}.yaml`));
        expect(found.fromModule).toBe(path.join(parent, `${CONFIG_BASENAME}.yaml`));
        expect(found.path).toBe(found.fromCwd);
    });

    it("agrees with itself when one tree holds both", () => {
        const found = resolveConfigFile({ cwd: parent, moduleDir: path.join(installed, "engine") });
        expect(found.fromCwd).toBe(found.fromModule);
        expect(found.path).toBe(found.fromCwd);
    });

    it("falls back to the module's walk, and only when the working directory has none", () => {
        const found = resolveConfigFile({
            cwd: sandbox,
            moduleDir: path.join(installed, "engine"),
        });
        expect(found.fromCwd).toBeUndefined();
        expect(found.path).toBe(found.fromModule);
    });
});
