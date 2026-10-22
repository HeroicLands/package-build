/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The script a language is written in.** A language note's
 * `data.writtenIn` names a map and a face; a run marked with the language
 * alone takes them, an explicit `map=` or `font=` overrides its half, and a
 * default that names nothing is the note's finding and fills no run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { lexiconEntries, transliterate } from "../engine/map-lexicon.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { fillWrittenIn } from "../engine/run-rows.mjs";
import { compileMap } from "../engine/text-maps.mjs";
import { checkWrittenIn, fromWrittenIn, writtenInOf } from "../engine/written-in.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

const KA = "\u{F0239}\u{F0230}";
const CHEN = "\u{F101F}";

const LANGUAGES = {
    prv: { tag: "art-x-prv", note: "skill-provenzlng" },
    tsu: { tag: "art-x-tsu", note: "skill-tantsoulng" },
    bad: { tag: "art-x-bad", note: "skill-badlng" },
    vyl: { tag: "art-x-vyl" },
};

const language = (shortcode: string, data: object) => ({
    type: "skill",
    subType: "language",
    shortcode,
    address: { canonical: `demo-note-skill-${shortcode}` },
    data,
});

const mapNote = (shortcode: string, map: object) => ({
    type: "doc",
    shortcode,
    address: { canonical: `demo-note-doc-${shortcode}` },
    data: { map },
});

const scriptNote = (shortcode: string, script: object) => ({
    type: "skill",
    subType: "script",
    shortcode,
    address: { canonical: `demo-note-skill-${shortcode}` },
    data: { script },
});

const SEMARON = {
    name: "semaron",
    fonts: [{ font: "semaron-kuriale" }],
    rows: [
        ["k", "\u{F0239}"],
        ["a", "\u{F0230}"],
    ],
};

const RECORDS = [
    language("provenzlng", {
        writtenIn: { map: "semaron", font: "semaron-kuriale" },
        words: [{ form: "ka", class: "n", gloss: "gate" }],
    }),
    language("tantsoulng", {
        writtenIn: { map: "tengchou", font: "teng-chou" },
        words: [
            {
                form: "chen",
                class: "n",
                gloss: "emperor",
                native: [{ map: "tengchou", text: CHEN }],
            },
        ],
    }),
    language("badlng", { writtenIn: { map: "semoran", font: "semaron-kuriale" } }),
    mapNote("semaronmap", SEMARON),
    mapNote("othermap", { name: "other", fonts: [{ font: "semaron-kuriale" }], rows: [] }),
    mapNote("thuravarkmap", { name: "thuravark", fonts: [{ font: "thuravark-carved" }], rows: [] }),
    mapNote("tengchoumap", {
        name: "tengchou",
        logographic: true,
        fonts: [{ font: "teng-chou" }],
        rows: [[" ", ""]],
    }),
    scriptNote("semaronscrpt", { fonts: ["semaron-kuriale"], emphasis: "rubric" }),
    scriptNote("tengchouscript", {
        fonts: ["teng-chou"],
        emphasis: "rubric",
        direction: "vertical-rl",
    }),
];

let root: string;
let ctx: ReturnType<typeof runContext>;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "written-in-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    ctx = runContext({ rootDir: root, contentPackage: "demo", languages: LANGUAGES }, RECORDS);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The one run a source marks, and its findings. */
const run = (source: string) => {
    const { runs, errors } = scanRuns(source, ctx);
    return { run: runs[0], errors };
};

describe("the scripts a run context knows", () => {
    it("are each language's whose map is known and drawn in its face", () => {
        expect([...(ctx.writtenIn ?? new Map())]).toEqual([
            ["prv", { map: "semaron", font: "semaron-kuriale" }],
            ["tsu", { map: "tengchou", font: "teng-chou" }],
        ]);
    });

    it("leave out a default whose face its map is not drawn in", () => {
        const maps = new Map([["semaron", compileMap(SEMARON)!]]);
        const byName = new Map([
            ["prv", language("provenzlng", { writtenIn: { map: "semaron", font: "teng-chou" } })],
        ]);
        expect(writtenInOf(byName, maps).size).toBe(0);
    });
});

