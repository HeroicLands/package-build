/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Declaring a field whose **absence** is meaningful.
 *
 * The defect these pin: an affliction's and a trauma's timed phases are stored
 * as `{…DurationFormula, …DurationBase, …Date}`, and the two authored thirds
 * were declared by nothing. They were reachable only through the raw `system:`
 * passthrough — undocumented, uncoerced, absent from every author-facing
 * surface — so no note in any tree wrote one, every shipped affliction carried
 * `null`, and `rollDuration()` opened `if (!formula) return 0`. The machinery
 * existed; the content that drives it could not be written.
 *
 * They could not simply be declared, either: `buildFromFields` wrote every
 * declared field unconditionally, so a declaration would have stamped `null`
 * onto every document — the same outcome, minus the ability to tell "unset"
 * from "authored as empty".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    authoredFields,
    buildFromFields,
    isAuthored,
    readFieldEntry,
    runtimeOnlyFields,
} from "../engine/field-spec.mjs";
import { SCHEMA_ARTIFACT_VERSION, compareFields, emittedFields } from "../engine/schema-check.mjs";
import { renderItemFieldReference } from "../engine/field-reference.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";
import { Items } from "../sohl/items.mjs";

/** A declaration pairing an ordinary field with one whose absence is meaningful. */
const DECLARED = [
    { name: "levelBase", to: "levelBase", default: 0, describe: "Severity." },
    {
        name: "onsetDurationFormula",
        to: "onsetDurationFormula",
        shape: "roll formula, or a whole number of seconds",
        read: (raw: any) => (raw == null || raw === "" ? null : String(raw)),
        omitWhenAbsent: true,
        describe: "Interval to onset. Omitted when unset.",
    },
] as never[];

const build = (fm: object) => buildFromFields(DECLARED)(fm as never);

describe("a field whose absence is meaningful", () => {
    it("omits the key when the note carries nothing", () => {
        const built = build({ sohl: { levelBase: 3 } });
        expect(built).toEqual({ levelBase: 3 });
        expect(Object.hasOwn(built, "onsetDurationFormula")).toBe(false);
    });

    it("emits it, coerced, when the note carries one", () => {
        expect(build({ sohl: { onsetDurationFormula: "2d6*86400" } })).toMatchObject({
            onsetDurationFormula: "2d6*86400",
        });
    });

    it("stringifies a bare number, which is a valid formula", () => {
        // The world setting's own default is the string `"432000"`, and an
        // author writing the seconds as a number means the same thing.
        expect(build({ sohl: { onsetDurationFormula: 86400 } })).toMatchObject({
            onsetDurationFormula: "86400",
        });
    });

    it("reads it at the destination path as well as in the block", () => {
        expect(build({ sohl: { system: { onsetDurationFormula: "3d6" } } })).toMatchObject({
            onsetDurationFormula: "3d6",
        });
    });

    it("leaves an ordinary field's default alone", () => {
        // The whole point is that this is opt-in per field: `levelBase` still
        // answers absence with a value, as every field did before.
        expect(build({})).toEqual({ levelBase: 0 });
    });

    it("would otherwise write the declared absence over the data model's", () => {
        // Without the skip the key is present and `null` — indistinguishable
        // from an authored one, and overwriting an `initial` the system chose.
        const asOrdinary = buildFromFields([
            { ...(DECLARED[1] as any), omitWhenAbsent: false },
        ] as never[])({});
        expect(Object.hasOwn(asOrdinary, "onsetDurationFormula")).toBe(true);
        expect((asOrdinary as any).onsetDurationFormula).toBeNull();
    });
});

describe("the position, not the value, decides", () => {
    it("reports where a value came from beside it", () => {
        expect(
            readFieldEntry(DECLARED[1] as never, { sohl: { onsetDurationFormula: "2d6" } }),
        ).toEqual({ value: "2d6", from: "block" });
        expect(readFieldEntry(DECLARED[0] as never, {} as never)).toEqual({
            value: 0,
            from: "default",
        });
    });

    it("cannot be answered from the value alone, which is why", () => {
        // A declared `default: null` and an authored `null` are the same value
        // and opposite facts. Only the source separates them.
        expect(isAuthored("default", null)).toBe(false);
        expect(isAuthored("block", null)).toBe(true);
        expect(isAuthored("system", null)).toBe(true);
    });

    it("counts `undefined` as absent whatever position reported it", () => {
        // Emitting it would write a key `JSON.stringify` then drops: present in
        // the object, absent from the pack.
        expect(isAuthored("block", undefined)).toBe(false);
    });
});

