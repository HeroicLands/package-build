/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`{{ref "<event address>" field="<key>"}}` prints one field of one event as
 * text**, read from the one place the event records it. A reference naming no
 * event, a prose anchor, a field the reference does not take, or a field the
 * event does not state is a finding at the reference.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { EVENT_REFERENCE_FIELDS, eventNoteIndex } from "../engine/event-fields.mjs";
import { EXPRESSION_HELPERS, renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";

/** Write a note whose frontmatter is `fm` into `dir`. */
function write(dir: string, rel: string, fm: object, body = "Prose.\n") {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\n\n${body}`);
}

const IRONFELLS = {
    type: "place",
    subType: "settlement",
    shortcode: "ironfells",
    name: { full: "Ironfells" },
    data: {
        events: [
            { id: "raising", when: 120, kind: "raising", summary: "Ironfells is raised." },
            {
                id: "sack",
                when: "~280",
                until: 281,
                kind: "siege",
                summary: "Ironfells is sacked by [[lore-founding|the founders]].",
                names: [{ name: "The Burning", by: "place-ironfells" }],
            },
        ],
    },
};

let dir: string;
let events: ReturnType<typeof eventNoteIndex>;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-field-refs-"));
    const own = path.join(dir, "own");
    write(own, "Ironfells.md", IRONFELLS, "# History {#history}\n\nProse.\n");
    write(own, "Founding.md", {
        type: "lore",
        subType: "history",
        shortcode: "founding",
        name: { full: "The Founding" },
        data: { events: [{ when: 100, kind: "founding", summary: "The city is founded." }] },
    });
    const theirs = path.join(dir, "theirs");
    write(theirs, "Elder.md", {
        type: "place",
        subType: "settlement",
        shortcode: "elder",
        name: { full: "Elder" },
        data: { events: [{ id: "first", when: 50, kind: "raising", summary: "Elder rises." }] },
    });

    const cache = path.join(dir, "cache", "elder@1.0.0");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
        path.join(cache, "elder-metadata.jsonl"),
        serializeContentIndex(
            collectContentIndex(theirs, { contentPackage: "elder", skipDirectories: [] }),
        ),
    );
    fs.writeFileSync(path.join(cache, ".complete"), "");
    const { index: foreignIndex } = loadForeignIndexes(
        {
            contentPackage: "demo",
            paths: { metadataCache: path.join(dir, "cache") },
            relationships: { requires: [{ id: "elder", manifest: "https://x/y.json" }] },
        } as never,
        ["demo"],
    );
    events = eventNoteIndex(
        collectContentIndex(own, { contentPackage: "demo", skipDirectories: [] }),
        { contentPackage: "demo", foreignIndex },
    );
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Render `body` as the Ironfells note would. */
const render = (body: string, fm: object = IRONFELLS) =>
    renderMarkdownExpressions(body, { fm, events, file: "Ironfells.md", bodyLine: 10 });

describe("an inline reference to an event's field", () => {
    it("prints each accepted field as text", () => {
        const cases: Array<[string, string]> = [
            ['{{ref "place-ironfells#sack" field="when"}}', "~280"],
            ['{{ref "place-ironfells#sack" field="until"}}', "281"],
            ['{{ref "place-ironfells#sack" field="kind"}}', "siege"],
            ['{{ref "place-ironfells#sack" field="name"}}', "The Burning"],
            ['{{ref "place-ironfells#raising" field="summary"}}', "Ironfells is raised."],
        ];
        expect(new Set(cases.map(([source]) => /field="(\w+)"/.exec(source)![1]))).toEqual(
            new Set(EVENT_REFERENCE_FIELDS),
        );
        for (const [source, text] of cases)
            expect(render(`Sacked in ${source}.`), source).toEqual({
                markdown: `Sacked in ${text}.`,
                findings: [],
            });
    });

    it("prints a link inside a summary as its label, so the reference is never a link", () => {
        expect(render('{{ref "place-ironfells#sack" field="summary"}}').markdown).toBe(
            "Ironfells is sacked by the founders.",
        );
    });

    it("reads a note holding one event without an anchor, and this note's own by `#id`", () => {
        expect(render('{{ref "lore-founding" field="when"}}').markdown).toBe("100");
        expect(render('{{ref "#sack" field="kind"}}').markdown).toBe("siege");
    });

    it("reads an event a dependency publishes", () => {
        expect(render('{{ref "elder-note-place-elder#first" field="summary"}}')).toEqual({
            markdown: "Elder rises.",
            findings: [],
        });
    });

    const faults: Array<[string, string]> = [
        ['{{ref "place-nowhere#sack" field="when"}}', "names no note this build resolves"],
        ['{{ref "place-ironfells#burning" field="when"}}', 'names no anchor "#burning"'],
        ['{{ref "place-ironfells#history" field="when"}}', "prose anchor"],
        ['{{ref "place-ironfells#sack" field="where"}}', "when, until, kind, summary, name"],
        ['{{ref "place-ironfells#raising" field="until"}}', "states no until"],
        ['{{ref "place-ironfells#raising" field="name"}}', "states no name"],
        ['{{ref "place-ironfells" field="when"}}', "holds 2 events"],
        ['{{ref "place-ironfells#sack" field=when}}', "quoted string"],
        ['{{ref "place-ironfells#sack" field="when" form="full"}}', "not both"],
    ];
    for (const [source, message] of faults) {
        it(`reports ${source} at its position`, () => {
            const result = render(`Line one.\n\nIt fell in ${source}.`);
            expect(result.markdown).toContain(source);
            expect(result.findings).toEqual([
                {
                    file: "Ironfells.md",
                    line: 12,
                    column: 12,
                    severity: "error",
                    message: expect.stringContaining(message),
                },
            ]);
        });
    }

    it("is described by the helper reference", () => {
        expect(EXPRESSION_HELPERS.ref.params).toContain("field");
        expect(EXPRESSION_HELPERS.ref.summary).toContain("field");
    });
});
