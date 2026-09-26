/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every address this toolchain can write, written and read back.
 *
 * `tests/address-charset.test.ts` asserts the charset rule on hand-chosen
 * values. This asserts it on the **whole vocabulary**, and asserts the
 * consequence the rule exists for: an address is parsed by counting
 * hyphen-separated segments, so `canonicalKey` → `readCanonicalKey` →
 * `canonicalKey` has to be the identity for every combination the vocabularies
 * admit. A term that breaks the charset does not merely look wrong — it reads
 * back as a *different* address, with no error anywhere.
 *
 * **The vocabularies are derived from their own source**, never listed here. A
 * second list is one more thing to keep in step, and the omission it would hide
 * is exactly the one this is meant to catch: a type added to the registry and
 * not to the guard is a type the guard says nothing about.
 *
 * Two properties ride along, because they are statements about the same
 * address space and have nowhere better to be asserted:
 *
 * - **No asset-type address carries a non-`none` system.** A file belongs to no
 *   game system, so the `<system>` segment is a property of the type rather than
 *   of the reference that names it — which is what lets an embedded item under a
 *   `sohl:` block name `icon-anvil` and resolve.
 * - **`packagebuild` is reserved.** The toolchain ships files of its own under
 *   that namespace, so a repository claiming the name would publish addresses
 *   that collide with them.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, it, expect } from "vitest";

import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "../engine/address-charset.mjs";
import { ASSET_SYSTEM, ASSET_TYPE_NAMES } from "../engine/asset-types.mjs";
import {
    CANONICAL_KEY_SEGMENTS,
    canonicalKey,
    expandAddress,
    readCanonicalKey,
} from "../engine/content-address.mjs";
import { PACK_BY_TYPE } from "../engine/ids.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { isReservedPackage, PACKAGEBUILD_PACKAGE, RESERVED_PACKAGES } from "../engine/packages.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { NO_SYSTEM, SYSTEM_SEGMENTS } from "../engine/systems.mjs";

/**
 * Every type name an address may carry, read from the three registries that
 * declare one: the note vocabulary, the pack router's table, and the asset
 * types.
 */
const TYPES: string[] = [
    ...new Set([
        ...Object.keys(NOTE_VOCABULARY),
        ...Object.keys(PACK_BY_TYPE),
        ...ASSET_TYPE_NAMES,
    ]),
].sort();

/** Every `<system>` segment the registry admits, `none` included. */
const SYSTEMS: string[] = [...SYSTEM_SEGMENTS].sort();

/** Package names in use, plus the shapes a shortcode takes. */
const PACKAGES = ["sohl", "hm3", "thalorna", "kethira", "harnensemble", "harnadventures"];
const SHORTCODES = ["clmb", "aconite", "anvil", "weapon2", "3", "defaultcharhead"];

describe("the vocabularies an address is written from", () => {
    it("reads registries that still have entries, so the comparison is not vacuous", () => {
        // Guards the guard: were a registry to move, every loop below would run
        // over nothing and pass while checking nothing.
        expect(TYPES.length).toBeGreaterThan(20);
        expect(TYPES).toEqual(expect.arrayContaining(["being", "skill", "icon", "image", "audio"]));
        expect(SYSTEMS).toEqual(expect.arrayContaining(["none", "sohl", "hm3"]));
    });

    it("holds every type name to the address charset", () => {
        const bad = TYPES.filter((type) => !isAddressSegment(type));
        expect(bad, `outside ${ADDRESS_SEGMENT_PATTERN.source}`).toEqual([]);
    });

    it("holds every system segment to the address charset", () => {
        const bad = SYSTEMS.filter((system) => !isAddressSegment(system));
        expect(bad, `outside ${ADDRESS_SEGMENT_PATTERN.source}`).toEqual([]);
    });

    it("holds every package name to the address charset", () => {
        expect(PACKAGES.filter((pkg) => !isAddressSegment(pkg))).toEqual([]);
        expect([...RESERVED_PACKAGES].filter((pkg) => !isAddressSegment(pkg))).toEqual([]);
    });

    it("holds every shortcode in these cases to the address charset", () => {
        // The shortcodes below are inputs to the round-trip, so a malformed one
        // would make it fail for a reason that is about the fixture.
        expect(SHORTCODES.filter((code) => !isAddressSegment(code))).toEqual([]);
    });
});

