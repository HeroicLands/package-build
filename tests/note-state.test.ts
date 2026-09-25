/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The three states of a note, and the one observable fact they are derived
 * from.
 *
 * A note whose body is empty is a **stub**: it carries its frontmatter into the
 * index and is queryable there, and it has no page, no address and no link
 * target. A note with a body and the `draft` tag is a **draft**. A note with a
 * body and no tag is **full**.
 *
 * The ladder is inferred and stored nowhere, so the assertions here are about
 * what the index withholds and what the `entries` view derives — never about a
 * field a note could author.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { buildJournalEntry, Journals } from "../engine/journals.mjs";
import { buildIndexRecord, collectContentIndex } from "../engine/content-index.mjs";
import { isStub } from "../engine/index-records.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { isEmptyBody, isStubbableType, isStubNote } from "../engine/note-state.mjs";
import { openNotesDatabase, renderSqlTable, runSqlQuery } from "../engine/sql-tables.mjs";
import { lintNoteStates } from "../engine/stub-lint.mjs";
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import { Items } from "../sohl/items.mjs";

/* ---------------------------------------------------------------------- */
/*  The classification, derived from the registry's own key list           */
/* ---------------------------------------------------------------------- */

describe("every note type answers whether an empty body makes it a stub", () => {
    // Derived at runtime from the registry rather than copied, so a type added
    // to `NOTE_VOCABULARY` without a `stubbable` declaration fails here rather
    // than being classified by a default nobody chose.
    it.each(Object.keys(NOTE_VOCABULARY))("%s declares `stubbable`", (type) => {
        expect(typeof NOTE_VOCABULARY[type].stubbable).toBe("boolean");
    });

    it("exempts the structural types, and only those", () => {
        const exempt = Object.keys(NOTE_VOCABULARY).filter((t) => !NOTE_VOCABULARY[t].stubbable);
        expect(exempt.sort()).toEqual(["folder", "homepage"]);
    });

    it("reads the declaration through one predicate", () => {
        expect(isStubbableType("place")).toBe(true);
        expect(isStubbableType("folder")).toBe(false);
        expect(isStubbableType("homepage")).toBe(false);
        // A type the registry does not declare is stubbable: the rule is about
        // the body, and an unknown type has no exemption to claim.
        expect(isStubbableType("nosuchtype")).toBe(true);
    });
});

/* ---------------------------------------------------------------------- */
/*  What "empty" means, exactly                                            */
/* ---------------------------------------------------------------------- */

describe("the body is empty when everything after the fence is whitespace", () => {
    it.each([
        ["nothing", ""],
        ["blank lines", "\n\n  \n"],
        ["undefined", undefined],
    ])("%s is empty", (_what, body) => {
        expect(isEmptyBody(body as any)).toBe(true);
    });

    it.each([
        ["an HTML comment", "<!-- nothing yet -->"],
        ["a horizontal rule", "---"],
        ["a lone heading", "## Overview"],
        ["a placeholder sentence", "_To be written._"],
    ])("%s is a body", (_what, body) => {
        expect(isEmptyBody(body)).toBe(false);
    });

    it("asks the type before the body", () => {
        expect(isStubNote({ type: "place" }, "")).toBe(true);
        expect(isStubNote({ type: "folder" }, "")).toBe(false);
        expect(isStubNote({ type: "homepage" }, "")).toBe(false);
        expect(isStubNote({ type: "place" }, "A manor village.")).toBe(false);
    });
});

/* ---------------------------------------------------------------------- */
/*  What a stub's record carries                                           */
/* ---------------------------------------------------------------------- */

/** The manifest identities a Foundry address is derived against. */
const MANIFEST = {
    contentPackage: "thalorna",
    foundryPackageId: "thalorna",
    packRouter: { resolveOrNull: () => "items", defaultOf: () => "journals" },
    docEntryTypes: new Set(["mysticalability"]),
} as any;

function record(frontmatter: Record<string, unknown>, body: string) {
    return buildIndexRecord({
        frontmatter,
        relPath: path.join("Regions", "Weyshott.md"),
        contentPackage: "thalorna",
        body,
        bodyLine: 1,
    });
}

