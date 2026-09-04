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

import { addressSlug, contentAddress, packageAddress } from "../engine/content-address.mjs";
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

    it("spells a `doc`'s subtype nowhere in the address", () => {
        // The subtype is a genre, and a genre is not an address. It used to
        // pick the directory the file was written into; that directory is gone
        // (#204), and the address never had it.
        const fm = { type: "doc", subType: "rules", shortcode: "combat" };
        expect(packageAddress(fm, { scheme })).toBe("doc-combat/");
        expect(packageAddress({ type: "doc", shortcode: "combat" }, { scheme })).toBe(
            "doc-combat/",
        );
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

describe("there is no landing page, because there is no section (#204)", () => {
    it("addresses a `README.md`'s note like every other note", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(packageAddress(fm, { scheme: { prefix: "kb/" } })).toBe("doc-rulesintro/");
        expect(contentAddress(fm)).toBe("doc-rulesintro/");
    });

    it("is a pure function of the frontmatter — the file's name reaches it nowhere", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        // The option is not merely ignored; there is no parameter to pass.
        expect(packageAddress(fm, { isReadme: true } as never)).toBe(packageAddress(fm, {}));
    });
});

describe("a note with no address is refused, never guessed", () => {
    it("publishes a `doc` with no subtype — nothing is left for it to lack", () => {
        // It used to be refused for having "no section, so nowhere to file the
        // page". The directory was the only thing it lacked, and there is no
        // directory (#204).
        expect(packageAddress({ type: "doc", shortcode: "homeless" }, {})).toBe("doc-homeless/");
    });

    it("reports a note with no shortcode, whatever else it declares", () => {
        expect(() => packageAddress({ type: "doc", subType: "rules" }, {})).toThrow(/no shortcode/);
    });

    it("reports an unknown landing rule", () => {
        expect(() =>
            packageAddress({ type: "skill", shortcode: "awar" }, { scheme: { landing: "nope" } }),
        ).toThrow(/unknown landing rule/);
    });
});
