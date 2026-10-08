/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A `.secret` heading withholds its section in a note with frontmatter**, on
 * every surface. A note's body starts below its frontmatter, so every position
 * the check compares is a file line; the fixture notes carry real frontmatter
 * so the body never starts on line 1. The guides' own examples are read out of
 * the guides and built as written.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import matter from "gray-matter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineConfig } from "../index.mjs";
import { withheldSections } from "../engine/heading-attributes.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The first `markdown` fence after `heading` in a guide, as an author copies it. */
function example(guide: string, heading: string): string {
    const text = fs.readFileSync(path.join(PKG_ROOT, guide), "utf8");
    const from = text.indexOf(heading);
    expect(from, `${guide}: ${heading}`).toBeGreaterThan(-1);
    const open = text.indexOf("```markdown\n", from) + "```markdown\n".length;
    return text.slice(open, text.indexOf("\n```", open));
}

const GUIDE = example("docs/authoring/links-and-markup.md", "### A section players must not read");
const REFERENCE = example(
    "docs/reference/format-details.md",
    "#### A section withheld from players",
);

const POEM = ["```poetry {form=epic lang=en}", "Hear now, hearth keepers.", "```"].join("\n");

/** The note #1079 reports, with a captioned item inside the withheld section. */
const INN = `---
shortcode: inn
name: { full: The Inn }
type: place
subType: structure
---

# The Harbor {#harbor}

The harbor faces west.

# The Cellar {#cellar .secret}

The contraband is behind the false wall.

: The Tally {#tally}

${POEM}

The cellarer counts twice.
`;

/** A note whose body is one guide example, under real frontmatter. */
const lore = (shortcode: string, name: string, body: string) =>
    `---\nshortcode: ${shortcode}\nname: { full: ${name} }\ntype: lore\nsubType: history\n---\n\n# The Bar {#bar}\n\nAle.\n\n${body}\n`;

/** A repository holding `notes`, for the three builds. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "withheld-notes-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "demo",
            version: "1.0.0",
            homepage: "https://www.heroiclands.org/demo/",
        }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
    for (const [rel, text] of Object.entries({
        ...notes,
        "homepage.md":
            "---\ntype: homepage\nshortcode: root\nname:\n  full: The Demo\n---\n\nHome.\n",
    })) {
        const file = path.join(root, "assets/content", rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    fs.writeFileSync(
        path.join(root, "book.yaml"),
        "contents:\n  - sectionName: All\n    contents:\n      - filter: \"type = 'place' OR type = 'lore'\"\n",
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        [
            "contentPackage: demo",
            "packageKind: modules",
            "compatibility:",
            '    minimum: "14.359"',
            '    verified: "14.359"',
            "stats:",
            "    lastModifiedBy: demobuilder0000",
            "packs:",
            "    - { name: journals, label: Journals, type: JournalEntry, default: true }",
            "pdf:",
            "    title: The Test Volume",
            "    document: book.yaml",
            "    fonts:",
            "        serif: Libertinus Serif",
        ].join("\n") + "\n",
    );
    return root;
}

/** Run a script in the repository, as a build runs. */
function run(root: string, args: string[]) {
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The Foundry packs, compiled. */
function compilePacks(root: string) {
    const script = `
        const log = (await import(${JSON.stringify(pathToFileURL(path.join(PKG_ROOT, "node_modules/loglevel/lib/loglevel.js")).href)})).default;
        log.setLevel("error");
        const { generatePacksJson } = await import(${JSON.stringify(
            pathToFileURL(path.join(PKG_ROOT, "engine/generate.mjs")).href,
        )});
        process.exitCode = 0;
        console.log("ERRORS=" + (await generatePacksJson()));
    `;
    return run(root, ["--input-type=module", "-e", script]);
}

/** Every compiled journal, by name. */
function journals(root: string): Record<string, any> {
    const dir = path.join(root, "build", "packs-json", "journals");
    const out: Record<string, any> = {};
    if (!fs.existsSync(dir)) return out;
    for (const file of fs.readdirSync(dir)) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = doc;
    }
    return out;
}

describe("the check, given a body below frontmatter", () => {
    const body = "Intro.\n\n# The Cellar {#cellar .secret}\n\nText.\n";

    it("finds a page-opening heading whatever line the body starts on", () => {
        for (const bodyLine of [1, 8, 30])
            expect(withheldSections(body, bodyLine).errors, String(bodyLine)).toEqual([]);
    });

    it("reports a heading that opens no page at its own file line and column", () => {
        const misplaced = "# A Room {#room}\n\n## A corner {.secret}\n\nNothing here.\n";
        expect(withheldSections(misplaced, 8).errors).toEqual([
            expect.objectContaining({ line: 10, column: 13 }),
        ]);
    });
});

