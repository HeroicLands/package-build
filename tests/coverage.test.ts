/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Localization coverage: does every key the package *references* exist, and is
 * every key it *declares* referenced.
 *
 * The extraction is described here in source text rather than through a fixture
 * repository, which is what the pure split buys: a rule about template literals
 * is a three-line case instead of a directory.
 */

import { describe, it, expect } from "vitest";

import {
    analyzeCoverage,
    collectScriptReferences,
    collectTemplateReferences,
    keyRootsOf,
    mergeReferences,
} from "../coverage.mjs";

const ROOTS = ["SOHL", "TYPES"];
const script = (source: string) =>
    collectScriptReferences(source, { file: "src/a.ts", roots: ROOTS });
const template = (source: string) =>
    collectTemplateReferences(source, {
        file: "templates/a.hbs",
        roots: ROOTS,
    });

/** A localization file as it is authored, so positions are real. */
const asLangFile = (entries: Record<string, string>) =>
    JSON.stringify(entries, null, 4);

describe("keyRootsOf", () => {
    it("takes the roots from the keys that are declared", () => {
        expect(keyRootsOf(["SOHL.a.b", "SOHL.c", "TYPES.Item.skill"])).toEqual([
            "SOHL",
            "TYPES",
        ]);
    });

    // A shorter root must not claim the head of a longer one, whichever order
    // they arrive in.
    it("does not let one root shadow a longer one", () => {
        const { keys } = collectScriptReferences(
            'const a = "TYPES.Item.skill";',
            { file: "src/a.ts", roots: keyRootsOf(["TYPE.a", "TYPES.b"]) },
        );
        expect(keys.map((k) => k.key)).toEqual(["TYPES.Item.skill"]);
    });
});

describe("collectScriptReferences", () => {
    it("finds a key in a string literal, and says where it is", () => {
        const source = [
            "const label = localize(",
            '    "SOHL.Skill.label",',
            ");",
        ].join("\n");
        const { keys } = script(source);

        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatchObject({
            key: "SOHL.Skill.label",
            file: "src/a.ts",
            line: 2,
        });
    });

    // The reason the scan reads the AST rather than the text: a key named in a
    // JSDoc `@example` is documentation, and requiring it to exist would make
    // the guard fail on prose.
    it("ignores a key named only in a comment", () => {
        const source = [
            '/** @example localize("SOHL.NotReal.key") */',
            "export const x = 1;",
            "// SOHL.AlsoNotReal.key",
        ].join("\n");
        expect(script(source).keys).toEqual([]);
    });

    it("ignores a token under a root the package does not declare", () => {
        expect(script('const a = "OTHER.Skill.label";').keys).toEqual([]);
    });

    // `TYPES.base` inside `BEHAVIOR.TYPES.base` is Foundry core's, not a key of
    // this package's.
    it("ignores a root that is itself part of a longer path", () => {
        expect(script('const a = "BEHAVIOR.TYPES.base";').keys).toEqual([]);
    });

    it("treats a dynamic key as a shape, not as a concrete key", () => {
        const { keys, namespaces, patterns } = script(
            "const k = `SOHL.Calendar.Month.${index}.label`;",
        );

        expect(keys).toEqual([]);
        expect(namespaces).toContain("SOHL.Calendar.Month");
        expect(patterns).toContain("SOHL.Calendar.Month.*.label");
    });

    // Joining the chunks either side of a `${…}` would mint a key that is not
    // in the file at all.
    it("never glues a key across a substitution", () => {
        const { keys } = script(
            "const k = `SOHL.Skill.Action.${kind}Test.label`;",
        );
        expect(keys).toEqual([]);
    });

    it("still finds a concrete key inside a template literal", () => {
        // Inline markup in a helper is a template literal, so its keys are not
        // string-literal nodes and would otherwise be invisible.
        const { keys } = script(
            'const html = `<p>{{localize "SOHL.Skill.label"}}</p>`;',
        );
        expect(keys.map((k) => k.key)).toEqual(["SOHL.Skill.label"]);
    });

    // A DataModel names the prefix; Foundry localizes the leaves beneath it.
    it("reads LOCALIZATION_PREFIXES as namespaces", () => {
        const source =
            'class X { static LOCALIZATION_PREFIXES = ["SOHL.Item.Skill"]; }';
        const { namespaces, keys } = script(source);

        expect(namespaces).toContain("SOHL.Item.Skill");
        expect(keys).toEqual([]);
    });

    it("reports source that does not parse, rather than reading nothing", () => {
        const { findings } = script("const = = ;");
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].file).toBe("src/a.ts");
    });
});

