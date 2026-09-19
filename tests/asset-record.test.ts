/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The `asset` record is complete, and says what it claims to say.
 *
 * **Completeness is derived, not listed.** `ASSET_RECORD_FIELDS` is the
 * emitter's own declaration — it builds every record by iterating it — and the
 * cases below read that same declaration rather than a hand-copied second list.
 * So a field removed from the emitter is a field removed from what the
 * specification's table is checked against, and the disagreement fails here
 * instead of shipping an index whose records quietly stopped carrying a licence.
 *
 * **A guard proves every field is named, never that a claim about one is
 * true**, so the cases after it sample: a record's `path` is walked back to a
 * file that exists, a sidecar replaces an inherited record rather than merging
 * over it, the ancestor walk stops at the type root, and an unknown key is a
 * finding rather than a silent drop.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
    ASSET_RECORD_FIELDS,
    PROVENANCE_FILE,
    PROVENANCE_KEYS,
    collectAssetRecords,
} from "../engine/asset-index.mjs";
import { ASSET_TYPES } from "../engine/asset-types.mjs";

const SPEC = fs.readFileSync(path.resolve(__dirname, "../docs/content-format.md"), "utf8");

/**
 * The fields the specification's asset-record table names.
 *
 * The narrow parse the other agreement guards use: a table whose first header
 * cell is `` `asset` field `` is that table, and a specification that grows a
 * differently-shaped one fails here rather than being read wrongly.
 */
