/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";
import { LEXICAL_SECTIONS } from "../engine/lexical-sections.mjs";
import YAML from "yaml";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");

function fixture(body = "", draft = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "empty-body-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: preflightbuild00 }
packs:
  - { name: journals, type: JournalEntry, default: true }
publish: {}
pdf: { books: [{ id: core, title: Demo, document: book.yaml }] }
`,
    );
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "assets/content/Empty.md"),
        `---
name: { full: Empty }
shortcode: empty
type: place
subType: settlement
description: A described note.
${draft ? "tags: [draft]\n" : ""}---
${body}`,
    );
    return root;
}

function run(root: string, args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("empty bodies fail author commands", () => {
    it.each([
        ["lint"],
        ["content-index"],
        ["content-index", ""],
        ["package", "compile"],
        ["site", "build"],
        ["pdf"],
    ])(
        "%s refuses an empty described note before publication",
        (...args) => {
            const root = fixture();
            try {
                const result = run(root, args);
                expect(result.status).not.toBe(0);
                expect(result.output).toMatch(/Empty\.md:\d+:\d+: error: this note has no body/);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "rejects a whitespace-only draft",
        () => {
            const root = fixture(" \n\t\n", true);
            try {
                const result = run(root, ["content-index"]);
                expect(result.status).not.toBe(0);
                expect(result.output).toContain("this note has no body");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "accepts a short written draft",
        () => {
            const root = fixture("A small beginning.\n", true);
            try {
                const result = run(root, ["content-index"]);
                expect(result.status).toBe(0);
                expect(result.output).not.toContain("this note has no body");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "validates the explicit content-index root",
        () => {
            const root = fixture("A written body.\n");
            try {
                const other = path.join(root, "other");
                fs.mkdirSync(other);
                fs.copyFileSync(
                    path.join(root, "assets/content/Empty.md"),
                    path.join(other, "Empty.md"),
                );
                fs.writeFileSync(
                    path.join(other, "Empty.md"),
                    fs
                        .readFileSync(path.join(other, "Empty.md"), "utf8")
                        .replace("A written body.\n", ""),
                );
                const result = run(root, ["content-index", other]);
                expect(result.status).not.toBe(0);
                expect(result.output).toContain("this note has no body");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});

describe("frontmatter lexical content passes author body preflight", () => {
    const kinds = LEXICAL_SECTIONS.flatMap((section) =>
        section.types.map((kind) => ({ ...kind, dataKey: section.dataKey, slug: section.slug })),
    );
    const word = { form: "zethu", class: "n", field: "Court", gloss: "a scribe" };
    function lexicalFixture(
        kind: (typeof kinds)[number],
        entries: "full" | "empty" | "absent",
        body = "",
    ) {
        const root = fixture();
        const content = path.join(root, "assets/content");
        fs.unlinkSync(path.join(content, "Empty.md"));
        fs.writeFileSync(
            path.join(content, "Tongue.md"),
            `---\n${YAML.stringify({
                type: "skill",
                subType: "language",
                shortcode: "tongue",
                name: { full: "Tongue" },
                data: { fields: [{ name: "Court", holds: "Court words." }], words: [word] },
            })}---\n\nA written provider.\n`,
        );
        const data = {
            ...(kind.dataKey === "words" ? {} : { language: "skill-tongue" }),
            ...(kind.dataKey === "words" ?
                { fields: [{ name: "Court", holds: "Court words." }] }
            :   {}),
            ...(entries === "absent" ?
                {}
            :   {
                    [kind.dataKey]:
                        entries === "empty" ? []
                        : kind.dataKey === "words" ? [word]
                        : [{ name: "zethu", common: true }],
                }),
        };
        fs.writeFileSync(
            path.join(content, "Candidate.md"),
            `---\n${YAML.stringify({
                type: kind.type,
                ...(kind.subType ? { subType: kind.subType } : {}),
                shortcode: "candidate",
                name: { full: "Candidate" },
                data,
            })}---\n\n${body}`,
        );
        return root;
    }

    it.each(kinds)(
        "publishes a data-only $type/$subType note with $dataKey",
        (kind) => {
            const root = lexicalFixture(kind, "full", " \n\t\n");
            try {
                const result = run(root, ["content-index"]);
                expect(result.status, result.output).toBe(0);
                expect(result.output).not.toContain("this note has no body");
                const file = path.join(root, "build/content-index/demo-metadata.jsonl");
                const rows = fs
                    .readFileSync(file, "utf8")
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line));
                const owner = rows.find(
                    (record) => record.shortcode === "candidate" && !record.documents,
                );
                expect(owner?.anchors?.some((anchor: any) => anchor.slug === kind.slug)).toBe(true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it.each(kinds.flatMap((kind) => ["empty", "absent"].map((entries) => ({ ...kind, entries }))))(
        "still refuses a data-only $type/$subType note with $entries $dataKey",
        (kind) => {
            const root = lexicalFixture(kind, kind.entries as "empty" | "absent");
            try {
                const result = run(root, ["content-index"]);
                expect(result.status, result.output).toBe(1);
                expect(result.output).toMatch(
                    /Candidate\.md:\d+:\d+: error: this note has no body/,
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "still refuses authored placeholder prose beside lexical data",
        () => {
            const root = lexicalFixture(kinds[0], "full", "TBD");
            try {
                const result = run(root, ["content-index"]);
                expect(result.status, result.output).toBe(1);
                expect(result.output).toContain('body says only "TBD"');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
