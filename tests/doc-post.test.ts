/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A blog post is a `doc` of `subType: post`. It states the day it was
 * published in `data.date` and may name its writer in `data.author`; its
 * `tags` are the top-level ones every note may carry. Both fields belong to a
 * post alone, and each finding is located where the author fixes it.
 */

import { describe, expect, it } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, subTypes } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/** A `doc` note with a real frontmatter fence, so a finding can be located in it. */
const note = (fm: Record<string, unknown>, extra = "") => {
    const body = { type: "doc", shortcode: "apost", ...fm };
    const lines: string[] = [];
    for (const [key, value] of Object.entries(body)) {
        if (key === "data" && value && typeof value === "object") {
            lines.push("data:");
            for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
        } else lines.push(`${key}: ${JSON.stringify(value)}`);
    }
    return {
        file: "/tree/post.md",
        type: "doc",
        raw: `---\n${lines.join("\n")}\n---\n${extra}`,
        fm: body,
    };
};

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

/** The text of the frontmatter at a finding's line and column. */
const at = (n: { raw: string }, f: { line: number; column: number }) =>
    n.raw.split("\n")[f.line - 1].slice(f.column - 1);

describe("a blog post", () => {
    it("is a `doc` genre", () => {
        expect(subTypes("doc")).toContain("post");
    });

    it("accepts a date, an author and tags", () => {
        const post = note({
            subType: "post",
            tags: ["news"],
            data: { date: "2026-04-15", author: "Ann Author" },
        });
        expect(lintNote(post, opts)).toEqual([]);
    });

    it("accepts a post that names no author: the site's byline stands", () => {
        expect(lintNote(note({ subType: "post", data: { date: "2026-04-15" } }), opts)).toEqual([]);
    });

    it("refuses a post with no date, at its `subType:` line", () => {
        const post = note({ subType: "post" });
        const findings = lintNote(post, opts) as any[];
        expect(findings).toEqual([
            expect.objectContaining({
                file: "/tree/post.md",
                severity: "error",
                message: expect.stringContaining("must state `data.date`"),
            }),
        ]);
        expect(at(post, findings[0])).toMatch(/^subType/);
    });

    it.each(["15 April 2026", "2026-4-15", "2026-02-30", "2026-04-15T10:00:00Z"])(
        "refuses the date %s, at the value",
        (date) => {
            const post = note({ subType: "post", data: { date } });
            const findings = lintNote(post, opts) as any[];
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({ severity: "error" });
            expect(findings[0].message).toContain("`data.date`");
            expect(findings[0].message).toContain("YYYY-MM-DD");
            expect(at(post, findings[0])).toBe(JSON.stringify(date));
        },
    );

    it("refuses an empty author, at the value", () => {
        const post = note({ subType: "post", data: { date: "2026-04-15", author: " " } });
        const findings = lintNote(post, opts) as any[];
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`data.author`");
        expect(at(post, findings[0])).toBe('" "');
    });

    it.each([
        ["date", "2026-04-15"],
        ["author", "Ann Author"],
    ])("refuses `data.%s` on a doc that is not a post, at the key", (key, value) => {
        const page = note({ subType: "reference", data: { [key]: value } });
        const findings = lintNote(page, opts) as any[];
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "error" });
        expect(findings[0].message).toContain(`\`data.${key}\` is stated by a post`);
        expect(at(page, findings[0])).toMatch(new RegExp(`^${key}:`));
    });

    it("refuses `data.date` on a doc with no subType", () => {
        const findings = lintNote(note({ data: { date: "2026-04-15" } }), opts) as any[];
        expect(findings.map((f) => f.message).join("\n")).toContain("is stated by a post");
    });
});