describe("address → key → address round-trips", () => {
    it("recovers every field of every combination the vocabularies admit", () => {
        const broken: string[] = [];
        for (const pkg of PACKAGES) {
            for (const system of SYSTEMS) {
                for (const type of TYPES) {
                    for (const shortcode of SHORTCODES) {
                        const key = canonicalKey(pkg, system, type, shortcode);
                        const read = readCanonicalKey(key);
                        if (
                            !read ||
                            read.package !== pkg ||
                            read.system !== system ||
                            read.type !== type ||
                            read.shortcode !== shortcode ||
                            canonicalKey(read.package, read.system, read.type, read.shortcode) !==
                                key
                        ) {
                            broken.push(key);
                        }
                    }
                }
            }
        }
        expect(broken).toEqual([]);
    });

    it("writes exactly the number of segments the grammar counts", () => {
        const key = canonicalKey("sohl", "none", "skill", "clmb");
        expect(key.split("-")).toHaveLength(CANONICAL_KEY_SEGMENTS);
    });

    it("reports a key that cannot be canonical rather than mis-reading it", () => {
        // The failure the charset rule exists to prevent, shown rather than
        // asserted in prose: a package name carrying the separator counts one
        // segment too many.
        expect(readCanonicalKey("harn-adventures-sohl-skill-melee")).toBeNull();
    });
});

describe("asset references supply their own system default", () => {
    it("declares `none` as the segment every asset type writes", () => {
        expect(ASSET_SYSTEM).toBe(NO_SYSTEM);
    });

    it("uses the default supplied by each position", () => {
        for (const type of ASSET_TYPE_NAMES) {
            for (const system of SYSTEMS) {
                const expanded = expandAddress(
                    { type, shortcode: "anvil", itemDoc: false },
                    { package: "sohl", system },
                );
                expect(readCanonicalKey(expanded)?.system).toBe(system);
            }
        }
    });

    it("keeps an explicitly stated system", () => {
        const expanded = expandAddress(
            { type: "icon", shortcode: "anvil", itemDoc: false, system: "sohl" },
            { package: "sohl", system: "sohl" },
        );
        expect(readCanonicalKey(expanded)?.system).toBe("sohl");
    });

    it("leaves a note type's system alone", () => {
        // Guards the guard: were the asset rule to fire on everything, the
        // assertion above would pass while saying nothing about assets.
        const expanded = expandAddress(
            { type: "skill", shortcode: "clmb", itemDoc: false, system: "sohl" },
            { package: "sohl", system: "sohl" },
        );
        expect(readCanonicalKey(expanded)?.system).toBe("sohl");
    });
});

describe("`packagebuild` is reserved", () => {
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

    /** Resolve a configuration naming `pkg`, returning whatever it threw. */
    function rejectionFor(pkg: string): string {
        const text = [`contentPackage: ${pkg}`, ...REST].join("\n");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-reserved-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sohl", version: "1.2.3" }),
            "utf8",
        );
        const file = path.join(root, `${CONFIG_BASENAME}.yaml`);
        fs.writeFileSync(file, text, "utf8");
        try {
            configFromData(YAML.parse(text), file);
        } catch (err) {
            return (err as Error).message;
        }
        throw new Error(`expected \`contentPackage: ${pkg}\` to be rejected`);
    }

    it("names the one package no repository may claim", () => {
        expect([...RESERVED_PACKAGES]).toEqual([PACKAGEBUILD_PACKAGE]);
        expect(isReservedPackage(PACKAGEBUILD_PACKAGE)).toBe(true);
        expect(isReservedPackage("sohl")).toBe(false);
    });

    it("refuses a configuration that claims it, at the line it is written on", () => {
        const message = rejectionFor(PACKAGEBUILD_PACKAGE);
        expect(message).toContain("contentPackage");
        expect(message).toContain(PACKAGEBUILD_PACKAGE);
        expect(message).toMatch(/reserved/);
    });

    it("refuses a configuration named after an asset type", () => {
        // The same disjointness rule the note types already carry: `image` is a
        // type an address names, so `image-thorn` would be readable two ways.
        for (const type of ASSET_TYPE_NAMES) {
            expect(rejectionFor(type), type).toMatch(/note type/);
        }
    });
});
