/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCanonicalKey } from "../engine/address.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { createFirstUseChecker } from "../engine/first-use.mjs";
import {
    loadForeignIndexes,
    markComplete,
    metadataCacheDir,
    metadataFileName,
} from "../engine/metadata-index.mjs";
import {
    analyzeNameSpans,
    collectUnwrittenNames,
    createNameCatalog,
    createNamesReport,
    displayName,
    nameForms,
    namesReportFinding,
    normalizeName,
} from "../engine/names.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
import { parseWikilink } from "../engine/wikilink-syntax.mjs";
import { createNameRefChecker, nameRefFindings } from "../engine/name-refs.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { configFromData } from "../engine/pack-config.mjs";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, value: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
}

function fixture(extra: object[] = []) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "names-catalog-")));
    roots.push(root);
    write(path.join(root, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    const config = configFromData(
        {
            contentPackage: "test",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "namescatalog0000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            relationships: {
                requires: [{ id: "pub", manifest: "https://example.invalid/module.json" }],
            },
        },
        path.join(root, "package-build.config.yaml"),
    );
    const notes = [
        { type: "place", shortcode: "arden", name: { full: "Arden Vale", en: ["Arden"] } },
        { type: "lore", shortcode: "warden", name: { full: "Warden" } },
        { type: "doc", shortcode: "reader", name: { full: "Reader" } },
        ...extra,
    ];
    for (const [n, note] of notes.entries())
        write(
            path.join(config.paths.content, `${n}.md`),
            `---\n${YAML.stringify(note)}---\n\nWritten prose.\n`,
        );
    const foreign = metadataCacheDir(config, "pub", "1.0.0");
    write(
        path.join(foreign, metadataFileName("pub")),
        JSON.stringify({
            package: "pub",
            type: "skill",
            shortcode: "craft",
            name: { full: "North Craft", en: ["Northern Craft"] },
            address: { canonical: "pub-sohl-skill-craft", slug: "skill-craft" },
            anchors: [{ slug: "work", kind: "prose" }],
            foundry: {
                sohl: { uuid: "Compendium.pub.skills.Item.craft" },
                note: { uuid: "Compendium.pub.journals.JournalEntry.craft" },
            },
        }) + "\n",
    );
    markComplete(foreign);
    const parsed = new Map();
    const records = indexRecordsFor({ contentBase: config.paths.content, config, parsed });
    const index = buildLinkIndex(config.paths.content, { config, records, parsed });
    return { config, records, parsed, index };
}

function frozen<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) frozen(child);
        Object.freeze(value);
    }
    return value;
}

