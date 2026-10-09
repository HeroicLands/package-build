/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A note's generated sections reach every surface from one Markdown text.**
 * One fixture repository is built three times — the website, the Foundry packs
 * and the book — and each output is read for the same sections: **Within**,
 * **Governed by**, **Governed places**, **In song and story** and **From here**.
 *
 * The book is built from a selection of the notes, so its generated sections
 * name notes it leaves out. A generated link whose target is in the book is an
 * internal link followed by the page the target starts on; one whose target is
 * not is its words alone, with no warning. An authored link keeps the book's
 * ordinary rules: an internal link with no page number, a link to the website
 * for a page the book leaves out, and a warning where a label it names is
 * missing.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import matter from "gray-matter";

import { defineConfig } from "../index.mjs";
import { resolveDanglingLabels } from "../engine/pdf-render.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HAS_TYPST = spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0;
const HAS_PDFTOTEXT = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

const NOTES: Record<string, string> = {
    "Places/Vale.md": `---
type: place
subType: region
shortcode: vale
name:
    full: Vale
---

The vale runs south to the sea, past [[place-ford|the crossing]] to [[place-mere|the quay at Mere]].
`,
    "Places/Ford.md": `---
type: place
subType: settlement
shortcode: ford
name:
    full: Ford
data:
    parents: [place-vale]
    government: affiliation-crown
    borders:
        - { to: mere, bearing: E }
    events:
        - id: bridging
          when: 40
          summary: The ford is bridged.
          where: { locus: [ford] }
---

A town at the crossing.
`,
    "Places/Mere.md": `---
type: place
subType: settlement
shortcode: mere
name:
    full: Mere
data:
    parents: [place-vale]
    government: affiliation-crown
    borders:
        - { to: ford, bearing: W }
---

A town by the water.
`,
    // Writes its own Within, which every surface keeps as written.
    "Places/Moor.md": `---
type: place
subType: region
shortcode: moor
name:
    full: Moor
---

The moor.

# Within {#within}

Only the Tor, which the author lists by hand.
`,
    "Places/Tor.md": `---
type: place
subType: feature
shortcode: tor
name:
    full: Tor
data:
    parents: [place-moor]
---

A hill.
`,
    "Affiliations/Crown.md": `---
type: affiliation
subType: polity
shortcode: crown
name:
    full: The Crown
---

The crown of the vale.
`,
    "Lore/Lay.md": `---
type: lore
subType: literature
shortcode: lay
name:
    full: Lay of the Ford
data:
    form: epic
    subjects: [place-ford]
---

A lay.
`,
    "Lore/Feud.md": `---
type: lore
subType: history
shortcode: feud
name:
    full: The Feud
data:
    events:
        - id: feud
          when: 50
          summary: The crown's feud begins.
          who: [{ ref: affiliation-crown, role: party }]
---

A feud.
`,
    "homepage.md": "---\ntype: homepage\nshortcode: root\nname:\n  full: The Demo\n---\n\nHome.\n",
};

