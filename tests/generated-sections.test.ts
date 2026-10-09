/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A note's derived lists and its map are generated sections**, appended to
 * its body as the event views are: **Within**, **Governed by**, **Governed
 * places**, **In song and story** and **From here**. Each is generated where it
 * has something to show, an author's own anchor replaces it and is left byte
 * for byte, and every generated section follows the author's text in one
 * fixed order.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { checkImages } from "../engine/content-images.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { PLACE_KIND_LABELS } from "../engine/derived-sections.mjs";
import {
    GENERATED_SECTIONS,
    generatedDirectoryProblem,
    generatedDrawing,
    markGenerated,
    splitGenerated,
} from "../engine/generated-sections.mjs";
import { parseMarkdownFile } from "../engine/helpers.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const PACKAGE = "demo";

/** The notes of the fixture, by file. */
const NOTES: Record<string, { fm: object; body?: string }> = {
    "Vale.md": { fm: { type: "place", subType: "region", shortcode: "vale", name: "Vale" } },
    "Upper.md": {
        fm: {
            type: "place",
            subType: "region",
            shortcode: "upper",
            name: "Upper Vale",
            data: { parents: ["vale"] },
        },
    },
    "Ford.md": {
        fm: {
            type: "place",
            subType: "settlement",
            shortcode: "ford",
            name: "Ford",
            data: {
                parents: ["vale"],
                government: "affiliation-crown",
                borders: [{ to: "mere", bearing: "E" }],
                events: [{ when: 5, summary: "The ford is bridged.", where: { locus: ["ford"] } }],
            },
        },
    },
    "Mere.md": {
        fm: {
            type: "place",
            subType: "settlement",
            shortcode: "mere",
            name: "Mere",
            data: { parents: ["vale"], government: "affiliation-crown" },
        },
    },
    // A stub: it publishes no page, so the lists name it as plain text.
    "Hollow.md": {
        fm: {
            type: "place",
            subType: "site",
            shortcode: "hollow",
            name: "Hollow",
            data: { parents: ["vale"] },
        },
        body: "",
    },
    "Crown.md": {
        fm: { type: "affiliation", subType: "polity", shortcode: "crown", name: "The Crown" },
    },
    "Lay.md": {
        fm: {
            type: "lore",
            subType: "literature",
            shortcode: "lay",
            name: "Lay of the Ford",
            data: { form: "epic", subjects: ["place-ford"] },
        },
    },
    "Song.md": {
        fm: {
            type: "lore",
            subType: "literature",
            shortcode: "song",
            name: "Song of the Bridge",
            data: { form: "ballad", subjects: ["place-ford#e5"] },
        },
    },
    // Writes its own Within, which stands and replaces the generated one.
    "Moor.md": {
        fm: { type: "place", subType: "region", shortcode: "moor", name: "Moor" },
        body: "Moor's prose.\n\n# Within {#within}\n\nThe author's own list.\n",
    },
    "Tor.md": {
        fm: {
            type: "place",
            subType: "feature",
            shortcode: "tor",
            name: "Tor",
            data: { parents: ["moor"] },
        },
    },
    // Nothing names it and it names nothing: it is given no section.
    "Waste.md": { fm: { type: "place", subType: "region", shortcode: "waste", name: "Waste" } },
};

let dir: string;
let prepared: any;

const bodyOf = (file: string) => parseMarkdownFile(path.join(dir, file)).body;

/** A note's body after its tables are expanded, as every surface receives it. */
function expanded(file: string) {
    return expandContentTables(bodyOf(file), {
        source: file,
        sqlTables: prepared?.get(path.join(dir, file)),
    });
}

/** The headings of the sections generated for a note. */
const headings = (file: string) =>
    String(prepared?.get(path.join(dir, file))?.generated ?? "")
        .split("\n")
        .filter((line) => line.startsWith("# "));