describe("indexed name catalog", () => {
    it("keeps whole-label Unicode normalization and regular inflections, folding case to match", () => {
        expect(normalizeName("  Rene\u0301e\tVale’s  ")).toBe("renée vale's");
        expect(displayName("  Rene\u0301e\tVale’s  ")).toBe("Renée Vale's");
        expect(nameForms("Hidden Hand")).toEqual([
            "hidden hand",
            "hidden hand's",
            "hidden hands",
            "hidden hands's",
            "hidden hands'",
        ]);
        expect(nameForms("Ivory City")).toContain("ivory cities");
        expect(nameForms("North Watch")).toContain("north watches");
        expect(nameForms("?!")).toEqual(["?!"]);
    });

    it("matches full names and listed forms, ignoring case, with the current first-use behavior", () => {
        const source = fixture([
            { type: "place", shortcode: "renee", name: { full: "Renée Vale" } },
            { type: "place", shortcode: "highking", name: { full: "High King" } },
        ]);
        const catalog = createNameCatalog(source);
        const check = createFirstUseChecker(source);
        for (const [label, key, fullUse] of [
            ["Arden Vale", "test-note-place-arden", true],
            ["Arden", "test-note-place-arden", false],
            ["Arden’s", "test-note-place-arden", false],
            ["arden", "test-note-place-arden", false],
            ["ARDEN VALE", "test-note-place-arden", true],
            ["Wardens", "test-note-lore-warden", true],
            ["Rene\u0301e  Vale", "test-note-place-renee", true],
        ] as const) {
            expect(catalog.recognize(label)).toMatchObject({ key, fullUse, indexed: true });
            const findings = check({ file: "Reader.md", raw: `[${label}]{.name}` });
            expect(findings).toHaveLength(1);
            expect(findings[0].rules).toContain("unlinked-name");
            expect(findings[0].message).toContain(key);
        }
        for (const label of ["High", "Arden Vale beyond", "", "   "])
            expect(catalog.recognize(label)).toBeUndefined();
    });

    it("retains all ambiguous candidates and selects only an explicit preferred identity", () => {
        const source = fixture([
            { type: "place", shortcode: "other", name: { full: "Arden Vale", en: ["Arden"] } },
        ]);
        const catalog = createNameCatalog(source);
        const ambiguous = catalog.recognize("Arden");
        expect(ambiguous).toMatchObject({ key: "name:arden", indexed: true, fullUse: true });
        expect(ambiguous.candidates.map((entry) => entry.key)).toEqual([
            "test-note-place-arden",
            "test-note-place-other",
        ]);
        const preferred = catalog.resolve("place-other");
        expect(catalog.recognize("Arden", preferred)).toMatchObject({
            key: "test-note-place-other",
            fullUse: false,
        });
        const check = createFirstUseChecker(source);
        const finding = check({ file: "Reader.md", raw: "[Arden]{.name}" })[0];
        for (const entry of ambiguous.candidates) expect(finding.message).toContain(entry.key);
    });

    it("shares fetched NOTE and native identities without using object identity or link labels", () => {
        const source = fixture();
        const catalog = createNameCatalog(source);
        expect(source.index.foreign.index.get("pub-note-skill-craft")).not.toBe(
            source.index.foreign.index.get("pub-sohl-skill-craft"),
        );
        for (const target of ["pub-note-skill-craft", "pub-sohl-skill-craft"])
            expect(catalog.resolve(target)).toMatchObject({
                key: "pub-note-skill-craft",
                full: "North Craft",
            });
        expect(catalog.recognize("Northern Crafts")).toMatchObject({
            key: "pub-note-skill-craft",
            fullUse: false,
        });
        expect(
            catalog.recognize("the northern lesson", catalog.resolve("pub-sohl-skill-craft")),
        ).toBeUndefined();
        const check = createFirstUseChecker(source);
        expect(
            check({
                file: "Reader.md",
                raw: "[[pub-note-skill-craft#work|North Craft]] then [North Craft]{.name}",
            }).at(-1).rules,
        ).toEqual(["unlinked-name"]);
        expect(catalog.resolve("pub-note-skill-missing")).toBeUndefined();
        expect(catalog.resolve("Undeclared name")).toBeUndefined();
    });

    it("excludes local folders, fetched folder projections, assets and documentation records", () => {
        const source = fixture([{ type: "folder", shortcode: "great", name: { full: "Great" } }]);
        const folder = encodeAddresses(source.records.find((record) => record.type === "folder"));
        fs.appendFileSync(
            path.join(metadataCacheDir(source.config, "pub", "1.0.0"), metadataFileName("pub")),
            JSON.stringify({
                ...folder,
                package: "pub",
                address: { ...folder.address, canonical: "pub-none-folder-great" },
                foundry: {},
            }) + "\n",
        );
        const foreign = loadForeignIndexes(source.config, ["test"], { pub: "/pub/" });
        expect(foreign.index.has("pub-note-folder-great")).toBe(true);
        foreign.index.set("pub-none-image-banner", { name: "Banner", type: "image" });
        const records = [
            ...source.records,
            { asset: { type: "image" }, name: { full: "Local Banner" } },
            { documents: readCanonicalKey("test-sohl-skill-craft"), name: { full: "Craft Sheet" } },
        ];
        const index = buildLinkIndex(source.config.paths.content, { ...source, records, foreign });
        const catalog = createNameCatalog({ records, index });
        for (const label of ["Great", "Banner", "Local Banner", "Craft Sheet"])
            expect(catalog.recognize(label)).toBeUndefined();
        expect(catalog.recognize("North Craft")).toMatchObject({ key: "pub-note-skill-craft" });
    });
});

