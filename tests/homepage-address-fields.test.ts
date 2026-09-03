/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A homepage carries no address of its own, so it refuses the fields that would
 * decide one (#53).
 *
 * Every other note's URL derives from `name.full`, and its identity from
 * `(type, shortcode)`. The homepage is the one page for which neither is true:
 * it publishes at `/<package>/`, fixed by the package id. Ignoring the fields
 * silently left the author's mental model wrong, and it was not inert —
 * `shortcode` puts the note in the address index, so a wikilink to it resolves
 * green at build time to a page the site build never writes.
 */

import { describe, it, expect } from "vitest";

import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import {
    HOMEPAGE_REFUSED_FIELDS,
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

describe("the address-bearing fields a homepage refuses (#53)", () => {
    it("declares exactly the three fields that decide an address", () => {
        // A closed, named class — not "anything unrecognised". A homepage's
        // frontmatter is passed through to Hugo, so an unknown key may be a
        // theme parameter this build has never heard of.
        expect([...HOMEPAGE_REFUSED_FIELDS.keys()]).toEqual(["name", "shortcode", "id"]);
    });

    it("refuses `shortcode`, at the line and column it is written on", () => {
        const findings = lint([`type: ${HOMEPAGE_TYPE}`, "title: Repro", "shortcode: reprohome"], {
            type: HOMEPAGE_TYPE,
            title: "Repro",
            shortcode: "reprohome",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "assets/content/homepage.md",
            line: 4,
            column: 1,
            severity: "error",
        });
        // The reason, not merely the verdict: where this page actually is.
        expect(findings[0].message).toMatch(/`shortcode`/);
        expect(findings[0].message).toMatch(/\/<package>\//);
        // `file:line:column: severity: message`, the path first (#17).
        expect(formatDiagnostic(findings[0])).toMatch(
            /^assets\/content\/homepage\.md:4:1: error: /,
        );
    });

    it("refuses `id`, naming the document it would identify", () => {
        const findings = lint([`type: ${HOMEPAGE_TYPE}`, "id: aBcDeFgHiJkLmNoP"], {
            type: HOMEPAGE_TYPE,
            id: "aBcDeFgHiJkLmNoP",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ line: 3, severity: "error" });
        expect(findings[0].message).toMatch(/compiles into no .*document/);
    });

    it("refuses `name`, and says `title:` is the field that was meant", () => {
        const findings = lint([`type: ${HOMEPAGE_TYPE}`, "name:", "    full: Front Page"], {
            type: HOMEPAGE_TYPE,
            name: { full: "Front Page" },
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ line: 3, severity: "error" });
        expect(findings[0].message).toContain("`title:`");
    });

    it("refuses a bare `name:` string as well as `name.full`", () => {
        // `resolveName` reads either spelling, so refusing only the mapping
        // would leave the same mistake available one line shorter.
        const findings = lint([`type: ${HOMEPAGE_TYPE}`, "name: Front Page"], {
            type: HOMEPAGE_TYPE,
            name: "Front Page",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`name`/);
    });

    it("reports every one it finds, not the first", () => {
        const findings = checkHomepageAddressFields({
            type: HOMEPAGE_TYPE,
            name: { full: "Front Page" },
            shortcode: "reprohome",
            id: "aBcDeFgHiJkLmNoP",
        });
        expect(findings.map((f: any) => f.key)).toEqual(["name", "shortcode", "id"]);
    });

    it("refuses a field authored empty — presence is the whole test", () => {
        // `shortcode:` with no value still says "this page has an address".
        const findings = lint([`type: ${HOMEPAGE_TYPE}`, "shortcode:"], {
            type: HOMEPAGE_TYPE,
            shortcode: null,
        });
        expect(findings).toHaveLength(1);
    });
});

describe("what a homepage may still write", () => {
    it("passes the documented envelope", () => {
        expect(
            lint(
                [
                    `type: ${HOMEPAGE_TYPE}`,
                    "title: Repro Demo",
                    "description: A module.",
                    "banner: brand/banner.webp",
                    "landing:",
                    "    lead: Everything lives here.",
                ],
                {
                    type: HOMEPAGE_TYPE,
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
            lint([`type: ${HOMEPAGE_TYPE}`, "weight: 30", "cascade:", "    noindex: true"], {
                type: HOMEPAGE_TYPE,
                weight: 30,
                cascade: { noindex: true },
            }),
        ).toEqual([]);
    });

    it("leaves every other type alone", () => {
        // The three fields are how every other note is addressed; the rule is
        // about the one page whose address is not its own.
        expect(
            checkHomepageAddressFields({
                type: "doc",
                subType: "rules",
                shortcode: "combat",
                id: "aBcDeFgHiJkLmNoP",
                name: { full: "Combat" },
            }),
        ).toEqual([]);
        expect(checkHomepageAddressFields(undefined)).toEqual([]);
    });
});
