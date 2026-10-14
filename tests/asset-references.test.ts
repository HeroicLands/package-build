/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every asset reference in a compiled document states its address, and an
 * asset the package does not ship is drawn by its stand-in.
 *
 * The table of path fields is read from `ASSET_PATH_FIELDS`, so a document type
 * added there is exercised here without a second list.
 */

import { describe, it, expect } from "vitest";

import {
    ASSET_PATH_FIELDS,
    annotateAssetReferences,
    annotateHtml,
    assetReferenceLookup,
} from "../engine/asset-references.mjs";
import { resolvePathname } from "../engine/pathnames.mjs";

const CONFIG = {
    contentPackage: "thalorna",
    foundryPackage: "thalorna",
    packageKind: "modules",
    assetRoot: "modules/thalorna/assets",
    systems: { sohl: {} },
    site: { assets: "https://cdn.example.org" },
};

/** One asset record, as the content index carries it. */
function asset(pkg: string, type: string, path: string, license: string, ai: boolean) {
    const shortcode = path
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, "");
    return {
        package: pkg,
        type,
        shortcode,
        address: { canonical: `${pkg}-none-${type}-${shortcode}` },
        asset: { path, license, ai, attribution: "A" },
    };
}

const SHIPPED = asset("thalorna", "icon", "icons/game/anvil.svg", "CC-BY-3.0", false);
const MACHINE = asset("thalorna", "image", "images/beings/thorn.webp", "CC-BY-SA-4.0", true);
const MACHINE_ICON = asset("thalorna", "icon", "icons/beings/thornhead.webp", "CC-BY-SA-4.0", true);
const STAND_IN = asset("thalorna", "image", "images/missing.webp", "CC0-1.0", false);
/** A fetched dependency's entry, which carries no `address` block of its own. */
const { address: _foreignAddress, ...FOREIGN } = asset(
    "sohl",
    "icon",
    "icons/other/sack.svg",
    "CC-BY-3.0",
    false,
);

const LINK_INDEX = {
    assets: new Map(
        [SHIPPED, MACHINE, MACHINE_ICON, STAND_IN].map((r) => [r.address.canonical, r]),
    ),
    foreign: new Map([["sohl-none-icon-sack", FOREIGN]]),
};

const lookup = assetReferenceLookup(LINK_INDEX, CONFIG);

/** Annotate, collecting findings. */
function annotate(doc: Record<string, any>, type: string) {
    const findings: string[] = [];
    annotateAssetReferences(doc, type, {
        lookup,
        system: "sohl",
        report: (m: string) => findings.push(m),
    });
    return findings;
}

describe("Foundry and the website address a picture in the deployed layout", () => {
    it("flattens an own picture to `<root>/<basename>` under the install", () => {
        const forms = resolvePathname("images/beings/thorn.webp", CONFIG)!;
        expect(forms.foundry).toBe("modules/thalorna/images/thorn.webp");
        expect(forms.web).toBe("https://cdn.example.org/thalorna/images/thorn.webp");
        expect(forms.local).toBe("assets/images/beings/thorn.webp");
        expect(forms.pdf).toBe("assets/images/beings/thorn.webp");
    });

    it("flattens another package's picture under its own install", () => {
        expect(resolvePathname("sohl/assets/icons/other/sack.svg", CONFIG)!.foundry).toBe(
            "systems/sohl/icons/sack.svg",
        );
    });

    it("keeps a non-picture path under `assets/`", () => {
        expect(resolvePathname("audio/ambient/wind.ogg", CONFIG)!.foundry).toBe(
            "modules/thalorna/assets/audio/ambient/wind.ogg",
        );
    });
});

