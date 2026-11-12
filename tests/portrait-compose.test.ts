/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from "vitest";
import {
    assertPortraitFraming,
    composePortrait,
    portraitModelText,
} from "../engine/portrait-compose.mjs";

const base = {
    style: "flux-dev",
    gender: "female",
    frame: "slender",
    seed: "sample",
    ageBand: "adult",
    look: { skin_color: "brown", hair_color: "black", complexion: ["freckled"] },
    items: [
        { kind: "clothing", name: "wool cloak" },
        { kind: "weapon", name: "sword" },
        { kind: "spell", name: "invisibility" },
    ],
    extra: ["stormy shore"],
};

describe("portrait prompt composition", () => {
    it("is deterministic and uses declared visible facts and eligible items", () => {
        const result = composePortrait(base);
        expect(composePortrait(base)).toEqual(result);
        expect(result.positive).toContain("woman");
        expect(result.positive).toContain("slender frame");
        expect(result.positive).toContain("brown skin");
        expect(result.positive).toContain("freckled");
        expect(result.positive).toContain("wearing wool cloak");
        expect(result.positive).toContain("carrying sword");
        expect(result.positive).toContain("stormy shore");
        expect(result.positive).not.toContain("invisibility");
        expect(result.positive).toContain("no outlines, no flat colour fills, no full-body pose.");
        expect(result.negative).toBeUndefined();
    });
    it("uses the approved FLUX 2 Pro suffix verbatim", () => {
        const { positive } = composePortrait({ ...base, style: "flux2-pro" });
        expect(
            positive.endsWith(
                "A realistic oil-painted portrait framed from the chest up, lit with dramatic atmospheric light against a softly blurred setting. The face belongs to an ordinary person: asymmetric, with visible skin texture and small imperfections, neither retouched nor idealised. No ink outlines, cartoon shading or full-length pose.",
            ),
        ).toBe(true);
    });
    it("expresses an explicitly hairless face", () => {
        const { positive } = composePortrait({
            ...base,
            look: { facial_hair: "none", complexion: [] },
        });
        expect(positive).toContain("no facial hair");
    });
    it("keeps the approved SDXL negative channel separate", () => {
        const result = composePortrait({ ...base, style: "sdxl" });
        expect(result.positive).toContain("realistic oil painting portrait, head and shoulders");
        expect(result.negative).toBe(
            "cartoon, comic, ink outlines, flat colors, cel shading, full body, plain background, airbrushed skin, symmetrical face, glamour, model",
        );
        expect(result.positive).not.toContain(result.negative);
    });
    it("varies age wording by seed without discarding declared conditions", () => {
        const variants = new Set(
            Array.from(
                { length: 20 },
                (_, seed) => composePortrait({ ...base, seed: String(seed) }).positive,
            ),
        );
        expect(variants.size).toBeGreaterThan(1);
        expect([...variants].every((prompt) => prompt.includes("freckled"))).toBe(true);
    });
    it.each([
        ["youth", "youthful"],
        ["adult", "adult"],
        ["middle", "middle-aged"],
        ["elder", "elderly"],
    ])("keeps the %s age band in every seeded variant", (ageBand, ageLabel) => {
        for (let seed = 0; seed < 50; seed++) {
            const result = composePortrait({ ...base, ageBand, seed: String(seed) });
            expect(result.positive).toContain(ageLabel);
            expect(result.positive).toContain("freckled");
        }
    });
    it.each([
        ["middle", "some grey"],
        ["elder", "coarse thinning hair"],
    ])("offers the %s hair detail only on hair-bearing heads", (ageBand, detail) => {
        const prompts = (hair_style: string) =>
            Array.from(
                { length: 100 },
                (_, seed) =>
                    composePortrait({
                        ...base,
                        ageBand,
                        seed: String(seed),
                        look: { hair_style, complexion: ["freckled"] },
                    }).positive,
            );
        expect(prompts("long").some((prompt) => prompt.includes(detail))).toBe(true);
        for (const style of ["bald", "shaved"]) {
            expect(
                prompts(style).every(
                    (prompt) => !prompt.includes(detail) && prompt.includes("freckled"),
                ),
            ).toBe(true);
        }
    });
    it("keeps clear skin free of added marks and does not add hair to a bald head", () => {
        for (let seed = 0; seed < 20; seed++) {
            const result = composePortrait({
                ...base,
                seed: String(seed),
                ageBand: "youth",
                look: {
                    skin_color: "brown",
                    hair_color: "black",
                    hair_style: "bald",
                    complexion: ["clear"],
                },
            });
            expect(result.positive).toContain("bald head");
            expect(result.positive).not.toContain("black hair");
            expect(result.positive).not.toMatch(/freckles|blemishes|acne|small marks/);
        }
    });
    it.each(["flux-dev", "flux2-pro", "sdxl"])(
        "omits hair strands for a bare head in %s",
        (style) => {
            for (const hair_style of ["bald", "shaved"]) {
                const result = composePortrait({
                    ...base,
                    style,
                    look: { hair_style, complexion: [] },
                });
                expect(result.positive).toContain(`${hair_style} head`);
                expect(result.positive).not.toMatch(
                    /(?:individual (?:strands of hair|hair strands))/i,
                );
            }
        },
    );
    it("retains age details with clear skin and uses only approved youth options", () => {
        for (const ageBand of ["middle", "elder"]) {
            const variants = Array.from(
                { length: 40 },
                (_, seed) =>
                    composePortrait({
                        ...base,
                        ageBand,
                        seed: String(seed),
                        look: { hair_style: "bald", complexion: ["clear"] },
                    }).positive,
            );
            expect(
                variants.every((prompt) =>
                    /wrinkles|weathered|lines across|lines around/.test(prompt),
                ),
            ).toBe(true);
            expect(
                variants.every((prompt) => !/freckles|blemishes|acne scars|age spots/.test(prompt)),
            ).toBe(true);
        }
        const youth = Array.from(
            { length: 40 },
            (_, seed) =>
                composePortrait({ ...base, ageBand: "youth", seed: String(seed) }).positive,
        );
        expect(youth.every((prompt) => /freckles|blemishes|acne scars/.test(prompt))).toBe(true);
        expect(youth.every((prompt) => !prompt.includes("youthful person with youthful"))).toBe(
            true,
        );
    });
    it("accepts ink as a material and checks framing", () => {
        expect(
            composePortrait({
                ...base,
                look: { extra_features: ["ink-stained fingers"] },
                items: [{ kind: "miscgear", name: "ink pot" }],
            }).positive,
        ).toContain("ink pot");
        expect(() => composePortrait({ ...base, extra: ["ink drawing"] })).toThrow(/ink drawing/);
        expect(() => composePortrait({ ...base, extra: ["ink"] })).toThrow(/ink/);
        expect(() => assertPortraitFraming("A standing person in a landscape")).toThrow(/framing/);
        expect(() => assertPortraitFraming("portrait, head and shoulders")).not.toThrow();
        expect(() => assertPortraitFraming("portrait framed from the chest up")).not.toThrow();
        for (const style of ["flux-dev", "flux2-pro", "sdxl"]) {
            expect(() =>
                assertPortraitFraming(
                    composePortrait({ ...base, style, look: { hair_style: "bald" } }).positive,
                ),
            ).not.toThrow();
        }
    });
    it.each([
        "outlined",
        "bold outlined figure",
        "inked",
        "drawn in ink",
        "pen and ink",
        "pen-and-ink",
        "inkwash",
        "flat coloured",
        "flat-coloured",
        "flat colouring",
        "celshaded",
    ])("rejects the style direction %s", (value) => {
        expect(() => composePortrait({ ...base, extra: [value] })).toThrow(/excluded direction/);
    });
    it.each([
        "ink pot",
        "ink-stained fingers",
        "a bottle of ink",
        "ink on the fingers",
        "a pen and an ink pot",
    ])("keeps ink as a material in %s", (value) => {
        expect(() => composePortrait({ ...base, extra: [value] })).not.toThrow();
    });
    it("checks adapted model framing independently of authored framing", () => {
        const model = "realistic painted portrait, individual strands of hair";
        expect(() => assertPortraitFraming(`head and shoulders, ${model}`)).not.toThrow();
        expect(() => portraitModelText(model, true)).toThrow(/framing/);
    });
    it("rejects incompatible free-form directions and unknown styles", () => {
        expect(() => composePortrait({ ...base, extra: ["full-body pose"] })).toThrow(/full-body/);
        expect(() =>
            composePortrait({ ...base, items: [{ kind: "clothing", name: "ink outline coat" }] }),
        ).toThrow(/ink/);
        expect(() => composePortrait({ ...base, style: "other" })).toThrow(/style/);
    });
});
