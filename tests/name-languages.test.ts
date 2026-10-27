/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { emitContentIndex, indexRecordsFor } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import {
    loadForeignIndexes,
    markComplete,
    metadataCacheDir,
    metadataFileName,
} from "../engine/metadata-index.mjs";
import { createNameCatalog } from "../engine/names.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A note's `name` is `{full, <code>: [forms]}`. The codes are the configured
 * `languages:` plus `en`, read from the parity fixture rather than copied.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_LANGUAGES: Record<string, { tag: string; note?: string }> = YAML.parse(
    fs.readFileSync(path.join(here, "fixtures/parity/package-build.config.yaml"), "utf8"),
).languages;
const CODES = Object.keys(FIXTURE_LANGUAGES);
const UNDECLARED = "zzq";

function nameFindings(frontmatter: string, languages: readonly string[] = CODES) {
    const raw = `---\n${frontmatter}\n---\n`;
    const fm = YAML.parse(frontmatter);
    return lintNote(
        { file: "Names/Example.md", raw, fm, type: fm.type },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY, languages },
    ).filter((finding: any) => finding.message.includes("`name"));
}

describe("the name keys", () => {
    it("accepts every configured language code as a list of forms", () => {
        expect(CODES).not.toContain(UNDECLARED);
        for (const code of CODES)
            expect(
                nameFindings(`type: lore\nname: {full: Ada Vale, ${code}: [Ada, The Swift]}`),
                code,
            ).toEqual([]);
    });

    it("accepts en although the configuration need not declare it", () => {
        const others = CODES.filter((code) => code !== "en");
        expect(nameFindings("type: lore\nname: {full: Ada Vale, en: [Ada]}", others)).toEqual([]);
    });

    it("refuses a code the configuration does not declare, and aliases, at the key", () => {
        for (const key of [UNDECLARED, "aliases"]) {
            const found = nameFindings(`type: lore\nname: {full: Ada, ${key}: [Vale]}`);
            expect(found, key).toHaveLength(1);
            expect(found[0]).toMatchObject({ line: 3, column: 19, severity: "error" });
            expect(found[0].message).toContain(`name.${key}`);
        }
    });

    it("refuses a form list that is not a list of nonempty strings", () => {
        const [code] = CODES;
        expect(nameFindings(`type: lore\nname: {full: Ada, ${code}: Vale}`)).toHaveLength(1);
        expect(nameFindings(`type: lore\nname: {full: Ada, ${code}: [Vale, '']}`)).toHaveLength(1);
    });

    it("reports an en form that repeats full, ignoring case", () => {
        const found = nameFindings("type: lore\nname: {full: Ada Vale, en: [Ada, ada vale]}");
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("name.full");
    });
});

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, value: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
}

function fixture(notes: object[], foreignRecord?: object) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "name-languages-")));
    roots.push(root);
    write(path.join(root, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    const config = configFromData(
        {
            contentPackage: "test",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "namelanguages000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            languages: Object.fromEntries(
                Object.entries(FIXTURE_LANGUAGES).map(([code, spec]) => [code, { tag: spec.tag }]),
            ),
            ...(foreignRecord ?
                {
                    relationships: {
                        requires: [{ id: "pub", manifest: "https://example.invalid/module.json" }],
                    },
                }
            :   {}),
        },
        path.join(root, "package-build.config.yaml"),
    );
    for (const [n, note] of notes.entries())
        write(
            path.join(config.paths.content, `${n}.md`),
            `---\n${YAML.stringify(note)}---\n\nWritten prose.\n`,
        );
    if (foreignRecord) {
        const foreign = metadataCacheDir(config, "pub", "1.0.0");
        write(path.join(foreign, metadataFileName("pub")), JSON.stringify(foreignRecord) + "\n");
        markComplete(foreign);
    }
    const parsed = new Map();
    const records = indexRecordsFor({ contentBase: config.paths.content, config, parsed });
    const index = buildLinkIndex(config.paths.content, { config, records, parsed });
    return { config, records, parsed, index };
}

describe("matching ignores case", () => {
    it("recognizes a form whatever its case, and keeps the authored full name", () => {
        const [, code] = CODES;
        const source = fixture([
            {
                type: "place",
                shortcode: "arden",
                name: { full: "Arden Vale", [code]: ["Ardenhal"] },
            },
        ]);
        const catalog = createNameCatalog(source);
        for (const label of ["arden vale", "ARDEN VALE", "ardenhal", "Ardenhal's"])
            expect(catalog.recognize(label), label).toMatchObject({
                key: "test-note-place-arden",
                full: "Arden Vale",
            });
    });

    it("reports two notes whose forms differ only by case as an ambiguous name", () => {
        const source = fixture([
            { type: "lore", shortcode: "bear", name: { full: "Bear" } },
            {
                type: "being",
                subType: "creature",
                shortcode: "smith",
                name: { full: "Old Smith", en: ["bear"] },
            },
        ]);
        const match = createNameCatalog(source).recognize("Bear");
        expect(match?.candidates?.map((c: any) => c.key).sort()).toEqual([
            "test-note-being-smith",
            "test-note-lore-bear",
        ]);
    });
});

describe("the index publishes the derived language and the forms by language", () => {
    it("carries the name map, its ASCII forms by language and the language", () => {
        const [, code] = CODES;
        const source = fixture([
            {
                type: "lore",
                subType: "culture",
                shortcode: "folk",
                name: { full: "Grass People", en: ["Grassfolk"], [code]: ["Tenláya", "Tenla"] },
                data: { lang: code },
            },
        ]);
        const record = source.records.find((r: any) => r.shortcode === "folk");
        expect(record.name).toEqual({
            full: "Grass People",
            en: ["Grassfolk"],
            [code]: ["Tenláya", "Tenla"],
        });
        expect(record.formsAscii).toEqual({ en: ["Grassfolk"], [code]: ["Tenlaya", "Tenla"] });
        expect(record).not.toHaveProperty("aliasesAscii");
        expect(record.lang).toBe(code);
    });

    it("publishes each entry's forms and language to a consuming package", () => {
        const [, code] = CODES;
        const source = fixture([
            {
                type: "lore",
                subType: "culture",
                shortcode: "folk",
                name: { full: "Grass People", [code]: ["Tenlaya"] },
                data: { lang: code },
            },
        ]);
        const out = path.join(path.dirname(source.config.paths.content), "index-out");
        emitContentIndex({ config: source.config, outDir: out });
        const file = path.join(out, metadataFileName("test"));
        const records = fs
            .readFileSync(file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        const folk = records.find((r) => r.shortcode === "folk");
        expect(folk.lang).toBe(code);
        expect(folk.name[code]).toEqual(["Tenlaya"]);

        // Read back as a dependency: the foreign entry carries forms and language.
        const published = JSON.parse(
            JSON.stringify({ ...folk, package: "pub" }).replaceAll('"test-', '"pub-'),
        );
        const consumer = fixture([{ type: "lore", shortcode: "tale" }], published);
        const foreign = loadForeignIndexes(consumer.config, ["test"]).index;
        const entry = [...foreign.values()].find((e: any) => e.name === "Grass People");
        expect(entry).toMatchObject({ lang: code, forms: { [code]: ["Tenlaya"] } });
        expect(entry).not.toHaveProperty("aliases");
    });
});
