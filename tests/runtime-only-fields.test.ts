/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Fields a note may never author, because the document writes them in play
 * (#330).
 *
 * The defect these pin: a schema declares `onsetDate` — the world time an
 * affliction's onset fired at — and a note could write it under
 * `sohl.system.onsetDate`, where `mergeSystemData` passed it through verbatim
 * onto the compiled document. Every check that might have caught it declined
 * for its own correct reason, so shipped content could carry one world's play
 * state with the build reporting success.
 *
 * Both directions of the fix are asserted, because they are one declaration:
 * authoring the field is **refused**, and absent it the key is **omitted** so
 * the data model's own `initial` stands rather than a compile-time default.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { authoredFields, buildFromFields, runtimeOnlyFields } from "../engine/field-spec.mjs";
import {
    assertNoRuntimeOnlyFields,
    authoredRuntimeOnlyFields,
    runtimeOnlyIn,
    runtimeOnlyMessage,
} from "../engine/runtime-only-fields.mjs";
import { claimedPaths } from "../engine/system-block.mjs";
import { SCHEMA_ARTIFACT_VERSION, compareFields, emittedFields } from "../engine/schema-check.mjs";
import { renderItemFieldReference } from "../engine/field-reference.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A declaration with one ordinary field and one the document writes in play. */
const DECLARED = [
    { name: "levelBase", to: "levelBase", default: 0, describe: "Severity." },
    {
        to: "onsetDate",
        runtimeOnly: "the world time onset fired at",
        describe: "When onset fired. Play state, never authored.",
    },
] as never[];

describe("the declaration says which fields play writes", () => {
    it("selects exactly the runtime-only entries", () => {
        expect(runtimeOnlyFields(DECLARED).map((f: any) => f.to)).toEqual(["onsetDate"]);
    });

    it("keeps them out of the authored vocabulary, so no surface offers them", () => {
        // They carry no `name`, which is what every author-facing reader
        // filters on — the reference generator, the frontmatter lint, the
        // content-format agreement check.
        expect(authoredFields(DECLARED).map((f: any) => f.name)).toEqual(["levelBase"]);
    });

    it("still claims the path, so the verbatim passthrough leaves it alone", () => {
        // The claim is the reason the declaration carries a `to` at all: it is
        // what gives `mergeSystemData` something to skip and the refusal
        // something to name.
        expect([...claimedPaths(DECLARED)]).toContain("onsetDate");
    });
});

describe("absent, the key is omitted rather than defaulted", () => {
    it("emits nothing at the path, so the data model's own initial stands", () => {
        const built = buildFromFields(DECLARED)({ sohl: { levelBase: 2 } });
        expect(built).toEqual({ levelBase: 2 });
        expect(Object.hasOwn(built, "onsetDate")).toBe(false);
    });

    it("would otherwise ship the key, which is the whole reason for the skip", () => {
        // Without the skip a source-less declaration resolves to `undefined`
        // and `setPath` writes the key — present in the object, and a `null`
        // or a `0` the moment anything coerces it.
        const asOrdinary = buildFromFields([{ ...DECLARED[1], runtimeOnly: undefined }] as never[])(
            {},
        );
        expect(Object.hasOwn(asOrdinary, "onsetDate")).toBe(true);
    });
});

describe("authored, it is found wherever a note wrote it", () => {
    const found = (fm: object) =>
        authoredRuntimeOnlyFields(fm, DECLARED, { block: "sohl" }).map((f: any) => f.to);

    it("finds one written at the destination path", () => {
        expect(found({ sohl: { system: { onsetDate: 86400 } } })).toEqual(["onsetDate"]);
    });

    it("finds one written as `null`, because presence is the whole test", () => {
        // `null` is not an escape: it reads as "this affliction has not onset
        // yet", which is a claim about play state and exactly the belief the
        // message exists to correct. `0` is a valid world time besides.
        expect(found({ sohl: { system: { onsetDate: null } } })).toEqual(["onsetDate"]);
        expect(found({ sohl: { system: { onsetDate: 0 } } })).toEqual(["onsetDate"]);
    });

    it("says nothing about a note that writes only authorable fields", () => {
        expect(found({ sohl: { levelBase: 3, system: { healingRateBase: 2 } } })).toEqual([]);
    });

    it("reads a `system` block directly, for an embedded item's overlay", () => {
        expect(runtimeOnlyIn({ onsetDate: 12 }, DECLARED).map((f: any) => f.to)).toEqual([
            "onsetDate",
        ]);
        expect(runtimeOnlyIn({ levelBase: 12 }, DECLARED)).toEqual([]);
    });

    it("holds for a type that declares no fields at all", () => {
        expect(
            authoredRuntimeOnlyFields({ sohl: { system: { x: 1 } } }, undefined, {
                block: "sohl",
            }),
        ).toEqual([]);
    });
});

describe("the refusal", () => {
    it("throws, naming the whole key and the reason the declaration gives", () => {
        expect(() =>
            assertNoRuntimeOnlyFields({ sohl: { system: { onsetDate: 5 } } }, DECLARED, {
                block: "sohl",
            }),
        ).toThrow(/sohl\.system\.onsetDate/);
        expect(() =>
            assertNoRuntimeOnlyFields({ sohl: { system: { onsetDate: 5 } } }, DECLARED, {
                block: "sohl",
            }),
        ).toThrow(/the world time onset fired at/);
    });

    it("says the field is runtime state and that deleting it is the fix", () => {
        const message = runtimeOnlyMessage("sohl.system.onsetDate", DECLARED[1] as never);
        expect(message).toContain("runtime state");
        expect(message).toContain("delete it");
        // No value corrects it, so the message must not read as one that could.
        expect(message).not.toMatch(/instead, write|use .* instead of/i);
    });

    it("passes a note that authors none", () => {
        expect(() =>
            assertNoRuntimeOnlyFields({ sohl: { levelBase: 1 } }, DECLARED, { block: "sohl" }),
        ).not.toThrow();
    });

    it("carries a position, so the diagnostic opens on the offending line", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-runtime-only-"));
        const absPath = path.join(dir, "Plague.md");
        fs.writeFileSync(
            absPath,
            [
                "---",
                "type: affliction",
                "sohl:",
                "  system:",
                "    onsetDate: 86400",
                "---",
                "",
            ].join("\n"),
            "utf8",
        );
        try {
            let caught: any;
            try {
                assertNoRuntimeOnlyFields({ sohl: { system: { onsetDate: 86400 } } }, DECLARED, {
                    block: "sohl",
                    absPath,
                });
            } catch (err) {
                caught = err;
            }
            // Line 5 of the file, which is the key itself and not the `sohl:`
            // that introduces it.
            expect(caught?.position?.line).toBe(5);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("SoHL declares its timed-phase dates as runtime state", () => {
    const runtime = (type: string) =>
        runtimeOnlyFields((ITEM_FIELDS as any)[type]).map((f: any) => f.to);

    it("covers every `…Date` an affliction stores", () => {
        expect(runtime("affliction").sort()).toEqual([
            "contractDate",
            "onsetDate",
            "resolutionDate",
            "treatmentDate",
        ]);
    });

    it("covers every `…Date` a trauma stores", () => {
        expect(runtime("trauma").sort()).toEqual(["contractDate", "treatmentDate"]);
    });

    it("gives each one its own reason, which is what the message prints", () => {
        for (const type of ["affliction", "trauma"]) {
            for (const field of runtimeOnlyFields((ITEM_FIELDS as any)[type]) as any[]) {
                expect(field.runtimeOnly).toMatch(/world time/);
            }
        }
    });

    it("offers none of them as authorable vocabulary", () => {
        const authored = authoredFields((ITEM_FIELDS as any).affliction).map((f: any) => f.name);
        expect(authored).not.toContain("onsetDate");
        expect(authored).toContain("onsetFormula");
    });
});

describe("the schema check treats them as neither emitted nor missing", () => {
    const fields = DECLARED;
    const artifact = {
        version: SCHEMA_ARTIFACT_VERSION,
        system: "sohl",
        systemVersion: "0.8.5",
        documents: { Item: { affliction: { own: ["levelBase", "onsetDate"], inherited: [] } } },
    };

    it("does not claim the builder writes the path", () => {
        expect([...emittedFields(fields as never)]).toEqual(["levelBase"]);
    });

    it("does not report it as a field the builder forgot", () => {
        // "every compiled document will carry the field's initial value" is
        // precisely what a runtime-only field is *for*, so the warning would be
        // permanent and no correct declaration could clear it.
        const { unemitted, undeclared } = compareFields({
            builders: { affliction: fields as never },
            artifact: artifact as never,
        });
        expect(undeclared).toEqual([]);
        expect(unemitted).toEqual([]);
    });

    it("still reports an ordinary field the builder does not write", () => {
        const { unemitted } = compareFields({
            builders: { affliction: [fields[0]] as never },
            artifact: {
                ...artifact,
                documents: {
                    Item: { affliction: { own: ["levelBase", "outcome"], inherited: [] } },
                },
            } as never,
        });
        expect(unemitted.map((f: any) => f.field)).toEqual(["outcome"]);
    });
});

describe("the generated author-facing reference says they are never authored", () => {
    const page = renderItemFieldReference();

    it("names each one, with the reason its declaration gives", () => {
        expect(page).toContain("**Never authored.**");
        expect(page).toContain("`onsetDate` — the world time onset fired at");
        expect(page).toContain("`contractDate` — the world time the injury was taken");
    });

    it("does not list them as fields in a type's table", () => {
        // A table row would read as an invitation to write one.
        expect(page).not.toContain("| `onsetDate`");
    });
});

/* --------------------------------------------------------------------- */
/*  End to end, through the compilers that read a note                    */
/* --------------------------------------------------------------------- */

/** A note in the tree's shape. */
function note(fm: Record<string, unknown>, body = "A plague.\n"): string {
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

/** An affliction note, with whatever `sohl` block a case needs. */
const afflictionNote = (shortcode: string, sohl: Record<string, unknown>) => ({
    name: { full: `The ${shortcode}` },
    id: `AAAAAAAAAAAA${shortcode.slice(0, 4).padEnd(4, "x")}`,
    type: "affliction",
    shortcode,
    sohl: { subType: "disease", templatePriority: null, ...sohl },
});

let tmp: string;
let content: string;

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-runtime-only-compile-"));
    content = path.join(tmp, "content");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(
        path.join(content, "Clean.md"),
        note(afflictionNote("clen", { levelBase: 3, onsetFormula: "2d6" })),
    );
    fs.writeFileSync(
        path.join(content, "Dated.md"),
        note(afflictionNote("datd", { levelBase: 3, system: { onsetDate: 86400 } })),
    );
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("the Item pass, over a tree carrying both", () => {
    let pack: any;
    let out: string;

    beforeAll(async () => {
        out = path.join(tmp, "out");
        fs.mkdirSync(out, { recursive: true });
        pack = new Items({ skipDirectories: [], contentBase: content, dest: out });
        await pack.compile();
    });

    /** Every emitted document, by name. */
    const emitted = () =>
        Object.fromEntries(
            fs
                .readdirSync(out)
                .filter((f) => f.endsWith(".json"))
                .map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")))
                .map((doc) => [doc.name, doc]),
        );

    it("compiles the note that authors none", () => {
        expect(emitted()["The clen"]).toBeDefined();
    });

    it("refuses the note that authors one, rather than emitting it", () => {
        expect(emitted()["The datd"]).toBeUndefined();
    });

    it("counts and reports the refusal, so it is never a silent skip", () => {
        expect(pack.errorCount).toBeGreaterThan(0);
    });

    it("leaves the field out of the compiled document altogether", () => {
        // Not `null`, not `0` — absent, so Foundry applies the data model's own
        // `initial` and a pack ships no claim about world time at all.
        const doc = emitted()["The clen"];
        expect(Object.hasOwn(doc.system, "onsetDate")).toBe(false);
        expect(Object.hasOwn(doc.system, "contractDate")).toBe(false);
        // And the authorable half of the same triplet still compiles.
        expect(doc.system.onsetFormula).toBe("2d6");
    });
});

describe("an actor's embedded `items:` entry, whose `system:` merges verbatim", () => {
    /** The Actor compiler, against this repository's own configuration. */
    const actors = () =>
        new Actors({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: loadPackConfig().paths.packJson,
        });

    /** Resolve one stand-alone embedded entry, capturing what was reported. */
    function embed(overlay: object) {
        const said: string[] = [];
        const error = vi
            .spyOn(console, "error")
            .mockImplementation((line: unknown) => void said.push(String(line)));
        try {
            const pass = actors() as any;
            const item = pass.resolveEmbedded(
                new Map(),
                "AAAAAAAAAAAAAAAA",
                "trauma",
                null,
                overlay,
                "items[0]",
                'being "Ancient Warrior"',
            );
            return { item, said, errorCount: pass.errorCount };
        } finally {
            error.mockRestore();
        }
    }

    it("refuses an entry authoring a runtime-only field", () => {
        // The overlay reaches the document through `deepMerge`, past every
        // field declaration — which left it the one position still open once
        // the item note's own was closed.
        const { item, said, errorCount } = embed({
            name: "Gash",
            system: { levelBase: 3, contractDate: 86400 },
        });
        expect(item).toBeNull();
        expect(errorCount).toBe(1);
        expect(said.join("\n")).toMatch(/contractDate/);
    });

    it("resolves one that authors only real content", () => {
        const { item, errorCount } = embed({ name: "Gash", system: { levelBase: 3 } });
        expect(errorCount).toBe(0);
        expect(item?.system?.levelBase).toBe(3);
    });
});

describe("the pass reaches the type's declaration to make the refusal", () => {
    /** The Item compiler, against this repository's own configuration. */
    const items = () =>
        new Items({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: loadPackConfig().paths.packJson,
        });

    it("refuses an affliction authoring a date", () => {
        expect(() =>
            (items() as any).assertAuthorable(
                afflictionNote("aaaa", { system: { contractDate: 1 } }),
            ),
        ).toThrow(/contractDate/);
    });

    it("refuses a trauma authoring one", () => {
        expect(() =>
            (items() as any).assertAuthorable({
                ...afflictionNote("bbbb", { system: { treatmentDate: 1 } }),
                type: "trauma",
            }),
        ).toThrow(/treatmentDate/);
    });

    it("says nothing about a type that declares no runtime-only field", () => {
        expect(() =>
            (items() as any).assertAuthorable({
                name: { full: "Awareness" },
                id: "DDDDDDDDDDDDDDDD",
                type: "skill",
                shortcode: "awar",
                sohl: { subType: "physical", templatePriority: null, system: { onsetDate: 1 } },
            }),
        ).not.toThrow();
    });
});
