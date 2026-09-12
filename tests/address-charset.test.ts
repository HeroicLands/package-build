/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The charset guarantees a canonical address rests on.
 *
 * An address is parsed by counting hyphen-separated segments, which is sound
 * only while the hyphen is *purely* a separator — no segment may contain one.
 * The issue names three guarantees behind that, and says each should be
 * enforced rather than assumed. Shortcodes already are (`content-lint.mjs`);
 * these cases cover the two halves that were not:
 *
 * - `contentPackage` is validated as alphanumeric and not equal to any note
 *   type, and a violation is a located build error rather than keys that fail
 *   to read much later.
 * - `readCanonicalKey` counts segments against a named constant, and reports a
 *   string that *cannot* be a key distinctly from no string at all.
 *
 * The grammar now counts **four** segments, the system among them
 * (`sohl-none-skill-clmb`), so the charset rule carries more weight than it
 * did: a package name with a hyphen in it no longer merely fails to read, it
 * reads as a *different* address whose system segment is the tail of the
 * package name. The cases below therefore assert the count against the named
 * constant rather than restating it.
 *
 * Deliberately not covered here, because they are their own subjects:
 * `engine/systems.mjs`'s registry of which system ids are legal (the parser
 * counts segments and does not judge them), partial addresses, and the
 * manifest format version.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "../engine/address-charset.mjs";
import { isValidShortcode } from "../engine/content-lint.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import {
    canonicalKey,
    readCanonicalKey,
    CANONICAL_KEY_SEGMENTS,
} from "../engine/content-address.mjs";

/** The smallest configuration body that resolves, minus its `contentPackage`. */
const REST = [
    "packageKind: systems",
    "compatibility:",
    '    minimum: "14.359"',
    "stats:",
    "    lastModifiedBy: sohlbuilder00000",
    "packs:",
    "    - name: items",
    "      type: Item",
];

/**
 * Write a throwaway repository whose configuration names `pkg`.
 *
 * @returns The configuration's absolute path and its text.
 */
function configFor(pkg: string, extra: string[] = []): { file: string; text: string } {
    const text = [`contentPackage: ${pkg}`, ...extra, ...REST].join("\n");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-charset-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    const file = path.join(root, `${CONFIG_BASENAME}.yaml`);
    fs.writeFileSync(file, text, "utf8");
    return { file, text };
}

/** Resolve a configuration naming `pkg`, returning whatever it threw. */
function rejectionFor(pkg: string, extra: string[] = []): { message: string; text: string } {
    const { file, text } = configFor(pkg, extra);
    try {
        configFromData(YAML.parse(text), file);
    } catch (err) {
        return { message: (err as Error).message, text };
    }
    throw new Error(`expected \`contentPackage: ${pkg}\` to be rejected`);
}

/** Resolve a configuration naming `pkg`, requiring it to be accepted. */
function acceptedFor(pkg: string, extra: string[] = []): string {
    const { file, text } = configFor(pkg, extra);
    return (configFromData(YAML.parse(text), file) as { contentPackage: string }).contentPackage;
}

describe("the address-segment charset", () => {
    it("accepts lowercase ASCII letters and digits", () => {
        expect(isAddressSegment("sohl")).toBe(true);
        expect(isAddressSegment("harnadventures")).toBe(true);
        expect(isAddressSegment("bcfl")).toBe(true);
        expect(isAddressSegment("weapon2")).toBe(true);
    });

    it("rejects a capital — two names differing only in case are one name", () => {
        // `Dgr` beside `dgr` is a distinction nobody can say out loud and can
        // only see by looking twice. It also collapsed silently: `canonicalKey`
        // lowercases, so both published one address, one `_id` and one URL.
        expect(isAddressSegment("BCFl")).toBe(false);
        expect(isAddressSegment("Dgr")).toBe(false);
        expect(isAddressSegment("ltShoe")).toBe(false);
    });

    it("rejects the separator, and everything else that is not alphanumeric", () => {
        expect(isAddressSegment("harn-adventures")).toBe(false);
        expect(isAddressSegment("harn_adventures")).toBe(false);
        expect(isAddressSegment("two words")).toBe(false);
        expect(isAddressSegment("kéthira")).toBe(false);
        expect(isAddressSegment("")).toBe(false);
        expect(isAddressSegment(undefined)).toBe(false);
        expect(isAddressSegment(42)).toBe(false);
    });

    it("is the one rule shortcodes are already held to", () => {
        // The shortcode guarantee and the package guarantee are the
        // same statement about the same address, so they are one pattern rather
        // than two free to drift apart.
        for (const value of ["aconite", "self-pro", "B&CFl", "", "two words"]) {
            expect(isValidShortcode(value)).toBe(isAddressSegment(value));
        }
        expect(ADDRESS_SEGMENT_PATTERN.test("melee")).toBe(true);
    });
});

