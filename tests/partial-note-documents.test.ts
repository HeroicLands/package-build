/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A note whose **second** document has no pack, while its first compiles (#152).
 *
 * #146 asks one question of the whole configuration — does any pack claim this
 * type? — and a union over the configured packs answers it. That union cannot
 * see a note that lands half of itself, because one claiming pack satisfies it
 * however many documents the note produces. Two live configurations already
 * have the shape:
 *
 * - `sohl-thalorna` declares no `Macro` and no `Scene` pack, so a `macro` or a
 *   `map` note there compiles its documentation JournalEntry and silently loses
 *   its Macro or its Scene;
 * - `sohl-kethira-basic` declares no `JournalEntry` pack, so its item notes
 *   compile their Items and the prose those notes carry compiles nowhere.
 *
 * Four properties are held here:
 *
 * - a note that compiles one document and loses another is a **finding**,
 *   naming the note, the document class and what is missing;
 * - a type one system maps and another does not stays **silent**, which is
 *   #79's rule and must not start reporting;
 * - the finding distinguishes a **missing pack** from a **missing registry
 *   entry** from a document class this toolchain has **no pass for at all**;
 * - a note *nothing* claims is #146's finding and is never reported twice.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "loglevel";

import { defineConfig } from "../content-config.mjs";
import { defineDocumentSubtypes } from "../engine/document-subtypes.mjs";
import { compilerFor, generatePacksJson } from "../engine/generate.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import {
    COMPILED_DOCUMENT_CLASSES,
    documentsProducedBy,
    noteTypesClaimedBy,
    unclaimedNoteFindings,
    unpackedDocumentFindings,
} from "../engine/note-claims.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                               */
/* ---------------------------------------------------------------------- */

/**
 * A `sohl-thalorna`-shaped pack list: prose and items, and neither of the two
 * packs a `macro` or a `map` note needs for its own document.
 */
const NO_SCENE_OR_MACRO = [
    { name: "journals", type: "JournalEntry" },
    { name: "items", type: "Item" },
];

/**
 * A `sohl-kethira-basic`-shaped pack list: compendium packs only, and nowhere
 * for an item note's prose to go.
 */
const NO_JOURNALS = [{ name: "characteristics", type: "Item", default: true }];

/** The registries a SoHL-shaped fixture answers from. */
const SOHL_SOURCES = {
    itemTypes: new Set(["skill"]),
    docEntryTypes: new Set(["skill", "macro", "map"]),
};

/** A complete configuration with the given packs, rooted anywhere. */
function baseConfig({ packs, rootDir = os.tmpdir(), systems }: any) {
    const named = [...new Set(packs.map((p: any) => p.system).filter(Boolean))] as string[];
    const declared =
        systems ??
        Object.fromEntries(named.map((id) => [id, { compatibility: { verified: "1.0.0" } }]));
    return defineConfig({
        compatibility: { minimum: "14.359", verified: "14.359" },
        rootDir,
        contentPackage: contentPackage(),
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: { lastModifiedBy: "sohltestbuild0000" },
        ...(Object.keys(declared).length ? { systems: declared } : {}),
        packs,
    } as any);
}

const roots: string[] = [];

/** A throwaway repository root holding the given notes. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-partial-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets", "templates"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "assets", "templates", "system.template.json"),
        JSON.stringify({ id: "sohl", compatibility: { minimum: "14" } }),
    );
    for (const [file, text] of Object.entries(notes)) {
        fs.writeFileSync(path.join(root, "assets", "content", file), text);
    }
    return root;
}

/** A minimal note of any type, with a body unless one is withheld. */
function note(type: string, name: string, shortcode: string, body = `Prose for ${name}.`): string {
    return `---
name:
  full: ${name}
id: ${shortcode.padEnd(16, "0").slice(0, 16)}
shortcode: ${shortcode}
type: ${type}
---

${body}
`;
}

function corpusOf(config: any) {
    return { records: indexRecordsFor({ contentBase: config.paths.content, config }) };
}

/** The findings for one tree under one configuration. */
function findingsFor(notes: Record<string, string>, packs: any[], sources: any = SOHL_SOURCES) {
    const config = baseConfig({ packs, rootDir: repo(notes) });
    return unpackedDocumentFindings(config, sources, corpusOf(config));
}

beforeAll(() => log.setLevel("silent"));
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    log.setLevel("warn");
});

/* ---------------------------------------------------------------------- */
/*  What one note compiles into                                            */
/* ---------------------------------------------------------------------- */