describe("typed name spans", () => {
    const lineage = { type: "affiliation", subType: "lineage" };

    it("match only indexed notes of the supplied type and subtype", () => {
        const source = fixture([
            {
                type: "place",
                subType: "region",
                shortcode: "saddle",
                name: { full: "The Western Saddle", en: ["Theinuvael"] },
            },
            { type: "lore", shortcode: "other", name: { full: "Arden" } },
        ]);
        const catalog = createNameCatalog(source);
        expect(catalog.recognize("Theinuvael", undefined, lineage)).toBeUndefined();
        expect(
            catalog.recognize("Theinuvael", undefined, { type: "affiliation", subType: null }),
        ).toBeUndefined();
        for (const kind of [
            undefined,
            { type: null, subType: null },
            { type: "place", subType: null },
            { type: "place", subType: "region" },
        ])
            expect(catalog.recognize("Theinuvael", undefined, kind)).toMatchObject({
                key: "test-note-place-saddle",
            });
        expect(
            catalog.recognize("Theinuvael", undefined, { type: "place", subType: "settlement" }),
        ).toBeUndefined();
        expect(catalog.recognize("Arden").candidates).toHaveLength(2);
        expect(
            catalog.recognize("Arden", undefined, { type: "lore", subType: null }),
        ).toMatchObject({
            key: "test-note-lore-other",
        });
        expect(
            catalog.recognize("North Craft", undefined, { type: "skill", subType: null }),
        ).toMatchObject({
            full: "North Craft",
        });
        expect(
            catalog.recognize("North Craft", undefined, { type: "place", subType: null }),
        ).toBeUndefined();
    });

    it("report a span naming another kind of thing as no unlinked name", () => {
        const source = fixture([
            {
                type: "place",
                shortcode: "saddle",
                name: { full: "The Western Saddle", en: ["Theinuvael"] },
            },
        ]);
        const check = createFirstUseChecker(source);
        const rules = (raw: string) =>
            check({ file: "Reader.md", raw }).flatMap((finding) => finding.rules);
        expect(
            rules('the lineage [Theinuvael]{.name data-type="affiliation/lineage"} holds it'),
        ).toEqual([]);
        expect(rules('[Theinuvael]{.name data-type="place"}')).toContain("unlinked-name");
        expect(rules("[Theinuvael]{.name}")).toContain("unlinked-name");
        expect(
            rules(
                '[[place-saddle|]] is held by [Theinuvael]{.name data-type="affiliation/lineage"}, and [Theinuvael]{.name data-type="affiliation/lineage"} again.',
            ),
        ).toEqual([]);
        expect(rules('[[place-saddle|]] and [Theinuvael]{.name data-type="place"}')).toEqual([
            "unlinked-name",
        ]);
    });

    it("group a typed span matching only another kind's name as unwritten", () => {
        const source = fixture([
            {
                type: "place",
                shortcode: "saddle",
                name: { full: "The Western Saddle", en: ["Theinuvael"] },
            },
        ]);
        const catalog = createNameCatalog(source);
        const names = [
            { name: "Theinuvael", type: "affiliation", subType: "lineage", line: 3, column: 5 },
            { name: "Theinuvael", type: "place", subType: null, line: 4, column: 1 },
            { name: "Theinuvael", type: null, subType: null, line: 5, column: 1 },
        ];
        const { groups } = collectUnwrittenNames({
            records: [
                { address: { canonical: "test-note-doc-reader" }, file: { path: "1.md" }, names },
            ],
            catalog,
        });
        expect(groups).toEqual([
            {
                type: "affiliation",
                subType: "lineage",
                names: [
                    {
                        name: "Theinuvael",
                        uses: [{ owner: "test-note-doc-reader", file: "1.md", line: 3, column: 5 }],
                    },
                ],
            },
        ]);
    });
});

