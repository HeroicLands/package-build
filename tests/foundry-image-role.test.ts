/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A Foundry journal image carries its role and its pixels too.
 *
 * The book and the website both read a per-build asset index that already
 * carries the full corpus; a Foundry journal's body renders through a
 * markdown-it singleton configured once, at import, with no such index to
 * thread through later. `engine/helpers.mjs` answers that by reading the
 * package's own asset tree lazily and caching the answer for the process,
 * exactly as it already does for the build configuration — these cases pin
 * that it actually reaches the rendered `<img>`, not only that the function
 * exists.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A minimal repository `renderFoundryMarkdown` can resolve pictures against. */
function makeRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-image-role-"));
    fs.writeFileSync(
        path.join(dir, "package.json"),
        // `foundryPackage` is derived from here, never declared in the data
        // configuration — `configFromData` refuses the key outright.
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(dir, "package-build.config.yaml"),
        [
            "contentPackage: sohl",
            "packageKind: modules",
            "compatibility:",
            '    minimum: "14.359"',
            "stats:",
            "    lastModifiedBy: sohlbuilder00000",
            "packs:",
            "    - name: items",
            "      type: Item",
        ].join("\n") + "\n",
    );
    return dir;
}

/** A tiny valid PNG, 640×480. */
function pngBytes(width: number, height: number): Buffer {
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(13, 0);
    const type = Buffer.from("IHDR", "ascii");
    const w = Buffer.alloc(4);
    w.writeUInt32BE(width, 0);
    const h = Buffer.alloc(4);
    h.writeUInt32BE(height, 0);
    return Buffer.concat([signature, length, type, w, h]);
}

/** Load `renderFoundryMarkdown` in a fresh module registry, config included. */
async function freshRenderer(configFile: string) {
    vi.resetModules();
    vi.stubEnv("PACKAGE_BUILD_CONFIG", configFile);
    const { renderFoundryMarkdown } = await import("../engine/helpers.mjs");
    return renderFoundryMarkdown;
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe("a Foundry journal image carries its role and its pixels", () => {
    it("carries the role as a class and the pixels as attributes", async () => {
        const dir = makeRepo();
        try {
            const imageDir = path.join(dir, "assets", "images");
            fs.mkdirSync(imageDir, { recursive: true });
            fs.writeFileSync(
                path.join(imageDir, "provenance.yaml"),
                ["attribution: Tom Rodriguez", "license: CC-BY-SA-4.0", "role: portrait"].join(
                    "\n",
                ),
            );
            fs.writeFileSync(path.join(imageDir, "thorn.png"), pngBytes(640, 480));

            const render = await freshRenderer(path.join(dir, "package-build.config.yaml"));
            const html = render("![A portrait](images/thorn.png)\n");
            expect(html).toContain("note-image-role-portrait");
            expect(html).toContain('width="640" height="480"');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("keys the bare, own-package address the same as a package-qualified one", async () => {
        const dir = makeRepo();
        try {
            const imageDir = path.join(dir, "assets", "images");
            fs.mkdirSync(imageDir, { recursive: true });
            fs.writeFileSync(
                path.join(imageDir, "provenance.yaml"),
                ["attribution: Tom Rodriguez", "license: CC-BY-SA-4.0", "role: emblem"].join("\n"),
            );
            fs.writeFileSync(path.join(imageDir, "mark.png"), pngBytes(200, 200));

            const render = await freshRenderer(path.join(dir, "package-build.config.yaml"));
            const bare = render("![A mark](images/mark.png)\n");
            const qualified = render("![A mark](sohl/assets/images/mark.png)\n");
            expect(bare).toContain("note-image-role-emblem");
            expect(bare).toBe(qualified);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("carries no role class for a picture declaring none, with its pixels still attached", async () => {
        const dir = makeRepo();
        try {
            const imageDir = path.join(dir, "assets", "images");
            fs.mkdirSync(imageDir, { recursive: true });
            fs.writeFileSync(path.join(imageDir, "map.png"), pngBytes(800, 600));

            const render = await freshRenderer(path.join(dir, "package-build.config.yaml"));
            const html = render("![A map](images/map.png)\n");
            expect(html).not.toContain("note-image-role-");
            expect(html).toContain('width="800" height="600"');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("draws an icon-type picture with blank dimensions, having no pixel count", async () => {
        const dir = makeRepo();
        try {
            const iconDir = path.join(dir, "assets", "icons");
            fs.mkdirSync(iconDir, { recursive: true });
            fs.writeFileSync(path.join(iconDir, "anvil.svg"), "<svg/>");

            const render = await freshRenderer(path.join(dir, "package-build.config.yaml"));
            const html = render("![An anvil](icons/anvil.svg)\n");
            expect(html).toContain('width="" height=""');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
