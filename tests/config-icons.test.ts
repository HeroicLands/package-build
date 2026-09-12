/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A package's icon registry, declared in its own configuration.
 *
 * Nothing ships one. A registry entry is a promise that a glyph will render,
 * and only the package that ships the font can keep it — the Game-Icons webfont
 * is built by a consumer from its own templates, and Font Awesome reaches
 * neither the knowledgebase nor a printed page unless somebody puts it there.
 * A name like `victory-star-tester` is one game system's vocabulary besides.
 *
 * So both halves are the consumer's: the fonts it ships, and the names it draws
 * from them. What is shared is the mechanism.
 *
 * The registry may be written inline or kept in a file beside the
 * configuration, because a real one is generated from what the interface
 * actually draws and a generated document inlined into a hand-edited file is a
 * merge conflict on every regeneration.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { EMPTY_ICON_REGISTRY, iconHtml, resolveIcon } from "../engine/content-icons.mjs";

/** The Font Awesome family, as a consumer that ships it would declare it. */
const FONTAWESOME = {
    class: "fa",
    styles: ["solid", "regular", "brands"],
    describe: "Font Awesome Free",
};

/** The Game-Icons webfont, which has no weights. */
const GAME_ICONS = {
    class: "ginf",
    styles: [],
    describe: "the Game-Icons.net webfont a package builds for itself",
};

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
function repoDir(files: Record<string, string> = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-icons-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    for (const [name, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), body, "utf8");
    }
    return root;
}

/** Resolve a data configuration as though it sat at `root`. */
function resolve(icons?: unknown, files: Record<string, string> = {}) {
    const root = repoDir(files);
    return configFromData(minimal(icons), path.join(root, `${CONFIG_BASENAME}.yaml`));
}

describe("a package that declares none", () => {
    it("gets an empty registry, not a starter set", () => {
        expect(resolve().icons).toBe(EMPTY_ICON_REGISTRY);
    });

    it("names no icon, so its notes' tokens stay visible", () => {
        expect(resolveIcon("star", resolve().icons)).toBeNull();
    });
});

describe("a registry written inline", () => {
    const inline = {
        families: { fontawesome: FONTAWESOME, "game-icons": GAME_ICONS },
        defaultFamily: "fontawesome",
        icons: {
            being: { style: "solid", icon: "user", label: "being" },
            vehicle: { family: "game-icons", icon: "old-wagon", label: "vehicle" },
        },
    };

    it("carries both halves through", () => {
        const { icons } = resolve(inline);

        expect(Object.keys(icons.families)).toEqual(["fontawesome", "game-icons"]);
        expect(icons.icons.being).toEqual({ style: "solid", icon: "user", label: "being" });
    });

    it("draws each family with its own prefix", () => {
        const { icons } = resolve(inline);

        expect(iconHtml(resolveIcon("being", icons) as never, {}, icons)).toContain("fa-user");
        expect(iconHtml(resolveIcon("vehicle", icons) as never, {}, icons)).toContain(
            "ginf-old-wagon",
        );
    });

    it("freezes the result, as every other resolved value is", () => {
        const { icons } = resolve(inline);

        expect(Object.isFrozen(icons)).toBe(true);
        expect(Object.isFrozen(icons.icons)).toBe(true);
        expect(Object.isFrozen(icons.families)).toBe(true);
    });

    it("takes one declared family as the default, so a single-font package names none", () => {
        const { icons } = resolve({
            families: { fontawesome: FONTAWESOME },
            icons: { being: { style: "solid", icon: "user", label: "being" } },
        });

        expect(iconHtml(resolveIcon("being", icons) as never, {}, icons)).toContain("fa-user");
    });
});

