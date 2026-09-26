/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatNoteFrontmatter } from "../engine/note-format.mjs";

function frontmatter(source: string) {
    return YAML.parse(source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "");
}

describe("canonical note frontmatter", () => {
    it("orders the allowed fields", () => {
        const input =
            "---\nsohl: {}\ndata: {}\ntags:\n  - draft\ntype: lore\n" +
            "name:\n  full: Example\nshortcode: example\n---\n\nBody.\n";
        const output = formatNoteFrontmatter(input);
        expect(output).toMatch(
            /^---\nshortcode: example\nname: \{full: Example\}\ntype: lore\ntags: \[draft\]\ndata: \{\}\nsohl: \{\}\n---/,
        );
        expect(frontmatter(output)).toEqual(frontmatter(input));
        expect(output.endsWith("\n\nBody.\n")).toBe(true);
        expect(formatNoteFrontmatter(output)).toBe(output);
    });

    it("uses a block at 100 characters and a flow line below it", () => {
        const line = (count: number) => `name: {full: ${"x".repeat(count)}}`;
        const short = line(99 - line(0).length);
        const long = line(100 - line(0).length);
        const note = (name: string) => `---\nshortcode: example\ntype: lore\n${name}\n---\nBody.\n`;
        expect(formatNoteFrontmatter(note(short))).toContain(`${short}\n`);
        expect(formatNoteFrontmatter(note(long))).toContain("name:\n  full:");
    });

    it("expands a wrapped flow value into a full block", () => {
        const values = Array.from({ length: 15 }, (_, index) => `value${index}`).join(",\n  ");
        const input = `---\nshortcode: example\ntype: lore\ntags: [\n  ${values}\n]\n---\nBody.\n`;
        const output = formatNoteFrontmatter(input);
        expect(output).toContain("tags:\n  - value0\n");
        expect(frontmatter(output)).toEqual(frontmatter(input));
    });

    it("keeps comments, anchors, and block scalars with their values", () => {
        const input =
            "---\n# note name\nname:\n  full: Example\nshortcode: example\n" +
            "type: lore\ndata:\n  text: |\n    First\n    Second\n" +
            "  nums: &vals [1, 2]\n  copy: *vals\n---\nBody.\n";
        const output = formatNoteFrontmatter(input);
        expect(output).toContain("# note name\nname:");
        expect(output).toContain("text: |\n    First\n    Second\n");
        expect(output).toContain("nums: &vals [1, 2]");
        expect(frontmatter(output)).toEqual(frontmatter(input));
    });

    it("keeps an alias whose anchor is outside its enclosing collection", () => {
        const input =
            "---\nshortcode: example\ntype: lore\ndata:\n" +
            "  first: &parts [head, hands]\n" +
            "  second: {roles: *parts}\n---\nBody.\n";
        const output = formatNoteFrontmatter(input);
        expect(output).toContain("first: &parts [head, hands]");
        expect(output).toContain("second:\n    roles: *parts");
        expect(frontmatter(output)).toEqual(frontmatter(input));
    });

    it("leaves ordinary Markdown without an address alone", () => {
        const input = "---\ntitle: Notes\n---\n\nBody.\n";
        expect(formatNoteFrontmatter(input)).toBe(input);
    });
});
