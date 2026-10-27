/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { parse } from "acorn";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function browserGraph(file: string, seen = new Set<string>()): string[] {
    if (seen.has(file)) return [];
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    const problems: string[] = [];
    const tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const imports = new Set<string>();
    function walk(node: any) {
        if (!node || typeof node !== "object") return;
        if (
            [
                "ImportDeclaration",
                "ExportNamedDeclaration",
                "ExportAllDeclaration",
                "ImportExpression",
            ].includes(node.type) &&
            node.source
        ) {
            if (typeof node.source.value !== "string") problems.push(`${file}: dynamic import`);
            else imports.add(node.source.value);
        }
        if (node.type === "Identifier" && node.name === "process")
            problems.push(`${file}: process`);
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === "object") walk(value);
        }
    }
    walk(tree);
    for (const name of imports) {
        if (name.startsWith("node:") || builtinModules.includes(name))
            problems.push(`${file}: ${name}`);
        else if (name.startsWith("."))
            problems.push(...browserGraph(path.resolve(path.dirname(file), name), seen));
        else problems.push(`${file}: unverified package ${name}`);
    }
    return problems;
}
describe("browser converter import graph", () => {
    it("has no Node runtime dependency", () => {
        expect(browserGraph(path.join(root, "convert.mjs"))).toEqual([]);
    });
    it("detects the existing Node-dependent conversion graph", () => {
        expect(browserGraph(path.join(root, "engine/index-records.mjs"))).not.toEqual([]);
    });
});

