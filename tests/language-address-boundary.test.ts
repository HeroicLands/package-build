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
import { afterAll, describe, expect, it } from "vitest";
import { parseAddress, renderAddress } from "../engine/address.mjs";
import {
    decodeIndexAddresses,
    decodeNoteAddresses,
    noteAddressContext,
} from "../engine/note-addresses.mjs";
import { encodeAddresses, publishAddresses } from "../engine/address-values.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { collectAnchors } from "../engine/anchors.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { isGmNote } from "../engine/note-vocabulary.mjs";
import { parseMarkdownFile, renderFoundryMarkdown } from "../engine/helpers.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { NOTE_SYSTEM, SYSTEM_SEGMENTS } from "../engine/systems.mjs";
import { DICTIONARY_LANGUAGES } from "./helpers/dictionary-languages";

const TREE = fileURLToPath(new URL("./fixtures/dictionary/tree", import.meta.url));
const LANGUAGE = "demo-note-skill-provnzlng";
const CULTURE = "demo-note-lore-provnzclt";
const SHORT = "skill-provnzlng";
const ITEM = "demo-sohl-skill-provnzlng";
const nativeSystems = [...SYSTEM_SEGMENTS].filter((system) => system !== NOTE_SYSTEM);
const parserContext = {
    package: "demo",
    types: new Set(["skill"]),
    packages: new Set(["demo", "foreign"]),
};
const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(copy = false) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "language-address-")));
    roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo","version":"1.0.0"}\n');
    const config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "languageaddress0" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            languages: DICTIONARY_LANGUAGES,
        },
        path.join(root, "package-build.config.yaml"),
    );
    fs.mkdirSync(config.paths.content, { recursive: true });
    if (copy) fs.cpSync(TREE, config.paths.content, { recursive: true });
    const write = (name: string, raw: string) => {
        const file = path.join(config.paths.content, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, raw);
        return file;
    };
    const read = () => {
        const problems: any[] = [];
        const parsed = new Map();
        const records = collectContentIndex(config.paths.content, {
            contentPackage: "demo",
            skipDirectories: [],
            addressContext: noteAddressContext(config),
            languages: config.languages,
            problems,
            parsed,
        });
        return { records, problems, parsed };
    };
    return { root, config, write, read };
}

const note = (type: string, subType: string, lines: string[]) =>
    [
        "---",
        "type: " + type,
        ...(subType ? ["subType: " + subType] : []),
        "shortcode: refused",
        "name: { full: Language field fixture }",
        "data:",
        ...lines,
        "---",
        "",
        "Authored prose.",
        "",
    ].join("\n");

/** The location of an actual value in the exact authored UTF-16 string. */
function at(raw: string, value: string, from = 0) {
    const offset = raw.indexOf(value, from);
    expect(offset).toBeGreaterThanOrEqual(0);
    const preceding = raw.slice(0, offset);
    return {
        line: preceding.split("\n").length,
        column: offset - preceding.lastIndexOf("\n"),
        next: offset + value.length,
    };
}

const selectors = [
    { type: "lore", subType: "culture" },
    { type: "affiliation", subType: "order" },
];