describe("a withheld section in a real note, on every surface", () => {
    let root: string;
    let site: Record<string, string>;
    let foundry: { status: number | null; output: string; journals: Record<string, any> };
    let book: { status: number | null; output: string; source: string };

    beforeAll(async () => {
        root = repo({
            "Places/Inn.md": INN,
            "Lore/Guide.md": lore("guide", "The Guide Inn", GUIDE),
            "Lore/Reference.md": lore("reference", "The Reference Inn", REFERENCE),
        });
        const config = defineConfig({
            rootDir: root,
            contentPackage: "demo",
            foundryPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14.359" },
            stats: { lastModifiedBy: "demobuilder0000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
        });
        const built = buildSite({
            config,
            sqlTables: await prepareTreeSqlTables(config.paths.content, {
                skipDirectories: config.skipDirectories,
                config,
                audience: "public",
            }),
        });
        expect(gatesFailed(built.gates), JSON.stringify(built.gates)).toBe(false);
        const content = path.join(root, "build/hugo/content");
        site = Object.fromEntries(
            fs
                .readdirSync(content)
                .filter((file) => file.endsWith(".md"))
                .map((file) => [file, fs.readFileSync(path.join(content, file), "utf8")]),
        );
        foundry = { ...compilePacks(root), journals: journals(root) };
        const pdf = run(root, [
            path.join(PKG_ROOT, "bin", "package-build.mjs"),
            "pdf",
            "--no-compile",
        ]);
        const dist = path.join(root, "build", "dist");
        const typ =
            fs.existsSync(dist) ? fs.readdirSync(dist).find((f) => f.endsWith(".typ")) : undefined;
        book = { ...pdf, source: typ ? fs.readFileSync(path.join(dist, typ), "utf8") : "" };
    }, 120_000);

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("gives the GM alone the section's page, the captioned item and what follows it, in Foundry", () => {
        expect(foundry.output).toMatch(/ERRORS=0/);
        // The infobox page the compile appends is not authored prose, and is
        // not part of any section.
        const pages = foundry.journals["The Inn"].pages.filter(
            (page: any) => page.name !== "Properties Infobox",
        );
        expect(pages.map((page: any) => page.name)).toEqual([
            "The Harbor",
            "The Cellar",
            "The Tally",
            "The Cellar",
        ]);
        expect(pages[0].ownership?.default).not.toBe(0);
        for (const page of pages.slice(1))
            expect(page.ownership, page.name).toEqual({ default: 0 });
    });

    it("withholds each guide's example as written, in Foundry", () => {
        for (const name of ["The Guide Inn", "The Reference Inn"]) {
            const cellar = foundry.journals[name].pages.find((p: any) => p.name === "The Cellar");
            expect(cellar?.ownership, name).toEqual({ default: 0 });
        }
    });

    it("wraps the heading and its section in the spoiler, on the website", () => {
        for (const file of ["place-inn.md", "lore-guide.md", "lore-reference.md"]) {
            const content = matter(site[file]).content;
            const open = content.indexOf('<details class="secret">');
            expect(open, file).toBeGreaterThan(-1);
            const inside = content.slice(open, content.indexOf("</details>", open));
            expect(inside, file).toContain("The Cellar");
            expect(inside, file).toContain("The contraband is behind the false wall.");
        }
        expect(
            matter(site["place-inn.md"]).content.slice(
                0,
                matter(site["place-inn.md"]).content.indexOf("<details"),
            ),
        ).toContain("The harbor faces west.");
    });

    it("sets the heading and its section in the GM box, in the book", () => {
        expect(book.status, book.output).toBe(0);
        const boxes = book.source.split('rgb("#f2eefb")').length - 1;
        expect(boxes).toBeGreaterThanOrEqual(3);
        expect(book.source).toContain("[! Secret]");
    });
});

describe("a .secret heading that opens no page, in a real note", () => {
    it("is a finding at the heading's own file line and column", () => {
        const root = repo({
            "Places/Room.md":
                "---\nshortcode: room\nname: { full: The Room }\ntype: place\nsubType: structure\n---\n\n# A Room {#room}\n\n## A corner {.secret}\n\nNothing here.\n",
        });
        try {
            const result = compilePacks(root);
            expect(result.output).toMatch(
                /Places\/Room\.md:10:13: error: \.secret withholds the page a heading opens, and this heading opens none/,
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 60_000);
});
