/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **An authored Address, an emitted Shortcode.**
 *
 * An affiliation's `seat`, `parents`, `domains` and `relations` keys are
 * Addresses, written at whatever length says what they mean; the fields they
 * compile into hold a shortcode, read at runtime among the items one actor
 * carries. The builder resolves the one into the other, and the two questions
 * stay separate: the parser takes the position's default type, and the field
 * states the set it accepts.
 *
 * The third case of each trio is the one no tree authors — a value naming a
 * type the position does not take — and it is the one that proves acceptability
 * is asked at all rather than collapsed into the parse.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi } from "vitest";

import { addressFields, reduceAddressFields } from "../engine/address-fields.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { Items } from "../sohl/items.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The vocabularies of a tree that publishes `foo`, depends on `bar`, and
 * declares `nodx` as a Foundry dependency with no content index.
 */
const VOCABULARY = {
    package: "foo",
    types: new Set(["affiliation", "place", "being"]),
    packages: new Set(["foo", "bar"]),
    noIndexPackages: new Set(["nodx"]),
};

const AFFILIATION = ITEM_FIELDS.affiliation as readonly any[];

/** One affiliation field's declaration, by the name an author writes. */
const declared = (name: string) => AFFILIATION.find((field) => field.name === name);

/**
 * Reduce one field's emitted value.
 *
 * @param name - The authored field name.
 * @param value - What the field's own `read` emitted.
 */
function reduce(name: string, value: unknown) {
    const field = declared(name);
    const emitted: Record<string, unknown> = { [field.to]: value };
    const findings = reduceAddressFields(emitted, [field], VOCABULARY);
    return { value: emitted[field.to], messages: findings.map((f: any) => f.message) };
}

describe("the declarations that state an Address position", () => {
    it("states one on exactly the four affiliation fields", () => {
        const stated = Object.entries(ITEM_FIELDS as Record<string, readonly any[]>).flatMap(
            ([type, fields]) => addressFields(fields).map((field: any) => `${type}.${field.name}`),
        );
        expect(stated.sort()).toEqual([
            "affiliation.domains",
            "affiliation.parents",
            "affiliation.relations",
            "affiliation.seat",
        ]);
    });

    it("declares the default type and the accepted set separately", () => {
        // They coincide at all four, which is the common case rather than the
        // rule — an art slot defaults to `icon` and accepts `icon` or `image` —
        // so the set is its own statement and the reduction reads it as one.
        expect(declared("seat").address).toEqual({ type: "place", accepts: ["place"] });
        expect(declared("domains").address).toEqual({
            type: "place",
            accepts: ["place"],
            holds: "items",
        });
        expect(declared("parents").address).toEqual({
            type: "affiliation",
            accepts: ["affiliation"],
            holds: "items",
        });
        expect(declared("relations").address).toEqual({
            type: "affiliation",
            accepts: ["affiliation"],
            holds: "keys",
        });
    });

    it("leaves `skillAptitudes` a Shortcode map", () => {
        // Its keys are selectors — a skill's shortcode, or `subType:<value>` —
        // and a `subType:` selector is not an Address at any length.
        const mystery = ITEM_FIELDS.mystery as readonly any[];
        expect(addressFields(mystery)).toEqual([]);
    });
});

describe("a seat", () => {
    it("names one place at every length", () => {
        for (const written of [
            "tashal",
            "place-tashal",
            "none-place-tashal",
            "bar-none-place-tashal",
        ]) {
            expect(reduce("seat", written)).toEqual({ value: "tashal", messages: [] });
        }
    });

    it("refuses a value naming a being, which parses and is not a place", () => {
        const { messages } = reduce("seat", "being-foobar");
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("`seat`");
        expect(messages[0]).toContain("being-foobar");
        expect(messages[0]).toContain("place");
    });

    it("leaves the two empties alone", () => {
        expect(reduce("seat", null)).toEqual({ value: null, messages: [] });
        expect(reduce("seat", "")).toEqual({ value: "", messages: [] });
    });
});

