/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPreviewCurrentDate, renderPreview } from "../engine/site-preview.mjs";
import { DEFAULT_CURRENT_DATE } from "../engine/current-date.mjs";

const roots: string[] = [];
function project(config?: string, extension = "yaml") {
    const root = mkdtempSync(path.join(os.tmpdir(), "preview-current-date-"));
    roots.push(root);
    if (config !== undefined)
        writeFileSync(path.join(root, `package-build.config.${extension}`), config);
    return root;
}
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const being = (born?: string, age?: number) =>
    `---\ntype: being\ndata:\n${born === undefined ? "  name: Local\n" : `  born: "${born}"\n`}${age === undefined ? "" : `  age: ${age}\n`}---\nAge: {{data.age}}`;

describe("preview current-date configuration", () => {
    it("uses the shared default when configuration or its setting is absent", async () => {
        expect(await readPreviewCurrentDate(project())).toBe(DEFAULT_CURRENT_DATE);
        expect(await readPreviewCurrentDate(project("unrelated: ignored\n"))).toBe(
            DEFAULT_CURRENT_DATE,
        );
    });
    it.each(["yaml", "yml"])(
        "reads only the nearest %s root setting, preserving ordinal digits",
        async (extension) => {
            const root = project(
                'currentDate: "730.001"\ncontentPackage: deliberately-incomplete\n',
                extension,
            );
            const child = path.join(root, "notes");
            mkdirSync(child);
            writeFileSync(path.join(child, "broken.md"), "---\nbroken: [yaml\n---");
            expect(await readPreviewCurrentDate(child)).toBe("730.001");
            writeFileSync(
                path.join(root, `package-build.config.${extension}`),
                'currentDate: "731.2"\n',
            );
            expect(await readPreviewCurrentDate(child)).toBe("731.2");
        },
    );
    it("loads and refreshes an opt-in MJS configuration", async () => {
        const root = project('export default { currentDate: "730.1" };\n', "mjs");
        expect(await readPreviewCurrentDate(root)).toBe("730.1");
        const file = path.join(root, "package-build.config.mjs");
        writeFileSync(file, 'export default { currentDate: "731.1" };\n');
        const later = new Date(Date.now() + 2000);
        utimesSync(file, later, later);
        expect(await readPreviewCurrentDate(root)).toBe("731.1");
    });
    it.each(['"unknown"', '"datefrom calendar 720 AF"', "null", "720.1"])(
        "rejects invalid explicit currentDate %s at its configuration location",
        async (value) => {
            const root = project(`contentPackage: demo\ncurrentDate: ${value}\n`);
            await expect(readPreviewCurrentDate(root)).rejects.toThrow(
                /package-build\.config\.yaml:2:\d+: error:.*currentDate/,
            );
        },
    );
    it("rejects competing configuration files", async () => {
        const root = project('currentDate: "730.1"\n');
        writeFileSync(path.join(root, "package-build.config.yml"), 'currentDate: "731.1"\n');
        await expect(readPreviewCurrentDate(root)).rejects.toThrow(/more than one configuration/);
    });
});

describe("preview ages from the setting's neutral current date", () => {
    it.each([
        ["700", undefined, 20],
        ["700.1", undefined, 20],
        ["700.2", undefined, 19],
        ["700.2", "720.2", 20],
        ["700.2", "730.1", 29],
    ])("computes birth %s against currentDate %s as %s", (born, currentDate, age) => {
        const result = renderPreview(being(born), { currentDate });
        expect(result.frontmatter.data.age).toBe(age);
        expect(result.html).toContain(`<dt>age</dt><dd>${age}</dd>`);
        expect(result.html).toContain(`Age: ${age}`);
    });
    it.each(["unknown", "datefrom calendar 700 AF", undefined])(
        "omits unavailable age for birth %s",
        (born) => {
            const result = renderPreview(being(born));
            expect(result.frontmatter.data.age).toBeNull();
            expect(result.html).not.toContain("<dt>age</dt>");
            expect(result.html).not.toContain("Not Calculated");
            expect(result.html).not.toContain("{{data.age}}");
            expect(result.html).toContain("Age: ");
        },
    );
    it("recalculates identical source when the date changes without retaining derived metadata", () => {
        const source = being("700.1");
        const first = renderPreview(source);
        expect(first.frontmatter.data.age).toBe(20);
        first.frontmatter.data.age = 999;
        const second = renderPreview(source, { currentDate: "740.1" });
        expect(second.frontmatter.data.age).toBe(40);
        expect(second.html).toContain("Age: 40");
        expect(renderPreview(source).frontmatter.data.age).toBe(20);
    });
    it("preserves an authored zero age", () => {
        const result = renderPreview(being("700", 0));
        expect(result.frontmatter.data.age).toBe(0);
        expect(result.html).toContain("<dt>age</dt><dd>0</dd>");
    });
    it("validates the explicit render option without reading project configuration", () => {
        expect(() => renderPreview(being("700"), { currentDate: "unknown" })).toThrow(
            /currentDate/,
        );
    });
});
