// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { Journals } from "../engine/journals.mjs";
import { checkGovernment, checkHeld } from "../engine/holdings.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { decodeNoteAddresses, encodeAddresses } from "../engine/note-addresses.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { infoboxesToHtml, infoboxesToTypst } from "../engine/infobox-render.mjs";

function note(data: Record<string, unknown>, subType = "settlement") {
    return {
        file: "town.md",
        raw: "---\ntype: place\nsubType: settlement\nshortcode: town\ndata:\n    population: 100\n---\n",
        fm: { type: "place", subType, shortcode: "town", name: { full: "Town" }, data },
    };
}

describe("explicit place government", () => {
    it.each(["settlement", "site", "structure", "feature", "region", "world"])(
        "uses population for %s",
        (subType) => {
            for (const population of [undefined, null, 0]) {
                expect(checkGovernment(note({ population }, subType))).toEqual([]);
            }
            const populated = note({ population: 100 }, subType);
            expect(checkGovernment(populated)).toMatchObject([{ severity: "warning", line: 6 }]);
            expect(checkGovernment(note({ population: 100, government: null }, subType))).toEqual(
                [],
            );
            expect(
                checkGovernment(note({ population: 100, government: "council" }, subType)),
            ).toEqual([]);
            expect(NOTE_VOCABULARY.place.check?.(populated, {})).toEqual(
                checkGovernment(populated),
            );
            expect(checkHeld(populated)).toEqual(checkGovernment(populated));
        },
    );

    it.each(["", 42, [], {}, "missing", "demo-note-place-town"].map((value) => [value]))(
        "rejects invalid government %j",
        (government) => {
            const findings = lintNote(note({ population: 100, government }), {
                vocabulary: NOTE_VOCABULARY,
                schemas: ENGINE_NOTE_SCHEMAS,
                index: { contentPackage: "demo", addressHit: () => null } as any,
            });
            expect(
                findings.filter((f) => f.severity === "error" && f.message.includes("government")),
            ).not.toEqual([]);
        },
    );

    it.each(["council", "foreign-note-affiliation-council"])(
        "accepts a resolved affiliation %s",
        (government) => {
            const findings = lintNote(note({ population: 100, government }), {
                vocabulary: NOTE_VOCABULARY,
                schemas: ENGINE_NOTE_SCHEMAS,
                index: {
                    contentPackage: "demo",
                    addressHit: () => ({ type: "affiliation" }),
                } as any,
            });
            expect(findings.filter((f) => f.message.includes("government"))).toEqual([]);
        },
    );

    it("retains omitted, null and addressed values through address serialization", () => {
        for (const data of [{}, { government: null }, { government: "council" }]) {
            const fm = note(data).fm;
            decodeNoteAddresses(fm, { package: "demo" });
            const encoded = encodeAddresses(fm);
            expect(Object.hasOwn(encoded.data, "government")).toBe(
                Object.hasOwn(data, "government"),
            );
            if (Object.hasOwn(data, "government"))
                expect(encoded.data.government).toBe(
                    data.government === null ? null : "demo-note-affiliation-council",
                );
        }
    });

    it("preserves anarchy and omitted government in compiled Foundry journal properties", () => {
        for (const data of [{ government: null }, {}]) {
            const compiled = Journals.prototype.buildEntry.call(
                { folderResolver: () => null, linkIndex: undefined, router: undefined, stats: {} },
                { ...note(data).fm, id: "0123456789abcdef" },
                "Authored prose.",
            );
            const properties = compiled.pages.find((page) => page.name === "Properties Infobox");
            expect(properties).toBeDefined();
            expect(properties.text.content.includes("Complete anarchy")).toBe(
                Object.hasOwn(data, "government"),
            );
        }
    });

    it("shows complete anarchy in shared Foundry/site and book infoboxes", () => {
        const box = noteInfobox(note({ government: null }).fm);
        expect(infoboxesToHtml([box])).toContain("Complete anarchy");
        expect(infoboxesToTypst([box])).toContain("Complete anarchy");
        expect(infoboxesToHtml([noteInfobox(note({}).fm)])).not.toContain("Government");
    });
});
