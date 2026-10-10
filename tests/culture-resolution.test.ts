// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    authoredFrontmatter,
    collectContentIndex,
    emitContentIndex,
    indexRecordsFor,
    indexRecordsForNote,
    resolveCultures,
} from "../engine/content-index.mjs";
import { formatDiagnostic, formatLocator } from "../engine/diagnostics.mjs";
import { readCanonicalKey } from "../engine/address.mjs";
import { encodeAddresses } from "../engine/note-addresses.mjs";
import { loadForeignIndexes, metadataFileName } from "../engine/metadata-index.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";

/**
 * How each note resolves its culture, by the rules the content index applies:
 * its own `data.culture`; else, for a place or an affiliation, the resolved
 * cultures of its `data.parents`; else, for a polity, those of its seat and the
 * places it governs, pooled; else nothing. A culture lore note is its own
 * culture. Every type the vocabulary does not give a culture resolves to
 * nothing.
 */
const PKG = "thalorna";
const VEDYARI = `${PKG}-note-lore-vedyari`;
const OSKET = `${PKG}-note-lore-osket`;

let tmp: string;
let content: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "culture-resolution-"));
    content = path.join(tmp, "content");
    fs.mkdirSync(content);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a note whose frontmatter is the given lines, with a one-line body. */
function note(rel: string, ...lines: string[]): string {
    const full = path.join(content, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `---\n${lines.join("\n")}\n---\n\nBody.\n`);
    return full;
}

/** The two culture notes every case names. */
function cultures(): void {
    note("Lore/Vedyari.md", "type: lore", "subType: culture", "shortcode: vedyari");
    note("Lore/Osket.md", "type: lore", "subType: culture", "shortcode: osket");
}

/** A place, its `data:` written as a flow mapping on one line, as thalorna writes it. */
function place(shortcode: string, data = "{}"): string {
    return note(
        `Places/${shortcode}.md`,
        "type: place",
        `shortcode: ${shortcode}`,
        `data: ${data}`,
    );
}

/** An affiliation, its `data:` written as a flow mapping. */
function affiliation(shortcode: string, subType: string, data = "{}"): string {
    return note(
        `Affiliations/${shortcode}.md`,
        "type: affiliation",
        `subType: ${subType}`,
        `shortcode: ${shortcode}`,
        `data: ${data}`,
    );
}

/** Collect the tree as a reader does, findings into `problems`. */
function collect(problems: object[] = [], extra: Record<string, unknown> = {}) {
    return collectContentIndex(content, {
        contentPackage: PKG,
        skipDirectories: [],
        problems,
        ...extra,
    });
}

/** The resolved culture of the note record with this type and shortcode, as a string. */
function cultureOf(records: any[], type: string, shortcode: string): string | undefined {
    const record = records.find(
        (r) => r.type === type && r.shortcode === shortcode && !r.documents,
    );
    if (!record) throw new Error(`no ${type} record for ${shortcode}`);
    return encodeAddresses(record.data?.culture);
}

/** Whether the note record carries a `culture` key at all. */
function hasCultureKey(records: any[], type: string, shortcode: string): boolean {
    const record = records.find(
        (r) => r.type === type && r.shortcode === shortcode && !r.documents,
    );
    return Object.hasOwn(record?.data ?? {}, "culture");
}

/** The line and column of `key` in the file, 1-based, the first occurrence after the fence. */
function located(file: string, key: string) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 1; i < lines.length; i++) {
        const column = lines[i].search(new RegExp(`\\b${key}:`));
        if (column >= 0) return { line: i + 1, column: column + 1 };
    }
    throw new Error(`no ${key} in ${file}`);
}

const TYPES_WITH_CULTURE = Object.entries(NOTE_VOCABULARY)
    .filter(([, vocabulary]: [string, any]) =>
        (vocabulary.data ?? []).some((field: any) => field.name === "culture"),
    )
    .map(([type]) => type)
    .sort();
