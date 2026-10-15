/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Every glossary entry resolves to a language, and the first match wins**:
 *
 * 1. the entry's own `language`;
 * 2. the note it is written on, when that note is a language — so a word is in
 *    the language whose note states it;
 * 3. on an affiliation, its own `data.language`, then its parents', then its
 *    culture's;
 * 4. on a culture, its own `data.language`.
 *
 * The resolved language is what the `glossary` relation stores. An entry that
 * resolves to none is an error located at the entry.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const language = (shortcode: string, data: string[] = []) =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: skill",
        "subType: language",
        ...(data.length ? ["data:", ...data.map((line) => `  ${line}`)] : []),
        "---",
        "A tongue.",
        "",
    ].join("\n");

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

/** Write a tree and return its root. */
function tree(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "glossary-language-"));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    return root;
}

/** Lint a tree, returning every finding with its file relative to the root. */
function lint(files: Record<string, string>) {
    const root = tree(files);
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
    ].map((finding) => ({ ...finding, file: path.relative(root, finding.file) }));
}

/** The text at a finding's position. */
const at = (text: string, finding: { line?: number; column?: number }) => {
    expect(finding.line, "a finding is located on its line").toBeTypeOf("number");
    expect(finding.column, "a finding is located on its column").toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
};

const WORLD: Record<string, string> = {
    "Skills/Common.md": language("commonlng", [
        "fields:",
        "  - {name: Home, holds: The home.}",
        "words:",
        "  - {form: hearth, class: n, field: Home, gloss: the fire at home}",
    ]),
    "Skills/Cant.md": language("cantlng"),
    "Skills/Chant.md": language("chantlng"),
    "Lore/Folk.md": culture("folkclt", [
        "language: skill-commonlng",
        "glossary:",
        "  - {name: hearth-oath, definition: an oath sworn at the fire, common: true}",
        "  - {name: kanta, definition: a temple chant, language: skill-chantlng}",
    ]),
    "Affiliations/Guild.md": affiliation("guild", [
        "culture: lore-folkclt",
        "language: skill-cantlng",
        "glossary:",
        "  - {name: tally, definition: a reckoning stick}",
        "  - {name: chantword, definition: a word of the chant, language: skill-chantlng}",
    ]),
    "Affiliations/Chapter.md": affiliation("chapter", [
        "parents: [affiliation-guild]",
        "glossary:",
        "  - {name: lodge-word, definition: a password}",
    ]),
    "Affiliations/Temple.md": affiliation("temple", [
        "culture: lore-folkclt",
        "glossary:",
        "  - {name: vigil, definition: a night's watch}",
    ]),
};

describe("a glossary entry's language, linted", () => {
    it("resolves at every step in a world that states its languages", () => {
        expect(lint(WORLD).filter((finding) => finding.severity === "error")).toEqual([]);
    });

    it("is an error, at the entry, where a culture states no language", () => {
        const text = culture("mutetclt", [
            "glossary:",
            "  - {name: hearth-oath, definition: an oath}",
            "  - {name: hush, definition: silence}",
        ]);
        const findings = lint({ ...WORLD, "Lore/Mute.md": text }).filter(
            (finding) => finding.file === "Lore/Mute.md",
        );
        expect(findings).toHaveLength(2);
        for (const finding of findings) {
            expect(finding.severity).toBe("error");
            expect(finding.message).toMatch(/resolves to no language/);
        }
        expect(findings.map((finding) => finding.line)).toEqual([8, 9]);
        expect(at(text, findings[0]).startsWith("{name: hearth-oath")).toBe(true);
        expect(at(text, findings[1]).startsWith("{name: hush")).toBe(true);
    });

    it("is an error where an affiliation reaches no language at all", () => {
        const text = affiliation("loners", [
            "glossary:",
            "  - {name: drift, definition: a wandering}",
        ]);
        const findings = lint({ ...WORLD, "Affiliations/Loners.md": text }).filter(
            (finding) => finding.file === "Affiliations/Loners.md" && finding.severity === "error",
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`drift` resolves to no language/);
        expect(at(text, findings[0]).startsWith("{name: drift")).toBe(true);
    });

    it("is satisfied by the entry's own language where nothing else states one", () => {
        const text = culture("mutetclt", [
            "glossary:",
            "  - {name: hush, definition: silence, language: skill-cantlng}",
        ]);
        expect(
            lint({ ...WORLD, "Lore/Mute.md": text }).filter(
                (finding) => finding.file === "Lore/Mute.md",
            ),
        ).toEqual([]);
    });

    it("refuses an entry's language that is not a language skill, at the value", () => {
        const text = culture("mutetclt", [
            "language: skill-commonlng",
            "glossary:",
            "  - {name: hush, definition: silence, language: lore-folkclt}",
        ]);
        const findings = lint({ ...WORLD, "Lore/Mute.md": text }).filter(
            (finding) => finding.file === "Lore/Mute.md",
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/not a skill whose subType is language/);
        expect(at(text, findings[0]).startsWith("lore-folkclt")).toBe(true);
    });
});

describe("a glossary entry's language, stored", () => {
    let db: any;
    let rows: Map<string, { note: string; language: string | null }>;

    beforeAll(async () => {
        const root = tree(WORLD);
        const records = collectContentIndex(root, { contentPackage: "sohl", skipDirectories: [] });
        db = await openNotesDatabase(records, {
            dir: path.join(root, "..", `${path.basename(root)}-db`),
        });
        roots.push(path.join(root, "..", `${path.basename(root)}-db`));
        const result = await runSqlQuery(db, "SELECT note, name, language FROM glossary");
        rows = new Map(result.rows.map((row: any) => [row.name, row]));
    }, 60_000);

    afterAll(async () => {
        await db?.close();
    });

    it("1. takes the entry's own language first, on a culture and on an affiliation", () => {
        expect(rows.get("kanta")).toEqual({
            note: "sohl-note-lore-folkclt",
            name: "kanta",
            language: "sohl-note-skill-chantlng",
        });
        expect(rows.get("chantword")?.language).toBe("sohl-note-skill-chantlng");
    });

    it("2. puts a word in the language whose note states it", async () => {
        const result = await runSqlQuery(db, "SELECT form, language FROM words");
        expect(result.rows).toEqual([{ form: "hearth", language: "sohl-note-skill-commonlng" }]);
    });

    it("3. takes an affiliation's own language", () => {
        expect(rows.get("tally")).toEqual({
            note: "sohl-note-affiliation-guild",
            name: "tally",
            language: "sohl-note-skill-cantlng",
        });
    });

    it("3. then its parent affiliation's, before its culture's", () => {
        expect(rows.get("lodge-word")).toEqual({
            note: "sohl-note-affiliation-chapter",
            name: "lodge-word",
            language: "sohl-note-skill-cantlng",
        });
    });

    it("3. then its culture's", () => {
        expect(rows.get("vigil")).toEqual({
            note: "sohl-note-affiliation-temple",
            name: "vigil",
            language: "sohl-note-skill-commonlng",
        });
    });

    it("4. takes a culture's own language", () => {
        expect(rows.get("hearth-oath")).toEqual({
            note: "sohl-note-lore-folkclt",
            name: "hearth-oath",
            language: "sohl-note-skill-commonlng",
        });
    });
});
