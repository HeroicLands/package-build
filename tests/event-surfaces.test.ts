/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **What a note says about events reaches every surface the same way.** One
 * fixture repository is built three times — the website, the Foundry packs and
 * the book's Typst source — and each output is read for the same text.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineConfig } from "../index.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The sentence the chronicle's references print, on every surface. */
const PRINTED = "The sack began in ~280 and is remembered as The Burning; it was a siege.";

const IRONFELLS = `---
type: place
subType: settlement
shortcode: ironfells
name:
    full: Ironfells
data:
    events:
        - id: raising
          when: 120
          kind: raising
          summary: Ironfells is raised.
        - id: sack
          when: "~280"
          until: 281
          kind: siege
          summary: Ironfells is sacked.
          names:
              - { name: The Burning, by: place-ironfells }
---

A town of the fells.
`;

const CHRONICLE = `---
type: lore
subType: history
shortcode: chronicle
name:
    full: The Chronicle
---

The sack began in {{ref "place-ironfells#sack" field="when"}} and is remembered as {{ref "place-ironfells#sack" field="name"}}; it was a {{ref "place-ironfells#sack" field="kind"}}.
`;

/** A repository the three builds share. */
function repo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "event-surfaces-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "demo",
            version: "1.0.0",
            homepage: "https://www.heroiclands.org/demo/",
        }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
    const notes: Record<string, string> = {
        "Places/Ironfells.md": IRONFELLS,
        "Lore/Chronicle.md": CHRONICLE,
        "homepage.md":
            "---\ntype: homepage\nshortcode: root\nname:\n  full: The Demo\n---\n\nHome.\n",
    };
    for (const [rel, text] of Object.entries(notes)) {
        const file = path.join(root, "assets/content", rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    fs.writeFileSync(
        path.join(root, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Lore",
            "    contents:",
            "      - filter: \"type = 'lore'\"",
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

/** Run a script under the repository, as a build would run. */
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

/** Every compiled journal's page text, by journal name. */
function journals(root: string): Record<string, string> {
    const dir = path.join(root, "build", "packs-json", "journals");
    const out: Record<string, string> = {};
    if (!fs.existsSync(dir)) return out;
    for (const file of fs.readdirSync(dir)) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = (doc.pages ?? []).map((p: any) => p?.text?.content ?? "").join("\n");
    }
    return out;
}

let root: string;
let site: Record<string, string>;
let foundry: { status: number | null; output: string; journals: Record<string, string> };
let book: { status: number | null; output: string; source: string };

beforeAll(() => {
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
    const built = buildSite({ config });
    expect(gatesFailed(built.gates), JSON.stringify(built.gates)).toBe(false);
    const content = path.join(root, "build/hugo/content");
    site = Object.fromEntries(
        fs
            .readdirSync(content)
            .filter((file) => file.endsWith(".md"))
            .map((file) => [file, fs.readFileSync(path.join(content, file), "utf8")]),
    );

    const packs = compilePacks(root);
    foundry = { ...packs, journals: journals(root) };

    const pdf = run(root, [path.join(PKG_ROOT, "bin", "package-build.mjs"), "pdf", "--no-compile"]);
    const dist = path.join(root, "build", "dist");
    const typ =
        fs.existsSync(dist) ? fs.readdirSync(dist).find((f) => f.endsWith(".typ")) : undefined;
    book = { ...pdf, source: typ ? fs.readFileSync(path.join(dist, typ), "utf8") : "" };
}, 120_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("an inline reference to an event's field, on every surface", () => {
    it("prints on the website", () => {
        expect(site["lore-chronicle.md"]).toContain(PRINTED);
    });

    it("prints in the Foundry journal", () => {
        expect(foundry.output).toMatch(/ERRORS=0/);
        expect(foundry.journals["The Chronicle"]).toContain(PRINTED);
    });

    it("prints in the book", () => {
        expect(book.status, book.output).toBe(0);
        const flat = book.source.replace(/\\(.)/g, "$1");
        expect(flat).toContain(PRINTED);
    });
});
