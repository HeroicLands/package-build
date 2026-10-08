/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A wikilink to an event's `id` is one finding, reported once**, at the
 * link's own position, by the site build.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineConfig } from "../index.mjs";
import { positionOfLiteral } from "../engine/diagnostics.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";

let root: string;
let result: any;
let lines: string[];
let audit: any;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-anchor-once-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
    const notes: Record<string, string> = {
        "Ironfells.md":
            "---\nshortcode: ironfells\nname: { full: Ironfells }\ntype: place\nsubType: settlement\n" +
            "data:\n    events:\n        - id: sack\n          when: 280\n          summary: Sacked.\n---\n\nA town.\n",
        "Chronicle.md":
            "---\nshortcode: chronicle\nname: { full: Chronicle }\ntype: lore\nsubType: history\n---\n\n" +
            "Recall [[place-ironfells#sack|the sack]] well.\n",
        "Bare.md":
            "---\nshortcode: bare\nname: { full: Bare }\ntype: lore\nsubType: history\n---\n\n" +
            "Link [[place-ironfells#sack]] here, and [[#here]] there.\n\n# Here {#here}\n\nText.\n",
        "homepage.md": "---\ntype: homepage\nshortcode: root\nname:\n  full: Demo\n---\n\nHome.\n",
    };
    for (const [rel, text] of Object.entries(notes)) {
        const file = path.join(root, "assets/content", rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    const config = defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [{ name: "journals", type: "JournalEntry", default: true }],
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
    try {
        result = buildSite({ config });
        audit = auditLinks(
            buildLinkIndex(path.join(root, "assets/content"), { skipDirectories: [], config }),
        );
    } finally {
        console.error = original;
    }
    lines = errors.filter((line) => line.includes("Chronicle.md"));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("a wikilink to one of this note's own events", () => {
    it("suggests writing the words without a link, not an empty link", () => {
        const message = linkFindingMessage({ target: "", reason: "event-anchor", anchor: "own" });
        expect(message).not.toContain("[[|");
        expect(message).toContain("[[#own]]");
        expect(message).toContain("this note");
    });
});

describe("a labelled wikilink to an event's id", () => {
    it("is reported once, at the link", () => {
        // The site command prints one finding per entry, located by searching
        // the note for the entry's link and occurrence.
        const located = (result.wikiErrors as any[])
            .filter((error) => String(error.file).endsWith("Chronicle.md"))
            .map((error) => ({
                ...positionOfLiteral(
                    fs.readFileSync(error.file, "utf8"),
                    error.link,
                    error.occurrence,
                ),
                reason: error.reason,
            }));
        expect(located).toEqual([{ line: 8, column: 8, reason: "event-anchor" }]);
        expect(lines).toEqual([]);
    });
});

describe("an unlabelled wikilink with an anchor", () => {
    it("is quoted as written, anchor included, by the link check and the site build alike", () => {
        const fromSite = (result.wikiErrors as any[])
            .filter((error) => String(error.file).endsWith("Bare.md"))
            .map((error) => error.message ?? linkFindingMessage(error));
        const fromLinks = (audit.unlabelledLinks as any[])
            .filter((finding) => String(finding.note.file).endsWith("Bare.md"))
            .map((finding) => finding.message ?? linkFindingMessage(finding));
        expect(fromSite).toHaveLength(2);
        expect(fromSite[0]).toContain("wikilink [[place-ironfells#sack]] carries no label");
        expect(fromSite[1]).toContain("wikilink [[#here]] carries no label");
        expect(fromLinks).toEqual(fromSite);
    });
});
