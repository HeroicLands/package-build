/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A note whose `type:` no configured pack claims (#146).
 *
 * `harn-ensemble` declares no `itemBuilders`, so its five `affiliation` notes
 * were a type no compiler selected: the journals pass rejected them, the Actor
 * passes rejected them, and no Item pack existed to claim them. They compiled
 * into nothing and said nothing — no error, no warning, no census line — while
 * its 2,512 `being` notes each produced a routing error, which is the correct
 * behaviour. The two cases differ only in whether some pass got far enough to
 * complain.
 *
 * Three properties are held here:
 *
 * - a note no pack claims is a **finding**, naming the note and the type;
 * - the finding distinguishes a **configuration** gap (the type is a content
 *   type this build knows, and nothing is configured to compile it) from an
 *   **authoring** one (the type is not in the vocabulary at all);
 * - a type deliberately unmapped for one system but claimed for another stays
 *   **silent**, which is #79's stated rule and must not start reporting.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "loglevel";

import { defineConfig } from "../content-config.mjs";
import { defineDocumentSubtypes } from "../engine/document-subtypes.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { packForType } from "../engine/ids.mjs";
import { hasDocEntry } from "../engine/item-docs.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import {
    NEVER_PACKED_TYPES,
    claimedNoteTypes,
    noteTypeVocabulary,
    noteTypesClaimedBy,
    unclaimedNoteFindings,
} from "../engine/note-claims.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Journals } from "../engine/journals.mjs";
import { Macros } from "../engine/macros.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                               */
/* ---------------------------------------------------------------------- */

/** A `harn-ensemble`-shaped pack list: two Actor packs and nothing else. */
const ACTORS_ONLY = [
    { name: "actors-hm3", type: "Actor", system: "hm3" },
    { name: "actors-sohl", type: "Actor", system: "sohl" },
];

/** A complete configuration with the given packs, rooted anywhere. */
function baseConfig({ packs, rootDir = os.tmpdir() }: any) {
    return defineConfig({
        compatibility: { minimum: "14.359", verified: "14.359" },
        rootDir,
        contentPackage: contentPackage(),
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: { lastModifiedBy: "sohltestbuild0000" },
        packs,
    } as any);
}

/** A throwaway repository root holding the given notes. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-unclaimed-"));
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

/** A minimal note of any type. */
function note(type: string, name: string, shortcode: string): string {
    return `---
name:
  full: ${name}
id: ${shortcode.padEnd(16, "0").slice(0, 16)}
shortcode: ${shortcode}
type: ${type}
---

Prose for ${name}.
`;
}

const roots: string[] = [];
beforeAll(() => log.setLevel("silent"));
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    log.setLevel("warn");
});

/* ---------------------------------------------------------------------- */
/*  Which types a configuration claims                                     */
/* ---------------------------------------------------------------------- */

describe("claimedNoteTypes — what some configured pack would compile", () => {
    it("claims the Actor types, and nothing else, for an Actor-only pack list", () => {
        const claimed = claimedNoteTypes(baseConfig({ packs: ACTORS_ONLY }), {
            itemTypes: new Set(),
            docEntryTypes: new Set(),
        });
        expect(claimed.has("being")).toBe(true);
        expect(claimed.has("affiliation")).toBe(false);
        expect(claimed.has("doc")).toBe(false);
    });

    it("claims a declared item type once an Item pack exists", () => {
        const config = baseConfig({
            packs: [...ACTORS_ONLY, { name: "items", type: "Item" }],
        });
        expect(
            claimedNoteTypes(config, {
                itemTypes: new Set(["affiliation"]),
                docEntryTypes: new Set(),
            }).has("affiliation"),
        ).toBe(true);
    });

    it("claims nothing for a document type this toolchain has no compiler for", () => {
        // `harn-adventures` ships a prebuilt `Adventure` pack; no note compiles
        // into one, and the pack list saying so must not claim any type.
        expect(noteTypesClaimedBy("Adventure").size).toBe(0);
    });
});

