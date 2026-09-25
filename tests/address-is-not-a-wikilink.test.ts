/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An **Address** and a **Wikilink** are two types, and one word for both is a
 * mistake an author acts on.
 *
 * ```text
 * Address     <package>-<system>-<type>-<shortcode>
 * Shortcode   <shortcode>
 * Wikilink    [[<Address>[#<anchor>]|<text>]]
 * ```
 *
 * A frontmatter field holds an Address. A field typed after the bracketed prose
 * form invites `seat: [[place-tashal|Tashal]]`, which publishes as literal
 * brackets and resolves to nothing — so the specification's value column names
 * the type the field holds, and `WikiLink` is not the name of any of the three.
 *
 * The rule is derived rather than counted: every table in the specification
 * whose second header cell is `Values` is a field table, every such row's value
 * cell is harvested, and none of them may name a wikilink. Then the whole
 * package is scanned, so a module's JSDoc cannot reintroduce the name the
 * document no longer uses. Three exclusions, each for a reason: the two
 * changelogs record what shipped and nothing edits them, `types/` is emitted
 * from the JSDoc this guard already reads, and this file has to spell the name
 * it refuses in order to look for it.
 *
 * **The document's own examples are read by the parser itself.** An example is
 * what an author copies, so every address in a fenced block or a table row is
 * handed to {@link parseAddress} with the types the document declares, and a
 * reason back is a failure here. That is what refuses `package-type-shortcode`:
 * the written forms are exactly the suffixes of the canonical address, so a
 * three-segment value's first segment is a **system**, and a package name there
 * parses as nothing. Prose is left out on purpose — it names an invalid form in
 * order to refuse it, which an example never does.
 *
 * What this cannot check is an example that parses and means something other than
 * the prose beside it claims. `sohl-image-anvil` is three segments naming a
 * system that happens to share a package's name, so it reads as *this* package —
 * a sentence calling it qualified is wrong, and no derivation of the document
 * says so.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { parseAddress } from "../engine/address.mjs";
import { ASSET_TYPE_NAMES } from "../engine/asset-types.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { isSystemSegment } from "../engine/systems.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..");
const SPEC_PATH = path.join(PKG_ROOT, "docs", "content-format.md");
const SPEC = fs.readFileSync(SPEC_PATH, "utf8");
const SPEC_LINES = SPEC.split("\n");

/** Anything a wikilink might be called, so no spelling of it slips through. */
const WIKILINK_SPELLING = /wiki\s*links?/i;

/* --------------------------------------------------------------------- */
/*  The specification's field tables                                     */
/* --------------------------------------------------------------------- */

/** One row of a markdown table, split on the pipes that are not escaped. */
function cellsOf(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim());
}

/** Whether a row is a table's `| --- | --- |` separator. */
const isSeparator = (cells: string[]) =>
    cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

/**
 * The value cell of every field-table row, with the line it sits on.
 *
 * A **field table** is recognised by its own header — second cell `Values` —
 * which is the shape every per-type table, the shared `data` table and the
 * nested `Rank` table keep to. Recognising the table rather than listing the
 * tables is what makes a type added later subject to the same rule.
 */
