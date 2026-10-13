/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
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
    present: "720.300",
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

    it("is born `unknown` where the package states no present", () => {
        const { fm, body } = split(
            generateNpc(spec("Ahmetega Zekar"), { ...CONTEXT, present: null }).text,
        );
        expect(fm.data.born).toBe("unknown");
        expect(body).toMatch(/^\n# Appearance \{#appearance\}\n\nAhmetega Zekar is a man who/);
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
                    complexion: "weathered",
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
