/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A homepage is addressed like every other note, so it **requires** a
 * `shortcode` and refuses only the field that still decides nothing.
 *
 * It used to refuse `name`, `shortcode` and `id` alike, and the reason
 * for two of the three was that a page's URL derived from `name.full` while a
 * homepage's destination was fixed — so a `shortcode` put the note in the
 * address index and `[[homepage-<shortcode>]]` resolved *green* to a page the
 * site build never wrote. A page's URL is now its address, which makes
 * that address the one the build publishes. `id` stays refused on its own
 * unaffected ground: a homepage compiles into no compendium document.
 */

import { describe, it, expect } from "vitest";

import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { resolveNoteId } from "../engine/note-ids.mjs";
import {
    HOMEPAGE_REFUSED_FIELDS,
    HOMEPAGE_SHORTCODE,
    HOMEPAGE_TYPE,
    checkHomepageAddressFields,
} from "../engine/homepage.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";

/** A note in the shape the link index hands the frontmatter lint. */
function note(lines: string[], fm: Record<string, unknown>) {
    return {
        fm,
        file: "assets/content/homepage.md",
        raw: ["---", ...lines, "---", "", "Prose.", ""].join("\n"),
    } as any;
}

/** Lint a homepage note against the engine schemas alone. */
function lint(lines: string[], fm: Record<string, unknown>) {
    return lintNote(note(lines, fm), { schemas: ENGINE_NOTE_SCHEMAS }) as any[];
}

