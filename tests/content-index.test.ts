/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    DERIVED_KEYS,
    sortKeysDeep,
    noteAddress,
    asciiName,
    asciiAliases,
    collectAnchors,
    buildIndexRecord,
    collectContentIndex,
    serializeContentIndex,
    emitContentIndex,
} from "../engine/content-index.mjs";
import { addressSlug } from "../engine/content-address.mjs";
import { canonicalKey } from "../engine/kb-manifest.mjs";
import { splitPages } from "../engine/journals.mjs";

let tmp: string;

/** Write a note with the given frontmatter, and a one-line body. */
function note(rel: string, frontmatter: string): void {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `---\n${frontmatter}\n---\n\nBody.\n`);
}

/** Read the emitted file back as parsed records. */
function readIndex(file: string): Array<Record<string, any>> {
    const text = fs.readFileSync(file, "utf8");
    return text
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l));
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sortKeysDeep", () => {
    it("orders an object's keys at every depth", () => {
        const sorted = sortKeysDeep({ b: 1, a: { d: 2, c: 3 } });
        expect(Object.keys(sorted as object)).toEqual(["a", "b"]);
        expect(Object.keys((sorted as any).a)).toEqual(["c", "d"]);
    });

    it("keeps array order, which is authored, but sorts objects inside", () => {
        const sorted = sortKeysDeep({ list: [{ z: 1, y: 2 }, "b", "a"] }) as any;
        expect(sorted.list[1]).toBe("b");
        expect(sorted.list[2]).toBe("a");
        expect(Object.keys(sorted.list[0])).toEqual(["y", "z"]);
    });

    it("passes non-plain objects through rather than rebuilding them", () => {
        const date = new Date(0);
        expect(sortKeysDeep({ when: date } as any)).toMatchObject({ when: date });
    });

    it("leaves primitives and null alone", () => {
        expect(sortKeysDeep(null)).toBeNull();
        expect(sortKeysDeep(4)).toBe(4);
        expect(sortKeysDeep("x")).toBe("x");
    });
});

describe("noteAddress", () => {
    it("states both the local wikilink target and the canonical key", () => {
        expect(noteAddress({ type: "being", shortcode: "aurochs" }, "sohl")).toEqual({
            slug: "being-aurochs",
            canonical: "sohl-being-aurochs",
        });
    });

    it("derives through the same functions the manifest and site build use", () => {
        // Not a reimplementation: an index that disagreed with either about
        // where a note lives would be worse than no index.
        const fm = { type: "weapongear", shortcode: "Dgr" };
        const address = noteAddress(fm, "sohl");
        expect(address?.slug).toBe(addressSlug(fm));
        expect(address?.canonical).toBe(canonicalKey("sohl", fm.type, fm.shortcode));
    });

    it("lowercases, so a lookup does not depend on how a shortcode was cased", () => {
        expect(noteAddress({ type: "weapongear", shortcode: "BstdSwd" }, "sohl")).toEqual({
            slug: "weapongear-bstdswd",
            canonical: "sohl-weapongear-bstdswd",
        });
    });

    it("carries the package, so two packages' addresses stay distinct", () => {
        const sohl = noteAddress({ type: "being", shortcode: "aurochs" }, "sohl");
        const thalorna = noteAddress({ type: "being", shortcode: "aurochs" }, "thalorna");
        expect(sohl?.slug).toBe(thalorna?.slug);
        expect(sohl?.canonical).not.toBe(thalorna?.canonical);
    });

    it.each([
        ["no type", { shortcode: "aurochs" }],
        ["no shortcode", { type: "being" }],
        ["a blank shortcode", { type: "being", shortcode: "  " }],
    ])("is null for a note with %s", (_label, fm) => {
        // Unaddressable is ordinary; the record says so rather than leaving
        // every reader to rediscover the rule.
        expect(noteAddress(fm as any, "sohl")).toBeNull();
    });
});

