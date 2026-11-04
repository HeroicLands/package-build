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
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { derivedSections, PLACE_KIND_LABELS } from "../engine/derived-sections.mjs";

const note = (fm: object, body = "Written.") => `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
const place = (shortcode: string, subType: string, data: object = {}) =>
    note({ type: "place", subType, shortcode, name: { full: shortcode }, data });

const world = () => ({
    "Vale.md": place("vale", "region"),
    "Ashford.md": place("ashford", "settlement", { parents: ["vale"] }),
    "Barrow.md": place("barrow", "site", { parents: ["vale"] }),
    "Council.md": note({
        type: "affiliation",
        subType: "governmental",
        shortcode: "council",
        name: { full: "Ward Council" },
    }),
});

function lint(files: Record<string, string>, file: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-districts-"));
    try {
        for (const [name, raw] of Object.entries(files))
            fs.writeFileSync(path.join(root, name), raw);
        const { findings } = lintFrontmatter(buildLinkIndex(root, { skipDirectories: [] }), {
            schemas: ENGINE_NOTE_SCHEMAS as never,
            vocabulary: NOTE_VOCABULARY,
        });
        const raw = files[file].split("\n");
        return findings
            .filter((f) => f.file === path.join(root, file))
            .map((f) => ({ ...f, text: raw[f.line! - 1] }));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe("place/district", () => {
    it("is a place subtype, grouped under its own heading", () => {
        expect(NOTE_VOCABULARY.place.subTypes).toEqual(
            expect.arrayContaining(["district", "route"]),
        );
        expect(PLACE_KIND_LABELS.district).toBe("Districts");
        expect(PLACE_KIND_LABELS.route).toBe("Routes");
    });

    it("stands within a settlement or a region, and may name its own government", () => {
        for (const parent of ["ashford", "vale"])
            expect(
                lint(
                    {
                        ...world(),
                        "Ward.md": place("ward", "district", {
                            parents: [parent],
                            government: "council",
                        }),
                    },
                    "Ward.md",
                ),
            ).toEqual([]);
    });

    it("is reported where it names no parent", () => {
        const found = lint({ ...world(), "Ward.md": place("ward", "district") }, "Ward.md");
        expect(found).toHaveLength(1);
        expect(found[0].severity).toBe("error");
        expect(found[0].message).toMatch(/district.*settlement or a region/);
        expect(found[0].text).toMatch(/^subType: district/);
    });

    it("is reported, at its parents, where none is a settlement or a region", () => {
        const found = lint(
            { ...world(), "Ward.md": place("ward", "district", { parents: ["barrow"] }) },
            "Ward.md",
        );
        expect(found).toHaveLength(1);
        expect(found[0].message).toMatch(/district.*settlement or a region/);
        expect(found[0].text).toMatch(/parents:/);
    });

    it("is listed within its parent and under the government it names", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-districts-"));
        try {
            const files = {
                ...world(),
                "Ward.md": place("ward", "district", {
                    parents: ["ashford"],
                    government: "council",
                }),
            };
            for (const [name, raw] of Object.entries(files))
                fs.writeFileSync(path.join(root, name), raw);
            const sections = derivedSections(
                indexRecordsFor({ contentBase: root, skipDirectories: [] }),
                { fileOf: (record: any) => path.join(root, record.file.path) },
            );
            expect(sections.get(path.join(root, "Ashford.md"))?.get("within")).toContain(
                "**Districts:** [[sohl-note-place-ward|]]",
            );
            expect(sections.get(path.join(root, "Ward.md"))?.get("governedby")).toContain(
                "[[sohl-note-affiliation-council|]]",
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("place/route", () => {
    const routes = [{ to: "ashford", bearing: "N", mode: "land", days: 2 }];

    it("carries its journeys in data.routes", () =>
        expect(
            lint(
                {
                    ...world(),
                    "Ashford.md": place("ashford", "settlement", {
                        parents: ["vale"],
                        routes: [{ to: "road", bearing: "S", mode: "land", days: 2 }],
                    }),
                    "Road.md": place("road", "route", { parents: ["vale"], routes }),
                },
                "Road.md",
            ),
        ).toEqual([]));

    it("is reported where it states no journey", () => {
        const found = lint(
            { ...world(), "Road.md": place("road", "route", { parents: ["vale"] }) },
            "Road.md",
        );
        expect(found).toHaveLength(1);
        expect(found[0].message).toMatch(/route.*data\.routes/);
        expect(found[0].text).toMatch(/^subType: route/);
    });
});

describe("a district without its own government falls under its parent's", () => {
    const tree = (ward: object) => ({
        "Vale.md": place("vale", "region"),
        "City.md": place("city", "settlement", {
            parents: ["vale"],
            population: 12000,
            government: "council",
        }),
        "Council.md": note({
            type: "affiliation",
            subType: "governmental",
            shortcode: "council",
            name: { full: "City Council" },
        }),
        "Guild.md": note({
            type: "affiliation",
            subType: "guild",
            shortcode: "guild",
            name: { full: "Wardens' Guild" },
        }),
        "Ward.md": place("ward", "district", { parents: ["city"], population: 3000, ...ward }),
    });

    function collected(files: Record<string, string>) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-district-gov-"));
        try {
            for (const [name, raw] of Object.entries(files))
                fs.writeFileSync(path.join(root, name), raw);
            const records = indexRecordsFor({ contentBase: root, skipDirectories: [] });
            const ward = records.find((r: any) => r.shortcode === "ward" && !r.documents);
            const sections = derivedSections(records, {
                fileOf: (record: any) => path.join(root, record.file.path),
            });
            const { findings } = lintFrontmatter(buildLinkIndex(root, { skipDirectories: [] }), {
                schemas: ENGINE_NOTE_SCHEMAS as never,
                vocabulary: NOTE_VOCABULARY,
            });
            return {
                government: ward.data.government,
                hasGovernment: Object.hasOwn(ward.data, "government"),
                governedBy: sections.get(path.join(root, "Ward.md"))?.get("governedby") ?? "",
                councilGoverns:
                    sections.get(path.join(root, "Council.md"))?.get("governedplaces") ?? "",
                guildGoverns:
                    sections.get(path.join(root, "Guild.md"))?.get("governedplaces") ?? "",
                wardFindings: findings
                    .filter((f) => f.file === path.join(root, "Ward.md"))
                    .map((f) => f.message),
            };
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }

    it("takes the nearest parent's government where it states none", () => {
        const got = collected(tree({}));
        expect(got.government).toMatchObject({ type: "affiliation", shortcode: "council" });
        expect(got.governedBy).toContain("[[sohl-note-affiliation-council|]]");
        expect(got.councilGoverns).toContain("[[sohl-note-place-city|]]");
        expect(got.councilGoverns).toContain("[[sohl-note-place-ward|]]");
        expect(got.wardFindings).toEqual([]);
    });

    it("keeps its own government where it names one", () => {
        const got = collected(tree({ government: "guild" }));
        expect(got.government).toMatchObject({ shortcode: "guild" });
        expect(got.governedBy).toContain("[[sohl-note-affiliation-guild|]]");
        expect(got.guildGoverns).toContain("[[sohl-note-place-ward|]]");
        expect(got.councilGoverns).not.toContain("ward");
        expect(got.wardFindings).toEqual([]);
    });

    it("keeps an explicit null, complete anarchy, over its parent's", () => {
        const got = collected(tree({ government: null }));
        expect(got.hasGovernment).toBe(true);
        expect(got.government).toBeNull();
        expect(got.governedBy).toBe("");
        expect(got.councilGoverns).not.toContain("ward");
        expect(got.wardFindings).toEqual([]);
    });

    it("still advises a populated place that is not a district and names no government", () => {
        const files = tree({});
        files["Ward.md"] = place("ward", "settlement", { parents: ["city"], population: 3000 });
        expect(collected(files).wardFindings).toEqual([
            expect.stringMatching(/^missing government/),
        ]);
    });
});
