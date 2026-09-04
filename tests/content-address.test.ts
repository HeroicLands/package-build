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

import * as contentAddressModule from "../engine/content-address.mjs";
import { addressSlug, packageAddress } from "../engine/content-address.mjs";
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
    it("takes nothing from the display name, so a rename moves no URL", () => {
        const before = { type: "weapongear", shortcode: "dagger", name: { full: "Dagger" } };
        const after = { ...before, name: { full: "Dagger, Fine (Kûrbúl-hilted)" } };
        expect(packageAddress(after)).toBe(packageAddress(before));
        expect(packageAddress(before)).toBe("weapongear-dagger/");
    });

    it("takes no content mount either — an address is package-wide", () => {
        // `prefix` says where the content *tree* sits inside the package, and a
        // page addressed by `(type, shortcode)` is not addressed by where it is
        // filed. The `type-` half is what keeps that flat namespace clear of
        // `/<package>/` and `/<package>/api/`, neither of which has a hyphen.
        // There is no scheme parameter left to pass one through (#215), so a
        // caller that still holds a scheme cannot reach the address with it.
        const fm = { type: "affliction", shortcode: "aconite" };
        expect(packageAddress(fm)).toBe("affliction-aconite/");
        expect(packageAddress(fm, { scheme: { prefix: "kb/" } } as never)).toBe(
            "affliction-aconite/",
        );
    });

    it("spells a `doc`'s subtype nowhere in the address", () => {
        // The subtype is a genre, and a genre is not an address. It used to
        // pick the directory the file was written into; that directory is gone
        // (#204), and the address never had it.
        expect(packageAddress({ type: "doc", subType: "rules", shortcode: "combat" })).toBe(
            "doc-combat/",
        );
        expect(packageAddress({ type: "doc", shortcode: "combat" })).toBe("doc-combat/");
    });

    it("is unique by construction, so two names may agree", () => {
        // `sohl` publishes a Rules page and a User Guide page both called
        // "Gear"; under a name-derived URL that needed a collision check and,
        // once #180 lands, a rename. Two addresses cannot collide.
        const rules = { type: "doc", subType: "rules", shortcode: "gearrules" };
        const guide = { type: "doc", subType: "userguide", shortcode: "gearug" };
        expect(packageAddress(rules)).not.toBe(packageAddress(guide));
    });
});

describe("there is no landing page, because there is no section (#204)", () => {
    it("addresses a `README.md`'s note like every other note", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(packageAddress(fm)).toBe("doc-rulesintro/");
    });

    it("is a pure function of the frontmatter — the file's name reaches it nowhere", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        // The option is not merely ignored; there is no parameter to pass.
        expect(packageAddress(fm, { isReadme: true } as never)).toBe(packageAddress(fm));
    });
});

describe("a note with no address is refused, never guessed", () => {
    it("publishes a `doc` with no subtype — nothing is left for it to lack", () => {
        // It used to be refused for having "no section, so nowhere to file the
        // page". The directory was the only thing it lacked, and there is no
        // directory (#204).
        expect(packageAddress({ type: "doc", shortcode: "homeless" })).toBe("doc-homeless/");
    });

    it("reports a note with no shortcode, whatever else it declares", () => {
        expect(() => packageAddress({ type: "doc", subType: "rules" })).toThrow(/no shortcode/);
    });
});

describe("there is one address, so the module exports one name for it (#226)", () => {
    it("no longer publishes `contentAddress` beside `packageAddress`", () => {
        // The two were a note's address *in the content tree* and *relative to
        // the package* — quantities that could differ while a `README.md`
        // addressed its section (#204) and a URL was derived from `name.full`
        // (#181). Both distinctions are retired, so a second name could only
        // invite a caller to think it was picking between two rules.
        expect(typeof contentAddressModule.packageAddress).toBe("function");
        expect("contentAddress" in contentAddressModule).toBe(false);
    });

    it("keeps the pair the module does need: a bare segment and an address", () => {
        // `addressSlug` is the segment a key is built from; `packageAddress` is
        // the same segment as a package-relative path. That difference is real
        // and is the only one the module draws.
        const fm = { type: "affliction", shortcode: "aconite" };
        expect(addressSlug(fm)).toBe("affliction-aconite");
        expect(packageAddress(fm)).toBe(`${addressSlug(fm)}/`);
    });
});