/** A repository the three builds share. */
function repo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "generated-surfaces-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "demo",
            version: "1.0.0",
            homepage: "https://www.heroiclands.org/demo/",
        }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
    for (const [rel, text] of Object.entries(NOTES)) {
        const file = path.join(root, "assets/content", rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    // The book is a selection: the lore and Mere are left out of it.
    fs.writeFileSync(
        path.join(root, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Places",
            "    contents:",
            "      - filter: \"type = 'place' AND shortcode <> 'mere'\"",
            "  - sectionName: Powers",
            "    contents:",
            "      - filter: \"type = 'affiliation'\"",
        ].join("\n") + "\n",
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
            "systems:",
            "    sohl:",
            '        compatibility: { verified: "0.9.0" }',
            "itemBuilders: [sohl]",
            "packs:",
            "    - { name: items, label: Items, type: Item, system: sohl, mayBeEmpty: true }",
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

/** Run a script under the repository, as a build would run. */
function run(root: string, args: string[]) {
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The Foundry packs, generated. */
function generatePacks(root: string) {
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

/** Every compiled journal's pages, by journal name. */
function journals(root: string): Record<string, Array<{ name: string; text: string }>> {
    const dir = path.join(root, "build", "packs-json", "journals");
    const out: Record<string, Array<{ name: string; text: string }>> = {};
    if (!fs.existsSync(dir)) return out;
    for (const file of fs.readdirSync(dir)) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = (doc.pages ?? []).map((p: any) => ({
            name: String(p?.name ?? ""),
            text: String(p?.text?.content ?? ""),
        }));
    }
    return out;
}

/** One generated section of a website page, heading to the next heading. */
function webSection(page: string, slug: string): string {
    const body = matter(page).content;
    const start = body.indexOf(`{#${slug}}`);
    if (start < 0) return "";
    const from = body.lastIndexOf("\n# ", start) + 1;
    const next = body.indexOf("\n# ", start);
    return body.slice(from, next < 0 ? undefined : next).trim();
}

/** The book's Typst source for one entry, from its heading to the next entry's. */
function bookEntry(source: string, name: string): string {
    const start = source.search(new RegExp(`outlined: false, bookmarked: true\\)\\[${name}\\]`));
    if (start < 0) return "";
    const next = source.indexOf("bookmarked: true)[", start + 40);
    return source.slice(start, next < 0 ? undefined : next);
}

let root: string;
let site: Record<string, string>;
let foundry: { status: number | null; output: string; journals: ReturnType<typeof journals> };
let book: { status: number | null; output: string; source: string; pdf: string };

beforeAll(async () => {
    root = repo();

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

    const packs = generatePacks(root);
    foundry = { ...packs, journals: journals(root) };

    const pdf = run(root, [
        path.join(PKG_ROOT, "bin", "package-build.mjs"),
        "pdf",
        ...(HAS_TYPST ? [] : ["--no-compile"]),
    ]);
    const dist = path.join(root, "build", "dist");
    const files = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
    const typ = files.find((f) => f.endsWith(".typ"));
    const out = files.find((f) => f.endsWith(".pdf"));
    book = {
        ...pdf,
        source: typ ? fs.readFileSync(path.join(dist, typ), "utf8") : "",
        pdf: out ? path.join(dist, out) : "",
    };
}, 240_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("on the website", () => {
    it("sets each section after the author's text", () => {
        expect(webSection(site["place-vale.md"], "within")).toContain("[Ford](/demo/place-ford/)");
        expect(webSection(site["place-ford.md"], "governedby")).toContain("The Crown");
        expect(webSection(site["affiliation-crown.md"], "governedplaces")).toContain("Mere");
        expect(webSection(site["place-ford.md"], "insongandstory")).toContain("Lay of the Ford");
        expect(webSection(site["place-ford.md"], "fromhere")).toContain("<svg");
    });

    it("keeps an author's own section byte for byte, and adds none", () => {
        const body = matter(site["place-moor.md"]).content;
        expect(body.match(/\{#within\}/g)).toHaveLength(1);
        expect(body).toContain("Only the Tor, which the author lists by hand.");
        expect(body).not.toContain("place-tor");
    });
});

describe("in Foundry", () => {
    it("generates every pack without an error", () => {
        expect(foundry.output).toMatch(/ERRORS=0/);
    });

    it("starts a journal page at each section", () => {
        expect(foundry.journals.Vale.map((p) => p.name)).toContain("Within");
        expect(foundry.journals.Ford.map((p) => p.name)).toEqual(
            expect.arrayContaining(["Governed by", "In song and story", "From here"]),
        );
        expect(foundry.journals["The Crown"].map((p) => p.name)).toContain("Governed places");
    });

    it("links each entry to its journal, from the same Markdown the website sets", () => {
        const within = foundry.journals.Vale.find((p) => p.name === "Within")!.text;
        expect(within).toMatch(/@UUID\[[^\]]+\]\{Ford\}/);
        expect(within).toMatch(/@UUID\[[^\]]+\]\{Mere\}/);
    });

    it("keeps an author's own section, and adds none", () => {
        const pages = foundry.journals.Moor.filter((p) => p.name === "Within");
        expect(pages).toHaveLength(1);
        expect(pages[0].text).toContain("which the author lists by hand");
    });

    it("serves the drawing as an asset staged into the module", () => {
        const page = foundry.journals.Ford.find((p) => p.name === "From here")!.text;
        expect(page).toContain('src="modules/demo/assets/generated/from-ford.svg"');
        const staged = path.join(root, "build/stage/assets/generated/from-ford.svg");
        expect(fs.existsSync(staged), staged).toBe(true);
        expect(fs.readFileSync(staged, "utf8")).toContain("<svg");
    });
});

describe("in the book", () => {
    it("builds", () => {
        expect(book.status, book.output).toBe(0);
    });

    it("links a generated entry whose target is in the book, with its page", () => {
        const within = bookEntry(book.source, "Vale");
        expect(within).toMatch(/#link\(<[^>]*place-ford[^>]*>\)\[Ford\]~\(p\.~#context/);
    });

    it("sets a generated entry whose target is not in the book as its words alone", () => {
        const vale = bookEntry(book.source, "Vale");
        expect(vale).toContain("Mere");
        expect(vale).not.toMatch(/#link\([^)]*\)\[Mere\]/);
        const ford = bookEntry(book.source, "Ford");
        expect(ford).toContain("Lay of the Ford");
        expect(ford).not.toMatch(/#link\([^)]*\)\[Lay of the Ford\]/);
        const crown = bookEntry(book.source, "The Crown");
        expect(crown).toContain("feud begins");
        expect(crown).not.toMatch(/#link\([^)]*\)\[[^\]]*feud begins/);
    });

    it("reports nothing about a generated section's links", () => {
        const warnings = book.output.split("\n").filter((line) => /: warning: /.test(line));
        expect(warnings, book.output).toEqual([]);
    });

    it("still warns on an authored link whose label the book does not declare", () => {
        const findings: Array<{ message: string }> = [];
        resolveDanglingLabels("#link(<nowhere>)[the old crossing]", findings);
        expect(findings.map((f) => f.message)).toEqual([
            expect.stringContaining("found no such destination in the book"),
        ]);
    });

    it("keeps an authored link as it is: internal with no page, or to the website", () => {
        const vale = bookEntry(book.source, "Vale");
        const authored = vale.slice(0, vale.indexOf("Within"));
        expect(authored).toMatch(/#link\(<[^>]*place-ford[^>]*>\)\[the crossing\]/);
        expect(authored).toContain(
            '#link("https://www.heroiclands.org/demo/place-mere/")[the quay at Mere]',
        );
        expect(authored).not.toContain("counter(page)");
    });

    it("sets the map from a place once, inside its From here section", () => {
        const ford = bookEntry(book.source, "Ford");
        expect(ford.match(/from-ford\.svg/g)).toHaveLength(1);
        expect(book.source.match(/from-ford\.svg/g)).toHaveLength(1);
        expect(ford.indexOf("From here")).toBeLessThan(ford.indexOf("from-ford.svg"));
        expect(fs.existsSync(path.join(root, "build/dist/maps/from-ford.svg"))).toBe(true);
    });

    it.runIf(HAS_TYPST && HAS_PDFTOTEXT)(
        "prints the page a generated link's target starts on",
        () => {
            const text = spawnSync("pdftotext", ["-layout", book.pdf, "-"], {
                encoding: "utf8",
            }).stdout;
            const pages = text.split("\f");
            const cited = /Ford \(p\. (\d+)\)/.exec(text);
            expect(cited, text).toBeTruthy();
            const page = Number(cited![1]);
            // The page the number names opens the Ford entry.
            expect(pages[page - 1]).toMatch(/^\s*(?:\S.*\n)?\s*Ford\b/m);
            expect(pages[page - 1]).toContain("A town at the crossing.");
            // An authored link to the same place carries no number.
            expect(text).not.toMatch(/the crossing \(p\./);
        },
    );
});
