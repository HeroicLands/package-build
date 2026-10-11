/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { authoredFrontmatter, collectContentIndex } from "../engine/content-index.mjs";
import { renderAddress } from "../engine/address.mjs";
import { noteInfoboxes } from "../engine/infobox-registry.mjs";

/**
 * The infobox shows a note's resolved `data.culture`, read from the index record
 * as every pass reads it, except a culture note's own: a culture note resolves
 * to itself, and a row linking a note to itself says nothing.
 */
const PKG = "thalorna";

let content: string;

beforeEach(() => {
    content = fs.mkdtempSync(path.join(os.tmpdir(), "culture-infobox-"));
});

afterEach(() => {
    fs.rmSync(content, { recursive: true, force: true });
});

/** Write a note whose frontmatter is the given lines, with a one-line body. */
function note(rel: string, ...lines: string[]): void {
    const full = path.join(content, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `---\n${lines.join("\n")}\n---\n\nBody.\n`);
}

/** The tree: a culture that omits its culture, one that names itself, and a chain of places. */
function tree(): void {
    note(
        "Lore/Vedyari.md",
        "name: { full: Vedyari }",
        "type: lore",
        "subType: culture",
        "shortcode: vedyari",
    );
    note(
        "Lore/Osket.md",
        "name: { full: Osket }",
        "type: lore",
        "subType: culture",
        "shortcode: osket",
        "data: { culture: lore-osket }",
    );
    note(
        "Places/realm.md",
        "name: { full: Realm }",
        "type: place",
        "shortcode: realm",
        "data: { culture: lore-vedyari }",
    );
    note(
        "Places/shire.md",
        "name: { full: Shire }",
        "type: place",
        "shortcode: shire",
        "data: { parents: [realm] }",
    );
    note(
        "Places/village.md",
        "name: { full: Village }",
        "type: place",
        "shortcode: village",
        "data: { parents: [shire] }",
    );
}

/** The Culture rows of the note's infoboxes, built from its index record. */
function cultureRows(type: string, shortcode: string): any[] {
    const records = collectContentIndex(content, {
        contentPackage: PKG,
        skipDirectories: [],
        problems: [],
    });
    const record = records.find(
        (r: any) => r.type === type && r.shortcode === shortcode && !r.documents,
    );
    if (!record) throw new Error(`no ${type} record for ${shortcode}`);
    const boxes = noteInfoboxes(authoredFrontmatter(record), {
        contentPackage: PKG,
        resolve: (ref: unknown) => ({
            name: typeof ref === "string" ? ref : renderAddress(ref),
            address: typeof ref === "string" ? ref : renderAddress(ref),
        }),
    });
    return boxes
        .flatMap((box: any) => box.sections.flatMap((section: any) => section.rows ?? []))
        .filter((row: any) => row.label === "Culture");
}

describe("the infobox's Culture row", () => {
    it("is absent on a culture note that omits its culture", () => {
        tree();
        expect(cultureRows("lore", "vedyari")).toEqual([]);
    });

    it("is absent on a culture note that names itself", () => {
        tree();
        expect(cultureRows("lore", "osket")).toEqual([]);
    });

    it("shows a place's own culture", () => {
        tree();
        const rows = cultureRows("place", "realm");
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0].value)).toContain(`${PKG}-note-lore-vedyari`);
    });

    it("shows the culture a place inherits through two levels", () => {
        tree();
        const rows = cultureRows("place", "village");
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0].value)).toContain(`${PKG}-note-lore-vedyari`);
    });
});
