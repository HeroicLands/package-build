/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A note whose `type:` no configured pack claims.
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
    DERIVED_PACKED_TYPES,
    KNOWN_DOCUMENT_SUBTYPE_MAPS,
    UNIMPLEMENTED_TYPES,
    NEVER_PACKED_TYPES,
    claimedNoteTypes,
    noteTypeVocabulary,
    noteTypesClaimedBy,
    unclaimedNoteFindings,
} from "../engine/note-claims.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
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
function baseConfig({ packs, rootDir = os.tmpdir(), systems }: any) {
    // A pack's `system:` must resolve to the version its documents are stamped
    // with, so a complete configuration declares every system its packs name.
    // Derived here rather than written at each call site, which is what keeps
    // these fixtures about the note types they are testing.
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
        // `Cards` and `RollTable` are Foundry documents an Adventure can hold
        // and no note compiles into; a pack list naming one must claim nothing.
        expect(noteTypesClaimedBy("Cards").size).toBe(0);
        expect(noteTypesClaimedBy("RollTable").size).toBe(0);
    });

    it("claims a bundle for an Adventure pack", () => {
        expect([...noteTypesClaimedBy("Adventure")]).toEqual(["bundle"]);
        const config = baseConfig({ packs: [{ name: "bundles", type: "Adventure" }] });
        expect(
            claimedNoteTypes(config, { itemTypes: new Set(), docEntryTypes: new Set() }).has(
                "bundle",
            ),
        ).toBe(true);
    });

    it("claims nothing for a prebuilt pack, whose JSON no pass writes", () => {
        // `harn-adventures` ships a prebuilt `Adventure` pack: its per-document
        // JSON is checked in rather than compiled, so it has no pass and no
        // note is routed into it — `content-config.mjs` says as much by
        // refusing `default: true` beside `prebuilt`. Before #259 the row could
        // not be wrong, because no compiler was registered for the document
        // type at all; now one is, so the exemption has to be stated.
        const config = baseConfig({
            packs: [{ name: "adventures", type: "Adventure", prebuilt: "packs/adventures" }],
        });
        expect(
            claimedNoteTypes(config, { itemTypes: new Set(), docEntryTypes: new Set() }).has(
                "bundle",
            ),
        ).toBe(false);
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
    // Declared, because a pack's `system:` must resolve to the version its
    // documents are stamped with — neither fixture system is this package's own.
    const FIXTURE_SYSTEMS = {
        alpha: { compatibility: { verified: "1.0.0" } },
        beta: { compatibility: { verified: "1.0.0" } },
    };
    const config = baseConfig({
        systems: FIXTURE_SYSTEMS,
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

/**
 * The corpus for a fixture repository.
 *
 * `unclaimedNoteFindings` reads the records the compile derived rather than
 * walking — it is imported *by* the content index and so cannot derive
 * one itself — and its production caller already holds them.
 */
function unclaimedNoteFindingsFor(config: any, sources: any) {
    return unclaimedNoteFindings(config, sources, corpusOf(config));
}

function corpusOf(config: any) {
    return { records: indexRecordsFor({ contentBase: config.paths.content, config }) };
}

describe("unclaimedNoteFindings", () => {
    it("names the note, its type, and the line the `type:` key is on", () => {
        const root = repo({ "Guild.md": note("affiliation", "Guild of Arms", "guildarms") });
        roots.push(root);
        const config = baseConfig({ packs: ACTORS_ONLY, rootDir: root });
        const findings = unclaimedNoteFindings(
            config,
            { itemTypes: new Set(), docEntryTypes: new Set() },
            corpusOf(config),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].file).toMatch(/Guild\.md$/);
        expect(findings[0].message).toContain('"affiliation"');
        // `type: affiliation` is the sixth line of the note above.
        expect(findings[0].line).toBe(6);
    });

    it.each(["vehicle"])(
        "says a specified-but-unimplemented %s is this toolchain's gap, not the note's",
        (type) => {
            // `vehicle` is documented in `docs/content-format.md` and declared
            // in the vocabulary, and nothing here compiles it: no shipped
            // system map names it and — with the registries this fixture
            // supplies — no `itemBuilders` entry declares it either. The
            // message is chosen from the vocabulary rather than from a list of
            // types, which is the property this parameterisation asserts: it
            // covered `bundle` with no edit until #259 implemented the type,
            // and moving off it cost one word here.
            const root = repo({
                "Note.md":
                    `---\ntype: ${type}\nid: probeid000000001\nshortcode: probe\n` +
                    "name:\n  full: Probe\n---\n\nBody.\n",
            });
            roots.push(root);
            const config = baseConfig({ packs: ACTORS_ONLY, rootDir: root });
            const [finding] = unclaimedNoteFindings(
                config,
                { itemTypes: new Set(), docEntryTypes: new Set() },
                corpusOf(config),
            );

            expect(finding.message).toMatch(new RegExp(`content format specifies "${type}"`));
            expect(finding.message).toMatch(/not implemented the type yet/);
            // Neither of the other two wordings may appear.
            expect(finding.message).not.toMatch(/not a content type/);
            expect(finding.message).not.toMatch(/declare (one|both) in/);
        },
    );

    it("never reports a type that compiles to a page rather than a document", () => {
        const root = repo({ "homepage.md": "---\ntype: homepage\n---\n\nHello.\n" });
        roots.push(root);
        expect(NEVER_PACKED_TYPES.has("homepage")).toBe(true);
        expect(
            unclaimedNoteFindingsFor(baseConfig({ packs: ACTORS_ONLY, rootDir: root }), {
                itemTypes: new Set(),
                docEntryTypes: new Set(),
            }),
        ).toHaveLength(0);
    });

    it("says a known type is a configuration gap, and names the document it would be", () => {
        const root = repo({ "Guild.md": note("affiliation", "Guild of Arms", "guildarms") });
        roots.push(root);
        const [finding] = unclaimedNoteFindingsFor(
            baseConfig({ packs: ACTORS_ONLY, rootDir: root }),
            {
                itemTypes: new Set(),
                docEntryTypes: new Set(),
            },
        );
        expect(finding.message).toMatch(/Item/);
        expect(finding.message).toMatch(/sohl/);
        expect(finding.message).toMatch(/package-build\.config\.yaml/);
        // The authoring wording must not appear on a configuration finding.
        expect(finding.message).not.toMatch(/not a content type/);
    });

    it("says an unknown type is an authoring mistake, not a configuration one", () => {
        const root = repo({ "Widget.md": note("widget", "A Widget", "widget") });
        roots.push(root);
        const [finding] = unclaimedNoteFindingsFor(
            baseConfig({ packs: ACTORS_ONLY, rootDir: root }),
            {
                itemTypes: new Set(),
                docEntryTypes: new Set(),
            },
        );
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
                skipDirectories: [],
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

/*
 * #241's closing note: "worth checking `vehicle` and `armorlocation` at the
 * same time — #233 declared those two as well, and neither has been exercised
 * by a tree that authors one." Checked, and neither is a second instance of
 * that issue. They are not even the same case as each other.
 *
 * `armorlocation` is **HM3's**: the specification says "HM3 only", it has no
 * SoHL form, and `hm3/document-subtypes.mjs` maps it. A SoHL configuration
 * claiming it would be wrong, so its absence from this map is the answer rather
 * than a gap — which is what the rows below pin, since nothing else did.
 *
 * `vehicle` is **specified but not yet implemented**, and says so: a note of
 * that type is reported as "the content format specifies `vehicle`, so the note
 * is not wrong — this toolchain has not implemented the type yet … do not
 * author the type until a release compiles it". That is the opposite of #241,
 * where the failure was silent and misattributed. It is asserted by the
 * `it.each` case above, which is deliberately parameterised so that a type
 * moves off it when implemented — as `bundle` did in #259.
 */
describe("the two types #241 left to check", () => {
    it("leaves armorlocation to HM3, which maps it", () => {
        expect(Object.keys(SOHL_DOCUMENT_SUBTYPES.types)).not.toContain("armorlocation");
        expect(noteTypesClaimedBy("Item").has("armorlocation")).toBe(false);
    });

    it("claims neither for a SoHL pass, which is why each is reported rather than compiled", () => {
        for (const docType of ["Actor", "Item", "JournalEntry"]) {
            expect(noteTypesClaimedBy(docType).has("vehicle"), docType).toBe(false);
            expect(noteTypesClaimedBy(docType).has("armorlocation"), docType).toBe(false);
        }
    });
});

describe("a type whose whole document is a journal", () => {
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

/**
 * Every declared type has a route, or a stated reason for having none.
 *
 * This is the check #241 needed and nobody had. `place`, `lore` and `scenario`
 * were declared, validated, and claimed by no pass — and the only thing that
 * noticed was a downstream repository failing to compile 450 notes, because
 * `sohl` authors none of the three. Every gate here reported success.
 *
 * The claim table is already cross-checked against each pass's `selects`, but
 * that agreement holds just as well when **both** say nobody claims a type,
 * which was exactly the broken state. So the missing property is not agreement;
 * it is *coverage*, and it is asked statically, of the toolchain rather than of
 * a tree, so it does not depend on some repository happening to author the type.
 *
 * A declared type must be one of four things, and the four are not
 * interchangeable — each names a different reason, and a type that is none of
 * them is the #241 trap:
 *
 * 1. **claimed by a pass** — the ordinary case;
 * 2. **never packed** — it compiles to no document at all (`homepage`);
 * 3. **derived packed** — it materialises by reference in every pack that
 *    references it, so no one pass owns it (`folder`);
 * 4. **another system's** — a shipped system map declares it, so a
 *    configuration that ships that system's packs claims it (`armorlocation`,
 *    which is HM3's); or **named in `UNIMPLEMENTED_TYPES`**, the set that states
 *    which specified types this toolchain does not compile yet (`vehicle`).
 */
describe("every declared note type is routed, or excused for a stated reason", () => {
    /** Why a type needs no pass of its own, or `null` when it needs one. */
    function excuse(type: string): string | null {
        if (NEVER_PACKED_TYPES.has(type)) return "never packed";
        if (DERIVED_PACKED_TYPES.has(type)) return "derived packed";
        // Declared by a system this toolchain ships: a configuration carrying
        // that system's packs claims it, so being unclaimed *here* is a fact
        // about this configuration rather than a missing route.
        if (KNOWN_DOCUMENT_SUBTYPE_MAPS.some((map) => Object.hasOwn(map.types, type))) {
            return "another system's map";
        }
        // Stated, never inferred. "Declared but absent from the configured
        // vocabulary" reads correctly and is worthless: that vocabulary is
        // derived from the routing, so taking a type's route away removes it
        // from the vocabulary too and the inference excuses exactly the mistake
        // this guard exists to catch. See `UNIMPLEMENTED_TYPES`.
        if (UNIMPLEMENTED_TYPES.has(type)) return "specified, not implemented";
        return null;
    }

    const claimedAnywhere = () =>
        new Set(
            ["Item", "Actor", "JournalEntry", "Macro", "Scene", "Adventure"].flatMap((docType) => [
                ...noteTypesClaimedBy(docType),
            ]),
        );

    it("leaves no declared type both unclaimed and unexplained", () => {
        const claimed = claimedAnywhere();
        const stranded = Object.keys(NOTE_VOCABULARY)
            .filter((type) => type !== "state")
            .filter((type) => !claimed.has(type) && !excuse(type));

        // Named rather than counted: the whole failure this guards against is
        // one nobody could see, so the message has to say which type.
        expect(stranded).toEqual([]);
    });

    /*
     * The teeth. A guard that cannot fail is not a guard, and this one is only
     * worth its lines if it would have caught.
     *
     * `place` is the witness, because it is the type that was broken: it is in
     * the configured vocabulary, no system map declares it (a journal type has
     * no system row), and it is neither never-packed nor derived-packed. So
     * **nothing excuses it** — the only thing keeping it out of the stranded
     * list is that a pass claims it. Take the route away, as #241 found it, and
     * the assertion above names it.
     */
    it("would have caught #241: only the route keeps `place` off the list", () => {
        expect(excuse("place")).toBeNull();
        expect(claimedAnywhere().has("place")).toBe(true);

        // The same holds for the other two the issue reported, so the guard
        // covers the whole of what went wrong rather than one example of it.
        for (const type of ["lore", "scenario"]) {
            expect(excuse(type), type).toBeNull();
            expect(claimedAnywhere().has(type), type).toBe(true);
        }
    });

    /*
     * And the four excuses are each actually load-bearing for something, so a
     * reader can see which case a type is in rather than inferring it.
     */
    it("records which reason answers for each unclaimed type", () => {
        const claimed = claimedAnywhere();
        const unclaimed = Object.keys(NOTE_VOCABULARY)
            .filter((type) => type !== "state" && !claimed.has(type))
            .sort();

        expect(Object.fromEntries(unclaimed.map((t) => [t, excuse(t)]))).toEqual({
            armorlocation: "another system's map",
            folder: "derived packed",
            homepage: "never packed",
            vehicle: "specified, not implemented",
        });
    });
});
