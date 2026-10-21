/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The address scheme and the configuration keys around it.
 *
 * `publish.address` declares `prefix` and nothing else. A key the
 * configuration vocabulary does not declare — whatever it once meant — is
 * refused by the ordinary unrecognized-option finding, at its own field.
 */

import { describe, it, expect } from "vitest";

import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";
import * as contentConfig from "../content-config.mjs";
import * as contentAddress from "../engine/content-address.mjs";

/** The smallest configuration `defineConfig` accepts. */
function minimal(): ContentBuildConfigInput {
    return {
        rootDir: "/repo",
        contentPackage: "sohl",
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: { lastModifiedBy: "sohlbuilder00000" },
        packs: [{ name: "items", type: "Item" }],
        compatibility: { minimum: "14.359", verified: "14.359" },
    };
}

/** Resolve just the address scheme out of a `publish.address` block. */
const address = (value: unknown) =>
    defineConfig({ ...minimal(), publish: { address: value } }).publish.address;

/** The error `defineConfig` threw for a configuration, or a thrown assertion. */
function refusal(config: unknown): any {
    try {
        defineConfig(config as never);
    } catch (err) {
        return err;
    }
    throw new Error("expected the configuration to be rejected");
}

describe("the address scheme", () => {
    it("carries a prefix and nothing else", () => {
        expect(address({ prefix: "kb/" })).toEqual({ prefix: "kb/" });
        expect(contentConfig.DEFAULT_ADDRESS_SCHEME).toEqual({ prefix: "" });
    });

    it("applies `prefix`, with its slash rules intact", () => {
        expect(address({ prefix: "kb/" }).prefix).toBe("kb/");
        expect(address({}).prefix).toBe("");
        expect(() => address({ prefix: "kb" })).toThrow(/must end in a slash/);
        expect(() => address({ prefix: "/kb/" })).toThrow(/must not begin with a slash/);
    });

    it("addresses a page flat, whatever the scheme", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(contentAddress.packageAddress(fm)).toBe("doc-rulesintro/");
    });
});

describe("a key the configuration does not declare is an unrecognized option", () => {
    it("refuses an unknown `publish.address` key at its field", () => {
        const err = refusal({
            ...minimal(),
            publish: { address: { prefix: "kb/", landing: "x" } },
        });
        expect(err.message).toMatch(/is not a recognized option \(expected one of: prefix\)/);
        expect(err.field).toBe("publish.address.landing");
    });

    it.each(["trees", "readmeSections", "out", "landing", "backfillSections", "list"])(
        "refuses `site.%s` at its field",
        (key) => {
            const err = refusal({ ...minimal(), site: { [key]: [] } });
            expect(err.message).toMatch(/is not a recognized option/);
            expect(err.field).toBe(`site.${key}`);
        },
    );

    it("refuses `folders` on a pack at its field", () => {
        const err = refusal({
            ...minimal(),
            packs: [{ name: "items", type: "Item", folders: "x.yaml" }],
        });
        expect(err.message).toMatch(/is not a recognized option/);
        expect(err.field).toBe("packs[0].folders");
    });
});