describe("what a run takes from its language", () => {
    const scripts = new Map([["prv", { map: "semaron", font: "semaron-kuriale" }]]);
    const maps = new Map(
        [SEMARON, { name: "thuravark", fonts: [{ font: "thuravark-carved" }], rows: [] }].map(
            (map) => [map.name, compileMap(map)!],
        ),
    );

    it.each([
        [{ lang: "prv" }, { map: "semaron", font: "semaron-kuriale" }],
        [{ lang: "prv", font: "semaron-kuriale" }, { map: "semaron" }],
        [{ lang: "prv", font: "mono" }, {}],
        [{ lang: "prv", map: "semaron" }, { font: "semaron-kuriale" }],
        [{ lang: "prv", map: "thuravark" }, {}],
        [{ lang: "prv", map: "semaron", font: "semaron-kuriale" }, {}],
        [{ lang: "vyl" }, {}],
        [{ map: "semaron" }, {}],
    ])("%o takes %o", (keys, taken) => {
        expect(fromWrittenIn(keys, scripts, maps)).toEqual(taken);
    });
});

describe("a run marked with the language alone", () => {
    it("is a span mapped and set in the language's face", () => {
        expect(run("Cut as [ka]{lang=prv}.")).toEqual({
            run: expect.objectContaining({
                kind: "span",
                lang: "prv",
                tag: "art-x-prv",
                map: "semaron",
                font: "semaron-kuriale",
            }),
            errors: [],
        });
        expect(renderRuns("Cut as [ka]{lang=prv}.", ctx).markdown).toBe(
            `Cut as [${KA}]{lang=art-x-prv .script .hl-semaron-kuriale}.`,
        );
    });

    it("is a div whose paragraphs are mapped and set in the face", () => {
        expect(run("::: {lang=prv}\nka\n:::\n").run).toMatchObject({
            kind: "block",
            map: "semaron",
            font: "semaron-kuriale",
        });
        expect(renderRuns("::: {lang=prv}\nka\n:::\n", ctx).markdown).toBe(
            `::: {lang=art-x-prv .script .script-block .hl-semaron-kuriale}\n${KA}\n:::\n`,
        );
    });

    it("is a scroll fence set in the language's face, with no finding", () => {
        expect(run("```scroll {rows=3 lang=tsu}\nchen\n```\n")).toEqual({
            run: expect.objectContaining({ kind: "scroll", map: "tengchou", font: "teng-chou" }),
            errors: [],
        });
    });

    it("is a scroll fence refused at its lang= where the language's script is written in lines", () => {
        expect(run("```scroll {rows=3 lang=prv}\nka\n```\n").errors).toEqual([
            {
                line: 1,
                column: 24,
                message:
                    "a `scroll` fence sets a script written in columns, and the script of " +
                    "`semaron-kuriale` is written in lines; set it in a face whose script note " +
                    "states `direction: vertical-rl`, or use a div",
            },
        ]);
    });

    it("is held to its language's words, as an explicitly mapped run is", () => {
        expect(run("[kaa]{lang=prv}").errors.map((error) => error.message)).toEqual([
            expect.stringContaining("`kaa`"),
        ]);
    });
});

describe("a run that states its own map or face", () => {
    it("is set in the face it names, unmapped where the language's map is not drawn in it", () => {
        expect(run("[ka]{lang=prv font=mono}").run).toMatchObject({ font: "mono", map: undefined });
    });

    it("takes the language's map where that map is drawn in the face it names", () => {
        expect(run("[ka]{lang=prv font=semaron-kuriale}").run).toMatchObject({
            font: "semaron-kuriale",
            map: "semaron",
        });
    });

    it("takes the language's face where the map it names is drawn in it", () => {
        expect(run("[ka]{lang=prv map=other}").run).toMatchObject({
            map: "other",
            font: "semaron-kuriale",
        });
        expect(run("[ka]{lang=prv map=thuravark}").run).toMatchObject({
            map: "thuravark",
            font: undefined,
        });
    });

    it("takes nothing from the language of a div around it when it names its own", () => {
        const { runs } = scanRuns("::: {lang=prv}\nka [ka]{lang=vyl}\n:::\n", ctx);
        expect(runs.find((one) => one.kind === "span")).toMatchObject({
            lang: "vyl",
            map: undefined,
            font: undefined,
        });
    });
});

describe("a language with no usable script", () => {
    it("marks a run with its tag and nothing else where its note names none", () => {
        expect(run("[ka]{lang=vyl}").run).toMatchObject({ map: undefined, font: undefined });
        expect(renderRuns("[ka]{lang=vyl}", ctx).markdown).toBe("[ka]{lang=art-x-vyl}");
    });

    it("fills no run where its note's default names an unknown map", () => {
        expect(run("[ka]{lang=bad}").run).toMatchObject({ map: undefined, font: undefined });
    });
});

