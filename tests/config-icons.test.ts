/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A package's own icon registry, declared in its configuration.
 *
 * The gap this closes: the shipped table is Font Awesome throughout, and the
 * Game-Icons glyphs an interface actually draws come from a webfont the
 * *consumer* builds for itself. Only the consumer knows their names, so until
 * it can say so, half the icons in a legend have no name a note may write and
 * the file stays raw `<i>` markup that no book can render.
 *
 * Merged rather than replacing, so the shared interface vocabulary — the names
 * that mean the same thing in two repositories — does not have to be restated
 * by every package that adds one glyph.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { DEFAULT_ICONS, iconHtml, resolveIcon } from "../engine/content-icons.mjs";

/** The smallest data configuration that resolves. */
function minimal(icons?: unknown): Record<string, unknown> {
    const data: Record<string, unknown> = {
        contentPackage: "sohl",
        packageKind: "systems",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "sohlbuilder00000" },
        packs: [{ name: "items", type: "Item" }],
    };
    if (icons !== undefined) data.icons = icons;
    return data;
}

/** A throwaway repository root, with the `package.json` a configuration reads. */
function repoDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-icons-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    return root;
}

/** Resolve a data configuration as though it sat at `root`. */
function resolve(icons?: unknown) {
    const root = repoDir();
    return configFromData(minimal(icons), path.join(root, `${CONFIG_BASENAME}.yaml`));
}

describe("a package that declares none", () => {
    it("gets the shipped table, unchanged", () => {
        expect(resolve().icons).toBe(DEFAULT_ICONS);
    });
});

describe("a package that declares its own", () => {
    it("keeps every shipped entry beside them", () => {
        // The shared vocabulary is the point: a package adding one glyph must
        // not have to restate the table to keep `:icon-edit:` working.
        const config = resolve({
            broadsword: { family: "game-icons", icon: "broadsword", label: "broadsword" },
        });

        expect(config.icons.star).toEqual(DEFAULT_ICONS.star);
        expect(config.icons.edit).toEqual(DEFAULT_ICONS.edit);
    });

    it("names a Game-Icons glyph, which the shipped table cannot", () => {
        const config = resolve({
            broadsword: { family: "game-icons", icon: "broadsword", label: "broadsword" },
        });

        expect(config.icons.broadsword).toEqual({
            family: "game-icons",
            icon: "broadsword",
            label: "broadsword",
        });
        // And it resolves to its own font's class, not Font Awesome's.
        expect(iconHtml(resolveIcon("broadsword", config.icons) as never)).toContain(
            "ginf-broadsword",
        );
    });

    it("wins where it spells a shipped name, so a glyph can be corrected here", () => {
        const config = resolve({ edit: { style: "regular", icon: "pen", label: "edit" } });

        expect(config.icons.edit).toEqual({ style: "regular", icon: "pen", label: "edit" });
        expect(config.icons.edit).not.toEqual(DEFAULT_ICONS.edit);
    });

    it("freezes the result, as every other resolved value is", () => {
        expect(
            Object.isFrozen(resolve({ x: { style: "solid", icon: "x", label: "x" } }).icons),
        ).toBe(true);
    });
});

describe("what the configuration refuses", () => {
    it("a block that is not a mapping", () => {
        expect(() => resolve(["star"])).toThrow(/icons/);
    });

    it("a style Font Awesome Free does not ship", () => {
        // The same rule the per-note check applies, raised to a refusal: a
        // registry that cannot be trusted makes every finding downstream
        // unreliable in the same way.
        expect(() =>
            resolve({ hand: { style: "duotone", icon: "handshake", label: "x" } }),
        ).toThrow(/duotone/);
    });

    it("a style on a family that has no weights", () => {
        expect(() =>
            resolve({ sword: { family: "game-icons", style: "solid", icon: "sword", label: "x" } }),
        ).toThrow(/no weights/);
    });

    it("a family nothing declares", () => {
        expect(() => resolve({ sword: { family: "nethys", icon: "sword", label: "x" } })).toThrow(
            /nethys/,
        );
    });

    it("an entry naming no glyph, and one naming no label", () => {
        expect(() => resolve({ x: { style: "solid", label: "x" } })).toThrow(/no `icon`/);
        expect(() => resolve({ x: { style: "solid", icon: "x" } })).toThrow(/no `label`/);
    });

    it("a name no note could write", () => {
        // A registry entry nothing can name is a silent no-op: every use of it
        // reports "no such icon" while the table says otherwise.
        expect(() => resolve({ "Broad Sword": { style: "solid", icon: "x", label: "x" } })).toThrow(
            /lowercase/,
        );
        expect(() => resolve({ broad_sword: { style: "solid", icon: "x", label: "x" } })).toThrow(
            /lowercase/,
        );
    });
});
