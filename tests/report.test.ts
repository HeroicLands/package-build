/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * How the command line turns a rule's findings into diagnostics, and what it
 * decides from them.
 *
 * The rules themselves are pure and return findings; the binary is the caller
 * that owns reporting. These cases pin the two decisions that ownership
 * carries — the shape a finding is emitted in, and the exit code a run earns —
 * because every consumer used to make them separately and differently.
 */

import { describe, it, expect } from "vitest";

import { reportFindings, toDiagnostics } from "../bin/report.mjs";

describe("toDiagnostics", () => {
    it("attaches the file every finding is about", () => {
        // A rule reports a position within a file it was handed; it never
        // learns the path, so the caller is the only one who can say it.
        expect(
            toDiagnostics([{ severity: "error", message: "bad", line: 3 }], {
                file: "lang/en.json",
            }),
        ).toEqual([
            {
                file: "lang/en.json",
                line: 3,
                severity: "error",
                message: "bad",
            },
        ]);
    });

    it("keeps a line and column together", () => {
        expect(
            toDiagnostics(
                [{ severity: "error", message: "bad", line: 3, column: 12 }],
                { file: "lang/en.json" },
            ),
        ).toEqual([
            {
                file: "lang/en.json",
                line: 3,
                column: 12,
                severity: "error",
                message: "bad",
            },
        ]);
    });

    it("drops a field rather than guessing it", () => {
        // Never 1:1. A guessed position sends a reader to the top of the file
        // every time, which is worse than admitting the position is unknown.
        const [d] = toDiagnostics([{ severity: "error", message: "bad" }], {
            file: "build/stage/sohl.mjs",
        });

        expect(d).toEqual({
            file: "build/stage/sohl.mjs",
            severity: "error",
            message: "bad",
        });
        expect("line" in d).toBe(false);
        expect("column" in d).toBe(false);
    });

    it("drops a column that has no line to sit on", () => {
        // A column alone locates nothing, and `formatLocator` ignores it — so
        // carrying it would only invite a reader to trust it.
        const [d] = toDiagnostics(
            [{ severity: "error", message: "bad", column: 12 }],
            { file: "build/stage/sohl.mjs" },
        );

        expect("column" in d).toBe(false);
    });

    it("defaults an unstated severity to error", () => {
        const [d] = toDiagnostics([{ message: "bad" }], { file: "a.json" });
        expect(d.severity).toBe("error");
    });

    it("preserves a warning", () => {
        const [d] = toDiagnostics([{ severity: "warning", message: "hm" }], {
            file: "a.json",
        });
        expect(d.severity).toBe("warning");
    });

    // A rule that reads one file at a time cannot name it; a rule that spans a
    // whole repository — every source that references a localization key — can
    // name nothing else, since one path could not be right for all of them.
    it("lets a finding that knows its own file keep it", () => {
        expect(
            toDiagnostics(
                [
                    { message: "declared here", file: "lang/en.json", line: 4 },
                    { message: "used here", file: "src/a.ts", line: 9 },
                ],
                { file: "lang/en.json" },
            ).map((d) => d.file),
        ).toEqual(["lang/en.json", "src/a.ts"]);
    });

    it("needs no default file when every finding carries one", () => {
        expect(
            toDiagnostics([{ message: "x", file: "src/a.ts" }], {})[0].file,
        ).toBe("src/a.ts");
    });
});

describe("reportFindings", () => {
    it("emits one diagnostic per finding, in order", () => {
        const seen: unknown[] = [];
        reportFindings(
            [
                { severity: "error", message: "first", line: 1 },
                { severity: "error", message: "second", line: 9 },
            ],
            { file: "a.json", emit: (d: unknown) => seen.push(d) },
        );

        expect(seen).toEqual([
            { file: "a.json", line: 1, severity: "error", message: "first" },
            { file: "a.json", line: 9, severity: "error", message: "second" },
        ]);
    });

    it("counts only errors, so a warning does not fail a build", () => {
        const errors = reportFindings(
            [
                { severity: "warning", message: "hm" },
                { severity: "error", message: "bad" },
                { severity: "warning", message: "also hm" },
            ],
            { file: "a.json", emit: () => {} },
        );

        expect(errors).toBe(1);
    });

    it("reports nothing and counts nothing when a check passes", () => {
        const seen: unknown[] = [];
        const errors = reportFindings([], {
            file: "a.json",
            emit: (d: unknown) => seen.push(d),
        });

        expect(seen).toEqual([]);
        expect(errors).toBe(0);
    });
});