const TYPES_WITHOUT_CULTURE = Object.keys(NOTE_VOCABULARY)
    .filter((type) => !TYPES_WITH_CULTURE.includes(type))
    .sort();

describe("the resolution order, type by type", () => {
    /**
     * One row per rule: own → parents → polity places → none. Each row builds a
     * small tree and names the note whose culture it asserts, and what that
     * culture is (`undefined` for none).
     */
    const ROWS: Array<{
        name: string;
        type: string;
        build: () => void;
        shortcode: string;
        expected: string | undefined;
    }> = [
        {
            name: "place: its own value",
            type: "place",
            build: () => place("tower", "{culture: lore-osket, parents: [realm]}"),
            shortcode: "tower",
            expected: OSKET,
        },
        {
            name: "place: its own value over its parents'",
            type: "place",
            build: () => {
                place("realm", "{culture: lore-vedyari}");
                place("tower", "{culture: lore-osket, parents: [realm]}");
            },
            shortcode: "tower",
            expected: OSKET,
        },
        {
            name: "place: its parents' value",
            type: "place",
            build: () => {
                place("realm", "{culture: lore-vedyari}");
                place("tower", "{parents: [realm]}");
            },
            shortcode: "tower",
            expected: VEDYARI,
        },
        {
            name: "place: parents that agree",
            type: "place",
            build: () => {
                place("north", "{culture: lore-vedyari}");
                place("south", "{culture: lore-vedyari}");
                place("pass", "{parents: [north, south]}");
            },
            shortcode: "pass",
            expected: VEDYARI,
        },
        {
            name: "place: a parent with none is ignored",
            type: "place",
            build: () => {
                place("north", "{culture: lore-vedyari}");
                place("wild", "{}");
                place("pass", "{parents: [wild, north]}");
            },
            shortcode: "pass",
            expected: VEDYARI,
        },
        {
            name: "place: none",
            type: "place",
            build: () => place("tower", "{}"),
            shortcode: "tower",
            expected: undefined,
        },
        {
            name: "affiliation: its own value",
            type: "affiliation",
            build: () => affiliation("guild", "guild", "{culture: lore-osket}"),
            shortcode: "guild",
            expected: OSKET,
        },
        {
            name: "affiliation: its parents' value",
            type: "affiliation",
            build: () => {
                affiliation("crown", "polity", "{culture: lore-vedyari}");
                affiliation("guild", "guild", "{parents: [crown]}");
            },
            shortcode: "guild",
            expected: VEDYARI,
        },
        {
            name: "affiliation: a guild does not take its seat's value",
            type: "affiliation",
            build: () => {
                place("city", "{culture: lore-vedyari}");
                affiliation("guild", "guild", "{seat: city}");
            },
            shortcode: "guild",
            expected: undefined,
        },
        {
            name: "affiliation: a polity's parents come before its places",
            type: "affiliation",
            build: () => {
                affiliation("empire", "polity", "{culture: lore-vedyari}");
                place("city", "{culture: lore-osket, government: affiliation-duchy}");
                affiliation("duchy", "polity", "{parents: [empire], seat: city}");
            },
            shortcode: "duchy",
            expected: VEDYARI,
        },
        {
            name: "affiliation: a polity with only a seat takes the seat's value",
            type: "affiliation",
            build: () => {
                place("city", "{culture: lore-osket}");
                affiliation("duchy", "polity", "{seat: city}");
            },
            shortcode: "duchy",
            expected: OSKET,
        },
        {
            name: "affiliation: a polity with only governed places takes theirs",
            type: "affiliation",
            build: () => {
                place("vale", "{culture: lore-osket, government: affiliation-duchy}");
                place("moor", "{government: affiliation-duchy}");
                affiliation("duchy", "polity", "{}");
            },
            shortcode: "duchy",
            expected: OSKET,
        },
        {
            name: "affiliation: a polity whose seat and governed places agree",
            type: "affiliation",
            build: () => {
                place("city", "{culture: lore-osket}");
                place("vale", "{culture: lore-osket, government: affiliation-duchy}");
                affiliation("duchy", "polity", "{seat: city}");
            },
            shortcode: "duchy",
            expected: OSKET,
        },
        {
            name: "affiliation: a polity governing places through their parents",
            type: "affiliation",
            build: () => {
                place("realm", "{culture: lore-vedyari}");
                place("vale", "{parents: [realm], government: affiliation-duchy}");
                affiliation("duchy", "polity", "{}");
            },
            shortcode: "duchy",
            expected: VEDYARI,
        },
        {
            name: "affiliation: none",
            type: "affiliation",
            build: () => affiliation("duchy", "polity", "{}"),
            shortcode: "duchy",
            expected: undefined,
        },
        {
            name: "lore: a culture note is its own culture",
            type: "lore",
            build: () => {},
            shortcode: "osket",
            expected: OSKET,
        },
        {
            name: "lore: another subType's own value",
            type: "lore",
            build: () =>
                note(
                    "Lore/Saga.md",
                    "type: lore",
                    "subType: literature",
                    "shortcode: saga",
                    "data: {culture: lore-osket}",
                ),
            shortcode: "saga",
            expected: OSKET,
        },
        {
            name: "lore: none",
            type: "lore",
            build: () => note("Lore/Law.md", "type: lore", "subType: law", "shortcode: law"),
            shortcode: "law",
            expected: undefined,
        },
        {
            name: "being: its own value",
            type: "being",
            build: () =>
                note(
                    "Beings/Ana.md",
                    "type: being",
                    "subType: npc",
                    "shortcode: ana",
                    "data: {culture: lore-osket}",
                ),
            shortcode: "ana",
            expected: OSKET,
        },
        {
            name: "being: its home's value is not taken",
            type: "being",
            build: () => {
                place("city", "{culture: lore-vedyari}");
                note(
                    "Beings/Ana.md",
                    "type: being",
                    "subType: npc",
                    "shortcode: ana",
                    "data: {homes: [city]}",
                );
            },
            shortcode: "ana",
            expected: undefined,
        },
        {
            name: "doc: a setting guide's own value",
            type: "doc",
            build: () =>
                note(
                    "Guides/Guide.md",
                    "type: doc",
                    "subType: settingguide",
                    "shortcode: guide",
                    "data: {culture: lore-osket}",
                ),
            shortcode: "guide",
            expected: OSKET,
        },
        {
            name: "doc: none",
            type: "doc",
            build: () =>
                note("Guides/Concept.md", "type: doc", "subType: concept", "shortcode: concept"),
            shortcode: "concept",
            expected: undefined,
        },
    ];

    it("covers every type the vocabulary gives a culture", () => {
        expect([...new Set(ROWS.map((row) => row.type))].sort()).toEqual(TYPES_WITH_CULTURE);
    });

    it.each(ROWS)("$name", ({ build, type, shortcode, expected }) => {
        cultures();
        build();
        const problems: object[] = [];
        const records = collect(problems);
        expect(problems).toEqual([]);
        expect(cultureOf(records, type, shortcode)).toBe(expected);
        expect(hasCultureKey(records, type, shortcode)).toBe(expected !== undefined);
    });

    it.each(TYPES_WITHOUT_CULTURE)("%s: never carries a culture", (type) => {
        cultures();
        place("realm", "{culture: lore-vedyari}");
        note(`Other/${type}.md`, `type: ${type}`, `shortcode: x${type}`);
        const records = collect();
        for (const record of records.filter((r: any) => r.type === type))
            expect(Object.hasOwn(record.data ?? {}, "culture")).toBe(false);
    });
});

