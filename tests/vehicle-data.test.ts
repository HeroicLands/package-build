/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { expect, it } from "vitest";
import { checkVehicleData } from "../engine/vehicle-data.mjs";
import YAML from "yaml";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
const lintVehicle = (note: any, context: any = {}) =>
    lintNote(note, {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
        addressContext: { package: "local", system: "note" },
        ...context,
    }).filter((finding: any) => finding.message.includes("data."));

const rate = (distance = 0, prob = 1) => ({ distance, prob, distUnit: "feet", timeUnit: "hour" });
const base = () => ({
    family: "Cart",
    size: 1,
    locomotion: ["wheeled"],
    role: ["utility", "merchant"],
    capacity: 0.5,
    movementProperties: [{ medium: "terrestrial", rates: [rate()] }],
});
const findings = (data: any) => {
    const fm = { type: "vehicle", shortcode: "cart", name: { full: "Cart" }, data };
    return lintVehicle({ file: "cart.md", fm, raw: `---\n${YAML.stringify(fm)}---\nBody.\n` });
};

it("accepts each medium, repeated media, all units, cargo and occupant roles", () => {
    for (const locomotion of ["floating", "wheeled", "dragged", "sled", "carried"]) {
        const movementProperties = [
            "terrestrial",
            "aquatic",
            "floating",
            "aerial",
            "burrowing",
            "astral",
            "floating",
        ].map((medium, i) => ({
            medium,
            rates: [
                {
                    ...rate(),
                    distUnit: i % 2 ? "leagues" : "feet",
                    timeUnit: ["minute", "hour", "watch", "day"][i % 4],
                },
            ],
        }));
        expect(
            findings({
                ...base(),
                locomotion: [locomotion],
                cargoCapacity: 0.5,
                movementProperties,
                occupants: [{ address: "being-horse", role: "draft_animal" }],
            }),
        ).toEqual([]);
    }
});

it("rejects quantity on a generic occupant at its field", () => {
    expect(
        findings({ ...base(), occupants: [{ address: "being-horse", role: "crew", quantity: 2 }] }),
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining("quantity") }),
        ]),
    );
});

it("rejects invalid distributions, roles and occupant records", () => {
    for (const rates of [
        [],
        [rate(0, 0)],
        [rate(0, Infinity)],
        [rate(-1)],
        [rate(0, 0.5), rate(0, 0.5)],
        [rate(1, 0.5), rate(0, 0.5)],
        [{ ...rate(), extra: true }],
        [{ ...rate(), distUnit: "mile" }],
        [{ ...rate(), timeUnit: "year" }],
    ])
        expect(
            findings({ ...base(), movementProperties: [{ medium: "terrestrial", rates }] }).length,
        ).toBeGreaterThan(0);
    for (const occupants of [
        [{ address: "being-horse" }],
        [{ address: "being-horse", role: "draftCreature" }],
        [{ address: "being-horse", role: "crew", title: "Driver" }],
        [{ address: "being-horse", role: "crew", quantity: Infinity }],
    ])
        expect(findings({ ...base(), occupants }).length).toBeGreaterThan(0);
    expect(findings({ ...base(), role: ["merchant", "merchant"] }).length).toBeGreaterThan(0);
    expect(findings({ ...base(), role: ["farm"] }).length).toBeGreaterThan(0);
});

it("checks probability tolerance and required movement records", () => {
    expect(
        findings({
            ...base(),
            movementProperties: [{ medium: "floating", rates: [rate(0, 1 - 5e-10)] }],
        }),
    ).toEqual([]);
    expect(
        findings({
            ...base(),
            movementProperties: [{ medium: "floating", rates: [rate(0, 1 - 2e-9)] }],
        }).length,
    ).toBeGreaterThan(0);
    expect(findings({ ...base(), movementProperties: [] }).length).toBeGreaterThan(0);
    const { movementProperties, ...missing } = base();
    expect(findings(missing).length).toBeGreaterThan(0);
});

it("exempts empty-body stubs from required facts", () => {
    const note = { file: "stub.md", raw: "---\ntype: vehicle\n---\n", fm: { type: "vehicle" } };
    expect(checkVehicleData(note)).toEqual([]);
    expect(checkVehicleData({ ...note, raw: note.raw + "Body" }).length).toBeGreaterThan(0);
});

