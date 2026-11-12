/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseAddress } from "../engine/address.mjs";
import { resolveItemDefaults } from "../engine/system-item-entries.mjs";
import { BEING_LOOK_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { parseBeingHeight, parseBeingWeight } from "../engine/being-measurements.mjs";
import { FRAME_MASS_INDEX, profileLookKeys } from "../engine/appearance-profile.mjs";
import {
    appearanceParagraph,
    generateNpc,
    npcDefaults,
    npcSpecProblems,
} from "../engine/npc-generate.mjs";

/**
 * The engine behind `package-build npc new`: a spec in, a complete being note
 * out, drawn from a culture's appearance profile and its language's name lists,
 * and seeded by the spec.
 */

const PROFILE_LOOK_KEYS = profileLookKeys(BEING_LOOK_VOCABULARY);

const PROFILE = {
    frame: { light: 2, medium: 5, heavy: 2 },
    eye_color: { brown: 6, dark_brown: 3, hazel: 1 },
    hair_color: { black: 6, dark_brown: 3 },
    skin_color: { tawny: 5, olive: 3, brown: 2 },
    complexion: { clear: 3, weathered: 2, smooth: 2 },
    height: {
        female: { min: `4' 11"`, max: `5' 8"` },
        male: { min: `5' 4"`, max: `6' 3"` },
    },
};

const KIN = ["Zekar", "Ûl", "Else", ...Array.from({ length: 60 }, (_, i) => `Number ${i}`)];

const NAME_LISTS = {
    pattern: "{given} {kin}",
    given: {
        female: ["Agosi", "Person", "Rethutê"],
        male: ["Ahmetega", "Person", "Someone", "Zâra"],
    },
    kin: KIN,
};

const CONTEXT = {
    profile: PROFILE,
    names: NAME_LISTS,
    language: "demo-note-skill-khelathi",
    currentDate: "720.300",
    dateContext: { daysPerYear: 365 },
    defaults: { icon: "icon-person", species: "humanflk", packFolder: "regkhfolk" },
    taken: new Set(["ahmetegazeka"]),
};

const spec = (full: string, extra: Record<string, unknown> = {}) => ({
    name: { full },
    data: { culture: "khelathi", gender: "male", ...extra },
});

/** A spec that states no name. */
const unnamed = (extra: Record<string, unknown> = {}) => ({
    data: { culture: "khelathi", gender: "male", ...extra },
});

/** The frontmatter and body of a generated note's text. */
function split(text: string) {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!match) throw new Error(`not a note:\n${text}`);
    return { fm: YAML.parse(match[1]), body: match[2] };
}

const NAMES = Array.from({ length: 60 }, (_, i) => `Person Number ${i}`);

/** The vocabulary key a profile key draws its words from. */
const vocabularyKey = (key: string) =>
    Object.keys(BEING_LOOK_VOCABULARY).find((name) => name.split(".").at(-1) === key) as string;