describe("a place three levels below a cultured root", () => {
    const config = () => ({
        paths: { content, contentIndex: path.join(tmp, "out") },
        contentPackage: PKG,
        skipDirectories: [],
        packs: [{ name: "items", type: "Item" }],
    });

    function tree(): void {
        cultures();
        place("realm", "{culture: lore-vedyari, parents: []}");
        place("shire", "{parents: [realm]}");
        place("vale", "{parents: [shire], population: null}");
        place("hamlet", "{parents: [vale]}");
    }

    it("carries the root's culture in the written index, in its published form", () => {
        tree();
        const { file } = emitContentIndex({ config: config() as never });
        const hamlet = fs
            .readFileSync(file, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .find((record) => record.type === "place" && record.shortcode === "hamlet");
        expect(hamlet.data.culture).toEqual({ address: VEDYARI, anchor: null, anchorKind: null });
    });

    it("writes a byte-identical index across two runs", () => {
        tree();
        const first = fs.readFileSync(emitContentIndex({ config: config() as never }).file);
        const second = fs.readFileSync(emitContentIndex({ config: config() as never }).file);
        expect(first.toString("utf8")).toContain(VEDYARI);
        expect(second.equals(first)).toBe(true);
    });

    it("is selected by a SQL query on data.culture", async () => {
        tree();
        const db = await openNotesDatabase(collect(), { dir: path.join(tmp, "sql") });
        try {
            const { rows } = await db.query(
                `SELECT shortcode FROM notes WHERE type = 'place' AND data.culture = '${VEDYARI}' ORDER BY shortcode`,
            );
            expect(rows.map((row: any) => row.shortcode)).toEqual([
                "hamlet",
                "realm",
                "shire",
                "vale",
            ]);
        } finally {
            await db.close();
        }
    }, 60_000);
});

describe("parents that disagree", () => {
    function tree(): string {
        cultures();
        place("north", "{culture: lore-vedyari}");
        place("south", "{culture: lore-osket}");
        const pass = place("pass", "{population: null, parents: [north, south]}");
        place("inn", "{parents: [pass]}");
        place("fort", "{parents: [pass, north]}");
        return pass;
    }

    it("give one error at the parents key, and no culture", () => {
        const pass = tree();
        const problems: any[] = [];
        const records = collect(problems);
        expect(problems).toHaveLength(1);
        const [finding] = problems;
        expect(finding).toMatchObject({
            file: pass,
            severity: "error",
            ...located(pass, "parents"),
        });
        expect(finding.message).toBe(
            `data.parents resolve to different cultures (${VEDYARI} via north, ${OSKET} via south); state data.culture`,
        );
        expect(formatDiagnostic(finding)).toMatch(/^[^:\s]+:\d+:\d+: error: data\.parents /);
        expect(hasCultureKey(records, "place", "pass")).toBe(false);
    });

    it("add no second error on a child, which treats the errored parent as nothing", () => {
        tree();
        const problems: any[] = [];
        const records = collect(problems);
        expect(problems).toHaveLength(1);
        expect(hasCultureKey(records, "place", "inn")).toBe(false);
        expect(cultureOf(records, "place", "fort")).toBe(VEDYARI);
    });

    it("are resolved by the note's own value", () => {
        cultures();
        place("north", "{culture: lore-vedyari}");
        place("south", "{culture: lore-osket}");
        place("pass", "{culture: lore-osket, parents: [north, south]}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(problems).toEqual([]);
        expect(cultureOf(records, "place", "pass")).toBe(OSKET);
    });

    it("throw once, listing every conflict, when no problems list is given", () => {
        const pass = tree();
        place("east", "{culture: lore-vedyari}");
        place("west", "{culture: lore-osket}");
        const ford = place("ford", "{parents: [east, west]}");
        let error: any;
        try {
            collectContentIndex(content, { contentPackage: PKG, skipDirectories: [] });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        // Printed as it stands, so each line starts with its path.
        expect(error.located).toBe(true);
        const lines = String(error.message).split("\n");
        expect(lines).toHaveLength(2);
        const at = (file: string) => {
            const { line, column } = located(file, "parents");
            return `${formatLocator({ file, line, column })}: error: data.parents resolve`;
        };
        expect(lines[0].startsWith(at(ford))).toBe(true);
        expect(lines[1].startsWith(at(pass))).toBe(true);
    });
});

describe("a polity's seat and governed places", () => {
    it("that disagree give one error at the seat key", () => {
        cultures();
        place("city", "{culture: lore-vedyari}");
        place("vale", "{culture: lore-osket, government: affiliation-duchy}");
        const duchy = affiliation("duchy", "polity", "{population: null, seat: city}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({
            file: duchy,
            severity: "error",
            ...located(duchy, "seat"),
        });
        expect(problems[0].message).toContain(VEDYARI);
        expect(problems[0].message).toContain(OSKET);
        expect(hasCultureKey(records, "affiliation", "duchy")).toBe(false);
    });

    it("are pooled, so the seat is not consulted first", () => {
        cultures();
        place("city", "{culture: lore-vedyari}");
        place("vale", "{culture: lore-osket, government: affiliation-duchy}");
        affiliation("duchy", "polity", "{seat: city}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(cultureOf(records, "affiliation", "duchy")).toBeUndefined();
        expect(problems).toHaveLength(1);
    });

    it("that disagree with no seat give the error at the data line", () => {
        cultures();
        place("vale", "{culture: lore-osket, government: affiliation-duchy}");
        place("moor", "{culture: lore-vedyari, government: affiliation-duchy}");
        const duchy = affiliation("duchy", "polity", "{population: null}");
        const problems: any[] = [];
        collect(problems);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ file: duchy, ...located(duchy, "data") });
    });
});

describe("edges", () => {
    it("a cycle terminates and resolves to nothing", () => {
        cultures();
        place("east", "{parents: [west]}");
        place("west", "{parents: [east]}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(problems).toEqual([]);
        expect(hasCultureKey(records, "place", "east")).toBe(false);
        expect(hasCultureKey(records, "place", "west")).toBe(false);
    });

    it("a stub resolves and is inherited from like any other note", () => {
        cultures();
        fs.mkdirSync(path.join(content, "Places"), { recursive: true });
        fs.writeFileSync(
            path.join(content, "Places", "realm.md"),
            "---\ntype: place\nshortcode: realm\ndata: {culture: lore-vedyari}\n---\n",
        );
        place("shire", "{parents: [realm]}");
        const records = collect();
        expect(cultureOf(records, "place", "shire")).toBe(VEDYARI);
    });

    it("a foreign parent supplies its own resolved value, and its chain is not walked", () => {
        cultures();
        place("hamlet", "{parents: [sohl-note-place-shire]}");
        const asked: string[] = [];
        const foreignRecord = (key: string) => {
            asked.push(key);
            if (key === "sohl-note-place-shire") return { culture: readCanonicalKey(VEDYARI) };
            throw new Error(`asked for ${key}, past the immediate parent`);
        };
        const problems: any[] = [];
        const records = collect(problems, { foreignRecord });
        expect(problems).toEqual([]);
        expect(asked).toEqual(["sohl-note-place-shire"]);
        expect(cultureOf(records, "place", "hamlet")).toBe(VEDYARI);
    });

    it("a local parent never asks for a foreign record", () => {
        cultures();
        place("realm", "{culture: lore-vedyari}");
        place("shire", "{parents: [realm]}");
        const foreignRecord = (key: string) => {
            throw new Error(`asked for ${key}`);
        };
        const records = collect([], { foreignRecord });
        expect(cultureOf(records, "place", "shire")).toBe(VEDYARI);
    });
});

describe("the frontmatter", () => {
    it("is not changed by resolution", () => {
        const notes = [
            {
                rel: "Lore/Vedyari.md",
                fm: { type: "lore", subType: "culture", shortcode: "vedyari" },
            },
            {
                rel: "Places/realm.md",
                fm: { type: "place", shortcode: "realm", data: { culture: "lore-vedyari" } },
            },
            {
                rel: "Places/shire.md",
                fm: { type: "place", shortcode: "shire", data: { parents: ["realm"] } },
            },
        ];
        const records = notes.flatMap(({ rel, fm }) =>
            indexRecordsForNote({
                frontmatter: fm,
                body: "Body.",
                relPath: rel,
                contentPackage: PKG,
            }),
        );
        const before = notes.map(({ fm }) => structuredClone(fm));
        resolveCultures(records, { contentPackage: PKG, contentBase: content });
        expect(notes.map(({ fm }) => fm)).toEqual(before);
        expect(Object.hasOwn(notes[2].fm.data, "culture")).toBe(false);
        expect(Object.hasOwn(notes[0].fm, "data")).toBe(false);
        expect(cultureOf(records, "place", "shire")).toBe(VEDYARI);
        expect(cultureOf(records, "lore", "vedyari")).toBe(VEDYARI);
    });

    it("is what a reader recovers from a record, without the resolved culture", () => {
        cultures();
        place("realm", "{culture: lore-vedyari}");
        place("shire", "{parents: [realm]}");
        const records = collect();
        const authored = (type: string, shortcode: string) =>
            authoredFrontmatter(
                records.find(
                    (r: any) => r.type === type && r.shortcode === shortcode && !r.documents,
                ),
            );
        expect(Object.hasOwn(authored("place", "shire").data, "culture")).toBe(false);
        expect(authored("place", "shire").data.parents).toHaveLength(1);
        expect(Object.hasOwn(authored("lore", "vedyari"), "data")).toBe(false);
        expect(encodeAddresses(authored("place", "realm").data.culture)).toBe(VEDYARI);
        expect(cultureOf(records, "place", "shire")).toBe(VEDYARI);
    });
});

describe("dependency indexes", () => {
    /** One cached dependency index, as `package-build deps fetch` leaves it. */
    function cacheIndex(cache: string, id: string, records: unknown[]): void {
        const dir = path.join(cache, `${id}@0.1.0`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, metadataFileName(id)),
            records.map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        fs.writeFileSync(path.join(dir, ".complete"), "");
    }

    const config = (cache: string) => ({
        paths: { content, metadataCache: cache, contentIndex: path.join(tmp, "out") },
        contentPackage: PKG,
        skipDirectories: [],
        packs: [],
        relationships: { systems: [{ id: "sohl", manifest: "https://example.invalid/m.json" }] },
    });

    it("carry each record's resolved culture", () => {
        const cache = path.join(tmp, "cache");
        cacheIndex(cache, "sohl", [
            {
                package: "sohl",
                type: "place",
                shortcode: "shire",
                name: { full: "Shire" },
                address: { slug: "place-shire", canonical: "sohl-note-place-shire" },
                anchors: [],
                foundry: null,
                documentation: null,
                data: { culture: { address: VEDYARI, anchor: null, anchorKind: null } },
            },
        ]);
        const entry = loadForeignIndexes(config(cache) as never, [PKG]).index.get(
            "sohl-note-place-shire",
        );
        expect(encodeAddresses(entry.culture)).toBe(VEDYARI);
    });

    it("are read for a foreign parent", () => {
        const cache = path.join(tmp, "cache");
        cacheIndex(cache, "sohl", [
            {
                package: "sohl",
                type: "place",
                shortcode: "shire",
                name: { full: "Shire" },
                address: { slug: "place-shire", canonical: "sohl-note-place-shire" },
                anchors: [],
                foundry: null,
                documentation: null,
                data: { culture: { address: VEDYARI, anchor: null, anchorKind: null } },
            },
        ]);
        cultures();
        place("hamlet", "{parents: [sohl-note-place-shire]}");
        const records = indexRecordsFor({ config: config(cache) as never, problems: [] });
        expect(cultureOf(records, "place", "hamlet")).toBe(VEDYARI);
    });

    it("are not read when every parent is local, so an unfetched cache is not consulted", () => {
        cultures();
        place("realm", "{culture: lore-vedyari}");
        place("shire", "{parents: [realm]}");
        const records = indexRecordsFor({
            config: config(path.join(tmp, "never-fetched")) as never,
        });
        expect(cultureOf(records, "place", "shire")).toBe(VEDYARI);
    });
});
