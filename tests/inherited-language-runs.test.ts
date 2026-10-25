/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAddress } from "../engine/address.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { runContext, renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { nativeLookup, transliterate } from "../engine/map-lexicon.mjs";

const MOTHER = "\u{F0230}";
const RIVER = "\u{F0231}";
const OWN = "\u{F0232}";
const SPECIAL = "\u{F0233}";
const language = (shortcode: string, data: object) => ({
    package: "demo",
    system: "note",
    type: "skill",
    subType: "language",
    shortcode,
    data: { roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóúâêîôûëöü.-", ...data },
});
const map = {
    package: "demo",
    system: "note",
    type: "doc",
    shortcode: "mapm",
    data: {
        map: {
            name: "m",
            fonts: [{ font: "semaron-kuriale" }],
            rows: [
                ["mathira", OWN],
                ["fótamir", OWN],
            ],
        },
    },
};
const grandparent = language("elder", {
    words: [
        {
            form: "fótamir",
            class: "n",
            gloss: "river",
            variants: ["fota"],
            native: [
                { map: "m", text: RIVER },
                { map: "other", text: SPECIAL },
                { map: "m", font: "other-face", text: SPECIAL },
            ],
        },
    ],
});
const parent = language("parent", {
    family: "demo-note-skill-elder",
    writtenIn: { map: "m", font: "semaron-kuriale" },
    grammar: { plural: [{ ending: "", becomes: "s" }] },
    register: [{ name: "Ancestor", tongue: "own" }],
    words: [
        {
            form: "mathira",
            class: "n",
            gloss: "mother",
            variants: ["mater"],
            plural: "materae",
            native: [{ map: "m", text: MOTHER }],
        },
    ],
});
const daughter = language("daughter", {
    family: "demo-note-skill-parent",
    grammar: { plural: [{ ending: "", becomes: "en" }] },
    register: [{ name: "Descendant", tongue: "own" }],
    words: [],
});
let root: string;
beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "inherited-language-runs-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/script-fonts/fonts"),
        path.join(root, "node_modules/@heroiclands/fonts"),
        { recursive: true },
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const context = (child = daughter, ancestors = [parent, grandparent]) =>
    runContext(
        {
            rootDir: root,
            contentPackage: "demo",
            languages: { child: { tag: "art-x-child", note: "skill-daughter" } },
        },
        [child, ...ancestors, map],
    );
const marked = (form: string) => `[${form}]{lang=child map=m font=semaron-kuriale .nativefont}`;

