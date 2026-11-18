/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import { dataFields } from "../engine/note-vocabulary.mjs";
import {
    VEHICLE_LOOK_VOCABULARY,
    drawVehicleAppearance,
    checkVehicleAppearance,
} from "../engine/vehicle-appearance.mjs";

const fields = {
    form: { round_hull: 1 },
    material: { oak: 1 },
};
const profile = [{ locomotion: "floating", fields }];
const data = { family: "Ship", locomotion: ["floating"], movementProperties: [] };
it("declares every look field and culture profile from the vocabulary", () => {
    const declared = new Set(dataFields("vehicle").map((f: any) => f.name));
    for (const key of Object.keys(VEHICLE_LOOK_VOCABULARY))
        expect(declared.has(`appearance.${key}`)).toBe(true);
    expect(dataFields("lore").some((f: any) => f.name === "vehicleAppearanceProfile")).toBe(true);
});
it("draws deterministically without mutating input and respects authored fields", () => {
    const input = { ...data, appearance: { material: "wood" } };
    const before = structuredClone(input);
    expect(drawVehicleAppearance(input, profile, "seed", "floating")).toMatchObject({
        form: "round_hull",
        material: "wood",
    });
    expect(input).toEqual(before);
    expect(drawVehicleAppearance(input, profile, "seed", "floating")).toEqual(
        drawVehicleAppearance(input, profile, "seed", "floating"),
    );
});
it("reports incompatible forms and sail colors", () => {
    const note = {
        fm: {
            type: "vehicle",
            data: {
                ...data,
                locomotion: ["sled"],
                appearance: { form: "round_hull", sail_color: "white" },
            },
        },
    };
    expect(checkVehicleAppearance(note).length).toBeGreaterThanOrEqual(1);
});

it("checks forms and rejects undeclared appearance fields", () => {
    const examples: Record<string, string> = {
        floating: "round_hull",
        wheeled: "open_body",
        dragged: "travois",
        sled: "runner_sleigh",
        carried: "litter",
    };
    for (const [mode, form] of Object.entries(examples)) {
        const check = (appearance: any) =>
            checkVehicleAppearance({
                fm: { type: "vehicle", data: { locomotion: [mode], appearance } },
            });
        expect(check({ form })).toEqual([]);
    }
});
it("validates profile shape, weights, selectors and applicability", async () => {
    const { checkVehicleAppearanceProfile } = await import("../engine/vehicle-appearance.mjs");
    const check = (p: any, subType = "culture") =>
        checkVehicleAppearanceProfile({
            fm: { type: "lore", subType, data: { vehicleAppearanceProfile: p } },
        });
    expect(check(profile)).toEqual([]);
    for (const p of [
        [],
        [{}],
        [{ locomotion: "floating", fields: { ...fields, form: { open_body: 1 } } }],
        [profile[0], profile[0]],
    ])
        expect(check(p).length).toBeGreaterThan(0);
    expect(
        check([{ locomotion: "floating", fields: { ...fields, material: { oak: 0 } } }]),
    ).toContainEqual(
        expect.objectContaining({
            message: expect.stringContaining(
                "fields.material.oak: weight must be finite and positive",
            ),
        }),
    );
    expect(check(profile, "history").length).toBeGreaterThan(0);
});
it("chooses an exact family and preserves field streams", () => {
    const rows = [
        ...profile,
        {
            locomotion: "floating",
            family: "Ship",
            fields: {
                ...fields,
                material: { pine: 1 },
            },
        },
    ];
    expect(drawVehicleAppearance(data, rows, "seed", "floating")).toMatchObject({
        material: "pine",
    });
    expect(() => drawVehicleAppearance(data, rows, "seed", "sled")).toThrow();
    expect(() => drawVehicleAppearance(data, [], "seed", "floating")).toThrow();
    expect(() =>
        drawVehicleAppearance(data, [profile[0], profile[0]], "seed", "floating"),
    ).toThrow();
});
it("checks punctuation and excluded directions in extra features", () => {
    const check = (extra_features: any) =>
        checkVehicleAppearance({
            fm: { type: "vehicle", data: { ...data, appearance: { extra_features } } },
        });
    expect(check(["a repaired side-board"])).toEqual([]);
    for (const value of [[""], ["red, blue"], ["cartoon style"], "a mark"])
        expect(check(value).length).toBeGreaterThan(0);
});