describe("documentsProducedBy — the list #146 never needed", () => {
    it("gives an item note two documents: its Item and the journal holding its prose", () => {
        expect(documentsProducedBy("skill", SOHL_SOURCES)).toEqual([
            { document: "Item", role: "primary" },
            { document: "JournalEntry", role: "documentation" },
        ]);
    });

    it("gives a map note a Scene and a journal, and a macro note a Macro and a journal", () => {
        expect(documentsProducedBy("map", SOHL_SOURCES)).toEqual([
            { document: "Scene", role: "primary" },
            { document: "JournalEntry", role: "documentation" },
        ]);
        expect(documentsProducedBy("macro", SOHL_SOURCES)).toEqual([
            { document: "Macro", role: "primary" },
            { document: "JournalEntry", role: "documentation" },
        ]);
    });

    it("gives a `doc` note one document — its single document *is* the prose", () => {
        expect(documentsProducedBy("doc", SOHL_SOURCES)).toEqual([
            { document: "JournalEntry", role: "primary" },
        ]);
    });

    it("withholds the documentation entry from a note with no prose", () => {
        // The journals pass and the scenes pass apply this rule to the same
        // body: an item with no prose gets no doc, and the items pass leaves
        // its description empty rather than pointing at nothing.
        expect(documentsProducedBy("skill", SOHL_SOURCES, { prose: false })).toEqual([
            { document: "Item", role: "primary" },
        ]);
    });

    it("names the documents the *systems* map, across all of them (#79)", () => {
        const ALPHA = defineDocumentSubtypes({
            system: "alpha",
            types: { relic: { document: "Item", subType: "relic" } },
        });
        const BETA = defineDocumentSubtypes({
            system: "beta",
            types: { relic: { document: "Actor", subType: "relic" } },
        });
        expect(
            documentsProducedBy("relic", {
                maps: [ALPHA, BETA],
                itemTypes: new Set(),
                docEntryTypes: new Set(),
            }),
        ).toEqual([
            { document: "Item", role: "primary" },
            { document: "Actor", role: "primary" },
        ]);
    });
});

/* ---------------------------------------------------------------------- */
/*  `sohl-thalorna`: no Scene pack, no Macro pack                          */
/* ---------------------------------------------------------------------- */

describe("a map note where nothing holds Scenes", () => {
    it("reports the Scene, names the pack that is missing, and says the journal compiled", () => {
        const findings = findingsFor(
            { "Kaldor.md": note("map", "Kaldor", "kaldor") },
            NO_SCENE_OR_MACRO,
        );
        expect(findings).toHaveLength(1);
        const [finding] = findings;
        expect(finding.severity).toBe("error");
        expect(finding.file).toMatch(/Kaldor\.md$/);
        expect(finding.document).toBe("Scene");
        expect(finding.role).toBe("primary");
        // `type: map` is the sixth line of the note above.
        expect(finding.line).toBe(6);
        expect(finding.message).toContain('a note of type "map" compiles into a Scene');
        expect(finding.message).toContain("`packs:` declares no Scene pack");
        expect(finding.message).toContain("It still compiles a JournalEntry holding its prose");
        expect(finding.message).toContain("package-build.config.yaml");
    });

    it("reports the Macro of a macro note the same way", () => {
        const [finding] = findingsFor(
            { "Roll.md": note("macro", "Roll Initiative", "rollinit") },
            NO_SCENE_OR_MACRO,
        );
        expect(finding.document).toBe("Macro");
        expect(finding.message).toContain("`packs:` declares no Macro pack");
    });

    it("still reports a map note with no prose, which then compiles nothing at all", () => {
        // The worse half of the same defect: with no body there is no
        // documentation entry either, so the note leaves no trace — and #146 is
        // still silent, because the JournalEntry pack *claims* `map`.
        const notes = { "Blank.md": note("map", "Blank", "blankmap", "") };
        const findings = findingsFor(notes, NO_SCENE_OR_MACRO);
        expect(findings).toHaveLength(1);
        expect(findings[0].document).toBe("Scene");
        expect(findings[0].message).toContain("Nothing else this note produces compiles either");
    });

    it("says nothing once a Scene pack exists", () => {
        expect(
            findingsFor({ "Kaldor.md": note("map", "Kaldor", "kaldor") }, [
                ...NO_SCENE_OR_MACRO,
                { name: "scenes", type: "Scene" },
            ]),
        ).toHaveLength(0);
    });
});

/* ---------------------------------------------------------------------- */
/*  `sohl-kethira-basic`: no JournalEntry pack                             */
/* ---------------------------------------------------------------------- */

