/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { decodeNoteAddresses, encodeAddresses } from "../engine/note-addresses.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { Journals } from "../engine/journals.mjs";

const context = { package: "demo", system: "note" };
const targets = new Map([
    ["demo-note-lore-other", { name: "Other", uuid: "Compendium.demo.journals.other" }],
    ["foreign-note-lore-away", { name: "Away", uuid: "Compendium.foreign.journals.away" }],
    ["demo-note-lore-self", { name: "Self", uuid: "Compendium.demo.journals.self" }],
]);
const index = {
    contentPackage: "demo",
    packages: new Set(["demo", "foreign"]),
    types: new Set(Object.keys(NOTE_VOCABULARY)),
    referenceTargets: targets,
    addressHit: (key: string) => targets.get(key),
};
function check(entries: unknown[]) {
    const fm = { type: "lore", shortcode: "self", data: { seeAlso: entries } };
    const raw = `---\n${stringify(fm)}---\n`;
    return {
        raw,
        findings: lintNote(
            { file: "note.md", fm, raw },
            {
                schemas: ENGINE_NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                addressContext: context,
                index,
            },
        ).filter((f: any) => f.message.includes("seeAlso")),
    };
}

describe("see-also references", () => {
    it("declares and round-trips the nested Address on every note type", () => {
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            expect(dataFields(type).some((f: any) => f.name === "seeAlso")).toBe(true);
            const fm = decodeNoteAddresses(
                {
                    type,
                    data: {
                        seeAlso: [
                            { address: "lore-other", gloss: "Background" },
                            { address: "foreign-note-lore-away" },
                        ],
                    },
                },
                context,
            );
            expect(fm.data.seeAlso[0].address).toMatchObject({
                package: "demo",
                type: "lore",
                shortcode: "other",
            });
            expect(encodeAddresses(fm).data.seeAlso).toEqual([
                { address: "demo-note-lore-other", gloss: "Background" },
                { address: "foreign-note-lore-away" },
            ]);
        }
    });
    it("accepts optional glosses and declared dependency references", () => {
        expect(
            check([
                { address: "lore-other", gloss: "Background" },
                { address: "foreign-note-lore-away" },
            ]).findings,
        ).toEqual([]);
        expect(check([]).findings).toEqual([]);
    });
    it("locates unresolved, duplicate and self references at their addresses", () => {
        const { raw, findings } = check([
            { address: "lore-missing" },
            { address: "lore-other" },
            { address: "demo-note-lore-other" },
            { address: "lore-self" },
        ]);
        expect(findings).toHaveLength(3);
        for (const [value, reason] of [
            ["lore-missing", "does not resolve"],
            ["demo-note-lore-other", "duplicate"],
            ["lore-self", "itself"],
        ]) {
            const finding = findings.find((f: any) => f.message.includes(reason));
            expect(finding).toBeDefined();
            expect(raw.split("\n")[finding.line - 1].slice(finding.column - 1)).toBe(value);
        }
    });
    it.each([
        [null],
        [{}],
        [{ address: "lore-other", gloss: 4 }],
        [{ address: "lore-other", extra: true }],
        ["lore-other"],
        [{ address: "lore-other#heading" }],
        [{ address: "icon-anvil" }],
        [{ address: "other" }],
    ])("refuses malformed entries %j", (...entries) => {
        expect(check(entries).findings.length).toBeGreaterThan(0);
    });
    it("checks raw addresses using lint defaults when no index is supplied", () => {
        const fm = {
            type: "lore",
            shortcode: "self",
            data: { seeAlso: [{ address: "lore-other" }] },
        };
        expect(
            lintNote(
                { file: "note.md", fm },
                {
                    schemas: ENGINE_NOTE_SCHEMAS,
                    vocabulary: NOTE_VOCABULARY,
                    addressContext: context,
                },
            ),
        ).toEqual([]);
    });
    it("appends ordered Foundry links and glosses only for a nonempty list", () => {
        const compiler = { folderResolver: () => null, linkIndex: index };
        const entry = (seeAlso?: unknown[]) =>
            Journals.prototype.buildEntry.call(
                compiler,
                {
                    type: "lore",
                    id: "0123456789abcdef",
                    name: { full: "Self" },
                    data: { seeAlso },
                },
                "The body.",
            );
        const withLinks = entry([
            { address: "foreign-note-lore-away", gloss: "The wider setting" },
            { address: "lore-other" },
        ]);
        const html = withLinks.pages.map((p: any) => p.text?.content ?? "").join("\n");
        expect(withLinks.pages.some((p: any) => p.name === "See also")).toBe(true);
        expect(html).toContain("@UUID[Compendium.foreign.journals.away]{Away}");
        expect(html).toContain("The wider setting");
        expect(html.indexOf("{Away}")).toBeLessThan(html.indexOf("{Other}"));
        for (const empty of [undefined, []])
            expect(entry(empty).pages.some((p: any) => p.name === "See also")).toBe(false);
    });
});