it("rejects removed vehicle keys through the ordinary located vocabulary check", async () => {
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    for (const key of [
        "carryingCapacity",
        "hullBeams",
        "runners",
        "runnerLength",
        "wheels",
        "capacityBasis",
        "propulsion",
        "conversion",
    ]) {
        const raw = `---\ntype: vehicle\ndata:\n  ${key}: 2\n---\n`;
        const found = lintNote(
            { file: "cart.md", type: "vehicle", raw, fm: { type: "vehicle", data: { [key]: 2 } } },
            { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
        );
        expect(found).toContainEqual(
            expect.objectContaining({
                line: 4,
                column: 3,
                message: expect.stringContaining("is not a `data:` property declared by vehicle"),
            }),
        );
    }
});

it("resolves vehicle references through local and dependency indexes", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const YAML = (await import("yaml")).default;
    const { buildLinkIndex } = await import("../engine/content-links.mjs");
    const { lintNote } = await import("../engine/frontmatter-lint.mjs");
    const { NOTE_SCHEMAS } = await import("../sohl/note-schemas.mjs");
    const { NOTE_VOCABULARY } = await import("../engine/note-vocabulary.mjs");
    const { collectContentIndex, serializeContentIndex } =
        await import("../engine/content-index.mjs");
    const { loadForeignIndexes, metadataFileName } = await import("../engine/metadata-index.mjs");
    const { loadPackConfig } = await import("../engine/pack-config.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vehicle-addresses-"));
    try {
        const local = path.join(root, "local"),
            dep = path.join(root, "dependency"),
            cache = path.join(root, "cache");
        fs.mkdirSync(local);
        fs.mkdirSync(dep);
        fs.mkdirSync(cache);
        const targets = [
            { type: "lore", subType: "history", shortcode: "rules", name: { full: "Rules" } },
            { type: "lore", subType: "culture", shortcode: "culture", name: { full: "Culture" } },
            { type: "lore", subType: "history", shortcode: "history", name: { full: "History" } },
            { type: "being", subType: "creature", shortcode: "horse", name: { full: "Horse" } },
        ];
        for (const dir of [local, dep])
            for (const fm of targets)
                fs.writeFileSync(
                    path.join(dir, `${fm.shortcode}.md`),
                    `---\n${YAML.stringify(fm)}---\nBody.\n`,
                );
        const dir = path.join(cache, "remote@1.0.0");
        fs.mkdirSync(dir);
        fs.writeFileSync(
            path.join(dir, metadataFileName("remote")),
            serializeContentIndex(
                collectContentIndex(dep, { contentPackage: "remote", skipDirectories: [] }),
            ),
        );
        fs.writeFileSync(
            path.join(dir, ".complete"),
            JSON.stringify({ file: metadataFileName("remote"), sha256: null }),
        );
        const config = {
            ...loadPackConfig(),
            contentPackage: "local",
            paths: { ...loadPackConfig().paths, metadataCache: cache },
            relationships: {
                requires: [{ id: "remote", manifest: "https://example.test/module.json" }],
            },
        };
        const foreign = loadForeignIndexes(config as any, ["local"]);
        for (const origin of ["local", "remote", "unlisted"])
            for (const [key, type, good, wrong] of [
                ["rules", "lore", "rules", "being-horse"],
                ["culture", "lore", "culture", "lore-history"],
                ["occupants", "being", "horse", "lore-rules"],
            ]) {
                const target = (value: string) =>
                    value.startsWith("hm3-") ? `${origin}-${value}` : `${origin}-note-${value}`;
                for (const [value, valid] of [
                    [`${type}-${good}`, origin !== "unlisted"],
                    [wrong, false],
                    [`${type}-missing`, false],
                    ...(key === "occupants" ? [["hm3-being-horse", false] as const] : []),
                ] as const) {
                    const data: any = { ...base() };
                    if (key === "occupants")
                        data.occupants = [{ address: target(value), role: "crew" }];
                    else data[key] = target(value);
                    const fm = { type: "vehicle", shortcode: "cart", name: { full: "Cart" }, data };
                    fs.writeFileSync(
                        path.join(local, "cart.md"),
                        `---\n${YAML.stringify(fm)}---\nBody.\n`,
                    );
                    const problems: any[] = [];
                    const current = buildLinkIndex(local, {
                        config: config as any,
                        skipDirectories: [],
                        foreign,
                        problems,
                    });
                    const subject = current.notes.find((note: any) => note.fm.shortcode === "cart");
                    const found =
                        subject ?
                            lintVehicle(subject, { index: current }).filter((item: any) =>
                                item.message.includes(key),
                            )
                        :   problems;
                    if (subject) {
                        const lint = lintNote(subject, {
                            schemas: NOTE_SCHEMAS,
                            vocabulary: NOTE_VOCABULARY,
                            index: current,
                        }).filter((item: any) => item.message.includes(key));
                        if (valid) expect(lint).toEqual([]);
                        else
                            expect(lint).toContainEqual(
                                expect.objectContaining({
                                    line: expect.any(Number),
                                    column: expect.any(Number),
                                    message: expect.stringContaining(key),
                                }),
                            );
                    }
                    expect(
                        found.length,
                        `${origin} ${key} ${value} ${JSON.stringify(problems)}`,
                    ).toBe(valid ? 0 : 1);
                    if (!valid)
                        expect(found[0]).toMatchObject({
                            severity: "error",
                            line: expect.any(Number),
                            message: expect.stringContaining(key),
                        });
                }
            }
        const data = {
            ...base(),
            occupants: [
                { address: "local-note-being-horse", role: "crew" },
                { address: "remote-note-being-horse", role: "draft_animal" },
                { address: "local-note-being-horse", role: "passenger" },
            ],
        };
        const fm = { type: "vehicle", shortcode: "cart", name: { full: "Cart" }, data };
        fs.writeFileSync(path.join(local, "cart.md"), `---\n${YAML.stringify(fm)}---\nBody.\n`);
        const current = buildLinkIndex(local, {
            config: config as any,
            skipDirectories: [],
            foreign,
            problems: [],
        });
        const subject = current.notes.find((note: any) => note.fm.shortcode === "cart");
        expect(checkVehicleData(subject, { index: current })).toEqual([]);
        expect(
            lintNote(subject, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                index: current,
            }).filter((item: any) => item.message.includes("occupants")),
        ).toEqual([]);
        expect(subject.fm.data.occupants.map((row: any) => row.role)).toEqual([
            "crew",
            "draft_animal",
            "passenger",
        ]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

it("locates retained numeric, applicability and construction boundaries", async () => {
    const YAML = (await import("yaml")).default;
    expect(findings({ ...base(), crew: 2, construction: { methods: ["wood"] } })).toEqual([]);
    const cases: Array<[any, string]> = [
        [{ crew: 1.5 }, "crew"],
        [{ capacity: -1 }, "capacity"],
        [{ capacity: NaN }, "capacity"],
        [{ locomotion: ["wheeled", "wheeled"] }, "locomotion"],
        [{ hullDepth: 2 }, "hullDepth"],
        [{ construction: { methods: ["wood"], extra: true } }, "construction.extra"],
    ];
    for (const [change, path] of cases) {
        const fm = { type: "vehicle", data: { ...base(), ...change } };
        const found = lintVehicle({
            file: "cart.md",
            fm,
            raw: `---\n${YAML.stringify(fm)}---\nBody.\n`,
        });
        const match = found.find(
            (item: any) =>
                item.message.includes(`data.${path}`) ||
                (item.message.includes(`data.${path.slice(0, path.lastIndexOf("."))}`) &&
                    item.message.includes(`"${path.slice(path.lastIndexOf(".") + 1)}"`)),
        );
        expect(match, path).toBeDefined();
        expect(match.line, path).toBeGreaterThan(0);
        expect(match.column, path).toBeGreaterThan(0);
    }
});

it("locates malformed movement records and rate values", async () => {
    const YAML = (await import("yaml")).default;
    const cases: Array<[any, string]> = [
        [null, "movementProperties[0]"],
        [{ medium: "water", rates: [rate()] }, "movementProperties[0].medium"],
        [{ medium: "aquatic", rates: [rate()], extra: 1 }, "movementProperties[0].extra"],
        [{ medium: "aquatic", rates: [null] }, "movementProperties[0].rates[0]"],
        ...[NaN, Infinity, "1", -1].map(
            (value) =>
                [
                    { medium: "aquatic", rates: [{ ...rate(), distance: value }] },
                    "movementProperties[0].rates[0].distance",
                ] as [any, string],
        ),
        ...[NaN, Infinity, "1", -0.1, 1.1].map(
            (value) =>
                [
                    { medium: "aquatic", rates: [{ ...rate(), prob: value }] },
                    "movementProperties[0].rates[0].prob",
                ] as [any, string],
        ),
        ...["prob", "distance", "distUnit", "timeUnit"].map((key) => {
            const row: any = rate();
            delete row[key];
            return [{ medium: "aquatic", rates: [row] }, `movementProperties[0].rates[0]`] as [
                any,
                string,
            ];
        }),
    ];
    expect(findings(base())).toEqual([]);
    for (const [entry, path] of cases) {
        const fm = { type: "vehicle", data: { ...base(), movementProperties: [entry] } };
        const found = lintVehicle({
            file: "cart.md",
            fm,
            raw: `---\n${YAML.stringify(fm)}---\nBody.\n`,
        });
        const match = found.find(
            (item: any) =>
                item.message.includes(`data.${path}`) ||
                (item.message.includes(`data.${path.slice(0, path.lastIndexOf("."))}`) &&
                    item.message.includes(`"${path.slice(path.lastIndexOf(".") + 1)}"`)),
        );
        expect(match, path).toBeDefined();
        expect(match.line, path).toBeGreaterThan(0);
        expect(match.column, path).toBeGreaterThan(0);
    }
});

it("preserves ordered roles, occupants and uniform rates with zero bins", () => {
    const data = {
        ...base(),
        role: ["military", "merchant"],
        occupants: [
            { address: "being-horse", role: "crew" },
            { address: "being-horse", role: "passenger" },
        ],
        movementProperties: [
            {
                medium: "floating",
                rates: [
                    { ...rate(0, 0), timeUnit: "watch" },
                    { ...rate(2, 1), timeUnit: "watch" },
                ],
            },
            { medium: "floating", rates: [rate()] },
        ],
    };
    const before = structuredClone(data);
    expect(findings(data)).toEqual([]);
    expect(data).toEqual(before);
    expect(data.role).toEqual(["military", "merchant"]);
    expect(data.occupants.map((row) => row.role)).toEqual(["crew", "passenger"]);
    expect(data.movementProperties[0].rates.map((row) => row.distance)).toEqual([0, 2]);
});

it.each(["distUnit", "timeUnit"])("reports mixed %s at the differing rate", (key) => {
    const rates = [
        rate(0, 0.5),
        { ...rate(1, 0.5), [key]: key === "distUnit" ? "leagues" : "day" },
    ];
    const found = findings({ ...base(), movementProperties: [{ medium: "terrestrial", rates }] });
    expect(found).toContainEqual(
        expect.objectContaining({
            message: expect.stringContaining(`rates[1].${key}`),
            line: expect.any(Number),
            column: expect.any(Number),
            severity: "error",
        }),
    );
});

it.each([
    ["occupant quantity", { occupants: [{ address: "being-horse", role: "crew", quantity: 2 }] }],
    ["missing occupant role", { occupants: [{ address: "being-horse" }] }],
    ["missing occupant address", { occupants: [{ role: "crew" }] }],
    ...[[], [{}]].flatMap((record) => [
        ["array occupant record", { occupants: [record] }],
        ["array construction record", { construction: record }],
        ["array movement record", { movementProperties: [record] }],
        ["array rate record", { movementProperties: [{ medium: "terrestrial", rates: [record] }] }],
    ]),
    ["construction key", { construction: { methods: ["wood"], unknown: true } }],
    ["missing methods", { construction: { complexity: 1 } }],
    [
        "rate key",
        { movementProperties: [{ medium: "terrestrial", rates: [{ ...rate(), unknown: true }] }] },
    ],
    ...["medium", "rates"].map((key) => {
        const row: any = { medium: "terrestrial", rates: [rate()] };
        delete row[key];
        return [`missing ${key}`, { movementProperties: [row] }];
    }),
    ...["prob", "distance", "distUnit", "timeUnit"].map((key) => {
        const row: any = rate();
        delete row[key];
        return [
            `missing ${key}`,
            { movementProperties: [{ medium: "terrestrial", rates: [row] }] },
        ];
    }),
])("reports exactly one located finding for %s", (_label, change) => {
    const found = findings({ ...base(), ...(change as object) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
        file: "cart.md",
        line: expect.any(Number),
        column: expect.any(Number),
        severity: "error",
    });
});
