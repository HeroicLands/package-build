/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The charset guarantees a canonical address rests on (#59).
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
 * Deliberately not covered, because the grammar itself is unchanged here: the
 * system segment, `none`, partial addresses, and the manifest format version.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "../engine/address-charset.mjs";
import { isValidShortcode } from "../engine/content-lint.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { canonicalKey, readCanonicalKey, CANONICAL_KEY_SEGMENTS } from "../engine/kb-manifest.mjs";

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
    it("accepts ASCII letters and digits, in any case", () => {
        expect(isAddressSegment("sohl")).toBe(true);
        expect(isAddressSegment("harnadventures")).toBe(true);
        expect(isAddressSegment("BCFl")).toBe(true);
        expect(isAddressSegment("weapon2")).toBe(true);
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
        // The shortcode guarantee (SoHL#1397) and the package guarantee are the
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
        // uses (#95) — and the position has to be *true*, so it is read back
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
});

describe("readCanonicalKey", () => {
    it("reads the three segments a canonical key is counted into", () => {
        expect(CANONICAL_KEY_SEGMENTS).toBe(3);
        expect(readCanonicalKey(canonicalKey("sohl", "skill", "clmb"))).toEqual({
            package: "sohl",
            type: "skill",
            shortcode: "clmb",
        });
    });

    it("returns null for a string that cannot be a key", () => {
        // Too many segments — the shape `harn-adventures-skill-melee` had, and
        // the reason the charset rule above is enforced rather than assumed.
        expect(readCanonicalKey("harn-adventures-skill-melee")).toBeNull();
        expect(readCanonicalKey("skill-melee")).toBeNull();
        expect(readCanonicalKey("melee")).toBeNull();
        expect(readCanonicalKey("sohl--melee")).toBeNull();
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
        for (const input of ["harn-adventures-skill-melee", undefined, null, ""]) {
            expect(readCanonicalKey(input)).toBeFalsy();
        }
    });
});