describe("a registry kept in a file", () => {
    const document = {
        families: { fontawesome: FONTAWESOME, "game-icons": GAME_ICONS },
        defaultFamily: "fontawesome",
        icons: {
            being: { style: "solid", icon: "user", label: "being" },
            vehicle: { family: "game-icons", icon: "old-wagon", label: "vehicle" },
        },
    };

    it("reads the same registry the inline form would have carried", () => {
        const { icons } = resolve("assets/icon-registry.yaml", {
            "assets/icon-registry.yaml": YAML.stringify(document),
        });

        expect(icons.icons.being).toEqual({ style: "solid", icon: "user", label: "being" });
        expect(iconHtml(resolveIcon("vehicle", icons) as never, {}, icons)).toContain(
            "ginf-old-wagon",
        );
    });

    it("resolves the path against the configuration, not the process", () => {
        // A build launched from anywhere must read the same file.
        const { icons } = resolve("assets/icon-registry.yaml", {
            "assets/icon-registry.yaml": YAML.stringify(document),
        });

        expect(Object.keys(icons.icons)).toEqual(["being", "vehicle"]);
    });

    it("says which file is wrong, not which key of the configuration", () => {
        expect(() =>
            resolve("assets/icon-registry.yaml", {
                "assets/icon-registry.yaml": YAML.stringify({
                    families: { fontawesome: FONTAWESOME },
                    icons: { x: { style: "duotone", icon: "star", label: "s" } },
                }),
            }),
        ).toThrow(/assets\/icon-registry\.yaml/);
    });
});

describe("what the configuration refuses", () => {
    it("a file it cannot read", () => {
        expect(() => resolve("assets/missing.yaml")).toThrow(/cannot be read/);
    });

    it("a file that is not YAML", () => {
        expect(() =>
            resolve("assets/icons.yaml", { "assets/icons.yaml": "families: [unclosed\n" }),
        ).toThrow(/not readable YAML/);
    });

    it("an empty file", () => {
        expect(() => resolve("assets/icons.yaml", { "assets/icons.yaml": "\n" })).toThrow(
            /is empty/,
        );
    });

    it("a value that is neither a registry nor a path", () => {
        expect(() => resolve(["star"])).toThrow(/must be a registry/);
    });

    it("a style the declared family does not ship", () => {
        // Checked against the family's own `styles`, not a list in the
        // toolchain: only the consumer knows which weights its font carries.
        expect(() =>
            resolve({
                families: { fontawesome: FONTAWESOME },
                icons: { hand: { style: "duotone", icon: "handshake", label: "x" } },
            }),
        ).toThrow(/duotone/);
    });

    it("a style on a family that has no weights", () => {
        expect(() =>
            resolve({
                families: { "game-icons": GAME_ICONS },
                icons: { sword: { style: "solid", icon: "sword", label: "x" } },
            }),
        ).toThrow(/no weights/);
    });

    it("fixed width on a family that ships no such class", () => {
        expect(() =>
            resolve({
                families: { "game-icons": GAME_ICONS },
                icons: { sword: { icon: "sword", fixedWidth: true, label: "x" } },
            }),
        ).toThrow(/fixed width/);
    });

    it("a family the registry does not declare", () => {
        expect(() =>
            resolve({
                families: { fontawesome: FONTAWESOME },
                icons: { sword: { family: "nethys", icon: "sword", label: "x" } },
            }),
        ).toThrow(/nethys/);
    });

    it("an ambiguous entry, where several families are declared and none is named", () => {
        expect(() =>
            resolve({
                families: { fontawesome: FONTAWESOME, "game-icons": GAME_ICONS },
                icons: { sword: { icon: "sword", label: "x" } },
            }),
        ).toThrow(/defaultFamily/);
    });

    it("a defaultFamily naming a family it does not declare", () => {
        expect(() =>
            resolve({ families: { fontawesome: FONTAWESOME }, defaultFamily: "noto", icons: {} }),
        ).toThrow(/noto/);
    });

    it("a family missing the parts a finding needs", () => {
        expect(() => resolve({ families: { x: { styles: [] } }, icons: {} })).toThrow(/`class`/);
    });

    it("an entry naming no glyph, and one naming no label", () => {
        const families = { fontawesome: FONTAWESOME };
        expect(() => resolve({ families, icons: { x: { style: "solid", label: "x" } } })).toThrow(
            /no `icon`/,
        );
        expect(() => resolve({ families, icons: { x: { style: "solid", icon: "x" } } })).toThrow(
            /no `label`/,
        );
    });

    it("a name no note could write", () => {
        // An entry nothing can name is a silent no-op: every use of it reports
        // "no such icon" while the table says otherwise.
        const families = { fontawesome: FONTAWESOME };
        expect(() =>
            resolve({
                families,
                icons: { "Broad Sword": { style: "solid", icon: "x", label: "x" } },
            }),
        ).toThrow(/lowercase/);
        expect(() =>
            resolve({
                families,
                icons: { broad_sword: { style: "solid", icon: "x", label: "x" } },
            }),
        ).toThrow(/lowercase/);
    });
});
