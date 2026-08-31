/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

// Build-time pack integrity check (plain ESM, no Foundry). Imported by relative
// path because the pack-build scripts live outside the `@src` alias tree.
import { checkSceneLevels, compendiumCliVersion } from "../engine/scene-levels.mjs";

/** A well-formed scene record and the sublevel record its `levels` names. */
function goodPack(): Array<[string, Record<string, unknown>]> {
    return [
        [
            "!scenes!AAAAAAAAAAAAAAAA",
            {
                _id: "AAAAAAAAAAAAAAAA",
                name: "Hearthmoor",
                initialLevel: "defaultLevel0000",
                levels: ["defaultLevel0000"],
            },
        ],
        [
            "!scenes.levels!AAAAAAAAAAAAAAAA.defaultLevel0000",
            {
                _id: "defaultLevel0000",
                name: "Ground",
                background: { src: "systems/sohl/assets/ui/parchment.jpg" },
            },
        ],
    ];
}

describe("checkSceneLevels", () => {
    it("passes a scene whose Level record is present", () => {
        expect(checkSceneLevels(goodPack())).toEqual([]);
    });

    it("passes a pack holding no scenes at all", () => {
        expect(checkSceneLevels([["!items!AAAAAAAAAAAAAAAA", { _id: "x" }]])).toEqual([]);
    });

    // The reported failure (#1538): the parent still names its Level, but the
    // `scenes.levels` sublevel record is gone. Foundry reads that as "no
    // levels" and persists the emptied array on the next launch, so the map
    // image is lost and `initialLevel` dangles.
    it("reports a `levels` id with no record in the scenes.levels sublevel", () => {
        const records = goodPack().filter(([key]) => !key.startsWith("!scenes.levels!"));
        const problems = checkSceneLevels(records);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("Hearthmoor");
        expect(problems[0]).toContain("defaultLevel0000");
    });

    it("reports a scene with an empty `levels` array", () => {
        const records = goodPack();
        (records[0][1] as { levels: string[] }).levels = [];
        const problems = checkSceneLevels(records);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("no Level");
    });

    it("reports a scene with no `levels` key at all", () => {
        const records = goodPack();
        delete (records[0][1] as { levels?: string[] }).levels;
        expect(checkSceneLevels(records)).toHaveLength(1);
    });

    it("reports an `initialLevel` that names no level of the scene", () => {
        const records = goodPack();
        (records[0][1] as { initialLevel: string }).initialLevel = "nope";
        const problems = checkSceneLevels(records);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("initialLevel");
    });

    it("ignores a level record keyed to a different scene", () => {
        const records = goodPack();
        records[1][0] = "!scenes.levels!BBBBBBBBBBBBBBBB.defaultLevel0000";
        expect(checkSceneLevels(records)).toHaveLength(1);
    });

    // An Adventure carries its scenes inline, levels and all, so the same
    // invariant has a second shape and a second way to ship a mapless scene.
    describe("inline scenes on an Adventure record", () => {
        function adventure(levels: unknown): Array<[string, object]> {
            return [
                [
                    "!adventures!CCCCCCCCCCCCCCCC",
                    {
                        _id: "CCCCCCCCCCCCCCCC",
                        name: "Wayfarer's Rest",
                        scenes: [
                            {
                                _id: "AAAAAAAAAAAAAAAA",
                                name: "Hearthmoor",
                                initialLevel: "defaultLevel0000",
                                levels,
                            },
                        ],
                    },
                ],
            ];
        }

        it("passes when the inline scene carries its Level object", () => {
            expect(
                checkSceneLevels(
                    adventure([
                        {
                            _id: "defaultLevel0000",
                            background: { src: "a.jpg" },
                        },
                    ]),
                ),
            ).toEqual([]);
        });

        it("reports an inline scene with no levels", () => {
            const problems = checkSceneLevels(adventure([]));
            expect(problems).toHaveLength(1);
            expect(problems[0]).toContain("Wayfarer's Rest");
            expect(problems[0]).toContain("Hearthmoor");
        });

        it("reports an inline scene whose initialLevel is absent", () => {
            const problems = checkSceneLevels(adventure([{ _id: "other0000000000" }]));
            expect(problems).toHaveLength(1);
            expect(problems[0]).toContain("initialLevel");
        });
    });
});

