/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `site-theme/data/banner-kinds.yaml` maps a page's note `type` and `subType` to
 * a banner name declared in `banners.yaml`. Two properties keep it honest: every
 * name it uses is declared, and every type and subType the note vocabulary
 * admits is mapped, so a new kind cannot reach a page without a decision about
 * its banner.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { describe, it, expect } from "vitest";

import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, "..", "site-theme", "data");

const banners = parse(fs.readFileSync(path.join(DATA_DIR, "banners.yaml"), "utf8")) as {
    available: string[];
};
const mapping = parse(fs.readFileSync(path.join(DATA_DIR, "banner-kinds.yaml"), "utf8")) as {
    categoryTypes: string[];
    kinds: Record<string, string | Record<string, string>>;
};

const vocabulary = NOTE_VOCABULARY as Record<string, { subTypes?: readonly string[] | null }>;

describe("the theme's banner-kind mapping", () => {
    it("names only banners that banners.yaml declares", () => {
        const names = Object.values(mapping.kinds).flatMap((v) =>
            typeof v === "string" ? [v] : Object.values(v),
        );
        const undeclared = [...new Set(names)].filter((n) => !banners.available.includes(n));
        expect(undeclared).toEqual([]);
    });

    it("maps every note type, or names it as taking its banner from its category", () => {
        const unmapped = Object.keys(vocabulary).filter(
            (type) => !(type in mapping.kinds) && !mapping.categoryTypes.includes(type),
        );
        expect(unmapped).toEqual([]);
    });

    it("maps every subType of a type that maps per subType", () => {
        const missing: string[] = [];
        for (const [type, value] of Object.entries(mapping.kinds)) {
            if (typeof value === "string") continue;
            for (const subType of vocabulary[type]?.subTypes ?? []) {
                if (!(subType in value)) missing.push(`${type}/${subType}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("maps no type or subType the vocabulary does not admit", () => {
        const stray: string[] = [];
        for (const [type, value] of Object.entries(mapping.kinds)) {
            if (!(type in vocabulary)) stray.push(type);
            if (typeof value === "string") continue;
            const admitted = vocabulary[type]?.subTypes ?? [];
            for (const subType of Object.keys(value))
                if (!admitted.includes(subType)) stray.push(`${type}/${subType}`);
        }
        expect(stray).toEqual([]);
    });
});
