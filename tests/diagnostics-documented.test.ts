/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The command table in `docs/diagnostics.md` names exactly the commands the CLI
 * has.
 *
 * Each table row begins with a backtick-quoted invocation. A row is valid when
 * its words resolve against the real command tree read from source: a root
 * command, then a nested command or one of the action choices that command
 * declares. Every command that does something — one without nested commands —
 * must have a row, so a new command cannot ship without saying what it reports
 * and when it fails. A command's actions are checked only for being real.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, nodes } from "./helpers/command-surface.js";

const DOC = fs.readFileSync(path.join(ROOT, "docs", "diagnostics.md"), "utf8");

/** The standalone binary that is not part of the yargs tree. */
const PREVIEW = "package-build-preview";

/** Every row's invocation words, from the command table only. */
function tableInvocations(): string[][] {
    const start = DOC.search(/^\| command\s+\| reports\s+\| fails when\s+\|$/m);
    expect(start, "the command table has its header row").toBeGreaterThan(-1);
    const rows: string[][] = [];
    for (const line of DOC.slice(start).split("\n").slice(2)) {
        if (!line.startsWith("|")) break;
        const cell = line.match(/^\|\s*`([^`]+)`/);
        expect(cell, `row starts with a backtick-quoted command: ${line.slice(0, 60)}`).not.toBe(
            null,
        );
        rows.push(cell![1].split(/\s+/).filter((word) => !/^[<[-]/.test(word)));
    }
    return rows;
}

/** `package-build lint` → `lint`; the preview binary stays whole. */
function commandPath(words: string[]): string[] | null {
    if (words[0] === PREVIEW) return [PREVIEW];
    return words[0] === "package-build" ? words.slice(1) : null;
}

const realPaths = nodes.filter((n) => n.binary === "package-build").map((n) => n.path.join(" "));
const leaves = nodes
    .filter((n) => n.binary === "package-build" && n.node.children.length === 0)
    .map((n) => n.path.join(" "));

describe("docs/diagnostics.md command table", () => {
    const rows = tableInvocations().map((words) => commandPath(words));

    it("reads a non-trivial table and command list", () => {
        expect(rows.length).toBeGreaterThan(40);
        expect(leaves.length).toBeGreaterThan(40);
        expect(rows.every((r) => r !== null)).toBe(true);
    });

    it("has a row for every command that does something", () => {
        const documented = rows.map((r) => r!.join(" "));
        const missing = leaves.filter(
            (leaf) => !documented.some((d) => d === leaf || d.startsWith(`${leaf} `)),
        );
        expect(missing).toEqual([]);
    });

    it("has a row for the standalone preview binary", () => {
        expect(rows.some((r) => r![0] === PREVIEW)).toBe(true);
    });

    it("names only commands and actions that exist", () => {
        const unknown: string[] = [];
        for (const row of rows) {
            const words = row!;
            if (words[0] === PREVIEW) continue;
            let current = nodes.find(
                (n) => n.binary === "package-build" && n.path.join(" ") === words[0],
            );
            if (!current) {
                unknown.push(words.join(" "));
                continue;
            }
            for (const word of words.slice(1)) {
                const nested = nodes.find(
                    (n) => n.path.join(" ") === `${current!.path.join(" ")} ${word}`,
                );
                if (nested) current = nested;
                else if (!current.node.choices.includes(word)) unknown.push(words.join(" "));
            }
        }
        expect(unknown).toEqual([]);
    });
});
