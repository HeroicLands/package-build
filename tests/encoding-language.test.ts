// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { compileRows as compileEncoding, encodeText, decodeText } from "../engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
const encDir = new URL("./fixtures/encodings/", import.meta.url);
const languages = fs
    .readdirSync(new URL("./fixtures/encoding-languages/", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((file) =>
        JSON.parse(
            fs.readFileSync(
                new URL(`./fixtures/encoding-languages/${file}`, import.meta.url),
                "utf8",
            ),
        ),
    );
const stripMarks = (text: string) => text.replace(/[\u{E0100}-\u{E01EF}]/gu, "");
function encoding(name: string) {
    return compileEncoding(JSON.parse(fs.readFileSync(new URL(`${name}.json`, encDir), "utf8")));
}

describe("language conversion inventory", () => {
    for (const lexicon of languages)
        it(`round trips own and parts writings in ${lexicon.language}`, () => {
            const { enc, font } = lexicon.data.writtenIn;
            const compiled = encoding(enc);
            for (const word of lexicon.data.words) {
                const native = encodeWithLanguage(compiled, word.form, { font, lexicon });
                expect(native.findings).toEqual([]);
                const roman = decodeWithLanguage(compiled, native.text, { font, lexicon });
                const expected = word.form === "zava" ? "rava" : word.form;
                expect(roman.text).toBe(expected);
                expect(roman.findings).toEqual([]);
            }
        });
    it("recovers unmarked skeletons per word, first listed, while preserving marked words exactly", () => {
        const lexicon = languages.find((l) => l.language === "qal");
        const compiled = encoding("qalezu");
        const marked = encodeText(compiled, "rizan");
        const skeleton = stripMarks(marked);
        expect(decodeWithLanguage(compiled, skeleton, { lexicon }).text).toBe("razan");
        expect(decodeWithLanguage(compiled, `${skeleton} ${marked}`, { lexicon })).toMatchObject({
            text: "razan rizan",
            findings: [],
        });
        const unknown = decodeWithLanguage(compiled, stripMarks(encodeText(compiled, "zarm")), {
            lexicon,
        });
        expect(unknown.text).toBe(decodeText(compiled, stripMarks(encodeText(compiled, "zarm"))));
        expect(unknown.findings).toEqual([
            expect.objectContaining({
                offset: 0,
                line: 1,
                column: 1,
                message: expect.stringMatching(/lexicon/),
            }),
        ]);
    });
    it("uses literal codage for unknown no-letter signs and leaves marked literals immutable", () => {
        const lexicon = languages.find((l) => l.language === "zet");
        const compiled = encoding("zethu");
        const literal = encodeText(compiled, "⟦U+00E1⟧");
        expect(decodeWithLanguage(compiled, literal, { lexicon })).toMatchObject({
            text: "⟦U+00E1⟧",
            findings: [],
        });
        const unknown = decodeWithLanguage(compiled, "𞰂", { lexicon });
        expect(unknown.text).toMatch(/^⟦.+⟧$/u);
        expect(unknown.findings).toHaveLength(1);
        const refused = encodeWithLanguage(compiled, "unknown", { lexicon });
        expect(refused.findings[0]).toMatchObject({
            offset: 0,
            message: expect.stringMatching(/lexicon|codage/),
        });
    });
});

it("prefers exact cased entries, recognizes variants, and honors authored marked exceptions", () => {
    const compiled = encoding("aelwythi-semaron");
    const small = encodeText(compiled, "a"),
        capital = encodeText(compiled, "A"),
        marked = small + "\u{E0114}";
    const lexicon = {
        language: "aelw",
        data: {
            words: [
                {
                    form: "candle",
                    class: "n",
                    gloss: "lower",
                    variants: ["candles"],
                    native: [{ enc: compiled.name, text: small }],
                },
                {
                    form: "Candle",
                    class: "n",
                    gloss: "capital",
                    native: [{ enc: compiled.name, text: capital }],
                },
                {
                    form: "marked",
                    class: "n",
                    gloss: "exception",
                    native: [{ enc: compiled.name, text: marked }],
                },
            ],
        },
    };
    expect(encodeWithLanguage(compiled, "candle Candle candles", { lexicon })).toMatchObject({
        text: `${small} ${capital} ${small}`,
        findings: [],
    });
    expect(decodeWithLanguage(compiled, marked, { lexicon })).toMatchObject({
        text: "marked",
        findings: [],
    });
    expect(decodeWithLanguage(compiled, encodeText(compiled, "rá"), { lexicon }).text).toBe(
        decodeText(compiled, encodeText(compiled, "rá")),
    );
});

it("recovers registered names and variants, and keeps JSON projection and browser graphs pure", async () => {
    const compiled = encoding("qalezu");
    const lexicon = {
        language: "qal",
        data: {
            words: [
                {
                    form: "razan",
                    class: "n",
                    gloss: ["one", "two"],
                    variants: ["zaram"],
                    note: "not converter data",
                },
            ],
            grammar: { plural: [], guide: "not converter data" },
            register: [{ name: "maran", tongue: "qal", note: "not converter data" }],
            prose: "not converter data",
        },
    };
    const { serializeLexicon } = await import("../engine/encoding-lexicon.mjs");
    const serialized = JSON.parse(JSON.stringify(serializeLexicon(lexicon)));
    expect(serialized.data.prose).toBeUndefined();
    expect(serialized.data.words[0].note).toBeUndefined();
    expect(serialized.data.grammar.guide).toBeUndefined();
    expect(serialized.data.register[0].note).toBeUndefined();
    expect(
        decodeWithLanguage(compiled, stripMarks(encodeText(compiled, "zaram")), {
            lexicon: serialized,
        }).text,
    ).toBe("zaram");
    expect(
        decodeWithLanguage(compiled, stripMarks(encodeText(compiled, "maran")), {
            lexicon: serialized,
        }).text,
    ).toBe("{maran}");
    const { build } = await import("esbuild");
    const result = await build({
        entryPoints: [new URL("../engine/encoding-language.mjs", import.meta.url).pathname],
        bundle: true,
        platform: "browser",
        write: false,
        metafile: true,
    });
    expect(
        Object.keys(result.metafile!.inputs).some((file) =>
            /dictionary-rows|diagnostics|index-records/.test(file),
        ),
    ).toBe(false);
});

it("keeps bounded row matches from consuming a native override while retaining full context", () => {
    const compiled = compileEncoding({
        name: "bounds",
        fonts: ["test"],
        accepts: ["a", "b", "."],
        separator: " ",
        rows: [
            ["a.b", "X"],
            ["a", "A"],
            ["b", "B"],
            [".", "."],
        ],
    });
    const lexicon = {
        language: "test",
        data: {
            words: [{ form: "b", class: "n", gloss: "b", native: [{ enc: "bounds", text: "Z" }] }],
        },
    };
    expect(encodeWithLanguage(compiled, "a.b", { lexicon })).toMatchObject({
        text: "A.Z",
        findings: [],
    });
});