import { encode, decode, validateData } from "../convert.mjs";
import { compileEncoding } from "../engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
import { build } from "esbuild";
import { template, codes, encodingName, languageNote } from "./helpers/encoding-note.js";
const bare = {
    format: 2,
    contentPackage: "demo",
    encodings: { [encodingName]: { data: template, codes } },
    languages: { aelw: { name: "Aelwythi" } },
};
describe("browser conversion parity", () => {
    it("bundles for a browser without Node shims", async () => {
        const result = await build({
            entryPoints: [path.join(root, "convert.mjs")],
            bundle: true,
            platform: "browser",
            format: "esm",
            write: false,
            logLevel: "silent",
        });
        expect(result.outputFiles[0].text).toContain("validateData");
    });
    it("uses the same authored template and glyph codes as the pure compiler", () => {
        const compiled = compileEncoding(template, { codes, name: encodingName });
        for (const roman of [
            "say",
            "thikke",
            "Adwell",
            "nyá",
            "⟦ANKRON_MIN⟧",
            "a b.",
            "⟦U+E0112⟧",
        ]) {
            const options = { enc: encodingName };
            const native = encode(bare, null, roman, options);
            const expected = encodeWithLanguage(compiled, roman);
            expect(native).toEqual({ text: expected.text, findings: expected.findings });
            expect(decode(bare, null, native.text, options)).toMatchObject({
                text: decodeWithLanguage(compiled, native.text).text,
            });
        }
        expect(encode(bare, null, "c", { enc: encodingName })).toMatchObject({
            text: "",
            findings: [{ offset: 0, line: 1, column: 1 }],
        });
    });
    it("keeps vocabulary and complete registered names identical to the build", () => {
        const lexicon = {
            language: "aelw",
            data: { words: languageNote.data.words, register: languageNote.data.register },
        };
        const data = { ...bare, languages: { aelw: { name: "Aelwythi", lexicon } } };
        const compiled = compileEncoding(template, { codes, name: encodingName });
        for (const form of ["say", "saith", "thikke", "Adwell"]) {
            const expected = encodeWithLanguage(compiled, form, { lexicon });
            const actual = encode(data, "aelw", form, { enc: "aelwsemaronenc" });
            expect(actual).toEqual(expected);
            expect(decode(data, "aelw", actual.text, { enc: encodingName })).toEqual(
                decodeWithLanguage(compiled, actual.text, { lexicon }),
            );
        }
        expect(encode(data, "aelw", "say")).toEqual({ text: "say", findings: [] });
    });
    it("validates the versioned shape, language agreement and closed template", () => {
        expect(validateData(bare)).toBe(bare);
        for (const value of [
            { ...bare, format: 1 },
            { ...bare, extra: true },
            { ...bare, languages: {} },
            {
                ...bare,
                encodings: { [encodingName]: { data: { ...template, codes: "other" }, codes } },
            },
            { ...bare, languages: { aelw: { name: "Aelwythi", enc: encodingName } } },
            {
                ...bare,
                languages: {
                    aelw: { name: "Aelwythi", lexicon: { language: "aelw", data: { words: {} } } },
                },
            },
        ])
            expect(() => validateData(value)).toThrow();
        expect(() => encode(bare, "missing", "a")).toThrow(/Unknown language/);
        expect(() => encode(bare, null, "a", { enc: "missing" })).toThrow(/encoding/);
        expect(encode(bare, null, "a")).toEqual({ text: "a", findings: [] });
        const other = { ...bare, languages: { ...bare.languages, other: { name: "Other" } } };
        expect(() => encode(other, "other", "a", { enc: encodingName })).toThrow(
            /writes aelw.*other/,
        );
    });
});
it("infers the encoding's language for lexical native overrides and reverse reading", () => {
    const lexicon = {
        language: "aelw",
        data: {
            words: [
                {
                    form: "say",
                    class: "v",
                    gloss: "speak",
                    native: [{ enc: encodingName, text: "\u{F0231}" }],
                },
            ],
        },
    };
    const data = { ...bare, languages: { aelw: { name: "Aelwythi", lexicon } } };
    expect(encode(data, null, "say", { enc: "aelwsemaronenc" })).toMatchObject({
        text: "\u{F0231}",
        findings: [],
    });
    expect(decode(data, undefined, "\u{F0231}", { enc: encodingName })).toMatchObject({
        text: "say",
        findings: [],
    });
});
it("resolves short document references in the consumer namespace and admits full foreign references", () => {
    const peer = "peer-note-doc-aelwsemaronenc";
    const foreign = {
        data: {
            language: "aelw",
            font: "semaron-kuriale",
            mappings: { a: "ANKRON_MAJ" },
            rules: { normalization: "NFC", matching: "longest-first" },
        },
        codes,
    };
    const lexicon = {
        language: "aelw",
        data: {
            words: [
                {
                    form: "a",
                    class: "n",
                    gloss: "a word",
                    native: [{ enc: encodingName, text: "\u{F0231}" }],
                },
            ],
        },
    };
    const data = {
        ...bare,
        encodings: { ...bare.encodings, [peer]: foreign },
        languages: { aelw: { name: "Aelwythi", lexicon } },
    };
    for (const enc of [
        "aelwsemaronenc",
        "doc-aelwsemaronenc",
        "doc/aelwsemaronenc",
        "note-doc-aelwsemaronenc",
        encodingName,
    ])
        expect(encode(data, null, "a", { enc })).toMatchObject({ text: "\u{F0231}", findings: [] });
    expect(encode(data, null, "a", { enc: peer })).toMatchObject({
        text: "\u{F0200}",
        findings: [],
    });
    const onlyForeign = { ...data, encodings: { [peer]: foreign } };
    expect(() => encode(onlyForeign, null, "a", { enc: "aelwsemaronenc" })).toThrow(
        /Unknown encoding document/,
    );
    expect(encode(onlyForeign, null, "a", { enc: peer })).toMatchObject({
        text: "\u{F0200}",
        findings: [],
    });
});
it("supports hyphenated own and foreign package identities without foreign suffix inference", () => {
    const own = "own-world-note-doc-aelwsemaronenc",
        foreign = "sohl-thalorna-note-doc-aelwsemaronenc";
    const data = {
        ...bare,
        contentPackage: "own-world",
        encodings: {
            [own]: bare.encodings[encodingName],
            [foreign]: {
                data: {
                    language: "aelw",
                    font: "semaron-kuriale",
                    mappings: { a: "ANKRON_MAJ" },
                    rules: { normalization: "NFC", matching: "longest-first" },
                },
                codes,
            },
        },
    };
    expect(encode(data, null, "a", { enc: "aelwsemaronenc" })).toMatchObject({
        text: "\u{F0230}",
        findings: [],
    });
    expect(encode(data, null, "a", { enc: own })).toMatchObject({
        text: "\u{F0230}",
        findings: [],
    });
    expect(encode(data, null, "a", { enc: foreign })).toMatchObject({
        text: "\u{F0200}",
        findings: [],
    });
    expect(() =>
        encode({ ...data, encodings: { [foreign]: data.encodings[foreign] } }, null, "a", {
            enc: "aelwsemaronenc",
        }),
    ).toThrow(/Unknown encoding document/);
});