describe("a stub's index record", () => {
    const fm = { type: "place", shortcode: "weyshott", name: { full: "Weyshott" } };

    it("withholds the address, which is the whole signal", () => {
        expect(record(fm, "A manor village.").address).toEqual({
            slug: "place-weyshott",
            canonical: "thalorna-none-place-weyshott",
        });
        expect(record(fm, "").address).toBeNull();
    });

    it("withholds the anchors with it", () => {
        expect(record(fm, "## Overview {#overview}\n\nProse.").anchors).toEqual([
            {
                slug: "overview",
                name: "Overview",
                level: 2,
                line: 1,
                link: "place-weyshott#overview",
            },
        ]);
        expect(record(fm, "").anchors).toBeNull();
    });

    it("keeps the file, so every diagnostic can say where the stub is", () => {
        expect(record(fm, "").file).toEqual({
            path: "Regions/Weyshott.md",
            folder: "Regions",
            name: "Weyshott",
        });
    });

    it("keeps a structural type's address, or a tree loses its folders and its front door", () => {
        const folder = record({ type: "folder", shortcode: "aelwyth" }, "");
        expect(folder.address).toEqual({
            slug: "folder-aelwyth",
            canonical: "thalorna-none-folder-aelwyth",
        });
        const homepage = record({ type: "homepage", shortcode: "root" }, "");
        expect(homepage.address).not.toBeNull();
    });

    it("carries no `state`, so the derivation can never be shadowed by an authored one", () => {
        for (const body of ["", "Prose."]) {
            expect(Object.hasOwn(record(fm, body), "state")).toBe(false);
        }
    });

    it("is recognised by the absent address, not by a marker block", () => {
        expect(isStub(record(fm, ""))).toBe(true);
        expect(isStub(record(fm, "Prose."))).toBe(false);
    });
});

/* ---------------------------------------------------------------------- */
/*  The document is never suppressed                                       */
/* ---------------------------------------------------------------------- */

describe("a stub of a document-compiling type still compiles its document", () => {
    /** A tree holding one empty-bodied item note, walked as a build walks it. */
    function tree(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "note-state-"));
        for (const [rel, text] of Object.entries(files)) {
            const abs = path.join(root, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, text, "utf8");
        }
        return root;
    }

    const NOTE = [
        "---",
        "type: mysticalability",
        "subType: arcanetalent",
        "shortcode: ampl",
        "id: 04aee107d23aa3a8",
        "sohl: {}",
        "name:",
        '  full: "Amplification"',
        "---",
        "",
    ].join("\n");

    it("keeps its id and its `foundry` block", () => {
        const root = tree({ "Talents/Amplification.md": NOTE });
        const records = collectContentIndex(root, {
            contentPackage: "thalorna",
            skipDirectories: [],
            manifest: MANIFEST,
        });
        const note = records.find((r: any) => r.type === "mysticalability");
        expect(note.id).toBe("04aee107d23aa3a8");
        expect(note.foundry).toBeTruthy();
        expect(note.address).toBeNull();
    });

    it("makes no documentation journal for it, and names none", () => {
        const root = tree({ "Talents/Amplification.md": NOTE });
        const records = collectContentIndex(root, {
            contentPackage: "thalorna",
            skipDirectories: [],
            manifest: MANIFEST,
        });
        // The record stays — the index says what a note produces, and a note
        // produces this journal the moment somebody writes a body — but with
        // no body there is no document, so nothing on it names one.
        const doc = records.find((r: any) => r.documents);
        expect(doc).toBeTruthy();
        expect(doc.address).toBeNull();
        expect(doc.id).toBeNull();
        expect(doc.foundry).toBeNull();
        expect(doc.anchors).toBeNull();
    });
});

/* ---------------------------------------------------------------------- */
/*  The pack compile, where a stub is a state rather than a failure        */
/* ---------------------------------------------------------------------- */

