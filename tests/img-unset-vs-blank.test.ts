/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An art slot is unset or names an image; an empty string is neither.
 *
 * - **`null` / absent** → unset. The caller's default applies.
 * - **`""`** → names no file. The pathname resolver refuses it, and a compiler
 *   reads it as an address nothing answers, so the default applies and the
 *   lint reports the key as an error.
 *
 * `title` is deliberately **not** covered by the rule. It is simultaneously a
 * declared item field whose default is `""` (`sohl/item-fields.mjs`, resolved
 * from the same shared top-level key the site emitter reads as the page title),
 * so `title: null` compiles the literal string `"null"` into the document. The
 * `title` half is a template and emitter question, not this one.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveImg } from "../engine/helpers.mjs";
import { buildMacroEntry, DEFAULT_MACRO_IMG } from "../engine/macros.mjs";
import { Items } from "../sohl/items.mjs";
import { DEFAULT_ITEM_ART } from "../sohl/default-item-art.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/**
 * A compile index holding one file, so a note naming its address resolves.
 *
 * The compilers resolve an art slot through the index rather than through a
 * path, so a unit case that names one has to supply a tree holding it.
 */
function indexWith(shortcode: string, type: string, assetPath: string): any {
    return {
        types: new Set(["icon", "image", "audio"]),
        packages: new Set(["sohl"]),
        contentPackage: "sohl",
        assets: new Map([
            [`sohl-none-${type}-${shortcode}`, { package: "sohl", asset: { path: assetPath } }],
        ]),
        foreign: new Map(),
    };
}

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* -------------------------------------------------------------------- */
/*  The translator itself                                               */
/* -------------------------------------------------------------------- */

describe("resolveImg treats an unset path as unset and an empty one as an error", () => {
    it("returns null for an absent path, so a caller's default can apply", () => {
        expect(resolveImg(undefined)).toBeNull();
    });

    it("returns null for an authored `null`, which means the same thing", () => {
        expect(resolveImg(null)).toBeNull();
    });

    it('refuses an authored `""`, which names no file', () => {
        expect(() => resolveImg("")).toThrow(/empty pathname/);
    });

    it("still translates a bundled pathname, and still passes a URL through", () => {
        // The translation half is unchanged; only the empty cases moved.
        expect(resolveImg("icons/other/sword.svg")).toBe(
            "systems/sohl/assets/icons/other/sword.svg",
        );
        expect(resolveImg("https://example.com/a.png")).toBe("https://example.com/a.png");
    });

    it("holds for a non-`sohl` consumer as well", () => {
        const moduleConfig = { assetRoot: "modules/sohl-thalorna/assets" } as any;
        expect(resolveImg(null, moduleConfig)).toBeNull();
        expect(() => resolveImg("", moduleConfig)).toThrow(/empty pathname/);
    });
});

/* -------------------------------------------------------------------- */
/*  The callers that pair it with a default                             */
/* -------------------------------------------------------------------- */

describe("an item note's `img`", () => {
    function compiler() {
        const config = loadPackConfig();
        return new Items({
            skipDirectories: [],
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: config.paths.packJson,
        });
    }

    /** A `skill` note — the type pairs default art, so the fallback is visible. */
    const SKILL_FM = {
        id: "DDDDDDDDDDDDDDDD",
        type: "skill",
        shortcode: "awar",
        name: { full: "Awareness" },
        sohl: { subType: "physical", templatePriority: null },
    };

    // The registry's art is a pathname like any other, so the compiled value
    // is its resolved form rather than the map's own string.
    const SKILL_ART = "systems/sohl/assets/icons/other/headgear.svg";

    it("falls back to the type's default art when the key is absent", () => {
        expect(DEFAULT_ITEM_ART.skill).toBe("sohl/assets/icons/other/headgear.svg");
        expect(compiler().buildEntry(SKILL_FM, "").img).toBe(SKILL_ART);
    });

    it("falls back to the type's default art when the note writes `null`", () => {
        // The 45 `sohl-thalorna` notes this rule was written for say exactly
        // this, and must keep the art they have always compiled with.
        expect(compiler().buildEntry({ ...SKILL_FM, data: { icon: null } }, "").img).toBe(
            SKILL_ART,
        );
    });

    it('takes the default, as for any unresolved address, when the note writes `""`', () => {
        expect(compiler().buildEntry({ ...SKILL_FM, data: { icon: "" } }, "").img).toBe(SKILL_ART);
    });

    it("still lets a note name its own art", () => {
        const pack = compiler();
        pack.linkIndex = indexWith("custom", "icon", "icons/custom.svg");
        expect(pack.buildEntry({ ...SKILL_FM, data: { icon: "custom" } }, "").img).toBe(
            "systems/sohl/assets/icons/custom.svg",
        );
    });
});

describe("a macro note's `icon`", () => {
    const FM = {
        id: "HSNwLca3kMYLN3Ag",
        type: "macro",
        shortcode: "autoatk",
        name: { full: "Automated Attack" },
        sohl: { macroType: "script", scope: "global" },
    };

    it("falls back to the macro default when the key is absent", () => {
        expect(buildMacroEntry(FM, { command: "x();" }).img).toBe(DEFAULT_MACRO_IMG);
    });

    it("falls back to the macro default when the note writes `null`", () => {
        expect(buildMacroEntry(FM, { command: "x();", img: null }).img).toBe(DEFAULT_MACRO_IMG);
    });
});
