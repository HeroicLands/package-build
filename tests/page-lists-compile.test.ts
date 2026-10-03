/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A page list, through a real compile.
 *
 * The unit tests drive the directive and the renderer directly. This one
 * asserts the part only a compile can show: that the directive is answered
 * before the walk begins, spliced in at its own position, and that the
 * wikilinks the list emits are resolved by the same pass that resolves an
 * authored one — so a reader in Foundry opens a list of real journal links
 * rather than a paragraph of markup.
 *
 * The tree carries no `sql` directive at all, so it also covers the path that
 * answers a page list without opening a database.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const lore = (name: string, code: string, tags: string, summary: string) => `---
shortcode: ${code}
name: { full: ${name} }
type: lore
subType: custom
description: ${summary}
tags: [${tags}]
data:
  id: ${code.padEnd(16, "x")}
---

Prose for ${name}.
`;

const GUIDE = `---
shortcode: conceptsguide
name: { full: Key Concepts }
type: doc
subType: settingguide
data:
  id: conceptsguide00
---

The ideas the setting turns on.

\`\`\`pagelist {tag="key-concept" descriptions=true}
\`\`\`

Everything else follows from those.
`;

/** A throwaway repository with one journals pack. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-pagelist-tree-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: pagelisttest00000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - { name: journals, label: Journals, type: JournalEntry }
`,
    );
    for (const [file, text] of Object.entries(notes)) {
        const full = path.join(root, "assets", "content", file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    return root;
}

/** Compile a fixture repository, and report the error count and what it said. */
function compile(root: string): { errors: number; output: string } {
    const script = `
        const log = (await import(${JSON.stringify(pathToFileURL(path.join(PKG_ROOT, "node_modules/loglevel/lib/loglevel.js")).href)})).default;
        log.setLevel("error");
        const { generatePacksJson } = await import(${JSON.stringify(
            pathToFileURL(path.join(PKG_ROOT, "engine/generate.mjs")).href,
        )});
        process.exitCode = 0;
        console.log("ERRORS=" + (await generatePacksJson()));
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const matched = output.match(/ERRORS=(\d+)/);
    return { errors: matched ? Number(matched[1]) : Number.NaN, output };
}

/** Every compiled document in a pack's JSON directory, by name. */
function packDocs(root: string, pack: string): Record<string, any> {
    const dir = path.join(root, "build", "packs-json", pack);
    const out: Record<string, any> = {};
    if (!fs.existsSync(dir)) return out;
    for (const file of fs.readdirSync(dir)) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = doc;
    }
    return out;
}

const NOTES: Record<string, string> = {
    "Lore/Assize.md": lore("Assize", "assize", "key-concept", "A court held on circuit."),
    "Lore/Harbour_Due.md": lore(
        "Harbour Due",
        "harbourdue",
        "key-concept",
        "A toll on every hull that ties up.",
    ),
    "Lore/Reed_Cutting.md": lore("Reed Cutting", "reedcutting", "trade", "Winter work."),
    "Guides/Key_Concepts.md": GUIDE,
};

const roots: string[] = [];
let root: string;
let result: { errors: number; output: string };
let page: string;

beforeAll(() => {
    root = repo(NOTES);
    roots.push(root);
    result = compile(root);
    const journal = packDocs(root, "journals")["Key Concepts"];
    page = (journal?.pages ?? []).map((p: any) => p?.text?.content ?? "").join("\n");
}, 120_000);

afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

describe("a page list, compiled", () => {
    it("compiles without error", () => {
        expect(result.output.replace(/ERRORS=\d+/, "")).not.toMatch(/error/i);
        expect(result.errors).toBe(0);
    });

    it("replaces the directive with a list", () => {
        expect(page).not.toContain("pagelist");
        expect(page).toContain("<ul>");
        expect(page).toContain("Harbour Due");
        expect(page).toContain("Assize");
    });

    it("lists only the pages carrying the tag", () => {
        expect(page).not.toContain("Reed Cutting");
    });

    it("keeps the prose on either side of it", () => {
        expect(page).toContain("The ideas the setting turns on.");
        expect(page).toContain("Everything else follows from those.");
    });

    it("prints each page's description beside its link", () => {
        expect(page).toContain("A toll on every hull that ties up.");
    });

    it("resolves the links it emits, like an authored one", () => {
        expect(page).not.toContain("[[");
        expect(page).toMatch(/Compendium\.sohl\.journals\.JournalEntry\./);
    });

    it("orders the pages by name", () => {
        expect(page.indexOf("Assize")).toBeLessThan(page.indexOf("Harbour Due"));
    });
});

describe("a tag that selects nothing fails the compile", () => {
    let missing: { errors: number; output: string };

    beforeAll(() => {
        const tree = repo({
            ...NOTES,
            "Guides/Key_Concepts.md": GUIDE.replace("key-concept", "key-concpet"),
        });
        roots.push(tree);
        missing = compile(tree);
    }, 120_000);

    it("names the tag it could not find", () => {
        expect(missing.errors).toBeGreaterThan(0);
        expect(missing.output).toContain("key-concpet");
    });

    it("locates the directive by file and line", () => {
        expect(missing.output).toMatch(/Key_Concepts\.md:\d+/);
    });
});