/** One generated section's Markdown, heading to the next heading. */
function sectionOf(file: string, slug: string): string {
    const text = String(prepared?.get(path.join(dir, file))?.generated ?? "");
    const start = text.indexOf(`{#${slug}}`);
    if (start < 0) return "";
    const from = text.lastIndexOf("\n# ", start) + 1;
    const next = text.indexOf("\n# ", start);
    return text.slice(from, next < 0 ? undefined : next);
}

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "generated-sections-"));
    for (const [file, { fm, body }] of Object.entries(NOTES)) {
        const { name, ...rest } = fm as any;
        fs.writeFileSync(
            path.join(dir, file),
            `---\n${YAML.stringify({ name: { full: name }, ...rest })}---\n\n${body ?? `Prose about ${name}.\n`}`,
        );
    }
    const records = collectContentIndex(dir, { contentPackage: PACKAGE, skipDirectories: [] });
    prepared = await prepareTreeSqlTables(dir, {
        records,
        config: { contentPackage: PACKAGE } as any,
    });
}, 60_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the generated sections", () => {
    it("follow the author's text in one fixed order", () => {
        expect(GENERATED_SECTIONS.map((section) => section.slug)).toEqual([
            "within",
            "governedby",
            "governedplaces",
            "chronology",
            "events",
            "accounts",
            "followed",
            "insongandstory",
            "fromhere",
        ]);
    });

    it("are set in that order on a note given several", () => {
        expect(headings("Ford.md")).toEqual([
            "# Governed by {#governedby}",
            "# Chronology {#chronology}",
            "# In song and story {#insongandstory}",
            "# From here {#fromhere}",
        ]);
    });

    it("come after everything the author wrote", () => {
        const { markdown, generatedFrom } = expanded("Ford.md");
        const lines = markdown.split("\n");
        expect(lines.slice(0, generatedFrom).join("\n")).toContain("Prose about Ford.");
        expect(lines[generatedFrom!]).toBe("# Governed by {#governedby}");
    });

    it("label every kind of place the vocabulary declares", () => {
        for (const kind of NOTE_VOCABULARY.place.subTypes ?? [])
            expect(PLACE_KIND_LABELS[kind], kind).toBeTruthy();
    });
});

describe("Within", () => {
    it("lists the places whose `parents` names the place, grouped by kind in vocabulary order", () => {
        expect(sectionOf("Vale.md", "within")).toBe(
            "# Within {#within}\n\n" +
                "**Regions:** [[demo-note-place-upper|]]\n\n" +
                "**Settlements:** [[demo-note-place-ford|]], [[demo-note-place-mere|]]\n\n" +
                "**Sites:** Hollow\n",
        );
    });

    it("names a stub as plain text, since it publishes no page", () => {
        expect(sectionOf("Vale.md", "within")).not.toContain("place-hollow");
    });

    it("is replaced by the author's own section, which stands byte for byte", () => {
        expect(headings("Moor.md")).toEqual([]);
        expect(expanded("Moor.md").markdown).toBe(bodyOf("Moor.md"));
    });
});

describe("Governed by and Governed places", () => {
    it("names the affiliation a place's government names, with its kind", () => {
        expect(sectionOf("Mere.md", "governedby")).toBe(
            "# Governed by {#governedby}\n\n- [[demo-note-affiliation-crown|]] (polity)\n",
        );
    });

    it("lists on the affiliation every place naming it, grouped by kind", () => {
        expect(sectionOf("Crown.md", "governedplaces")).toBe(
            "# Governed places {#governedplaces}\n\n" +
                "**Settlements:** [[demo-note-place-ford|]], [[demo-note-place-mere|]]\n",
        );
    });
});

describe("In song and story", () => {
    it("lists the works naming the note, or one of its events, each with its form", () => {
        expect(sectionOf("Ford.md", "insongandstory")).toBe(
            "# In song and story {#insongandstory}\n\n" +
                "- [[demo-note-lore-lay|]] (epic)\n" +
                "- [[demo-note-lore-song|]] (ballad)\n",
        );
    });
});

describe("From here", () => {
    it("names the map from a place on a border or a route as a generated drawing", () => {
        expect(sectionOf("Ford.md", "fromhere")).toBe(
            "# From here {#fromhere}\n\n![Map from Ford](generated/from-ford.svg){.full-width}\n",
        );
        expect(sectionOf("Mere.md", "fromhere")).toContain("generated/from-mere.svg");
        expect(generatedDrawing("generated/from-ford.svg")).toBe("from-ford.svg");
        expect(generatedDrawing("images/from-ford.svg")).toBeNull();
    });

    it("refuses an authored image under the generated directory, where it is written", () => {
        expect(generatedDirectoryProblem("generated/from-ford.svg")).toMatch(/generated\//);
        expect(generatedDirectoryProblem("images/map.webp")).toBe("");
        const findings = checkImages(
            "Prose.\n\n![The ford](generated/from-ford.svg)\n",
            "Ford.md",
            {
                bodyLine: 6,
            },
        );
        expect(findings).toEqual([
            expect.objectContaining({
                file: "Ford.md",
                line: 8,
                column: 1,
                severity: "error",
                message: expect.stringContaining("`generated/`"),
            }),
        ]);
    });
});

describe("a section with nothing to show", () => {
    it("is not generated", () => {
        expect(headings("Waste.md")).toEqual([]);
        expect(headings("Upper.md")).toEqual([]);
        expect(prepared.get(path.join(dir, "Waste.md"))?.generated).toBeUndefined();
    });
});

describe("the boundary a surface marks", () => {
    it("splits the author's text from the generated sections and leaves no trace", () => {
        const { markdown, generatedFrom } = expanded("Vale.md");
        const { authored, generated } = splitGenerated(markGenerated(markdown, generatedFrom));
        expect(authored.trimEnd()).toBe("Prose about Vale.");
        expect(generated.startsWith("# Within {#within}")).toBe(true);
        expect(`${authored}\n${generated}`).toBe(markdown);
    });
});
