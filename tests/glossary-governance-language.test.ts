/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

import { entryLanguage } from "../engine/culture-reach.mjs";
import { dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { checkGlossary } from "../engine/glossary-entries.mjs";

const address = (type: string, shortcode: string) => `demo-note-${type}-${shortcode}`;
const SINALE = address("skill", "sinalelng");
const TRADE = address("skill", "tradelng");
const CULTURE = address("lore", "sinaleclt");
const WARDENS = address("affiliation", "wardens");

function record(
    type: string,
    shortcode: string,
    data: object,
    subType?: string,
    derived: object = {},
) {
    return {
        package: "demo",
        type,
        shortcode,
        name: { full: shortcode },
        data,
        ...(subType ? { subType } : {}),
        ...derived,
    };
}

/** The validator and row builder receive the same notes in their own shapes. */
function corpus(title: string, stated: boolean) {
    const culture = record(
        "lore",
        "sinaleclt",
        {
            lang: "sinale",
            glossary: [{ name: title, common: true, ...(stated ? { language: SINALE } : {}) }],
        },
        "culture",
        { lang: "sinale" },
    );
    const records = [
        record("skill", "sinalelng", {}, "language", { languageCode: "sinale" }),
        record("skill", "tradelng", {}, "language", { languageCode: "trade" }),
        culture,
        record(
            "affiliation",
            "wardens",
            {
                culture: CULTURE,
                lang: "trade",
                governance: {
                    ranks: [
                        { level: 0, title: "Outcast", description: "Cast out." },
                        { level: 1, title, description: "A captain of the order." },
                    ],
                },
            },
            "order",
            { lang: "trade" },
        ),
    ];
    // A link-index note carries the derived language beside its frontmatter.
    const notes = records.map(({ package: _, lang, languageCode, ...fm }: any) => ({
        fm,
        type: fm.type,
        file: `${fm.shortcode}.md`,
        raw: "",
        ...(lang ? { lang } : {}),
        ...(languageCode ? { languageCode } : {}),
    }));
    const byAddress = new Map(
        notes.map((note) => [address(note.fm.type, note.fm.shortcode), note]),
    );
    const index = {
        contentPackage: "demo",
        types: new Set(records.map((note) => note.type)),
        packages: new Set(["demo"]),
        notes,
        addressHit: (key: string) => byAddress.get(key),
    };
    return { records, index, culture: notes.find((note) => note.fm.shortcode === "sinaleclt")! };
}

describe("a reached governance title's explicit language", () => {
    for (const title of ["Knight-Captain", "Subject"]) {
        it(`keeps an accepted ${title} entry when its resolved language is stated`, () => {
            const variants = [false, true].map((stated) => {
                const { records, index, culture } = corpus(title, stated);
                const entry = (culture.fm.data as { glossary: object[] }).glossary[0];
                expect(entryLanguage(index, culture, entry)).toBe(SINALE);
                expect(checkGlossary(culture, { index })).toEqual([]);
                const { terms } = dictionaryAndTermRows(records);
                const own = terms.find((row) => row.owner === CULTURE && row.name === title);
                expect(own).toMatchObject({
                    language: SINALE,
                    common: true,
                    senses: [{ text: "A captain of the order.", bodies: [WARDENS] }],
                });
                expect(
                    terms.find((row) => row.owner === WARDENS && row.name === title),
                ).toMatchObject({
                    common: false,
                });
                return own;
            });
            expect(variants[1]).toEqual(variants[0]);
        });
    }
});
