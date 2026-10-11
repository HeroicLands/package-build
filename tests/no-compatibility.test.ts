/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The toolchain admits one shape for every input, the current one.
 *
 * Nothing here reads, converts or refuses an older form by name. A type or a
 * key the vocabulary does not declare is refused by the ordinary unclaimed-type
 * or unknown-key finding, at its own line, and nothing records what it once
 * meant. Four properties are held:
 *
 * - no retired or renamed type is known by name — it is an undeclared type,
 *   refused by the lint and by a compile that skipped the lint;
 * - no field has a second, in-block spelling, and no `data:` field is read off
 *   the note's top level;
 * - a field whose home is `data:`, written in a system block, is an error at
 *   its key;
 * - no source file declares or reads a table of retired keys.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "loglevel";

import { defineConfig } from "../content-config.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { authoredFields } from "../engine/field-spec.mjs";
import { resolveFieldValue } from "../engine/system-block.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every type a table once retired or renamed. */
const FORMER_TYPES = [
    "character",
    "creature",
    "battlemap",
    "localmap",
    "regionalmap",
    "armor",
    "concoction",
    "projectile",
];

/** Wording that names a past form rather than the current one. */
const HISTORY = /retired|renamed|in favour|no longer|formerly/i;

/* -------------------------------------------------------------------- */
/*  A type nothing declares                                              */
/* -------------------------------------------------------------------- */

describe("a former type is an undeclared type", () => {
    const noteOn = (type: string) => ({
        file: `/tree/${type}.md`,
        type,
        raw: `---\nname:\n  full: Thing\ntype: ${type}\nshortcode: thing\n---\n`,
        fm: { name: { full: "Thing" }, type, shortcode: "thing" },
    });

    it.each(FORMER_TYPES)("the lint refuses `%s` at its `type:` line", (type) => {
        const findings = lintNote(noteOn(type), {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            references: false,
        } as any);
        const typed = findings.filter((f: any) => f.line === 4);
        expect(typed).toHaveLength(1);
        expect(typed[0].severity).toBe("error");
        expect(typed[0].message).toMatch(/no schema is declared for content type/);
        for (const finding of findings) expect(finding.message).not.toMatch(HISTORY);
    });

    describe("the compile, on a tree that skipped the lint", () => {
        const roots: string[] = [];
        const messages: string[] = [];
        let errors = 0;

        beforeAll(async () => {
            log.setLevel("silent");
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-nocompat-"));
            roots.push(root);
            fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
            fs.mkdirSync(path.join(root, "assets", "templates"), { recursive: true });
            fs.writeFileSync(
                path.join(root, "assets", "templates", "system.template.json"),
                JSON.stringify({ id: "sohl", compatibility: { minimum: "14" } }),
            );
            FORMER_TYPES.forEach((type, i) => {
                fs.writeFileSync(
                    path.join(root, "assets", "content", `${type}.md`),
                    `---\nname:\n  full: Thing ${type}\nid: ${String(i).padStart(16, "0")}\n` +
                        `shortcode: thing${type}\ntype: ${type}\n---\n\nProse.\n`,
                );
            });
            const original = console.error;
            console.error = (...args: unknown[]) => messages.push(args.join(" "));
            try {
                errors = await generatePacksJson({
                    config: defineConfig({
                        compatibility: { minimum: "14.359", verified: "14.359" },
                        rootDir: root,
                        contentPackage: contentPackage(),
                        foundryPackage: "sohl",
                        packageKind: "systems",
                        stats: { lastModifiedBy: "sohltestbuild0000" },
                        systems: { sohl: { compatibility: { verified: "1.0.0" } } },
                        packs: [
                            { name: "actors", type: "Actor", system: "sohl", mayBeEmpty: true },
                            { name: "items", type: "Item", system: "sohl", mayBeEmpty: true },
                        ],
                    } as any),
                });
            } catch (err: any) {
                messages.push(String(err?.message ?? err));
            } finally {
                console.error = original;
            }
        });
        afterAll(() => {
            for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
            log.setLevel("warn");
        });

        it.each(FORMER_TYPES)("fails with a located error naming `%s`", (type) => {
            const line = messages.find((m) => m.includes(`${type}.md:`));
            expect(line, messages.join("\n")).toBeDefined();
            expect(line).toMatch(/^[^\s]+\.md:\d+:\d+: error: /);
            expect(line).toContain(`"${type}"`);
            expect(line).not.toMatch(HISTORY);
        });

        it("reports each note once and fails the build", () => {
            expect(errors, messages.join("\n")).toBe(FORMER_TYPES.length);
        });
    });
});

/* -------------------------------------------------------------------- */
/*  Positions                                                            */
/* -------------------------------------------------------------------- */

