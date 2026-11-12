/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { indexRecordsFor, serializeContentIndex } from "../engine/content-index.mjs";
import { derivedSections } from "../engine/derived-sections.mjs";
import { officeHolders } from "../engine/office-holders.mjs";

const note = (fm: object, body = "Written.") => `---\n${YAML.stringify(fm)}---\n\n${body}\n`;

const crown = (offices: object = {}) =>
    note({
        type: "affiliation",
        subType: "polity",
        shortcode: "crown",
        name: { full: "The Crown" },
        data: {
            governance: {
                ranks: [
                    { level: 0, title: "Outlaw", description: "Cast out." },
                    { level: 1, title: "Subject", description: "Of the realm." },
                ],
                offices: {
                    King: "Rules the realm.",
                    Chancellor: "Keeps the seal.",
                    Treasurer: "Keeps the tally.",
                    Herald: "Cries the news.",
                    ...offices,
                },
            },
        },
    });

const being = (shortcode: string, full: string, standing: object, data: object = {}) =>
    note({
        type: "being",
        subType: "npc",
        shortcode,
        name: { full },
        data: { archetypes: ["Ruler"], affiliations: { crown: standing }, ...data },
    });

const realm = () => ({
    "Crown.md": crown(),
    "Aldwyn.md": being("aldwyn", "Aldwyn", { rank: 1, office: "King" }),
    "Beren.md": being("beren", "Beren", { rank: 1, office: ["Chancellor", "Treasurer"] }),
    "Cadoc.md": being("cadoc", "Cadoc", { rank: 1, office: "Treasurer" }),
    "Old King.md": being("oldking", "Old King", { rank: 1, office: "King" }, { died: "690" }),
    "Dunstan.md": being("dunstan", "Dunstan", { rank: 1 }),
});