function documentedAssetFields(): string[] {
    const table = SPEC.match(/^\|\s*`asset` field.*?\n\|[-\s|]+\n((?:\|.*\n)+)/m);
    return (table?.[1] ?? "")
        .trim()
        .split("\n")
        .map((row) => row.trim().replace(/^\|/, "").split("|")[0].trim().replace(/`/g, ""))
        .filter(Boolean);
}

/** A throwaway asset tree: `<root>/<dir>/<file>` plus whatever provenance. */
function assetTree(files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-assets-"));
    for (const [rel, body] of Object.entries(files)) {
        const full = path.join(base, ...rel.split("/"));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body, "utf8");
    }
    return base;
}

/** The record for one canonical address, or `undefined`. */
function recordFor(records: Record<string, any>[], canonical: string) {
    return records.find((r) => r.address?.canonical === canonical);
}

describe("the asset record names every field the emitter declares", () => {
    it("declares fields to check, so the comparison is not vacuous", () => {
        expect(ASSET_RECORD_FIELDS.length).toBeGreaterThan(1);
        expect(ASSET_RECORD_FIELDS.map((f) => f.name)).toContain("path");
    });

    it("emits exactly the declared fields on every record", () => {
        const base = assetTree({
            "icons/lorc/anvil.svg": "<svg/>",
            "images/beings/thorn.webp": "webp",
            "audio/swoosh.ogg": "ogg",
        });
        const records = collectAssetRecords(base, { contentPackage: "thalorna" });
        expect(records).toHaveLength(3);
        const declared = ASSET_RECORD_FIELDS.map((f) => f.name).sort();
        for (const record of records) {
            expect(Object.keys(record.asset).sort(), record.address.canonical).toEqual(declared);
        }
    });

    it("documents exactly the fields it emits", () => {
        // The half a derived list cannot cover on its own: the emitter and the
        // specification are two statements of one record, and either is free to
        // move without the other.
        expect(documentedAssetFields()).toEqual(ASSET_RECORD_FIELDS.map((f) => f.name));
    });

    it("admits exactly the provenance fields as provenance keys", () => {
        expect([...PROVENANCE_KEYS].sort()).toEqual(
            ASSET_RECORD_FIELDS.filter((f) => f.from === "provenance")
                .map((f) => f.name)
                .sort(),
        );
    });
});

describe("an address is derived from the file, and from nothing above it", () => {
    it("takes the type from the root and the shortcode from the filename", () => {
        const base = assetTree({
            "icons/game-icons/lorc/anvil.svg": "<svg/>",
            "images/beings/creatures/drake.webp": "webp",
            "audio/effects/swoosh1.ogg": "ogg",
        });
        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(records.map((r) => r.address.canonical).sort()).toEqual([
            "sohl-none-audio-swoosh1",
            "sohl-none-icon-anvil",
            "sohl-none-image-drake",
        ]);
    });

    it("records a path that walks back to the file, root included", () => {
        const base = assetTree({ "icons/game-icons/lorc/anvil.svg": "<svg/>" });
        const [record] = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(record.asset.path).toBe("icons/game-icons/lorc/anvil.svg");
        expect(fs.existsSync(path.join(base, ...record.asset.path.split("/")))).toBe(true);
    });

    it("publishes no page, so the address carries no slug", () => {
        const base = assetTree({ "icons/anvil.svg": "<svg/>" });
        const [record] = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(record.address.slug).toBeUndefined();
    });

    it("takes only the extensions its root declares", () => {
        // The filter that keeps a `provenance.yaml` from being read as an asset,
        // and a `NOTICE.md` or a `.DS_Store` from becoming an address.
        const base = assetTree({
            "icons/anvil.svg": "<svg/>",
            "icons/NOTICE.md": "notice",
            "icons/game-icons-codepoints.json": "{}",
            "icons/save.af": "af",
            [`icons/${PROVENANCE_FILE}`]: "attribution: Tom Rodriguez",
        });
        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(records.map((r) => r.address.canonical)).toEqual(["sohl-none-icon-anvil"]);
    });

    it("indexes nothing for a directory that is not a root", () => {
        const base = assetTree({ "ui/logo.webp": "webp", "fonts/plex.woff2": "font" });
        expect(collectAssetRecords(base, { contentPackage: "sohl" })).toEqual([]);
    });

    it("indexes nothing when the package ships no assets at all", () => {
        const base = path.join(os.tmpdir(), "cb-assets-absent", String(Date.now()));
        expect(collectAssetRecords(base, { contentPackage: "sohl" })).toEqual([]);
    });
});

describe("two files under one root cannot claim one address", () => {
    it("fails the build, naming both", () => {
        const base = assetTree({
            "icons/lorc/anvil.svg": "<svg/>",
            "icons/delapouite/anvil.svg": "<svg/>",
        });
        expect(() => collectAssetRecords(base, { contentPackage: "sohl" })).toThrow(/anvil/);
    });

    it("reports it rather than throwing when a reader supplies `problems`", () => {
        const base = assetTree({
            "icons/lorc/anvil.svg": "<svg/>",
            "icons/delapouite/anvil.svg": "<svg/>",
        });
        const problems: any[] = [];
        const records = collectAssetRecords(base, { contentPackage: "sohl", problems });
        expect(records).toHaveLength(1);
        expect(problems).toHaveLength(1);
        expect(problems[0].severity).toBe("error");
        expect(problems[0].message).toMatch(/anvil/);
    });

    it("lets one basename sit in two roots, which are two namespaces", () => {
        const base = assetTree({ "icons/anvil.svg": "<svg/>", "images/anvil.webp": "webp" });
        const records = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(records.map((r) => r.address.canonical).sort()).toEqual([
            "sohl-none-icon-anvil",
            "sohl-none-image-anvil",
        ]);
    });

    it("refuses a filename that is not a shortcode", () => {
        const base = assetTree({ "images/ibm-plex-mono-v20.webp": "webp" });
        expect(() => collectAssetRecords(base, { contentPackage: "sohl" })).toThrow(/shortcode/);
    });
});

describe("provenance resolves per address", () => {
    it("inherits the nearest `provenance.yaml` from an ancestor", () => {
        const base = assetTree({
            [`icons/noun/${PROVENANCE_FILE}`]: [
                "attribution: The Noun Project",
                "source: https://thenounproject.com/",
                "license: LicenseRef-NounProject-Pro",
                "notes: Obtained under a subscription.",
            ].join("\n"),
            "icons/noun/deep/anvil.svg": "<svg/>",
        });
        const [record] = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(record.asset.attribution).toBe("The Noun Project");
        expect(record.asset.license).toBe("LicenseRef-NounProject-Pro");
    });

    it("stops the walk at the type root", () => {
        // A record above the root would speak for trees it says nothing about,
        // so `assets/provenance.yaml` reaches no address.
        const base = assetTree({
            [PROVENANCE_FILE]: "attribution: Nobody",
            "icons/anvil.svg": "<svg/>",
        });
        const [record] = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(record.asset.attribution).toBe("");
    });

    it("lets a sidecar replace an inherited record wholesale", () => {
        const base = assetTree({
            [`icons/${PROVENANCE_FILE}`]: [
                "attribution: Tom Rodriguez",
                "license: CC-BY-SA-4.0",
                "notes: everything in this tree",
            ].join("\n"),
            "icons/anvil.svg": "<svg/>",
            "icons/anvil.svg.yaml": "attribution: Lorc",
        });
        const [record] = collectAssetRecords(base, { contentPackage: "sohl" });
        expect(record.asset.attribution).toBe("Lorc");
        // Replaced, not merged: the inherited licence does not survive, which is
        // the whole reason a sidecar is written.
        expect(record.asset.license).toBe("");
        expect(record.asset.notes).toBe("");
    });

    it("states every field, blank where nothing records one", () => {
        const base = assetTree({ "images/thorn.webp": "webp" });
        const [record] = collectAssetRecords(base, { contentPackage: "harnensemble" });
        for (const field of ASSET_RECORD_FIELDS) {
            expect(typeof record.asset[field.name], field.name).toBe("string");
        }
        expect(record.asset.attribution).toBe("");
    });

    it("reports an unknown key rather than dropping it", () => {
        // `licence` beside `license` is otherwise an attribution record that
        // looks complete and carries nothing.
        const base = assetTree({
            [`icons/${PROVENANCE_FILE}`]: "licence: CC-BY-SA-4.0",
            "icons/anvil.svg": "<svg/>",
        });
        const problems: any[] = [];
        const records = collectAssetRecords(base, { contentPackage: "sohl", problems });
        expect(records).toHaveLength(1);
        expect(problems).toHaveLength(1);
        expect(problems[0].message).toMatch(/licence/);
        expect(problems[0].file).toContain(PROVENANCE_FILE);
        expect(problems[0].line).toBe(1);
    });
});

describe("the roots are a closed list", () => {
    it("declares one root per type, and each root one type", () => {
        const roots = ASSET_TYPES.map((entry) => entry.root);
        const types = ASSET_TYPES.map((entry) => entry.type);
        expect(new Set(roots).size).toBe(roots.length);
        expect(new Set(types).size).toBe(types.length);
    });

    it("declares no font root, because a font has no address", () => {
        expect(ASSET_TYPES.map((entry) => entry.root)).not.toContain("fonts");
        expect(ASSET_TYPES.map((entry) => entry.type)).not.toContain("font");
    });
});
