/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadArtPackage } from "../engine/art-package.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const expected = { name: "@example/art", version: "1.0.0", contentPackage: "sample" };
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-package-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "images"));
    fs.mkdirSync(path.join(root, "icons"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(expected));
    const rows: any[] = [
        {
            package: "sample",
            type: "image",
            shortcode: "first",
            address: { canonical: "sample-none-image-first" },
            asset: {
                path: "images/first.webp",
                ai: true,
                nonAiAlternative: "other-none-icon-replacement",
                attribution: "Artist",
                license: "CC0-1.0",
            },
        },
        {
            package: "sample",
            type: "icon",
            shortcode: "second",
            address: { canonical: "sample-none-icon-second" },
            asset: {
                path: "icons/second.svg",
                ai: false,
                attribution: "Artist",
                license: "CC0-1.0",
            },
        },
        {
            package: "sample",
            type: "image",
            shortcode: "third",
            address: { canonical: "sample-none-image-third" },
            asset: {
                path: "images/first.webp",
                ai: null,
                attribution: "Artist",
                license: "CC0-1.0",
            },
        },
    ];
    const descriptor: any = {
        formatVersion: 1,
        contentPackage: "sample",
        index: { path: "index.jsonl", sha256: "" },
        assets: [
            { path: "images/first.webp", sha256: digest(webp) },
            { path: "icons/second.svg", sha256: digest(svg) },
        ],
    };
    fs.writeFileSync(path.join(root, "images/first.webp"), webp);
    fs.writeFileSync(path.join(root, "icons/second.svg"), svg);
    function save() {
        const index = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
        fs.writeFileSync(path.join(root, "index.jsonl"), index);
        descriptor.index.sha256 = digest(index);
        fs.writeFileSync(path.join(root, "artwork.json"), JSON.stringify(descriptor));
    }
    save();
    return { root, rows, descriptor, save };
}

describe("installed artwork packages", () => {
    it("binds public rows to verified files and preserves AI states and cross-package alternatives", () => {
        const { root } = fixture();
        const result = loadArtPackage(root, expected);
        expect(result.records.map((row) => row.asset.ai)).toEqual([true, false, null]);
        expect(result.records[0].asset.nonAiAlternative).toMatchObject({
            package: "other",
            type: "icon",
        });
        expect(result.files.size).toBe(2);
        expect(loadArtPackage(root, expected)).toEqual(result);
    });
    it.each([
        [
            "unknown descriptor property",
            (f: any) => {
                f.descriptor.extra = 1;
            },
        ],
        [
            "wrong content package",
            (f: any) => {
                f.descriptor.contentPackage = "other";
            },
        ],
        [
            "wrong address",
            (f: any) => {
                f.rows[0].address.canonical = "other-none-image-first";
            },
        ],
        [
            "wrong type",
            (f: any) => {
                f.rows[0].type = "note";
            },
        ],
        [
            "duplicate address",
            (f: any) => {
                f.rows.push(structuredClone(f.rows[0]));
            },
        ],
        [
            "missing binding",
            (f: any) => {
                f.descriptor.assets.pop();
            },
        ],
        [
            "extra binding",
            (f: any) => {
                f.rows.splice(1, 1);
            },
        ],
        [
            "digest mismatch",
            (f: any) => {
                f.descriptor.assets[0].sha256 = "0".repeat(64);
            },
        ],
        [
            "private prompt",
            (f: any) => {
                f.rows[0].asset.prompt = "private";
            },
        ],
        [
            "private composition",
            (f: any) => {
                f.rows[0].asset.composition = {};
            },
        ],
        [
            "private master path",
            (f: any) => {
                f.rows[0].masterPath = "private/master.png";
            },
        ],
        [
            "invalid AI",
            (f: any) => {
                f.rows[0].asset.ai = "false";
            },
        ],
        [
            "absolute path",
            (f: any) => {
                f.descriptor.assets[0].path = "/tmp/first.webp";
            },
        ],
        [
            "traversal",
            (f: any) => {
                f.descriptor.assets[0].path = "../first.webp";
            },
        ],
        [
            "unsupported file",
            (f: any) => {
                f.descriptor.assets[0].path = "images/first.png";
            },
        ],
    ])("rejects %s", (_name, change) => {
        const f = fixture();
        change(f);
        f.save();
        expect(() => loadArtPackage(f.root, expected)).toThrow();
    });
    it("rejects a mismatched npm identity and missing files", () => {
        const f = fixture();
        expect(() => loadArtPackage(f.root, { ...expected, version: "2.0.0" })).toThrow();
        fs.unlinkSync(path.join(f.root, "icons/second.svg"));
        expect(() => loadArtPackage(f.root, expected)).toThrow();
    });
    it("rejects a PNG disguised as WebP even with a matching digest", () => {
        const f = fixture();
        const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
        fs.writeFileSync(path.join(f.root, "images/first.webp"), png);
        f.descriptor.assets[0].sha256 = digest(png);
        f.save();
        expect(() => loadArtPackage(f.root, expected)).toThrow(/format/);
    });
    it("rejects an escaped symlink and malformed JSONL", () => {
        const f = fixture();
        fs.unlinkSync(path.join(f.root, "images/first.webp"));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "art-outside-"));
        roots.push(outside);
        fs.writeFileSync(path.join(outside, "outside.webp"), webp);
        fs.symlinkSync(path.join(outside, "outside.webp"), path.join(f.root, "images/first.webp"));
        expect(() => loadArtPackage(f.root, expected)).toThrow();
        fs.unlinkSync(path.join(f.root, "images/first.webp"));
        fs.writeFileSync(path.join(f.root, "images/first.webp"), webp);
        fs.writeFileSync(path.join(f.root, "index.jsonl"), "{bad\n");
        f.descriptor.index.sha256 = digest("{bad\n");
        fs.writeFileSync(path.join(f.root, "artwork.json"), JSON.stringify(f.descriptor));
        expect(() => loadArtPackage(f.root, expected)).toThrow();
    });
});
