/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A field whose name collides with a note property that means something else**
 * (#218).
 *
 * A note's top-level `title` is *the title of the note* — the page heading, the
 * display name the site emitter reads. An `affiliation` item's `system.title`
 * is *the style of address the office carries* — "Ajaw", "Warden". The two are
 * unrelated quantities that happen to be spelled the same, and until this change
 * one fed the other: `resolveFieldValue`'s third step reads the top-level
 * property named after the field, so a note's own heading landed in the item's
 * `system.title`.
 *
 * It surfaced as a stringified `null`. Step 3 returns *without* applying
 * `field.default` — only step 2 does — so an authored `title: null` reached the
 * `STRING` coercion as-is and fifteen documents shipped
 * `"system": { "title": "null" }`.
 *
 * The exemption is declared with {@link FieldSpec.topLevelMeans}, whose value is
 * the reason: what the top-level key of that name means *instead*. Step 3 is the
 * right default — most shared sources genuinely are the same quantity at both
 * levels — so the mechanism is a per-field opt-out that states its case, not a
 * change to the resolution order.
 */

import { describe, it, expect } from "vitest";

import { resolveFieldValue } from "../engine/system-block.mjs";
import { buildFromFields, readField, STRING } from "../engine/field-spec.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";

/** The declaration under test — SoHL's `affiliation` item's `title`. */
const TITLE = ITEM_FIELDS.affiliation.find((field) => field.name === "title");

/** The whole `affiliation` builder, so the assertions run the real emission. */
const buildAffiliation = buildFromFields(ITEM_FIELDS.affiliation);

/* --------------------------------------------------------------------- */
/*  The mechanism                                                         */
/* --------------------------------------------------------------------- */

describe("a field that declares what the top-level key means instead", () => {
    /** A field whose shared source is genuinely the same quantity. */
    const shared = { name: "society", to: "society", ...STRING, default: "", describe: "" };

    /** The same field, exempted from the shared top-level position. */
    const exempt = {
        ...shared,
        topLevelMeans: "something else entirely, for the sake of this test",
    };

    it("skips the shared top-level property", () => {
        expect(resolveFieldValue(exempt, { society: "The Guild" })).toEqual({
            value: "",
            from: "default",
        });
    });

    it("falls to the field's own default rather than passing the value on", () => {
        // The failure mode the defect actually produced: a `null` that reached
        // the coercion unguarded and stringified. The default has to apply.
        expect(readField(exempt, { society: null })).toBe("");
        expect(readField(exempt, { society: "The Guild" })).toBe("");
    });

    it("leaves the destination path authorable", () => {
        expect(resolveFieldValue(exempt, { sohl: { system: { society: "The Guild" } } })).toEqual({
            value: "The Guild",
            from: "system",
        });
    });

    it("leaves the legacy in-block position authorable", () => {
        expect(resolveFieldValue(exempt, { sohl: { society: "The Guild" } })).toEqual({
            value: "The Guild",
            from: "block",
        });
    });

    it("changes nothing for a field that does not declare it", () => {
        // The exemption is per-field. Step 3 is legitimate wherever the two
        // levels mean the same thing, and most fields are that case.
        expect(resolveFieldValue(shared, { society: "The Guild" })).toEqual({
            value: "The Guild",
            from: "shared",
        });
    });

    it("does not confuse a dotted shared source with a bare one", () => {
        // A field drawing from `data.title` states a real path, not a colliding
        // name, so exempting `title` must not reach it.
        const dotted = { name: "data.title", to: "title", ...STRING, default: "", describe: "" };
        expect(resolveFieldValue(dotted, { data: { title: "Ajaw" } })).toEqual({
            value: "Ajaw",
            from: "shared",
        });
    });
});

/* --------------------------------------------------------------------- */
/*  The declaration the defect was reported against                       */
/* --------------------------------------------------------------------- */

describe("an affiliation's `system.title`", () => {
    it("declares why the note's own `title` is not its source", () => {
        // The reason is the mechanism: a bare boolean would record the decision
        // and lose the case for it, and the next person adding a field needs to
        // know the question exists.
        expect(TITLE?.topLevelMeans).toMatch(/\S/);
    });

    it("does not take the note's own title", () => {
        const fm = { subType: "order", title: "The Order of the Silver Hand", sohl: {} };
        expect(buildAffiliation(fm).title).toBe("");
    });

    it("does not stringify an authored `title: null`", () => {
        // The reported symptom, exactly: fifteen documents shipped the literal
        // string "null" because step 3 answered without applying the default.
        expect(buildAffiliation({ subType: "order", title: null, sohl: {} }).title).toBe("");
    });

    it("does not take an authored blank either", () => {
        expect(buildAffiliation({ subType: "order", title: "", sohl: {} }).title).toBe("");
    });

    it("is still authorable at `sohl.system.title`", () => {
        // The position that has to keep working, or the field becomes
        // unauthorable. It is also the only one the frontmatter lint accepts:
        // `title` is not a `data:` property any type declares.
        const fm = {
            subType: "order",
            title: "The Order of the Silver Hand",
            sohl: { system: { title: "Warden" } },
        };
        expect(buildAffiliation(fm).title).toBe("Warden");
    });

    it("is still authorable at the legacy in-block `sohl.title`", () => {
        const fm = {
            subType: "order",
            title: "The Order of the Silver Hand",
            sohl: { title: "Warden" },
        };
        expect(buildAffiliation(fm).title).toBe("Warden");
    });

    it("emits its default when nothing authors it", () => {
        expect(buildAffiliation({ subType: "order", sohl: {} }).title).toBe("");
    });

    it("leaves its neighbours resolving from the shared position", () => {
        // `society`, `office` and `level` share the affiliation declaration and
        // are *not* exempted — nothing at the note level claims those names, so
        // step 3 is still the right answer for them.
        const built = buildAffiliation({
            subType: "order",
            society: "The Guild",
            office: "Reeve",
            level: 4,
        });
        expect(built).toMatchObject({ society: "The Guild", office: "Reeve", level: 4 });
    });
});

/* --------------------------------------------------------------------- */
/*  The rest of the vocabulary                                            */
/* --------------------------------------------------------------------- */

describe("the fields that keep the shared top-level position", () => {
    it("exempts `title` and nothing else", () => {
        // A guard on the blast radius. `subType` is the other declared item
        // field spelled like a note-level key, and there the two levels mean the
        // same thing by design — every mapping table names it a shared source.
        const exempted = Object.entries(ITEM_FIELDS).flatMap(([type, fields]) =>
            fields
                .filter((field) => field.topLevelMeans !== undefined)
                .map((f) => `${type}.${f.name}`),
        );
        expect(exempted).toEqual(["affiliation.title"]);
    });

    it("keeps `subType` reading the note's own", () => {
        const built = buildAffiliation({ subType: "order", sohl: {} });
        expect(built.subType).toBe("order");
    });
});