describe("noteTypeVocabulary — what this build knows a note type to be", () => {
    it("holds a type a system maps even where no registry declares it", () => {
        // The hinge of the whole distinction. `harn-ensemble` declares no
        // `itemBuilders`, so `affiliation` is in no registry — and it is still
        // a content type this build knows, which makes its absence a
        // configuration gap rather than a typo.
        expect(noteTypeVocabulary({ itemTypes: new Set() }).has("affiliation")).toBe(true);
    });

    it("holds the engine's own types and a consumer's registered ones", () => {
        const vocabulary = noteTypeVocabulary({ itemTypes: new Set(["relic"]) });
        for (const type of ["doc", "macro", "map", "homepage"]) {
            expect(vocabulary.has(type), type).toBe(true);
        }
        expect(vocabulary.has("relic")).toBe(true);
    });

    it("does not hold an invented type", () => {
        expect(noteTypeVocabulary().has("widget")).toBe(false);
    });
});

/* ---------------------------------------------------------------------- */
/*  #79's silence: unmapped for one system, claimed for another            */
/* ---------------------------------------------------------------------- */

describe("a type one system maps and another does not", () => {
    /** Two fixture systems that cut the vocabulary differently. */
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

    const maps = [ALPHA, BETA];
    const config = baseConfig({
        packs: [
            { name: "items-alpha", type: "Item", system: "alpha" },
            { name: "items-beta", type: "Item", system: "beta" },
        ],
    });

    it("stays silent: some pack claims it, so it is not unclaimed", () => {
        const claimed = claimedNoteTypes(config, {
            maps,
            itemTypes: new Set(["skill", "armorlocation"]),
            docEntryTypes: new Set(),
        });
        expect(claimed.has("armorlocation")).toBe(true);
    });

    it("is in the vocabulary because one system maps it", () => {
        expect(noteTypeVocabulary({ maps, itemTypes: new Set() }).has("armorlocation")).toBe(true);
    });

    it("reports it only when no pack of either system claims it", () => {
        const noItemPacks = baseConfig({ packs: [{ name: "actors", type: "Actor" }] });
        const claimed = claimedNoteTypes(noItemPacks, {
            maps,
            itemTypes: new Set(["skill", "armorlocation"]),
            docEntryTypes: new Set(),
        });
        expect(claimed.has("armorlocation")).toBe(false);
    });
});

/* ---------------------------------------------------------------------- */
/*  The findings themselves                                               */
/* ---------------------------------------------------------------------- */

describe("unclaimedNoteFindings", () => {
    it("names the note, its type, and the line the `type:` key is on", () => {
        const root = repo({ "Guild.md": note("affiliation", "Guild of Arms", "guildarms") });
        roots.push(root);
        const findings = unclaimedNoteFindings(baseConfig({ packs: ACTORS_ONLY, rootDir: root }), {
            itemTypes: new Set(),
            docEntryTypes: new Set(),
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].file).toMatch(/Guild\.md$/);
        expect(findings[0].message).toContain('"affiliation"');
        // `type: affiliation` is the sixth line of the note above.
        expect(findings[0].line).toBe(6);
    });

    it("never reports a type that compiles to a page rather than a document", () => {
        const root = repo({ "homepage.md": "---\ntype: homepage\n---\n\nHello.\n" });
        roots.push(root);
        expect(NEVER_PACKED_TYPES.has("homepage")).toBe(true);
        expect(
            unclaimedNoteFindings(baseConfig({ packs: ACTORS_ONLY, rootDir: root }), {
                itemTypes: new Set(),
                docEntryTypes: new Set(),
            }),
        ).toHaveLength(0);
    });

    it("says a known type is a configuration gap, and names the document it would be", () => {
        const root = repo({ "Guild.md": note("affiliation", "Guild of Arms", "guildarms") });
        roots.push(root);
        const [finding] = unclaimedNoteFindings(baseConfig({ packs: ACTORS_ONLY, rootDir: root }), {
            itemTypes: new Set(),
            docEntryTypes: new Set(),
        });
        expect(finding.message).toMatch(/Item/);
        expect(finding.message).toMatch(/sohl/);
        expect(finding.message).toMatch(/package-build\.config\.yaml/);
        // The authoring wording must not appear on a configuration finding.
        expect(finding.message).not.toMatch(/not a content type/);
    });

    it("says an unknown type is an authoring mistake, not a configuration one", () => {
        const root = repo({ "Widget.md": note("widget", "A Widget", "widget") });
        roots.push(root);
        const [finding] = unclaimedNoteFindings(baseConfig({ packs: ACTORS_ONLY, rootDir: root }), {
            itemTypes: new Set(),
            docEntryTypes: new Set(),
        });
        expect(finding.message).toMatch(/not a content type/);
        expect(finding.message).toMatch(/widget/);
    });
});