describe("an item note whose prose has nowhere to go", () => {
    it("reports the journal, and names the prose rather than the class alone", () => {
        const findings = findingsFor(
            { "Climbing.md": note("skill", "Climbing", "clmb") },
            NO_JOURNALS,
        );
        expect(findings).toHaveLength(1);
        const [finding] = findings;
        expect(finding.document).toBe("JournalEntry");
        expect(finding.role).toBe("documentation");
        expect(finding.message).toContain("a JournalEntry holding its prose");
        expect(finding.message).toContain("`packs:` declares no JournalEntry pack");
        expect(finding.message).toContain("It still compiles an Item");
        // The remedy for a documentation entry is not the remedy for a primary:
        // a note with an empty body loses nothing.
        expect(finding.message).toContain("stop authoring prose");
    });

    it("stays silent for an item note with no prose, which compiles no journal", () => {
        expect(
            findingsFor({ "Climbing.md": note("skill", "Climbing", "clmb", "") }, NO_JOURNALS),
        ).toHaveLength(0);
    });

    it("says nothing once a JournalEntry pack exists", () => {
        expect(
            findingsFor({ "Climbing.md": note("skill", "Climbing", "clmb") }, [
                ...NO_JOURNALS,
                { name: "journals", type: "JournalEntry" },
            ]),
        ).toHaveLength(0);
    });
});

/* ---------------------------------------------------------------------- */
/*  The three things that can be wrong, told apart                         */
/* ---------------------------------------------------------------------- */

describe("a missing pack, a missing registry entry, and a pass that does not exist", () => {
    it("sends a missing registry entry to `itemBuilders`, not to `packs:`", () => {
        // The Item pack is there; nothing declares a builder for the type, so
        // the items pass compiles nothing and telling the reader to declare a
        // pack would send them to a line that already exists.
        const [finding] = findingsFor(
            { "Climbing.md": note("skill", "Climbing", "clmb") },
            [
                { name: "journals", type: "JournalEntry" },
                { name: "items", type: "Item" },
            ],
            // The shipped SoHL map sends `skill` to an Item; no registry here
            // declares a builder for it, which is the whole of the gap.
            { itemTypes: new Set(), docEntryTypes: new Set(["skill"]) },
        );
        expect(finding.document).toBe("Item");
        expect(finding.message).toContain('no configured Item pack claims "skill"');
        expect(finding.message).toContain("`itemBuilders`");
        expect(finding.message).not.toContain("`packs:` declares no Item pack");
    });

    it("says a document class with no pass is not a configuration matter at all", () => {
        // A system map is free to name any Foundry document. The day one names
        // a `RollTable`, declaring a `RollTable` pack would fail the build for
        // want of a compiler — so the finding must not ask for one.
        const GAMMA = defineDocumentSubtypes({
            system: "gamma",
            types: { omen: { document: "RollTable", subType: "omen" } },
        });
        const [finding] = findingsFor(
            { "Omen.md": note("omen", "An Omen", "omen") },
            [{ name: "journals", type: "JournalEntry" }],
            { maps: [GAMMA], itemTypes: new Set(), docEntryTypes: new Set(["omen"]) },
        );
        expect(finding.document).toBe("RollTable");
        expect(finding.message).toContain("this toolchain compiles no RollTable at all");
        expect(finding.message).toContain("No entry in `packs:` will change that");
        expect(finding.message).not.toContain("Declare one in package-build.config.yaml");
    });
});

/* ---------------------------------------------------------------------- */
/*  #79's silence, and #146's territory                                    */
/* ---------------------------------------------------------------------- */

describe("a type one system maps and another does not", () => {
    const ALPHA = defineDocumentSubtypes({
        system: "alpha",
        types: {
            skill: { document: "Item", subType: "skill" },
            armorlocation: { document: "Item", subType: "armorlocation" },
        },
    });
    const BETA = defineDocumentSubtypes({
        system: "beta",
        types: { skill: { document: "Item", subType: "skill" } },
    });
    const FIXTURE_SYSTEMS = {
        alpha: { compatibility: { verified: "1.0.0" } },
        beta: { compatibility: { verified: "1.0.0" } },
    };

    it("stays silent: `beta` maps no `armorlocation`, so it produces none to lose", () => {
        const config = baseConfig({
            systems: FIXTURE_SYSTEMS,
            rootDir: repo({ "Arm.md": note("armorlocation", "Left Arm", "larm") }),
            packs: [
                { name: "items-alpha", type: "Item", system: "alpha" },
                { name: "items-beta", type: "Item", system: "beta" },
                { name: "journals", type: "JournalEntry" },
            ],
        });
        expect(
            unpackedDocumentFindings(
                config,
                {
                    maps: [ALPHA, BETA],
                    itemTypes: new Set(["skill", "armorlocation"]),
                    docEntryTypes: new Set(["skill", "armorlocation"]),
                },
                corpusOf(config),
            ),
        ).toHaveLength(0);
    });
});