describe("unwritten marked names", () => {
    it("groups only captured occurrences and keeps every use with its exact source site", () => {
        const source = fixture();
        const catalog = createNameCatalog(source);
        const raw =
            '---\r\ntype: doc\r\nshortcode: reader\r\nname: Reader\r\n---\r\n\r\n😀 [Arden Vale]{.name}\r\n\r\n[Ravenmoor]{.name data-type="place/settlement"}\r\n[Ravenmoor]{.name data-type="place/settlement"}\r\n[Aldric Venn]{.name data-type="being"}\r\n[Unwritten]{.name}\r\n';
        const record = source.records.find((entry) => entry.shortcode === "reader");
        write(path.join(source.config.paths.content, record.file.path), raw);
        const names = [
            { name: "Arden Vale", type: null, subType: null, line: 7, column: 4 },
            { name: "Ravenmoor", type: "place", subType: "settlement", line: 9, column: 1 },
            { name: "Ravenmoor", type: "place", subType: "settlement", line: 10, column: 1 },
            { name: "Aldric Venn", type: "being", subType: null, line: 11, column: 1 },
            { name: "Unwritten", type: null, subType: null, line: 12, column: 1 },
        ];
        for (const occurrence of names)
            expect(raw.split("\n")[occurrence.line - 1].slice(occurrence.column - 1)).toMatch(
                new RegExp(`^\\[${occurrence.name}\\]`),
            );
        const { groups, firstUse } = collectUnwrittenNames({
            records: [{ ...record, names }],
            catalog,
        });
        expect(groups).toEqual([
            {
                type: null,
                subType: null,
                names: [
                    {
                        name: "Unwritten",
                        uses: [
                            { owner: "test-note-doc-reader", file: "2.md", line: 12, column: 1 },
                        ],
                    },
                ],
            },
            {
                type: "being",
                subType: null,
                names: [
                    {
                        name: "Aldric Venn",
                        uses: [
                            { owner: "test-note-doc-reader", file: "2.md", line: 11, column: 1 },
                        ],
                    },
                ],
            },
            {
                type: "place",
                subType: "settlement",
                names: [
                    {
                        name: "Ravenmoor",
                        uses: [9, 10].map((line) => ({
                            owner: "test-note-doc-reader",
                            file: "2.md",
                            line,
                            column: 1,
                        })),
                    },
                ],
            },
        ]);
        expect(firstUse).toEqual({
            owner: "test-note-doc-reader",
            file: "2.md",
            line: 9,
            column: 1,
        });
        expect(
            fs
                .readFileSync(path.join(source.config.paths.content, firstUse.file), "utf8")
                .split("\n")
                [firstUse.line - 1].slice(firstUse.column - 1),
        ).toMatch(/^\[Ravenmoor\]/);
    });

    it("orders groups and uses deterministically, preserving spellings and nullable owners", () => {
        const source = fixture();
        const catalog = createNameCatalog(source);
        const records = [
            {
                package: "test",
                type: "doc",
                shortcode: "later",
                address: { canonical: readCanonicalKey("test-sohl-doc-later") },
                file: { path: "z.md" },
                names: [
                    {
                        name: "Rene\u0301e’s Hall",
                        type: "place",
                        subType: null,
                        line: 3,
                        column: 8,
                    },
                    { name: "Arden", type: "place", subType: null, line: 1, column: 1 },
                ],
            },
            {
                file: { path: "a.md" },
                names: [
                    { name: "Renée's  Hall", type: "place", subType: null, line: 7, column: 4 },
                    { name: "Separate", type: "place", subType: "settlement", line: 2, column: 1 },
                ],
            },
        ];
        const first = collectUnwrittenNames({ records, catalog });
        expect(collectUnwrittenNames({ records: [...records].reverse(), catalog })).toEqual(first);
        expect(first.groups[0].names).toEqual([
            {
                name: "Renée's Hall",
                uses: [
                    { owner: null, file: "a.md", line: 7, column: 4 },
                    { owner: "test-note-doc-later", file: "z.md", line: 3, column: 8 },
                ],
            },
        ]);
        expect(first.firstUse).toEqual({ owner: null, file: "a.md", line: 2, column: 1 });
        expect(records[0].names[0].name).toBe("Rene\u0301e’s Hall");
    });

    it("treats ambiguous matches as known, skips non-note records and invents no first site", () => {
        const source = fixture([
            { type: "place", shortcode: "other", name: { full: "Arden Vale", en: ["Arden"] } },
        ]);
        const catalog = createNameCatalog(source);
        const names = [{ name: "Arden", type: null, subType: null, line: 1, column: 1 }];
        expect(collectUnwrittenNames({ records: [{ names }], catalog })).toEqual({
            groups: [],
            firstUse: undefined,
        });
        expect(collectUnwrittenNames({ records: [], catalog })).toEqual({
            groups: [],
            firstUse: undefined,
        });
        expect(
            collectUnwrittenNames({
                records: [
                    { asset: {}, names: [{ ...names[0], name: "Asset prose" }] },
                    {
                        documents: "test-note-doc-reader",
                        names: [{ ...names[0], name: "Duplicate doc" }],
                    },
                ],
                catalog,
            }),
        ).toEqual({ groups: [], firstUse: undefined });
    });

    it("reads only captured values, preserves frozen inputs and isolates catalog lifetimes", () => {
        const source = fixture();
        const records = frozen([
            ...source.records,
            {
                file: { path: "Absent.md" },
                names: [{ name: "Unwritten", type: null, subType: null, line: 6, column: 3 }],
            },
        ]);
        const before = encodeAddresses(records);
        const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
            throw new Error("Unexpected source read");
        });
        const catalog = createNameCatalog({ records, index: source.index });
        expect(collectUnwrittenNames({ records, catalog }).firstUse).toEqual({
            owner: null,
            file: "Absent.md",
            line: 6,
            column: 3,
        });
        expect(catalog.resolve("place-arden")).toMatchObject({ key: "test-note-place-arden" });
        expect(read).not.toHaveBeenCalled();
        read.mockRestore();
        expect(encodeAddresses(records)).toEqual(before);
        const other = fixture([
            { type: "lore", shortcode: "written", name: { full: "Unwritten" } },
        ]);
        expect(createNameCatalog(other).recognize("Unwritten")).toMatchObject({
            key: "test-note-lore-written",
        });
        expect(catalog.recognize("Unwritten")).toBeUndefined();
        expect(collectUnwrittenNames({ records, catalog }).groups).toHaveLength(1);
    });
});