describe("a homepage is addressed, so `shortcode` is required", () => {
    it("conventionally addresses the package landing as `homepage-root`", () => {
        expect(HOMEPAGE_SHORTCODE).toBe("root");
    });

    it("refuses a homepage that declares none, located at its `type:` value", () => {
        // There is no `shortcode:` line to point at, so the locator is the
        // `homepage` value that makes one required — a real position, rather
        // than a 1:1 invented for a key that is not there.
        const findings = lint(["title: Repro", `type: ${HOMEPAGE_TYPE}`], {
            title: "Repro",
            type: HOMEPAGE_TYPE,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "assets/content/homepage.md",
            line: 3,
            column: 7,
            severity: "error",
        });
        expect(findings[0].message).toContain("`shortcode`");
        // Names the address it would publish at, and the convention to write.
        expect(findings[0].message).toContain("homepage-root");
        expect(formatDiagnostic(findings[0])).toMatch(
            /^assets\/content\/homepage\.md:3:7: error: /,
        );
    });

    it("refuses one authored empty — a blank shortcode is no address", () => {
        const findings = lint([`type: ${HOMEPAGE_TYPE}`, "shortcode:"], {
            type: HOMEPAGE_TYPE,
            shortcode: null,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`shortcode`");
    });

    it("accepts a shortcode, and says nothing about it", () => {
        expect(
            lint([`type: ${HOMEPAGE_TYPE}`, `shortcode: ${HOMEPAGE_SHORTCODE}`], {
                type: HOMEPAGE_TYPE,
                shortcode: HOMEPAGE_SHORTCODE,
            }),
        ).toEqual([]);
    });

    it("accepts any shortcode: `root` is a convention, not a rule", () => {
        // The address only has to be unique within the package, and nothing
        // here knows better than an author what their landing is called.
        expect(
            lint([`type: ${HOMEPAGE_TYPE}`, "shortcode: front"], {
                type: HOMEPAGE_TYPE,
                shortcode: "front",
            }),
        ).toEqual([]);
    });

    it("permits `name`, which titles the page like every other note's", () => {
        expect(
            lint(
                [
                    `type: ${HOMEPAGE_TYPE}`,
                    `shortcode: ${HOMEPAGE_SHORTCODE}`,
                    "name:",
                    "    full: Kethira Basic",
                ],
                {
                    type: HOMEPAGE_TYPE,
                    shortcode: HOMEPAGE_SHORTCODE,
                    name: { full: "Kethira Basic" },
                },
            ),
        ).toEqual([]);
    });

    it("says nothing about any other type — the rule is the homepage's", () => {
        expect(
            checkHomepageAddressFields({ type: "doc", subType: "rules", shortcode: "combat" }),
        ).toEqual([]);
        // A `doc` with no shortcode is reported by the address derivation, not
        // by this rule.
        expect(checkHomepageAddressFields({ type: "doc", subType: "rules" })).toEqual([]);
        expect(checkHomepageAddressFields(undefined)).toEqual([]);
    });
});

describe("the one field a homepage still refuses (#53, narrowed by #182)", () => {
    it("refuses `id` and nothing else", () => {
        expect([...HOMEPAGE_REFUSED_FIELDS.keys()]).toEqual(["id"]);
    });

    it("refuses `id`, naming the document it would identify", () => {
        const findings = lint(
            [`type: ${HOMEPAGE_TYPE}`, `shortcode: ${HOMEPAGE_SHORTCODE}`, "id: aBcDeFgHiJkLmNoP"],
            {
                type: HOMEPAGE_TYPE,
                shortcode: HOMEPAGE_SHORTCODE,
                id: "aBcDeFgHiJkLmNoP",
            },
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ line: 4, column: 1, severity: "error" });
        expect(findings[0].message).toMatch(/compiles into no .*document/);
    });

    it("reports the missing shortcode first, then what was authored", () => {
        // Both findings stand: one field is owed and another may not be
        // written, and neither answers the other.
        const findings = checkHomepageAddressFields({
            type: HOMEPAGE_TYPE,
            id: "aBcDeFgHiJkLmNoP",
        });
        expect(findings.map((f: any) => f.field)).toEqual(["shortcode", "id"]);
    });
});

describe("what a homepage may still write", () => {
    it("passes the documented envelope", () => {
        expect(
            lint(
                [
                    `type: ${HOMEPAGE_TYPE}`,
                    `shortcode: ${HOMEPAGE_SHORTCODE}`,
                    "title: Repro Demo",
                    "description: A module.",
                    "banner: brand/banner.webp",
                    "landing:",
                    "    lead: Everything lives here.",
                ],
                {
                    type: HOMEPAGE_TYPE,
                    shortcode: HOMEPAGE_SHORTCODE,
                    title: "Repro Demo",
                    description: "A module.",
                    banner: "brand/banner.webp",
                    landing: { lead: "Everything lives here." },
                },
            ),
        ).toEqual([]);
    });

    it("passes a top-level key this build has never heard of", () => {
        // The deliberate boundary, and the reason the refusal is a named class
        // rather than an allow-list: a homepage's frontmatter is emitted into
        // the published page, so an unrecognised key is a theme parameter, and
        // a closed list would make every new one a package-build release.
        expect(
            lint(
                [
                    `type: ${HOMEPAGE_TYPE}`,
                    `shortcode: ${HOMEPAGE_SHORTCODE}`,
                    "weight: 30",
                    "cascade:",
                    "    noindex: true",
                ],
                {
                    type: HOMEPAGE_TYPE,
                    shortcode: HOMEPAGE_SHORTCODE,
                    weight: 30,
                    cascade: { noindex: true },
                },
            ),
        ).toEqual([]);
    });
});

/* --------------------------------------------------------------------- */
/*  A derived id is not an authored one                            */
/* --------------------------------------------------------------------- */

describe("the refusal tests what the note wrote, not what the pipeline added", () => {
    /** A homepage note authoring no `id`, as every homepage in the corpus does. */
    const NOTE = [
        "---",
        "type: homepage",
        "shortcode: sohl",
        "title: Song of Heroic Lands",
        "---",
        "",
        "The landing page.",
        "",
    ].join("\n");

    const lint = (raw: string, fm: object) =>
        lintNote({ file: "/tree/homepage.md", type: "homepage", raw, fm }, {
            schemas: {} as any,
            references: false,
        } as any).filter((f: any) => /`id` decides nothing/.test(f.message));

    it("says nothing when the id was derived rather than authored", () => {
        // `resolveNoteId` fills `fm.id` **in place** so every downstream reader
        // sees one value — deliberately, and documented as such. The refusal
        // iterated the same object, so it reported a field the author never
        // wrote and told them to delete something that is not there.
        const fm = { type: "homepage", shortcode: "sohl", title: "Song of Heroic Lands" };
        resolveNoteId(fm as any, { pkg: "sohl" });
        expect(lint(NOTE, fm)).toEqual([]);
    });

    it("still refuses an id the note actually authored", () => {
        const raw = NOTE.replace("shortcode: sohl", "shortcode: sohl\nid: AAAAAAAAAAAAAAAA");
        const fm = {
            type: "homepage",
            shortcode: "sohl",
            id: "AAAAAAAAAAAAAAAA",
            title: "Song of Heroic Lands",
        };
        const findings = lint(raw, fm);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
    });

    it("does not mistake a nested `id:` for a top-level one", () => {
        // `name: { id: … }` is a different key; only column 1 is the note's own.
        const raw = NOTE.replace("title: Song of Heroic Lands", "name:\n  id: nested");
        const fm = { type: "homepage", shortcode: "sohl", name: { id: "nested" } };
        resolveNoteId(fm as any, { pkg: "sohl" });
        expect(lint(raw, fm)).toEqual([]);
    });
});
