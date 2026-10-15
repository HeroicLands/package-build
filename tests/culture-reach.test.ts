/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **An affiliation reaches a culture.** In a tree that describes peoples — one
 * holding a culture note — an affiliation that reaches no culture, its own or
 * one it inherits, is a warning at the affiliation. An affiliation names a
 * trade, temple or order tongue in its own `data.language`. A language needs
 * no culture and no affiliation: one nothing names is no finding.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const language = (shortcode: string) =>
    `---\nshortcode: ${shortcode}\nname: {full: ${shortcode}}\ntype: skill\nsubType: language\n---\nA tongue.\n`;

const culture = (shortcode: string, data: string[]) =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: lore",
        "subType: culture",
        ...(data.length ? ["data:", ...data.map((line) => `  ${line}`)] : []),
        "---",
        "A people.",
        "",
    ].join("\n");

const affiliation = (shortcode: string, data: string[]) =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: affiliation",
        "subType: order",
        "data:",
        ...data.map((line) => `  ${line}`),
        "  governance:",
        "    ranks:",
        "      - {level: 0, title: Outcast, description: Cast out.}",
        "      - {level: 1, title: Member, description: A member.}",
        "---",
        "A body.",
        "",
    ].join("\n");

/** Lint a tree of the given files, returning every finding with its file relative to the root. */
function lint(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "culture-reach-"));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    const problems: any[] = [];
    const records = collectContentIndex(root, {
        contentPackage: "sohl",
        skipDirectories: [],
        problems,
    });
    const index = buildLinkIndex(root, { records, skipDirectories: [] });
    return [
        ...problems,
        ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings,
    ]
        .map((finding) => ({ ...finding, file: path.relative(root, finding.file) }))
        .filter((finding) => /language|culture/.test(finding.message));
}

/** The text at a finding's position. */
const at = (text: string, finding: { line?: number; column?: number }) =>
    text.split("\n")[finding.line! - 1].slice(finding.column! - 1);

const WORLD = {
    "Skills/Common.md": language("commonlng"),
    "Skills/Cant.md": language("cantlng"),
    "Lore/Folk.md": culture("folkclt", ["language: skill-commonlng"]),
    "Affiliations/Guild.md": affiliation("guild", [
        "culture: lore-folkclt",
        "language: skill-cantlng",
    ]),
    "Affiliations/Chapter.md": affiliation("chapter", ["parents: [affiliation-guild]"]),
};

describe("data.language on an affiliation", () => {
    it("is declared, as the shared language field", () => {
        const field = dataFields("affiliation").find(
            (f: { name: string }) => f.name === "language",
        );
        expect(field).toMatchObject({ kind: "address", ref: "skill" });
    });

    it("lints clean, and counts as naming its language", () => {
        expect(lint(WORLD)).toEqual([]);
    });

    it("names a language skill, as a culture's does", () => {
        const findings = lint({
            ...WORLD,
            "Skills/Smithing.md":
                "---\nshortcode: smithing\nname: {full: Smithing}\ntype: skill\nsubType: craft\n---\nA craft.\n",
            "Affiliations/Guild.md": affiliation("guild", [
                "culture: lore-folkclt",
                "language: skill-smithing",
            ]),
        });
        expect(findings).toContainEqual(
            expect.objectContaining({
                file: "Affiliations/Guild.md",
                severity: "error",
                message: expect.stringContaining("not a skill whose subType is language"),
            }),
        );
    });
});

describe("a language nothing names", () => {
    it("is no finding, spoken by no culture or kept by an affiliation alone", () => {
        expect(lint({ ...WORLD, "Skills/Lost.md": language("lostlng") })).toEqual([]);
    });
});

describe("an affiliation that reaches no culture", () => {
    it("is a warning at its type, and one inheriting a culture is not", () => {
        const text = affiliation("loners", []);
        const findings = lint({ ...WORLD, "Affiliations/Loners.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "Affiliations/Loners.md",
            severity: "warning",
            line: 4,
        });
        expect(findings[0].message).toMatch(/reaches no culture/);
        expect(at(text, findings[0]).startsWith("affiliation")).toBe(true);
    });

    it("is not a finding in a tree that describes no people", () => {
        expect(
            lint({
                "Skills/Common.md": language("commonlng"),
                "Affiliations/Loners.md": affiliation("loners", []),
            }),
        ).toEqual([]);
    });
});