describe("a document that would be empty is not created, and nothing names one", () => {
    /** A content tree on disk, walked as a build walks it. */
    function tree(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "stub-compile-"));
        for (const [rel, text] of Object.entries(files)) {
            const abs = path.join(root, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, text, "utf8");
        }
        return root;
    }

    /** Compiles one tree with one pass, and reads back what it wrote. */
    async function compile(Pass: any, files: Record<string, string>, options = {}) {
        const contentBase = tree(files);
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stub-pack-"));
        const pass = new Pass({ skipDirectories: [], contentBase, dest, ...options });
        await pass.compile();
        const documents = fs
            .readdirSync(dest)
            .filter((f) => f.endsWith(".json"))
            .map((f) => JSON.parse(fs.readFileSync(path.join(dest, f), "utf8")));
        return { pass, documents };
    }

    const STUB_PLACE = [
        "---",
        "type: place",
        "subType: settlement",
        "shortcode: ekunda",
        "id: ekunda0000000000",
        'description: "A village on the savannah road."',
        "name:",
        "  full: Ekunda",
        "data:",
        "  population: 400",
        "---",
        "",
    ].join("\n");

    const WRITTEN_PLACE = [
        "---",
        "type: place",
        "subType: settlement",
        "shortcode: harad",
        "id: harad00000000000",
        'description: "A town on the vale road."',
        "name:",
        "  full: Harad",
        "---",
        "",
        "The town sits where the two roads meet.",
        "",
    ].join("\n");

    const STUB_TALENT = [
        "---",
        "type: mysticalability",
        "subType: arcanetalent",
        "shortcode: hex",
        "id: hex0000000000000",
        'description: "Sets misfortune on a named person."',
        "name:",
        "  full: Hex",
        "data:",
        "  templatePriority: null",
        "sohl:",
        "  system:",
        '    assocSkillCode: ""',
        "    masteryLevelBase: 0",
        "    levelBase: 0",
        "---",
        "",
    ].join("\n");

    /** The manifest identities these trees are addressed against. */
    const IDENTITIES = {
        contentPackage: "thalorna",
        foundryPackageId: "thalorna",
        packRouter: { resolveOrNull: () => "items", defaultOf: () => "journals" },
        docEntryTypes: new Set(["mysticalability"]),
    } as any;

    it("compiles a tree whose journal-compiling note is unwritten", async () => {
        const { pass, documents } = await compile(Journals, {
            "Regions/Ekunda.md": STUB_PLACE,
            "Regions/Harad.md": WRITTEN_PLACE,
        });
        // The defect: one unwritten note counted an error, and the generator
        // refuses to compile any pack from incomplete output — so a single
        // stub took every pack in the build down with it.
        expect(pass.errorCount).toBe(0);
        // The written note's entry, and no entry for the one whose journal
        // would have been empty.
        expect(documents.map((d: any) => d.name)).toEqual(["Harad"]);
    });

    it("counts an infobox as empty, because the index already carries it", async () => {
        const { pass, documents } = await compile(Journals, { "Regions/Ekunda.md": STUB_PLACE });
        // The note carries `data:` a panel would render — a population, a
        // parent — and that is not content: it is a rendering of what the
        // record states, so an entry of nothing else tells a reader what the
        // index told them.
        expect(documents).toEqual([]);
        expect(pass.errorCount).toBe(0);
    });

    it("still emits the Item of a note whose document is its `data:`", async () => {
        const { pass, documents } = await compile(Items, { "Talents/Hex.md": STUB_TALENT });
        expect(pass.errorCount).toBe(0);
        expect(documents.map((d: any) => d.name)).toContain("Hex");
    });

    it("names no JournalEntry the compile did not emit", async () => {
        const contentBase = tree({
            "Regions/Ekunda.md": STUB_PLACE,
            "Regions/Harad.md": WRITTEN_PLACE,
            "Talents/Hex.md": STUB_TALENT,
        });
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stub-pack-"));
        const journals = new Journals({ skipDirectories: [], contentBase, dest });
        await journals.compile();
        const compiled = new Set(
            fs
                .readdirSync(dest)
                .filter((f) => f.endsWith(".json"))
                .map((f) => JSON.parse(fs.readFileSync(path.join(dest, f), "utf8"))._id),
        );

        // Derived from the index the package publishes rather than from a
        // second list of what ought to be there: every JournalEntry UUID any
        // record states, against the ids the pass actually wrote. A dangling
        // one sends every consumer resolving it to a document that is not in
        // the pack.
        const records = collectContentIndex(contentBase, {
            contentPackage: "thalorna",
            skipDirectories: [],
            manifest: IDENTITIES,
        });
        const named = records
            .flatMap((r: any) => Object.values(r.foundry ?? {}).map((b: any) => b.uuid))
            .filter((uuid: string | undefined) => uuid?.includes(".JournalEntry."));
        expect(named.length).toBeGreaterThan(0);
        expect(named.filter((uuid: string) => !compiled.has(uuid.split(".").pop()))).toEqual([]);
    });

    it("records the note either way, with null where no document was made", () => {
        const records = collectContentIndex(
            tree({ "Talents/Hex.md": STUB_TALENT, "Regions/Ekunda.md": STUB_PLACE }),
            { contentPackage: "thalorna", skipDirectories: [], manifest: IDENTITIES },
        );
        // The Item is derived from `data:`, so it is made and named.
        const item = records.find((r: any) => r.type === "mysticalability");
        expect(item.id).toBe("hex0000000000000");
        expect(item.foundry.sohl.uuid).toContain(".Item.hex0000000000000");
        // Its documentation journal is not, so the record that would name it
        // names nothing — and it is still a record.
        const doc = records.find((r: any) => r.type === "docmysticalability");
        expect(doc).toBeTruthy();
        expect({
            id: doc.id,
            address: doc.address,
            anchors: doc.anchors,
            foundry: doc.foundry,
        }).toEqual({ id: null, address: null, anchors: null, foundry: null });
        // A note whose own document is the journal keeps its id and names no
        // document at all.
        const place = records.find((r: any) => r.type === "place");
        expect(place.id).toBe("ekunda0000000000");
        expect(place.foundry).toBeNull();
    });

    it("refuses a note with nothing to compile", () => {
        // The guard the fix must not swallow. Nothing routes an empty body
        // here any more, and a caller that hands one over is handing over a
        // note somebody left half-written.
        expect(() =>
            buildJournalEntry({ id: "halfway000000000", name: "Halfway", markdown: "" }),
        ).toThrow(/nothing to compile/);
    });

    it("keeps that refusal for a note the walk did not filter", async () => {
        const journals = new Journals({
            skipDirectories: [],
            contentBase: tree({}),
            dest: fs.mkdtempSync(path.join(os.tmpdir(), "stub-pack-")),
        });
        expect(() =>
            journals.buildEntry({ type: "doc", shortcode: "guide", id: "guide00000000000" }, ""),
        ).toThrow(/nothing to compile/);
    });
});