describe("the commands", () => {
    it("list a language's lexicon under its script when no map is named", () => {
        const listed = lexiconEntries(ctx, { lang: "prv" });
        expect(listed).toEqual({
            entries: [expect.objectContaining({ form: "ka", native: KA })],
        });
    });

    it("say a language names no script when no map is named and its note states none", () => {
        expect(lexiconEntries(ctx, { lang: "vyl" })).toEqual({
            about: "map",
            problem:
                "`vyl` names no script: its note states no `data.writtenIn`, so name a map with `--map`",
        });
    });

    it("transliterate with the language's face where the map named is drawn in it", () => {
        expect(transliterate(ctx, { map: "semaron", lang: "prv" }, "ka")).toEqual({ text: KA });
    });
});

describe("the recorded runs", () => {
    it("take the language's script once every record exists", () => {
        const page = {
            type: "lore",
            shortcode: "gate",
            address: { canonical: "demo-note-lore-gate" },
            runs: [
                {
                    kind: "span",
                    lang: "prv",
                    tag: "art-x-prv",
                    font: null,
                    map: null,
                    line: 1,
                    column: 1,
                },
                {
                    kind: "span",
                    lang: "prv",
                    tag: "art-x-prv",
                    font: "mono",
                    map: null,
                    line: 2,
                    column: 1,
                },
                {
                    kind: "span",
                    lang: "vyl",
                    tag: "art-x-vyl",
                    font: null,
                    map: null,
                    line: 3,
                    column: 1,
                },
            ],
        };
        const records = [...RECORDS.map((record) => ({ ...record })), page];
        fillWrittenIn(records, { languages: LANGUAGES, contentPackage: "demo" });
        expect(page.runs.map(({ font, map }) => ({ font, map }))).toEqual([
            { font: "semaron-kuriale", map: "semaron" },
            { font: "mono", map: null },
            { font: null, map: null },
        ]);
    });
});

/** A note as the lint reads it, its YAML written out so positions are real. */
const noteOf = (fm: object) => ({
    file: "language.md",
    fm,
    raw: `---\n${YAML.stringify(fm)}---\n`,
});

const INDEX = { notes: RECORDS.filter((record) => record.type === "doc").map((fm) => ({ fm })) };

const located = (findings: Array<{ line?: number; column?: number; message: string }>) =>
    findings.map((finding) => `${finding.line}:${finding.column}: ${finding.message}`);

describe("`data.writtenIn` in the note lint", () => {
    const languageNote = (writtenIn: object, subType = "language") =>
        noteOf({ type: "skill", subType, shortcode: "provenzlng", data: { writtenIn } });

    it("accepts a map a mapping note declares, drawn in the face named", () => {
        expect(
            checkWrittenIn(languageNote({ map: "semaron", font: "semaron-kuriale" }), {
                index: INDEX,
            }),
        ).toEqual([]);
    });

    it("refuses a map no mapping note declares, at the map", () => {
        expect(
            located(
                checkWrittenIn(languageNote({ map: "semoran", font: "semaron-kuriale" }), {
                    index: INDEX,
                }),
            ),
        ).toEqual([
            "7:10: `data.writtenIn.map` is `semoran`, which no mapping note's `data.map.name` declares; did you mean `semaron`?",
        ]);
    });

    it("refuses a face the map is not drawn in, at the font", () => {
        expect(
            located(
                checkWrittenIn(languageNote({ map: "semaron", font: "teng-chou" }), {
                    index: INDEX,
                }),
            ),
        ).toEqual([
            "8:11: `data.writtenIn.font` is `teng-chou`, which the map `semaron` is not drawn in; it is drawn in `semaron-kuriale`",
        ]);
    });

    it("refuses the key on a skill that is not a language, at the key", () => {
        expect(
            located(
                checkWrittenIn(languageNote({ map: "semaron", font: "semaron-kuriale" }, "lore"), {
                    index: INDEX,
                }),
            ),
        ).toEqual([
            "6:3: `data.writtenIn` names the script a language is written in, and this note's `subType` is not `language`",
        ]);
    });

    it("is a declared key whose map and font are both required", () => {
        const findings = lintNote(
            noteOf({
                type: "skill",
                subType: "language",
                shortcode: "provenzlng",
                name: { full: "Provenzal" },
                data: { writtenIn: { map: "semaron" } },
            }),
            { schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS }, vocabulary: NOTE_VOCABULARY },
        ).filter((finding: { message: string }) => finding.message.includes("writtenIn"));
        expect(findings.map((finding: { message: string }) => finding.message)).toEqual([
            expect.stringMatching(/font/),
        ]);
    });
});
