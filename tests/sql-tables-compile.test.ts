/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A `sql` content table, through a real compile.
 *
 * The unit tests drive the query and the renderer directly. This one asserts the
 * part only a compile can show: that the directive is answered before the walk
 * begins, spliced in at its own position, and that the wikilinks the table emits
 * are resolved by the same pass that resolves an authored one.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const gear = (name: string, code: string, cat: string, weight: number, value: number) => `---
name:
  full: ${name}
description: A ${name.toLowerCase()}.
id: ${code.padEnd(16, "x")}
shortcode: ${code}
type: miscgear
sohl:
  archetype: 0
  quality: 0
  durability: 2
  kbcat: ${cat}
  value: ${value}
  weight: ${weight}
---

Prose for ${name}.
`;

const RULES = `---
id: gearrulespage00
type: doc
subType: rules
name:
  full: Gear
shortcode: gearrules
---

Gear a character carries.

\`\`\`sql
SELECT address.slug AS _ref,
       sohl.kbcat   AS _section,
       name.full    AS "Name",
       sohl.weight  AS "Weight"
FROM notes
WHERE type = 'miscgear'
ORDER BY sohl.kbcat, name.full
\`\`\`

After the table.
`;

/** A throwaway repository with one SoHL item pack and a journals pack. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-sql-tree-"));
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
    lastModifiedBy: sqltestbuild000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - { name: items, label: Items, type: Item, system: sohl, default: true }
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

const roots: string[] = [];
let root: string;
let result: { errors: number; output: string };
let page: string;

beforeAll(() => {
    root = repo({
        "Misc_Gear/Bowl.md": gear("Bowl", "bowlcer", "cooking", 3, 6),
        "Misc_Gear/Cauldron.md": gear("Cauldron", "cauldron", "cooking", 8, 10),
        "Misc_Gear/Pence.md": gear("Pence", "pence", "cash", 1, 1),
        "Rules/Gear.md": RULES,
    });
    roots.push(root);
    result = compile(root);
    const journal = packDocs(root, "journals").Gear;
    page = (journal?.pages ?? []).map((p: any) => p?.text?.content ?? "").join("\n");
}, 120_000);

afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

describe("a `sql` content table, compiled", () => {
    it("compiles without error", () => {
        expect(result.output.replace(/ERRORS=\d+/, "")).not.toMatch(/error/i);
        expect(result.errors).toBe(0);
    });

    it("replaces the directive with a table", () => {
        expect(page).not.toContain("SELECT");
        expect(page).toContain("<table>");
        expect(page).toContain("Cauldron");
    });

    it("keeps the prose on either side of it", () => {
        expect(page).toContain("Gear a character carries.");
        expect(page).toContain("After the table.");
    });

    it("emits one heading per `_section`, in the query's order", () => {
        expect(page.indexOf("cash")).toBeLessThan(page.indexOf("cooking"));
    });

    it("resolves the links it emits, like an authored one", () => {
        // The table is expanded before wikilinks are converted, so a cell it
        // emits is resolved by the same pass — not shipped as raw `[[…]]`.
        expect(page).not.toContain("[[");
        expect(page).toMatch(/Compendium\.sohl\.items\.Item\./);
    });

    it("does not render the underscore-prefixed aliases as columns", () => {
        expect(page).not.toContain("_ref");
        expect(page).not.toContain("_section");
    });
});