function withTree<T>(files: Record<string, string>, run: (root: string) => T): T {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-officeholders-"));
    try {
        for (const [file, raw] of Object.entries(files))
            fs.writeFileSync(path.join(root, file), raw);
        return run(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const recordsOf = (root: string) => indexRecordsFor({ contentBase: root, skipDirectories: [] });

describe("an office's holders are derived from the beings that hold it", () => {
    it("lists the living beings naming each declared office, in the body's order", () =>
        withTree(realm(), (root) => {
            const holders = officeHolders(recordsOf(root)).get("sohl-affiliation-crown");
            expect(
                [...holders!.entries()].map(([office, beings]) => [
                    office,
                    beings.map((record: any) => record.shortcode),
                ]),
            ).toEqual([
                ["King", ["aldwyn"]],
                ["Chancellor", ["beren"]],
                ["Treasurer", ["beren", "cadoc"]],
            ]);
        }));

    it("indexes appointed holders beside ranked holders and keeps deceased holders historical", () =>
        withTree(
            {
                ...realm(),
                "Aldwyn.md": being("aldwyn", "Aldwyn", { office: "King" }),
                "Old King.md": being("oldking", "Old King", { office: "King" }, { died: "690" }),
            },
            (root) => {
                const records = recordsOf(root);
                const holders = officeHolders(records).get("sohl-affiliation-crown");
                expect(holders!.get("King")!.map((record: any) => record.shortcode)).toEqual([
                    "aldwyn",
                ]);
                expect(holders!.get("Treasurer")!.map((record: any) => record.shortcode)).toEqual([
                    "beren",
                    "cadoc",
                ]);
                const published = serializeContentIndex(records)
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line));
                const appointed = published.find(
                    (record) => record.shortcode === "aldwyn" && !record.documents,
                );
                expect(appointed.data.affiliations["sohl-note-affiliation-crown"]).toEqual({
                    office: "King",
                });
                const historical = published.find(
                    (record) => record.shortcode === "oldking" && !record.documents,
                );
                expect(historical.data.died).toBeDefined();
            },
        ));

    it("shows them on the body's page as a generated section, a vacant office omitted", () =>
        withTree(realm(), (root) => {
            const sections = derivedSections(recordsOf(root), {
                fileOf: (record: any) => path.join(root, record.file.path),
            });
            const shown = sections.get(path.join(root, "Crown.md"))?.get("officeholders");
            expect(shown).toBe(
                [
                    "# Office holders {#officeholders}",
                    "",
                    "- **King:** [[sohl-note-being-aldwyn|]]",
                    "- **Chancellor:** [[sohl-note-being-beren|]]",
                    "- **Treasurer:** [[sohl-note-being-beren|]], [[sohl-note-being-cadoc|]]",
                    "",
                ].join("\n"),
            );
            expect(shown).not.toContain("Herald");
            expect(shown).not.toContain("oldking");
        }));

    it("gives no section to a body whose offices nobody living holds", () =>
        withTree(
            {
                "Crown.md": crown(),
                "Old King.md": being(
                    "oldking",
                    "Old King",
                    { rank: 1, office: "King" },
                    {
                        died: "690",
                    },
                ),
            },
            (root) => {
                const sections = derivedSections(recordsOf(root), {
                    fileOf: (record: any) => path.join(root, record.file.path),
                });
                expect(sections.get(path.join(root, "Crown.md"))?.has("officeholders")).toBeFalsy();
            },
        ));

    it("carries them in the content index, each holder an Address", () =>
        withTree(realm(), (root) => {
            const lines = serializeContentIndex(recordsOf(root))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            const body = lines.find(
                (r) => r.shortcode === "crown" && r.type === "affiliation" && !r.documents,
            );
            expect(body.officeHolders).toEqual([
                {
                    office: "King",
                    holders: [expect.objectContaining({ address: "sohl-note-being-aldwyn" })],
                },
                {
                    office: "Chancellor",
                    holders: [expect.objectContaining({ address: "sohl-note-being-beren" })],
                },
                {
                    office: "Treasurer",
                    holders: [
                        expect.objectContaining({ address: "sohl-note-being-beren" }),
                        expect.objectContaining({ address: "sohl-note-being-cadoc" }),
                    ],
                },
            ]);
            const aldwyn = lines.find((r) => r.shortcode === "aldwyn" && !r.documents);
            expect(aldwyn.officeHolders).toBeUndefined();
        }));

    it("refuses an authored officeHolders key, which the index derives", () =>
        withTree(
            {
                ...realm(),
                "Crown.md": crown().replace(
                    "type: affiliation",
                    "officeHolders: []\ntype: affiliation",
                ),
            },
            (root) =>
                expect(() => recordsOf(root)).toThrow(
                    /officeHolders.*derived by the content index/,
                ),
        ));

    it("reports an office a being names that the body does not declare", () =>
        withTree(
            {
                ...realm(),
                "Eadric.md": being("eadric", "Eadric", { rank: 1, office: ["King", "Admiral"] }),
            },
            (root) => {
                const { findings } = lintFrontmatter(
                    buildLinkIndex(root, { skipDirectories: [] }),
                    {
                        schemas: NOTE_SCHEMAS as never,
                        vocabulary: NOTE_VOCABULARY,
                    },
                );
                const named = findings.filter((f) => f.message.includes("Admiral"));
                expect(named).toHaveLength(1);
                expect(named[0].file).toBe(path.join(root, "Eadric.md"));
                expect(named[0].message).toMatch(/office "Admiral" is not an office/);
                const raw = fs.readFileSync(path.join(root, "Eadric.md"), "utf8").split("\n");
                expect(raw[named[0].line! - 1].slice(named[0].column! - 1)).toMatch(/^Admiral/);
            },
        ));
});

describe("a unique item is linked to the places and beings involved", () => {
    const item = (body: string, data: object = { kind: "miscgear", unique: true }) =>
        note({ type: "miscgear", shortcode: "hammer", name: { full: "Joe's Hammer" }, data }, body);
    const lint = (files: Record<string, string>) =>
        withTree(
            {
                "Joe.md": note({
                    type: "being",
                    subType: "npc",
                    shortcode: "joe",
                    name: { full: "Joe" },
                    data: { archetypes: ["Ruler"] },
                }),
                "Tomb.md": note({
                    type: "place",
                    subType: "site",
                    shortcode: "tomb",
                    name: { full: "The Tomb" },
                }),
                ...files,
            },
            (root) => {
                const { findings } = lintFrontmatter(
                    buildLinkIndex(root, { skipDirectories: [] }),
                    {
                        schemas: NOTE_SCHEMAS as never,
                        vocabulary: NOTE_VOCABULARY,
                    },
                );
                return findings
                    .filter((f) => f.file === path.join(root, "Hammer.md"))
                    .map((f) => ({ line: f.line, severity: f.severity, message: f.message }));
            },
        );

    it("accepts a unique item whose note links a being or a place", () => {
        expect(lint({ "Hammer.md": item("Forged for [[being-joe|Joe]].") })).toEqual([]);
        expect(lint({ "Hammer.md": item("It lies in [[place-tomb|the tomb]].") })).toEqual([]);
    });

    it("reports a unique item whose note links no place or being, at the key", () => {
        const found = lint({ "Hammer.md": item("Nobody knows where it went.") });
        expect(found).toEqual([
            {
                line:
                    item("")
                        .split("\n")
                        .findIndex((l) => l.includes("unique:")) + 1,
                severity: "error",
                message: expect.stringMatching(/unique item links no place or being/),
            },
        ]);
    });

    it("asks nothing of a common item", () => {
        expect(lint({ "Hammer.md": item("Ten feet of rope.", { kind: "miscgear" }) })).toEqual([]);
    });

    it("takes `true` alone, and only on gear", () => {
        expect(
            lint({
                "Hammer.md": item("Forged for [[being-joe|Joe]].", {
                    kind: "miscgear",
                    unique: "yes",
                }),
            }),
        ).toEqual([expect.objectContaining({ message: expect.stringMatching(/unique/) })]);
        const place = withTree(
            {
                "Tomb.md": note({
                    type: "place",
                    subType: "site",
                    shortcode: "tomb",
                    name: { full: "The Tomb" },
                    data: { unique: true },
                }),
            },
            (root) =>
                lintFrontmatter(buildLinkIndex(root, { skipDirectories: [] }), {
                    schemas: NOTE_SCHEMAS as never,
                    vocabulary: NOTE_VOCABULARY,
                }).findings,
        );
        expect(place.some((f) => /unique/.test(f.message))).toBe(true);
    });
});