function valueCells(): Array<{ line: number; field: string; value: string }> {
    const out: Array<{ line: number; field: string; value: string }> = [];
    let inFieldTable = false;
    SPEC_LINES.forEach((text, i) => {
        if (!text.trim().startsWith("|")) {
            inFieldTable = false;
            return;
        }
        const cells = cellsOf(text);
        if (isSeparator(cells)) return;
        if (!inFieldTable) {
            inFieldTable = cells[1]?.replace(/[`*]/g, "").toLowerCase() === "values";
            return; // the header row itself declares nothing
        }
        out.push({ line: i + 1, field: cells[0] ?? "", value: cells[1] ?? "" });
    });
    return out;
}

const VALUES = valueCells();

/* --------------------------------------------------------------------- */
/*  The package's own text                                               */
/* --------------------------------------------------------------------- */

/** Every source and documentation file the package carries. */
function scannedFiles(): string[] {
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
        files: string[];
    };
    // What ships, plus the suite, less the two changelogs and the generated
    // `types/` tree — the changelogs record what shipped and `types/` is
    // emitted from the JSDoc this guard already reads.
    const roots = [...manifest.files.filter((entry) => !/^CHANGELOG|^types$/.test(entry)), "tests"];
    const READABLE = /\.(md|mjs|cjs|js|ts|mts)$/;
    const walk = (entry: string): string[] => {
        const full = path.join(PKG_ROOT, entry);
        if (!fs.existsSync(full)) return [];
        if (fs.statSync(full).isFile()) return READABLE.test(entry) ? [entry] : [];
        return fs
            .readdirSync(full, { withFileTypes: true })
            .flatMap((child) => walk(path.join(entry, child.name)));
    };
    const self = path.relative(PKG_ROOT, fileURLToPath(import.meta.url));
    return roots.flatMap(walk).filter((file) => file !== self);
}

const FILES = scannedFiles();

/** Each line of a file naming `WikiLink`, as `path:line`. */
function namesTheType(file: string): string[] {
    return fs
        .readFileSync(path.join(PKG_ROOT, file), "utf8")
        .split("\n")
        .map((text, i) => (/WikiLink/.test(text) ? `${file}:${i + 1}: ${text.trim()}` : ""))
        .filter(Boolean);
}

/* --------------------------------------------------------------------- */
/*  The specification's sections                                         */
/* --------------------------------------------------------------------- */

/**
 * Every section whose heading matches, body included.
 *
 * A body runs from its heading to the next heading of its own level or above,
 * so a section is read with its subsections and without its neighbour's.
 */
function sectionBodies(heading: RegExp): string[] {
    const out: string[] = [];
    SPEC_LINES.forEach((line, start) => {
        if (!heading.test(line)) return;
        const level = (line.match(/^#+/) ?? ["#"])[0].length;
        const after = SPEC_LINES.slice(start + 1).findIndex((next) => {
            const own = next.match(/^(#+)\s/);
            return Boolean(own) && own![1].length <= level;
        });
        const end = after < 0 ? SPEC_LINES.length : start + 1 + after;
        out.push(SPEC_LINES.slice(start, end).join("\n"));
    });
    return out;
}

/** The one section whose heading matches, or `null` where none does. */
const sectionBody = (heading: RegExp): string | null => sectionBodies(heading)[0] ?? null;

/* --------------------------------------------------------------------- */
/*  The addresses the document writes in its examples                    */
/* --------------------------------------------------------------------- */

/**
 * Every type an address may name, derived from the document and the registries.
 *
 * The note types come from the document's own `### type:` headings, the asset
 * types from `engine/asset-types.mjs`, and each one's documentation journal is
 * `doc<type>` as the document states. Nothing here is a second list to keep in
 * step with a first.
 */
const ADDRESS_TYPES: Set<string> = (() => {
    const named = [...loadContentFormat().types.keys(), ...ASSET_TYPE_NAMES];
    return new Set([...named, ...named.map((type) => `doc${type}`)]);
})();

/** An address written in one of the document's examples. */
interface WrittenAddress {
    line: number;
    written: string;
    parts: string[];
}

/**
 * Every address the document writes in an **example**, recognised by its type
 * segment.
 *
 * An example is a fenced block or a table row — the two shapes a reader copies
 * from. Prose is left out because prose names an invalid form in order to refuse
 * it, which is the one place a wrong spelling belongs.
 *
 * A candidate is a hyphen-joined run of address characters whose second-to-last
 * segment is a type — which is where the grammar puts the type, however many
 * segments precede it. That test is what keeps a file name, a YAML key and a
 * hyphenated word out of the harvest without a list of things to skip.
 */
function exampleAddresses(): WrittenAddress[] {
    const out: WrittenAddress[] = [];
    let fenced = false;
    SPEC_LINES.forEach((text, i) => {
        if (/^\s*```/.test(text)) {
            fenced = !fenced;
            return;
        }
        const row = text.trim().startsWith("|");
        if (!fenced && !row) return;
        for (const written of text.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? []) {
            const parts = written.split("-");
            if (parts.length < 2 || !ADDRESS_TYPES.has(parts[parts.length - 2])) continue;
            out.push({ line: i + 1, written, parts });
        }
    });
    return out;
}

const EXAMPLES = exampleAddresses();

describe("the specification names an Address and a Wikilink distinctly", () => {
    it("reads field tables out of the specification, so the comparison is not vacuous", () => {
        // Guards the guard: were the `Values` header to change shape, every
        // assertion below would be made about an empty list.
        expect(VALUES.length).toBeGreaterThan(100);
        expect(VALUES.map((v) => v.value)).toContain("`Address`");
    });

    it("finds the files it is guarding", () => {
        expect(FILES.length).toBeGreaterThan(100);
        expect(FILES).toContain(path.join("docs", "content-format.md"));
    });

    it("teaches the Address, and the Wikilink in terms of it", () => {
        const addresses = sectionBody(/^###\s+Addresses\s*$/);
        const wikilinks = sectionBody(/^###\s+Wikilinks\s*$/);
        expect(addresses, "the specification defines an Address").toBeTruthy();
        expect(wikilinks, "the specification defines a Wikilink").toBeTruthy();
        // The Address carries the tuple; the Wikilink carries the brackets, the
        // anchor and the label, and states that its target is an Address.
        expect(addresses).toMatch(/<package>-<system>-<\w+>-<shortcode>/);
        expect(wikilinks).toMatch(/\[\[<Address>\[#<anchor>\]\|<text>\]\]/);
        // Neither absorbs the other: the tuple is not restated under the
        // Wikilink, and the bracketed grammar is not the Address's.
        expect(wikilinks).not.toMatch(/<package>-<system>-<\w+>-<shortcode>/);
    });

    it("teaches the Shortcode as a type of its own", () => {
        // A Shortcode is one segment, and nothing expands it — so it has its
        // own place in the document rather than a sentence inside the Address's.
        const defining = sectionBodies(/^####\s+.*\bshortcode\b.*$/i).filter((body) =>
            /`Shortcode`/.test(body),
        );
        expect(defining.length, "the specification defines a `Shortcode`").toBe(1);
        // Named as the type a field holds, beside the Address it is not.
        expect(VALUES.map((v) => v.value).join("\n")).toMatch(/Shortcode/);
    });

    it("reads addresses out of the document's examples, so the comparison is not vacuous", () => {
        // Guards the guard: were the fence tracking or the type test to break,
        // every example would pass unread.
        expect(EXAMPLES.length).toBeGreaterThan(10);
        expect(EXAMPLES.map((a) => a.written)).toContain("sohl-sohl-weapongear-dgr");
        expect(ADDRESS_TYPES.has("place")).toBe(true);
        expect(ADDRESS_TYPES.has("image")).toBe(true);
    });

    it("writes every example at a length the parser reads", () => {
        // The parser judges the document, rather than a second reading of the
        // grammar written here. `types` is all it needs for these lengths: a
        // shorter form's omitted segments come from the position, and this asks
        // only whether the value names a type at the place the grammar puts one.
        const refused = EXAMPLES.filter((address) => address.parts.length <= 3)
            .map((address) => ({
                address,
                read: parseAddress(address.written, { types: ADDRESS_TYPES }) as {
                    reason?: string;
                },
            }))
            .filter(({ read }) => Boolean(read.reason))
            .map(
                ({ address, read }) =>
                    `docs/content-format.md:${address.line}: ${address.written} — ${read.reason}`,
            );
        expect(refused).toEqual([]);
    });

    it("qualifies an example by naming a system, never a package alone", () => {
        // The fully qualified form is the only one that names a package, and its
        // second segment is the system. No registry closes the set of package
        // names — a tree names its own — so the package segment is not judged
        // here; the system segment is, and it is what a `package-type-shortcode`
        // value gets wrong.
        const wrong = EXAMPLES.filter(
            (address) => address.parts.length === 4 && !isSystemSegment(address.parts[1]),
        ).map(
            (address) =>
                `docs/content-format.md:${address.line}: ${address.written} — ` +
                `"${address.parts[1]}" is not a system`,
        );
        expect(wrong).toEqual([]);
    });

    it("names no field's type after the bracketed prose form", () => {
        const wrong = VALUES.filter((cell) => WIKILINK_SPELLING.test(cell.value)).map(
            (cell) => `docs/content-format.md:${cell.line}: ${cell.field} is ${cell.value}`,
        );
        expect(wrong).toEqual([]);
    });

    it.each(FILES)("%s names no type `WikiLink`", (file) => {
        expect(namesTheType(file)).toEqual([]);
    });
});
