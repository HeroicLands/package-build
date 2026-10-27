// SPDX-License-Identifier: GPL-3.0-or-later
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { installEncodingNote, languageNote } from "./helpers/encoding-note.js";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";
import { compileRows as compileEncoding, encodeText } from "../engine/encoding.mjs";
import {
    checkLexiconNatives,
    languageNoteFindings,
    lexiconEntries,
    lexiconsFromRecords,
} from "../engine/encoding-lexicon.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
const definition = {
    name: "letters",
    fonts: ["first", "second"],
    accepts: ["a", "b", "A", "B"],
    separator: " ",
    rows: [
        ["a", "α"],
        ["b", "β"],
        ["A", "Α"],
        ["B", "Β"],
    ],
};
const enc = compileEncoding(definition);
const faces = new Map(
    enc.fonts.map((slug) => [
        slug,
        { slug, draws: new Set([..."αβΑΒχ"].map((c) => c.codePointAt(0))) },
    ]),
);
const ctx = { encodings: new Map([[enc.name, enc]]), faces };
const source = (data: any) => {
    const fm = {
        type: "skill",
        subType: "language",
        shortcode: "tongue",
        name: { full: "Tongue" },
        data,
    };
    return { fm, file: "tongue.md", raw: `---\n${YAML.stringify(fm)}---\n` };
};
const word = (native: any[]) => ({
    form: "ab",
    class: "n",
    field: "Words",
    gloss: ["first meaning", "second meaning"],
    native,
});
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("authored native entry validation", () => {
    it("positions unknown encoding and font values, duplicates per face, and supplementary undrawn glyphs", () => {
        const note = source({
            words: [
                word([
                    { enc: "unknown", text: "χ" },
                    { enc: "letters", font: "unknown", text: "χ" },
                    { enc: "letters", font: "first", text: "χ" },
                    { enc: "letters", font: "first", text: "χ" },
                    { enc: "letters", font: "second", text: "\u{F0300}\u{1F47E}" },
                ]),
            ],
        });
        const errors = checkLexiconNatives(note, ctx);
        expect(errors).toHaveLength(5);
        expect(errors.map((e: any) => e.message)).toEqual([
            expect.stringMatching(/encoding document/),
            expect.stringMatching(/font/),
            expect.stringMatching(/second native/),
            expect.stringMatching(/U\+F0300/),
            expect.stringMatching(/U\+1F47E/),
        ]);
        for (const error of errors)
            expect(error).toMatchObject({
                file: "tongue.md",
                line: expect.any(Number),
                column: expect.any(Number),
            });
        const lines = note.raw.split("\n");
        expect(lines[errors[0].line - 1].slice(errors[0].column - 1)).toBe("unknown");
        expect(lines[errors[1].line - 1].slice(errors[1].column - 1)).toBe("unknown");
        expect(lines[errors[3].line - 1].slice(errors[3].column - 1)).toContain("\u{F0300}");
    });
    it("checks duplicate slots separately by encoding, face and grammatical ending", () => {
        const note = source({
            affixes: [
                {
                    form: "-a",
                    native: [
                        { enc: "letters", text: "χ" },
                        { enc: "letters", font: "first", text: "χ" },
                    ],
                },
            ],
            grammar: {
                verbs: {
                    persons: { I: "a", you: "a", heShe: "", we: "a", youAll: "a", they: "a" },
                },
                native: [
                    { ending: "plural", enc: "letters", text: "χ" },
                    { ending: "I", enc: "letters", text: "χ" },
                ],
            },
        });
        expect(checkLexiconNatives(note, ctx)).toEqual([]);
        expect(
            checkLexiconNatives(
                source({ grammar: { native: [{ ending: "I", enc: "letters", text: "χ" }] } }),
                ctx,
            )[0].message,
        ).toMatch(/persons/);
    });
    it("rejects redundant word-native text while allowing empty grammar endings and invisible selectors", () => {
        expect(
            checkLexiconNatives(
                source({ words: [word([{ enc: "letters", text: encodeText(enc, "ab") }])] }),
                ctx,
            )[0].message,
        ).toMatch(/rows already give/);
        expect(
            checkLexiconNatives(
                source({
                    words: [word([{ enc: "letters", text: "χ\u{E0114}" }])],
                    grammar: { native: [{ ending: "plural", enc: "letters", text: "" }] },
                }),
                ctx,
            ),
        ).toEqual([]);
    });
    it.each([
        { native: "χ" },
        { native: [{ enc: 7, text: "χ" }] },
        { native: [{ enc: "letters", text: 7 }] },
        { native: [{ enc: "letters", text: "χ", extra: true }] },
    ])("keeps malformed entry diagnostics at authored schema keys: %j", (entry) => {
        const note = source({ words: [{ ...word([]), ...entry }] });
        const errors = lintNote(note, {
            schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
            vocabulary: NOTE_VOCABULARY,
        }).filter((e: any) => e.message.includes("native"));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.every((e: any) => e.file === "tongue.md" && e.line > 1 && e.column > 0)).toBe(
            true,
        );
    });
    it("reports language-note resolution and missing Roman declarations at the configuration", () => {
        const config = {
            contentPackage: "demo",
            configFile: "package-build.config.yaml",
            configText: "languages:\n  missing: {tag: art-x-missing, note: skill-missing}\n",
            languages: { missing: { tag: "art-x-missing", note: "skill-missing" } },
        };
        expect(languageNoteFindings(config, [])).toEqual([
            expect.objectContaining({
                file: config.configFile,
                line: 2,
                message: expect.stringMatching(/names no language note/),
            }),
        ]);
        const record = {
            type: "skill",
            subType: "language",
            shortcode: "missing",
            data: { words: [] },
        };
        expect(languageNoteFindings(config, [record])[0].message).toMatch(/data.roman/);
    });
    it("lists source-ordered meanings and own or row spellings with structured error choices", () => {
        const record = {
            type: "skill",
            subType: "language",
            shortcode: "tongue",
            data: {
                words: [
                    word([{ enc: "letters", text: "χ" }]),
                    { form: "a", class: "n", gloss: "letter" },
                ],
            },
        };
        const config = {
            contentPackage: "demo",
            languages: { test: { tag: "art-x-test", note: "skill-tongue" } },
        };
        const addressed = compileEncoding(definition, {
            name: "demo-note-doc-letters",
            language: "test",
            font: "first",
        });
        const context = {
            ...ctx,
            ...config,
            encodings: new Map([
                ["letters", addressed],
                [addressed.name, addressed],
            ]),
            lexicons: lexiconsFromRecords([record], config),
        };
        expect(lexiconEntries(context, { lang: "test", enc: "letters" })).toMatchObject({
            entries: [
                { form: "ab", gloss: "first meaning; second meaning", source: "own", native: "χ" },
                { form: "a", source: "rows", native: "α" },
            ],
        });
        expect(lexiconEntries(context, { lang: "test", enc: "missing" })).toMatchObject({
            about: "enc",
            problem: expect.any(String),
        });
        expect(
            lexiconEntries(context, { lang: "test", enc: "letters", font: "missing" }),
        ).toMatchObject({ about: "font", problem: expect.any(String) });
    });
    it(
        "prints actual lexicon CLI JSON and rows and refuses an unknown encoding",
        () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexicon-cli-"));
            roots.push(root);
            installEncodingNote(root);
            const note = {
                ...languageNote,
                data: { ...languageNote.data, words: [languageNote.data.words[0]] },
            };
            fs.writeFileSync(
                path.join(root, "assets/content/Aelwythi.md"),
                `---\n${YAML.stringify(note)}---\n\nAelwythi.\n`,
            );
            const cli = new URL("../bin/package-build.mjs", import.meta.url).pathname;
            const json = spawnSync(
                process.execPath,
                [cli, "lexicon", "aelw", "--enc", "aelwsemaronenc", "--json"],
                {
                    cwd: root,
                    encoding: "utf8",
                    timeout: SUBPROCESS_TEST_TIMEOUT,
                    env: {
                        ...process.env,
                        PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                    },
                },
            );
            expect(json.status, json.stderr).toBe(0);
            expect(JSON.parse(json.stdout)).toMatchObject([
                { form: "say", gloss: "say; speak", source: "rows" },
            ]);
            const tab = spawnSync(
                process.execPath,
                [cli, "lexicon", "aelw", "--enc", "aelwsemaronenc"],
                {
                    cwd: root,
                    encoding: "utf8",
                    timeout: SUBPROCESS_TEST_TIMEOUT,
                    env: {
                        ...process.env,
                        PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                    },
                },
            );
            expect(tab.status, tab.stderr).toBe(0);
            expect(tab.stdout).toMatch(/^say\t.+\trows\tv\tsay; speak/m);
            const bad = spawnSync(process.execPath, [cli, "lexicon", "aelw", "--enc", "absent"], {
                cwd: root,
                encoding: "utf8",
                timeout: SUBPROCESS_TEST_TIMEOUT,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                },
            });
            expect(bad.status).toBe(1);
            expect(bad.stdout).toBe("");
            expect(bad.stderr).toMatch(/encoding/);
        },
        subprocessTimeout(3),
    );
});