describe("asciiName", () => {
    it("folds diacritics without losing the letter", () => {
        expect(asciiName("Kûrbúl Helm")).toBe("Kurbul Helm");
        expect(asciiName("Kèthîra")).toBe("Kethira");
        expect(asciiName("Hârn")).toBe("Harn");
    });

    it("expands ligatures rather than dropping them", () => {
        expect(asciiName("Ærling")).toBe("AErling");
        expect(asciiName("Œuvre")).toBe("OEuvre");
        expect(asciiName("Straße")).toBe("Strasse");
    });

    it("spells out thorn and eth", () => {
        expect(asciiName("Þorn")).toBe("Thorn");
        expect(asciiName("þorn")).toBe("thorn");
        expect(asciiName("Ðunhold")).toBe("Dunhold");
        expect(asciiName("ðunhold")).toBe("dunhold");
    });

    it("transliterates rather than strips, so a name stays readable", () => {
        // Deleting the marks instead would leave "Krbl", which is worse than
        // the original for anyone trying to recognise it.
        expect(asciiName("Kûrbúl ¾-Helm")).toBe("Kurbul 3/4-Helm");
        expect(asciiName("Ivinia—North")).toBe("Ivinia--North");
        expect(asciiName("Jarin’s")).toBe("Jarin's");
    });

    it("emits every character inside printable 7-bit ASCII", () => {
        const out = asciiName("Ærling’s Kûrbúl ¾-Helm — Ðunhold");
        expect(out).toMatch(/^[\x20-\x7E]+$/);
    });

    it("returns an already-ASCII name unchanged", () => {
        // Emitted even when it equals the name, so a consumer matching on this
        // field never has to branch on whether the name happened to be ASCII.
        expect(asciiName("Composite Bow 100")).toBe("Composite Bow 100");
    });

    it("replaces anything unprintable with a space, and collapses runs", () => {
        // A space rather than nothing, so a character that transliterates away
        // cannot weld two words together.
        expect(asciiName("A\u0001B")).toBe("A B");
        expect(asciiName("  Spaced   Out  ")).toBe("Spaced Out");
    });

    it("is null when there is no name, or nothing printable survives", () => {
        expect(asciiName(undefined as any)).toBeNull();
        expect(asciiName(42 as any)).toBeNull();
        expect(asciiName("   ")).toBeNull();
    });
});

describe("asciiAliases", () => {
    it("folds every alias, keeping the authored order", () => {
        expect(asciiAliases(["Killer Whale", "Ærling", "Kèthîra"])).toEqual([
            "Killer Whale",
            "AErling",
            "Kethira",
        ]);
    });

    it("is an empty array when there are no aliases", () => {
        // Never null: a note with no aliases has an empty set of them, and a
        // consumer iterating should not have to check first.
        expect(asciiAliases(undefined)).toEqual([]);
        expect(asciiAliases(null)).toEqual([]);
        expect(asciiAliases([])).toEqual([]);
    });

    it("drops an entry that is not a name, rather than leaving a hole", () => {
        expect(asciiAliases(["Ice Bear", "", null, 42, "   "] as any)).toEqual(["Ice Bear"]);
    });

    it("is not confused by a non-array", () => {
        expect(asciiAliases("Killer Whale" as any)).toEqual([]);
    });
});

describe("collectAnchors", () => {
    const body = [
        "# Aurochs", // an H1 starts a page but declares no slug
        "",
        "Prose.",
        "",
        "## Habitat {#habitat}",
        "",
        "More prose.",
        "",
        "```markdown",
        "### Fenced {#not-an-anchor}", // inside a fence
        "```",
        "",
        "#### Diet {#diet}",
    ].join("\n");

    it("finds every heading that declares an anchor, in document order", () => {
        expect(collectAnchors(body).map((a) => a.slug)).toEqual(["habitat", "diet"]);
    });

    it("records each anchor's name and heading level", () => {
        expect(collectAnchors(body)[0]).toMatchObject({
            slug: "habitat",
            name: "Habitat",
            level: 2,
        });
        expect(collectAnchors(body)[1]).toMatchObject({ name: "Diet", level: 4 });
    });

    it("ignores an anchor inside a fenced block", () => {
        expect(collectAnchors(body).map((a) => a.slug)).not.toContain("not-an-anchor");
    });

    it("numbers a line within the body when told nothing else", () => {
        // 1-based: "## Habitat {#habitat}" is the fifth line.
        expect(collectAnchors(body)[0].line).toBe(5);
    });

    it("reports the line in the file, so an editor can jump to it", () => {
        // A note with six lines of frontmatter puts the body at file line 8.
        expect(collectAnchors(body, 8)[0].line).toBe(12);
    });

    it("agrees with splitPages about what an anchor is", () => {
        // The journal compiler decides which sections become addressable pages.
        // An index naming an anchor it does not produce would advertise a link
        // that resolves nowhere, so drift fails here rather than shipping.
        const fromPages = splitPages(body)
            .map((p: any) => p.anchorSlug)
            .filter(Boolean);
        expect(collectAnchors(body).map((a) => a.slug)).toEqual(fromPages);
    });

    it("finds nothing in an empty or absent body", () => {
        expect(collectAnchors("")).toEqual([]);
        expect(collectAnchors(undefined as any)).toEqual([]);
    });
});

