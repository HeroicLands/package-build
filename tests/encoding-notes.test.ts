// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from "vitest";
import { encodingsFromRecords, encodingAddress, fontCodes } from "../engine/encoding-notes.mjs";
import { scanRuns, renderRuns } from "../engine/content-scripts.mjs";
const data = {
    language: "test",
    font: "face",
    mappings: { a: "A", b: "B" },
    rules: { normalization: "NFC", matching: "longest-first" },
};
const record = {
    type: "doc",
    shortcode: "testenc",
    name: "Test spelling",
    package: "demo",
    file: { path: "Docs/Test.md" },
    data,
};
const config = {
    contentPackage: "demo",
    languages: { test: { tag: "art-x-test" }, other: { tag: "art-x-other" } },
};
const fonts: any = {
    root: "/installed/fonts",
    version: "1.0.0",
    manifest: {
        families: [
            {
                class: "hl-face",
                codepoints: [
                    { codepoint: "U+03B1", code: "A" },
                    { codepoint: "U+03B2", code: "B" },
                ],
            },
        ],
    },
};
const loaded = () => encodingsFromRecords([record], config, fonts);
it("compiles content documents with selected font codes and document address defaults", () => {
    const result = loaded();
    expect(result.findings).toEqual([]);
    const enc = result.encodings.get("testenc");
    expect(enc).toMatchObject({ name: "demo-note-doc-testenc", language: "test", font: "face" });
    expect(result.encodings.get("doc-testenc")).toBe(enc);
    expect(result.encodings.get(encodingAddress("note-doc-testenc", "demo"))).toBe(enc);
    expect(result.encodings.get(encodingAddress("doc/testenc", "demo"))).toBe(enc);
    expect(result.encodings.get(encodingAddress("testenc", "demo"))).toBe(enc);
});
it("infers language and face from enc and leaves default encoding Roman", () => {
    const result = loaded();
    const ctx: any = {
        ...config,
        encodings: result.encodings,
        faces: new Map([
            [
                "face",
                { slug: "face", class: "hl-face", family: "Face", draws: new Set([0x3b1, 0x3b2]) },
            ],
        ]),
    };
    expect(scanRuns("[ab]{enc=testenc}", ctx)).toMatchObject({
        errors: [],
        runs: [{ lang: "test", font: "face", enc: "demo-note-doc-testenc" }],
    });
    expect(renderRuns("[ab]{enc=testenc}", ctx).markdown).toContain("αβ");
    expect(renderRuns("[ab]{lang=test enc=default}", ctx).markdown).toContain("ab");
    expect(renderRuns("[ab]{lang=art-x-TEST enc=testenc}", ctx)).toMatchObject({
        errors: [],
        markdown: expect.stringContaining("αβ"),
    });
    expect(scanRuns("[ab]{enc=testenc lang=other}", ctx).errors).toEqual([
        expect.objectContaining({
            message: expect.stringMatching(/language.*test.*other|other.*test/),
            column: expect.any(Number),
        }),
    ]);
    expect(
        scanRuns("[ab]{lang=test .nativefont}", ctx).errors.some((error) =>
            /nativefont/.test(error.message),
        ),
    ).toBe(true);
});
it("refuses malformed selected font codes and source-positioned document rule errors", () => {
    expect(() =>
        fontCodes(
            {
                ...fonts,
                manifest: {
                    families: [
                        {
                            class: "hl-face",
                            codepoints: [
                                { codepoint: "U+03B1", code: "A" },
                                { codepoint: "U+03B2", code: "A" },
                            ],
                        },
                    ],
                },
            },
            "face",
        ),
    ).toThrow(/repeats.*A/);
    const special = fontCodes(
        {
            ...fonts,
            manifest: {
                families: [
                    { class: "hl-face", codepoints: [{ codepoint: "U+03B1", code: "__proto__" }] },
                ],
            },
        },
        "face",
    );
    expect(Object.hasOwn(special, "__proto__")).toBe(true);
    expect(special.__proto__).toBe("α");
    const bad = {
        ...record,
        raw: "---\ntype: doc\ndata:\n  mappings: {a: UNKNOWN}\n---\n",
        data: { ...data, mappings: { a: "UNKNOWN" } },
    };
    expect(encodingsFromRecords([bad], config, fonts).findings).toEqual([
        expect.objectContaining({
            file: expect.stringContaining("Test.md"),
            line: 4,
            message: expect.stringMatching(/UNKNOWN/),
        }),
    ]);
});

