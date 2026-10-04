/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The shared theme's table of what each picture role draws at must name every
 * role the content toolchain emits, and every directive that states its own
 * width must clear that table rather than be clamped by it.
 *
 * The vocabulary comes from `engine/asset-index.mjs` and
 * `engine/content-images.mjs`, so a role added there fails this case until the
 * stylesheet gives it a slot — the alternative being a role that renders at
 * whatever the previous one happened to set, which no page shows as broken.
 *
 * What it asserts:
 *
 *   1. Some `.note-image` rule reads {@link SLOT}, so a declared table is a
 *      table the stylesheet actually sizes from.
 *   2. Every role class sets {@link SLOT}.
 *   3. Every class carrying a width of its own — a named `size=`, or the
 *      `full-width` directive — resets {@link SLOT}, because a stated width
 *      overrides a role's slot outright.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { ASSET_ROLES } from "../engine/asset-index.mjs";
import {
    IMAGE_CLASSES,
    IMAGE_FIGURE_CLASS,
    IMAGE_SIZES,
    roleClass,
} from "../engine/content-images.mjs";

import { declares, rules } from "./helpers/theme-css.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** The stylesheet holding the table. */
const SHEET = path.join(ROOT, "hugo-theme", "static", "css", "style.css");

/** The custom property a role's slot is stated as, and read from. */
const SLOT = "--note-image-slot";

/** The classes a picture carries when it states a width of its own. */
const widthClasses = [
    ...IMAGE_SIZES.filter((size) => size !== "auto").map((size) => `note-image-size-${size}`),
    ...Object.values(IMAGE_CLASSES).map((spec) => spec.class),
];

describe("the theme's image-role table", () => {
    const styles = rules(fs.readFileSync(SHEET, "utf8"));

    it("finds the roles and width classes it is guarding", () => {
        // A broken import would make every case below vacuously pass.
        expect(ASSET_ROLES.length).toBeGreaterThan(0);
        expect(widthClasses.length).toBeGreaterThan(0);
    });

    it(`some .${IMAGE_FIGURE_CLASS} rule reads var(${SLOT})`, () => {
        const readsSlot = styles.some(
            (rule) =>
                rule.selector.includes(`.${IMAGE_FIGURE_CLASS}`) &&
                rule.body.includes(`var(${SLOT}`),
        );
        expect(readsSlot).toBe(true);
    });

    it.each(ASSET_ROLES)("role %s states a slot", (role) => {
        const className = roleClass(role);
        expect(declares(styles, className, SLOT)).toBe(true);
    });

    it.each(widthClasses)("%s clears the slot a role would otherwise set", (className) => {
        expect(declares(styles, className, SLOT)).toBe(true);
    });
});
