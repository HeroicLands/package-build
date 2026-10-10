/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const HEADER_LINES = 12;

/** The first twelve lines, after a leading shebang line when there is one. */
const headerOf = (text: string): string =>
    text
        .replace(/^#!.*\n/, "")
        .split("\n")
        .slice(0, HEADER_LINES)
        .join("\n");

describe("every shipped module carries the full GPL-3.0 header", () => {
    const reference = headerOf(fs.readFileSync(path.join(root, "engine/address.mjs"), "utf8"));

    const ls = spawnSync("git", ["ls-files", "*.mjs"], {
        cwd: root,
        encoding: "utf8",
    });

    const shipped = ls.stdout.split("\n").filter((f) => f !== "" && !f.startsWith("tests/"));

    it("reads the reference header from engine/address.mjs", () => {
        expect(ls.status).toBe(0);
        expect(reference.split("\n")).toHaveLength(HEADER_LINES);
        expect(reference).toMatch(/^\/\*\n/);
        expect(reference).toMatch(/SPDX-License-Identifier: GPL-3\.0-or-later\n \*\/$/);
    });

    it("lists the shipped modules outside tests/", () => {
        expect(shipped.length).toBeGreaterThan(0);
        expect(shipped).toContain("engine/address.mjs");
    });

    it("opens every shipped module with the full header", () => {
        const missing = shipped.filter(
            (f) => headerOf(fs.readFileSync(path.join(root, f), "utf8")) !== reference,
        );
        expect(missing).toEqual([]);
    });

    it("skips a leading shebang line when comparing", () => {
        expect(headerOf(`#!/usr/bin/env node\n${reference}\n\ncode();\n`)).toBe(reference);
        expect(headerOf(`${reference}\n\ncode();\n`)).toBe(reference);
        expect(
            headerOf(`#!/usr/bin/env node\n/* SPDX-License-Identifier: GPL-3.0-or-later */\n`),
        ).not.toBe(reference);
    });
});
