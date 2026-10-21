/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A page's frontmatter is read as the content index reads a note, and written
 * in the one serialized form every page carries.** The site build, the preview
 * and the item-fields page share {@link readMatter} and {@link writeMatter}, so
 * a value reads the same on the site as in a compendium pack, and a written
 * page reads back to exactly the values and body it was given.
 */

import { describe, expect, it } from "vitest";

import { parseMarkdownFile } from "../engine/helpers.mjs";
import { readMatter, writeMatter } from "../engine/note-matter.mjs";

const NOTE = [
    "---",
    "shortcode: arden",
    "type: place",
    "name: {full: Arden Vale, aliases: [Arden]}",
    "data:",
    "  founded: 2026-04-15",
    "  span: 1:30",
    "  ok: yes",
    "  rank: 017",
    "---",
    "",
    "# Arden Vale",
    "",
    "Body text.",
    "",
].join("\n");

describe("reading a page", () => {
    it("gives the values the content index gives the same note, and the body after the fence", () => {
        const index = parseMarkdownFile("Arden.md", { raw: NOTE, renderDescription: false });
        const page = readMatter(NOTE);
        expect(page.data).toEqual(index.frontmatter);
        expect(page.content).toBe("\n# Arden Vale\n\nBody text.\n");
        expect(page.data.data).toEqual({
            founded: "2026-04-15",
            span: "1:30",
            ok: "yes",
            rank: 17,
        });
    });

    it("keeps a CRLF body exactly and returns the YAML source it parsed", () => {
        const crlf = NOTE.replaceAll("\n", "\r\n");
        const page = readMatter(crlf);
        expect(page.content).toBe("\r\n# Arden Vale\r\n\r\nBody text.\r\n");
        expect(page.matter.startsWith("shortcode: arden\r\n")).toBe(true);
        expect(page.data.shortcode).toBe("arden");
    });

    it("reads a file with no frontmatter as an empty map and the whole text", () => {
        for (const text of ["# Just prose\n", "", "----\nnot: frontmatter\n"])
            expect(readMatter(text)).toEqual({ data: {}, content: text, matter: "" });
    });

    it("reads an empty frontmatter block as an empty map", () => {
        expect(readMatter("---\n\n---\nBody\n")).toMatchObject({ data: {}, content: "Body\n" });
    });

    it("throws on frontmatter that is not YAML", () => {
        expect(() => readMatter("---\nname: [unclosed\n---\nBody\n")).toThrow();
    });

    it("returns a fresh map on every call", () => {
        const first = readMatter(NOTE);
        first.data.shortcode = "changed";
        expect(readMatter(NOTE).data.shortcode).toBe("arden");
    });
});

describe("writing a page", () => {
    it("fences the YAML above the body and closes the body on a newline", () => {
        expect(writeMatter("# Title\n\nText.", { title: "Arden Vale", weight: 3 })).toBe(
            "---\ntitle: Arden Vale\nweight: 3\n---\n# Title\n\nText.\n",
        );
    });

    it("writes no fence for an empty map", () => {
        expect(writeMatter("Body\n", {})).toBe("Body\n");
    });

    it("quotes a string a YAML 1.1 reader would take for another type", () => {
        const page = writeMatter("", { a: "yes", b: "1:30", c: "2026-04-15", d: "017", e: "on" });
        expect(page).toBe("---\na: 'yes'\nb: '1:30'\nc: '2026-04-15'\nd: '017'\ne: 'on'\n---\n\n");
    });

    it("folds a long string into a folded block", () => {
        const long =
            "The generated per-type field reference for all 13 item types: every `sohl:` field, its shape, requiredness, and default.";
        expect(writeMatter("", { description: long })).toBe(
            `---\ndescription: >-\n  The generated per-type field reference for all 13 item types: every \`sohl:\`\n  field, its shape, requiredness, and default.\n---\n\n`,
        );
    });

    it("reads back to exactly the values and body it was given", () => {
        const data = {
            title: "Geldar Panivel, the Younger",
            formula: "-5 * floor((str - 10) / 2)",
            list: ["a, b", "#hash", "x: y", ""],
            nested: { n: 1.5, t: true, z: null, s: "multi\nline" },
        };
        const body = "Line one.\r\n\r\nLine two.\n";
        expect(readMatter(writeMatter(body, data))).toMatchObject({ data, content: body });
    });
});
