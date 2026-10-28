// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    compileRows as compileEncoding,
    encodePieces,
    encodeText,
    decodeText,
    EncodingError,
} from "../engine/encoding.mjs";

const directory = new URL("./fixtures/encodings/", import.meta.url);
const vectors = JSON.parse(fs.readFileSync(new URL("vectors.json", directory), "utf8"));
describe("published encoding conformance", () => {
    for (const [name, samples] of Object.entries(vectors)) {
        it(`${name} works from its published file alone`, () => {
            const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-alone-"));
            try {
                const alone = path.join(scratch, `${name}.json`);
                fs.copyFileSync(new URL(`${name}.json`, directory), alone);
                const data = JSON.parse(fs.readFileSync(alone, "utf8"));
                const encoding = compileEncoding(data);
                expect(decodeText(encoding, encodeText(encoding, "⟦U+00E1⟧"))).toBe("⟦U+00E1⟧");
                for (const code of ["U+110000", "UNDEFINED_CODE_9999"])
                    refuses(() => encodeText(encoding, `⟦${code}⟧`), 1, 1, 2);
                if (data.codes.length) {
                    const first = data.codes[0];
                    const [code, target] = Array.isArray(first) ? first : [first.from, first.to];
                    expect(encodeText(encoding, `⟦${code}⟧`)).toBe(`\u{E0112}${target}\u{E0113}`);
                    expect(decodeText(encoding, `\u{E0112}${target}\u{E0113}`)).toBe(`⟦${code}⟧`);
                }
                for (const sample of samples as any[]) {
                    if (sample.refused) {
                        let refusal: any;
                        try {
                            encodeText(encoding, sample.roman, {
                                font: sample.face,
                                verse: sample.verse,
                            });
                        } catch (error) {
                            refusal = error;
                        }
                        expect(refusal, JSON.stringify(sample)).toBeDefined();
                        expect([refusal.line, refusal.column], JSON.stringify(sample)).toEqual(
                            sample.refused,
                        );
                    } else {
                        expect(
                            encodeText(encoding, sample.roman, {
                                verse: sample.verse,
                                font: sample.face,
                            }),
                            sample.roman,
                        ).toBe(sample.unicode);
                        expect(
                            decodeText(encoding, sample.unicode, { font: sample.face }),
                            sample.roman,
                        ).toBe(sample.decoded);
                    }
                }
            } finally {
                fs.rmSync(scratch, { recursive: true, force: true });
            }
        });
    }
});

const definition = (extra: Record<string, unknown> = {}) => ({
    name: "sample",
    fonts: ["first", "second"],
    accepts: ["a-z", "0-9", "^", "/", ".", "😀"],
    separator: " ",
    vowels: "aeiou",
    rows: [
        ["a", "A"],
        ["b", "B"],
        ["c", "C"],
        ["x", "X"],
        ["y", "Y"],
        ["/", "L"],
        ["^", "H"],
        [".", "P"],
        ["😀", "🙂"],
    ],
    codes: [
        ["SUN", "☀"],
        ["MOON", "☾"],
        ["*", "×"],
    ],
    ...extra,
});
function refuses(run: () => unknown, offset: number, line: number, column: number) {
    let caught: any;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(EncodingError);
    expect({ offset: caught.offset, line: caught.line, column: caught.column }).toEqual({
        offset,
        line,
        column,
    });
}

