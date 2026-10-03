/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A list item opened with `[ ]` or `[x]`.
 *
 * Nothing is miscompiled either way: with the website's checkbox extension
 * off, all three surfaces set the marker as the item's own text and agree with
 * each other. This pins the advisory that tells an author the two characters
 * read as an interactive control on no surface, so a checklist wants ordinary
 * words instead — narrowed to the marker that opens a list item, never a
 * bracket pair elsewhere in a line, and never one shown as a markup example.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    checkTaskLists,
    taskListMessage,
    lintContentTaskLists,
    TASK_LIST_MARKER,
} from "../engine/content-tasklists.mjs";

describe("checkTaskLists", () => {
    it("reports a bulleted item opened with an unchecked box", () => {
        const findings = checkTaskLists("- [ ] undone\n", "N.md");

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`- [ ]`");
    });

    it("reports a bulleted item opened with a checked box, case-insensitively", () => {
        for (const marker of ["- [x] done", "- [X] done"]) {
            const findings = checkTaskLists(`${marker}\n`, "N.md");
            expect(findings).toHaveLength(1);
        }
    });

    it("reports every bullet marker commonmark accepts", () => {
        const body = "- [ ] dash\n* [ ] star\n+ [ ] plus\n";
        expect(checkTaskLists(body, "N.md")).toHaveLength(3);
    });

    it("reports an ordered list item the same way", () => {
        const body = "1. [ ] first\n2) [x] second\n";
        expect(checkTaskLists(body, "N.md")).toHaveLength(2);
    });

    it("names the file, the position and the marker", () => {
        const [finding] = checkTaskLists("one\ntwo\n- [ ] three\n", "Guide/N.md");

        expect(finding.file).toBe("Guide/N.md");
        expect(finding.line).toBe(3);
        expect(finding.column).toBe(1);
        expect(finding.message).toContain("`- [ ]`");
    });

    it("locates a nested item's marker, not the line's first column", () => {
        const [finding] = checkTaskLists("- parent\n  - [ ] child\n", "N.md");

        expect(finding.line).toBe(2);
        expect(finding.column).toBe(3);
    });

    it("is a warning, so it cannot fail a build", () => {
        // Every surface agrees on a literal bracket, so nothing is wrong with
        // the document — only with what the author likely meant.
        for (const finding of checkTaskLists("- [ ] x", "N.md")) {
            expect(finding.severity).toBe("warning");
        }
    });

    it("says nothing about a note that is only markdown", () => {
        expect(checkTaskLists("- an ordinary item\n- [done] another\n", "N.md")).toEqual([]);
    });

    it("says nothing about an empty body", () => {
        expect(checkTaskLists("", "N.md")).toEqual([]);
        expect(checkTaskLists(undefined as never, "N.md")).toEqual([]);
    });
});

describe("what is not a task-list marker", () => {
    it("leaves a bracket in the middle of an item alone", () => {
        expect(checkTaskLists("- the array reads `[ ]` when it is empty\n", "N.md")).toEqual([]);
    });

    it("leaves a bracket in prose, outside any list, alone", () => {
        expect(checkTaskLists("A table cell may read [ ] for unset.\n", "N.md")).toEqual([]);
    });

    it("requires a marker, a bracket pair and a space — not a bare bracket", () => {
        expect(checkTaskLists("- [ ]no space after the box\n", "N.md")).toEqual([]);
    });
});

describe("code is an example, not a mistake", () => {
    it("leaves a fenced block alone", () => {
        const body = "Before.\n\n```markdown\n- [ ] undone\n```\n\nAfter.";

        expect(checkTaskLists(body, "N.md")).toEqual([]);
    });

    it("leaves an inline code span alone", () => {
        expect(checkTaskLists("Write `- [ ] undone` and it renders.", "N.md")).toEqual([]);
    });

    it("still reports a marker beside one that is quoted", () => {
        const findings = checkTaskLists("Say `- [ ]` but never write\n- [ ] here\n", "N.md");

        expect(findings).toHaveLength(1);
        expect(findings[0].line).toBe(2);
    });
});

describe("the message", () => {
    it("names the marker and what to write instead", () => {
        const message = taskListMessage("- [ ] ");

        expect(message).toContain("`- [ ]`");
        expect(message).toContain("ordinary list");
    });
});

describe("TASK_LIST_MARKER", () => {
    it("is global, because a note is scanned for every item it carries", () => {
        expect(TASK_LIST_MARKER.global).toBe(true);
    });
});

describe("lintContentTaskLists", () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "content-tasklists-"));
        fs.mkdirSync(path.join(root, "Guide"), { recursive: true });
        fs.mkdirSync(path.join(root, "Templates"), { recursive: true });

        fs.writeFileSync(
            path.join(root, "Guide", "Checklist.md"),
            "---\ntype: doc\nshortcode: checklist\n---\n\n- [ ] first\n- [x] second\n",
        );
        fs.writeFileSync(
            path.join(root, "Guide", "Clean.md"),
            "---\ntype: doc\nshortcode: clean\n---\n\n- an ordinary item\n",
        );
        fs.writeFileSync(
            path.join(root, "Templates", "Skipped.md"),
            "---\ntype: doc\n---\n\n- [ ] skipped\n",
        );
        fs.writeFileSync(path.join(root, "notes.txt"), "- [ ] not markdown");
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("reports a marker at its position in the file, not in the body", () => {
        const { findings } = lintContentTaskLists(root);
        const checklist = findings.filter((f) => f.file.endsWith("Checklist.md"));

        expect(checklist).toHaveLength(2);
        // The frontmatter's four lines and the blank line sit above it.
        expect(checklist[0].line).toBe(6);
        expect(checklist[0].column).toBe(1);
    });

    it("says nothing about a note with no such marker", () => {
        const { findings } = lintContentTaskLists(root);

        expect(findings.some((f) => f.file.endsWith("Clean.md"))).toBe(false);
    });

    it("honours the tree's skipped directories", () => {
        const { findings } = lintContentTaskLists(root, { skipDirectories: ["Templates"] });

        expect(findings.some((f) => f.file.includes("Templates"))).toBe(false);
        expect(lintContentTaskLists(root).findings.some((f) => f.file.includes("Templates"))).toBe(
            true,
        );
    });

    it("reads markdown only, and counts what it read", () => {
        const { files } = lintContentTaskLists(root);

        expect(files).toBe(3);
    });

    it("scans a file with no frontmatter whole", () => {
        const bare = path.join(root, "Bare.md");
        fs.writeFileSync(bare, "- [ ] loose\n");
        try {
            const { findings } = lintContentTaskLists(root);
            const found = findings.filter((f) => f.file === path.relative(process.cwd(), bare));
            expect(found).toHaveLength(1);
            expect(found[0].line).toBe(1);
        } finally {
            fs.rmSync(bare, { force: true });
        }
    });
});