function marker(value?: string, classes = "name wide") {
    return {
        visible: "Ravenmoor",
        line: 7,
        column: 4,
        attrs: [["class", classes], ...(value === undefined ? [] : [["data-type", value]])],
        attributePositions: {
            "data-type": {
                key: { start: 30, end: 39, line: 7, column: 20 },
                value: { start: 41, end: 41 + (value?.length ?? 0), line: 7, column: 31 },
            },
        },
    };
}

describe("supplied marked-name kinds", () => {
    it("uses every actual vocabulary declaration, including open and absent subtypes", () => {
        for (const [type, entry] of Object.entries(NOTE_VOCABULARY)) {
            expect(analyzeNameSpans([marker(type)]).names).toEqual([
                { name: "Ravenmoor", type, subType: null, ref: null, line: 7, column: 4 },
            ]);
            const subtype = Array.isArray(entry.subTypes) ? entry.subTypes[0] : "authoredkind";
            const result = analyzeNameSpans([marker(`${type}/${subtype}`)], { file: "Kinds.md" });
            if (entry.subTypes === null || Array.isArray(entry.subTypes)) {
                expect(result.findings).toEqual([]);
                expect(result.names[0]).toMatchObject({ type, subType: subtype });
            } else {
                expect(result.names).toEqual([]);
                expect(result.findings).toMatchObject([
                    { file: "Kinds.md", line: 7, column: 20, severity: "error" },
                ]);
            }
        }
    });

    it("refuses unknown, malformed and wrong-parent values at the attribute key", () => {
        const closed = Object.entries(NOTE_VOCABULARY).find(([, entry]) =>
            Array.isArray(entry.subTypes),
        );
        const [type, entry] = closed;
        let unknown = "notdeclared";
        while (entry.subTypes.includes(unknown) || Object.hasOwn(NOTE_VOCABULARY, unknown))
            unknown += "x";
        for (const value of [
            "",
            unknown,
            ` ${type}`,
            `${type}/`,
            `/${type}`,
            `${type}/one/two`,
            `${type}/${unknown}`,
            `${type}/not-valid`,
            `${type.toUpperCase()}`,
            "vehicle/not-valid",
            "armorlocation/with space",
        ]) {
            const result = analyzeNameSpans([marker(value)], { file: "Kinds.md" });
            expect(result.names).toEqual([]);
            expect(result.findings).toHaveLength(1);
            expect(result.findings[0]).toMatchObject({
                file: "Kinds.md",
                line: 7,
                column: 20,
                severity: "error",
            });
            expect(result.findings[0].message).toContain("data-type");
            expect(result.findings[0].message).toContain(JSON.stringify(value));
        }
    });

    it("keeps omitted kinds and ordinary attributes distinct without inventing positions", () => {
        const plain = marker();
        const other = marker("not-a-type", "named wide");
        const before = structuredClone([plain, other]);
        expect(analyzeNameSpans(frozen([plain, other]))).toEqual({
            names: [
                { name: "Ravenmoor", type: null, subType: null, ref: null, line: 7, column: 4 },
            ],
            findings: [],
        });
        expect([plain, other]).toEqual(before);
        const unknownPosition = { ...marker("wrong"), attributePositions: {} };
        const finding = analyzeNameSpans([unknownPosition], { file: "Unknown.md" }).findings[0];
        expect(finding).not.toHaveProperty("line");
        expect(finding).not.toHaveProperty("column");
    });

    it("uses injected declarations for bare types and their actual subtype policy", () => {
        expect(analyzeNameSpans([marker("rune")], { types: new Set(["rune"]) }).findings).toEqual(
            [],
        );
        expect(
            analyzeNameSpans([marker("rune/ward")], { types: new Set(["rune"]) }).findings,
        ).toHaveLength(1);
        expect(
            analyzeNameSpans([marker("rune/ward")], {
                vocabulary: { rune: { subTypes: ["ward"] } },
            }).names[0],
        ).toMatchObject({ type: "rune", subType: "ward" });
        expect(
            analyzeNameSpans([marker("rune/spell")], {
                vocabulary: { rune: { subTypes: ["ward"] } },
            }).findings,
        ).toHaveLength(1);
    });
});