describe("encoding semantics", () => {
    it("tries the selected face before shared rows, with default first face, longest match, conditions and authored ties", () => {
        const e = compileEncoding(
            definition({
                faces: { first: { rows: [["a", "α"]] } },
                rows: [
                    ["a", "A"],
                    ["b", "B"],
                    ["c", "C"],
                    ["x", "X"],
                    ["y", "Y"],
                    ["ab", "plain"],
                    { from: "ab", to: "vowel", before: "vowel" },
                    { from: "ab", to: "consonant", before: "consonant" },
                    { from: "x", to: "start", at: "start" },
                    { from: "y", to: "end", at: "end" },
                    ["bc", "first"],
                    ["bc", "later"],
                ],
            }),
        );
        expect(encodeText(e, "aba")).toBe("αBα"); // face rows win even over longer shared rows
        expect(encodeText(e, "aba abc ab", { font: "second" })).toBe("vowelA consonantC plain");
        expect(encodeText(e, "xay axya", { font: "second" })).toBe("startAend AXYA");
        expect(encodeText(e, "bc", { font: "second" })).toBe("first");
        expect(decodeText(e, "αB")).toBe("ab");
        expect(decodeText(e, "AB", { font: "second" })).toBe("ab");
        expect(() => encodeText(e, "a", { font: "missing" })).toThrow(/serves/);
    });
    it("normalizes exactly Zs and tab through carriage return, preserving UTF16 offsets and codepoint columns", () => {
        const e = compileEncoding(definition());
        expect(encodeText(e, "a\u00A0\u2003\t\v\f b")).toBe(encodeText(e, "a b"));
        for (const c of ["\u0085", "\u2028", "\u2029", "\uD800", "\uDC00"])
            refuses(() => encodeText(e, `😀\n${c}`), 3, 2, 1);
        refuses(() => encodeText(e, "😀#"), 2, 1, 2);
        refuses(() => decodeText(e, "🙂#"), 2, 1, 2);
        expect(
            encodePieces(e, "😀\t\u2003ab").map(({ from, to, start, end }) => ({
                from,
                to,
                start,
                end,
            })),
        ).toEqual([
            { from: "😀", to: "🙂", start: 0, end: 2 },
            { from: "\t\u2003", to: " ", start: 2, end: 4 },
            { from: "a", to: "A", start: 4, end: 5 },
            { from: "b", to: "B", start: 5, end: 6 },
        ]);
    });
    it("uses inline codes and strict Unicode scalars, and refuses misplaced or nested markers", () => {
        const e = compileEncoding(definition());
        expect(decodeText(e, encodeText(e, "⟦SUN MOON*U+00E1 U+10FFFF U+0000⟧"))).toBe(
            "⟦SUN MOON*U+00E1 U+10FFFF U+0000⟧",
        );
        for (const code of ["U+110000", "U+D800", "U+00e1", "U+E1", "U+0000000", "UNKNOWN", "."])
            refuses(() => encodeText(e, `😀⟦${code}⟧`), 3, 1, 3);
        refuses(() => encodeText(e, "a⟦SUN⟦MOON⟧"), 5, 1, 6);
        refuses(() => encodeText(e, "a⟦SUN"), 1, 1, 2);
        refuses(() => encodeText(e, "a⟧"), 1, 1, 2);
        refuses(() => decodeText(e, "\u{E0112}\uD800\u{E0113}"), 2, 1, 2);
    });
    it("handles conditional line starts, canonical duplicate/omitted rows, and zero-space decoding without guessing", () => {
        const e = compileEncoding(
            definition({
                roundTrip: "canonical",
                separator: "",
                rows: [
                    ["a", "A"],
                    ["b", "B"],
                    ["x", "A"],
                    [".", ""],
                    ["^", "H"],
                    { from: "^", to: "head", at: "line-start" },
                    ["/", "line"],
                ],
            }),
        );
        expect(encodeText(e, "a x.b")).toBe("AAB");
        expect(decodeText(e, "AAB")).toBe("aab");
        expect(encodeText(e, "^^a\n^b")).toBe("headheadAlineheadB");
        expect(encodeText(e, "a^b")).toBe("AHB");
    });
    it("writes verse lines, stanzas and cantos and retains their authored source offsets", () => {
        const e = compileEncoding(
            definition({
                controls: {
                    verseStanza: "S",
                    verseCanto: "K",
                    literalOpen: "\u{E0112}",
                    literalClose: "\u{E0113}",
                },
            }),
        );
        expect(encodeText(e, "a\r\nb\n\n a\n\n***\r\nb", { verse: true })).toBe("ALBSASKB");
        expect(decodeText(e, "ALBSASKB")).toBe("a/b\n\na\n\n***b");
        expect(encodeText(e, "a\nb")).toBe("A B");
    });
    it("rejects unresolved references and malformed schema at its key without mutating input", () => {
        for (const key of ["extends", "codage", "names"]) {
            const d = definition({ [key]: "elsewhere.json" });
            expect(() => compileEncoding(d)).toThrow(expect.objectContaining({ key }));
        }
        for (const [extra, key] of [
            [{ controls: { literalOpen: "wrong" } }, "controls.literalOpen"],
            [
                {
                    rows: [
                        ["a", "A"],
                        ["b", "A"],
                    ],
                },
                "rows.1",
            ],
            [{ rows: [{ from: "a", to: "A", before: "after" }] }, "rows.0.before"],
            [{ rows: [["a", "\uD800"]] }, "rows.0.to"],
            [{ accepts: ["z-a"] }, "accepts.0"],
            [{ faces: { absent: { rows: [] } } }, "faces.absent"],
        ] as [Record<string, unknown>, string][])
            expect(() => compileEncoding(definition(extra))).toThrow(
                expect.objectContaining({ key }),
            );
        const input = definition();
        const before = JSON.stringify(input);
        encodeText(compileEncoding(input), "ab");
        expect(JSON.stringify(input)).toBe(before);
    });
    it("bundles for a browser without external Node modules", async () => {
        const { build } = await import("esbuild");
        const result = await build({
            entryPoints: [new URL("../engine/encoding.mjs", import.meta.url).pathname],
            bundle: true,
            platform: "browser",
            write: false,
            metafile: true,
        });
        expect(Object.keys(result.metafile!.inputs).sort()).toEqual([
            "engine/encoding-integrity.mjs",
            "engine/encoding-standard.mjs",
            "engine/encoding-template.mjs",
            "engine/encoding.mjs",
        ]);
        expect(result.outputFiles).toHaveLength(1);
    });
});

it("quotes reserved literal payload controls without hiding the outer close", () => {
    const open = "\u{E0112}",
        close = "\u{E0113}",
        escape = "\u{E0115}",
        brace = "\u{E015B}";
    const e = compileEncoding(
        definition({
            codes: [
                ["OPEN", open],
                ["CLOSE", close],
                ["ESCAPE", escape],
                ["BRACE", brace],
            ],
        }),
    );
    const encoded = encodeText(e, "⟦OPEN CLOSE ESCAPE BRACE⟧");
    expect(encoded).toBe(open + escape + open + escape + close + escape + escape + brace + close);
    expect(decodeText(e, encoded)).toBe("⟦OPEN CLOSE ESCAPE BRACE⟧");
    for (const payload of [escape + "a", escape])
        refuses(() => decodeText(e, open + payload), 2, 1, 2);
    refuses(() => decodeText(e, open + escape + close), 0, 1, 1);
});