describe("collectTemplateReferences", () => {
    it("finds a key a template localizes, and says where it is", () => {
        const source = [
            "<h2>",
            '    {{localize "SOHL.Skill.label"}}',
            "</h2>",
        ].join("\n");
        const { keys } = template(source);

        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatchObject({ key: "SOHL.Skill.label", line: 2 });
    });

    it("treats a concatenated key as a shape", () => {
        const { keys, patterns } = template(
            "{{localize (concat 'SOHL.Skill.' kind)}}",
        );

        expect(keys).toEqual([]);
        expect(patterns.length).toBeGreaterThan(0);
    });
});

describe("mergeReferences", () => {
    it("keeps every reference and de-duplicates the prefixes", () => {
        const merged = mergeReferences([
            script('const a = "SOHL.a.b";'),
            template('{{localize "SOHL.a.b"}}'),
            {
                keys: [],
                namespaces: ["SOHL.a"],
                patterns: [],
                findings: [],
            },
        ]);

        expect(merged.keys).toHaveLength(2);
        expect(merged.namespaces).toEqual(["SOHL.a"]);
    });
});

describe("analyzeCoverage", () => {
    /** Run the analysis over one declared file and one reference set. */
    const analyze = (
        declared: Record<string, string>,
        references: Partial<{
            keys: unknown[];
            namespaces: string[];
            patterns: string[];
        }> = {},
        options: Record<string, unknown> = {},
    ) =>
        analyzeCoverage({
            langSource: asLangFile(declared),
            langFile: "lang/en.json",
            references: {
                keys: [],
                namespaces: [],
                patterns: [],
                findings: [],
                ...references,
            },
            ...options,
        });

    it("passes when every referenced key is declared and every key is used", () => {
        const { findings } = analyze(
            { "SOHL.Skill.label": "Skill" },
            { keys: [{ key: "SOHL.Skill.label", file: "src/a.ts", line: 3 }] },
        );
        expect(findings).toEqual([]);
    });

    it("reports a referenced key the file does not declare, at its use", () => {
        const { findings } = analyze(
            { "SOHL.Skill.label": "Skill" },
            {
                keys: [
                    { key: "SOHL.Skill.label", file: "src/a.ts", line: 2 },
                    { key: "SOHL.Skill.gone", file: "src/a.ts", line: 3 },
                ],
            },
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "src/a.ts",
            line: 3,
            severity: "error",
        });
        expect(findings[0].message).toContain("SOHL.Skill.gone");
        expect(findings[0].message).toContain("lang/en.json");
    });

    it("reports one finding per site that references a missing key", () => {
        const { findings } = analyze(
            {},
            {
                keys: [
                    { key: "SOHL.a.b", file: "src/a.ts" },
                    { key: "SOHL.a.b", file: "src/b.ts" },
                ],
            },
        );
        expect(findings.map((f) => f.file)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    // A referenced token that is only ever a prefix of real keys is a
    // namespace: `SOHL.Skill` beside `SOHL.Skill.label` is how a DataModel or a
    // dynamic call site names a family.
    it("accepts a reference that is a prefix of declared keys", () => {
        const { findings } = analyze(
            { "SOHL.Skill.label": "Skill" },
            {
                keys: [
                    { key: "SOHL.Skill", file: "src/a.ts" },
                    { key: "SOHL.Skill.label", file: "src/a.ts" },
                ],
            },
        );
        expect(findings).toEqual([]);
    });

    // Unless the caller says the key is minted verbatim — a generated label is
    // required to exist however many keys happen to sit beneath it.
    it("still reports an exact reference that is a prefix of declared keys", () => {
        const { findings } = analyze(
            { "SOHL.Skill.label": "Skill" },
            {
                keys: [
                    {
                        key: "SOHL.Skill",
                        file: "src/a.ts",
                        exact: true,
                        origin: "defineType generates",
                    },
                ],
            },
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/^defineType generates/);
    });

    it("reports an unreferenced key as advisory, at its line in the file", () => {
        // Advisory, not a failure: a key nobody references is worth reading
        // about and is not a reason to refuse to ship a package. It is reported
        // apart from the errors for that reason — one says the package is
        // broken, the other that it carries something nobody could see a use
        // for.
        const { findings, unreferenced } = analyze({
            "SOHL.Skill.label": "Skill",
            "SOHL.Skill.stale": "Stale",
        });

        expect(findings).toEqual([]);
        expect(unreferenced).toHaveLength(2);
        expect(unreferenced.every((f) => f.severity === "warning")).toBe(true);
        expect(unreferenced[0]).toMatchObject({
            file: "lang/en.json",
            line: 2,
        });
    });

    it("counts a key matched by a dynamic shape as referenced", () => {
        const { unreferenced } = analyze(
            {
                "SOHL.Month.1.label": "First",
                "SOHL.Month.2.label": "Second",
            },
            { patterns: ["SOHL.Month.*.label"] },
        );
        expect(unreferenced).toEqual([]);
    });

    // A shape vouches for exactly what that construction can build — matching
    // on the head instead would let one `SOHL.${x}` vouch for the whole file.
    it("does not let a shape vouch beyond the segment it fills", () => {
        const { unreferenced } = analyze(
            { "SOHL.Month.1.deep.label": "…" },
            { patterns: ["SOHL.Month.*.label"] },
        );
        expect(unreferenced).toHaveLength(1);
        expect(unreferenced[0].severity).toBe("warning");
    });

    // Foundry localizes a DataModel's field labels and hints off the declared
    // prefix, so nothing in the source ever names them.
    it("counts a field label under a declared namespace as referenced", () => {
        const { unreferenced } = analyze(
            {
                "SOHL.Item.Skill.FIELDS.masteryLevel.label": "Mastery",
                "SOHL.Item.Skill.FIELDS.masteryLevel.hint": "…",
            },
            { namespaces: ["SOHL.Item.Skill"] },
        );
        expect(unreferenced).toEqual([]);
    });

    // A namespace does *not* vouch for every key beneath it — that is what made
    // the unreferenced half of this guard report zero forever.
    it("does not let a namespace vouch for an arbitrary key beneath it", () => {
        const { unreferenced } = analyze(
            { "SOHL.Item.Skill.stale": "Stale" },
            { namespaces: ["SOHL.Item.Skill"] },
        );
        expect(unreferenced).toHaveLength(1);
        expect(unreferenced[0].severity).toBe("warning");
    });

    it("keeps a key the repository has justified retaining", () => {
        const { findings, unreferenced } = analyze(
            { "SOHL.Gear.Action.drop": "Drop" },
            {},
            { retained: ["SOHL.Gear.Action."] },
        );
        expect([...findings, ...unreferenced]).toEqual([]);
    });

    it("ignores a declared key under no known root", () => {
        // Foundry's own `FIELDS.*` and a module's borrowed keys are not this
        // package's to account for.
        const { findings, unreferenced } = analyze(
            { "OTHER.thing": "Thing" },
            {},
            { roots: ["SOHL"] },
        );
        expect([...findings, ...unreferenced]).toEqual([]);
    });

    it("says only that the file does not parse when it does not", () => {
        const { findings } = analyzeCoverage({
            langSource: '{ "a": }',
            langFile: "lang/en.json",
            references: {
                keys: [],
                namespaces: [],
                patterns: [],
                findings: [],
            },
        });

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("not valid JSON");
    });

    it("carries through what the extraction could not resolve", () => {
        const { findings } = analyze({}, {
            findings: [
                {
                    file: "src/a.ts",
                    line: 9,
                    severity: "warning",
                    message: "not statically resolvable",
                },
            ],
        } as never);
        expect(findings).toContainEqual({
            file: "src/a.ts",
            line: 9,
            severity: "warning",
            message: "not statically resolvable",
        });
    });

    it("reports what it looked at", () => {
        const { stats } = analyze(
            { "SOHL.a": "A", "SOHL.b": "B" },
            { keys: [{ key: "SOHL.a", file: "src/a.ts" }] },
        );

        expect(stats).toMatchObject({
            declared: 2,
            referenced: 1,
            missing: 0,
            unreferenced: 1,
        });
    });
});