describe("one package names report", () => {
    it("accepts untyped and matching parent/subtype refinements", () => {
        const source = fixture();
        const catalog = createNameCatalog(source);
        const records = [
            {
                file: { path: "Refinements.md" },
                names: [
                    { name: "Ravenmoor", type: null, subType: null, line: 1, column: 1 },
                    { name: "Ravenmoor", type: "place", subType: null, line: 2, column: 1 },
                    { name: "Ravenmoor", type: "place", subType: "settlement", line: 3, column: 1 },
                ],
            },
        ];
        const report = createNamesReport({ package: "test", records, catalog });
        expect(report.package).toBe("test");
        expect(report.conflicts).toEqual([]);
        expect(report.unwritten).toHaveLength(3);
        expect(namesReportFinding(report).message).toContain("1 unwritten name");
    });

    it("groups incompatible supplied facts while excluding untyped uses", () => {
        const source = fixture();
        const catalog = createNameCatalog(source);
        const records = [
            {
                file: { path: "Kinds.md" },
                names: [
                    { name: "Ravenmoor", type: null, subType: null, line: 1, column: 1 },
                    { name: "Ravenmoor", type: "place", subType: null, line: 2, column: 1 },
                    { name: "Ravenmoor", type: "place", subType: "region", line: 3, column: 1 },
                    { name: "Ravenmoor", type: "place", subType: "settlement", line: 4, column: 1 },
                    { name: "Ravenmoor", type: "being", subType: null, line: 5, column: 1 },
                ],
            },
        ];
        const report = createNamesReport({ package: "test", records, catalog });
        expect(report.conflicts).toEqual([
            {
                name: "Ravenmoor",
                kinds: [
                    {
                        type: "being",
                        subType: null,
                        uses: [{ owner: null, file: "Kinds.md", line: 5, column: 1 }],
                    },
                    {
                        type: "place",
                        subType: null,
                        uses: [{ owner: null, file: "Kinds.md", line: 2, column: 1 }],
                    },
                    {
                        type: "place",
                        subType: "region",
                        uses: [{ owner: null, file: "Kinds.md", line: 3, column: 1 }],
                    },
                    {
                        type: "place",
                        subType: "settlement",
                        uses: [{ owner: null, file: "Kinds.md", line: 4, column: 1 }],
                    },
                ],
            },
        ]);
        const onlySubtypes = records.map((record) => ({
            ...record,
            names: record.names.slice(2, 4),
        }));
        expect(
            createNamesReport({ package: "test", records: onlySubtypes, catalog }).conflicts,
        ).toHaveLength(1);
    });

    it("checks equal visible text for conflicts whether or not a note of that kind matches", () => {
        const source = fixture();
        const catalog = createNameCatalog(source);
        const names = [
            { name: "Arden Vale", type: "place", subType: null, line: 2, column: 1 },
            { name: "Arden", type: "place", subType: null, line: 3, column: 1 },
        ];
        expect(createNamesReport({ package: "test", records: [{ names }], catalog })).toEqual({
            package: "test",
            unwritten: [],
            conflicts: [],
        });
        const report = createNamesReport({
            package: "test",
            records: [
                {
                    file: { path: "Known.md" },
                    names: [...names, { ...names[0], type: "being", line: 4 }],
                },
            ],
            catalog,
        });
        expect(report.unwritten).toEqual([
            {
                type: "being",
                subType: null,
                names: [
                    {
                        name: "Arden Vale",
                        uses: [{ owner: null, file: "Known.md", line: 4, column: 1 }],
                    },
                ],
            },
        ]);
        expect(report.conflicts.map((conflict) => conflict.name)).toEqual(["Arden Vale"]);
        expect(namesReportFinding(report)).toMatchObject({
            file: "Known.md",
            line: 2,
            column: 1,
            severity: "warning",
        });
    });

    it("emits one readable advisory anchored at the first reported use with every real locator", () => {
        const source = fixture();
        const record = source.records.find((entry) => entry.shortcode === "reader");
        const catalog = createNameCatalog(source);
        const records = [
            {
                ...record,
                names: [
                    { name: "Arden Vale", type: "place", subType: null, line: 1, column: 1 },
                    { name: "Ravenmoor", type: "place", subType: "settlement", line: 8, column: 4 },
                    {
                        name: "Ravenmoor",
                        type: "place",
                        subType: "settlement",
                        line: 10,
                        column: 2,
                    },
                    { name: "Aldric Venn", type: "being", subType: null, line: 12, column: 1 },
                ],
            },
        ];
        const report = createNamesReport({ package: "test", records: frozen(records), catalog });
        const finding = namesReportFinding(report, { contentBase: source.config.paths.content });
        expect(finding).toMatchObject({
            file: path.join(source.config.paths.content, "2.md"),
            line: 8,
            column: 4,
            severity: "warning",
        });
        const rendered = formatDiagnostic(finding);
        expect(rendered).toContain(":8:4: warning: names: 2 unwritten names");
        expect(rendered).toContain("\n  Unwritten being:");
        expect(rendered).toContain("\n  Unwritten place/settlement:");
        for (const locator of ["2.md:8:4", "2.md:10:2", "2.md:12:1"])
            expect(rendered).toContain(locator);
        expect(rendered).not.toContain("Arden Vale");
        expect(rendered.split("warning:")).toHaveLength(2);
        expect(
            createNamesReport({ package: "test", records: [...records].reverse(), catalog }),
        ).toEqual(report);
        expect(
            namesReportFinding(createNamesReport({ package: "test", records: [], catalog })),
        ).toBeUndefined();
    });
});

