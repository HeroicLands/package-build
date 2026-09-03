/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A homepage is addressed like every other note, so it **requires** a
 * `shortcode` and refuses only the field that still decides nothing (#182).
 *
 * It used to refuse `name`, `shortcode` and `id` alike (#53), and the reason
 * for two of the three was that a page's URL derived from `name.full` while a
 * homepage's destination was fixed — so a `shortcode` put the note in the
 * address index and `[[homepage-<shortcode>]]` resolved *green* to a page the
 * site build never wrote. A page's URL is now its address (#181), which makes
 * that address the one the build publishes. `id` stays refused on its own
 * unaffected ground: a homepage compiles into no compendium document.
 */

import { describe, it, expect } from "vitest";

import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
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

describe("a homepage is addressed, so `shortcode` is required (#182)", () => {
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
                    "aliases:",
                    "    - x",
                ],
                {
                    type: HOMEPAGE_TYPE,
                    shortcode: HOMEPAGE_SHORTCODE,
                    weight: 30,
                    aliases: ["x"],
                },
            ),
        ).toEqual([]);
    });
});