// #9: the guard built the key it reported by interpolating each `levels` entry,
// so an entry that is an inline Level *object* — what
// `@foundryvtt/foundryvtt-cli` before 3.0.3 writes, because it does not split
// Scene Levels into the sublevel — degraded to "[object Object]" and named a
// key that could not exist. The guard is right to fail; only the message was.
describe("checkSceneLevels diagnostics", () => {
    /** A second, sound scene, so a pack is not wholly without Level records. */
    function otherScene(): Array<[string, Record<string, unknown>]> {
        return [
            [
                "!scenes!BBBBBBBBBBBBBBBB",
                {
                    _id: "BBBBBBBBBBBBBBBB",
                    name: "Wayside",
                    initialLevel: "otherLevel000000",
                    levels: ["otherLevel000000"],
                },
            ],
            [
                "!scenes.levels!BBBBBBBBBBBBBBBB.otherLevel000000",
                { _id: "otherLevel000000", name: "Ground" },
            ],
        ];
    }

    /** A scene declaring the given `levels`, with no record of its own. */
    function sceneDeclaring(
        id: string,
        name: string,
        levels: unknown,
    ): [string, Record<string, unknown>] {
        return [`!scenes!${id}`, { _id: id, name, initialLevel: "defaultLevel0000", levels }];
    }

    const inlineLevel = {
        _id: "defaultLevel0000",
        name: "Ground",
        background: { src: "a.jpg" },
    };

    it("names an inline Level object by shape and `_id`, never as [object Object]", () => {
        const problems = checkSceneLevels([
            ...otherScene(),
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel]),
        ]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).not.toContain("[object Object]");
        expect(problems[0]).toContain("Hearthmoor");
        expect(problems[0]).toContain("levels[0]");
        expect(problems[0]).toContain("inline Level object");
        expect(problems[0]).toContain("defaultLevel0000");
        expect(problems[0]).toContain("foundryvtt-cli");
    });

    it("reports an inline Level object that carries no `_id`", () => {
        const problems = checkSceneLevels([
            ...otherScene(),
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [{ name: "Ground" }]),
        ]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).not.toContain("[object Object]");
        expect(problems[0]).toContain("absent");
    });

    it("reports a `levels` entry that is neither an id nor a Level object", () => {
        const problems = checkSceneLevels([
            ...otherScene(),
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [null]),
        ]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("Hearthmoor");
        expect(problems[0]).toContain("levels[0]");
        expect(problems[0]).toContain("not a Level id");
    });

    // The wholesale case: no scene in the pack has a Level record. That is one
    // fact about the compile, not N facts about N scenes, so it is reported
    // once — with every affected scene named.
    it("reports a pack with zero level records once, naming every scene", () => {
        const problems = checkSceneLevels([
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel]),
            sceneDeclaring("CCCCCCCCCCCCCCCC", "Wayside", [inlineLevel]),
            sceneDeclaring("DDDDDDDDDDDDDDDD", "Kaldor Keep", [inlineLevel]),
        ]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).not.toContain("[object Object]");
        expect(problems[0]).toContain("Hearthmoor");
        expect(problems[0]).toContain("Wayside");
        expect(problems[0]).toContain("Kaldor Keep");
        expect(problems[0]).toContain("3.0.3");
        expect(problems[0]).toContain("inline");
    });

    // The installed CLI *is* the write path, so naming it turns the report
    // into an instruction. Each verdict it can reach is a different one.
    it("blames a resolved CLI older than 3.0.3 and says what to install", () => {
        const problems = checkSceneLevels(
            [sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel])],
            { cliVersion: "1.1.0" },
        );
        expect(problems[0]).toContain("1.1.0");
        expect(problems[0]).toContain("predates 3.0.3");
    });

    it("points at a second copy when the resolved CLI is new enough", () => {
        const problems = checkSceneLevels(
            [sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel])],
            { cliVersion: "3.0.4" },
        );
        expect(problems[0]).toContain("3.0.4");
        expect(problems[0]).toContain("second, older copy");
    });

    it("asks for the installed version when none could be resolved", () => {
        const problems = checkSceneLevels([
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel]),
        ]);
        expect(problems[0]).toContain("npm ls @foundryvtt/foundryvtt-cli");
    });

    it("does not judge a version it cannot parse", () => {
        const problems = checkSceneLevels(
            [sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel])],
            { cliVersion: "next" },
        );
        expect(problems[0]).toContain("npm ls @foundryvtt/foundryvtt-cli");
        expect(problems[0]).not.toContain("predates");
    });

    // With ids rather than objects the sublevel was written and then lost, so
    // the message must not blame the toolchain's shape — but a whole missing
    // sublevel is still one fact, and still reported once.
    it("reports the wholesale case for id entries without blaming inline shape", () => {
        const problems = checkSceneLevels([
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", ["defaultLevel0000"]),
            sceneDeclaring("CCCCCCCCCCCCCCCC", "Wayside", ["defaultLevel0000"]),
        ]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("Hearthmoor");
        expect(problems[0]).toContain("Wayside");
        expect(problems[0]).not.toContain("inline");
    });

    // A scene that declares nothing has its own defect, and the wholesale
    // report says nothing about it — so it is still reported separately.
    it("still reports a scene that declares no levels alongside the wholesale report", () => {
        const problems = checkSceneLevels([
            sceneDeclaring("AAAAAAAAAAAAAAAA", "Hearthmoor", [inlineLevel]),
            sceneDeclaring("CCCCCCCCCCCCCCCC", "Wayside", []),
        ]);
        expect(problems).toHaveLength(2);
        expect(problems.some((p) => p.includes("no Level"))).toBe(true);
    });
});

describe("compendiumCliVersion", () => {
    it("reads the version of the CLI this build resolves", () => {
        expect(compendiumCliVersion()).toMatch(/^\d+\.\d+\.\d+/);
    });
});
