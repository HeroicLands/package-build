/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `resolveAssetReplacement` picks a declared replacement package's asset
 * record over the local one, by address.
 *
 * The four rules under test: scoped to asset types, ordered single-pass
 * application, never recursive, and a miss falls through to `null`.
 */

import { describe, expect, it, vi } from "vitest";

import { resolveAssetReplacement } from "../engine/asset-replacement.mjs";

/** An asset-record-shaped entry, as `loadForeignIndexes` would ingest it. */
function assetRecord(pkg: string, file: string) {
    return { package: pkg, asset: { path: file } };
}

describe("resolveAssetReplacement", () => {
    it("returns the replacement's record for an address it carries", () => {
        const index = new Map([
            ["thalorna-none-image-thorn", assetRecord("thalorna", "images/thorn.webp")],
            [
                "thalornaaltart-none-image-thorn",
                assetRecord("thalornaaltart", "images/thorn-alt.webp"),
            ],
        ]);
        const result = resolveAssetReplacement("thalorna-none-image-thorn", {
            localPackage: "thalorna",
            replacements: ["thalornaaltart"],
            index,
        });
        expect(result).toEqual({
            record: assetRecord("thalornaaltart", "images/thorn-alt.webp"),
            package: "thalornaaltart",
        });
    });

    it("tries replacements in declaration order and returns the first hit", () => {
        const index = new Map([
            ["thalorna-none-icon-anvil", assetRecord("thalorna", "icons/anvil.svg")],
            ["second-none-icon-anvil", assetRecord("second", "icons/anvil-second.svg")],
            ["first-none-icon-anvil", assetRecord("first", "icons/anvil-first.svg")],
        ]);
        const result = resolveAssetReplacement("thalorna-none-icon-anvil", {
            localPackage: "thalorna",
            // Declared in this order: "first" loses to nothing, so it wins
            // even though "second" also carries the address.
            replacements: ["second", "first"],
            index,
        });
        expect(result?.package).toBe("second");

        const reversed = resolveAssetReplacement("thalorna-none-icon-anvil", {
            localPackage: "thalorna",
            replacements: ["first", "second"],
            index,
        });
        expect(reversed?.package).toBe("first");
    });

    it("returns null for an address no replacement carries", () => {
        const index = new Map([
            ["thalorna-none-image-thorn", assetRecord("thalorna", "images/thorn.webp")],
        ]);
        const result = resolveAssetReplacement("thalorna-none-image-thorn", {
            localPackage: "thalorna",
            replacements: ["thalornaaltart"],
            index,
        });
        expect(result).toBeNull();
    });

    it("returns null for a non-asset-type address", () => {
        const index = new Map([
            ["thalornaaltart-none-being-thornak", assetRecord("thalornaaltart", "n/a")],
        ]);
        const result = resolveAssetReplacement("thalorna-none-being-thornak", {
            localPackage: "thalorna",
            replacements: ["thalornaaltart"],
            index,
        });
        expect(result).toBeNull();
    });

    it("returns null for an address whose package is not the local one", () => {
        const index = new Map([
            ["sohl-none-icon-anvil", assetRecord("sohl", "icons/anvil.svg")],
            [
                "thalornaaltart-none-icon-anvil",
                assetRecord("thalornaaltart", "icons/anvil-alt.svg"),
            ],
        ]);
        const result = resolveAssetReplacement("sohl-none-icon-anvil", {
            localPackage: "thalorna",
            replacements: ["thalornaaltart"],
            index,
        });
        expect(result).toBeNull();
    });

    it("declaring a replacement's target as itself, or as another replacement, does not loop", () => {
        const index = new Map([
            ["thalorna-none-image-thorn", assetRecord("thalorna", "images/thorn.webp")],
        ]);
        expect(
            resolveAssetReplacement("thalorna-none-image-thorn", {
                localPackage: "thalorna",
                replacements: ["thalorna"],
                index,
            }),
        ).toEqual({
            record: assetRecord("thalorna", "images/thorn.webp"),
            package: "thalorna",
        });
        expect(
            resolveAssetReplacement("thalorna-none-image-thorn", {
                localPackage: "thalorna",
                replacements: ["thalornaaltart", "thalorna"],
                index,
            }),
        ).toEqual({
            record: assetRecord("thalorna", "images/thorn.webp"),
            package: "thalorna",
        });
    });

    it("attempts no second rewrite on a replacement's own resolved address", () => {
        // A replacement's own output address is never itself looked up
        // against another replacement — resolving "thalornaaltart-none-…"
        // does not then ask whether "thalornaaltart2" replaces
        // "thalornaaltart". Instrumenting the index's own `get` proves the
        // property directly: exactly one lookup per candidate tried, and no
        // more, rather than the property merely happening to hold.
        const index = new Map([
            ["thalorna-none-image-thorn", assetRecord("thalorna", "images/thorn.webp")],
            [
                "thalornaaltart-none-image-thorn",
                assetRecord("thalornaaltart", "images/thorn-alt.webp"),
            ],
            [
                "thalornaaltart2-none-image-thorn",
                assetRecord("thalornaaltart2", "images/thorn-alt-2.webp"),
            ],
        ]);
        const get = vi.spyOn(index, "get");

        const result = resolveAssetReplacement("thalorna-none-image-thorn", {
            localPackage: "thalorna",
            // "missingpkg" misses first, "thalornaaltart" hits second. A
            // rewrite attempted on the hit's own address would add a third
            // call — for "thalornaaltart2-none-image-thorn" — even though
            // the loop already has its answer.
            replacements: ["missingpkg", "thalornaaltart", "thalornaaltart2"],
            index,
        });

        expect(result?.package).toBe("thalornaaltart");
        expect(get).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenNthCalledWith(1, "missingpkg-none-image-thorn");
        expect(get).toHaveBeenNthCalledWith(2, "thalornaaltart-none-image-thorn");
    });
});
