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
 * `img` says "unset" and "blank on purpose" with two different values (#218).
 *
 * `resolveImg` used to open with `if (!raw) return ""`, and every caller then
 * applied its own default with `||`. That made `""`, `null` and an absent key
 * one case: all three landed on the type's default art, and a note had no way
 * to say "ship no image" at all.
 *
 * The rule this suite pins is the one the project already holds for an optional
 * "not specified" DataModel string — `nullable, initial: null`, so "unset" is
 * one honest value rather than two:
 *
 * - **`null` / absent** → unset. The caller's default applies.
 * - **`""`** → blank on purpose. It survives, and no default replaces it.
 *
 * `title` is deliberately **not** covered by the rule. It is simultaneously a
 * declared item field whose default is `""` (`sohl/item-fields.mjs`, resolved
 * from the same shared top-level key the site emitter reads as the page title),
 * so `title: null` compiles the literal string `"null"` into the document. The
 * `title` half of #218 is a template and emitter question, not this one.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveImg } from "../engine/helpers.mjs";
import { buildMacroEntry, DEFAULT_MACRO_IMG } from "../engine/macros.mjs";
import { Items } from "../sohl/items.mjs";
import { DEFAULT_ITEM_ART } from "../sohl/default-item-art.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* -------------------------------------------------------------------- */
/*  The translator itself                                               */
/* -------------------------------------------------------------------- */

describe("resolveImg tells an unset path from a deliberately blank one (#218)", () => {
    it("returns null for an absent path, so a caller's default can apply", () => {
        expect(resolveImg(undefined)).toBeNull();
    });

    it("returns null for an authored `null`, which means the same thing", () => {
        expect(resolveImg(null)).toBeNull();
    });

    it('returns the empty string for an authored `""` — blank on purpose', () => {
        expect(resolveImg("")).toBe("");
    });

    it("still translates a bundled asset root, and still passes anything else through", () => {
        // The translation half is unchanged; only the empty cases moved.
        expect(resolveImg("icons/other/sword.svg")).toBe(
            "systems/sohl/assets/icons/other/sword.svg",
        );
        expect(resolveImg("modules/foo/bar.webp")).toBe("modules/foo/bar.webp");
    });

    it("distinguishes the two for a non-`sohl` consumer as well", () => {
        const moduleConfig = { assetRoot: "modules/sohl-thalorna/assets" } as any;
        expect(resolveImg(null, moduleConfig)).toBeNull();
        expect(resolveImg("", moduleConfig)).toBe("");
    });
});

/* -------------------------------------------------------------------- */
/*  The callers that pair it with a default                             */
/* -------------------------------------------------------------------- */

describe("an item note's `img` (#218)", () => {
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
        sohl: { subType: "physical", archetype: null },
    };

    it("falls back to the type's default art when the key is absent", () => {
        expect(compiler().buildEntry(SKILL_FM, "").img).toBe(DEFAULT_ITEM_ART.skill);
    });

    it("falls back to the type's default art when the note writes `null`", () => {
        // The 45 `sohl-thalorna` notes this rule was written for say exactly
        // this, and must keep the art they have always compiled with.
        expect(compiler().buildEntry({ ...SKILL_FM, img: null }, "").img).toBe(
            DEFAULT_ITEM_ART.skill,
        );
    });

    it('ships no art at all when the note writes `""`', () => {
        expect(compiler().buildEntry({ ...SKILL_FM, img: "" }, "").img).toBe("");
    });

    it("still lets a note name its own art", () => {
        expect(
            compiler().buildEntry({ ...SKILL_FM, img: "systems/sohl/assets/icons/custom.svg" }, "")
                .img,
        ).toBe("systems/sohl/assets/icons/custom.svg");
    });
});

describe("a macro note's `img` (#218)", () => {
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
        expect(buildMacroEntry({ ...FM, img: null }, { command: "x();" }).img).toBe(
            DEFAULT_MACRO_IMG,
        );
    });

    it('ships no art at all when the note writes `""`', () => {
        expect(buildMacroEntry({ ...FM, img: "" }, { command: "x();" }).img).toBe("");
    });
});