it("runs checks through frontmatter lint with located findings", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    const YAML = (await import("yaml")).default;
    const fm = {
        type: "vehicle",
        shortcode: "cart",
        name: { full: "Cart" },
        data: { ...data, appearance: { form: "open_body", extra_features: ["cartoon style"] } },
    };
    const raw = `---\n${YAML.stringify(fm)}---\nBody.\n`;
    const found = lintNote(
        { file: "cart.md", fm, raw },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
    expect(
        found.filter((item: any) => item.message.includes("appearance")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(found.find((item: any) => item.message.includes("appearance.form"))).toMatchObject({
        file: "cart.md",
        line: expect.any(Number),
        column: expect.any(Number),
    });
});

it("accepts each declared word for a compatible vehicle and checks location", () => {
    const modes = ["floating", "wheeled", "dragged", "sled", "carried"];
    for (const [field, entries] of Object.entries(VEHICLE_LOOK_VOCABULARY)) {
        for (const { value, meaning } of entries) {
            expect(meaning.trim()).not.toBe("");
            const findings = modes.map((locomotion) =>
                checkVehicleAppearance({
                    fm: {
                        type: "vehicle",
                        data: {
                            locomotion: [locomotion],
                            movementProperties: [],
                            appearance: { [field]: value },
                        },
                    },
                }),
            );
            expect(
                findings.some((items) => items.length === 0),
                `${field}: ${value}`,
            ).toBe(true);
        }
    }
});
it("keeps other field streams stable when an optional field is added", () => {
    const base = [{ locomotion: "floating", fields: { ...fields, color: { red: 1, blue: 1 } } }];
    const extended = [
        { locomotion: "floating", fields: { ...base[0].fields, trim_color: { red: 1, blue: 1 } } },
    ];
    for (const seed of ["one", "two", "three"])
        expect((drawVehicleAppearance(data, base, seed, "floating") as any).color).toBe(
            (drawVehicleAppearance(data, extended, seed, "floating") as any).color,
        );
});

it("imports the public vehicle appearance entry in a fresh process", async () => {
    const { execFileSync } = await import("node:child_process");
    expect(() =>
        execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                'await import("@heroiclands/package-build/engine/vehicle-appearance")',
            ],
            { cwd: process.cwd(), stdio: "pipe" },
        ),
    ).not.toThrow();
});
it("reports malformed locomotion and propulsion through full lint", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    const YAML = (await import("yaml")).default;
    const base = {
        family: "Cart",
        size: 1,
        locomotion: ["wheeled"],
        role: ["merchant"],
        capacity: 1,
        movementProperties: [
            {
                medium: "terrestrial",
                rates: [{ prob: 1, distance: 0, distUnit: "feet", timeUnit: "hour" }],
            },
        ],
    };
    for (const change of [
        { locomotion: "wheeled", appearance: { material: "wood" } },
        { propulsion: "pushed", appearance: { sail_color: "white" } },
        { locomotion: ["__proto__"], appearance: { form: "open_body" } },
    ]) {
        const fm = {
            type: "vehicle",
            shortcode: "cart",
            name: { full: "Cart" },
            data: { ...base, ...change },
        };
        const found = lintNote(
            { file: "cart.md", fm, raw: `---\n${YAML.stringify(fm)}---\nBody.\n` },
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        );
        expect(found.some((f: any) => f.line > 0)).toBe(true);
    }
    const profileFm = {
        type: "lore",
        subType: "culture",
        shortcode: "culture",
        name: { full: "Culture" },
        data: { vehicleAppearanceProfile: [{ locomotion: "__proto__", fields }] },
    };
    const profileFindings = lintNote(
        { file: "culture.md", fm: profileFm, raw: `---\n${YAML.stringify(profileFm)}---\nBody.\n` },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
    expect(profileFindings.some((f: any) => f.message.includes("locomotion") && f.line > 0)).toBe(
        true,
    );
    const { checkVehicleAppearanceProfile } = await import("../engine/vehicle-appearance.mjs");
    expect(
        checkVehicleAppearanceProfile({
            fm: {
                type: "lore",
                subType: "culture",
                data: { vehicleAppearanceProfile: [{ locomotion: "__proto__", fields }] },
            },
        }).length,
    ).toBeGreaterThan(0);
});
it("accepts full-length vehicle details and rejects excluded styles", () => {
    const check = (value: string) =>
        checkVehicleAppearance({
            fm: { type: "vehicle", data: { ...data, appearance: { extra_features: [value] } } },
        });
    expect(check("full length side rails")).toEqual([]);
    expect(check("full body view")).toEqual([]);
    for (const value of ["cartoon style", "ink outlines", "flat colors"])
        expect(check(value).length).toBeGreaterThan(0);
});