describe("language-note Address fields", () => {
    it.each(selectors)(
        "refuses the authored Item value in a glossary entry of $type/$subType",
        (selector) => {
            const source = fixture(true);
            const raw = note(selector.type, selector.subType, [
                "  lang: provnz",
                "  glossary:",
                "    - { name: solmère, language: " + ITEM + " }",
            ]);
            const file = source.write("Refused.md", raw);
            const { records, problems } = source.read();
            const expected = at(raw, ITEM);
            expect(problems).toHaveLength(1);
            expect(problems[0]).toMatchObject({
                file,
                line: expected.line,
                column: expected.column,
                severity: "error",
            });
            expect(problems[0].message).toContain("names a language note");
            expect(problems[0].message).toContain(LANGUAGE);
            expect(records.some((record) => record.shortcode === "refused")).toBe(false);
            expect(() =>
                parseMarkdownFile(file, { addressContext: noteAddressContext(source.config) }),
            ).toThrow(/language note/);
        },
    );

    it("reports every non-NOTE system at its own CRLF/UTF-16 value without rewriting input", () => {
        const source = fixture(true);
        const values = nativeSystems.map((system) => "demo-" + system + "-skill-provnzlng");
        const raw = note("lore", "culture", [
            "  lang: provnz",
            "  glossary:",
            ...values.map(
                (value) => "    - { name: 😀, definition: a word, language: " + value + " }",
            ),
        ]).replaceAll("\n", "\r\n");
        const file = source.write("Refused.md", raw);
        const { records, problems } = source.read();
        const written = values;
        let from = 0;
        expect(problems).toHaveLength(written.length);
        for (const [index, value] of written.entries()) {
            const expected = at(raw, value, from);
            from = expected.next;
            expect(problems[index]).toMatchObject({
                file,
                line: expected.line,
                column: expected.column,
                severity: "error",
            });
            expect(problems[index].message).toContain(LANGUAGE);
        }
        expect(records.some((record) => record.shortcode === "refused")).toBe(false);
        expect(fs.readFileSync(file, "utf8")).toBe(raw);
    });

    it("uses NOTE defaults for accepted short forms even in a native caller context", () => {
        const context = { ...parserContext, system: "sohl" };
        for (const type of ["lore", "affiliation"]) {
            const make = (language: string) => ({
                type,
                data: { glossary: [{ name: "solmère", language }] },
                sohl: { items: [{ model: ITEM }] },
            });
            const short = decodeNoteAddresses(make(SHORT), context);
            const explicit = decodeNoteAddresses(make(LANGUAGE), context);
            expect(short).toEqual(explicit);
            expect(encodeAddresses(short).data.glossary[0].language).toBe(LANGUAGE);
            expect(encodeAddresses(short).sohl.items[0].model).toBe(ITEM);
        }
        expect(renderAddress(parseAddress(ITEM, context))).toBe(ITEM);
    });

    it("refuses direct typed native language identities and preserves each refused value", () => {
        const typed = parseAddress(ITEM, parserContext);
        expect(renderAddress(typed)).toBe(ITEM);
        const fm = {
            type: "affiliation",
            data: { glossary: [{ name: "solmère", language: typed }] },
        };
        let refusal: any;
        try {
            decodeNoteAddresses(fm, { package: "demo" });
        } catch (error) {
            refusal = error;
        }
        expect(refusal?.findings?.map((finding: any) => finding.keyPath)).toEqual([
            ["data", "glossary", 0, "language"],
        ]);
        expect(fm.data.glossary[0].language).toBe(typed);
    });

    it("refuses published dependency values with their record, field and cached line", () => {
        const source = fixture();
        const target = parseAddress("foreign-sohl-skill-provnzlng", parserContext);
        expect(renderAddress(target)).toBe("foreign-sohl-skill-provnzlng");
        const cached = publishAddresses({
            package: "foreign",
            type: "affiliation",
            shortcode: "order",
            data: { glossary: [{ name: "solmère", language: target }] },
        });
        const file = path.join(source.root, "foreign-metadata.jsonl");
        let refusal: any;
        try {
            decodeIndexAddresses(
                cached,
                { package: "demo" },
                { package: "foreign", file, line: 7 },
            );
        } catch (error) {
            refusal = error;
        }
        expect(refusal?.located).toBe(true);
        expect(refusal?.message).toContain(file + ":7:");
        expect(refusal?.message).toContain("affiliation order");
        expect(refusal?.message).toContain("field data.glossary");
        expect(refusal?.message).toContain("foreign-note-skill-provnzlng");
        expect(refusal?.cause?.findings?.map((finding: any) => finding.keyPath)).toEqual([
            ["data", "glossary", 0, "language"],
        ]);
        expect(encodeAddresses(cached).data.glossary[0].language).toBe(
            "foreign-sohl-skill-provnzlng",
        );
    });

    it("retains unrelated lenient failures and native document positions", () => {
        for (const language of ["not an Address", "demo-note-lore-provnzclt", 42]) {
            const fm = { type: "affiliation", data: { glossary: [{ name: "term", language }] } };
            expect(() => decodeNoteAddresses(fm, { package: "demo" })).not.toThrow();
            expect(fm.data.glossary[0].language).toBe(language);
        }
        const native = decodeNoteAddresses(
            {
                type: "mysticalability",
                data: { assocSkill: ITEM },
                sohl: { items: [{ model: ITEM }] },
            },
            { package: "demo", system: "note" },
        );
        expect(encodeAddresses(native).data.assocSkill).toBe(ITEM);
        expect(encodeAddresses(native).sohl.items[0].model).toBe(ITEM);
        const parent = decodeNoteAddresses(
            { type: "skill", data: { parentSkill: ITEM } },
            { package: "demo", system: "note" },
        );
        expect(encodeAddresses(parent).data.parentSkill).toBe(ITEM);
    });

    it("keeps physical short/NOTE records, rows, automatic and custom SQL output equal", async () => {
        const snapshots: any[] = [];
        for (const language of [SHORT, LANGUAGE]) {
            const source = fixture(true);
            const cultureFile = path.join(source.config.paths.content, "Lore/Provenzia.md");
            const culture = fs
                .readFileSync(cultureFile, "utf8")
                .replace(
                    "pronunciation: sol-MEH-reh }",
                    "pronunciation: sol-MEH-reh, language: " + language + " }",
                );
            fs.writeFileSync(cultureFile, culture);
            const orderFile = path.join(source.config.paths.content, "Affiliations/Duchy.md");
            fs.writeFileSync(
                orderFile,
                fs
                    .readFileSync(orderFile, "utf8")
                    .replace(
                        "Carves and serves at the duke's table. }",
                        "Carves and serves at the duke's table., language: " + language + " }",
                    ),
            );
            const fence = String.fromCharCode(96).repeat(3);
            const sqlBody = [
                fence + "sql {layout=dictionary key=false}",
                "SELECT * FROM dictionary WHERE language = '" + LANGUAGE + "'",
                fence,
                "",
                fence + "sql {layout=glossary key=false}",
                "SELECT * FROM terms WHERE owner = '" +
                    CULTURE +
                    "' AND list_contains(origins, 'glossary')",
                fence,
            ].join("\n");
            const sqlFile = source.write(
                "Custom.md",
                note("lore", "literature", ["  lang: provnz"])
                    .replace("shortcode: refused", "shortcode: custom")
                    .replace("Authored prose.", sqlBody),
            );
            const { records, problems, parsed } = source.read();
            expect(problems).toEqual([]);
            const encoded = encodeAddresses(records);
            const audiences: any[] = [];
            for (const audience of ["public", "all"]) {
                const visible = encoded.filter(
                    (record: any) => audience !== "public" || !isGmNote(record),
                );
                const rows = dictionaryAndTermRows(visible, encoded);
                const term: any = rows.terms.find(
                    (row: any) => row.owner === CULTURE && row.name === "solmère",
                );
                expect(term.language).toBe(LANGUAGE);
                expect(term.language_tag).toBe("Prov.");
                expect(term.senses.map((sense: any) => sense.text)).toEqual([
                    "longing; the ache for a time that is gone",
                ]);
                expect(term.word).toMatch(/^demo-note-skill-provnzlng#word-/);
                const prepared: any = await prepareTreeSqlTables(source.config.paths.content, {
                    config: source.config,
                    skipDirectories: [],
                    records,
                    parsed,
                    audience,
                    foreignIndex: new Map(),
                });
                const expand = (file: string) => {
                    const expanded = expandContentTables(parsed.get(file).body, {
                        sqlTables: prepared?.get(file),
                        pageLists: prepared?.pageLists?.get(file),
                    });
                    expect(expanded.errors).toEqual([]);
                    return expanded.markdown;
                };
                const automatic = expand(cultureFile);
                const custom = expand(sqlFile);
                const dictionaryFile = path.join(
                    source.config.paths.content,
                    "Skills/Provenzal.md",
                );
                const dictionary = expand(dictionaryFile);
                const anchor = term.word.split("#")[1];
                expect(
                    collectAnchors(dictionary).filter((entry) => entry.slug === anchor),
                ).toHaveLength(1);
                expect(renderFoundryMarkdown(dictionary)).toMatch(
                    new RegExp('<h6\\b[^>]*id="' + anchor + '"[^>]*>'),
                );
                for (const markdown of [automatic, custom]) {
                    expect(markdown).toContain("[[" + term.word + "|solmère]]");
                    expect(markdown).toContain("Longing; the ache for a time that is gone.");
                    expect(markdown).toContain("(_Duchy of Aubrac_)");
                    expect(markdown).toContain("(_Kingdom of Provenzia_)");
                }
                expect(automatic).not.toContain("(_Provenzia_)");
                expect(custom).toContain("(_Provenzia_)");
                expect(automatic).toContain(
                    "[[demo-note-lore-lastshrine|The Song of the Last Shrine]]",
                );
                expect(automatic).not.toContain("The Secret Song");
                expect(custom.includes("The Secret Song")).toBe(audience === "all");
                audiences.push({ rows, automatic, custom, dictionary });
            }
            snapshots.push({ records: encoded, audiences });
        }
        expect(snapshots[1]).toEqual(snapshots[0]);
    }, 60_000);
});
