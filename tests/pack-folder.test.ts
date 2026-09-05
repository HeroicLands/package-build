/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `packFolder:` — naming a compendium folder by its path (#251).
 *
 * `folder:` is unchanged throughout: a note that names an id is read, resolved
 * and emitted exactly as before, and nothing warns about it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

import { describe, it, expect, afterAll } from "vitest";

import { buildFolderResolver, folderField } from "../engine/helpers.mjs";
import { UNIVERSAL_KEYS } from "../engine/frontmatter-lint.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Three folders, two levels deep, as `item-folders.yaml` declares them. */
const FOLDERS = [
    { name: "Possessions", id: "aaaaaaaaaaaaaaaa", parentFolderId: "" },
    { name: "Consumables", id: "bbbbbbbbbbbbbbbb", parentFolderId: "aaaaaaaaaaaaaaaa" },
    { name: "Poisons and Toxins", id: "cccccccccccccccc", parentFolderId: "bbbbbbbbbbbbbbbb" },
    { name: "Cooking", id: "dddddddddddddddd", parentFolderId: "aaaaaaaaaaaaaaaa" },
];

describe("reading the field", () => {
    it("prefers `packFolder`, and says it is a path", () => {
        expect(folderField({ packFolder: "Possessions/Cooking" })).toEqual({
            value: "Possessions/Cooking",
            isPath: true,
        });
    });

    it("falls back to `folder`, and says it is not", () => {
        expect(folderField({ folder: "dddddddddddddddd" })).toEqual({
            value: "dddddddddddddddd",
            isPath: false,
        });
    });

    it("lets `packFolder` win where a note carries both", () => {
        const read = folderField({ packFolder: "Possessions/Cooking", folder: "aaaaaaaaaaaaaaaa" });

        expect(read).toEqual({ value: "Possessions/Cooking", isPath: true });
    });

    it("reads either from the `sohl:` block, as every other field is read", () => {
        expect(folderField({ sohl: { packFolder: "Possessions" } }).value).toBe("Possessions");
        expect(folderField({ sohl: { folder: "aaaaaaaaaaaaaaaa" } }).isPath).toBe(false);
    });

    it("treats a blank `packFolder` as absent rather than as a path", () => {
        // A key cleared in an editor means the note names no folder there, and
        // falling through is what an author part-way through a rename means.
        expect(folderField({ packFolder: "", folder: "aaaaaaaaaaaaaaaa" })).toEqual({
            value: "aaaaaaaaaaaaaaaa",
            isPath: false,
        });
    });

    it("reports nothing for a note that names no folder", () => {
        expect(folderField({})).toEqual({ value: null, isPath: false });
    });

    it("is a key every note type may write", () => {
        expect(UNIVERSAL_KEYS.has("packFolder")).toBe(true);
        // The id spelling is untouched.
        expect(UNIVERSAL_KEYS.has("folder")).toBe(true);
    });
});

describe("resolving a path", () => {
    const { resolver, byPath } = buildFolderResolver(FOLDERS);

    it("indexes every folder by its full path", () => {
        expect([...byPath.keys()].sort()).toEqual([
            "Possessions",
            "Possessions/Consumables",
            "Possessions/Consumables/Poisons and Toxins",
            "Possessions/Cooking",
        ]);
    });

    it("resolves a nested path to its id", () => {
        expect(resolver("Possessions/Consumables/Poisons and Toxins", { isPath: true })).toBe(
            "cccccccccccccccc",
        );
    });

    it("resolves a top-level path, which is a bare name", () => {
        expect(resolver("Possessions", { isPath: true })).toBe("aaaaaaaaaaaaaaaa");
    });

    it("names what it does declare when a path is unknown", () => {
        expect(() => resolver("Possessions/Nowhere", { isPath: true })).toThrow(
            /Unknown folder path "Possessions\/Nowhere".*Possessions\/Cooking/s,
        );
    });

    it("does not read a path as an id, or an id as a path", () => {
        // Which it is comes from the field it was written in, never from the
        // string: a top-level path is a bare name, and a name is as
        // alphanumeric as an id.
        expect(() => resolver("Possessions", {})).toThrow(/Unknown folder id/);
        expect(() => resolver("aaaaaaaaaaaaaaaa", { isPath: true })).toThrow(/Unknown folder path/);
    });

    it("still resolves an id exactly as before", () => {
        expect(resolver("cccccccccccccccc")).toBe("cccccccccccccccc");
        expect(resolver(null)).toBeNull();
        expect(resolver("")).toBeNull();
        expect(resolver("   ")).toBeNull();
    });
});

describe("what a path costs the folder file", () => {
    it("refuses a folder name carrying the separator", () => {
        // One name with a `/` would make one path mean two things. No folder in
        // any tree has one; this keeps it that way.
        expect(() =>
            buildFolderResolver([
                { name: "Arms/Armour", id: "aaaaaaaaaaaaaaaa", parentFolderId: "" },
            ]),
        ).toThrow(/contains "\/"/);
    });

    it("refuses a parent cycle rather than spinning on it", () => {
        expect(() =>
            buildFolderResolver([
                { name: "A", id: "aaaaaaaaaaaaaaaa", parentFolderId: "bbbbbbbbbbbbbbbb" },
                { name: "B", id: "bbbbbbbbbbbbbbbb", parentFolderId: "aaaaaaaaaaaaaaaa" },
            ]),
        ).toThrow(/cycle/);
    });

    it("keeps every invariant the id spelling already had", () => {
        expect(() => buildFolderResolver([{ name: "A", parentFolderId: "" }])).toThrow(
            /missing id/,
        );
        expect(() => buildFolderResolver([{ id: "aaaaaaaaaaaaaaaa" }])).toThrow(/missing name/);
        expect(() =>
            buildFolderResolver([
                { name: "A", id: "aaaaaaaaaaaaaaaa", parentFolderId: "" },
                { name: "A", id: "bbbbbbbbbbbbbbbb", parentFolderId: "" },
            ]),
        ).toThrow(/share name/);
    });
});

/* ---------------------------------------------------------------------- */
/*  Through a real compile                                                 */
/* ---------------------------------------------------------------------- */

const gear = (name: string, code: string, folderKey: string, folderValue: string) => `---
name:
  full: ${name}
description: A ${name.toLowerCase()}.
id: ${code.padEnd(16, "x")}
shortcode: ${code}
type: miscgear
${folderKey}: ${folderValue}
sohl:
  archetype: 0
  quality: 0
  durability: 2
  kbcat: cooking
  value: 6
  weight: 3
---

Prose for ${name}.
`;

/**
 * A throwaway repository with a folder file and one item pack.
 *
 * `mirrorJournals` writes the same folders for the journals pack, which is what
 * a real tree must do for an item's documentation to be filed beside it.
 */
function folderRepo(notes: Record<string, string>, { mirrorJournals = true } = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-folder-tree-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    const folderYaml = FOLDERS.map(
        (f) => `- name: ${f.name}\n  id: ${f.id}\n  parentFolderId: "${f.parentFolderId}"\n`,
    ).join("");
    fs.writeFileSync(path.join(root, "assets", "content", "item-folders.yaml"), folderYaml);
    if (mirrorJournals) {
        fs.writeFileSync(path.join(root, "assets", "content", "journal-folders.yaml"), folderYaml);
    }
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: folderbuild0000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - name: items
      label: Items
      type: Item
      system: sohl
      default: true
      folders: item-folders.yaml
    - name: journals
      label: Journals
      type: JournalEntry
      folders: journal-folders.yaml
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

describe("compiling a note that names its folder by path", () => {
    const roots: string[] = [];
    afterAll(() => {
        for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("files it exactly where the id spelling files its twin", () => {
        const root = folderRepo({
            "ById.md": gear("Bowl By Id", "bowlid", "folder", "dddddddddddddddd"),
            "ByPath.md": gear("Bowl By Path", "bowlpath", "packFolder", "Possessions/Cooking"),
        });
        roots.push(root);
        const result = compile(root);
        const items = packDocs(root, "items");

        expect(result.errors).toBe(0);
        expect(items["Bowl By Path"].folder).toBe("dddddddddddddddd");
        expect(items["Bowl By Path"].folder).toBe(items["Bowl By Id"].folder);
    });

    it("fails when the journals pack does not declare the folder too", () => {
        // A doc journal is filed beside the document it describes, so the
        // journals pack has to declare that folder as well. Where it does not,
        // that is a defect in the folder files and the build says so — an id
        // never noticed, because it was passed across verbatim and validated
        // nowhere, so the document carried a reference the pack could not
        // honour. `sohl-thalorna` has 57 such item folders today and
        // `sohl-kethira-basic` has no journal folder file at all.
        const root = folderRepo(
            { "ByPath.md": gear("Bowl By Path", "bowlpath", "packFolder", "Possessions/Cooking") },
            { mirrorJournals: false },
        );
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/Unknown folder path "Possessions\/Cooking"/);
    });

    it("fails loudly on a path the folder file does not declare", () => {
        const root = folderRepo({
            "Ok.md": gear("Bowl By Id", "bowlid", "folder", "dddddddddddddddd"),
            "Bad.md": gear("Bowl Nowhere", "bowlbad", "packFolder", "Possessions/Nowhere"),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/Unknown folder path "Possessions\/Nowhere"/);
    });

    it("leaves a note that names no folder at the pack root", () => {
        const root = folderRepo({
            "None.md": gear("Bowl Loose", "bowlloose", "shortcode", "bowlloose").replace(
                /^shortcode: bowlloose$/m,
                "",
            ),
        });
        roots.push(root);
        compile(root);

        expect(packDocs(root, "items")["Bowl Loose"].folder).toBeNull();
    });
});