describe("domains", () => {
    it("names places at every length", () => {
        expect(
            reduce("domains", ["tashal", "place-vylar", "none-place-north", "bar-none-place-far"]),
        ).toEqual({ value: ["tashal", "vylar", "north", "far"], messages: [] });
    });

    it("refuses an entry naming an affiliation", () => {
        const { messages } = reduce("domains", ["tashal", "affiliation-guild"]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("`domains`");
        expect(messages[0]).toContain("affiliation-guild");
        expect(messages[0]).toContain("place");
    });

    it("leaves an empty list alone", () => {
        expect(reduce("domains", [])).toEqual({ value: [], messages: [] });
    });
});

describe("parents", () => {
    it("names affiliations at every length", () => {
        expect(
            reduce("parents", [
                "c",
                "affiliation-c2",
                "sohl-affiliation-c3",
                "bar-sohl-affiliation-c4",
            ]),
        ).toEqual({ value: ["c", "c2", "c3", "c4"], messages: [] });
    });

    it("refuses an entry naming a place", () => {
        const { messages } = reduce("parents", ["place-tashal"]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("`parents`");
        expect(messages[0]).toContain("affiliation");
    });
});

describe("relations", () => {
    it("keys the emitted map by the shortcode each Address names", () => {
        // The worked case: one body in another package, one in this one.
        expect(reduce("relations", { "bar-sohl-affiliation-b": "aligned", c: "nemesis" })).toEqual({
            value: { b: "aligned", c: "nemesis" },
            messages: [],
        });
    });

    it("refuses a key naming a being", () => {
        const { messages } = reduce("relations", { "being-foobar": "rival" });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("`relations`");
        expect(messages[0]).toContain("being-foobar");
        expect(messages[0]).toContain("affiliation");
    });

    it("leaves an empty map alone", () => {
        expect(reduce("relations", {})).toEqual({ value: {}, messages: [] });
    });
});

describe("the reduction to a shortcode is lossy, and the collision it loses is legal", () => {
    it("reports two affiliations sharing a shortcode, naming both Addresses", () => {
        const { messages } = reduce("relations", {
            b: "aligned",
            "bar-sohl-affiliation-b": "rival",
        });
        expect(messages).toHaveLength(1);
        // The bare key's own Address, which pins the system segment: an
        // affiliation compiles into a SoHL Item, so a bare key takes `sohl`
        // rather than `none`.
        expect(messages[0]).toContain("foo-sohl-affiliation-b");
        expect(messages[0]).toContain("bar-sohl-affiliation-b");
        expect(messages[0]).toContain("b");
    });

    it("reports two places sharing a shortcode in a list", () => {
        const { messages } = reduce("domains", ["tashal", "bar-none-place-tashal"]);
        expect(messages).toHaveLength(1);
        // A place is a core document, so a bare value here takes `none`.
        expect(messages[0]).toContain("foo-none-place-tashal");
        expect(messages[0]).toContain("bar-none-place-tashal");
    });

    it("reports one body named twice as two keys", () => {
        const { messages, value } = reduce("relations", {
            c: "aligned",
            "affiliation-c": "nemesis",
        });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("foo-sohl-affiliation-c");
        expect(messages[0]).toContain("twice");
        // The first standing stands, so the emitted map is the same whatever
        // order the keys arrived in.
        expect(value).toEqual({ c: "aligned" });
    });

    it("takes one place named twice in a list as the duplicate it is", () => {
        expect(reduce("domains", ["tashal", "place-tashal"])).toEqual({
            value: ["tashal", "tashal"],
            messages: [],
        });
    });
});

describe("what the grammar refuses", () => {
    it("refuses a value that is no Address", () => {
        const { messages } = reduce("seat", "nosuchtype-tashal");
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("nosuchtype-tashal");
    });

    it("names a package declared with no content index", () => {
        const { messages } = reduce("seat", "nodx-none-place-tashal");
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("nodx");
        expect(messages[0]).toContain("contentIndex: false");
    });

    it("refuses a capital in a qualifying segment", () => {
        const { messages } = reduce("seat", "None-place-tashal");
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("lowercase");
    });
});

/** An affiliation note authoring the given `sohl:` block. */
function affiliation(sohl: object) {
    return {
        id: "AAAAAAAAAAAAAAAA",
        type: "affiliation",
        shortcode: "guild",
        name: { full: "The Guild" },
        data: { templatePriority: null },
        sohl: { subType: "guild", ...sohl },
    };
}

/** The vocabularies the pass reads, in the shape the link index carries them. */
function indexOfOnePlace(): object {
    return {
        types: new Set(["affiliation", "place"]),
        packages: new Set(["foo", "bar"]),
        noIndexPackages: new Set(),
        contentPackage: "foo",
        assets: new Map(),
        foreign: new Map(),
    };
}

/**
 * An `Items` pass over a note file that exists, with every diagnostic captured.
 *
 * @param run - What to assert, given the prepared pass and what it said.
 */
async function withPass(run: (pass: any, said: string[]) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-address-shortcode-"));
    const absPath = path.join(dir, "The_Guild.md");
    fs.writeFileSync(
        absPath,
        [
            "---",
            "type: affiliation",
            "shortcode: guild",
            "sohl:",
            "  seat: bar-none-place-tashal",
            "  relations:",
            "    b: aligned",
            "    bar-sohl-affiliation-b: rival",
            "---",
            "",
            "A guild.",
            "",
        ].join("\n"),
        "utf8",
    );

    const said: string[] = [];
    const error = vi
        .spyOn(console, "error")
        .mockImplementation((line: unknown) => void said.push(String(line)));
    const warn = vi
        .spyOn(console, "warn")
        .mockImplementation((line: unknown) => void said.push(String(line)));
    try {
        const pass = new Items({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: loadPackConfig().paths.packJson,
        });
        await pass.prepare();
        // After `prepare`, which builds the corpus index this replaces.
        pass.linkIndex = indexOfOnePlace();
        pass.currentNote = { absPath };
        run(pass, said);
    } finally {
        error.mockRestore();
        warn.mockRestore();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("through a real compile", () => {
    it("emits the shortcode a qualified seat names", async () => {
        await withPass((pass) => {
            const doc = pass.buildEntry(affiliation({ seat: "bar-none-place-tashal" }), "");
            expect(pass.errorCount).toBe(0);
            expect(doc.system.seat).toBe("tashal");
        });
    });

    it("reports a collision as an error located in the note", async () => {
        await withPass((pass, said) => {
            pass.buildEntry(
                affiliation({ relations: { b: "aligned", "bar-sohl-affiliation-b": "rival" } }),
                "",
            );
            expect(pass.errorCount).toBe(1);
            const message = said.find((line) => line.includes("bar-sohl-affiliation-b"));
            expect(message, said.join("\n")).toBeDefined();
            // The path starts the line, the position is the colliding entry's
            // own, and the severity is the error a build stops on.
            expect(message).toMatch(/^\S*The_Guild\.md:8:5: error: /);
        });
    });
});
