/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A note whose **secondary** document has no pack loses it silently, while its
 * primary document compiles (#152).
 *
 * #146 asks one question of the whole configuration — does any pack claim this
 * type — and a note that compiles an Item into an Item pack answers yes, so the
 * JournalEntry its prose was going to become could go missing without anything
 * noticing. The build succeeds, the compendium ships, and the absence is
 * discoverable only by going to look for it.
 *
 * The two configurations the issue names are the two scenarios here: a map note
 * where no `Scene` pack is declared, and an item note with prose where no
 * `JournalEntry` pack is. `harn-ensemble` has since become a third, and a live
 * one — 2,517 notes, every one of them losing its documentation.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../content-config.mjs";
import { documentClassesFor, unclaimedNoteFindings } from "../engine/note-claims.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { defineDocumentSubtypes } from "../engine/document-subtypes.mjs";

/** A throwaway repository root holding the given notes. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-secondary-"));
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

function configFor(rootDir: string, packs: any[]) {
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

/** A note of a type, with whatever prose is passed (empty for none). */
function note(type: string, shortcode: string, prose = ""): string {
    return `---
name:
  full: ${shortcode}
id: ${shortcode.padEnd(16, "0").slice(0, 16)}
shortcode: ${shortcode}
type: ${type}
---
${prose}`;
}

function findingsFor(notes: Record<string, string>, packs: any[]) {
    const config = configFor(repo(notes), packs);
    const records = indexRecordsFor({ contentBase: config.paths.content, config });
    return unclaimedNoteFindings(config, undefined, { records });
}

const messages = (findings: { message: string }[]) => findings.map((f) => f.message);

describe("an item note with prose, and no JournalEntry pack", () => {
    // `sohl-kethira-basic`'s shape: Item packs and an Actor pack, no journals.
    const ITEMS_ONLY = [
        { name: "characteristics", type: "Item", default: true },
        { name: "characters", type: "Actor" },
    ];

    it("reports the lost JournalEntry, naming it and what did compile", () => {
        const findings = findingsFor(
            { "Skill.md": note("skill", "awar", "A skill, described at length.") },
            ITEMS_ONLY,
        );
        expect(findings).toHaveLength(1);
        // `an Item`, not `a Item` — the article is chosen, not concatenated.
        expect(findings[0].message).toMatch(/compiles into a JournalEntry as well as an Item/);
        expect(findings[0].message).toMatch(/declares no JournalEntry pack/);
        expect(findings[0].message).toMatch(/dropped with no error/);
        expect(findings[0].message).toMatch(/Declare a JournalEntry pack/);
        // The note, by file, and the `type:` key that decides its documents.
        expect(findings[0].file).toMatch(/Skill\.md$/);
        expect(findings[0].type).toBe("skill");
    });

    it("stays silent where the note carries no prose", () => {
        // The decisive case, and the reason this is asked per note. `Journals`
        // declines a doc-carrying note with an empty body — "an item with no
        // prose gets no doc" — so nothing is lost and there is nothing to say.
        // `sohl-kethira-basic` ships 393 such notes, deliberately empty under
        // the Fan Material Guidelines, and a type-level answer would report
        // every one of them.
        expect(findingsFor({ "Skill.md": note("skill", "awar") }, ITEMS_ONLY)).toEqual([]);
    });
});

describe("a map note with no Scene pack", () => {
    // `sohl-thalorna`'s shape: it declares neither a Scene nor a Macro pack.
    const NO_SCENES = [
        { name: "items", type: "Item", default: true },
        { name: "journals", type: "JournalEntry" },
    ];

    it("reports the lost Scene", () => {
        const findings = findingsFor(
            { "Map.md": note("map", "tashal", "The city, described.") },
            NO_SCENES,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/compiles into a Scene as well as a JournalEntry/);
        expect(findings[0].message).toMatch(/declares no Scene pack/);
    });

    it("reports a macro's lost Macro document the same way", () => {
        const findings = findingsFor(
            { "Macro.md": note("macro", "roll", "What the macro does.") },
            NO_SCENES,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/compiles into a Macro as well as a JournalEntry/);
    });
});

describe("what it must not say", () => {
    const EVERY_PACK = [
        { name: "items", type: "Item", default: true },
        { name: "journals", type: "JournalEntry" },
        { name: "actors", type: "Actor" },
        { name: "macros", type: "Macro" },
        { name: "scenes", type: "Scene" },
    ];

    it("stays silent when every document a note produces has a pack", () => {
        expect(
            findingsFor({ "Skill.md": note("skill", "awar", "Described.") }, EVERY_PACK),
        ).toEqual([]);
    });

    it("leaves a note nothing claims to #146's finding, not this one", () => {
        // The distinction the message has to carry: one is a pack to declare,
        // the other is a type nothing compiles. A `bundle` note with no
        // Adventure pack and no JournalEntry row produces nothing at all here.
        const findings = findingsFor({ "Bundle.md": note("bundle", "kit", "Prose.") }, [
            { name: "items", type: "Item", default: true },
        ]);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/no configured pack claims a note of type "bundle"/);
        expect(messages(findings)[0]).not.toMatch(/as well as/);
    });
});

describe("documentClassesFor", () => {
    it("answers the type's potential when no note is named", () => {
        // What a caller asking about a *type* wants: every document such a note
        // could produce, prose or not.
        expect(documentClassesFor("skill")).toEqual(["Item", "JournalEntry"]);
        expect(documentClassesFor("map")).toEqual(["JournalEntry", "Scene"]);
        expect(documentClassesFor("macro")).toEqual(["JournalEntry", "Macro"]);
    });

    it("drops the JournalEntry for a doc-carrying note with no prose", () => {
        expect(documentClassesFor("skill", undefined, { hasProse: false })).toEqual(["Item"]);
    });

    it("keeps it for a type whose whole document is the journal", () => {
        // A `doc` note's body *is* the document, so there is no body condition
        // to apply — an empty one is a different complaint, made elsewhere.
        expect(documentClassesFor("doc", undefined, { hasProse: false })).toEqual(["JournalEntry"]);
    });

    it("names nothing for a type nothing compiles", () => {
        expect(documentClassesFor("widget")).toEqual([]);
    });

    it("says nothing per system, so #79's silence is kept by construction", () => {
        // A type one system maps and another does not must not be reported
        // against the system that declines it. There is nowhere for such a
        // report to come from here: the `Item` and `Actor` rows fold the maps
        // together before this sees them, so a type appears once or not at all
        // and no system is ever named.
        const ALPHA = defineDocumentSubtypes({
            system: "alpha",
            types: { relic: { document: "Item", subType: "relic" } },
        });
        const BETA = defineDocumentSubtypes({
            system: "beta",
            types: { being: { document: "Actor", subType: "being" } },
        });
        const sources = {
            maps: [ALPHA, BETA],
            itemTypes: new Set(["relic"]),
            docEntryTypes: new Set(["relic"]),
        };
        // Once, as an Item — not twice, and not as "no Actor for alpha".
        expect(documentClassesFor("relic", sources)).toEqual(["Item", "JournalEntry"]);
        // And the type only beta maps is an Actor, with no Item said about it.
        expect(documentClassesFor("being", sources)).toEqual(["Actor"]);
    });
});