describe("path fields state their address in `flags.<system>.assets`", () => {
    it("covers every document type the table names", () => {
        expect(Object.keys(ASSET_PATH_FIELDS).sort()).toEqual(
            [
                "ActiveEffect",
                "Actor",
                "Item",
                "JournalEntryPage",
                "Macro",
                "RollTable",
                "TableResult",
            ].sort(),
        );
    });

    it("flags an actor's `img` and its token's `texture.src` as nested objects", () => {
        const doc: Record<string, any> = {
            img: "modules/thalorna/icons/anvil.svg",
            prototypeToken: { texture: { src: "modules/thalorna/icons/anvil.svg" } },
            flags: { sohl: { other: 1 } },
        };
        expect(annotate(doc, "Actor")).toEqual([]);
        expect(doc.flags).toEqual({
            sohl: { other: 1, assets: { img: "thalorna-none-icon-anvil" } },
        });
        expect(doc.prototypeToken.flags).toEqual({
            sohl: { assets: { texture: { src: "thalorna-none-icon-anvil" } } },
        });
        expect(JSON.stringify(doc)).not.toMatch(/"texture\.src"/);
    });

    it("flags embedded items and effects, each on itself", () => {
        const doc: Record<string, any> = {
            img: null,
            items: [
                {
                    img: "systems/sohl/icons/sack.svg",
                    effects: [{ img: "modules/thalorna/icons/anvil.svg" }],
                },
            ],
        };
        annotate(doc, "Actor");
        expect(doc.flags).toBeUndefined();
        expect(doc.items[0].flags.sohl.assets.img).toBe("sohl-none-icon-sack");
        expect(doc.items[0].effects[0].flags.sohl.assets.img).toBe("thalorna-none-icon-anvil");
    });

    it("flags a table result and a journal image page", () => {
        const table: Record<string, any> = {
            img: "modules/thalorna/icons/anvil.svg",
            results: [{ img: "systems/sohl/icons/sack.svg" }],
        };
        annotate(table, "RollTable");
        expect(table.flags.sohl.assets.img).toBe("thalorna-none-icon-anvil");
        expect(table.results[0].flags.sohl.assets.img).toBe("sohl-none-icon-sack");

        const journal: Record<string, any> = {
            pages: [
                { type: "image", src: "modules/thalorna/icons/anvil.svg" },
                { type: "text", src: "modules/thalorna/icons/anvil.svg" },
            ],
        };
        annotate(journal, "JournalEntry");
        expect(journal.pages[0].flags.sohl.assets.src).toBe("thalorna-none-icon-anvil");
        expect(journal.pages[1].flags).toBeUndefined();
    });

    it("leaves a path naming no asset alone", () => {
        const doc: Record<string, any> = { img: "icons/svg/mystery-man.svg" };
        annotate(doc, "Item");
        expect(doc).toEqual({ img: "icons/svg/mystery-man.svg" });
    });

    it("does not change a `flags` block shared with the note it came from", () => {
        const authored = { sohl: { kept: true } };
        const doc: Record<string, any> = {
            img: "modules/thalorna/icons/anvil.svg",
            flags: authored,
        };
        annotate(doc, "Item");
        expect(authored).toEqual({ sohl: { kept: true } });
    });
});

describe("compiled HTML states each picture's address", () => {
    it("adds `data-asset` to an `<img>` naming an asset", () => {
        const html = annotateHtml(
            '<p><img src="modules/thalorna/icons/anvil.svg" alt="Anvil"></p>',
            lookup,
            () => {},
        );
        expect(html).toBe(
            '<p><img src="modules/thalorna/icons/anvil.svg" alt="Anvil" data-asset="thalorna-none-icon-anvil"></p>',
        );
    });

    it("annotates HTML anywhere in a document, embedded documents included", () => {
        const doc: Record<string, any> = {
            system: { description: '<img src="systems/sohl/icons/sack.svg" />' },
            pages: [
                { type: "text", text: { content: '<img src="modules/thalorna/icons/anvil.svg">' } },
            ],
        };
        annotate(doc, "JournalEntry");
        expect(doc.system.description).toBe(
            '<img src="systems/sohl/icons/sack.svg" data-asset="sohl-none-icon-sack" />',
        );
        expect(doc.pages[0].text.content).toContain('data-asset="thalorna-none-icon-anvil"');
    });

    it("walks past frozen values no `<img>` sits in", () => {
        const doc: Record<string, any> = {
            system: { seat: Object.freeze({ package: "thalorna", type: "place" }) },
            img: "modules/thalorna/icons/anvil.svg",
        };
        expect(() => annotate(doc, "Item")).not.toThrow();
        expect(doc.flags.sohl.assets.img).toBe("thalorna-none-icon-anvil");
    });

    it("states the address as the index key renders it, whatever shape the record holds", () => {
        const parsed = { ...SHIPPED, address: { canonical: { package: "thalorna" } } };
        const own = assetReferenceLookup(
            { assets: new Map([["thalorna-none-icon-anvil", parsed]]) },
            CONFIG,
        );
        expect(own.byPath.get("modules/thalorna/icons/anvil.svg")?.address).toBe(
            "thalorna-none-icon-anvil",
        );
    });

    it("leaves an `<img>` naming no asset alone", () => {
        const html = '<img src="https://example.org/a.png">';
        expect(annotateHtml(html, lookup, () => {})).toBe(html);
    });
});

describe("an excluded asset is drawn by its package's stand-in", () => {
    it("points the field at the stand-in and keeps the excluded address", () => {
        const doc: Record<string, any> = {
            pages: [{ type: "image", src: "modules/thalorna/images/thorn.webp" }],
        };
        expect(annotate(doc, "JournalEntry")).toEqual([]);
        expect(doc.pages[0].src).toBe("modules/thalorna/images/missing.webp");
        expect(doc.pages[0].flags.sohl.assets.src).toBe("thalorna-none-image-thorn");
    });

    it("points an `<img>` at the stand-in and keeps the excluded address", () => {
        const html = annotateHtml(
            '<img src="modules/thalorna/images/thorn.webp">',
            lookup,
            () => {},
        );
        expect(html).toBe(
            '<img src="modules/thalorna/images/missing.webp" data-asset="thalorna-none-image-thorn">',
        );
    });

    it("is a finding when the package ships no stand-in of that type", () => {
        const doc: Record<string, any> = { img: "modules/thalorna/icons/thornhead.webp" };
        const findings = annotate(doc, "Actor");
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatch(/thalorna-none-icon-thornhead/);
        expect(findings[0]).toMatch(/thalorna-none-icon-missing/);
        expect(doc.flags.sohl.assets.img).toBe("thalorna-none-icon-thornhead");
    });
});
