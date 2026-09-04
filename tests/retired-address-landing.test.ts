/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `publish.address.landing` is deleted (#215).
 *
 * It named which note addressed a whole section rather than a page within one.
 * #203 retired the second of its two values; #204 retired the concept the key
 * chose between, so a page emits flat and a section is a Hugo directory the note
 * format does not carry. What survived was the key itself — resolved, validated
 * against a one-element vocabulary, frozen into the configuration, and read by
 * nobody.
 *
 * It survived for one reason: `content-config.mjs` has no warning channel. Every
 * finding goes through `fail()`, which throws, so while both publishing
 * consumers still declared `landing: readme` the only two options were to break
 * them over a statement that was true when they wrote it, or to accept the key
 * in silence — and silent acceptance is what this codebase refuses everywhere
 * else. So the key took the three steps `package:` took (#56): retire the value,
 * have consumers drop the key, delete the key. No consumer declares it now.
 *
 * These cases pin the three facts a deletion has to keep straight: a
 * configuration declaring the key is **refused, and told why**; one omitting it
 * loads exactly as before; and `prefix` — the half of the address scheme that
 * was never inert — still works.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";
import * as contentConfig from "../content-config.mjs";
import * as contentAddress from "../engine/content-address.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";

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
    defineConfig({ ...minimal(), publish: { site: "content", address: value } }).publish.address;

/** The error `defineConfig` threw for an address block, or a thrown assertion. */
function refusalFor(value: unknown): any {
    try {
        address(value);
    } catch (err) {
        return err;
    }
    throw new Error("expected the configuration to be rejected");
}

describe("a configuration declaring `publish.address.landing` is refused (#215)", () => {
    it("says the rule is retired, rather than naming a value to correct", () => {
        const err = refusalFor({ prefix: "kb/", landing: "readme" });

        expect(err.message).toMatch(/retired/);
        // What the key named, and why there is nothing to name any more.
        expect(err.message).toMatch(/section/);
        // Nothing replaces it — the one thing an author reading a refusal for a
        // key they inherited most needs to know.
        expect(err.message).toMatch(/[Nn]othing replaces it/);
        // The dotted locator the loader resolves to a line and column (#95).
        expect(err.field).toBe("publish.address.landing");
    });

    it("is a targeted refusal, not a generic unrecognized option", () => {
        // `rejectUnknownKeys` would report it as a misspelling of `prefix`,
        // which names something to correct and leaves the author to work out
        // for themselves that the mechanism is gone.
        const err = refusalFor({ landing: "readme" });

        expect(err.message).not.toMatch(/is not a recognized option/);
        expect(err.message).not.toMatch(/must be one of/);
    });

    it("refuses it whatever its value, including the one #203 retired", () => {
        // Presence is the whole test, as it is for a retired frontmatter field:
        // no value makes declaring the key right. `collection` was refused by
        // name while the key lived; it is refused by the key's retirement now,
        // and the two must not both fire.
        for (const landing of ["readme", "collection", "", null]) {
            const err = refusalFor({ landing });
            expect(err.field, `for ${JSON.stringify(landing)}`).toBe("publish.address.landing");
            expect(err.message, `for ${JSON.stringify(landing)}`).toMatch(/retired/);
        }
    });

    it("locates the key in the file it was written in", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-landing-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sohl", version: "1.2.3" }),
            "utf8",
        );
        const text = [
            "contentPackage: sohl",
            "packageKind: systems",
            "compatibility:",
            '    minimum: "14.359"',
            "stats:",
            "    lastModifiedBy: sohlbuilder00000",
            "packs:",
            "    - name: items",
            "      type: Item",
            "publish:",
            "    site: content",
            "    address:",
            "        prefix: kb/",
            "        landing: readme",
            "",
        ].join("\n");
        const file = path.join(root, `${CONFIG_BASENAME}.yaml`);
        fs.writeFileSync(file, text, "utf8");

        let message = "";
        try {
            configFromData(YAML.parse(text), file);
        } catch (err) {
            message = (err as Error).message;
        }

        // `file:line:column: severity: message`, and the position is true: the
        // line and column it names hold the offending key.
        const at = /:(\d+):(\d+): error: /.exec(message);
        expect(at, message).not.toBeNull();
        const [line, column] = [Number(at![1]), Number(at![2])];
        expect(text.split("\n")[line - 1].slice(column - 1)).toMatch(/^landing:/);
        expect(message.startsWith(`${file}:`)).toBe(true);
    });
});

describe("what the deletion leaves alone (#215)", () => {
    it("loads a configuration that omits the key, and records no landing", () => {
        expect(address({ prefix: "kb/" })).toEqual({ prefix: "kb/" });
        expect(Object.hasOwn(address({}), "landing")).toBe(false);
        expect(Object.hasOwn(contentConfig.DEFAULT_ADDRESS_SCHEME, "landing")).toBe(false);
    });

    it("still accepts and applies `prefix`, with its slash rules intact", () => {
        expect(address({ prefix: "kb/" }).prefix).toBe("kb/");
        // The default: `thalorna`'s site is nothing but its content.
        expect(address({}).prefix).toBe("");
        expect(() => address({ prefix: "kb" })).toThrow(/must end in a slash/);
        expect(() => address({ prefix: "/kb/" })).toThrow(/must not begin with a slash/);
    });

    it("still refuses a key the address scheme never had", () => {
        // The targeted refusal is for the retired key only; anything else keeps
        // the did-you-mean shape, now naming one option.
        const err = refusalFor({ prefx: "kb/" });
        expect(err.message).toMatch(/is not a recognized option \(expected one of: prefix\)/);
        expect(err.message).not.toMatch(/retired/);
    });

    it("addresses a page without a landing rule to consult", () => {
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(contentAddress.packageAddress(fm)).toBe("doc-rulesintro/");
        // Not merely ignored: there is no scheme parameter left to pass.
        expect(contentAddress.packageAddress(fm, { scheme: { prefix: "kb/" } } as never)).toBe(
            "doc-rulesintro/",
        );
    });

    it("exports no landing vocabulary for anyone to import", () => {
        // The rules list and the retired-value map were the key's own; with the
        // key gone there is nothing for either to describe.
        expect(contentConfig).not.toHaveProperty("LANDING_RULES");
        expect(contentConfig).not.toHaveProperty("RETIRED_LANDING_RULES");
        expect(contentAddress).not.toHaveProperty("LANDING_RULES");
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});
