/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `hugo-theme/data/banners.yaml` declares the shared theme's banner inventory,
 * and `partials/hero-banner.html` needs it well formed: a `dir` and `fallback`
 * to resolve against, and an `available` list the fallback itself belongs to —
 * its absence would turn one dead URL into every dead URL a resolved name
 * misses.
 *
 * This asserts only what the file states about itself. Whether a declared name
 * is actually published at the asset host is a reachability question this
 * suite does not ask — it would reach the network, which this suite never
 * does — and belongs to a build or deploy step that can reach the host instead.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { describe, it, expect } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const DATA_FILE = path.join(ROOT, "hugo-theme", "data", "banners.yaml");

describe("the theme's banner inventory", () => {
    const source = fs.readFileSync(DATA_FILE, "utf8");
    const data = parse(source) as {
        dir?: unknown;
        fallback?: unknown;
        available?: unknown;
    };

    it("declares a non-empty dir", () => {
        expect(typeof data.dir).toBe("string");
        expect(data.dir).not.toBe("");
    });

    it("declares a non-empty fallback", () => {
        expect(typeof data.fallback).toBe("string");
        expect(data.fallback).not.toBe("");
    });

    it("declares a non-empty list of available names", () => {
        expect(Array.isArray(data.available)).toBe(true);
        expect((data.available as unknown[]).length).toBeGreaterThan(0);
    });

    it("holds only non-empty strings in available", () => {
        const available = data.available as unknown[];
        expect(available.every((n) => typeof n === "string" && n !== "")).toBe(true);
    });

    it("declares no duplicate name", () => {
        const available = data.available as string[];
        const dupes = [...new Set(available.filter((n, i) => available.indexOf(n) !== i))];
        expect(dupes).toEqual([]);
    });

    it("keeps available sorted, so a diff shows what changed", () => {
        const available = data.available as string[];
        const unsorted = available.findIndex((n, i) => i > 0 && available[i - 1] > n);
        expect(unsorted).toBe(-1);
    });

    it("lists the fallback inside available, so an unlisted name resolves to something real", () => {
        const available = data.available as string[];
        const fallbackName = (data.fallback as string).replace(/\.[^./]+$/, "");
        expect(available).toContain(fallbackName);
    });
});