/* ---------------------------------------------------------------------- */
/*  A page link is refused; a data reference is not                        */
/* ---------------------------------------------------------------------- */

describe("links across the boundary", () => {
    function contentTree(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "note-state-links-"));
        for (const [rel, text] of Object.entries(files)) {
            const abs = path.join(root, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, text, "utf8");
        }
        return root;
    }

    const AELWYTH = [
        "---",
        "type: place",
        "subType: region",
        "shortcode: aelwyth",
        "name:",
        '  full: "Aelwyth"',
        "data:",
        "  borders:",
        "    - { to: weyshott, bearing: NE }",
        "---",
        "",
        "The vale road runs through [[place-weyshott|Weyshott]].",
        "",
    ].join("\n");

    const WEYSHOTT = [
        "---",
        "type: place",
        "subType: settlement",
        "shortcode: weyshott",
        "name:",
        '  full: "Weyshott"',
        "---",
        "",
    ].join("\n");

    const built = () => {
        const root = contentTree({
            "Regions/Aelwyth.md": AELWYTH,
            "Regions/Weyshott.md": WEYSHOTT,
        });
        return buildLinkIndex(root, { skipDirectories: [] });
    };

    it("refuses a wikilink into a stub, and names the file to open", () => {
        const { deadAddresses } = auditLinks(built());
        expect(deadAddresses).toHaveLength(1);
        expect(deadAddresses[0].reason).toBe("stub");
        expect(linkFindingMessage(deadAddresses[0])).toBe(
            "address [[place-weyshott]] names a stub at Regions/Weyshott.md, which " +
                "has no body and therefore no page — name it in prose, or write the note",
        );
    });

    it("does not resolve a stub as a page", () => {
        expect(built().resolveAddress("place-weyshott")).toBeUndefined();
    });

    it("resolves a stub as data, so a border with one on the far side stands", () => {
        expect(built().addressHit("place-weyshott")?.fm.shortcode).toBe("weyshott");
    });
});