describe("buildIndexRecord", () => {
    it("carries the whole frontmatter through unflattened", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being", sohl: { body: { weight: { base: 1500 } } } },
            relPath: path.join("Bestiary", "Animal", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.type).toBe("being");
        // The nested path survives as written — a reader addresses what the
        // note says, which is what a dataview query writes.
        expect(record.sohl.body.weight.base).toBe(1500);
    });

    it("namespaces the note's place in the tree under `file`", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being" },
            relPath: path.join("Bestiary", "Animal", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.file).toEqual({
            path: "Bestiary/Animal/Aurochs.md",
            folder: "Bestiary/Animal",
            name: "Aurochs",
        });
    });

    it("carries the note's address, so a lookup is a field read", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being", shortcode: "aurochs" },
            relPath: path.join("Bestiary", "Animal", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.address).toEqual({
            slug: "being-aurochs",
            canonical: "sohl-being-aurochs",
        });
    });

    it("carries an ASCII form of the note's name", () => {
        const record = buildIndexRecord({
            frontmatter: {
                type: "armorgear",
                shortcode: "kbh",
                name: { full: "Kûrbúl Helm" },
            },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        expect(record.nameAscii).toBe("Kurbul Helm");
        // The authored name is untouched beside it.
        expect(record.name.full).toBe("Kûrbúl Helm");
    });

    it("carries ASCII forms of the note's aliases", () => {
        const record = buildIndexRecord({
            frontmatter: {
                type: "being",
                shortcode: "orca",
                name: { full: "Orca", aliases: ["Killer Whale", "Ærling"] },
            },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        expect(record.aliasesAscii).toEqual(["Killer Whale", "AErling"]);
        // The authored aliases are untouched beside them.
        expect(record.name.aliases).toEqual(["Killer Whale", "Ærling"]);
    });

    it("states an empty alias set rather than omitting it", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being", shortcode: "x", name: { full: "X" } },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        expect(record.aliasesAscii).toEqual([]);
    });

    it("keeps the path relative, never absolute", () => {
        // An absolute path is a fact about the machine that built the index:
        // it would break byte-stability between checkouts and publish someone's
        // home directory.
        const record = buildIndexRecord({
            frontmatter: { type: "being", shortcode: "aurochs" },
            relPath: path.join("Bestiary", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(path.isAbsolute(record.file.path)).toBe(false);
        expect(JSON.stringify(record)).not.toContain(os.homedir());
    });

    it("states an empty folder for a note at the tree root", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "doc" },
            relPath: "README.md",
            contentPackage: "sohl",
        });
        expect(record.file.folder).toBe("");
        expect(record.file.path).toBe("README.md");
    });

    it("stamps the configured package, matching what the expander reads", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being" },
            relPath: "A.md",
            contentPackage: "thalorna",
        });
        expect(record.package).toBe("thalorna");
    });

    it("does not confuse a note's own `folder` field with its location", () => {
        // `folder` is real frontmatter on most notes, which is exactly why the
        // location lives under `file` instead of beside it.
        const record = buildIndexRecord({
            frontmatter: { type: "being", folder: "Beasts" },
            relPath: path.join("Bestiary", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.folder).toBe("Beasts");
        expect(record.file.folder).toBe("Bestiary");
    });

    it.each(DERIVED_KEYS)("refuses a note that authors the derived `%s` key", (key) => {
        expect(() =>
            buildIndexRecord({
                frontmatter: { type: "being", [key]: "whatever" },
                relPath: "A.md",
                contentPackage: "sohl",
            }),
        ).toThrow(new RegExp(`\`${key}:\` is derived`));
    });

    it("sorts every key, so a record serializes identically however authored", () => {
        const a = buildIndexRecord({
            frontmatter: { type: "being", id: "x", sohl: { b: 1, a: 2 } },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        const b = buildIndexRecord({
            frontmatter: { sohl: { a: 2, b: 1 }, id: "x", type: "being" },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});

describe("collectContentIndex", () => {
    it("orders records by content path, not by directory-read order", () => {
        note("Zebra.md", "type: being\nid: z\nshortcode: zebra");
        note(path.join("Alpha", "Ant.md"), "type: being\nid: a\nshortcode: ant");
        note("Mule.md", "type: being\nid: m\nshortcode: mule");

        const records = collectContentIndex(tmp, { contentPackage: "sohl" });
        expect(records.map((r) => r.file.path)).toEqual(["Alpha/Ant.md", "Mule.md", "Zebra.md"]);
    });

    it("skips the directories the configuration names", () => {
        note("Keep.md", "type: being\nid: k\nshortcode: keep");
        note(path.join("Templates", "Skip.md"), "type: being\nid: s\nshortcode: skip");

        const records = collectContentIndex(tmp, {
            contentPackage: "sohl",
            skipDirectories: ["Templates"],
        });
        expect(records.map((r) => r.file.name)).toEqual(["Keep"]);
    });

    it("returns nothing for a tree that does not exist", () => {
        const records = collectContentIndex(path.join(tmp, "absent"), {
            contentPackage: "sohl",
            skipDirectories: [],
        });
        expect(records).toEqual([]);
    });
});

describe("serializeContentIndex", () => {
    it("writes one compact JSON object per line, newline-terminated", () => {
        const text = serializeContentIndex([{ a: 1 } as any, { b: 2 } as any]);
        expect(text).toBe('{"a":1}\n{"b":2}\n');
    });

    it("serializes an empty set as the empty string, not a lone newline", () => {
        expect(serializeContentIndex([])).toBe("");
    });
});

describe("emitContentIndex", () => {
    const config = (root: string) => ({
        paths: { content: root, contentIndex: path.join(root, "..", "out") },
        contentPackage: "sohl",
        skipDirectories: [],
    });

    it("writes <package>.jsonl and reports what it holds", () => {
        note("Aurochs.md", "type: being\nid: a1\nshortcode: aurochs");
        note("Baboon.md", "type: being\nid: b1\nshortcode: baboon");

        const result = emitContentIndex({ config: config(tmp) as any });

        expect(path.basename(result.file)).toBe("sohl.jsonl");
        expect(result.notes).toBe(2);
        expect(result.bytes).toBeGreaterThan(0);
        expect(readIndex(result.file).map((r) => r.shortcode)).toEqual(["aurochs", "baboon"]);
    });

    it("is byte-stable across runs over an unchanged tree", () => {
        note("Aurochs.md", "type: being\nid: a1\nshortcode: aurochs");
        note(path.join("Deep", "Nested", "Boar.md"), "type: being\nid: b1\nshortcode: boar");

        const first = emitContentIndex({ config: config(tmp) as any });
        const before = fs.readFileSync(first.file, "utf8");
        const second = emitContentIndex({ config: config(tmp) as any });
        const after = fs.readFileSync(second.file, "utf8");

        // Rebuilding is the expected way to use this, so a regeneration that
        // reordered lines would make every rebuild look like a change.
        expect(after).toBe(before);
    });

    it("honours an explicit tree and output directory", () => {
        note(path.join("tree", "A.md"), "type: being\nid: a\nshortcode: a");
        const out = path.join(tmp, "elsewhere");

        const result = emitContentIndex({
            contentBase: path.join(tmp, "tree"),
            outDir: out,
            config: config(tmp) as any,
        });

        expect(result.file).toBe(path.join(out, "sohl.jsonl"));
        expect(fs.existsSync(result.file)).toBe(true);
    });

    it("refuses a content tree that is not there", () => {
        expect(() =>
            emitContentIndex({
                contentBase: path.join(tmp, "absent"),
                config: config(tmp) as any,
            }),
        ).toThrow(/no content tree at/);
    });

    it("refuses to state that a package has no content", () => {
        // An empty index and a mis-pointed tree are indistinguishable to a
        // reader, who takes the file as authoritative.
        fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
        expect(() =>
            emitContentIndex({
                contentBase: path.join(tmp, "empty"),
                config: config(tmp) as any,
            }),
        ).toThrow(/yielded no notes/);
    });
});

describe("an item note is two records: the item, and its documentation (#239)", () => {
    /** A config whose Foundry identities let a UUID be derived. */
    const foundryConfig = (root: string) =>
        ({
            paths: { content: root, contentIndex: path.join(root, "..", "out") },
            contentPackage: "sohl",
            foundryPackage: "sohl",
            skipDirectories: [],
            // The types whose prose compiles into a JournalEntry of its own;
            // `defineConfig` composes this once and every reader takes it from
            // there.
            docEntryTypes: new Set(["affliction"]),
        }) as any;

    it("emits a second record for the documentation journal", () => {
        note("Black_Death.md", "type: affliction\nid: bd1\nshortcode: blkdth");

        const result = emitContentIndex({ config: foundryConfig(tmp) });
        const records = readIndex(result.file);

        expect(records.map((r) => r.type)).toEqual(["affliction", "docaffliction"]);
        // The counts are different numbers and are reported as such: an item
        // note is one note and two records.
        expect(result.notes).toBe(1);
        expect(result.records).toBe(2);
    });

    it("addresses the journal in its own right, sharing the page", () => {
        note("Black_Death.md", "type: affliction\nid: bd1\nshortcode: blkdth");
        const [item, doc] = readIndex(emitContentIndex({ config: foundryConfig(tmp) }).file);

        expect(item.address.canonical).toBe("sohl-affliction-blkdth");
        expect(doc.address.canonical).toBe("sohl-docaffliction-blkdth");
        // On the web the note renders as one page which *is* its documentation.
        expect(doc.address.slug).toBe(item.address.slug);
    });

    it("links the two records in both directions", () => {
        note("Black_Death.md", "type: affliction\nid: bd1\nshortcode: blkdth");
        const [item, doc] = readIndex(emitContentIndex({ config: foundryConfig(tmp) }).file);

        expect(item.documentation).toBe(doc.address.canonical);
        expect(doc.documents).toBe(item.address.canonical);
    });

    it("gives each record its own Foundry address", () => {
        note("Black_Death.md", "type: affliction\nid: bd1\nshortcode: blkdth");
        const [item, doc] = readIndex(emitContentIndex({ config: foundryConfig(tmp) }).file);

        expect(item.foundry.uuid).toContain(".Item.");
        expect(doc.foundry.uuid).toContain(".JournalEntry.");
        expect(item.foundry.uuid).not.toBe(doc.foundry.uuid);
    });

    it("does not copy the item's frontmatter onto the journal", () => {
        // The `sohl:` block describes the item; asserting it of the journal
        // would be false, and doubles the file to do it.
        note(
            "Black_Death.md",
            "type: affliction\nid: bd1\nshortcode: blkdth\nsohl:\n  contagion: 5",
        );
        const [item, doc] = readIndex(emitContentIndex({ config: foundryConfig(tmp) }).file);

        expect(item.sohl).toEqual({ contagion: 5 });
        expect(doc.sohl).toBeUndefined();
    });

    it("leaves a note that compiles to one document as one record", () => {
        note("Guide.md", "type: doc\nsubType: rules\nid: g1\nshortcode: guide");
        const records = readIndex(emitContentIndex({ config: foundryConfig(tmp) }).file);

        expect(records).toHaveLength(1);
        expect(records[0].documentation).toBeNull();
    });

    it("orders an item's two records deterministically", () => {
        // They share a file and an id, so the canonical address is the only
        // key left to sort on — without it the order is a fact about the walk.
        note("Black_Death.md", "type: affliction\nid: bd1\nshortcode: blkdth");
        const a = fs.readFileSync(emitContentIndex({ config: foundryConfig(tmp) }).file, "utf8");
        const b = fs.readFileSync(emitContentIndex({ config: foundryConfig(tmp) }).file, "utf8");
        expect(a).toBe(b);
    });

    it("refuses a note that authors over a derived key", () => {
        note("Odd.md", "type: affliction\nid: o1\nshortcode: odd\ndocumentation: mine");
        expect(() => emitContentIndex({ config: foundryConfig(tmp) })).toThrow(/derived/);
    });
});
