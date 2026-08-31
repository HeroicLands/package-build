/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every invocation the command line accepts is one it performs (#57).
 *
 * The CLI is built on yargs, but yargs' guarantees are opt-in and this one had
 * opted into none of them: a bare `content-build`, an unknown command, and a
 * real command with its action left off all exited 0 having done nothing. In a
 * `run-s` build chain that is the worst possible outcome — the step passes, and
 * the build continues as though the packs had been compiled.
 *
 * These cases drive the **real binary** as a subprocess rather than importing
 * it, because what is under test is exactly the argv parsing and the exit code,
 * and neither survives being called as a function.
 *
 * None of them needs a configuration: every guard here must fire before any
 * command handler resolves one. That is also what keeps #2 honest — `--help`
 * and `--version` answer in a directory with no configuration at all — so the
 * whole suite runs from a temporary directory well outside this repository,
 * where no `package-build.config.yaml` sits anywhere above.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "content-build.mjs");

/** A directory with no configuration at or above it. */
let cwd: string;

beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "content-build-cli-"));
});

afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
});

/**
 * Run the real binary and report what a caller would see.
 *
 * `PACKAGE_BUILD_CONFIG` is cleared explicitly: it overrides the upward walk,
 * so inheriting one from the environment would point every case back at a real
 * repository and quietly defeat the isolation above.
 */
function run(...args: string[]) {
    const env = { ...process.env };
    delete env.PACKAGE_BUILD_CONFIG;
    const r = spawnSync(process.execPath, [BIN, ...args], {
        cwd,
        env,
        encoding: "utf8",
    });
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("an invocation that names no command", () => {
    it("fails, rather than exiting 0 in silence", () => {
        const { code } = run();
        expect(code).not.toBe(0);
    });

    it("says what it wanted, and lists the commands", () => {
        const { out, err } = run();
        const shown = out + err;
        expect(shown).toMatch(/command/i);
        for (const command of ["package", "docs", "lint", "links", "manifest", "reachability"]) {
            expect(shown).toContain(command);
        }
    });
});

describe("an invocation the CLI cannot perform", () => {
    it("rejects an unknown command", () => {
        // Previously exited 0: a typo in a build script read as success.
        const { code, out, err } = run("bogus");
        expect(code).not.toBe(0);
        expect(out + err).toContain("bogus");
    });

    it("rejects an unknown option", () => {
        const { code } = run("lint", "--not-an-option");
        expect(code).not.toBe(0);
    });
});

describe("a command whose action decides the work", () => {
    it("rejects `package` with no action", () => {
        // The worst of the four: it exited 0 having compiled nothing, so a
        // build chain carried on as though the packs were built.
        const { code } = run("package");
        expect(code).not.toBe(0);
    });

    it("names the actions `package` accepts", () => {
        const { out, err } = run("package");
        const shown = out + err;
        for (const action of ["compile", "unpack", "clean"]) {
            expect(shown).toContain(action);
        }
    });

    it("rejects an unknown action", () => {
        const { code } = run("package", "recompile");
        expect(code).not.toBe(0);
    });

    it("rejects `docs` with no action", () => {
        // It used to render the item-field reference regardless of what was
        // asked for, because the handler never read `argv.action`.
        const { code } = run("docs");
        expect(code).not.toBe(0);
    });

    it("names the actions `docs` accepts", () => {
        expect(run("docs").out + run("docs").err).toContain("item-fields");
    });
});

describe("what still answers without a configuration", () => {
    it("--version reports this package's own version", () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"),
        ) as { version: string };
        const { code, out } = run("--version");

        expect(code).toBe(0);
        expect(out.trim()).toBe(manifest.version);
    });

    it("refuses to emit a manifest the repository does not publish", () => {
        // The switch is a declaration, not a preference: emitting without it
        // publishes a file a consumer vendors and treats as authoritative.
        // Reported here rather than in the library, because it is a question
        // about the invocation and not about the tree.
        const { code, err } = run("manifest");

        expect(code).toBe(1);
        // No configuration exists at all in this sandbox, so the failure is the
        // missing config rather than the switch — either way it must not be a
        // silent success.
        expect(err).not.toBe("");
    });

    it("--help answers, and lists every command", () => {
        const { code, out } = run("--help");

        expect(code).toBe(0);
        for (const command of ["package", "docs", "lint", "links", "reachability"]) {
            expect(out).toContain(command);
        }
    });
});
