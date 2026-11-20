/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertPopulation, convertFiles } from "../scripts/convert-population-actual.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("population source conversion", () => {
    it("wraps block and flow values while preserving comments, spelling and body", () => {
        const source =
            "---\ntype: affiliation\ndata:\n  population: 1200 # residents\n  territorial_population: null\n  settlements: [{name: A, population: 0}, {name: B, population: null}] # rows\n  untouched: {population: 42}\n---\n\n::: secret\npopulation: 42\n:::\n";
        const expected =
            "---\ntype: affiliation\ndata:\n  population: {actual: 1200} # residents\n  territorial_population: {actual: null}\n  settlements: [{name: A, population: {actual: 0}}, {name: B, population: {actual: null}}] # rows\n  untouched: {population: 42}\n---\n\n::: secret\npopulation: 42\n:::\n";
        const result = convertPopulation(source, "note.md");
        expect(result.text).toBe(expected);
        expect(result.wrapped).toBe(4);
        expect(convertPopulation(result.text, "note.md")).toMatchObject({
            text: expected,
            wrapped: 0,
        });
    });
    it("retains flow-style data and existing declarations", () => {
        const source =
            "---\ndata: {population: 23, territorial_population: {actual: 50, apparent: 0}, settlements: [{population: {actual: null}}]}\n---\nbody\n";
        expect(convertPopulation(source, "note.md").text).toBe(
            source.replace("population: 23", "population: {actual: 23}"),
        );
    });
    it.each([
        ["  population: bad", 3],
        ["  population: [1]", 3],
        ["  population: {apparent: 3}", 3],
        ["  settlements: wrong", 3],
        ["  settlements: [{population: false}]", 3],
        ["  population: &n 12\n  territorial_population: *n", 3],
    ])("refuses unsupported source with a located finding: %s", (line, expectedLine) => {
        expect(() => convertPopulation(`---\ndata:\n${line}\n---\nbody\n`, "note.md")).toThrow(
            new RegExp(`^note\\.md:${expectedLine}:\\d+: error:`),
        );
    });
    it("previews without writes and refuses a batch before any partial write", () => {
        const root = fs.mkdtempSync(path.join(process.env.TMPDIR!, "population-convert-"));
        roots.push(root);
        const first = path.join(root, "first.md");
        const second = path.join(root, "second.md");
        const before = "---\ndata: {population: 12}\n---\nbody\n";
        fs.writeFileSync(first, before);
        fs.writeFileSync(second, "---\ndata: {population: bad}\n---\nbody\n");
        expect(() => convertFiles([first, second], { write: true })).toThrow();
        expect(fs.readFileSync(first, "utf8")).toBe(before);
        fs.writeFileSync(second, "---\ndata: {population: null}\n---\nbody\n");
        expect(convertFiles([first, second], { write: false })).toMatchObject({
            files: 2,
            changed: 2,
            wrapped: 2,
        });
        expect(fs.readFileSync(first, "utf8")).toBe(before);
        expect(convertFiles([first, second], { write: true })).toMatchObject({
            files: 2,
            changed: 2,
            wrapped: 2,
        });
        expect(fs.readFileSync(first, "utf8")).toContain("population: {actual: 12}");
        expect(convertFiles([first, second], { write: true })).toMatchObject({
            changed: 0,
            wrapped: 0,
        });
    });
});