/** Every field declaration both systems state, with the type it belongs to. */
function declarations(): Array<{ type: string; field: any }> {
    const out: Array<{ type: string; field: any }> = [];
    for (const table of [NOTE_SCHEMAS, ITEM_FIELDS, HM3_ITEM_FIELDS] as any[]) {
        for (const [type, schema] of Object.entries(table)) {
            if (!Array.isArray(schema)) continue;
            for (const field of authoredFields(schema)) out.push({ type, field });
        }
    }
    return out;
}

describe("a field has one authored position besides its destination", () => {
    const dataFields = declarations().filter(
        ({ field }) => typeof field.name === "string" && field.name.startsWith("data."),
    );

    it("declares no second in-block key", () => {
        const withKey = declarations().filter(({ field }) => "legacyKey" in field);
        expect(withKey.map(({ type, field }) => `${type}:${field.name}`)).toEqual([]);
    });

    it("has data fields to measure", () => {
        expect(dataFields.length).toBeGreaterThan(20);
    });

    it("reads a `data:` field from `data:` and nowhere else", () => {
        const stray: string[] = [];
        for (const { type, field } of dataFields) {
            const bare = field.name.slice("data.".length);
            if (bare.includes(".")) continue;
            const marker = "__marker__";
            for (const fm of [{ sohl: { [bare]: marker } }, { [bare]: marker }]) {
                const { value } = resolveFieldValue(field, fm as any, { block: "sohl" });
                if (value === marker) stray.push(`${type}:${field.name}`);
            }
        }
        expect(stray).toEqual([]);
    });

    it("locates the block's key, not the `data:` key of the same name", () => {
        const raw =
            "---\nname:\n  full: Thing\ntype: weapongear\nshortcode: thing\n" +
            "data:\n  weight: 1\nsohl:\n  weight: 2\n---\n";
        const fm = {
            name: { full: "Thing" },
            type: "weapongear",
            shortcode: "thing",
            data: { weight: 1 },
            sohl: { weight: 2 },
        };
        const findings = lintNote(
            { file: "/tree/thing.md", type: "weapongear", raw, fm } as any,
            {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                references: false,
            } as any,
        ).filter((f: any) => /sohl\.weight/.test(f.message));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "error", line: 9, column: 3 });
    });

    it("names the key and its home when a `data:` field is written in a system block", () => {
        const { type, field } = dataFields.find(({ type }) => type === "weapongear")!;
        const bare = field.name.slice("data.".length).split(".")[0];
        const fm = { name: { full: "Thing" }, type, shortcode: "thing", sohl: { [bare]: "x" } };
        const raw = `---\nname:\n  full: Thing\ntype: ${type}\nshortcode: thing\nsohl:\n  ${bare}: x\n---\n`;
        const findings = lintNote(
            { file: "/tree/thing.md", type, raw, fm } as any,
            {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                references: false,
            } as any,
        ).filter((f: any) => f.line === 7);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain(`sohl.${bare}`);
        expect(findings[0].message).toContain(`data.${bare}`);
    });
});

/* -------------------------------------------------------------------- */
/*  No standing table of retired keys                                    */
/* -------------------------------------------------------------------- */

/** Source files that ship, as paths relative to the repository root. */
function shippedSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(rel);
            else if (entry.name.endsWith(".mjs")) out.push(rel);
        }
    };
    for (const dir of ["engine", "sohl", "hm3", "bin"]) walk(dir);
    for (const file of fs.readdirSync(ROOT)) if (file.endsWith(".mjs")) out.push(file);
    return out;
}

describe("no source declares or reads a table of retired keys", () => {
    const IDENTIFIERS = [
        "RETIRED_TYPES",
        "RENAMED_TYPES",
        "RETIRED_FIELD_ALIASES",
        "RETIRED_ADDRESS_KEYS",
        "UNIVERSAL_RETIRING_DATA_KEYS",
        "legacyKey",
        "legacyKeyOf",
        "retiredTopLevelKey",
        "currentType",
        "assertTypeNotRetired",
        "renamedTypeMessage",
        "measureCorpus",
        "measureNote",
        "readAliasedField",
        "retired-fields",
    ];
    const sources = shippedSources().map((file) => [
        file,
        fs.readFileSync(path.join(ROOT, file), "utf8"),
    ]);

    it.each(IDENTIFIERS)("`%s` appears nowhere", (identifier) => {
        const hits = sources.filter(([, text]) => text.includes(identifier)).map(([file]) => file);
        expect(hits).toEqual([]);
    });

    it("exports no constant named for a retired thing, bar the host list", () => {
        const hits: string[] = [];
        for (const [file, text] of sources) {
            for (const match of text.matchAll(/^export const (RETIRED_\w+|RENAMED_\w+)/gm)) {
                if (match[1] !== "RETIRED_HOSTS") hits.push(`${file}:${match[1]}`);
            }
        }
        expect(hits).toEqual([]);
    });

    it("has no module of retired fields", () => {
        expect(fs.existsSync(path.join(ROOT, "engine", "retired-fields.mjs"))).toBe(false);
    });
});
