/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The markup a `:::figure` fence emits must be styled in the shared theme.
 *
 * A fence is a numbered, referable block, and its label is the part a reader
 * is meant to see. Unstyled, the label reads as an ordinary paragraph of body
 * text and the number says nothing — a failure no build reports, because the
 * page renders.
 *
 * The vocabulary comes from `engine/content-figures.mjs`:
 *
 *   1. {@link FENCE} and {@link LABEL}, the two classes every fence carries.
 *   2. Every kind's class, so a kind added upstream is covered here. A kind
 *      is styled by naming it or by the base rule that catches them all.
 *   3. Every class an author may write, from `FIGURE_CLASSES` — each of which
 *      asks for a drawing of its own, since an author writes one to change
 *      how the fence looks.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { FIGURE_CLASSES, FIGURE_NAMES } from "../engine/content-figures.mjs";

import { rules, styled } from "./helpers/theme-css.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** The stylesheet. */
const SHEET = path.join(ROOT, "hugo-theme", "static", "css", "style.css");

/** The class every fence carries. */
const FENCE = "content-figure";

/** The class its label paragraph carries. */
const LABEL = "content-figure-label";

const kindClasses = Object.keys(FIGURE_NAMES).map((kind) => `${FENCE}-${kind}`);

describe("the theme's figure-fence styling", () => {
    const styles = rules(fs.readFileSync(SHEET, "utf8"));

    it("finds the kinds and authored classes it is guarding", () => {
        // A broken import would make every case below vacuously pass.
        expect(kindClasses.length).toBeGreaterThan(0);
        expect(FIGURE_CLASSES.length).toBeGreaterThan(0);
    });

    it(`names .${FENCE}`, () => {
        expect(styled(styles, FENCE)).toBe(true);
    });

    it(`names .${LABEL}`, () => {
        expect(styled(styles, LABEL)).toBe(true);
    });

    // A kind needs no rule of its own as long as the base rule draws it, so
    // this only matters when the base rule is itself unstyled — asking that
    // one of the two is true, so adding a kind upstream cannot land a fence
    // nothing styles.
    it.each(kindClasses)("%s is drawn by the base rule or one of its own", (className) => {
        const baseStyled = styled(styles, FENCE);
        expect(baseStyled || styled(styles, className)).toBe(true);
    });

    it.each(FIGURE_CLASSES)("an author's .%s is drawn on a fence", (className) => {
        expect(styled(styles, [FENCE, className])).toBe(true);
    });
});