describe("the two checks partition the tree", () => {
    /** A tree holding a note of a type nothing configured claims. */
    const UNCLAIMED = { "Widget.md": note("widget", "A Widget", "widget") };

    it("leaves a note no pack claims to #146, which says strictly more", () => {
        const config = baseConfig({ packs: NO_JOURNALS, rootDir: repo(UNCLAIMED) });
        const sources = { itemTypes: new Set(["skill"]), docEntryTypes: new Set(["skill"]) };
        expect(unclaimedNoteFindings(config, sources, corpusOf(config))).toHaveLength(1);
        expect(unpackedDocumentFindings(config, sources, corpusOf(config))).toHaveLength(0);
    });

    it("reports nothing at all for a configuration with a pack for every document", () => {
        const config = baseConfig({
            rootDir: repo({
                "Climbing.md": note("skill", "Climbing", "clmb"),
                "Kaldor.md": note("map", "Kaldor", "kaldor"),
                "Roll.md": note("macro", "Roll Initiative", "rollinit"),
                "Gear.md": note("doc", "About Gear", "gear"),
            }),
            packs: [
                { name: "items", type: "Item" },
                { name: "journals", type: "JournalEntry" },
                { name: "macros", type: "Macro" },
                { name: "scenes", type: "Scene" },
            ],
        });
        expect(unpackedDocumentFindings(config, SOHL_SOURCES, corpusOf(config))).toHaveLength(0);
        expect(unclaimedNoteFindings(config, SOHL_SOURCES, corpusOf(config))).toHaveLength(0);
    });
});

/* ---------------------------------------------------------------------- */
/*  Through the generator                                                  */
/* ---------------------------------------------------------------------- */

describe("generatePacksJson — a note that would compile half of itself", () => {
    let errors: number;
    const messages: string[] = [];

    beforeAll(async () => {
        const root = repo({
            "Kaldor.md": note("map", "Kaldor", "kaldor"),
            "Roll.md": note("macro", "Roll Initiative", "rollinit"),
        });
        const original = console.error;
        console.error = (...args: unknown[]) => messages.push(args.join(" "));
        try {
            errors = await generatePacksJson({
                config: baseConfig({
                    rootDir: root,
                    packs: [{ name: "journals", type: "JournalEntry" }],
                }),
            });
        } finally {
            console.error = original;
        }
    });

    it("fails the build rather than shipping a map with no Scene", () => {
        expect(errors).toBeGreaterThanOrEqual(2);
    });

    it("reports each lost document once, in compiler-parseable form", () => {
        const reported = messages.filter((m) => m.includes("has nowhere to put it"));
        expect(reported).toHaveLength(2);
        for (const line of reported) {
            expect(line).toMatch(/^[^\s]+\.md:\d+:\d+: error: /);
        }
        expect(reported.some((m) => m.includes("no Scene pack"))).toBe(true);
        expect(reported.some((m) => m.includes("no Macro pack"))).toBe(true);
    });
});

/* ---------------------------------------------------------------------- */
/*  The drift guard                                                        */
/* ---------------------------------------------------------------------- */

describe("COMPILED_DOCUMENT_CLASSES and the compiler table agree", () => {
    it("names exactly the document types a pass exists for", () => {
        for (const document of COMPILED_DOCUMENT_CLASSES) {
            expect(compilerFor(document), document).toBeTypeOf("function");
        }
        // Foundry documents an Adventure may hold and no pass compiles. A
        // `Folder` is the third: it reaches a pack by a route of its own and no
        // compiler class writes it.
        for (const document of ["Cards", "RollTable", "Folder"]) {
            expect(COMPILED_DOCUMENT_CLASSES.has(document), document).toBe(false);
            expect(compilerFor(document), document).toBeUndefined();
        }
    });

    it("is the set the claim table can answer for, and the only one", () => {
        for (const document of ["Cards", "RollTable", "Folder", "Playlist"]) {
            expect(noteTypesClaimedBy(document).size, document).toBe(0);
        }
    });
});
