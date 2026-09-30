/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAddress, renderAddress, readCanonicalKey } from "../engine/address.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { defineConfig } from "../content-config.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";

const roots: string[] = [];
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/package-build.mjs");

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dnd5e-system-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets", "templates"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "assets", "templates", "system.template.json"),
        JSON.stringify({ id: "sohl", compatibility: { minimum: "14" } }),
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Reference.md"),
        `---\nshortcode: rules\nname: { full: Rules }\ntype: doc\nsubType: reference\ndnd5e: {}\n---\n\nRules text.\n`,
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Homepage.md"),
        `---\nshortcode: root\nname: { full: Guide }\ntype: homepage\n---\n\n# Guide\n\nThis homepage introduces the package content and helps readers find its reference notes.\n`,
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Links.md"),
        `---\nshortcode: links\nname: { full: Links }\ntype: doc\nsubType: reference\n---\n\nSee [[dnd5e-doc-rules|Rules]].\n`,
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: dnd5esystembuild000
systems:
    dnd5e:
        compatibility: { verified: "1.0.0" }
skipDirectories: []
packs:
    - { name: journals, label: Journals, type: JournalEntry, default: true }
`,
    );
    return root;
}

function configFor(root: string) {
    return defineConfig({
        rootDir: root,
        contentPackage: "sohl",
        foundryPackage: "sohl",
        packageKind: "systems",
        compatibility: { minimum: "14", verified: "14.367" },
        stats: { lastModifiedBy: "dnd5esystembuild000" },
        systems: { dnd5e: { compatibility: { verified: "1.0.0" } } },
        packs: [{ name: "journals", label: "Journals", type: "JournalEntry", default: true }],
    } as never);
}

afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("the dnd5e system vocabulary", () => {
    it("parses and renders an address with a dnd5e system segment", () => {
        const address = parseAddress(
            "sohl-dnd5e-doc-rules",
            { types: new Set(Object.keys(NOTE_VOCABULARY)) },
            { declared: true },
        );
        expect(address).not.toHaveProperty("reason");
        expect(renderAddress(address as never)).toBe("sohl-dnd5e-doc-rules");
        expect(readCanonicalKey("sohl-dnd5e-doc-rules")).toMatchObject({
            system: "dnd5e",
            type: "doc",
            shortcode: "rules",
        });
    });

    it("lints a note carrying an empty dnd5e block", () => {
        const fm = {
            shortcode: "rules",
            name: { full: "Rules" },
            type: "doc",
            subType: "reference",
            dnd5e: {},
        };
        const findings = lintNote(
            {
                file: "/tree/Reference.md",
                raw: "---\ntype: doc\ndnd5e: {}\n---\n",
                fm,
            },
            {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                systems: { dnd5e: { known: [] } },
            },
        );
        expect(findings).toEqual([]);
    });

    it("resolves a dnd5e address from a canonical record in the content index", () => {
        const root = fixture();
        const config = configFor(root);
        const records = indexRecordsFor({
            contentBase: path.join(root, "assets", "content"),
            config,
            skipDirectories: [],
        });
        const target = records.find(
            (record) => record.type === "doc" && record.shortcode === "rules",
        );
        expect(target).toBeDefined();
        // The fixture's core JournalEntry has no dnd5e subtype. This record
        // models a canonical dnd5e entry from an index, the target form the
        // generic resolver accepts without a local system compiler.
        const dnd5eTarget = {
            ...target,
            address: { ...target.address, canonical: "sohl-dnd5e-doc-rules" },
        };
        const index = buildLinkIndex(path.join(root, "assets", "content"), {
            config,
            skipDirectories: [],
            records: records.map((record) => (record === target ? dnd5eTarget : record)),
        });

        expect(index.addressHit("sohl-dnd5e-doc-rules")).toMatchObject({
            type: "doc",
            fm: { shortcode: "rules" },
        });
        expect(index.notes.some((note) => note.fm.shortcode === "links")).toBe(true);
        expect(auditLinks(index).deadAddresses).toEqual([]);
    });

    it("accepts a note carrying an empty dnd5e block through package-build lint", () => {
        const root = fixture();
        const result = spawnSync(process.execPath, [CLI, "lint"], {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            encoding: "utf8",
        });
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    });

    it("compiles a note carrying a dnd5e block into its declared core document", async () => {
        const root = fixture();
        const config = configFor(root);

        const errors = await generatePacksJson({ config });
        const output = path.join(root, "build", "packs-json", "journals");
        const compiled = fs
            .readdirSync(output)
            .map((file) => path.join(output, file))
            .find((file) => JSON.parse(fs.readFileSync(file, "utf8")).name === "Rules");
        expect(errors).toBe(0);
        expect(compiled).toBeDefined();
        expect(JSON.parse(fs.readFileSync(compiled!, "utf8"))).toMatchObject({
            name: "Rules",
        });
        const indexed = indexRecordsFor({
            contentBase: path.join(root, "assets", "content"),
            config,
            skipDirectories: [],
        });
        expect(
            indexed.find((record) => record.type === "doc" && record.shortcode === "rules")?.address
                .canonical,
        ).toMatchObject({ system: "note" });
    });
});