describe("inherited words in mapped language runs", () => {
    for (const target of ["web", "foundry"] as const) {
        it(`renders the dictionary's inherited words on ${target}, with only the daughter configured`, () => {
            const records = [daughter, parent, grandparent, map];
            const dictionary = dictionaryAndTermRows(records).dictionary.filter(
                (row) => row.language === "demo-note-skill-daughter",
            );
            expect(dictionary.map((row) => [row.name, row.depth])).toEqual(
                expect.arrayContaining([
                    ["mathira", 1],
                    ["fótamir", 2],
                ]),
            );
            const ctx = context();
            for (const [form, native] of [
                ["mathira", MOTHER],
                ["fótamir", RIVER],
            ]) {
                const source = marked(form);
                const html = createRenderer(target).render(source, { runs: ctx });
                expect(html).toContain(`>${native}</span>`);
                expect(html).toContain('lang="art-x-child"');
                expect(scanRuns(source, ctx).errors).toEqual([]);
                expect(renderRuns(source, ctx).errors).toEqual([]);
                expect(
                    transliterate(ctx, { lang: "child", map: "m", font: "semaron-kuriale" }, form),
                ).toMatchObject({ text: native });
                const automatic = context(
                    language("daughter", {
                        ...daughter.data,
                        writtenIn: { map: "m", font: "semaron-kuriale" },
                    }),
                );
                expect(
                    createRenderer(target).render(`[${form}]{lang=child .nativefont}`, {
                        runs: automatic,
                    }),
                ).toContain(`>${native}</span>`);
            }
        });
    }

    it("uses only the nearest whole definition, discarding obsolete variants and natives", () => {
        const child = language("daughter", {
            ...daughter.data,
            words: [{ form: "mathira", class: "v", gloss: "a new sense", variants: ["ma"] }],
        });
        const ctx = context(child);
        const book = ctx.wordBooks.get("child");
        expect(book.accepts("ma")).toBe(true);
        expect(book.accepts("mater")).toBe(false);
        expect(book.accepts("materae")).toBe(false);
        expect(book.accepts("mathiraen")).toBe(false);
        expect(book.accepts("fota")).toBe(true);
        const lookup = nativeLookup(ctx.lexicons.get("child"), "m", "semaron-kuriale");
        expect(lookup("mathira")).toBeUndefined();
        expect(lookup("fótamir")).toBe(RIVER);
        expect(createRenderer("foundry").render(marked("mathira"), { runs: ctx })).toContain(
            `>${OWN}</span>`,
        );
        expect(
            scanRuns(marked("mater"), ctx).errors.some((error) =>
                error.message.includes("is not a word"),
            ),
        ).toBe(true);
        expect(nativeLookup(ctx.lexicons.get("child"), "other", "semaron-kuriale")("fótamir")).toBe(
            SPECIAL,
        );
        expect(nativeLookup(ctx.lexicons.get("child"), "m", "other-face")("fótamir")).toBe(SPECIAL);
        expect(
            nativeLookup(ctx.lexicons.get("child"), "unmatched", "semaron-kuriale")("fótamir"),
        ).toBeUndefined();
    });

    it("keeps the daughter's grammar, register and writing defaults", () => {
        const ctx = context();
        expect(ctx.wordBooks.get("child").accepts("fótamiren")).toBe(true);
        expect(ctx.wordBooks.get("child").accepts("fótamirs")).toBe(false);
        expect(ctx.wordBooks.get("child").accepts("descendant")).toBe(true);
        expect(ctx.wordBooks.get("child").accepts("ancestor")).toBe(false);
        expect(scanRuns("[mathira]{lang=child}", ctx).runs[0]).toMatchObject({
            map: undefined,
            font: undefined,
        });
        expect(ctx.lexicons.get("child").data.grammar).toBe(daughter.data.grammar);
        expect(ctx.lexicons.get("child").data.writtenIn).toBeUndefined();
    });

    it("matches override identities by exact NFC, retaining case and separators", () => {
        const old = language("parent", {
            words: [
                { form: "café", class: "n", gloss: "old", variants: ["stale"] },
                { form: "Ka", class: "n", gloss: "upper", variants: ["upper"] },
                { form: "ka-ra", class: "n", gloss: "joined" },
                { form: "ka ra", class: "n", gloss: "spaced" },
            ],
        });
        const child = language("daughter", {
            family: "demo-note-skill-parent",
            words: [
                { form: "cafe\u0301", class: "n", gloss: "new", variants: ["fresh"] },
                { form: "ka", class: "n", gloss: "lower" },
            ],
        });
        const ctx = context(child, [old]);
        expect(ctx.lexicons.get("child").words.map((word) => word.form)).toEqual([
            "cafe\u0301",
            "ka",
            "Ka",
            "ka-ra",
            "ka ra",
        ]);
        expect(ctx.wordBooks.get("child").accepts("stale")).toBe(false);
        expect(ctx.wordBooks.get("child").accepts("fresh")).toBe(true);
        expect(ctx.wordBooks.get("child").accepts("upper")).toBe(true);
    });

    it("resolves canonical, short and decoded family addresses, using the configured package", () => {
        const decoded = parseAddress("skill-parent", {
            package: "demo",
            system: "note",
            types: new Set(["skill"]),
        });
        for (const family of ["demo-note-skill-parent", "skill-parent", decoded]) {
            const child = language("daughter", { family, words: [] });
            const records = [child, parent, grandparent, map].map(
                ({ package: _package, ...record }) => record,
            );
            const ctx = runContext(
                {
                    rootDir: root,
                    contentPackage: "demo",
                    languages: { child: { tag: "art-x-child", note: "skill-daughter" } },
                },
                records,
            );
            expect(scanRuns(marked("mathira"), ctx).errors).toEqual([]);
            expect(nativeLookup(ctx.lexicons.get("child"), "m", "semaron-kuriale")("mathira")).toBe(
                MOTHER,
            );
        }
        for (const family of [null, 42, {}, [], { invalid: "parent" }]) {
            const child = language("daughter", {
                family,
                words: [{ form: "mathira", class: "n", gloss: "mother" }],
            });
            expect(
                context(child)
                    .lexicons.get("child")
                    .words.map((word) => word.form),
            ).toEqual(["mathira"]);
        }
    });

    it("stops at missing parents and cycles without losing available words", () => {
        const child = language("daughter", {
            family: "demo-note-skill-parent",
            words: [{ form: "mathira", class: "n", gloss: "mother" }],
        });
        const cyclic = language("parent", {
            family: "demo-note-skill-daughter",
            words: [{ form: "fótamir", class: "n", gloss: "river" }],
        });
        expect(
            context(child, [cyclic])
                .lexicons.get("child")
                .words.map((word) => word.form),
        ).toEqual(["mathira", "fótamir"]);
        expect(
            context(child, [])
                .lexicons.get("child")
                .words.map((word) => word.form),
        ).toEqual(["mathira"]);
        expect(
            context(child, [{ ...cyclic, type: "doc" }])
                .lexicons.get("child")
                .words.map((word) => word.form),
        ).toEqual(["mathira"]);
    });
});