describe("a generated npc", () => {
    it("is the same note for the same spec", () => {
        const a = generateNpc(spec("Ahmetega Zekar"), CONTEXT).text;
        const b = generateNpc(spec("Ahmetega Zekar"), CONTEXT).text;
        expect(a).toBe(b);
    });

    it("draws culture and occupation items independently, without their chances", () => {
        const context = {
            ...CONTEXT,
            cultureItems: [
                { key: "always", model: "weapon-sword" },
                {
                    key: "certain",
                    name: "Coat",
                    kind: "clothing",
                    chance: 100,
                    system: { weight: 2 },
                },
                { key: "never", name: "Hat", kind: "clothing", chance: 0 },
            ],
            occupationItems: [{ key: "tool", name: "Hammer", kind: "miscgear", chance: 100 }],
        };
        const result = split(generateNpc(spec("Ahmetega Zekar"), context).text).fm.data.items;
        expect(result).toEqual([
            { key: "always", model: "weapon-sword" },
            { key: "certain", name: "Coat", kind: "clothing", system: { weight: 2 } },
            { key: "tool", name: "Hammer", kind: "miscgear" },
        ]);
        expect(split(generateNpc(spec("Ahmetega Zekar"), context).text).fm.data.items).toEqual(
            result,
        );
    });

    it("varies seeded item draws without changing unrelated draws", () => {
        const items = Array.from({ length: 16 }, (_, i) => ({
            key: `item${i}`,
            name: `Item ${i}`,
            kind: "miscgear",
            chance: 50,
        }));
        const results = Array.from({ length: 8 }, (_, i) => {
            const base = split(
                generateNpc(spec("Ahmetega Zekar"), { ...CONTEXT, seed: String(i) }).text,
            ).fm;
            const withItems = split(
                generateNpc(spec("Ahmetega Zekar"), {
                    ...CONTEXT,
                    seed: String(i),
                    cultureItems: items,
                }).text,
            ).fm;
            expect(withItems.data.appearance).toEqual(base.data.appearance);
            return JSON.stringify(withItems.data.items);
        });
        expect(new Set(results).size).toBeGreaterThan(1);
    });

    it("keeps occupation draws stable when a culture item is added", () => {
        const occupationItems = Array.from({ length: 16 }, (_, i) => ({
            key: `job${i}`,
            name: `Tool ${i}`,
            kind: "miscgear",
            chance: 50,
        }));
        const drawn = (cultureItems: object[]) =>
            split(
                generateNpc(spec("Ahmetega Zekar"), {
                    ...CONTEXT,
                    seed: "independent",
                    cultureItems,
                    occupationItems,
                }).text,
            ).fm.data.items.filter((item: { key: string }) => item.key.startsWith("job"));
        expect(drawn([])).toEqual(drawn([{ key: "bag", name: "Bag", kind: "container" }]));
    });

    it("replaces culture entries with drawn occupation entries sharing a key", () => {
        const cultureItems = [{ key: "shared", name: "Bag", kind: "container", chance: 100 }];
        const identical = [{ kind: "container", name: "Bag", key: "shared" }];
        const context = { ...CONTEXT, cultureItems, occupationItems: identical };
        expect(split(generateNpc(spec("Ahmetega Zekar"), context).text).fm.data.items).toEqual(
            identical,
        );
        expect(() =>
            generateNpc(spec("Ahmetega Zekar"), {
                ...CONTEXT,
                cultureItems: [identical[0], identical[0]],
            }),
        ).toThrow(/shared/);
        expect(cultureItems[0].chance).toBe(100);
        expect(
            split(
                generateNpc(spec("Ahmetega Zekar"), {
                    ...context,
                    occupationItems: [{ ...identical[0], name: "Box", chance: 100 }],
                }).text,
            ).fm.data.items,
        ).toEqual([{ ...identical[0], name: "Box" }]);
        expect(
            split(
                generateNpc(spec("Ahmetega Zekar"), {
                    ...context,
                    occupationItems: [{ ...identical[0], name: "Box", chance: 0 }],
                }).text,
            ).fm.data.items,
        ).toEqual(identical);
        expect(
            split(
                generateNpc(spec("Ahmetega Zekar", { items: [] }), {
                    ...context,
                    occupationItems: [{ ...identical[0], name: "Box" }],
                }).text,
            ).fm.data.items,
        ).toEqual([]);
    });

    it("rejects a repeated key in either source even when an entry has zero chance", () => {
        const first = { key: "shared", name: "Bag", kind: "container" };
        const never = { key: "shared", name: "Box", kind: "container", chance: 0 };
        for (const source of ["cultureItems", "occupationItems"]) {
            for (const items of [
                [first, never],
                [never, first],
            ]) {
                expect(() =>
                    generateNpc(spec("Ahmetega Zekar"), { ...CONTEXT, [source]: items }),
                ).toThrow(/shared/);
            }
        }
    });

    it("keeps a generated model reference responsive to later model changes", () => {
        const result = generateNpc(spec("Ahmetega Zekar"), {
            ...CONTEXT,
            cultureItems: [
                { key: "tool", model: "demo-note-miscgear-tool", system: { quantity: 2 } },
            ],
        });
        const entry = split(result.text).fm.data.items[0];
        expect(entry).toEqual({
            key: "tool",
            model: "demo-note-miscgear-tool",
            system: { quantity: 2 },
        });
        expect(
            resolveItemDefaults(entry, {
                data: { kind: "miscgear", name: "Hammer", system: { weight: 3 } },
            }),
        ).toMatchObject({ name: "Hammer", system: { quantity: 2, weight: 3 } });
        expect(
            resolveItemDefaults(entry, {
                data: { kind: "miscgear", name: "Mallet", system: { weight: 4 } },
            }),
        ).toMatchObject({ name: "Mallet", system: { quantity: 2, weight: 4 } });
    });

    it("writes indexed model and image Addresses in full", () => {
        const model = parseAddress("weapon-sword", {
            package: "setting",
            system: "note",
            types: new Set(["weapon", "icon"]),
            packages: new Set(["setting"]),
        });
        const img = parseAddress("icon-sword", {
            package: "setting",
            system: "note",
            types: new Set(["weapon", "icon"]),
            packages: new Set(["setting"]),
        });
        const context = { ...CONTEXT, cultureItems: [{ model, img }] };
        expect(split(generateNpc(spec("Ahmetega Zekar"), context).text).fm.data.items).toEqual([
            { model: "setting-note-weapon-sword", img: "setting-note-icon-sword" },
        ]);
        expect(context.cultureItems[0].model).toBe(model);
    });

    it("keeps items explicitly stated in the spec", () => {
        const items = [{ name: "Bag", kind: "container" }];
        const context = { ...CONTEXT, cultureItems: [{ name: "Coat", kind: "clothing" }] };
        expect(
            split(generateNpc(spec("Ahmetega Zekar", { items }), context).text).fm.data.items,
        ).toEqual(items);
    });

    it("is a different person for a different name", () => {
        const people = new Set(
            NAMES.slice(0, 10).map((name) => {
                const { fm } = split(generateNpc(spec(name), CONTEXT).text);
                const d = fm.data;
                return JSON.stringify([d.born, d.height, d.weight, d.frame, d.appearance]);
            }),
        );
        expect(people.size).toBe(10);
    });

    it("is a complete Folk being", () => {
        const { fm, body } = split(generateNpc(spec("Ahmetega Zekar"), CONTEXT).text);
        expect(Object.keys(fm)).toEqual(["shortcode", "name", "type", "subType", "tags", "data"]);
        expect(fm).toMatchObject({ type: "being", subType: "npc", tags: ["generated", "draft"] });
        expect(Object.keys(fm.data)).toEqual([
            "icon",
            "templatePriority",
            "archetypes",
            "occupation",
            "lore",
            "culture",
            "homes",
            "affiliations",
            "gender",
            "species",
            "born",
            "died",
            "height",
            "weight",
            "frame",
            "appearance",
            "packFolder",
        ]);
        expect(fm.data).toMatchObject({
            icon: "icon-person",
            templatePriority: null,
            archetypes: ["commoner"],
            occupation: null,
            lore: [],
            homes: [],
            affiliations: {},
            species: "humanflk",
            died: null,
            packFolder: "regkhfolk",
        });
        expect(Object.keys(fm.data.appearance)).toEqual([
            "eye_color",
            "hair_color",
            "skin_color",
            "complexion",
            "extra_features",
        ]);
        expect(body).toMatch(/^\n# Appearance \{#appearance\}\n\n.+\n\n# Dossier \{#dossier\}\n$/);
    });

    it("derives a free shortcode from the name", () => {
        const { fm } = split(generateNpc(spec("Ahmetega Zekar"), CONTEXT).text);
        // `ahmetegazeka` is taken in this context.
        expect(fm.shortcode).toBe("ahmetegazek2");
        expect(split(generateNpc(spec("Zâra Ûl"), CONTEXT).text).fm.shortcode).toBe("zaraul");
    });

    it("draws every appearance value from the profile and the closed vocabulary", () => {
        for (const name of NAMES) {
            for (const gender of ["female", "male", "nonbinary"]) {
                const { fm } = split(generateNpc(spec(name, { gender }), CONTEXT).text);
                const d = fm.data;
                for (const key of PROFILE_LOOK_KEYS) {
                    if (!(key in PROFILE)) {
                        expect(d.appearance, `${name} ${key}`).not.toHaveProperty(key);
                        continue;
                    }
                    const value = key === "frame" ? d.frame : d.appearance[key];
                    const words = (BEING_LOOK_VOCABULARY as any)[vocabularyKey(key)].map(
                        (w: { value: string }) => w.value,
                    );
                    for (const word of [value].flat()) {
                        expect(words, `${name} ${key}`).toContain(word);
                        expect((PROFILE as any)[key][word], `${name} ${key}`).toBeGreaterThan(0);
                    }
                }
                const ranges =
                    gender in PROFILE.height ?
                        [(PROFILE.height as any)[gender]]
                    :   Object.values(PROFILE.height);
                const inches = parseBeingHeight(d.height) as number;
                expect(inches, `${name} height`).toBeGreaterThanOrEqual(
                    Math.min(...ranges.map((r: any) => parseBeingHeight(r.min) as number)),
                );
                expect(inches, `${name} height`).toBeLessThanOrEqual(
                    Math.max(...ranges.map((r: any) => parseBeingHeight(r.max) as number)),
                );
                const metres = inches * 0.0254;
                const kilograms = (parseBeingWeight(d.weight) as number) / 2.20462;
                const index = kilograms / (metres * metres);
                const [low, high] = (FRAME_MASS_INDEX as any)[d.frame];
                // Whole pounds and inches round the index by a fraction of a point.
                expect(index, `${name} ${d.frame} ${d.height} ${d.weight}`).toBeGreaterThan(
                    low - 0.4,
                );
                expect(index, `${name} ${d.frame} ${d.height} ${d.weight}`).toBeLessThan(
                    high + 0.4,
                );
            }
        }
    });

    it("is an adult born in the setting's date form, relative to the present", () => {
        for (const name of NAMES) {
            const { fm, body } = split(generateNpc(spec(name), CONTEXT).text);
            expect(fm.data.born).toMatch(/^\d+\.\d+$/);
            const age = Number(/is an? (\d+)-year-old/.exec(body)?.[1]);
            expect(age).toBeGreaterThanOrEqual(18);
            expect(age).toBeLessThanOrEqual(60);
        }
    });

    it("uses the default current date when the setting is omitted", () => {
        const { currentDate, ...withoutDate } = CONTEXT;
        const result = generateNpc(spec("Ahmetega Zekar"), withoutDate);
        const explicit = generateNpc(spec("Ahmetega Zekar"), {
            ...withoutDate,
            currentDate: "720.1",
        });
        expect(result.text).toBe(explicit.text);
        expect(split(result.text).fm.data.born).not.toBe("unknown");
    });

    it("never alters a field the spec gives", () => {
        const given = {
            shortcode: "zekar",
            tags: ["soldiery"],
            description: "A river captain.",
            data: {
                culture: "khelathi",
                gender: "female",
                archetypes: ["warrior", "mariner"],
                occupation: "River Fleet Officer",
                homes: ["galezkara"],
                born: "681.241",
                height: `7' 1"`,
                frame: "massive",
                socialTies: { someone: "kin" },
                appearance: { eye_color: "violet", complexion: ["scarred", "freckled"] },
            },
            name: { full: "Agosi Zekar", aliases: ["Ago"] },
        };
        const { fm } = split(generateNpc(structuredClone(given), CONTEXT).text);
        expect(fm.shortcode).toBe("zekar");
        expect(fm.tags).toEqual(["soldiery"]);
        expect(fm.description).toBe("A river captain.");
        expect(fm.name).toEqual(given.name);
        for (const [key, value] of Object.entries(given.data)) {
            if (key === "appearance") continue;
            expect(fm.data[key], key).toEqual(value);
        }
        expect(fm.data.appearance.eye_color).toBe("violet");
        expect(fm.data.appearance.complexion).toEqual(["scarred", "freckled"]);
        expect(PROFILE.hair_color).toHaveProperty(fm.data.appearance.hair_color);
    });

    it("keeps the appearance and dossier prose verbatim", () => {
        const appearance = "She is tall.\n\n  Two spaces  lead this line.\nAnd a third line.";
        const dossier = "First paragraph.\n\n- a list\n- of things\n\n> quoted  text\n";
        const { fm, body } = split(
            generateNpc({ ...spec("Ahmetega Zekar"), appearance, dossier }, CONTEXT).text,
        );
        expect(fm).not.toHaveProperty("appearance");
        expect(fm).not.toHaveProperty("dossier");
        expect(body).toBe(
            `\n# Appearance {#appearance}\n\n${appearance}\n\n# Dossier {#dossier}\n\n${dossier}`,
        );
    });

    it("refuses a spec missing a required field, naming it", () => {
        expect(npcSpecProblems({ data: { culture: "x", gender: "male" } })).toEqual([]);
        expect(
            npcSpecProblems({ name: { full: "" }, data: { culture: "x", gender: "male" } }),
        ).toEqual([expect.stringContaining("name.full")]);
        expect(npcSpecProblems({ name: { full: "A" }, data: { gender: "male" } })).toEqual([
            expect.stringContaining("data.culture"),
        ]);
        expect(npcSpecProblems({ name: { full: "A" }, data: { culture: "x" } })).toEqual([
            expect.stringContaining("data.gender"),
        ]);
        expect(
            npcSpecProblems({ name: { full: "A" }, type: "lore", data: spec("A").data }),
        ).toEqual([expect.stringContaining("being")]);
        expect(npcSpecProblems(spec("A"))).toEqual([]);
    });
});

describe("a generated npc's name", () => {
    it.each([
        { given: { female: ["nali"], male: ["lumawesa"], nonbinary: null } },
        { given: ["lumawesa"], en: null },
    ])("generates from name lists with optional null entries: %j", (lists) => {
        const { fm } = split(
            generateNpc(unnamed(), {
                ...CONTEXT,
                languageCode: "caseless",
                names: { pattern: "{given}", ...lists },
            }).text,
        );
        expect(fm.name).toEqual({ full: "Lumawesa", caseless: ["lumawesa"] });
        expect(() =>
            generateNpc(
                { ...unnamed(), name: { full: "Lumawesa" } },
                { ...CONTEXT, names: { pattern: "{given}", ...lists } },
            ),
        ).not.toThrow();
    });

    it("capitalizes the actual fallback draw when distinct spellings share a display form", () => {
        for (let seed = 0; seed < 16; seed++) {
            const { fm } = split(
                generateNpc(unnamed({ gender: "nonbinary" }), {
                    ...CONTEXT,
                    seed: String(seed),
                    languageCode: "caseless",
                    names: {
                        pattern: "{given}",
                        given: { female: ["a", "Bo"], male: ["bo", "c"] },
                    },
                }).text,
            );
            const source = fm.name.caseless?.[0] ?? fm.name.full;
            expect(fm.name.full, `seed ${seed}, source ${source}`).toBe(
                source[0].toUpperCase() + source.slice(1),
            );
        }
    });

    it("omits a native alias only when the selected pattern contains an English part", () => {
        const patterns = new Set();
        for (let seed = 0; seed < 12; seed++) {
            const { fm } = split(
                generateNpc(unnamed(), {
                    ...CONTEXT,
                    seed: String(seed),
                    languageCode: "caseless",
                    names: {
                        pattern: ["{given}", "{given} the {en.epithet}"],
                        given: { female: ["nali"], male: ["lumawesa"] },
                        en: { epithet: ["bold"] },
                    },
                }).text,
            );
            const englishPart = fm.name.full.includes(" the ");
            patterns.add(englishPart);
            expect(fm.name).toEqual(
                englishPart ?
                    { full: "Lumawesa the Bold" }
                :   { full: "Lumawesa", caseless: ["lumawesa"] },
            );
        }
        expect(patterns.size).toBe(2);
    });

    it("capitalizes name words for English and keeps the original roman alias", () => {
        const { fm, body } = split(
            generateNpc(unnamed(), {
                ...CONTEXT,
                languageCode: "caseless",
                names: {
                    pattern: "{given} of the {clan}",
                    given: { female: ["nali"], male: ["lumawesa"] },
                    clan: ["simi manik"],
                },
            }).text,
        );
        expect(fm.name).toEqual({
            full: "Lumawesa of the Simi Manik",
            caseless: ["lumawesa of the simi manik"],
        });
        expect(body).toContain("Lumawesa of the Simi Manik is a");
    });

    it("preserves a caseful name's internal case and pattern connectors", () => {
        const { fm } = split(
            generateNpc(unnamed(), {
                ...CONTEXT,
                languageCode: "caseful",
                names: {
                    pattern: "{given} of the {clan}",
                    given: { female: ["Nali"], male: ["McAllan"] },
                    clan: ["O'Mara"],
                },
            }).text,
        );
        expect(fm.name).toEqual({ full: "McAllan of the O'Mara" });
    });

    it("keeps a supplied English display name and native alias exactly", () => {
        const name = { full: "Lumawesa of the Simi Manik", caseless: ["lumawesa"] };
        const { fm } = split(
            generateNpc(
                { ...unnamed(), name },
                {
                    ...CONTEXT,
                    languageCode: "caseless",
                    names: {
                        pattern: "{given} of the {clan}",
                        given: { female: ["nali"], male: ["lumawesa"] },
                        clan: ["simi manik"],
                    },
                },
            ).text,
        );
        expect(fm.name).toEqual(name);
    });

    it("is drawn from the language's lists when the spec states none, the same each time", () => {
        const a = split(generateNpc(unnamed(), CONTEXT).text);
        const b = split(generateNpc(unnamed(), CONTEXT).text);
        expect(a.fm).toEqual(b.fm);
        const full: string = a.fm.name.full;
        const given = full.slice(0, full.indexOf(" "));
        const kin = full.slice(full.indexOf(" ") + 1);
        expect(NAME_LISTS.given.male).toContain(given);
        expect(KIN).toContain(kin);
        expect(a.fm.shortcode).toBe(
            a.fm.name.full
                .normalize("NFD")
                .replace(/[^A-Za-z0-9]/g, "")
                .toLowerCase()
                .slice(0, 12),
        );
        expect(a.body).toContain(`${a.fm.name.full} is a`);
    });

    it("draws the given name from the gender's list", () => {
        for (let i = 0; i < 40; i++) {
            const { fm } = split(
                generateNpc(unnamed({ gender: "female" }), { ...CONTEXT, seed: String(i) }).text,
            );
            expect(NAME_LISTS.given.female).toContain(fm.name.full.split(" ")[0]);
        }
    });

    it("is a different person for a different seed", () => {
        const people = new Set(
            Array.from({ length: 10 }, (_, i) =>
                JSON.stringify(
                    split(generateNpc(unnamed(), { ...CONTEXT, seed: `s${i}` }).text).fm,
                ),
            ),
        );
        expect(people.size).toBe(10);
    });

    it("keeps a supplied name that fits the lists", () => {
        const { fm } = split(generateNpc(spec("Zâra Ûl"), CONTEXT).text);
        expect(fm.name).toEqual({ full: "Zâra Ûl" });
    });

    it("refuses a supplied name with a part in no list, naming the part and the language", () => {
        expect(() => generateNpc(spec("Ahmetega Zekarson"), CONTEXT)).toThrow(
            /demo-note-skill-khelathi.*"Zekarson".*\{kin\}/,
        );
    });

    it("refuses a supplied given name from another gender's list", () => {
        expect(() => generateNpc(spec("Agosi Zekar"), CONTEXT)).toThrow(
            /demo-note-skill-khelathi.*"Agosi".*not a male given name/,
        );
    });

    it("needs the language's name lists", () => {
        expect(() => generateNpc(unnamed(), { ...CONTEXT, names: undefined })).toThrow(/names/);
    });
});

describe("a generated npc's head and face", () => {
    const FACE = {
        hair_texture: { coily: 1 },
        hair_style: { braided: 1 },
        facial_hair: { full_beard: 1 },
        face_shape: { angular: 1 },
        nose: { aquiline: 1 },
        brow: { heavy: 1 },
        mouth: { thin: 1 },
    };

    it("draws each feature the profile weights, and none it does not", () => {
        const withFace = split(
            generateNpc(spec("Ahmetega Zekar"), {
                ...CONTEXT,
                profile: { ...PROFILE, ...FACE },
            }).text,
        );
        expect(withFace.fm.data.appearance).toMatchObject({
            hair_texture: "coily",
            hair_style: "braided",
            facial_hair: "full_beard",
            face_shape: "angular",
            nose: "aquiline",
            brow: "heavy",
            mouth: "thin",
        });
        const without = split(generateNpc(spec("Ahmetega Zekar"), CONTEXT).text);
        for (const key of Object.keys(FACE))
            expect(without.fm.data.appearance, key).not.toHaveProperty(key);
    });

    it("draws the same features for the same seed", () => {
        const context = { ...CONTEXT, profile: { ...PROFILE, ...FACE } };
        expect(generateNpc(spec("Ahmetega Zekar"), context).text).toBe(
            generateNpc(spec("Ahmetega Zekar"), context).text,
        );
    });

    it("never alters a feature the spec gives", () => {
        const { fm } = split(
            generateNpc(spec("Ahmetega Zekar", { appearance: { nose: "snub" } }), {
                ...CONTEXT,
                profile: { ...PROFILE, ...FACE },
            }).text,
        );
        expect(fm.data.appearance.nose).toBe("snub");
    });

    it("describes the head and face in the paragraph", () => {
        const text = appearanceParagraph({
            name: "Ahmetega Zekar",
            age: 39,
            gender: "male",
            appearance: {
                hair_color: "black",
                hair_texture: "coily",
                hair_style: "braided",
                facial_hair: "stubble",
                face_shape: "oval",
                nose: "aquiline",
                brow: "heavy",
                mouth: "thin",
                extra_features: [],
            },
        });
        expect(text).toContain("braided coily black hair");
        expect(text).toContain(
            "His face has an oval shape, an aquiline nose, heavy brows, a thin mouth, and stubble.",
        );
        expect(
            appearanceParagraph({
                name: "Agosi",
                gender: "female",
                appearance: { hair_style: "bald", facial_hair: "none", extra_features: [] },
            }),
        ).toContain("She has a bald head.");
    });
});

describe("the appearance paragraph", () => {
    it("is written in the Folk wording", () => {
        expect(
            appearanceParagraph({
                name: "Ahmetega Zekar",
                age: 39,
                gender: "male",
                height: `6' 4"`,
                frame: "heavy",
                appearance: {
                    eye_color: "brown",
                    hair_color: "black",
                    skin_color: "tawny",
                    complexion: ["weathered"],
                    extra_features: [],
                },
            }),
        ).toBe(
            `Ahmetega Zekar is a 39-year-old man who stands 6'4" tall with a heavy build. ` +
                "He has tawny skin, weathered complexion, black hair, and brown eyes.",
        );
        expect(
            appearanceParagraph({
                name: "Agosi",
                age: 54,
                gender: "female",
                height: `5' 6"`,
                frame: "medium",
                appearance: {
                    eye_color: "dark_brown",
                    skin_color: "dark_brown",
                    extra_features: ["a bald head"],
                },
            }),
        ).toBe(
            `Agosi is a 54-year-old woman who stands 5'6" tall with a medium build. ` +
                "She has dark brown skin and dark brown eyes. Her features include a bald head.",
        );
    });
});

describe("the values an npc takes from its peers", () => {
    /** A being note as the link index holds it. */
    const being = (shortcode: string, subType: string, data: Record<string, string>) => ({
        type: "being",
        fm: { shortcode, subType, data },
        raw: `---\nshortcode: ${shortcode}\ndata:\n${Object.entries(data)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n")}\n---\n`,
    });
    const index = {
        contentPackage: "demo",
        types: new Set(["being", "lore"]),
        packages: new Set(["demo"]),
        notes: [
            being("a", "npc", { culture: "khelathi", icon: "icon-person", packFolder: "khfolk" }),
            being("b", "npc", { culture: "khelathi", icon: "icon-person", species: "humanflk" }),
            being("c", "npc", { culture: "other", icon: "icon-elf", packFolder: "otherfolk" }),
            being("d", "npc", { culture: "other", icon: "icon-elf", species: "elfflk" }),
            being("e", "npc", { culture: "other", icon: "icon-elf", species: "elfflk" }),
            being("f", "creature", { icon: "icon-wolf" }),
        ],
    };

    it("takes the commonest value among the culture's npcs, else among all npcs", () => {
        const { taken, ...defaults } = npcDefaults(index, "demo-note-lore-khelathi");
        expect(defaults).toEqual({
            icon: "icon-person",
            species: "humanflk",
            packFolder: "khfolk",
        });
        expect([...taken].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
        const { taken: _, ...none } = npcDefaults(index, "demo-note-lore-nobody");
        expect(none).toEqual({ icon: "icon-elf", species: "elfflk", packFolder: "khfolk" });
    });
});
