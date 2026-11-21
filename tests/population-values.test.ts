/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    populationActual,
    populationApparent,
    populationForAudience,
    populationDiffers,
    projectPopulation,
    projectPopulationFrontmatter,
} from "../engine/population-values.mjs";

describe("population values", () => {
    it.each([
        [undefined, undefined, undefined, false],
        [{ actual: 100 }, 100, 100, false],
        [{ actual: 100, apparent: 100 }, 100, 100, false],
        [{ actual: "100", apparent: 100 }, 100, 100, false],
        [{ actual: 100, apparent: 80 }, 100, 80, true],
        [{ actual: 100, apparent: 0 }, 100, 0, true],
        [{ actual: 100, apparent: null }, 100, null, true],
        [{ actual: null }, null, null, false],
    ])("keeps actual and apparent distinct", (input, actual, apparent, differs) => {
        expect(populationActual(input)).toBe(actual);
        expect(populationApparent(input)).toBe(apparent);
        expect(populationForAudience(input, "all")).toBe(actual);
        expect(populationForAudience(input)).toBe(apparent);
        expect(populationDiffers(input)).toBe(differs);
    });
    it("rejects malformed data containers and preserves absent data", () => {
        expect(projectPopulationFrontmatter({ name: "Example" })).toEqual({ name: "Example" });
        for (const data of [null, [], 3, "bad", new Date()])
            expect(() => projectPopulationFrontmatter({ data })).toThrow(TypeError);
    });
    it("projects without mutation and preserves unrelated references in either order", () => {
        const marker = new Date();
        const input = {
            data: {
                population: { actual: 100, apparent: 0 },
                territorial_population: { actual: 200 },
                settlements: [{ population: { actual: 30, apparent: null }, marker }],
                other: { population: 11 },
                marker,
            },
        };
        const before = structuredClone(input);
        const publicView = projectPopulationFrontmatter(input, "public");
        const privateView = projectPopulationFrontmatter(input, "all");
        expect(publicView.data.population).toEqual({ actual: null, apparent: 0 });
        expect(publicView.data.territorial_population).toEqual({ actual: 200, apparent: 200 });
        expect(publicView.data.settlements[0].population).toEqual({ actual: null, apparent: null });
        expect(privateView.data.population).toEqual({ actual: 100, apparent: 0 });
        expect(projectPopulationFrontmatter(input, "all")).toEqual(privateView);
        expect(projectPopulationFrontmatter(input, "public")).toEqual(publicView);
        expect(publicView.data.marker).toBe(marker);
        expect(publicView.data.other).toBe(input.data.other);
        expect(input).toEqual(before);
        expect(projectPopulation(publicView.data.population)).toEqual(publicView.data.population);
        expect(projectPopulation({ actual: "1200", apparent: 1200 })).toEqual({
            actual: 1200,
            apparent: 1200,
        });
        expect(projectPopulation({ actual: "1200", apparent: "0" })).toEqual({
            actual: null,
            apparent: 0,
        });
        expect(() => populationForAudience({ actual: 1 }, "wrong" as any)).toThrow();
    });
});
