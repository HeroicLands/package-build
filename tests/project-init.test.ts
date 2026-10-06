/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { renderProject } from "../engine/project-init.mjs";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";
const CLI = fileURLToPath(new URL("../bin/package-build.mjs", import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "package-init-"));

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function run(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd: scratch,
        encoding: "utf8",
    });
}

function options(kind: string, name: string): string[] {
    return [
        "--kind",
        kind,
        "--name",
        name,
        "--title",
        "Guidebook",
        "--description",
        "A guide to the setting.",
        "--author",
        "Example Author",
        "--license",
        "original",
    ];
}

describe("package-build init", () => {
    it.each(["documentation", "modules", "systems"])(
        "creates a %s package from outside a project",
        async (kind) => {
            const target = path.join(scratch, "guidebook");
            const named = `${target}-${kind}`;
            const result = run("init", named, ...options(kind, "guidebook"));
            expect(result.status, result.stderr).toBe(0);
            const version = JSON.parse(
                fs.readFileSync(path.join(path.dirname(CLI), "../package.json"), "utf8"),
            ).version;
            const expected = await renderProject({
                kind,
                name: "guidebook",
                title: "Guidebook",
                description: "A guide to the setting.",
                author: "Example Author",
                license: "original",
                version,
                coreMinimum: "14.359",
                coreVerified: "14.364",
            });
            for (const [file, contents] of expected) {
                expect(fs.readFileSync(path.join(named, file), "utf8")).toBe(contents);
            }
            const pkg = JSON.parse(fs.readFileSync(path.join(named, "package.json"), "utf8"));
            const config = YAML.parse(
                fs.readFileSync(path.join(named, "package-build.config.yaml"), "utf8"),
            );
            expect(pkg.scripts["build:site"]).toContain("site-root");
            expect(pkg.scripts["serve:site"]).toContain("serve:site-html");
            expect(pkg.scripts["serve:site-html"]).toContain("hugo server");
            expect(pkg.scripts["build:book"]).toBe("package-build pdf");
            if (kind !== "documentation") {
                expect(pkg.scripts["build:stage-reset"]).toBe("package-build stage reset");
                expect(pkg.scripts["build:noci"]).toMatch(/build:stage-reset build:db/);
            }
            expect(config.publish.address.prefix).toBe("");
            expect(config.pdf.document).toBe("book.yaml");
            if (kind === "documentation") {
                expect(config.packs).toBeUndefined();
                expect(config.packageBuild).toBeUndefined();
            } else {
                expect(config.packs).toHaveLength(1);
                expect(config.packageBuild.manifest.packFolders[0].packs).toEqual(["journals"]);
            }
            const before = [...expected].map(([file]) =>
                fs.readFileSync(path.join(named, file), "utf8"),
            );
            const checked = run("init", "--check", named);
            expect(checked.status, checked.stderr).toBe(0);
            expect(
                [...expected].map(([file]) => fs.readFileSync(path.join(named, file), "utf8")),
            ).toEqual(before);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "uses the current directory and preserves unrelated files",
        () => {
            const target = path.join(scratch, "existing");
            fs.mkdirSync(target);
            fs.mkdirSync(path.join(target, ".git"));
            fs.mkdirSync(path.join(target, "node_modules"));
            fs.writeFileSync(path.join(target, "notes.txt"), "Keep this.\n");
            const result = spawnSync(
                process.execPath,
                [CLI, "init", ...options("documentation", "guidebook")],
                {
                    cwd: target,
                    encoding: "utf8",
                },
            );
            expect(result.status, result.stderr).toBe(0);
            expect(fs.readFileSync(path.join(target, "notes.txt"), "utf8")).toBe("Keep this.\n");
            expect(fs.existsSync(path.join(target, ".git"))).toBe(true);
            expect(fs.existsSync(path.join(target, "node_modules"))).toBe(true);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "refuses an existing configuration or a managed-file collision without writes",
        () => {
            for (const [name, file] of [
                ["configured", "package-build.config.yml"],
                ["collision", "package.json"],
            ]) {
                const target = path.join(scratch, name);
                fs.mkdirSync(target);
                fs.writeFileSync(path.join(target, file), "unchanged\n");
                const result = run("init", target, ...options("documentation", name));
                expect(result.status).not.toBe(0);
                expect(fs.readdirSync(target)).toEqual([file]);
                expect(fs.readFileSync(path.join(target, file), "utf8")).toBe("unchanged\n");
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "reports missing answers without creating the target",
        () => {
            const target = path.join(scratch, "missing-answers");
            const result = run("init", target, "--kind", "documentation");
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("--description");
            expect(fs.existsSync(target)).toBe(false);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "finds a missing book document without writing",
        () => {
            const target = path.join(scratch, "incomplete");
            expect(run("init", target, ...options("documentation", "guidebook")).status).toBe(0);
            fs.rmSync(path.join(target, "book.yaml"));
            const before = fs.readdirSync(target).sort();
            const checked = run("init", "--check", target);
            expect(checked.status).not.toBe(0);
            expect(checked.stderr).toContain("book document tree is missing");
            expect(fs.readdirSync(target).sort()).toEqual(before);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
