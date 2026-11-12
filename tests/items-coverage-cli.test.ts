/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { subprocessTimeout } from "./subprocess-timeout.js";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");
let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "items-coverage-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14", verified: "14.367" }
stats: { lastModifiedBy: coveragetest0000 }
systems:
  sohl: { compatibility: { verified: "0.9.0" } }
  hm3: { compatibility: { verified: "1.0.0" } }
itemBuilders: [sohl, hm3]
skipDirectories: [Templates]
packs:
  - { name: items, type: Item, system: sohl, default: true }
  - { name: journals, type: JournalEntry }
`,
    );
    const note = (
        file: string,
        name: string,
        code: string,
        type: string,
        kind: string,
        block = "",
    ) => {
        const dest = path.join(root, "assets/content", file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(
            dest,
            `---\nshortcode: ${code}\nname: { full: ${name} }\ntype: ${type}\ndata:\n  kind: ${kind}\n${block}---\n\nsohl: this is prose\n`,
        );
    };
    note("odd/note.md", "Sword", "sword", "weapongear", "weapon");
    note("misc.md", "Cup", "cup", "miscgear", "miscgear");
    note("other.md", "Axe", "axe", "weapongear", "weapon");
    note("present.md", "Shield", "shield", "armorgear", "armor", "sohl:\n  type: armorgear\n");
    note("Templates/ignored.md", "Hidden", "hidden", "weapongear", "weapon");
    fs.writeFileSync(
        path.join(root, "assets/content/stub.md"),
        "---\nshortcode: stub\nname: { full: Stub }\ntype: miscgear\ndata: { kind: miscgear }\n---\n",
    );
    fs.writeFileSync(
        path.join(root, "assets/content/person.md"),
        "---\nshortcode: person\nname: { full: Person }\ntype: being\ndata:\n  items: [{ name: Rope, kind: miscgear }]\n---\n",
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
    });
}

function snapshot(dir: string): Record<string, string> {
    return Object.fromEntries(
        fs
            .readdirSync(dir, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => {
                const full = path.join(entry.parentPath, entry.name);
                return [path.relative(dir, full), fs.readFileSync(full).toString("base64")];
            }),
    );
}

describe("items coverage", () => {
    it(
        "groups only item definitions lacking the selected block, with located stdout and JSON",
        () => {
            const before = snapshot(root);
            const text = run("items", "coverage", "--system", "sohl");
            expect(text.status, text.stderr).toBe(0);
            expect(text.stderr).toBe("");
            const lines = text.stdout.trim().split("\n");
            expect(lines).toHaveLength(4);
            expect(
                lines.every((line) => /^assets\/content\/.*\.md:\d+:\d+: info: /.test(line)),
            ).toBe(true);
            expect(text.stdout).toContain("miscgear");
            expect(text.stdout).toContain("weapon");
            expect(text.stdout).toContain("assets/content/odd/note.md:4:1: info:");
            expect(text.stdout).toContain("2");
            expect(text.stdout).not.toMatch(/Shield|Hidden|Person|Rope/);
            const json = run("items", "coverage", "--system", "sohl", "--json");
            expect(json.status).toBe(0);
            expect(json.stderr).toBe("");
            const report = JSON.parse(json.stdout);
            expect(report.system).toBe("sohl");
            expect(report.total).toBe(4);
            expect(
                report.groups.map((group: { kind: string; count: number }) => [
                    group.kind,
                    group.count,
                ]),
            ).toEqual([
                ["miscgear", 2],
                ["weapon", 2],
            ]);
            expect(
                report.groups
                    .flatMap((group: { items: { name: string }[] }) =>
                        group.items.map((item) => item.name),
                    )
                    .sort(),
            ).toEqual(["Axe", "Cup", "Stub", "Sword"]);
            expect(snapshot(root)).toEqual(before);
        },
        subprocessTimeout(2),
    );

    it(
        "reports the second system and a zero count without changing files",
        () => {
            const hm3 = run("items", "coverage", "--system", "hm3", "--json");
            expect(hm3.status, hm3.stderr).toBe(0);
            expect(JSON.parse(hm3.stdout).total).toBe(5);
            const files = ["odd/note.md", "misc.md", "other.md", "stub.md"].map((name) =>
                path.join(root, "assets/content", name),
            );
            const original = files.map((file) => fs.readFileSync(file, "utf8"));
            try {
                files.forEach((file, index) =>
                    fs.writeFileSync(file, original[index].replace("\n---\n", "\nsohl: {}\n---\n")),
                );
                const before = snapshot(root);
                const result = run("items", "coverage", "--system", "sohl");
                expect(result.status, result.stderr).toBe(0);
                expect(result.stdout).toMatch(
                    /^package-build\.config\.yaml:\d+:\d+: info: 0 items/,
                );
                const json = run("items", "coverage", "--system", "sohl", "--json");
                expect(JSON.parse(json.stdout)).toMatchObject({
                    system: "sohl",
                    total: 0,
                    groups: [],
                });
                expect(snapshot(root)).toEqual(before);
            } finally {
                files.forEach((file, index) => fs.writeFileSync(file, original[index]));
            }
        },
        subprocessTimeout(3),
    );

    it("is not invoked by package scripts or workflows", () => {
        const repository = path.resolve(__dirname, "..");
        const manifest = JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8"));
        expect(Object.values(manifest.scripts).join("\n")).not.toMatch(/items\s+coverage/);
        const workflows = path.join(repository, ".github/workflows");
        for (const file of fs.readdirSync(workflows)) {
            if (/\.ya?ml$/.test(file)) {
                expect(fs.readFileSync(path.join(workflows, file), "utf8")).not.toMatch(
                    /items\s+coverage/,
                );
            }
        }
    });

    it("has no build or lint code path to the coverage implementation", () => {
        const repository = path.resolve(__dirname, "..");
        const paths = ["bin", "engine", "ci", "scripts"].flatMap((dir) =>
            fs
                .readdirSync(path.join(repository, dir), { recursive: true, withFileTypes: true })
                .filter((entry) => entry.isFile() && /\.mjs$/.test(entry.name))
                .map((entry) => path.join(entry.parentPath, entry.name)),
        );
        const importers = paths.filter((file) =>
            /["'][^"']*items-coverage\.mjs["']/.test(fs.readFileSync(file, "utf8")),
        );
        expect(importers).toEqual([path.join(repository, "bin/content-commands.mjs")]);
        const source = fs.readFileSync(importers[0], "utf8");
        const calls = [...source.matchAll(/\bitemCoverage\s*\(/g)];
        expect(calls).toHaveLength(1);
        const start = source.indexOf("function itemsCommand()");
        const end = source.indexOf("\nfunction ", start + 1);
        expect(calls[0].index).toBeGreaterThan(start);
        expect(calls[0].index).toBeLessThan(end < 0 ? source.length : end);
    });

    it(
        "refuses an unsupported system and exposes command help",
        () => {
            const before = snapshot(root);
            const unknown = run("items", "coverage", "--system", "dnd5e");
            expect(unknown.status).not.toBe(0);
            expect(unknown.stderr).toMatch(/dnd5e.*(support|declar)/i);
            expect(unknown.stdout).toBe("");
            const help = run("items", "coverage", "--help");
            expect(help.status).toBe(0);
            expect(help.stdout).toContain("--system");
            expect(help.stdout).toContain("--json");
            expect(help.stdout).toMatch(/missing a system block/i);
            expect(snapshot(root)).toEqual(before);
        },
        subprocessTimeout(2),
    );
});