describe("SoHL declares both authored thirds of every phase it stores", () => {
    const named = (type: string) =>
        authoredFields((ITEM_FIELDS as any)[type]).map((f: any) => f.name);

    it("covers each affliction phase", () => {
        for (const phase of ["onset", "healingCheck", "resolution"]) {
            expect(named("affliction")).toContain(`${phase}DurationFormula`);
            expect(named("affliction")).toContain(`${phase}DurationBase`);
        }
    });

    it("covers each trauma phase", () => {
        for (const phase of ["healingCheck", "bloodLossAdvance", "course"]) {
            expect(named("trauma")).toContain(`${phase}DurationFormula`);
            expect(named("trauma")).toContain(`${phase}DurationBase`);
        }
    });

    it("declares every one of them omit-when-absent", () => {
        for (const type of ["affliction", "trauma"]) {
            const phases = (ITEM_FIELDS as any)[type].filter((f: any) =>
                /Duration(Formula|Base)$/.test(f.to),
            );
            expect(phases.length).toBe(6);
            for (const field of phases) expect(field.omitWhenAbsent).toBe(true);
        }
    });

    it("leaves the `…Date` third refused, not merely optional", () => {
        // The matching row of the same table. The three thirds are three different
        // answers, and declaring two of them must not soften the third.
        expect(runtimeOnlyFields((ITEM_FIELDS as any).affliction).map((f: any) => f.to)).toEqual([
            "contractDate",
            "onsetDate",
            "treatmentDate",
            "resolutionDate",
        ]);
    });
});

describe("the declaration's invariants hold across every shipped vocabulary", () => {
    const every = () =>
        [...Object.entries(ITEM_FIELDS), ...Object.entries(HM3_ITEM_FIELDS)].flatMap(
            ([type, fields]) => (fields as any[]).map((field) => [type, field] as const),
        );

    it("never pairs omit-when-absent with a default, which contradicts it", () => {
        // A default *is* a value for the absent case, which this says has none.
        for (const [type, field] of every()) {
            if (!field.omitWhenAbsent) continue;
            expect(
                Object.hasOwn(field, "default"),
                `${type}.${field.to} declares both omitWhenAbsent and a default`,
            ).toBe(false);
        }
    });

    it("never pairs it with `required`, which fails rather than omits", () => {
        for (const [type, field] of every()) {
            if (!field.omitWhenAbsent) continue;
            expect(Boolean(field.required), `${type}.${field.to}`).toBe(false);
        }
    });

    it("never pairs it with `runtimeOnly`, which is never emitted at all", () => {
        for (const [type, field] of every()) {
            if (!field.omitWhenAbsent) continue;
            expect(Boolean(field.runtimeOnly), `${type}.${field.to}`).toBe(false);
        }
    });
});

describe("the schema check now sees them as emitted", () => {
    const artifact = {
        version: SCHEMA_ARTIFACT_VERSION,
        system: "sohl",
        systemVersion: "0.8.5",
        documents: {
            Item: {
                affliction: {
                    own: [
                        "levelBase",
                        "onsetDurationFormula",
                        "onsetDurationBase",
                        "healingCheckDurationFormula",
                        "healingCheckDurationBase",
                        "resolutionDurationFormula",
                        "resolutionDurationBase",
                        "contractDate",
                        "onsetDate",
                        "treatmentDate",
                        "resolutionDate",
                    ],
                    inherited: [],
                },
            },
        },
    };

    it("counts a conditionally-emitted field as emitted", () => {
        // Unlike a runtime-only one, which is emitted by nothing. Both omit the
        // key when absent; only this one can ever write it.
        expect([...emittedFields(DECLARED as never)]).toContain("onsetDurationFormula");
    });

    it("clears the unemitted warning the duration fields used to raise", () => {
        const fields = (ITEM_FIELDS as any).affliction.filter(
            (f: any) => f.to === "levelBase" || /Duration(Formula|Base)$|Date$/.test(f.to),
        );
        const { unemitted, undeclared } = compareFields({
            builders: { affliction: fields },
            artifact: artifact as never,
        });
        expect(undeclared).toEqual([]);
        expect(unemitted).toEqual([]);
    });
});

