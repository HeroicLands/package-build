/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Two pieces of tooling that every consuming repository held a copy of.
 *
 * Both are policy rather than per-package behaviour — how an icon follows the
 * reader's colour scheme, and what a deployment's root says about indexing and
 * redirects — so a copy per consumer was a copy free to drift, and the copies
 * did. The cases below pin the behaviour the copies shared, which is the whole
 * of what they were for.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { injectAdaptiveFill, transform } from "../engine/svg-theme.mjs";
import { headers, redirects, landingPath, writeSiteRoot } from "../engine/site-root.mjs";
import { BUILT_IN_ASSET_TRANSFORMS, resolveAssetTransform } from "../config.mjs";

describe("an icon follows the reader's colour scheme", () => {
    it("paints a default-black shape, and says so for both schemes", () => {
        const out = injectAdaptiveFill('<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>');

        expect(out).toContain("prefers-color-scheme:dark");
        expect(out).toContain("#211d16");
        expect(out).toContain("#ece3cf");
    });

    // Re-theming would stack a second rule on every rebuild.
    it("is idempotent", () => {
        const once = injectAdaptiveFill("<svg><path/></svg>");
        expect(injectAdaptiveFill(once)).toBe(once);
    });

    // An inline declaration beats a `<style>` rule, so the result would be a
    // half-recoloured icon — worse than an unthemed one.
    it("leaves a file whose shapes set fill inline", () => {
        const svg = '<svg><path style="fill:#c00" d="M0 0"/></svg>';
        expect(injectAdaptiveFill(svg)).toBe(svg);
    });

    it("leaves a shape painted some other colour", () => {
        const out = injectAdaptiveFill('<svg><path fill="#fff"/></svg>');
        expect(out).not.toContain('fill="#fff"'.replace("#fff", "#211d16"));
    });

    it("stages a non-SVG unchanged, by declining to transform it", () => {
        expect(transform("/somewhere/portrait.webp")).toBeNull();
    });
});

describe("a transform is named, or it is a path", () => {
    it("resolves a built-in name to the module this package ships", () => {
        const resolved = resolveAssetTransform("svg-theme", "/repo");

        expect(resolved.endsWith(path.join("engine", "svg-theme.mjs"))).toBe(true);
        expect(fs.existsSync(resolved)).toBe(true);
        expect(Object.keys(BUILT_IN_ASSET_TRANSFORMS)).toContain("svg-theme");
    });

    // A consumer with a transform of its own is unaffected.
    it("resolves anything else against the repository root", () => {
        expect(resolveAssetTransform("./utils/mine.mjs", "/repo")).toBe(
            path.resolve("/repo", "./utils/mine.mjs"),
        );
    });
});

describe("a deployment's root files", () => {
    // Pages matches the raw path, before any trailing-slash handling, so the
    // two spellings are distinct keys and one rule does not catch the other.
    it("redirects both spellings of the prefix root to the landing", () => {
        const out = redirects("thalorna");

        expect(out).toContain(`/thalorna/   ${landingPath("thalorna")}   301`);
        expect(out).toContain(`/thalorna    ${landingPath("thalorna")}   301`);
    });

    it("suppresses indexing on every host-assigned address", () => {
        const out = headers("thalorna");

        expect(out).toContain("https://:project.pages.dev/*");
        expect(out).toContain("https://:version.:project.pages.dev/*");
        expect(out).toContain("https://:package.pkg.heroiclands.org/*");
        expect(out.match(/X-Robots-Tag: noindex/g)).toHaveLength(3);
    });

    // A 301 with no lifetime is cached by a browser indefinitely, on the
    // most-linked URL there is.
    it("pins a lifetime on the redirect", () => {
        expect(headers("thalorna")).toContain("Cache-Control: max-age=3600");
    });

    it("writes both files beside the rendered site", () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-root-"));
        fs.mkdirSync(path.join(out, "kethira"), { recursive: true });
        fs.writeFileSync(path.join(out, "kethira", "index.html"), "<html></html>");

        const { files } = writeSiteRoot({ pkg: "kethira", out });

        expect(files.map((f) => path.basename(f)).sort()).toEqual(["_headers", "_redirects"]);
        expect(fs.readFileSync(path.join(out, "_redirects"), "utf8")).toContain("/kethira/");
    });

    // Writing root files over an unbuilt site would publish a deployment with
    // nothing under the prefix.
    it("refuses when no site has been rendered", () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-root-"));
        expect(() => writeSiteRoot({ pkg: "kethira", out })).toThrow(/no rendered site/);
    });
});
