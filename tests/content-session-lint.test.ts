/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yargs from "yargs/yargs";
import * as firstUse from "../engine/first-use.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const roots: string[] = [];
const originalExitCode = process.exitCode;
afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it.each([{ args: ["lint"] }, { args: ["content", "run", "lint", "lint"] }])(
    "$args constructs one existing first-use checker and reports its exact raw-source warnings without failing",
    async ({ args }) => {
        const input = fixture();
        roots.push(input.root);
        const file = [...input.files.keys()][0];
        write(
            [...input.files.keys()][1],
            note(
                {
                    type: "lore",
                    subType: "history",
                    shortcode: "n1",
                    name: { full: "Arden Vale", aliases: ["Arden"] },
                },
                "# Here {#here}\n\nWritten prose.",
            ),
        );
        const raw = note(
            { type: "lore", subType: "history", shortcode: "n0", name: { full: "Reader" } },
            [
                "😀 Tongue waits. Arden waits for Arden Vale.\r",
                "",
                "[Arden]{.name} before [Arden Vale]{.name}.\r",
                "",
                "**Arden Vale** and **Hidden Hand**.\r",
                "",
                "[[lore-n1|Arden Vale]] and [Arden][the-vale].\r",
                "",
                "[Hidden Hand]{.name} and [Hidden Hand]{.name}.",
                "",
                "[the-vale]: https://example.invalid/vale",
            ].join("\n"),
        );
        write(file, raw);
        const expectedSession = await createContentSession({ config: input.config });
        const expectedChecker = firstUse.createFirstUseChecker({
            records: expectedSession.records,
            index: await expectedSession.audit("lint"),
        });
        const expected = expectedChecker({ file, raw });
        expectedSession.dispose();
        expect(expected).toHaveLength(5);
        expect(new Set(expected.map((finding) => `${finding.line}:${finding.column}`)).size).toBe(
            expected.length,
        );
        expect(expected.map((finding) => finding.rules)).toEqual([
            ["unlinked-name", "short-before-full"],
            ["unlinked-name", "repeated-name"],
            ["repeated-name"],
            ["repeated-name"],
            ["repeated-name"],
        ]);
        expect(expected.every((finding) => finding.severity === "warning")).toBe(true);
        const plainLine = raw.split("\n").findIndex((line) => line.startsWith("😀 Tongue")) + 1;
        expect(expected.some((finding) => finding.line === plainLine)).toBe(false);
        vi.resetModules();
        vi.stubEnv("PACKAGE_BUILD_CONFIG", input.configFile);
        const create = vi.spyOn(await import("../engine/first-use.mjs"), "createFirstUseChecker");
        const names = await import("../engine/names.mjs");
        const catalog = vi.spyOn(names, "createNameCatalog");
        const report = vi.spyOn(names, "createNamesReport");
        const derive = vi.spyOn(await import("../engine/content-index.mjs"), "indexRecordsFor");
        const reads: string[] = [];
        const read = fs.readFileSync;
        vi.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) => {
            if (input.files.has(String(args[0]))) reads.push(String(args[0]));
            return read(...(args as Parameters<typeof fs.readFileSync>));
        });
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        process.exitCode = undefined;
        const { registerContentCommands } = await import("../bin/content-commands.mjs");
        await registerContentCommands(yargs([]).exitProcess(false).strict()).parseAsync(args);
        expect(create).toHaveBeenCalledTimes(1);
        expect(catalog).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0]).toMatchObject({
            parsed: expect.any(Map),
            syntax: expect.any(Function),
            catalog: catalog.mock.results[0].value,
        });
        expect(report.mock.calls[0][0].catalog).toBe(catalog.mock.results[0].value);
        expect(derive).toHaveBeenCalledTimes(1);
        expect(reads.sort()).toEqual([...input.files.keys()].sort());
        expect(
            warnings.mock.calls
                .flat()
                .filter((line) => String(line).includes(": warning: first-use/")),
        ).toEqual(expected.map(formatDiagnostic));
        const summary = warnings.mock.calls
            .flat()
            .filter((line) => String(line).includes(": warning: names:"));
        expect(summary).toHaveLength(1);
        const marker = "[Hidden Hand]{.name}";
        const start = raw.indexOf(marker);
        const prefix = raw.slice(0, start);
        expect(summary[0]).toContain(
            `${file}:${prefix.split("\n").length}:${start - prefix.lastIndexOf("\n")}: warning: names: 1 unwritten name.`,
        );
        for (let offset = start; offset >= 0; offset = raw.indexOf(marker, offset + 1)) {
            const before = raw.slice(0, offset);
            expect(summary[0]).toContain(
                `${file}:${before.split("\n").length}:${offset - before.lastIndexOf("\n")}`,
            );
        }
        expect(
            errors.mock.calls.flat().filter((line) => String(line).includes(": error: ")),
        ).toEqual([]);
        expect(process.exitCode ?? 0).toBe(0);
        expect(fs.existsSync(input.config.paths.contentIndex)).toBe(false);
        expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
    },
);
