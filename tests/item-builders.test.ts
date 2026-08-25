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

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Imported by relative path, not the `@src` alias, because the pack-build
// scripts live outside that tree.
import { ITEM_BUILDERS } from "../sohl/item-builders.mjs";
import { itemTypes, itemBuilder } from "../engine/item-registry.mjs";
import { DEFAULT_ITEM_ART } from "../sohl/default-item-art.mjs";
import { Items } from "../sohl/items.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BUILDERS = ITEM_BUILDERS as Record<string, unknown>;

describe("ITEM_BUILDERS (the one registry keyed by item type, #1504)", () => {
    it("maps every registered type to a builder paired with its art", () => {
        expect(Object.keys(BUILDERS).length).toBeGreaterThan(0);
        for (const [type, entry] of Object.entries(BUILDERS)) {
            const paired = entry as { system: unknown; img: unknown };
            expect(typeof paired.system, type).toBe("function");
            expect(typeof paired.img, type).toBe("string");
        }
    });

    it("is the source itemTypes() derives from, so the two cannot disagree", () => {
        // Not "these two hand-written lists happen to match" — itemTypes() is
        // built from the registry's keys, so a type with no builder cannot be
        // whitelisted in the first place.
        expect([...itemTypes()].sort()).toEqual(Object.keys(BUILDERS).sort());
    });

    it("does not advertise the retired `trait` type (#651)", () => {
        // `trait` was retired: it is absent from `documentTypes.Item` in
        // system.json, and world migration reports a surviving one as an
        // unrecognized type. Advertising it here made every `type: trait` note
        // pass the whitelist and then die on a missing builder (#1504).
        expect(itemTypes().has("trait")).toBe(false);
        expect(BUILDERS["trait"]).toBeUndefined();
        expect(DEFAULT_ITEM_ART).not.toHaveProperty("trait");
    });

    it("keeps the registry in step with the per-type default art", () => {
        // The third list that could drift (#1504): default item artwork.
        expect(Object.keys(DEFAULT_ITEM_ART).sort()).toEqual(
            [...itemTypes()].sort(),
        );
    });

    it("pairs each type with its own entry from the one art map (#7)", () => {
        // Art travels with the builder now, so a consumer's own item type can
        // bring art of its own. For *this* registry that must change nothing:
        // every entry's `img` is still the value `DEFAULT_ITEM_ART` holds, which
        // is what keeps this build and `SohlItem.getDefaultArtwork` reading one
        // map (SoHL#932/#1510).
        const art = DEFAULT_ITEM_ART as Record<string, string>;
        for (const [type, entry] of Object.entries(BUILDERS)) {
            expect((entry as { img: string }).img, type).toBe(art[type]);
        }
    });
});

describe("itemBuilder (lookup that fails loudly)", () => {
    it("returns the registered builder for a known type", () => {
        // Resolved from configuration, which in this repository *is* this
        // registry — so the identity check proves the dispatch reaches the
        // table the repository declared, not a copy of it (#1563).
        //
        // Compared against the registry as *Node* loads it, not the static
        // import above. The engine resolves the configuration with `require`
        // so that reading a configured value stays synchronous (#2); in a
        // plain Node process that shares one module instance with `import`,
        // but under vitest the module runner serves the static import from
        // its own graph, so the two spellings are two copies of one file. The
        // property under test is about the runtime, so it is asserted against
        // the runtime's copy.
        const registry = createRequire(import.meta.url)(
            "../sohl/item-builders.mjs",
        ).ITEM_BUILDERS as Record<string, unknown>;
        // The resolved configuration holds the entries' `system` builders, not
        // the entries themselves — `itemBuilder` has always returned something
        // callable, and the paired shape (#7) did not change that.
        expect(itemBuilder("skill")).toBe(
            (registry["skill"] as { system: unknown }).system,
        );
        expect(itemBuilder("weapongear")).toBe(
            (registry["weapongear"] as { system: unknown }).system,
        );
        // …and that copy is the same table, key for key, as the one this
        // suite imported.
        expect(Object.keys(registry).sort()).toEqual(
            Object.keys(BUILDERS).sort(),
        );
    });

    it("throws a named error for an unregistered type", () => {
        // The old failure was `BUILDERS[type] is not a function`, swallowed as a
        // per-file compile error; an unregistered type now names itself.
        expect(() => itemBuilder("trait")).toThrow(/no builder.*trait/i);
        expect(() => itemBuilder("nonesuch")).toThrow(/no builder/i);
    });
});

describe("the art a compiled sohl item actually gets (#7)", () => {
    /**
     * The Item compiler, against this repository's own configuration.
     *
     * `contentBase` is the fixtures directory rather than the configured
     * content tree: this repository ships no content of its own, and the
     * compiler's constructor insists the tree exist. Nothing here walks it —
     * `buildEntry` is handed its frontmatter directly.
     *
     * Anchored on *this package's* root rather than the configured one. Those
     * were the same directory until the development configuration moved into
     * `tests/fixtures/repo/` to have a `package.json` to derive its identity
     * from (#50); where the fixtures live is a fact about this repository's
     * layout, not about whatever tree a configuration happens to point at.
     */
    function compiler() {
        const config = loadPackConfig();
        return new Items({
            contentBase: path.join(PKG_ROOT, "tests/fixtures"),
            dest: config.paths.packJson,
        });
    }

    /** A `skill` note with no `img:` — the case the default is for. */
    const SKILL_FM = {
        id: "DDDDDDDDDDDDDDDD",
        type: "skill",
        shortcode: "awar",
        name: { full: "Awareness" },
        sohl: { subType: "physical", archetype: null },
    };

    it("is the map's entry, exactly as before the art moved", () => {
        // Routing art through configuration must not change a single compiled
        // path for this package. `DEFAULT_ITEM_ART` holds already-served
        // `systems/sohl/…` paths, which `resolveImg` returns untouched, so the
        // value here is the map's value and not an asset-root rewrite of it.
        const entry = compiler().buildEntry(SKILL_FM, "");

        expect(entry.img).toBe(DEFAULT_ITEM_ART.skill);
        expect(entry.img).toBe("systems/sohl/assets/icons/other/head-gear.svg");
    });

    it("still lets a note override it", () => {
        const entry = compiler().buildEntry(
            { ...SKILL_FM, img: "systems/sohl/assets/icons/custom.svg" },
            "",
        );

        expect(entry.img).toBe("systems/sohl/assets/icons/custom.svg");
    });
});
