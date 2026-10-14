/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `packageBuild.shippingLicenses` adds licences to the default shipping list:
 * the key is validated, and the shipping filter reads the default list together
 * with the additions.
 */

import { describe, it, expect } from "vitest";

import { defineConfig } from "../content-config.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";
import {
    SHIPPING_LICENSES,
    exclusionReason,
    selectStagedAssets,
    shipsAsset,
} from "../engine/asset-shipping.mjs";

const FAN = "CC-BY-NC-SA-4.0";

function record(shortcode: string, license: string, ai = false) {
    return {
        type: "icon",
        address: { canonical: `acme-none-icon-${shortcode}` },
        asset: { path: `icons/${shortcode}.svg`, ai, license },
    };
}

function shared(packageBuild: Record<string, unknown> = {}) {
    return { rootDir: "/repo", packageKind: "systems", foundryPackage: "acme", packageBuild };
}

describe("the filter reads the default list together with the additions", () => {
    it("excludes a licence on neither list", () => {
        expect(exclusionReason(record("a", FAN))).toMatch(/not one a package ships/);
        expect(shipsAsset(record("a", FAN))).toBe(false);
    });

    it("ships a licence a package adds", () => {
        expect(exclusionReason(record("a", FAN), [FAN])).toBe("");
        expect(shipsAsset(record("a", FAN), [FAN])).toBe(true);
    });

    it("keeps every default licence when a package adds one", () => {
        for (const license of SHIPPING_LICENSES) {
            expect(exclusionReason(record("a", license), [FAN]), license).toBe("");
        }
    });

    it("never ships `ai: true`, whatever the additions say", () => {
        expect(exclusionReason(record("a", FAN, true), [FAN])).toMatch(/machine-generated/);
    });

    it("splits staged from excluded by the combined list", () => {
        const records = [record("a", FAN), record("b", "CC0-1.0"), record("c", "Proprietary")];
        const { staged, excluded } = selectStagedAssets(records, [FAN]);
        expect(staged.map((r) => r.address.canonical)).toEqual([
            "acme-none-icon-a",
            "acme-none-icon-b",
        ]);
        expect(excluded.map((e) => e.record.address.canonical)).toEqual(["acme-none-icon-c"]);
    });
});

describe("packageBuild.shippingLicenses validation", () => {
    it("defaults to no additions", () => {
        expect(resolvePackageBuildConfig(shared()).shippingLicenses).toEqual([]);
    });

    it("carries the declared additions", () => {
        expect(
            resolvePackageBuildConfig(shared({ shippingLicenses: [FAN] })).shippingLicenses,
        ).toEqual([FAN]);
    });

    it.each([
        ["a string", FAN],
        ["a mapping", { a: 1 }],
        ["an empty string", [""]],
        ["a non-string", [4]],
        ["a duplicate", [FAN, FAN]],
    ])("refuses %s", (_name, value) => {
        expect(() => resolvePackageBuildConfig(shared({ shippingLicenses: value }))).toThrow(
            /packageBuild\.shippingLicenses/,
        );
    });

    it("is refused by the content configuration too, wherever it loads", () => {
        const base = {
            rootDir: "/repo",
            contentPackage: "acme",
            foundryPackage: "acme",
            packageKind: "systems",
            compatibility: { minimum: "14.359" },
            stats: { lastModifiedBy: "acmebuilder0000" },
            packs: [{ name: "items", type: "Item" }],
        };
        expect(() =>
            defineConfig({ ...base, packageBuild: { shippingLicenses: [""] } } as never),
        ).toThrow(/packageBuild\.shippingLicenses/);
        expect(() =>
            defineConfig({ ...base, packageBuild: { shippingLicenses: [FAN] } } as never),
        ).not.toThrow();
    });

    it("still refuses an unknown key beside it", () => {
        expect(() =>
            resolvePackageBuildConfig(shared({ shippingLicenses: [FAN], shipLicences: [] })),
        ).toThrow(/expected one of/);
    });
});
