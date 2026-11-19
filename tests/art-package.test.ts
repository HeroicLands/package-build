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
import { serializeContentIndex } from "../engine/content-index.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { writeDerivativeProvenance } from "../engine/art-provenance.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
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
                path: "images/third.svg",
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
        assets: [],
    };
    for (const row of rows) {
        const address = row.address.canonical;
        const bytes = writeDerivativeProvenance(
            row.type === "icon" || row.shortcode === "third" ? svg : webp,
            { address, creator: "Artist", rights: "Terms", derivedFrom: address },
            { repeat: ["derivedFrom"] },
        ).bytes;
        fs.writeFileSync(path.join(root, row.asset.path), bytes);
        descriptor.assets.push({ path: row.asset.path, sha256: digest(bytes) });
    }
    function save() {
        const decoded = rows.map((row) =>
            decodeIndexAddresses(structuredClone(row), { package: "sample" }),
        );
        const index = serializeContentIndex(decoded);
        fs.writeFileSync(path.join(root, "index.jsonl"), index);
        descriptor.index.sha256 = digest(index);
        fs.writeFileSync(path.join(root, "artwork.json"), JSON.stringify(descriptor));
    }
    function replace(file: string, bytes: Buffer | string) {
        fs.writeFileSync(path.join(root, file), bytes);
        descriptor.assets.find((entry: any) => entry.path === file).sha256 = digest(bytes);
    }
    save();
    return { root, rows, descriptor, save, replace };
}

describe("installed artwork packages", () => {
    it("reads the standard serializer, validates identity and preserves AI and alternatives", async () => {
        const { root } = fixture();
        const result = await loadArtPackage(root, expected);
        expect(result.records.map((row) => row.asset.ai)).toEqual([true, false, null]);
        expect(result.records[0].asset.nonAiAlternative).toMatchObject({
            package: "other",
            type: "icon",
        });
        expect(result.files.size).toBe(3);
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
        [
            "wrong creator",
            (f: any) => {
                f.rows[0].asset.attribution = "Wrong";
            },
        ],
        [
            "wrong embedded address",
            (f: any) => {
                f.rows[0].address.canonical = "sample-none-image-other";
                f.rows[0].shortcode = "other";
            },
        ],
        [
            "shared file with another identity",
            (f: any) => {
                f.rows[2].asset.path = f.rows[0].asset.path;
                f.descriptor.assets.pop();
            },
        ],
    ])("rejects %s", async (_name, change) => {
        const f = fixture();
        change(f);
        f.save();
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
    });
    it("requires authoritative public-note verification when derivative metadata names a note", async () => {
        const f = fixture();
        const address = "sample-none-icon-second";
        const bytes = writeDerivativeProvenance(
            svg,
            {
                address,
                creator: "Artist",
                rights: "Terms",
                derivedFrom: address,
                name: "Public subject",
                primaryNote: "sample-sohl-being-subject",
            },
            { repeat: ["derivedFrom", "name", "primaryNote"], notePublic: true },
        ).bytes;
        f.replace("icons/second.svg", bytes);
        f.save();
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow(/public note/);
        await expect(
            loadArtPackage(f.root, {
                ...expected,
                validatePublicNote: (key, metadata) =>
                    key === address &&
                    metadata.primaryNote === "sample-sohl-being-subject" &&
                    metadata.name === "Public subject",
            }),
        ).resolves.toBeDefined();
    });
    it("rejects mismatched npm identity and missing files", async () => {
        const f = fixture();
        await expect(loadArtPackage(f.root, { ...expected, version: "2.0.0" })).rejects.toThrow();
        fs.unlinkSync(path.join(f.root, "icons/second.svg"));
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
    });
    it.each([
        ["empty WebP", Buffer.from("524946460400000057454250", "hex")],
        ["corrupt WebP", Buffer.from("524946461000000057454250565038200400000000000000", "hex")],
        ["PNG named WebP", Buffer.from("89504e470d0a1a0a00000000", "hex")],
        ["WebP trailing data", Buffer.concat([webp, Buffer.from("secret")])],
    ])("rejects %s with correct digest", async (_name, bytes) => {
        const f = fixture();
        f.replace("images/first.webp", bytes);
        f.save();
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
    });
    it.each([
        ["missing metadata", svg],
        [
            "private prompt",
            '<metadata id="hl-provenance"><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:hl="https://heroiclands.org/ns/1.0/" hl:prompt="secret"/></rdf:RDF></x:xmpmeta></metadata>',
        ],
        ["unsafe resource", '<image href="file:///etc/passwd"/>'],
        ["foreign metadata", "<metadata><secret>private</secret></metadata>"],
    ])("rejects %s in an SVG with correct digest", async (_name, fragment) => {
        const f = fixture();
        const file = "icons/second.svg";
        const current = fs.readFileSync(path.join(f.root, file), "utf8");
        f.replace(
            file,
            _name === "missing metadata" ? fragment : (
                current.replace("</svg>", `${fragment}</svg>`)
            ),
        );
        f.save();
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
    });
    it("rejects a corrupt image payload even when its public provenance and digest are valid", async () => {
        const f = fixture();
        const address = "sample-none-image-first";
        const corrupt = Buffer.from("524946461000000057454250565038200400000000000000", "hex");
        const bytes = writeDerivativeProvenance(
            corrupt,
            { address, creator: "Artist", rights: "Terms", derivedFrom: address },
            { repeat: ["derivedFrom"] },
        ).bytes;
        f.replace("images/first.webp", bytes);
        f.save();
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow(/payload/);
    });
    it.each(["EXIF", "foreign", "trailing"])(
        "rejects WebP %s with a correct digest",
        async (kind) => {
            const f = fixture();
            const file = "images/first.webp";
            const original = fs.readFileSync(path.join(f.root, file));
            let changed: Buffer;
            if (kind === "trailing") changed = Buffer.concat([original, Buffer.from("private")]);
            else {
                const body = Buffer.from(kind === "EXIF" ? "private!" : "<foreign/>");
                const chunk = Buffer.alloc(8 + body.length + (body.length % 2));
                chunk.write(kind === "EXIF" ? "EXIF" : "XMP ", 0);
                chunk.writeUInt32LE(body.length, 4);
                body.copy(chunk, 8);
                changed = Buffer.concat([original, chunk]);
                changed.writeUInt32LE(changed.length - 8, 4);
            }
            f.replace(file, changed);
            f.save();
            await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
        },
    );
    it("rejects a symlink escape and malformed JSONL", async () => {
        const f = fixture();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "art-outside-"));
        roots.push(outside);
        fs.writeFileSync(path.join(outside, "outside.webp"), webp);
        fs.unlinkSync(path.join(f.root, "images/first.webp"));
        fs.symlinkSync(path.join(outside, "outside.webp"), path.join(f.root, "images/first.webp"));
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
        fs.unlinkSync(path.join(f.root, "images/first.webp"));
        const address = "sample-none-image-first";
        const restored = writeDerivativeProvenance(
            webp,
            { address, creator: "Artist", rights: "Terms", derivedFrom: address },
            { repeat: ["derivedFrom"] },
        ).bytes;
        fs.writeFileSync(path.join(f.root, "images/first.webp"), restored);
        fs.writeFileSync(path.join(f.root, "index.jsonl"), "{bad\n");
        f.descriptor.index.sha256 = digest("{bad\n");
        fs.writeFileSync(path.join(f.root, "artwork.json"), JSON.stringify(f.descriptor));
        await expect(loadArtPackage(f.root, expected)).rejects.toThrow();
    });
});
