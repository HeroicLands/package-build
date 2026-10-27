/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ClassicLevel } from "classic-level";
import { afterEach, describe, expect, it } from "vitest";
import { fixture, note, outputBytes, write } from "./content-session-fixture.js";
import { subprocessTimeout } from "./subprocess-timeout.js";

const cli = fileURLToPath(new URL("../bin/package-build.mjs", import.meta.url));
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function repo() {
    const input = fixture();
    roots.push(input.root);
    return input;
}

function run(input: ReturnType<typeof fixture>, ...args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: input.root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: input.configFile },
        encoding: "utf8",
    });
    return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function locations(raw: string, literal: string) {
    const found = [];
    for (
        let offset = raw.indexOf(literal);
        offset >= 0;
        offset = raw.indexOf(literal, offset + 1)
    ) {
        const before = raw.slice(0, offset);
        found.push({ line: before.split("\n").length, column: offset - before.lastIndexOf("\n") });
    }
    return found;
}

async function nativeContents(input: ReturnType<typeof fixture>) {
    const contents = {};
    for (const pack of input.config.packDirectories) {
        const db = new ClassicLevel(path.join(input.config.paths.stage, pack), {
            valueEncoding: "json",
        });
        try {
            contents[pack] = await db.iterator().all();
        } finally {
            await db.close();
        }
    }
    return contents;
}

describe("package names advisories through the actual CLI", () => {
    it.each([
        { args: ["lint"] },
        { args: ["content", "run", "compile", "links", "lint", "index", "lint"] },
    ])(
        "$args emits one readable package advisory without failing",
        ({ args }) => {
            const input = repo();
            const files = [...input.files.keys()];
            const first = note(
                { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
                [
                    "😀 [Arden Vale]{.name}",
                    "",
                    '[Ravenmoor]{.name data-type="place/settlement"}',
                    "",
                    '[Ravenmoor]{.name data-type="place"}',
                    "",
                    '[Aldric Venn]{.name data-type="being"}',
                ].join("\n"),
            ).replaceAll("\n", "\r\n");
            const second = note(
                {
                    type: "lore",
                    subType: "history",
                    shortcode: "n1",
                    name: { full: "Arden Vale", en: ["Arden"] },
                },
                '[Ravenmoor]{.name data-type="being"}',
            );
            const hidden = note(
                {
                    type: "lore",
                    subType: "history",
                    shortcode: "n7",
                    name: { full: "Private Reader" },
                    tags: ["gm"],
                },
                '[Private Guest]{.name data-type="being"}',
            );
            write(files[0], first);
            write(files[1], second);
            write(files.at(-1), hidden);
            const result = run(input, ...args);
            expect(result.status, result.output).toBe(0);
            expect(result.stderr.match(/: warning: names:/g)).toHaveLength(1);
            expect(result.stdout).not.toContain(": warning: names:");
            const at = locations(first, "[Ravenmoor]")[0];
            expect(result.stderr).toContain(
                `assets/content/Note0.md:${at.line}:${at.column}: warning: names: 3 unwritten names; 1 conflicting name.`,
            );
            for (const [file, raw, label] of [
                [files[0], first, "[Ravenmoor]"],
                [files[0], first, "[Aldric Venn]"],
                [files[1], second, "[Ravenmoor]"],
                [files.at(-1), hidden, "[Private Guest]"],
            ])
                for (const at of locations(raw, label))
                    expect(result.stderr).toContain(
                        `${path.relative(input.root, file)}:${at.line}:${at.column}`,
                    );
            expect(result.stderr).toContain("\n  Unwritten place/settlement:");
            expect(result.stderr).toContain("\n  Incompatible Ravenmoor:");
            expect(result.stderr).toContain(": warning: first-use/unlinked-name:");
            expect(result.stderr).not.toContain(": error: ");
            if (args.includes("index")) {
                expect(
                    fs.existsSync(
                        path.join(input.config.paths.contentIndex, "sessionproof-metadata.jsonl"),
                    ),
                ).toBe(true);
                expect(fs.existsSync(input.config.paths.packJson)).toBe(true);
                expect(fs.existsSync(input.config.paths.stage)).toBe(true);
            } else {
                expect(fs.existsSync(input.config.paths.contentIndex)).toBe(false);
                expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
            }
            expect(fs.readFileSync(files[0], "utf8")).toBe(first);
        },
        subprocessTimeout(2),
    );

    it(
        "omits the package advisory when every explicit name is known",
        () => {
            const input = repo();
            const files = [...input.files.keys()];
            write(
                files[0],
                note(
                    { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
                    '[Tongue]{.name data-type="skill/language"}',
                ),
            );
            const result = run(input, "lint");
            expect(result.status, result.output).toBe(0);
            expect(result.stderr).toContain(": warning: first-use/unlinked-name:");
            expect(result.stderr).not.toContain(": warning: names:");
        },
        subprocessTimeout(1),
    );

    it(
        "refuses invalid attributes once at exact source sites and preserves all writer outputs",
        async () => {
            const input = repo();
            const beforeCompile = run(input, "package", "compile");
            expect(beforeCompile.status, beforeCompile.output).toBe(0);
            const beforeIndex = run(input, "content-index");
            expect(beforeIndex.status, beforeIndex.output).toBe(0);
            const native = await nativeContents(input);
            const outputs = [
                input.config.paths.contentIndex,
                input.config.paths.packJson,
                input.config.paths.stage,
            ];
            const before = outputs.map(outputBytes);
            const file = [...input.files.keys()][0];
            const raw = note(
                { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
                [
                    '  😀 [First]{.name data-hint="data-type" data-type="wrong"}',
                    "",
                    '[Outer [Second]{.name data-type="vehicle/not-valid"}]{.wide}',
                ].join("\n"),
            ).replaceAll("\n", "\r\n");
            write(file, raw);
            const result = run(input, "content", "run", "compile", "index", "lint", "links");
            expect(result.status, result.output).toBe(1);
            const actual = result.stderr
                .split("\n")
                .filter((line) => line.includes(": error: data-type"));
            expect(actual).toHaveLength(2);
            for (const literal of ['data-type="wrong"', 'data-type="vehicle/not-valid"']) {
                const at = locations(raw, literal)[0];
                expect(
                    actual.filter((line) =>
                        line.startsWith(`assets/content/Note0.md:${at.line}:${at.column}: error:`),
                    ),
                ).toHaveLength(1);
            }
            expect(outputs.map(outputBytes)).toEqual(before);
            expect(await nativeContents(input)).toEqual(native);
            expect(fs.readFileSync(file, "utf8")).toBe(raw);
            expect(result.output).not.toContain("TypeError");
        },
        subprocessTimeout(3),
    );
});
