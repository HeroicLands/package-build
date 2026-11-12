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

import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { collectArtMasters } from "../engine/art-masters.mjs";
import { writeProvenance, writeSvgProvenance } from "../engine/art-provenance.mjs";

const root = path.resolve("build/art-masters-test");
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it("indexes PNG and SVG identities and reports missing and duplicate identities", async () => {
    fs.mkdirSync(root, { recursive: true });
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
        .png()
        .toBuffer();
    const address = "sample-none-image-example";
    fs.writeFileSync(path.join(root, "one.png"), writeProvenance(png, { address }).bytes);
    fs.writeFileSync(
        path.join(root, "two.svg"),
        writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', {
            address: "sample-none-icon-example",
        }).bytes,
    );
    fs.writeFileSync(path.join(root, "ignored.webp"), Buffer.from("ignored"));
    let result = collectArtMasters([root], "sample");
    expect(result.findings).toEqual([]);
    expect([...result.masters.keys()].sort()).toEqual([address, "sample-none-icon-example"].sort());
    fs.renameSync(path.join(root, "one.png"), path.join(root, "renamed.png"));
    expect([...collectArtMasters([root], "sample").masters.keys()].sort()).toEqual(
        [...result.masters.keys()].sort(),
    );
    fs.writeFileSync(path.join(root, "missing.png"), png);
    fs.copyFileSync(path.join(root, "renamed.png"), path.join(root, "duplicate.png"));
    result = collectArtMasters([root], "sample");
    expect(result.findings).toHaveLength(3);
    expect(result.findings.filter((f) => f.message.includes("duplicate"))).toHaveLength(2);
});

it("refuses malformed addresses and derivative SVGs", () => {
    fs.mkdirSync(root, { recursive: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const valid = writeSvgProvenance(svg, {
        address: "sample-none-image-example",
    }).bytes.toString();
    fs.writeFileSync(
        path.join(root, "bad.svg"),
        valid.replaceAll("sample-none-image-example", "bad"),
    );
    fs.writeFileSync(
        path.join(root, "derived.svg"),
        writeSvgProvenance(svg, { address: "sample-none-image-example", derived: "true" }).bytes,
    );
    const result = collectArtMasters([root], "sample");
    expect(result.masters.size).toBe(0);
    expect(result.findings).toHaveLength(2);
});