it("keeps being full-length framing excluded", async () => {
    const { portraitDirectionError, vehicleDirectionError } =
        await import("../engine/portrait-compose.mjs");
    for (const value of ["full length pose", "full body pose"]) {
        expect(portraitDirectionError(value, ["test"])).toBeDefined();
        expect(vehicleDirectionError(value, ["test"])).toBeUndefined();
    }
    for (const value of ["cartoon", "ink outlines", "flat colors"]) {
        expect(portraitDirectionError(value, ["test"])).toBeDefined();
        expect(vehicleDirectionError(value, ["test"])).toBeDefined();
    }
});
it("declares required profile field maps", () => {
    const profileField = dataFields("lore").find(
        (field: any) => field.name === "vehicleAppearanceProfile",
    ) as any;
    const fields = profileField.entries.fields.find((field: any) => field.name === "fields").fields;
    for (const field of fields)
        expect(Boolean(field.required), field.name).toBe(["form", "material"].includes(field.name));
});

it("rejects unknown look words on a vehicle stub without locomotion", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    const YAML = (await import("yaml")).default;
    const fm = {
        type: "vehicle",
        shortcode: "stub",
        name: { full: "Stub" },
        data: { appearance: { material: "notamaterial", form: "notashape" } },
    };
    const raw = `---\n${YAML.stringify(fm)}---\n`;
    const found = lintNote(
        { file: "stub.md", fm, raw },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
    for (const key of ["material", "form"])
        expect(found).toContainEqual(
            expect.objectContaining({
                file: "stub.md",
                line: expect.any(Number),
                column: expect.any(Number),
                message: expect.stringContaining(`appearance.${key}`),
            }),
        );
    const valid = { ...fm, data: { appearance: { material: "wood", form: "open_body" } } };
    expect(
        lintNote(
            { file: "stub.md", fm: valid, raw: `---\n${YAML.stringify(valid)}---\n` },
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        ).filter((f: any) => f.message.includes("appearance")),
    ).toEqual([]);
});

it("reports each undeclared vehicle and culture key once through full lint", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    const YAML = (await import("yaml")).default;
    const notes = [
        {
            type: "vehicle",
            data: {
                appearance: { color: "red" },
                icon: "image-cart",
                portrait: { prompt: "test", typo: true },
                portraitSettings: { model: "sdxl", seed: "seed", ageBand: "adult" },
            },
        },
        {
            type: "lore",
            subType: "culture",
            data: {
                vehicleAppearanceProfile: [
                    {
                        locomotion: "floating",
                        typo: true,
                        fields: { ...fields, unknown: { red: 1 } },
                    },
                ],
            },
        },
    ];
    for (const fm of notes) {
        const raw = `---\n${YAML.stringify(fm)}---\nBody.\n`;
        const found = lintNote(
            { file: "subject.md", fm, raw },
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        );
        for (const key of fm.type === "vehicle" ?
            ["color", "typo", "ageBand"]
        :   ["typo", "unknown"]) {
            const line =
                raw
                    .split("\n")
                    .findIndex((text: string) => text.trimStart().startsWith(`${key}:`)) + 1;
            expect(
                found.filter((item: any) => item.line === line),
                key,
            ).toHaveLength(1);
        }
    }
});

it("names applicable appearance words for the selected locomotion", async () => {
    const direct = checkVehicleAppearance({
        fm: { type: "vehicle", data: { locomotion: ["sled"], appearance: { form: "round_hull" } } },
    });
    expect(direct[0].message).toContain("runner_sleigh");
    const { checkVehicleAppearanceProfile } = await import("../engine/vehicle-appearance.mjs");
    const profileFinding = checkVehicleAppearanceProfile({
        fm: {
            type: "lore",
            subType: "culture",
            data: {
                vehicleAppearanceProfile: [
                    {
                        locomotion: "sled",
                        fields: { form: { round_hull: 1 }, material: { wood: 1 } },
                    },
                ],
            },
        },
    });
    expect(profileFinding.some((item: any) => item.message.includes("runner_sleigh"))).toBe(true);
});