/* ---------------------------------------------------------------------- */
/*  The lint: an empty body must be deliberate                             */
/* ---------------------------------------------------------------------- */

describe("the stub lint", () => {
    function lint(files: Record<string, string>) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "stub-lint-"));
        for (const [rel, text] of Object.entries(files)) {
            const abs = path.join(root, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, text, "utf8");
        }
        const records = collectContentIndex(root, {
            contentPackage: "thalorna",
            skipDirectories: [],
        });
        return lintNoteStates(root, { records, contentPackage: "thalorna" });
    }

    const note = (fm: string[], body = "") =>
        ["---", "type: place", "subType: settlement", ...fm, "---", "", body, ""].join("\n");

    it("refuses a stub that says nothing about itself", () => {
        const { findings } = lint({ "A.md": note(["shortcode: a"]) });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("`description`");
        expect(findings[0].line).toBeGreaterThan(0);
    });

    it("passes a stub that carries one", () => {
        expect(
            lint({ "A.md": note(["shortcode: a", "description: A manor village."]) }).findings,
        ).toEqual([]);
    });

    it("refuses a stub tagged `draft`", () => {
        const { findings } = lint({
            "A.md": note(["shortcode: a", "description: A manor village.", "tags: [draft]"]),
        });
        expect(findings.map((f: any) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("not started is not a thing in progress");
    });

    it("refuses a body that reduces to a placeholder, and names the phrase", () => {
        const { findings } = lint({
            "A.md": note(["shortcode: a"], "## Overview\n\n_To be written._"),
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain('"_To be written._"');
    });

    it("leaves a body with real prose beside an unwritten section alone", () => {
        const { findings } = lint({
            "A.md": note(
                ["shortcode: a", "tags: [draft]"],
                "## Overview\n\nA manor village on the vale road, with the lord's mill and a " +
                    "weekly market that draws the whole hundred.\n\n## History\n\nTBD",
            ),
        });
        expect(findings).toEqual([]);
    });

    it("warns, never refuses, a short body carrying no marker", () => {
        const { findings } = lint({ "A.md": note(["shortcode: a"], "A manor village.") });
        expect(findings.map((f: any) => f.severity)).toEqual(["warning"]);
        expect(findings[0].message).toContain("3 word(s)");
    });

    it("counts a wikilink as the one word it renders", () => {
        const { findings } = lint({
            "A.md": note(["shortcode: a"], "See [[affiliation-meivor|Mëivōr]]."),
        });
        expect(findings[0].message).toContain("2 word(s)");
    });

    // One corpus, one ladder. The lint's counts and the `entries` view's have
    // to agree, and the case that separates them is a note with a body and no
    // address at all — vault scaffolding with no `type`, which the view calls a
    // stub because it has no page.
    it("counts the ladder as the view counts it, from the absent address", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "stub-ladder-"));
        fs.writeFileSync(
            path.join(root, "Scratch.md"),
            ["---", "tags:", "  - draft", "---", "", LONG_BODY, ""].join("\n"),
            "utf8",
        );
        fs.writeFileSync(path.join(root, "A.md"), note(["shortcode: a"], LONG_BODY), "utf8");
        const records = collectContentIndex(root, {
            contentPackage: "thalorna",
            skipDirectories: [],
        });
        const { counts } = lintNoteStates(root, { records, contentPackage: "thalorna" });

        const view = await openNotesDatabase(records);
        try {
            const { rows } = await view.query(
                "SELECT state, count(*) AS n FROM entries GROUP BY state",
            );
            const fromView = Object.fromEntries(rows.map((r: any) => [r.state, Number(r.n)]));
            expect({ full: 0, draft: 0, stub: 0, ...fromView }).toEqual(counts);
        } finally {
            await view.close();
        }
    });

    it("reports the ladder as prose, and the oldest drafts as a list", () => {
        const report = lint({
            "A.md": note(["shortcode: a", "description: A village."]),
            "B.md": note(["shortcode: b", "tags: [draft]"], LONG_BODY),
            "C.md": note(["shortcode: c"], LONG_BODY),
        });
        expect(report.counts).toEqual({ full: 1, draft: 1, stub: 1 });
        expect(report.summary[0]).toBe("thalorna: 3 notes — 1 full, 1 draft, 1 stub.");
        expect(report.oldestDrafts.map((d: any) => path.basename(d.file))).toEqual(["B.md"]);
        expect(report.byType).toEqual([{ type: "place", full: 1, draft: 1, stub: 1 }]);
    });
});

