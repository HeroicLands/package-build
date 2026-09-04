/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A published page's URL is its address (#181).
 *
 * The rule under test is `/<package>/<type>-<shortcode>/`. What matters is not
 * the spelling but its three properties, and each is asserted here rather than
 * assumed: it is **unique by construction**, so no check stands behind it; it
 * takes **nothing from a display name**, so a rename moves no URL; and it is
 * **derivable from the canonical key**, so the link manifest transports an
 * address rather than inventing one.
 */

import { describe, it, expect } from "vitest";

import {
    addressSlug,
    contentAddress,
    packageAddress,
    sectionOf,
} from "../engine/content-address.mjs";
import { canonicalKey } from "../engine/kb-manifest.mjs";

describe("addressSlug", () => {
    it("is the note's type and shortcode, hyphen-separated", () => {
        expect(addressSlug({ type: "weapongear", shortcode: "dagger" })).toBe("weapongear-dagger");
        expect(addressSlug({ type: "doc", shortcode: "combat" })).toBe("doc-combat");
    });

    it("lowercases, so it is the tail of the canonical key", () => {
        // `canonicalKey` lowercases too, which is what lets a consumer derive
        // the address from the key it looked the entry up by.
        const fm = { type: "weapongear", shortcode: "Taburi" };
        const key = canonicalKey("sohl", fm.type, fm.shortcode);
        expect(key).toBe(`sohl-${addressSlug(fm)}`);
    });

    it("refuses a note with no shortcode, naming what an address looks like", () => {
        expect(() => addressSlug({ type: "skill" })).toThrow(/no shortcode/);
        expect(() => addressSlug({ type: "skill", shortcode: "  " })).toThrow(/skill-<shortcode>/);
    });

    it("refuses a note with no type", () => {
        expect(() => addressSlug({ shortcode: "dagger" })).toThrow(/no type/);
    });
});

describe("a page's address is not its name", () => {
    const scheme = { prefix: "kb/", landing: "readme" };

    it("takes nothing from the display name, so a rename moves no URL", () => {
        const before = { type: "weapongear", shortcode: "dagger", name: { full: "Dagger" } };
        const after = { ...before, name: { full: "Dagger, Fine (Kûrbúl-hilted)" } };
        expect(packageAddress(after, { scheme })).toBe(packageAddress(before, { scheme }));
        expect(packageAddress(before, { scheme })).toBe("weapongear-dagger/");
    });

    it("takes no content mount either — an address is package-wide", () => {
        // `prefix` says where the content *tree* sits inside the package, and a
        // page addressed by `(type, shortcode)` is not addressed by where it is
        // filed. The `type-` half is what keeps that flat namespace clear of
        // `/<package>/` and `/<package>/api/`, neither of which has a hyphen.
        const fm = { type: "affliction", shortcode: "aconite" };
        expect(packageAddress(fm, { scheme })).toBe("affliction-aconite/");
        expect(packageAddress(fm, { scheme: { prefix: "" } })).toBe("affliction-aconite/");
    });

    it("routes a `doc` by its subtype but does not spell it in the address", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "combat" };
        // The section is still where the *file* goes — Hugo reads a section
        // from a directory — so it is still required.
        expect(sectionOf(fm)).toBe("rules");
        expect(packageAddress(fm, { scheme })).toBe("doc-combat/");
    });

    it("is unique by construction, so two names may agree", () => {
        // `sohl` publishes a Rules page and a User Guide page both called
        // "Gear"; under a name-derived URL that needed a collision check and,
        // once #180 lands, a rename. Two addresses cannot collide.
        const rules = { type: "doc", subType: "rules", shortcode: "gearrules" };
        const guide = { type: "doc", subType: "userguide", shortcode: "gearug" };
        expect(packageAddress(rules, { scheme })).not.toBe(packageAddress(guide, { scheme }));
    });
});

describe("a landing page is addressed by the section it is", () => {
    it("`readme`: a README addresses its section, under the mount", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(packageAddress(fm, { isReadme: true, scheme: { prefix: "kb/" } })).toBe("kb/rules/");
        expect(contentAddress(fm, true)).toBe("rules/");
    });

    it("needs no shortcode, because it is not addressed by one", () => {
        const fm = { type: "doc", subType: "rules" };
        expect(packageAddress(fm, { isReadme: true, scheme: { landing: "readme" } })).toBe(
            "rules/",
        );
    });
});

describe("a note with no address is refused, never guessed", () => {
    it("reports a `doc` with no subtype: it has no section to be filed under", () => {
        expect(() => packageAddress({ type: "doc", shortcode: "homeless" }, {})).toThrow(
            /has no section/,
        );
    });

    it("reports a landing note naming no section", () => {
        // A `README` whose `doc` note declares no subtype: `sectionOf` yields
        // nothing, so there is no segment to land at (#202).
        expect(() =>
            packageAddress({ type: "doc", shortcode: "nowhere" }, { isReadme: true }),
        ).toThrow(/lands nowhere/);
    });

    it("reports an unknown landing rule", () => {
        expect(() =>
            packageAddress({ type: "skill", shortcode: "awar" }, { scheme: { landing: "nope" } }),
        ).toThrow(/unknown landing rule/);
    });
});
