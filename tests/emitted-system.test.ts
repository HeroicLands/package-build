/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The `system` keys a **compiler** writes, against the receiving DataModel
 * (#155).
 *
 * `compareFields` (#60) derives what a build emits from the `itemBuilders`
 * field declarations, so a key the compiler writes itself — `shortcode`,
 * `actionDefs`, `notes`, `docHtml`, and since #126 `archetype` — is in neither
 * the emitted set nor the declared one, and is never compared. #145's
 * authored-`system` check does not reach them either: it reads
 * `<system>.system`, and these are written by the compiler rather than authored
 * under that path.
 *
 * That is the whole of the gap, and it is the failure #60 exists to make
 * impossible: Foundry discards an unknown `system` key at construction without
 * a word, so the field is simply absent at load while the build reports
 * success.
 *
 * The emitted set here is **observed, not declared** — the compilers assemble a
 * `system` object and this reads the keys off what they produced, after the
 * JSON round trip the pack file actually receives. A list of compiler-written
 * keys would be the thing that rots; the assembled object cannot be.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    SCHEMA_ARTIFACT_VERSION,
    compareEmittedSystem,
    compareFields,
    emittedUndeclaredMessage,
} from "../engine/schema-check.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A published schema, in the shape a system emits. */
const artifact = (documents: object, systemVersion = "0.8.2") => ({
    version: SCHEMA_ARTIFACT_VERSION,
    system: "sohl",
    systemVersion,
    documents,
});

/** The Item compiler, against this repository's own configuration. */
function items() {
    const config = loadPackConfig();
    return new Items({
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** The Actor compiler. Nothing here walks a tree or reads a pack. */
function actors() {
    const config = loadPackConfig();
    return new Actors({
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** A skill note, with whatever `sohl` block a case needs. */
const skillNote = (sohl: Record<string, unknown>) => ({
    id: "DDDDDDDDDDDDDDDD",
    type: "skill",
    shortcode: "awar",
    name: { full: "Awareness" },
    sohl: { subType: "physical", archetype: 0, ...sohl },
});

/** A being note, likewise. */
const beingNote = (sohl: Record<string, unknown>) => ({
    id: "EEEEEEEEEEEEEEEE",
    type: "being",
    shortcode: "folk",
    name: { full: "Basic Folk" },
    sohl: { archetype: 0, ...sohl },
});

describe("compareEmittedSystem reads the keys off the assembled object", () => {
    const declaresNothingExtra = artifact({
        Item: { skill: { own: ["subType"], inherited: ["notes"] } },
    });

    it("reports a key the compiler writes that the schema does not declare", () => {
        const findings = compareEmittedSystem({
            system: { subType: "physical", notes: "", archetype: 0 },
            artifact: declaresNothingExtra,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings.map((f) => f.field)).toEqual(["archetype"]);
    });

    it("says nothing when the schema declares it", () => {
        const findings = compareEmittedSystem({
            system: { subType: "physical", notes: "", archetype: 0 },
            artifact: artifact({
                Item: { skill: { own: ["subType"], inherited: ["notes", "archetype"] } },
            }),
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings).toEqual([]);
    });

    it("does not report a key JSON drops, because the pack never receives it", () => {
        // `undefined` vanishes in `JSON.stringify`, so it is not emitted at all
        // and there is nothing for Foundry to discard.
        const findings = compareEmittedSystem({
            system: { subType: "physical", notes: "", ghost: undefined },
            artifact: declaresNothingExtra,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings).toEqual([]);
    });

    it("reports the shallowest undeclared path, not every leaf beneath it", () => {
        const findings = compareEmittedSystem({
            system: { subType: "physical", charges: { value: 1, max: 3 } },
            artifact: declaresNothingExtra,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings.map((f) => f.field)).toEqual(["charges"]);
    });

    it("walks into a declared container to find an undeclared leaf", () => {
        const findings = compareEmittedSystem({
            system: { charges: { value: 1, bogus: 3 } },
            artifact: artifact({
                Item: { skill: { own: ["charges", "charges.value"], inherited: [] } },
            }),
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings.map((f) => f.field)).toEqual(["charges.bogus"]);
    });

    it("does not walk into a subtree the artifact declares and describes no further", () => {
        // SoHL's `strikeMode` is a discriminated `TypedSchemaField`: published
        // as one path, stored flat as `{ type, name, … }`. Walking into it
        // against a schema that enumerates nothing beneath it reported all ten
        // of a combat technique's stored keys as undeclared — ten findings,
        // every one wrong, about a document that is correct.
        const findings = compareEmittedSystem({
            system: { strikeMode: { type: "melee", name: "Bite", impactBase: 3 } },
            artifact: artifact({
                Item: { skill: { own: ["strikeMode"], inherited: [] } },
            }),
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings).toEqual([]);
    });

    it("leaves an authored path to the note-side check, which can point at a line", () => {
        const findings = compareEmittedSystem({
            system: { subType: "physical", typo: 1 },
            artifact: declaresNothingExtra,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
            authored: new Set(["typo"]),
        });
        expect(findings).toEqual([]);
    });

    it("says nothing about a subtype the artifact does not name", () => {
        expect(
            compareEmittedSystem({
                system: { archetype: 0 },
                artifact: declaresNothingExtra,
                documentType: "Item",
                subtype: "nosuch",
                type: "nosuch",
            }),
        ).toEqual([]);
    });

    it("stops on an artifact written to a shape it does not read", () => {
        expect(() =>
            compareEmittedSystem({
                system: { archetype: 0 },
                artifact: { ...declaresNothingExtra, version: 99 },
                documentType: "Item",
                subtype: "skill",
                type: "skill",
            }),
        ).toThrow(/schema artifact version 99/);
    });
});

describe("the two conditions are told apart, because the fixes differ", () => {
    const schema = artifact({ Item: { skill: { own: [], inherited: [] } } });

    it("calls a key a declared field writes a builder emission", () => {
        const [finding] = compareEmittedSystem({
            system: { subType: "physical" },
            artifact: schema,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
            fields: [{ to: "subType" }],
        });
        expect(finding.origin).toBe("builder");
        // The consumer's own `itemBuilders` names it, so the fix is theirs.
        expect(emittedUndeclaredMessage(finding)).toMatch(/`skill` emits `system.subType`/);
        expect(emittedUndeclaredMessage(finding)).toContain("0.8.2");
    });

    it("calls a key no declared field names a compiler emission", () => {
        const [finding] = compareEmittedSystem({
            system: { archetype: 0 },
            artifact: schema,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
            fields: [{ to: "subType" }],
        });
        expect(finding.origin).toBe("compiler");
        const message = emittedUndeclaredMessage(finding);
        // Nothing in the consumer's configuration writes it, so nothing there
        // can stop it — the message has to say so, or the reader goes looking
        // in `itemBuilders` for a field that is not there.
        expect(message).toMatch(/no field declaration names it/);
        expect(message).toContain("0.8.2");
    });

    it("names the version in both, so a pin reads differently from a typo", () => {
        for (const fields of [[{ to: "subType" }], []]) {
            const [finding] = compareEmittedSystem({
                system: { subType: "physical" },
                artifact: artifact({ Item: { skill: { own: [], inherited: [] } } }, "0.9.0"),
                documentType: "Item",
                subtype: "skill",
                type: "skill",
                fields,
            });
            expect(emittedUndeclaredMessage(finding)).toContain("0.9.0");
        }
    });
});

describe("`archetype` — the key the check was blind to (#155, #126)", () => {
    // The shape SoHL 0.8.2 publishes: everything a `skill` carries except the
    // field #154 started writing.
    const withoutArchetype = artifact({
        Item: {
            skill: {
                own: ["subType", "masteryLevelBase", "skillBaseFormula"],
                inherited: ["shortcode", "actionDefs", "notes", "docHtml"],
            },
        },
        Actor: {
            being: {
                own: ["portrait", "appearance", "dossier"],
                inherited: ["shortcode", "actionDefs", "notes", "docHtml"],
            },
        },
    });

    /** The same, with the field declared on the shared base (SoHL#1785). */
    const withArchetype = artifact({
        Item: {
            skill: {
                own: ["subType", "masteryLevelBase", "skillBaseFormula"],
                inherited: ["shortcode", "actionDefs", "notes", "docHtml", "archetype"],
            },
        },
        Actor: {
            being: {
                own: ["portrait", "appearance", "dossier"],
                inherited: ["shortcode", "actionDefs", "notes", "docHtml", "archetype"],
            },
        },
    });

    /** Every `system` key a real compiled skill carries. */
    const compiledSkill = () => items().buildEntry(skillNote({}), "").system;

    /** Every `system` key a real compiled being carries. */
    const compiledBeing = () => actors().buildBeing(new Map(), beingNote({}), "").system;

    it("fires on a compiled Item against a schema that omits it", () => {
        const findings = compareEmittedSystem({
            system: compiledSkill(),
            artifact: withoutArchetype,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings.map((f) => f.field)).toContain("archetype");
        expect(findings.find((f) => f.field === "archetype")!.origin).toBe("compiler");
    });

    it("is silent on the same document against a schema that declares it", () => {
        const findings = compareEmittedSystem({
            system: compiledSkill(),
            artifact: withArchetype,
            documentType: "Item",
            subtype: "skill",
            type: "skill",
        });
        expect(findings.map((f) => f.field)).not.toContain("archetype");
    });

    it("fires on a compiled Actor too — the actors pass writes it as well", () => {
        const findings = compareEmittedSystem({
            system: compiledBeing(),
            artifact: withoutArchetype,
            documentType: "Actor",
            subtype: "being",
            type: "being",
        });
        expect(findings.map((f) => f.field)).toContain("archetype");
    });

    it("is silent on the Actor against a schema that declares it", () => {
        const findings = compareEmittedSystem({
            system: compiledBeing(),
            artifact: withArchetype,
            documentType: "Actor",
            subtype: "being",
            type: "being",
        });
        expect(findings.map((f) => f.field)).not.toContain("archetype");
    });

    it("is the coverage `compareFields` could not give, which sees nothing either way", () => {
        // Pinned so nobody reads the quiet as coverage: the declaration-derived
        // check answers identically whether or not the schema declares the
        // field, because the field is in neither of the sets it compares.
        const builders = { skill: [{ to: "subType" }, { to: "masteryLevelBase" }] };
        for (const a of [withoutArchetype, withArchetype]) {
            const { undeclared, unemitted } = compareFields({ builders, artifact: a });
            expect([...undeclared, ...unemitted].map((f) => f.field)).not.toContain("archetype");
        }
    });
});

describe("what a build does with it", () => {
    /**
     * A configuration pointing at a throwaway `schema.json`, in the shape
     * `resolveSchemaArtifact` reads for a system checking itself. Each call
     * returns a fresh object, since the artifact is memoized per configuration.
     */
    function configWithSchema(documents: object) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-emitted-"));
        fs.writeFileSync(
            path.join(dir, "schema.json"),
            JSON.stringify(artifact(documents)),
            "utf8",
        );
        return {
            rootDir: dir,
            packageKind: "systems",
            foundryPackage: "sohl",
            stats: { systemId: "sohl", systemVersion: "0.8.2" },
        };
    }

    /**
     * A `skill` schema declaring exactly what a real compiled skill carries —
     * optionally minus the field #154 started writing.
     *
     * Derived from the document rather than typed out, for the same reason the
     * check itself is: a hand-written list of a builder's output is a list that
     * goes stale, and a case that fails because the fixture is behind the
     * builder proves nothing about the field under test.
     */
    const skillSchema = (archetype: boolean) => {
        const emitted = Object.keys(items().buildEntry(skillNote({}), "").system);
        return {
            Item: {
                skill: {
                    own: emitted.filter((k) => archetype || k !== "archetype"),
                    inherited: [],
                },
            },
        };
    };

    it("finds `archetype` on a real compiled document, through the build's own seam", () => {
        const compiler = items();
        const doc = compiler.buildEntry(skillNote({}), "");
        const added = compiler.reportEmittedSystemData(doc.system, {
            fm: skillNote({}),
            block: "sohl",
            documentType: "Item",
            subType: "skill",
            type: "skill",
            config: configWithSchema(skillSchema(false)),
        });
        expect(added).toBeGreaterThan(0);
        expect([...compiler.emittedFindings.keys()]).toContain("Item|skill|archetype");
    });

    it("says nothing once the receiving system declares it", () => {
        const compiler = items();
        const doc = compiler.buildEntry(skillNote({}), "");
        compiler.reportEmittedSystemData(doc.system, {
            fm: skillNote({}),
            block: "sohl",
            documentType: "Item",
            subType: "skill",
            type: "skill",
            config: configWithSchema(skillSchema(true)),
        });
        expect([...compiler.emittedFindings.keys()]).toEqual([]);
    });

    it("reports a key once, not once per document that carries it", () => {
        // The whole reason the findings are collected rather than emitted where
        // they are found: a compiler-written key is on every document of the
        // subtype, and 3,126 copies of one sentence is not a report.
        const compiler = items();
        const config = configWithSchema(skillSchema(false));
        let added = 0;
        for (let i = 0; i < 5; i++) {
            const doc = compiler.buildEntry(skillNote({}), "");
            added += compiler.reportEmittedSystemData(doc.system, {
                fm: skillNote({}),
                block: "sohl",
                documentType: "Item",
                subType: "skill",
                type: "skill",
                config,
            });
        }
        expect(compiler.emittedFindings.size).toBe(added);
        expect(
            [...compiler.emittedFindings.keys()].filter((k) => k === "Item|skill|archetype"),
        ).toHaveLength(1);
    });

    it("fails the pass, because the value is gone at load either way", () => {
        const compiler = items();
        const doc = compiler.buildEntry(skillNote({}), "");
        compiler.reportEmittedSystemData(doc.system, {
            fm: skillNote({}),
            block: "sohl",
            documentType: "Item",
            subType: "skill",
            type: "skill",
            config: configWithSchema(skillSchema(false)),
        });
        const before = compiler.errorCount;
        const reported = compiler.reportEmittedFindings();
        expect(reported).toBeGreaterThan(0);
        expect(compiler.errorCount).toBe(before + reported);
        // Flushed, so a second pass over the same compiler does not repeat them.
        expect(compiler.reportEmittedFindings()).toBe(0);
    });

    it("stays silent for a package with no schema to check against", () => {
        // A module pinning a system released before the artifact existed —
        // which is every satellite on sohl 0.8.2 today. Silence here, and one
        // line from `content-build lint` saying the check did not run.
        const compiler = items();
        const doc = compiler.buildEntry(skillNote({}), "");
        expect(
            compiler.reportEmittedSystemData(doc.system, {
                fm: skillNote({}),
                block: "sohl",
                documentType: "Item",
                subType: "skill",
                type: "skill",
                config: {
                    stats: { systemId: "sohl", systemVersion: "0.8.2" },
                    paths: { foreignCache: path.join(os.tmpdir(), "pb-no-such-cache") },
                },
            }),
        ).toBe(0);
    });
});
