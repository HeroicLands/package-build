/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { dataFields, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { addressPositions, decodeNoteAddresses } from "../engine/note-addresses.mjs";
import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { infoboxesToHtml, infoboxesToTypst } from "../engine/infobox-render.mjs";

const fm = (data: object) => ({
    type: "affiliation",
    subType: "order",
    shortcode: "wardens",
    name: { full: "Wardens" },
    data: {
        governance: {
            ranks: [
                { level: 0, title: "Excluded", description: "Excluded." },
                { level: 1, title: "Member", description: "Belongs." },
            ],
        },
        ...data,
    },
});
const index = {
    contentPackage: "demo",
    types: new Set(Object.keys(NOTE_VOCABULARY)),
    packages: new Set(["demo"]),
    addressHit: (address: string) =>
        (
            [
                "demo-note-place-valley",
                "demo-note-place-town",
                "demo-note-affiliation-council",
            ].includes(address)
        ) ?
            { fm: {} }
        :   undefined,
};
const lint = (data: object) =>
    lintNote(
        {
            file: "wardens.md",
            type: "affiliation",
            fm: fm(data),
            raw: `---\n${YAML.stringify(fm(data))}---\n`,
        },
        { schemas: { affiliation: [] }, vocabulary: NOTE_VOCABULARY, index },
    );

describe("an affiliation's optional geographic activity", () => {
    it("declares range through the same Address vocabulary as seat", () => {
        const fields = dataFields("affiliation");
        const range = fields.find((field: any) => field.name === "range");
        const seat = fields.find((field: any) => field.name === "seat");
        expect(range).toMatchObject({
            kind: "list",
            entryKind: "address",
            ref: seat.ref,
            accepts: seat.accepts,
        });
        expect(addressPositions(fm({}))).toContainEqual(
            expect.objectContaining({
                path: ["data", "range"],
                shape: "list",
                type: "place",
                accepts: ["place"],
            }),
        );
    });

    it("accepts seatless ranges and keeps range optional", () => {
        for (const data of [
            {},
            { seat: "town" },
            { range: [] },
            { range: null },
            { range: ["valley", "place-town"] },
            { seat: null, range: ["valley"] },
        ]) {
            expect(lint(data)).toEqual([]);
        }
    });

    it.each([{ range: ["valley"] }, { range: [] }, { range: null }])(
        "rejects a range key beside a seat, even when empty: $range",
        ({ range }) => {
            const findings = lint({ seat: "town", range });
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({ file: "wardens.md", severity: "error" });
            expect(findings[0].message).toMatch(/range.*seat/);
            expect(findings[0].line).toBeGreaterThan(0);
        },
    );

    it("refuses non-place targets, unresolved places and a scalar range", () => {
        for (const type of Object.keys(NOTE_VOCABULARY).filter((type) => type !== "place")) {
            expect(lint({ range: [`${type}-valley`] }).length).toBeGreaterThan(0);
        }
        expect(
            lint({ range: ["place-missing"] })
                .map((finding: any) => finding.message)
                .join("\n"),
        ).toMatch(/does not resolve|no note|not found/);
        expect(
            lint({ range: "valley" })
                .map((finding: any) => finding.message)
                .join("\n"),
        ).toMatch(/list/);
    });

    it("renders an Active in line with place links on HTML and book surfaces", () => {
        const decoded = decodeNoteAddresses(fm({ range: ["valley", "town"] }), {
            package: "demo",
            system: "note",
        });
        const box = noteInfobox(decoded, {
            resolve: (ref: any) => ({
                name: ref.shortcode === "valley" ? "The Valley" : "Town",
                url: `/place-${ref.shortcode}/`,
            }),
        });
        const html = infoboxesToHtml([box]);
        expect(html).toContain("Active in");
        expect(html).toContain('<a href="/place-valley/">The Valley</a>');
        expect(html).toContain('<a href="/place-town/">Town</a>');
        expect(html).not.toContain("<dt>Seat</dt>");
        const typst = infoboxesToTypst([box], { link: (value: any) => `#link[${value.text}]` });
        expect(typst).toContain("Active in");
        expect(typst).toContain("#link[The Valley]");
        expect(infoboxesToHtml([noteInfobox(fm({}))])).not.toContain("Active in");
    });

    it("publishes typed places and exposes range in local and dependency SQL without changing parents", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "affiliation-range-"));
        try {
            const tree = path.join(dir, "content");
            fs.mkdirSync(tree);
            for (const note of [
                fm({ range: ["valley"], parents: ["council"] }),
                {
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "council",
                    name: { full: "Council" },
                },
                {
                    type: "place",
                    subType: "region",
                    shortcode: "valley",
                    name: { full: "The Valley" },
                },
            ]) {
                fs.writeFileSync(
                    path.join(tree, `${note.shortcode}.md`),
                    `---\n${YAML.stringify(note)}---\n\nProse.\n`,
                );
            }
            const records = collectContentIndex(tree, {
                contentPackage: "demo",
                skipDirectories: [],
            });
            const emitted = serializeContentIndex(records);
            const body = emitted
                .split("\n")
                .filter(Boolean)
                .map((line: string) => JSON.parse(line))
                .find((record: any) => record.shortcode === "wardens");
            expect(body.data.range).toEqual([
                { address: "demo-note-place-valley", anchor: null, anchorKind: null },
            ]);
            expect(body.data.parents).toEqual([
                { address: "demo-note-affiliation-council", anchor: null, anchorKind: null },
            ]);
            expect(body.data.seat).toBeUndefined();
            const file = path.join(dir, "demo-metadata.jsonl");
            fs.writeFileSync(file, emitted);
            for (const dependent of [false, true]) {
                const db = await openNotesDatabase(dependent ? [] : records, {
                    dir: path.join(dir, dependent ? "dependency" : "local"),
                    ...(dependent ? { dependencies: [{ id: "demo", file }] } : {}),
                });
                try {
                    const result = await runSqlQuery(
                        db,
                        `SELECT shortcode FROM ${dependent ? "demo.notes" : "notes"} WHERE list_contains(data.range, 'demo-note-place-valley')`,
                    );
                    expect(result.rows.map((row: any) => row.shortcode)).toEqual(["wardens"]);
                } finally {
                    await db.close();
                }
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