/* ---------------------------------------------------------------------- */
/*  Through the generator                                                  */
/* ---------------------------------------------------------------------- */

describe("generatePacksJson — a declared, valid note type with no pack behind it", () => {
    let root: string;
    let errors: number;
    const messages: string[] = [];

    beforeAll(async () => {
        root = repo({
            "Guild.md": note("affiliation", "Guild of Arms", "guildarms"),
            "Order.md": note("affiliation", "Order of Peers", "orderpeers"),
            "Widget.md": note("widget", "A Widget", "widget"),
            "homepage.md": "---\ntype: homepage\n---\n\nHello.\n",
        });
        roots.push(root);
        const original = console.error;
        console.error = (...args: unknown[]) => messages.push(args.join(" "));
        try {
            errors = await generatePacksJson({
                config: baseConfig({
                    rootDir: root,
                    packs: [{ name: "actors", type: "Actor", mayBeEmpty: true }],
                }),
            });
        } finally {
            console.error = original;
        }
    });

    it("fails the build rather than dropping the notes in silence", () => {
        expect(errors).toBe(3);
    });

    it("reports each unclaimed note once, in compiler-parseable form", () => {
        const reported = messages.filter((m) => m.includes("no configured pack"));
        expect(reported).toHaveLength(3);
        for (const line of reported) {
            expect(line).toMatch(/^[^\s]+\.md:\d+:\d+: error: /);
        }
    });

    it("says nothing about the homepage, which compiles to a page by design", () => {
        expect(messages.filter((m) => m.includes("homepage.md"))).toHaveLength(0);
    });
});

/* ---------------------------------------------------------------------- */
/*  The drift guard                                                        */
/* ---------------------------------------------------------------------- */

describe("the claim table and the compilers agree", () => {
    /** A content tree holding nothing — the walk is not what is under test. */
    function emptyTree(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claims-"));
        roots.push(dir);
        return dir;
    }

    /** One compiler of each document type a pack may declare. */
    const COMPILERS: Record<string, any> = {
        Item: Items,
        Actor: Actors,
        JournalEntry: Journals,
        Macro: Macros,
        Scene: Scenes,
    };

    it("claims exactly what each pass's `selects` claims, for every known type", () => {
        const vocabulary = [...noteTypeVocabulary()];
        for (const [docType, Cls] of Object.entries(COMPILERS)) {
            const contentBase = emptyTree();
            const pass = new Cls({
                contentBase,
                dest: path.join(contentBase, "out"),
                // The scenes pass also writes the adventures that bundle its
                // maps, so it insists on that destination at construction.
                companionDests: { adventures: path.join(contentBase, "adventures") },
            });
            const claims = noteTypesClaimedBy(docType);
            for (const type of vocabulary) {
                expect(claims.has(type), `${docType} × ${type}`).toBe(!!pass.selects({ type }));
            }
        }
    });

    it("reads the system maps this toolchain ships", () => {
        // One today. #139 adds `hm3/`, and its map joins the list rather than
        // this table growing a second copy of the same fact.
        expect(noteTypesClaimedBy("Actor").has("being")).toBe(true);
        expect(Object.keys(SOHL_DOCUMENT_SUBTYPES.types)).toContain("affiliation");
    });
});

describe("a type whose whole document is a journal (#241)", () => {
    it("routes place, lore and scenario to the journals pack", () => {
        for (const type of ["place", "lore", "scenario"]) {
            expect(packForType(type), type).toEqual({
                pack: "journals",
                docType: "JournalEntry",
            });
        }
    });

    it("claims them for the JournalEntry pass", () => {
        const claims = noteTypesClaimedBy("JournalEntry");
        for (const type of ["doc", "place", "lore", "scenario"]) {
            expect(claims.has(type), type).toBe(true);
        }
    });

    it("gives them no synthesized documentation entry", () => {
        // Their whole document *is* the journal, so there is no second
        // document to address and nothing spells `docplace`. That is what
        // separates them from an item, whose prose becomes a journal beside it.
        for (const type of ["place", "lore", "scenario"]) {
            expect(hasDocEntry(type), type).toBe(false);
        }
    });

    it("does not route them to the items pack by the open-set default", () => {
        // The regression this fixes: an unnamed type fell through to items, so
        // 450 notes across `sohl-thalorna` compiled into nothing while every
        // gate reported success.
        for (const type of ["place", "lore", "scenario"]) {
            expect(packForType(type).docType, type).not.toBe("Item");
        }
    });
});