/** Enough prose that the short-body warning has nothing to say about it. */
const LONG_BODY =
    "A manor village on the vale road, with the lord's mill and a weekly market " +
    "that draws the whole hundred in from the surrounding farms each autumn.";

/* ---------------------------------------------------------------------- */
/*  The ladder, derived once in the view                                   */
/* ---------------------------------------------------------------------- */

const ROWS = [
    {
        type: "place",
        subType: "settlement",
        shortcode: "ashford",
        name: { full: "Ashford" },
        address: { slug: "place-ashford", canonical: "thalorna-none-place-ashford" },
        tags: ["village"],
        file: { path: "Regions/Ashford.md", folder: "Regions", name: "Ashford" },
    },
    {
        type: "place",
        subType: "settlement",
        shortcode: "harnaby",
        name: { full: "Harnaby" },
        address: { slug: "place-harnaby", canonical: "thalorna-none-place-harnaby" },
        tags: ["village", "draft"],
        file: { path: "Regions/Harnaby.md", folder: "Regions", name: "Harnaby" },
    },
    {
        type: "place",
        subType: "settlement",
        shortcode: "weyshott",
        name: { full: "Weyshott" },
        address: null,
        tags: ["village"],
        file: { path: "Regions/Weyshott.md", folder: "Regions", name: "Weyshott" },
    },
];

let db: any;
beforeAll(async () => {
    db = await openNotesDatabase(ROWS);
}, 60_000);
afterAll(async () => {
    await db?.close();
});

describe("the state ladder", () => {
    it("resolves every row to exactly one state", async () => {
        const { rows } = await db.query(
            "SELECT state, count(*) AS n FROM entries GROUP BY state ORDER BY state",
        );
        expect(rows.map((r: any) => [r.state, Number(r.n)])).toEqual([
            ["draft", 1],
            ["full", 1],
            ["stub", 1],
        ]);
    });

    it("leaves `notes` meaning what it meant, and gives it `state` for free", async () => {
        const { rows } = await db.query("SELECT name.full AS n, state FROM notes ORDER BY n");
        expect(rows).toEqual([
            { n: "Ashford", state: "full" },
            { n: "Harnaby", state: "draft" },
        ]);
    });

    it("renders a stub as plain text and a written note as a link, with no change to the renderer", async () => {
        const result = await runSqlQuery(
            db,
            `SELECT address.slug AS _ref, name.full AS "Name", state AS "State"
             FROM entries WHERE type = 'place' ORDER BY "Name"`,
        );
        const markdown = renderSqlTable(result);
        expect(markdown).toContain("[[place-ashford\\|Ashford]]");
        expect(markdown).not.toContain("[[place-weyshott");
        expect(markdown).toMatch(/\| Weyshott \| stub \|/);
    });
});
