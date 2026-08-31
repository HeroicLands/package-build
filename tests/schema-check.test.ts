/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Emitted `system` fields against the receiving DataModel (#60).
 *
 * Foundry discards an unknown `system` key silently, so both directions of the
 * mismatch compiled clean and both were found by hand. The two cases the issue
 * names are pinned here as fixtures, because neither is live any more — the
 * value of a regression test for a defect nobody can currently reproduce is that
 * it stops the *next* one, and the shape is what has to be preserved.
 */

import { describe, it, expect } from "vitest";

import {
    SCHEMA_ARTIFACT_VERSION,
    compareFields,
    declaredFields,
    emittedFields,
    undeclaredMessage,
    unemittedMessage,
} from "../engine/schema-check.mjs";

/** A published schema, in the shape a system emits. */
const artifact = (documents: object, systemVersion = "0.8.2") => ({
    version: SCHEMA_ARTIFACT_VERSION,
    system: "sohl",
    systemVersion,
    documents,
});

describe("emittedFields", () => {
    it("takes every `to`, which is what buildFromFields writes", () => {
        expect([
            ...emittedFields([{ to: "subType" }, { to: "levelBase" }]),
        ]).toEqual(["subType", "levelBase"]);
    });

    // A schema declares `charges` as a SchemaField and the paths beneath it
    // separately, so a comparison knowing only the leaf would report the
    // container as unemitted and the leaf as undeclared — two findings, both
    // wrong, for a correct declaration.
    it("records the parents of a nested path, not only the leaf", () => {
        expect([...emittedFields([{ to: "charges.value" }])]).toEqual([
            "charges",
            "charges.value",
        ]);
    });

    it("ignores a field that writes nowhere", () => {
        expect([...emittedFields([{ to: "" }, {} as never])]).toEqual([]);
    });
});

describe("declaredFields separates own from inherited", () => {
    const a = artifact({
        Item: {
            skill: { own: ["subType"], inherited: ["notes", "docHtml"] },
        },
    });

    it("reads `all` as everything the document may carry", () => {
        expect([...declaredFields(a, "Item", "skill")!.all].sort()).toEqual([
            "docHtml",
            "notes",
            "subType",
        ]);
    });

    it("reads `own` as only what the subtype adds", () => {
        expect([...declaredFields(a, "Item", "skill")!.own]).toEqual([
            "subType",
        ]);
    });

    it("returns null for a subtype the artifact does not declare", () => {
        expect(declaredFields(a, "Item", "nosuch")).toBeNull();
    });
});

describe("emitted but not declared — the field evaporates at load", () => {
    // #35. `mysticalability` emitted `assocMysteryCode` while 0.8.x had already
    // replaced it with `assocAffiliationCode`. It compiled clean and the value
    // was gone at load.
    it("catches the assocMysteryCode case (#35)", () => {
        const { undeclared } = compareFields({
            builders: {
                mysticalability: [
                    { to: "subType" },
                    { to: "assocMysteryCode" },
                ],
            },
            artifact: artifact({
                Item: {
                    mysticalability: {
                        own: ["subType", "assocAffiliationCode"],
                        inherited: ["notes"],
                    },
                },
            }),
        });

        expect(undeclared).toHaveLength(1);
        expect(undeclared[0].field).toBe("assocMysteryCode");
        expect(undeclared[0].systemVersion).toBe("0.8.2");
    });

    // sohl-kethira-basic#30. `affiliation.subType` is authored on all 21 deities
    // and *is* defined on sohl `main` — but not at 0.8.2, which is what the
    // module pins. A check against `main` passes and the field still evaporates
    // for every user, which is why the comparison is against the declared
    // `compatibility.verified`.
    it("catches a field defined on main but not at the pinned version", () => {
        const builders = { affiliation: [{ to: "subType" }] };

        const atPin = compareFields({
            builders,
            artifact: artifact({
                Item: { affiliation: { own: [], inherited: ["notes"] } },
            }),
        });
        expect(atPin.undeclared.map((f) => f.field)).toEqual(["subType"]);

        // The same comparison against a later schema is clean — which is
        // precisely why the pinned one is the one that counts.
        const atMain = compareFields({
            builders,
            artifact: artifact(
                { Item: { affiliation: { own: ["subType"], inherited: [] } } },
                "0.9.0",
            ),
        });
        expect(atMain.undeclared).toEqual([]);
    });

    it("names the version in the message, so a pin is distinguishable from a typo", () => {
        const msg = undeclaredMessage({
            type: "affiliation",
            subtype: "affiliation",
            documentType: "Item",
            field: "subType",
            systemVersion: "0.8.2",
        });
        expect(msg).toContain("does not define at 0.8.2");
        expect(msg).toContain("without a warning");
    });
});

describe("declared but not emitted — reported, and only for own fields", () => {
    // content-build#3 fixed one of these by hand.
    it("reports a field the subtype declares that no builder writes", () => {
        const { unemitted } = compareFields({
            builders: { skill: [{ to: "subType" }] },
            artifact: artifact({
                Item: {
                    skill: {
                        own: ["subType", "masteryLevelBase"],
                        inherited: [],
                    },
                },
            }),
        });
        expect(unemitted.map((f) => f.field)).toEqual(["masteryLevelBase"]);
    });

    // The noise this direction would otherwise be: every subtype inherits
    // `notes` and `docHtml`, which the system fills and no content builder is
    // expected to emit.
    it("stays silent about inherited fields no builder emits", () => {
        const { unemitted } = compareFields({
            builders: { skill: [{ to: "subType" }] },
            artifact: artifact({
                Item: {
                    skill: {
                        own: ["subType"],
                        inherited: ["notes", "docHtml", "macros"],
                    },
                },
            }),
        });
        expect(unemitted).toEqual([]);
    });

    // Found by running the comparison against sohl's real `mysticalability`
    // before any of this shipped: the builder writes `charges` as a whole
    // object, the schema declares `charges.value` and `charges.max` beneath it,
    // and both leaves were reported as unwritten on a type that populates them
    // correctly. A false finding on the first real schema tried is the kind
    // that teaches people to ignore the report.
    it("treats a leaf as written when the builder emits its parent object", () => {
        const { unemitted } = compareFields({
            builders: { mysticalability: [{ to: "charges" }] },
            artifact: artifact({
                Item: {
                    mysticalability: {
                        own: ["charges", "charges.value", "charges.max"],
                        inherited: [],
                    },
                },
            }),
        });
        expect(unemitted).toEqual([]);
    });

    it("still reports a leaf whose parent is not emitted either", () => {
        const { unemitted } = compareFields({
            builders: { mysticalability: [{ to: "subType" }] },
            artifact: artifact({
                Item: {
                    mysticalability: {
                        own: ["subType", "charges", "charges.value"],
                        inherited: [],
                    },
                },
            }),
        });
        expect(unemitted.map((f) => f.field).sort()).toEqual([
            "charges",
            "charges.value",
        ]);
    });

    it("explains what a reader would see instead", () => {
        expect(
            unemittedMessage({
                type: "skill",
                subtype: "skill",
                documentType: "Item",
                field: "masteryLevelBase",
                systemVersion: "0.8.2",
            }),
        ).toContain("initial value rather than an authored one");
    });
});

describe("what the comparison refuses to guess", () => {
    // A builder compiling into a subtype the system does not define is a
    // routing question (#79), not a field one. Counted rather than reported, so
    // the number is never mistaken for coverage.
    it("skips a type the artifact says nothing about", () => {
        const { undeclared, unemitted, skipped } = compareFields({
            builders: { armorlocation: [{ to: "layers" }] },
            artifact: artifact({ Item: { skill: { own: [], inherited: [] } } }),
        });
        expect(skipped).toEqual(["armorlocation"]);
        expect(undeclared).toEqual([]);
        expect(unemitted).toEqual([]);
    });

    // The note type and the document subtype coincide today by accident rather
    // than by rule (#78/#79), so the mapping is a seam rather than an
    // assumption baked in.
    it("routes through subtypeOf, so the explicit map can replace the coincidence", () => {
        const { undeclared } = compareFields({
            builders: { armor: [{ to: "layers" }] },
            artifact: artifact({
                Item: { armorgear: { own: ["layers"], inherited: [] } },
            }),
            subtypeOf: (type) => (type === "armor" ? "armorgear" : type),
        });
        expect(undeclared).toEqual([]);
    });

    it("stops on an artifact written to a shape it does not read", () => {
        expect(() =>
            compareFields({
                builders: {},
                artifact: { version: 99, documents: {} } as never,
            }),
        ).toThrow(/expected 1/);
    });
});