describe("`contentPackage` must be alphanumeric", () => {
    it("rejects a hyphenated package, since the hyphen is the separator", () => {
        const { message } = rejectionFor("harn-adventures");
        expect(message).toContain("contentPackage");
        expect(message).toContain("harn-adventures");
        expect(message).toMatch(/alphanumeric/);
    });

    it("rejects any other non-alphanumeric package", () => {
        expect(rejectionFor("harn_adventures").message).toMatch(/alphanumeric/);
        expect(rejectionFor('"harn adventures"').message).toMatch(/alphanumeric/);
    });

    it("names the file, line and column the key is written on", () => {
        // The `file:line:column: severity: message` form the rest of the build
        // uses — and the position has to be *true*, so it is read back
        // out of the file that was written.
        const { message, text } = rejectionFor("harn-adventures");
        const at = /^(\S+):(\d+):(\d+): error: /.exec(message);
        expect(at, `no locator in: ${message}`).not.toBeNull();
        const [, file, line, column] = at as RegExpExecArray;
        expect(file).toContain(CONFIG_BASENAME);
        expect(text.split("\n")[Number(line) - 1].slice(Number(column) - 1)).toMatch(
            /^contentPackage:/,
        );
    });

    it("accepts every package name in use today", () => {
        for (const pkg of [
            "sohl",
            "hm3",
            "thalorna",
            "kethira",
            "harnensemble",
            "harnadventures",
        ]) {
            expect(acceptedFor(pkg)).toBe(pkg);
        }
    });
});

describe("`contentPackage` must not be a note type", () => {
    it("rejects a package named after a type every package has", () => {
        for (const type of ["doc", "macro", "being", "map"]) {
            const { message } = rejectionFor(type);
            expect(message).toContain("contentPackage");
            expect(message).toContain(type);
            expect(message, `for \`${type}\``).toMatch(/note type/);
        }
    });

    it("rejects a package named after one of this repository's item types", () => {
        const { message } = rejectionFor("skill", ["itemBuilders: sohl"]);
        expect(message).toMatch(/note type/);
    });

    it("rejects a package named after a documentation type", () => {
        // `docskill` sits beside `skill` as a type segment in the manifest, so
        // it is as much a type name as the item type it documents.
        const { message } = rejectionFor("docskill", ["itemBuilders: sohl"]);
        expect(message).toMatch(/note type/);
    });

    it("still accepts a real package name with the item registry loaded", () => {
        expect(acceptedFor("thalorna", ["itemBuilders: sohl"])).toBe("thalorna");
    });

    it("reads the closed vocabulary, so the answer does not depend on configuration", () => {
        // The rule is about the *address* grammar, which is the same everywhere
        // — but the registries it would be checked against are the
        // repository's own, so a package declaring no `itemBuilders` was told
        // `skill` was a fine name for it. It is a note type in every tree, and
        // `skill-clmb` addresses one, whatever this repository compiles: the
        // reasoning `KNOWN_DOCUMENT_SUBTYPE_MAPS` already states about the
        // vocabulary being wider than any one configuration.
        expect(rejectionFor("skill").message).toMatch(/note type/);
        expect(rejectionFor("weapongear").message).toMatch(/note type/);
    });

    it("rejects a type that reaches neither the pack table nor a doc entry", () => {
        // `bundle` and `homepage` are declared note types that no pack routes
        // by type and whose prose compiles to no documentation entry, so both
        // slipped through every set the check consulted before.
        for (const type of ["bundle", "homepage"]) {
            expect(rejectionFor(type).message, `for \`${type}\``).toMatch(/note type/);
        }
    });
});

describe("readCanonicalKey", () => {
    it("reads the four segments a canonical key is counted into", () => {
        expect(CANONICAL_KEY_SEGMENTS).toBe(4);
        expect(readCanonicalKey(canonicalKey("sohl", "sohl", "skill", "clmb"))).toEqual({
            package: "sohl",
            system: "sohl",
            type: "skill",
            shortcode: "clmb",
        });
    });

    it("reads `none` in the system segment like any other value", () => {
        // The parser counts segments; it does not consult the system registry.
        // `none` is a literal in that position, not an absence, which is the
        // whole reason it is a word rather than a YAML null — a null would
        // drop the segment and leave a three-segment string that cannot read.
        expect(readCanonicalKey(canonicalKey("sohl", "none", "docskill", "clmb"))).toEqual({
            package: "sohl",
            system: "none",
            type: "docskill",
            shortcode: "clmb",
        });
    });

    it("returns null for a string that cannot be a key", () => {
        // Too many segments, and too few. `harnadventures-none-skill-melee`
        // is the well-formed spelling of the first of these; the hyphenated
        // `harn-adventures` package name that motivated the charset rule is
        // now *worse* than unreadable — with a system segment to absorb it,
        // `harn-adventures-skill-melee` counts as four and quietly reads as
        // the package `harn` under a system called `adventures`. That silent
        // misreading is why the rule above is enforced at configuration time
        // rather than caught here.
        expect(readCanonicalKey("harn-adventures-none-skill-melee")).toBeNull();
        expect(readCanonicalKey("sohl-skill-melee")).toBeNull();
        expect(readCanonicalKey("skill-melee")).toBeNull();
        expect(readCanonicalKey("melee")).toBeNull();
        expect(readCanonicalKey("sohl--skill-melee")).toBeNull();
        expect(readCanonicalKey(42)).toBeNull();
    });

    it("returns undefined when there is no key to read at all", () => {
        // Distinguishable from the malformed case, so a caller that wants to
        // report "this key is unreadable" cannot report it about nothing.
        expect(readCanonicalKey(undefined)).toBeUndefined();
        expect(readCanonicalKey(null)).toBeUndefined();
        expect(readCanonicalKey("")).toBeUndefined();
    });

    it("keeps both outcomes falsy, so every call site behaves as before", () => {
        // The four call sites test the result for truthiness only
        // (`readCanonicalKey(k)?.type`, `if (!parts) continue`), which is what
        // lets the two cases differ without any of them changing.
        for (const input of ["harn-adventures-none-skill-melee", undefined, null, ""]) {
            expect(readCanonicalKey(input)).toBeFalsy();
        }
    });
});