const refSpans = (raw: string) => scanSpans(raw).spans;
const at = (raw: string, literal: string) => {
    const offset = raw.indexOf(literal);
    expect(offset).toBeGreaterThanOrEqual(0);
    const before = raw.slice(0, offset);
    return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
};

describe("ref on a name span", () => {
    it("records the ref as written, an address or a page-local key, and null when absent", () => {
        const raw = [
            "[Tom Rodriguez]{.name ref=being-tomr}",
            '[Tom]{.name ref="sohl-note-being-tomr"}',
            '[Jane]{.name ref="#jane"}',
            "[Nobody]{.name}",
        ].join("\n\n");
        expect(analyzeNameSpans(refSpans(raw)).names.map(({ name, ref }) => [name, ref])).toEqual([
            ["Tom Rodriguez", "being-tomr"],
            ["Tom", "sohl-note-being-tomr"],
            ["Jane", "#jane"],
            ["Nobody", null],
        ]);
    });

    it("reads a ref in prose, in a nested language run, in a div and in verse", () => {
        const raw = [
            "[Tom]{.name ref=being-tomr}",
            "",
            "[the [Tom]{.name ref=being-tomr} said]{lang=en}",
            "",
            "::: {.border}",
            "[Tom]{.name ref=being-tomr}",
            ":::",
            "",
            "```verse",
            "[Tom]{.name ref=being-tomr} walks",
            "```",
        ].join("\n");
        const names = analyzeNameSpans(refSpans(raw)).names;
        expect(names.map((name) => name.ref)).toEqual(Array(4).fill("being-tomr"));
        expect(nameRefFindings(refSpans(raw))).toEqual([]);
    });

    it("raises nothing for a page-local key, which resolves to no note", () => {
        const source = fixture();
        const check = createNameRefChecker({ catalog: createNameCatalog(source) });
        expect(
            check({
                file: "Jane.md",
                raw: '[Jane Doe]{.name ref="#jane"} then [Jane]{.name ref=#jane}',
            }),
        ).toEqual([]);
        expect(nameRefFindings(refSpans("[Jane]{.name ref=#jane}"))).toEqual([]);
    });

    it("refuses a malformed page-local key at its value", () => {
        for (const value of ["#", "#-x", "#a b"]) {
            const raw = `[Jane]{.name ref="${value}"}`;
            expect(nameRefFindings(refSpans(raw), { file: "A.md" })).toMatchObject([
                { file: "A.md", severity: "error", ...at(raw, value) },
            ]);
        }
    });

    it("resolves an own-package address, its note form and a dependency's address", () => {
        const source = fixture();
        const check = createNameRefChecker({ catalog: createNameCatalog(source) });
        for (const ref of [
            "place-arden",
            "test-note-place-arden",
            "pub-sohl-skill-craft",
            "pub-note-skill-craft",
        ])
            expect(check({ file: "A.md", raw: `[Anything]{.name ref=${ref}}` }), ref).toEqual([]);
    });

    it("refuses an address that matches nothing at the attribute's value", () => {
        const source = fixture();
        const check = createNameRefChecker({ catalog: createNameCatalog(source) });
        const raw =
            "Intro.\n\n[Tom]{.name ref=being-tomr} and [Ghost]{.name ref=pub-sohl-skill-ghost}";
        const found = check({ file: "A.md", raw });
        expect(found).toHaveLength(2);
        expect(found[0]).toMatchObject({
            file: "A.md",
            severity: "error",
            ...at(raw, "being-tomr"),
        });
        expect(found[0].message).toContain('"being-tomr"');
        expect(found[1]).toMatchObject(at(raw, "pub-sohl-skill-ghost"));
    });

    it("refuses ref beside data-type at data-type", () => {
        const raw = '[Tom]{.name ref=being-tomr data-type="being"}';
        expect(nameRefFindings(refSpans(raw), { file: "A.md" })).toMatchObject([
            { file: "A.md", severity: "error", ...at(raw, "data-type") },
        ]);
    });

    it("refuses ref on a wikilink", () => {
        expect(
            parseWikilink("place-arden|Arden", "[[place-arden|Arden]]{ref=being-tomr}").attributes
                ?.problems,
        ).toEqual(["a wikilink never takes ref; its address is its ref"]);
    });

    it("refuses ref without .name at ref", () => {
        for (const raw of ["[Tom]{.wide ref=being-tomr}", "[Tom]{ref=being-tomr}"]) {
            const found = nameRefFindings(refSpans(raw), { file: "A.md" });
            expect(found, raw).toMatchObject([
                { file: "A.md", severity: "error", ...at(raw, "ref") },
            ]);
            expect(found[0].message).toContain("ref=");
        }
    });
});
