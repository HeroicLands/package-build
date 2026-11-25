/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `scripts/build-info.mjs` builds `info/package-build.info` and `info/dir`, the
 * package ships them, and a missing or too old Texinfo tool is a named error.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { infoToolsSkip, skipUnlessPresent } from "./helpers/texinfo-tools";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCRIPT = path.join(ROOT, "scripts", "build-info.mjs");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** Generous: the converter and makeinfo each take several seconds, more on a loaded runner. */
const BUILD_TIMEOUT = 300_000;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "build-info-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function runScript(args: string[], env: NodeJS.ProcessEnv = process.env) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: "utf8",
        env,
        maxBuffer: 1 << 26,
        timeout: BUILD_TIMEOUT,
    });
}

/** A directory of programs that stand in for the Texinfo tools, and is the whole `PATH`. */
function fakeTools(name: string, version: string): NodeJS.ProcessEnv {
    const bin = path.join(scratch, name);
    fs.mkdirSync(bin, { recursive: true });
    for (const tool of ["makeinfo", "install-info"]) {
        const file = path.join(bin, tool);
        fs.writeFileSync(file, `#!/bin/sh\necho "${tool} (GNU texinfo) ${version}"\n`);
        fs.chmodSync(file, 0o755);
    }
    return { ...process.env, PATH: bin };
}

describe("the package", () => {
    it("lists info in files and builds it at prepack", () => {
        expect(PACKAGE.files).toContain("info");
        expect(PACKAGE.scripts.prepack.split(/\s+/)).toContain("build:info");
        expect(PACKAGE.scripts["build:info"]).toBe("node scripts/build-info.mjs");
    });
});

describe("a missing or too old tool", () => {
    it("is an error that names the tool when makeinfo is absent", () => {
        const empty = path.join(scratch, "empty");
        fs.mkdirSync(empty, { recursive: true });
        const run = runScript([], { ...process.env, PATH: empty });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(/^\S*build-info\.mjs:1:1: error: makeinfo is not installed/m);
    });

    it("is an error that names the tool and version when makeinfo is older than 7.0", () => {
        const run = runScript([], fakeTools("old", "6.8"));
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(/^\S*build-info\.mjs:1:1: error: makeinfo 6\.8 is too old/m);
    });

    it("is an error that names install-info when only it is absent", () => {
        const bin = path.join(scratch, "no-install-info");
        fs.mkdirSync(bin, { recursive: true });
        const file = path.join(bin, "makeinfo");
        fs.writeFileSync(file, '#!/bin/sh\necho "makeinfo (GNU texinfo) 7.3"\n');
        fs.chmodSync(file, 0o755);
        const run = runScript([], { ...process.env, PATH: bin });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(
            /^\S*build-info\.mjs:1:1: error: install-info is not installed/m,
        );
    });

    it("refuses an unknown option with the usage", () => {
        const run = runScript(["--nope"]);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("usage: node scripts/build-info.mjs");
    });

    it("prints its usage for --help", () => {
        const run = runScript(["--help"]);
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("usage: node scripts/build-info.mjs");
    });
});

describe("the built manual", () => {
    const tree = path.join(scratch, "tree");
    let build: ReturnType<typeof runScript> | undefined;

    beforeAll(() => {
        if (infoToolsSkip() !== undefined && !process.env.CI) return;
        fs.mkdirSync(tree, { recursive: true });
        for (const entry of ["docs", "package.json", "package-build.config.yaml"])
            fs.cpSync(path.join(ROOT, entry), path.join(tree, entry), { recursive: true });
        // The reserved package name belongs to this repository's own root only.
        const config = path.join(tree, "package-build.config.yaml");
        fs.writeFileSync(
            config,
            fs
                .readFileSync(config, "utf8")
                .replace(/^contentPackage: .*$/m, "contentPackage: copy"),
        );
        build = runScript(["--root", tree], { ...process.env, SOURCE_DATE_EPOCH: "1700000000" });
    }, BUILD_TIMEOUT);

    it("writes info/package-build.info and info/dir", (context) => {
        skipUnlessPresent(context, infoToolsSkip());
        expect(build?.stderr.split("\n").filter((l) => /error/.test(l))).toEqual([]);
        expect(build?.status).toBe(0);
        const info = fs.readFileSync(path.join(tree, "info", "package-build.info"), "utf8");
        expect(info).toContain("Node: Top");
        expect(fs.readdirSync(path.join(tree, "info")).sort()).toEqual([
            "dir",
            "package-build.info",
        ]);
        const dir = fs.readFileSync(path.join(tree, "info", "dir"), "utf8");
        expect(dir).toContain("* Package Build: (package-build)");
    });

    it("keeps the node separator in the dir file", (context) => {
        skipUnlessPresent(context, infoToolsSkip());
        const dir = fs.readFileSync(path.join(tree, "info", "dir"), "utf8");
        expect(dir).toMatch(/\x1f\nFile: dir,\tNode: Top/);
    });

    it(
        "is packed: npm pack lists info/package-build.info and info/dir",
        (context) => {
            skipUnlessPresent(context, infoToolsSkip());
            const run = spawnSync(
                "npm",
                ["pack", "--dry-run", "--json", "--ignore-scripts", "--no-audit"],
                { cwd: tree, encoding: "utf8", maxBuffer: 1 << 26, timeout: BUILD_TIMEOUT },
            );
            expect(run.status, run.stderr).toBe(0);
            const listed = JSON.parse(run.stdout)[0].files.map((f: { path: string }) => f.path);
            expect(listed).toContain("info/package-build.info");
            expect(listed).toContain("info/dir");
        },
        BUILD_TIMEOUT,
    );
});
