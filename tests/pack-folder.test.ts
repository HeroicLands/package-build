/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `packFolder:` — naming a compendium folder by a folder note's **address**
 * (#251, #255).
 *
 * It was a path for one release (`Possessions/Cooking`). A path encoded the
 * hierarchy in the value, so reparenting a folder made every note naming it
 * wrong; an address is stable under reparenting. The path form is removed
 * rather than deprecated, because it had no authors to migrate — which is the
 * whole reason the change was cheap enough to make.
 *
 * The compile cases below are also where #257 is evidenced: a folder
 * materialises in **every pack holding a document that references it**, so the
 * mirroring defect the path form could only *report* is now unrepresentable.
 *
 * `folder:` is unchanged throughout: a note that names an id is read, resolved
 * and emitted exactly as before, and nothing warns about it — until #260.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

import { describe, it, expect, afterAll } from "vitest";

import { buildFolderResolver, folderField } from "../engine/helpers.mjs";
import { UNIVERSAL_KEYS } from "../engine/frontmatter-lint.mjs";
import { folderAddress } from "../engine/folder-notes.mjs";
import { makeId } from "../engine/ids.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Three folders, two levels deep, as `item-folders.yaml` declares them. */
const FOLDERS = [
    { name: "Possessions", id: "aaaaaaaaaaaaaaaa", parentFolderId: "" },
    { name: "Consumables", id: "bbbbbbbbbbbbbbbb", parentFolderId: "aaaaaaaaaaaaaaaa" },
    { name: "Poisons and Toxins", id: "cccccccccccccccc", parentFolderId: "bbbbbbbbbbbbbbbb" },
    { name: "Cooking", id: "dddddddddddddddd", parentFolderId: "aaaaaaaaaaaaaaaa" },
];

describe("reading the field", () => {
    it("prefers `packFolder`, and says it is an address", () => {
        expect(folderField({ packFolder: "folder-cooking" })).toEqual({
            value: "folder-cooking",
            isAddress: true,
        });
    });

    it("falls back to `folder`, and says it is not", () => {
        expect(folderField({ folder: "dddddddddddddddd" })).toEqual({
            value: "dddddddddddddddd",
            isAddress: false,
        });
    });

    it("lets `packFolder` win where a note carries both", () => {
        const read = folderField({ packFolder: "cooking", folder: "aaaaaaaaaaaaaaaa" });

        expect(read).toEqual({ value: "cooking", isAddress: true });
    });

    it("reads either from the `sohl:` block, as every other field is read", () => {
        expect(folderField({ sohl: { packFolder: "cooking" } }).value).toBe("cooking");
        expect(folderField({ sohl: { folder: "aaaaaaaaaaaaaaaa" } }).isAddress).toBe(false);
    });

    it("treats a blank `packFolder` as absent rather than as an address", () => {
        // A key cleared in an editor means the note names no folder there, and
        // falling through is what an author part-way through a rename means.
        expect(folderField({ packFolder: "", folder: "aaaaaaaaaaaaaaaa" })).toEqual({
            value: "aaaaaaaaaaaaaaaa",
            isAddress: false,
        });
    });

    it("reports nothing for a note that names no folder", () => {
        expect(folderField({})).toEqual({ value: null, isAddress: false });
    });

    it("is a key every note type may write", () => {
        expect(UNIVERSAL_KEYS.has("packFolder")).toBe(true);
        // The id spelling is untouched.
        expect(UNIVERSAL_KEYS.has("folder")).toBe(true);
    });
});

describe("the id spelling, which is unchanged", () => {
    const { resolver } = buildFolderResolver(FOLDERS);

    it("still resolves an id exactly as before", () => {
        expect(resolver("cccccccccccccccc")).toBe("cccccccccccccccc");
        expect(resolver(null)).toBeNull();
        expect(resolver("")).toBeNull();
        expect(resolver("   ")).toBeNull();
    });

    it("still refuses an id the folder file does not declare", () => {
        expect(() => resolver("nosuchfolderxxxx")).toThrow(/Unknown folder id/);
    });

    it("keeps every invariant it already had", () => {
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

/** A folder note, as a tree authors one after its sweep. */
const folderNote = (shortcode: string, name: string, parent?: string, color?: string) => `---
name:
  full: ${name}
shortcode: ${shortcode}
type: folder
data:
${parent ? `  parent: ${parent}\n` : ""}${color ? `  color: "${color}"\n` : ""}---
`;

/**
 * A throwaway repository with an item pack and a journals pack.
 *
 * The folder **YAML** is still written, because `folder:` still resolves
 * through it — but note that no `journal-folders.yaml` is ever written here.
 * That is the point: under the address form the journals pack materialises the
 * folders it needs from what its documents reference, so there is no second
 * file left to mirror (#257).
 */
function folderRepo(notes: Record<string, string>): string {
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

/**
 * The folder notes the compile cases file things in.
 *
 * Named distinctly from the YAML folders above on purpose: both spellings are
 * live until #260, so a fixture reusing a name would be asserting against
 * whichever of the two happened to be read back, not against the folder note.
 */
const TREE_NOTES = {
    "folders/Gear.md": folderNote("gear", "Gear"),
    "folders/Cookware.md": folderNote("cookware", "Cookware", "gear", "#7a4b2a"),
};

describe("compiling a note that names its folder by address", () => {
    const roots: string[] = [];
    afterAll(() => {
        for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("files it in the folder note's derived id", () => {
        const root = folderRepo({
            ...TREE_NOTES,
            "ByAddress.md": gear("Bowl By Address", "bowladdr", "packFolder", "cookware"),
        });
        roots.push(root);
        const result = compile(root);
        const items = packDocs(root, "items");

        expect(result.errors).toBe(0);
        expect(items["Bowl By Address"].folder).toBe(
            makeId("folder", folderAddress("sohl", "cookware")),
        );
    });

    it("materialises the folder, and its ancestors, in the pack that references it", () => {
        // A `Folder` whose parent is absent is an orphan Foundry renders at the
        // root, so the chain comes with it or the tree breaks at the top.
        const root = folderRepo({
            ...TREE_NOTES,
            "ByAddress.md": gear("Bowl By Address", "bowladdr", "packFolder", "cookware"),
        });
        roots.push(root);
        compile(root);
        const items = packDocs(root, "items");

        expect(items["Cookware"]).toMatchObject({ type: "Item", color: "#7a4b2a" });
        expect(items["Gear"]).toMatchObject({ type: "Item", folder: null });
        expect(items["Cookware"].folder).toBe(items["Gear"]._id);
    });

    it("files the documentation journal in the same folder, in the journals pack", () => {
        // The defect #257 removes. Under the path form this failed unless a
        // second folder file mirrored the first — `sohl-thalorna` was missing
        // 57 such folders and `sohl-kethira-basic` had no journal folder file
        // at all. There is no journal folder file here either, and it compiles:
        // the journals pack materialises the folder its own document points at.
        const root = folderRepo({
            ...TREE_NOTES,
            "ByAddress.md": gear("Bowl By Address", "bowladdr", "packFolder", "cookware"),
        });
        roots.push(root);
        const result = compile(root);
        const items = packDocs(root, "items");
        const journals = packDocs(root, "journals");

        expect(result.errors).toBe(0);
        expect(journals["Cookware"]).toMatchObject({ type: "JournalEntry" });
        // The same id in both packs: a documentation journal filed *beside* its
        // item, not in a folder that merely looks alike.
        expect(journals["Cookware"]._id).toBe(items["Cookware"]._id);
        expect(journals["Bowl By Address"].folder).toBe(journals["Cookware"]._id);
    });

    it("does not materialise a folder nothing references", () => {
        // A folder with nothing in it materialises nowhere — the answer #257
        // left open, settled the way it expected.
        const root = folderRepo({
            ...TREE_NOTES,
            "folders/Unused.md": folderNote("unused", "Unused", "gear"),
            "ByAddress.md": gear("Bowl By Address", "bowladdr", "packFolder", "cookware"),
        });
        roots.push(root);
        compile(root);

        expect(packDocs(root, "items")["Unused"]).toBeUndefined();
    });

    it("fails loudly on an address no folder note answers to", () => {
        const root = folderRepo({
            ...TREE_NOTES,
            "Bad.md": gear("Bowl Nowhere", "bowlbad", "packFolder", "nowhere"),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/no folder note is addressed "nowhere"/);
    });

    it("still files a note that names an id, exactly as before", () => {
        const root = folderRepo({
            ...TREE_NOTES,
            "ById.md": gear("Bowl By Id", "bowlid", "folder", "dddddddddddddddd"),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBe(0);
        expect(packDocs(root, "items")["Bowl By Id"].folder).toBe("dddddddddddddddd");
    });

    it("leaves a note that names no folder at the pack root", () => {
        const root = folderRepo({
            ...TREE_NOTES,
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
