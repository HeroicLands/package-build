/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { DICTIONARY_COLUMNS, dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { renderDictionary } from "../engine/dictionary-layout.mjs";
import { insertLexicalSections, lexicalSectionsFor } from "../engine/lexical-sections.mjs";
import { emitContentIndex } from "../engine/content-index.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { openNotesDatabase, prepareSqlTables, runSqlQuery } from "../engine/sql-tables.mjs";

const LANGUAGE = "demo-note-skill-vylari";
const PERSONS = { I: "o", you: "es", heShe: "", we: "om", youAll: "et", they: "on" };
const GRAMMAR = { plural: [{ ending: "os", becomes: "oi" }], verbs: { persons: PERSONS } };
const word = (form: string, extra: object = {}) => ({
    form,
    class: "n m",
    field: "People",
    gloss: "an example noun",
    ...extra,
});

function language(shortcode: string, data: object, tags: string[] = []) {
    return {
        package: "demo",
        type: "skill",
        subType: "language",
        shortcode,
        address: `demo-note-skill-${shortcode}`,
        name: { full: shortcode === "vylari" ? "Vylari" : shortcode },
        data,
        tags,
    };
}

function lint(data: object) {
    const fm = {
        type: "skill",
        subType: "language",
        shortcode: "vylari",
        name: { full: "Vylari" },
        data: {
            classModifiers: ["m"],
            fields: [{ name: "People", holds: "People and their everyday words" }],
            words: [word("marendos")],
            ...data,
        },
    };
    const raw = `---\n${YAML.stringify(fm)}---\n\nA language.\n`;
    return lintNote({ file: "Vylari.md", type: "skill", raw, fm } as any, {
        vocabulary: NOTE_VOCABULARY,
        schemas: NOTE_SCHEMAS,
    }).filter((finding: any) => finding.severity === "error");
}

const records = () => [
    language("vylari", {
        abbreviation: "Vyl.",
        grammar: GRAMMAR,
        words: [
            word("marendos"),
            word("velos", { plural: "velen" }),
            word("plain"),
            word("sanos", { class: "v" }),
        ],
    }),
];
const result = (notes = records()) => ({
    columns: [...DICTIONARY_COLUMNS],
    rows: dictionaryAndTermRows(notes).dictionary,
});

describe("optional grammar states shapes without enforcing words", () => {
    it("declares the issue's exact six person names from the vocabulary", () => {
        const grammar: any = NOTE_VOCABULARY.skill.data.find(
            (field: any) => field.name === "grammar",
        );
        const verbs = grammar?.fields.find((field: any) => field.name === "verbs");
        const persons = verbs?.fields.find((field: any) => field.name === "persons");
        expect(persons?.fields.map((field: any) => field.name)).toEqual(Object.keys(PERSONS));
    });

    it("accepts absent grammar and accepts either supplied pattern with empty endings", () => {
        for (const grammar of [
            undefined,
            {},
            { plural: [] },
            GRAMMAR,
            { verbs: { replaces: "then", persons: PERSONS } },
            { verbs: { invariant: true } },
            {
                plural: [
                    { ending: "", becomes: "s" },
                    { ending: "os", becomes: "" },
                ],
            },
        ])
            expect(lint({ grammar })).toEqual([]);
        expect(lint({ classModifiers: [], words: [word("plain", { class: "n" })] })).toEqual([]);
    });

    const malformed: Array<[string, object, string]> = [
        ["word plural", { words: [word("marendos", { plural: 3 })] }, "data.words[0].plural"],
        ["grammar map", { grammar: "rules" }, "data.grammar"],
        ["plural list", { grammar: { plural: "os" } }, "data.grammar.plural"],
        ["plural row", { grammar: { plural: ["os"] } }, "data.grammar.plural[0]"],
        ["null plural row", { grammar: { plural: [null] } }, "data.grammar.plural[0]"],
        ["empty-list plural row", { grammar: { plural: [[]] } }, "data.grammar.plural[0]"],
        ["ending string", { grammar: { plural: [{ ending: 3, becomes: "oi" }] } }, ".ending"],
        ["becomes string", { grammar: { plural: [{ ending: "os", becomes: [] }] } }, ".becomes"],
        ["missing replacement", { grammar: { plural: [{ ending: "os" }] } }, "becomes"],
        ["missing ending", { grammar: { plural: [{ becomes: "oi" }] } }, "ending"],
        ["verbs map", { grammar: { verbs: 3 } }, "data.grammar.verbs"],
        ["empty-list verbs", { grammar: { verbs: [] } }, "data.grammar.verbs"],
        ["missing alternative", { grammar: { verbs: {} } }, "data.grammar.verbs"],
        ["invariant literal", { grammar: { verbs: { invariant: false } } }, ".invariant"],
        ["invariant boolean", { grammar: { verbs: { invariant: "true" } } }, ".invariant"],
        ["null invariant", { grammar: { verbs: { invariant: null } } }, ".invariant"],
        ["persons map", { grammar: { verbs: { persons: 3 } } }, ".persons"],
        ["empty-list persons", { grammar: { verbs: { persons: [] } } }, ".persons"],
        ["null persons", { grammar: { verbs: { persons: null } } }, ".persons"],
        [
            "both alternatives",
            { grammar: { verbs: { invariant: true, persons: PERSONS } } },
            "data.grammar.verbs",
        ],
        ["replaces string", { grammar: { verbs: { replaces: 3, persons: PERSONS } } }, ".replaces"],
        [
            "empty replaces",
            { grammar: { verbs: { replaces: " ", persons: PERSONS } } },
            ".replaces",
        ],
        [
            "replaces with invariant",
            { grammar: { verbs: { replaces: "then", invariant: true } } },
            ".replaces",
        ],
        ["unknown grammar key", { grammar: { tense: "present" } }, "grammar"],
        ["unknown person", { grammar: { verbs: { persons: { ...PERSONS, he: "a" } } } }, "persons"],
        ...Object.keys(PERSONS).flatMap((person): Array<[string, object, string]> => [
            [
                `${person} ending`,
                { grammar: { verbs: { persons: { ...PERSONS, [person]: 3 } } } },
                `.${person}`,
            ],
            [
                `missing ${person}`,
                {
                    grammar: {
                        verbs: {
                            persons: Object.fromEntries(
                                Object.entries(PERSONS).filter(([key]) => key !== person),
                            ),
                        },
                    },
                },
                person,
            ],
        ]),
    ];

    it.each(malformed)("refuses malformed %s at the supplied declaration", (_name, data, at) => {
        const findings = lint(data);
        const finding = findings.find((one: any) => one.message.includes(at));
        expect(finding, JSON.stringify(findings)).toBeDefined();
        expect(finding.line).toBeGreaterThan(0);
        expect(finding.column).toBeGreaterThan(0);
    });

    it("does not require coverage, agreement or an exceptional explicit plural", () => {
        expect(lint({ grammar: GRAMMAR })).toEqual([]);
        for (const plural of ["marendoi", "unrelated"])
            expect(lint({ grammar: GRAMMAR, words: [word("marendos", { plural })] })).toEqual([]);
        expect(lint({ grammar: GRAMMAR, words: [word("unmatched")] })).toEqual([]);
    });
});

describe("dictionary grammar presentation", () => {
    it("uses the explicit plural or first literal rule only for nouns", () => {
        const rows = result().rows;
        expect(Object.fromEntries(rows.map((row: any) => [row.name, row.plural]))).toEqual({
            marendos: "marendoi",
            plain: null,
            sanos: null,
            velos: "velen",
        });
        const render = renderDictionary(result(), { pageLanguage: LANGUAGE });
        expect(render).toContain("_n. m., pl. marendoi_");
        expect(render).toContain("_n. m., pl. velen_");
        const replacements = dictionaryAndTermRows([
            language("vylari", {
                grammar: {
                    plural: [
                        { ending: "os", becomes: "" },
                        { ending: "", becomes: "s" },
                    ],
                },
                words: [word("marendos"), word("plain")],
            }),
        ]).dictionary;
        expect(replacements.map((row: any) => row.plural)).toEqual(["marend", "plains"]);
    });

    it("prints one ordered table at the head, with empty endings readable", () => {
        const text = renderDictionary(result());
        expect(text.match(/\| Person \|/g)).toHaveLength(1);
        expect(text.indexOf("| Person |")).toBeLessThan(text.indexOf("## M"));
        expect(text).toContain("| he/she | unchanged |");
        const labels = [...text.matchAll(/^\| (I|you|he\/she|we|you all|they) \|/gm)].map(
            (match) => match[1],
        );
        expect(labels).toEqual(["I", "you", "he/she", "we", "you all", "they"]);
        const bare = renderDictionary(result(), { showKey: false });
        expect(bare).not.toContain("**Key:**");
        expect(bare).not.toContain("| Person |");
        expect(bare).toContain("n. m., pl. marendoi_");
        const only = renderDictionary(result(), { showKey: "only" });
        expect(only).toMatch(/^\*\*Key:\*\* [^\n]+$/);
        expect(only).not.toContain("| Person |");
    });

    it("heads the table with what an ending replaces, where the pattern states it", () => {
        const added = renderDictionary(result());
        expect(added).toContain("| Person | Ending added to citation form |");
        const replacing = renderDictionary(
            result([
                language("vylari", {
                    grammar: { verbs: { replaces: "then", persons: { ...PERSONS, I: "men" } } },
                    words: [word("lokathen", { class: "v" })],
                }),
            ]),
        );
        expect(replacing).toContain("| Person | Ending in place of a closing -then |");
        expect(replacing).toContain("| I | -men |");
        expect(replacing).toContain("| he/she | -then dropped |");
        expect(replacing).not.toContain("Ending added to citation form");
    });

    it("prints invariant verbs and escapes supplied table cells", () => {
        const invariant = result([
            language("vylari", {
                grammar: { verbs: { invariant: true } },
                words: [word("marendos")],
            }),
        ]);
        expect(renderDictionary(invariant)).toContain("| All persons | unchanged |");
        expect(renderDictionary(invariant, { showKey: false })).not.toContain("| Person |");
        expect(renderDictionary(invariant, { showKey: "only" })).not.toContain("| Person |");
        const escaped = result([
            language("vylari", {
                grammar: { verbs: { persons: { ...PERSONS, I: "a|b\nc" } } },
                words: [word("marendos")],
            }),
        ]);
        expect(renderDictionary(escaped)).toContain("a\\|b c");
    });

    it("labels each language's pattern once in a combined custom result", () => {
        const notes = [
            ...records(),
            language("other", {
                grammar: { verbs: { invariant: true } },
                words: [word("first"), word("second")],
            }),
        ];
        const text = renderDictionary(result(notes));
        expect(text.match(/\| Person \|/g)).toHaveLength(2);
        expect(text).toContain("**Verbs (Vyl.)**");
        expect(text).toContain("**Verbs (other)**");
        expect(renderDictionary(result(notes), { showKey: false })).not.toContain("| Person |");
        expect(renderDictionary(result(notes), { showKey: "only" })).not.toContain("| Person |");
    });

    it("keeps empty results and head-enabled fallback independent of abbreviation availability", () => {
        const empty = { columns: [...DICTIONARY_COLUMNS], rows: [] };
        for (const showKey of [undefined, true, false, "only"] as const)
            expect(renderDictionary(empty, { showKey })).toBe("");
        const opts = { pageLanguage: LANGUAGE, verbs: GRAMMAR.verbs };
        for (const showKey of [undefined, true] as const) {
            const text = renderDictionary(empty, { ...opts, showKey });
            expect(text).toContain("| I | -o |");
            expect(text).not.toContain("**Key:**");
        }
        expect(renderDictionary(empty, { ...opts, showKey: false })).toBe("");
        expect(renderDictionary(empty, { ...opts, showKey: "only" })).toBe("");
        const plain = result([language("vylari", { words: [word("plain")] })]);
        expect(renderDictionary(plain, { showKey: false })).toContain("**plain**");
        expect(renderDictionary(plain)).not.toContain("| Person |");
    });

    it("keeps grammar local while retaining an inherited explicit word plural", () => {
        const notes = [
            language("elder", {
                grammar: GRAMMAR,
                words: [word("marendos"), word("velos", { plural: "velen" })],
            }),
            language("vylari", { family: "demo-note-skill-elder", words: [word("own")] }),
        ];
        const own = dictionaryAndTermRows(notes).dictionary.filter(
            (row: any) => row.language === LANGUAGE,
        );
        expect(own.find((row: any) => row.name === "marendos").plural).toBeNull();
        expect(own.find((row: any) => row.name === "velos").plural).toBe("velen");
        expect(own.every((row: any) => row.verbs === null)).toBe(true);
    });

    it("uses the same presentation in the automatic section and keeps canonical anchors", () => {
        const sections = lexicalSectionsFor(records()).get(LANGUAGE);
        const text = insertLexicalSections(
            "# Words {#lexicon}\n\nAn introduction.\n",
            sections,
        ).markdown;
        expect(text.match(/\| Person \|/g)).toHaveLength(1);
        expect(text).toContain("_n. m., pl. marendoi_");
        expect(text).toContain(".dictionary-entry");
        expect(text.match(/\{#lexicon\}/g)).toHaveLength(1);
    });

    it("retains a stated pattern in an existing dictionary with only excluded word classes", () => {
        const notes = [
            language("vylari", { grammar: GRAMMAR, words: [word("Name", { class: "name" })] }),
        ];
        const text = insertLexicalSections(
            "A language.",
            lexicalSectionsFor(notes).get(LANGUAGE),
        ).markdown;
        expect(text).toContain("# Dictionary");
        expect(text).toContain("| Person |");
        const absent = [language("vylari", { grammar: GRAMMAR })];
        expect(lexicalSectionsFor(absent).has(LANGUAGE)).toBe(false);
    });
});

describe("grammar through SQL and published data", () => {
    it("renders keyless custom field fragments without repeating the automatic verb head", async () => {
        const notes = records();
        notes[0].data.words[3].field = "Actions";
        const db = await openNotesDatabase(notes);
        const fence = (key: string, filter = "") =>
            `\`\`\`sql {layout=dictionary key=${key}}\nSELECT * FROM dictionary WHERE language = '${LANGUAGE}'${filter}\n\`\`\``;
        const body = [
            "# Custom excerpts",
            fence("only"),
            "## People",
            fence("false", " AND field = 'People'"),
            "## Actions",
            fence("false", " AND field = 'Actions'"),
            "# Full dictionary {#lexicon}",
            "An authored introduction.",
        ].join("\n\n");
        try {
            const prepared = (
                await prepareSqlTables(db, [
                    {
                        source: "Vylari.md",
                        frontmatter: notes[0],
                        markdown: body,
                    },
                ])
            ).get("Vylari.md");
            expect(prepared.every((one: any) => !one.reason)).toBe(true);
            prepared.lexical = lexicalSectionsFor(notes).get(LANGUAGE);
            const rendered = expandContentTables(body, {
                source: "Vylari.md",
                sqlTables: prepared,
            });
            expect(rendered.errors).toEqual([]);
            expect(rendered.markdown.match(/\| Person \|/g)).toHaveLength(1);
            expect(rendered.markdown.match(/\*\*Key:\*\*/g)).toHaveLength(2);
            expect(rendered.markdown.match(/_n\. m\., pl\. marendoi_/g)).toHaveLength(2);
            expect(rendered.markdown).toContain("An authored introduction.");
            expect(rendered.markdown.indexOf("**Verbs**")).toBeGreaterThan(
                rendered.markdown.indexOf("# Full dictionary"),
            );

            const heads = [fence("true"), fence("true")].join("\n\n");
            const enabled = (
                await prepareSqlTables(db, [{ source: "Heads.md", markdown: heads }])
            ).get("Heads.md");
            const control = expandContentTables(heads, { source: "Heads.md", sqlTables: enabled });
            expect(control.errors).toEqual([]);
            expect(control.markdown.match(/\| Person \|/g)).toHaveLength(2);
        } finally {
            await db.close();
        }
    });

    it("renders a real SQL dictionary with the same table and no duplicate targets", async () => {
        const db = await openNotesDatabase(records());
        try {
            const [prepared] = (
                await prepareSqlTables(db, [
                    {
                        source: "Vylari.md",
                        frontmatter: { type: "skill", subType: "language", shortcode: "vylari" },
                        markdown: `\`\`\`sql {layout=dictionary}\nSELECT * FROM dictionary WHERE language = '${LANGUAGE}'\n\`\`\``,
                    },
                ])
            ).get("Vylari.md");
            expect(prepared.reason).toBeUndefined();
            expect(prepared.markdown).toContain("_n. m., pl. marendoi_");
            expect(prepared.markdown.match(/\| Person \|/g)).toHaveLength(1);
            expect(prepared.markdown).not.toContain(".dictionary-entry");
            expect(
                (await runSqlQuery(db, `SELECT plural FROM words WHERE form = 'velos'`)).rows,
            ).toEqual([{ plural: "velen" }]);
        } finally {
            await db.close();
        }
    });

    it("carries `replaces` through SQL into the verb table", async () => {
        const notes = [
            language("vylari", {
                grammar: { verbs: { replaces: "then", persons: PERSONS } },
                words: [word("lokathen", { class: "v" })],
            }),
            language("other", {
                grammar: { verbs: { persons: PERSONS } },
                words: [word("sanos", { class: "v" })],
            }),
        ];
        const db = await openNotesDatabase(notes);
        try {
            const text = renderDictionary(await runSqlQuery(db, "SELECT * FROM dictionary"));
            expect(text).toContain("| Person | Ending in place of a closing -then |");
            expect(text).toContain("| Person | Ending added to citation form |");
        } finally {
            await db.close();
        }
    });

    it("keeps dictionary types stable when empty, null, invariant or six-person", async () => {
        const cases = [
            [],
            [language("vylari", { words: [word("plain")] })],
            records(),
            [
                language("vylari", {
                    grammar: { verbs: { invariant: true } },
                    words: [word("plain")],
                }),
            ],
        ];
        for (const notes of cases) {
            const db = await openNotesDatabase(notes);
            try {
                const rows = (await runSqlQuery(db, "DESCRIBE dictionary")).rows;
                expect(rows.find((row: any) => row.column_name === "plural")?.column_type).toBe(
                    "VARCHAR",
                );
                expect(rows.find((row: any) => row.column_name === "verbs")?.column_type).toMatch(
                    /^STRUCT\(/,
                );
                expect(rows.find((row: any) => row.column_name === "senses")?.column_type).toMatch(
                    /^STRUCT\(/,
                );
                expect(rows.find((row: any) => row.column_name === "usage")?.column_type).toBe(
                    "VARCHAR[]",
                );
            } finally {
                await db.close();
            }
        }
    });

    it("carries grammar through a dependency and excludes hidden language tables", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "optional-grammar-dep-"));
        const file = path.join(root, "demo.jsonl");
        fs.writeFileSync(
            file,
            records()
                .map((record) => JSON.stringify(record))
                .join("\n"),
        );
        const db = await openNotesDatabase(
            [
                ...records(),
                language(
                    "hidden",
                    {
                        grammar: { verbs: { invariant: true } },
                        words: [word("SECRET")],
                    },
                    ["gm"],
                ),
            ],
            { dependencies: [{ id: "other", file }], audience: "public" },
        );
        try {
            const own = await runSqlQuery(db, "SELECT * FROM dictionary");
            const foreign = await runSqlQuery(db, "SELECT * FROM other.dictionary");
            expect(own.rows).toEqual(foreign.rows);
            expect(renderDictionary(own)).not.toContain("All persons");
        } finally {
            await db.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("publishes plural and verb metadata in dictionary JSONL", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "optional-grammar-index-"));
        try {
            const fm = {
                shortcode: "vylari",
                name: { full: "Vylari" },
                type: "skill",
                subType: "language",
                data: records()[0].data,
            };
            const content = path.join(root, "content");
            fs.mkdirSync(content);
            fs.writeFileSync(
                path.join(content, "Vylari.md"),
                `---\n${YAML.stringify(fm)}---\n\nA language.\n`,
            );
            const published = emitContentIndex({
                config: {
                    contentPackage: "demo",
                    paths: { content, contentIndex: path.join(root, "out") },
                    skipDirectories: [],
                    packs: [{ name: "items", type: "Item" }],
                } as any,
            });
            const rows = fs
                .readFileSync(published.dictionary.file, "utf8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(rows.find((row) => row.name === "marendos").plural).toBe("marendoi");
            expect(rows.find((row) => row.name === "marendos").verbs.persons).toEqual(PERSONS);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
