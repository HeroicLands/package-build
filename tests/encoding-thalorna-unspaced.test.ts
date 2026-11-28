// SPDX-License-Identifier: GPL-3.0-or-later
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { encodeText } from "../engine/encoding.mjs";
import { decodeWithLanguage, encodeWithLanguage } from "../engine/encoding-language.mjs";
import { encodingsFromRecords } from "../engine/encoding-notes.mjs";
import { encodingFor, lexiconsFromRecords } from "../engine/encoding-lexicon.mjs";
import { renderRuns } from "../engine/content-scripts.mjs";

// The encoding declarations, language words and font codes are Thalorna's own,
// kept under tests/fixtures/thalorna-unspaced with the revision they came from.
const fixture = (name: string) =>
    YAML.parse(
        fs.readFileSync(
            new URL(`./fixtures/thalorna-unspaced/${name}.yaml`, import.meta.url),
            "utf8",
        ),
    );
const NOTES = ["tanttengchouenc", "jurttengchouenc", "khelzethuenc"];
const lexicons = fixture("lexicons");
const fonts: any = { root: "/installed/fonts", version: "1.4.1", manifest: fixture("fonts") };
const config = {
    contentPackage: "thalorna",
    languages: {
        tant: { tag: "art-x-tant", note: lexicons.tant.shortcode },
        jurt: { tag: "art-x-jurt", note: lexicons.jurt.shortcode },
        khel: { tag: "art-x-khel", note: lexicons.khel.shortcode },
    },
};
const records = NOTES.map((shortcode) => {
    const note = fixture(shortcode);
    return {
        ...note,
        package: "thalorna",
        file: { path: `Lore/Scripts/${shortcode}.md` },
    };
});
const tongues = Object.values<any>(lexicons).map((tongue) => ({
    type: "skill",
    subType: "language",
    shortcode: tongue.shortcode,
    package: "thalorna",
    data: { roman: tongue.roman, words: tongue.words },
}));
const loaded = encodingsFromRecords(records, config, fonts);
const ctx: any = {
    ...config,
    encodings: loaded.encodings,
    lexicons: lexiconsFromRecords(tongues, config),
    faces: new Map(
        fonts.manifest.families.map((family: any) => [
            family.class.replace(/^hl-/, ""),
            {
                slug: family.class.replace(/^hl-/, ""),
                class: family.class,
                family: family.family,
                draws: new Set(
                    family.codepoints.map((entry: any) => parseInt(entry.codepoint.slice(2), 16)),
                ),
            },
        ]),
    ),
};
const language = (lang: string, font: string, enc: string) => {
    const selection = encodingFor(ctx, { lang, font, enc } as any);
    if (!selection) throw new Error(`no encoding ${enc}`);
    return { enc: loaded.encodings.get(enc), lexicon: selection.lexicon };
};
const signs = (lang: string, enc: string, ...forms: string[]) =>
    forms
        .map(
            (form) =>
                lexicons[lang].words
                    .find((word: any) => word.form === form)
                    .native.find((native: any) => native.enc === enc).text,
        )
        .join("");

describe("the real Thalorna encoding notes that declare word-spaces none", () => {
    it("load without findings and are unspaced", () => {
        expect(loaded.findings).toEqual([]);
        for (const shortcode of NOTES) {
            expect(fixture(shortcode).data.rules["word-spaces"]).toBe("none");
            expect(loaded.encodings.get(shortcode)?.separator).toBeFalsy();
        }
    });

    describe.each([
        ["tant", "tanttengchouenc", "teng-chou", ["ho", "jing", "shou", "tou"]],
        ["jurt", "jurttengchouenc", "teng-chou", ["shu", "we", "chai"]],
        ["khel", "khelzethuenc", "khelathi-zethu-glyphs", ["zelar", "zuqat", "meglu", "agu"]],
    ] as const)("%s", (lang, shortcode, font, forms) => {
        const { enc, lexicon } = language(lang, font, shortcode);
        const [first, second, third] = forms;
        const encode = (text: string) => encodeWithLanguage(enc, text, { lexicon });
        const decode = (text: string) => decodeWithLanguage(enc, text, { lexicon });
        const period = encodeText(enc, ".");

        it("writes the signs of consecutive words side by side", () => {
            expect(encode(`${first} ${second}`)).toMatchObject({
                text: signs(lang, shortcode, first, second),
                findings: [],
            });
            expect(encode(`${first}  ${second}\n\t${third}.`)).toMatchObject({
                text: signs(lang, shortcode, first, second, third) + period,
                findings: [],
            });
        });

        it("reads the adjacent signs back with a space after each word", () => {
            expect(decode(signs(lang, shortcode, first, second))).toMatchObject({
                text: `${first} ${second}`,
                findings: [],
            });
            expect(decode(signs(lang, shortcode, first, second, third) + period)).toMatchObject({
                text: `${first} ${second} ${third}.`,
                findings: [],
            });
        });

        it("round-trips a passage with its spacing normalized", () => {
            const written = encode(`${first}  ${second}\n\t${third}.`).text;
            expect(decode(written).text).toBe(`${first} ${second} ${third}.`);
        });
    });

    it("keeps a literal span between two words at the word boundaries", () => {
        const { enc, lexicon } = language("tant", "teng-chou", "tanttengchouenc");
        const written = encodeWithLanguage(enc, "ho ⟦TOU⟧ jing", { lexicon });
        expect(written.findings).toEqual([]);
        expect(decodeWithLanguage(enc, written.text, { lexicon })).toMatchObject({
            text: "ho ⟦TOU⟧ jing",
            findings: [],
        });
    });

    it("writes the enc= span of a prose passage with its signs side by side", () => {
        const rendered = renderRuns("[ho  jing]{enc=tanttengchouenc}", ctx);
        expect(rendered.errors).toEqual([]);
        expect(rendered.markdown).toContain(signs("tant", "tanttengchouenc", "ho", "jing"));
    });
});