it("resolves short native references in the author's package for build and browser projections", async () => {
    const { lexiconsFromRecords, serializeLexicon } =
        await import("../engine/encoding-lexicon.mjs");
    const { encodeWithLanguage, decodeWithLanguage } =
        await import("../engine/encoding-language.mjs");
    const authored = {
        type: "skill",
        subType: "language",
        shortcode: "tongue",
        package: "demo",
        data: {
            words: [
                {
                    form: "ab",
                    class: "n",
                    gloss: "one",
                    variants: ["aba"],
                    native: [{ enc: "testenc", text: "β" }],
                },
                { form: "abab", class: "n", gloss: "built", built: ["ab", "-a"] },
                {
                    form: "ba",
                    class: "n",
                    gloss: "two",
                    native: [{ enc: "demo-note-doc-testenc", text: "α" }],
                },
            ],
            affixes: [{ form: "-a", native: [{ enc: "doc-testenc", text: "αα" }] }],
            grammar: {
                plural: [{ ending: "", becomes: "b" }],
                native: [{ ending: "plural", enc: "testenc", text: "αα" }],
            },
        },
    };
    const before = JSON.stringify(authored);
    const configured = {
        ...config,
        languages: { test: { tag: "art-x-test", note: "skill-tongue" } },
    };
    const lexicon = serializeLexicon(lexiconsFromRecords([authored], configured).get("test"));
    expect(JSON.stringify(authored)).toBe(before);
    expect(lexicon.data.words[0].native[0].enc).toBe("demo-note-doc-testenc");
    expect(lexicon.data.affixes[0].native[0].enc).toBe("demo-note-doc-testenc");
    expect(lexicon.data.grammar.native[0].enc).toBe("demo-note-doc-testenc");
    const compiled = loaded().encodings.get("testenc");
    expect(encodeWithLanguage(compiled, "ab ba", { lexicon })).toMatchObject({
        text: "β α",
        findings: [],
    });
    expect(decodeWithLanguage(compiled, "β α", { lexicon })).toMatchObject({
        text: "ab ba",
        findings: [],
    });
    expect(encodeWithLanguage(compiled, "abb", { lexicon })).toMatchObject({
        text: "βαα",
        findings: [],
    });
    expect(encodeWithLanguage(compiled, "abab", { lexicon })).toMatchObject({
        text: "βαα",
        findings: [],
    });
    expect(decodeWithLanguage(compiled, "βαα", { lexicon })).toMatchObject({
        text: "abb",
        findings: [],
    });
    const foreign = encodingsFromRecords(
        [{ ...record, package: "other" }],
        configured,
        fonts,
    ).encodings.get("other-note-doc-testenc");
    expect(encodeWithLanguage(foreign, "ab", { lexicon })).toMatchObject({
        text: "αβ",
        findings: [],
    });
});
it("allows a Roman child to explicitly reset an inferred native face", () => {
    const result = loaded();
    const ctx: any = {
        ...config,
        encodings: result.encodings,
        faces: new Map([
            [
                "face",
                { slug: "face", class: "hl-face", family: "Face", draws: new Set([0x3b1, 0x3b2]) },
            ],
        ]),
    };
    const source = "[ab [ab]{enc=default}]{enc=testenc}";
    const resultRuns = scanRuns(source, ctx);
    expect(resultRuns.errors).toEqual([]);
    expect(resultRuns.runs[1]).toMatchObject({ enc: "default", lang: "test", font: "serif" });
    const rendered = renderRuns(source, ctx);
    expect(rendered.errors).toEqual([]);
    expect(rendered.markdown).toContain("ab");
});
it("keeps default English runs in the ordinary Markdown grammar", () => {
    const ctx = { languages: { en: { tag: "en" } } };
    expect(scanRuns("[*hello*]{lang=en}", ctx).errors).toEqual([]);
    expect(renderRuns("[*hello*]{lang=en}", ctx).markdown).toContain("*hello*");
});

it("selects a native verse encoding on the fence", () => {
    const ctx: any = {
        ...config,
        encodings: loaded().encodings,
        faces: new Map([
            [
                "face",
                { slug: "face", class: "hl-face", family: "Face", draws: new Set([0x3b1, 0x3b2]) },
            ],
        ]),
    };
    expect(scanRuns(":::verse {enc=testenc}\nab\n:::", ctx).errors).toEqual([]);
});
it("leaves malformed native entries untouched for normal required-field validation", async () => {
    const { lexiconsFromRecords, serializeLexicon } =
        await import("../engine/encoding-lexicon.mjs");
    const record = {
        type: "skill",
        subType: "language",
        shortcode: "tongue",
        package: "demo",
        data: { words: [{ form: "ab", class: "n", gloss: "one", native: [{ text: "β" }] }] },
    };
    const config = {
        contentPackage: "demo",
        languages: { test: { tag: "art-x-test", note: "skill-tongue" } },
    };
    const projected = serializeLexicon(lexiconsFromRecords([record], config).get("test"));
    expect(projected.data.words[0].native[0]).toEqual({ text: "β" });
    expect(Object.hasOwn(projected.data.words[0].native[0], "enc")).toBe(false);
});
it("counts code points before a document error in a flow mapping", () => {
    const raw = '---\ntype: doc\ndata:\n  mappings: {"😀": A, a: UNKNOWN}\n---\n';
    const bad = { ...record, raw, data: { ...data, mappings: { "😀": "A", a: "UNKNOWN" } } };
    const [finding] = encodingsFromRecords([bad], config, fonts).findings;
    const line = raw.split("\n")[3];
    expect(finding).toMatchObject({
        line: 4,
        column: [...line.slice(0, line.indexOf("UNKNOWN"))].length + 1,
    });
});
it("infers encoding metadata on raw reference labels through the same presentation model", () => {
    const ctx: any = {
        ...config,
        encodings: loaded().encodings,
        faces: new Map([
            [
                "face",
                { slug: "face", class: "hl-face", family: "Face", draws: new Set([0x3b1, 0x3b2]) },
            ],
        ]),
    };
    expect(scanRuns("[[doc-name|ab]]{enc=testenc}", ctx).errors).toEqual([]);
    const source = "[[doc-name|ab]]{enc=testenc font=serif}";
    expect(scanRuns(source, ctx).errors).toEqual([
        expect.objectContaining({
            column: source.indexOf("serif") + 1,
            message: expect.stringMatching(/not a font of the encoding/),
        }),
    ]);
});
it("reports an encoding-document finding for an encoded raw reference", () => {
    const problem = { file: "Encoding.md", line: 7, column: 3, message: "Invalid encoding rule" };
    expect(
        scanRuns("[[doc-name|ab]]{enc=testenc}", {
            encodings: new Map(),
            encodingFindings: [problem],
        }).errors,
    ).toEqual([problem]);
});
