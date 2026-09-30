/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lintNote, systemAddressFindings } from "../engine/frontmatter-lint.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PACKAGE_ROOT, "bin", "package-build.mjs");
const systems = { sohl: { fields: ITEM_FIELDS, fieldVocabulary: true } };

const unresolvedIndex = {
    contentPackage: "sohl",
    types: new Set([...Object.keys(NOTE_VOCABULARY), "skill"]),
    addressHit: () => undefined,
};

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "system-address-references-"));
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
    lastModifiedBy: clitestbuild000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
skipDirectories: []
packs:
    - { name: items, label: Items, type: Item, system: sohl, default: true }
`,
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Affiliation.md"),
        `---
shortcode: guild
name: { full: Guild, aliases: [] }
type: affiliation
subType: guild
sohl:
  system:
    commonSkills: [herb, probemodelzz]
---

Guild prose.
`,
    );
    fs.writeFileSync(
        path.join(root, "assets", "content", "Skill.md"),
        `---
shortcode: herb
name: { full: Herb, aliases: [] }
type: skill
subType: craft
sohl: { subType: craft }
---

Skill prose.
`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        env: {
            ...process.env,
            PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
        },
        encoding: "utf8",
    });
    return {
        status: result.status,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
}

describe("references authored in a system block", () => {
    it("checks every address-bearing SoHL item field declared by its schema", () => {
        const declared = Object.entries(ITEM_FIELDS).flatMap(([type, fields]) =>
            fields.filter((field) => field.address).map((field) => ({ type, field })),
        );
        const notes = new Map<string, object>();
        for (const [index, { type, field }] of declared.entries()) {
            let note = notes.get(type) as any;
            if (!note) {
                note = {
                    file: `/tree/${type}.md`,
                    type,
                    raw: `---\ntype: ${type}\nsohl:\n  system:\n---\n`,
                    fm: { type, sohl: { system: {} } },
                };
                notes.set(type, note);
            }
            const shortcode = `missing${index}`;
            const address = `${field.address.type}-${shortcode}`;
            note.fm.sohl.system[field.to] =
                field.address.holds === "items" ? [address]
                : field.address.holds === "keys" ? { [address]: "aligned" }
                : address;
        }
        const referenceFindings = [...notes.values()].flatMap((note) =>
            systemAddressFindings(note, {
                schemas: NOTE_SCHEMAS,
                systems,
                index: unresolvedIndex,
            }),
        );
        const unresolved = referenceFindings.filter((finding) =>
            finding.message.includes(
                "does not resolve in this package or its declared dependencies",
            ),
        );

        expect(unresolved).toHaveLength(declared.length);
        for (const { type, field } of declared) {
            expect(unresolved.map((finding) => finding.message).join("\n")).toContain(
                `sohl.system.${field.to}`,
            );
            expect(unresolved.map((finding) => finding.message).join("\n")).toContain(type);
        }
    });

    it("checks a system-block reference through lintNote", () => {
        const source = {
            file: "/tree/affiliation.md",
            type: "affiliation",
            raw: `---\ntype: affiliation\nsohl:\n  system:\n    commonSkills:\n      - probemodelzz\n---\n`,
            fm: { type: "affiliation", sohl: { system: { commonSkills: ["probemodelzz"] } } },
        };
        const findings = lintNote(source, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            systems,
            index: unresolvedIndex,
        });

        expect(findings.map((finding) => finding.message).join("\n")).toContain(
            "sohl.system.commonSkills",
        );
        expect(findings.map((finding) => finding.message).join("\n")).toContain(
            "does not resolve in this package or its declared dependencies",
        );
    });

    it("does not resolve these fields when the lint caller disables references", () => {
        const fields = ITEM_FIELDS.affiliation.filter((field) => field.address);
        const system = Object.fromEntries(
            fields.map((field) => {
                return [field.to, `${field.address.type}-missing`];
            }),
        );
        const findings = lintNote(
            {
                file: "/tree/affiliation.md",
                type: "affiliation",
                raw: "---\ntype: affiliation\nsohl:\n  system:\n    commonSkills: [probemodelzz]\n---\n",
                fm: {
                    type: "affiliation",
                    sohl: { system: system },
                },
            },
            {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                systems,
            },
        );

        expect(
            findings.filter((finding) =>
                finding.message.includes(
                    "does not resolve in this package or its declared dependencies",
                ),
            ),
        ).toEqual([]);
    });

    it("reports an unresolved shortcode through package-build links", () => {
        const result = run("links");

        expect(result.status, result.output).toBe(1);
        expect(result.output).toMatch(
            /Affiliation\.md:\d+:\d+: error: `sohl\.system\.commonSkills\.1` names .*probemodelzz.*does not resolve/,
        );
        expect(result.output).not.toContain("every address resolves");
    });

    it("reports an unresolved shortcode through package-build lint", () => {
        const result = run("lint");

        expect(result.status, result.output).toBe(1);
        expect(result.output).toMatch(/commonSkills.*probemodelzz.*does not resolve/);
    });

    it("honours --no-references for system-block addresses", () => {
        const result = run("lint", "--no-references");

        expect(result.output).not.toMatch(/commonSkills.*probemodelzz.*does not resolve/);
    });
});