describe("against the pinned SoHL schema this repository vendors", () => {
    // The shape a consumer's `build/cache/foreign/sohl@<version>/schema.json`
    // has, and the artifact `content-build lint` reports against — so this is
    // the warning an author actually met, cleared where they actually met it.
    const artifact = JSON.parse(
        fs.readFileSync(
            path.join(
                path.dirname(new URL(import.meta.url).pathname),
                "fixtures/content-format/schema-sohl.json",
            ),
            "utf8",
        ),
    );

    const unemittedFor = (type: string) =>
        compareFields({
            builders: { [type]: (ITEM_FIELDS as any)[type] },
            artifact,
        }).unemitted.map((f: any) => f.field);

    it.each(["affliction", "trauma"])("reports no duration field of %s as unemitted", (type) => {
        expect(unemittedFor(type).filter((f) => /Duration(Formula|Base)$/.test(f))).toEqual([]);
    });

    it("emits no field the pinned schema does not declare", () => {
        for (const type of ["affliction", "trauma"]) {
            const { undeclared } = compareFields({
                builders: { [type]: (ITEM_FIELDS as any)[type] },
                artifact,
            });
            expect(
                undeclared.map((f: any) => f.field),
                type,
            ).toEqual([]);
        }
    });
});

describe("the generated reference offers them as fields an author writes", () => {
    const page = renderItemFieldReference();

    it("lists each one in its type's table", () => {
        expect(page).toContain("`onsetDurationFormula`");
        expect(page).toContain("`bloodLossAdvanceDurationBase`");
    });

    it("shows no default, because leaving it out omits the key", () => {
        expect(page).toContain("_omitted_");
        // And says what that means, rather than leaving a bare marker.
        expect(page).toContain("the data model's own initial");
    });

    it("still keeps the `…Date` third out of the tables", () => {
        expect(page).not.toContain("| `onsetDate`");
        expect(page).toContain("**Never authored.**");
    });
});

/* --------------------------------------------------------------------- */
/*  End to end, through the Item pass                                     */
/* --------------------------------------------------------------------- */

function note(fm: Record<string, unknown>, body = "A plague.\n"): string {
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

const afflictionNote = (shortcode: string, sohl: Record<string, unknown>) => ({
    name: { full: `The ${shortcode}` },
    id: `AAAAAAAAAAAA${shortcode}`,
    type: "affliction",
    shortcode,
    sohl: { subType: "disease", templatePriority: null, ...sohl },
});

let tmp: string;
let content: string;
let out: string;
let pack: any;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-timed-phase-"));
    content = path.join(tmp, "content");
    out = path.join(tmp, "out");
    fs.mkdirSync(content, { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
        path.join(content, "Timed.md"),
        note(
            afflictionNote("timd", {
                levelBase: 3,
                onsetDurationFormula: "2d6*86400",
                resolutionDurationBase: 604800,
            }),
        ),
    );
    fs.writeFileSync(path.join(content, "Bare.md"), note(afflictionNote("bare", { levelBase: 1 })));
    pack = new Items({ skipDirectories: [], contentBase: content, dest: out });
    await pack.compile();
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("a compiled affliction", () => {
    const emitted = () =>
        Object.fromEntries(
            fs
                .readdirSync(out)
                .filter((f) => f.endsWith(".json"))
                .map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")))
                .map((doc) => [doc.name, doc]),
        );

    it("compiles both notes without error", () => {
        expect(pack.errorCount).toBe(0);
        expect(Object.keys(emitted()).sort()).toEqual(["The bare", "The timd"]);
    });

    it("carries the phases the note declared", () => {
        const sys = emitted()["The timd"].system;
        expect(sys.onsetDurationFormula).toBe("2d6*86400");
        expect(sys.resolutionDurationBase).toBe(604800);
    });

    it("omits the halves that note left out, rather than nulling them", () => {
        const sys = emitted()["The timd"].system;
        expect(Object.hasOwn(sys, "onsetDurationBase")).toBe(false);
        expect(Object.hasOwn(sys, "healingCheckDurationFormula")).toBe(false);
    });

    it("omits every duration key on a note that declares no phase at all", () => {
        // This is the state every shipped affliction was in, and the reason the
        // machinery never fired: `null` reached `rollDuration`, which returns 0.
        // It is now the data model's `initial` that answers, not the build.
        const sys = emitted()["The bare"].system;
        for (const key of Object.keys(sys)) {
            expect(key).not.toMatch(/Duration(Formula|Base)$/);
        }
    });
});
