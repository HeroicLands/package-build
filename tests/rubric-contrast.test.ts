/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The rubric stays readable on every ground it is printed on.** Emphasis in
 * a rubric script is carried by colour alone, so its red is held to two
 * thresholds wherever a theme or stylesheet sets one:
 *
 * - **4.5:1 against each ground** text can sit on (WCAG 1.4.3);
 * - **1.75:1 against the body text**, so the emphasis survives for a reader who
 *   cannot tell red from the text's own colour (WCAG 1.4.1). WCAG's link
 *   technique asks 3:1 between a link and its text, which no red can reach
 *   while also holding 4.5:1 against the site's ground beside its light body
 *   text; 1.75:1 is the widest quarter-step every ground clears with headroom.
 *
 * Every rubric, text colour and ground is read from the file that ships it.
 * Foundry paints its own journal page, so its two grounds are Foundry's own
 * values, stated here: the light theme's parchment texture by its darkest
 * pixel, and the dark theme's `--color-cool-5`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { baseStylesheetSource } from "../engine/base-styles.mjs";
import { bookTypstPreamble } from "../engine/pdf-render.mjs";

const ROOT = path.resolve(__dirname, "..");

/** The least contrast between the rubric and any ground it sits on. */
const GROUND_RATIO = 4.5;

/** The least contrast between the rubric and the body text beside it. */
const TEXT_RATIO = 1.75;

/** A colour's relative luminance, by the WCAG 2 formula. */
const luminance = (hex: string) => {
    const values = hex
        .replace("#", "")
        .match(/../g)!
        .map((c) => parseInt(c, 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
};

/** The WCAG contrast ratio of two colours. */
const contrast = (a: string, b: string) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

/** One place a rubric is printed. */
type Theme = { name: string; rubric: string; text: string; grounds: Record<string, string> };

/** Each threshold a theme's rubric misses, in words. */
function rubricFindings(theme: Theme): string[] {
    const findings: string[] = [];
    for (const [name, ground] of Object.entries(theme.grounds)) {
        const ratio = contrast(theme.rubric, ground);
        if (ratio < GROUND_RATIO)
            findings.push(
                `${theme.name}: the rubric ${theme.rubric} is ${ratio.toFixed(2)}:1 on ${name} ${ground}, under ${GROUND_RATIO}:1`,
            );
    }
    const ratio = contrast(theme.rubric, theme.text);
    if (ratio < TEXT_RATIO)
        findings.push(
            `${theme.name}: the rubric ${theme.rubric} is ${ratio.toFixed(2)}:1 against the text ${theme.text}, under ${TEXT_RATIO}:1`,
        );
    return findings;
}

/** A six-digit hex colour, from a three- or six-digit one. */
const hex = (value: string) => {
    const digits = value.trim().replace("#", "").toLowerCase();
    return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
};

/** The custom properties a CSS block declares, by name. */
const properties = (block: string) =>
    Object.fromEntries(
        [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
            match[1],
            match[2].trim(),
        ]),
    );

/** The site theme's one palette: its `:root` block. */
function siteTheme(css: string): Theme {
    const root = /:root\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))![1];
    const props = properties(root);
    const grounds = Object.fromEntries(
        Object.entries(props)
            .filter(([name]) => /^--(?:bg(?:-[\w-]+)?|surface)$/.test(name))
            .map(([name, value]) => [name, hex(value)]),
    );
    return { name: "site", rubric: hex(props["--rubric"]), text: hex(props["--text"]), grounds };
}

/** The book's palette, from the Typst preamble. */
function bookTheme(preamble: string): Theme {
    const colour = (name: string) =>
        hex(
            new RegExp(`^#let book-${name} = rgb\\("(#[0-9a-fA-F]{3,6})"\\)$`, "m").exec(
                preamble,
            )![1],
        );
    return {
        name: "book",
        rubric: colour("rubric"),
        text: colour("ink"),
        grounds: { "the paper": colour("paper") },
    };
}

/**
 * Foundry's journal page, light and dark: `--color-dark-2` text on the
 * parchment texture's darkest pixel, and `--color-light-2` text on
 * `--color-cool-5`.
 */
const FOUNDRY = {
    light: { text: "#222222", ground: "#cbc9bc" },
    dark: { text: "#efe6d8", ground: "#0b0a13" },
};

/** The base stylesheet's two rubrics, from its `light-dark()` pair. */
function foundryThemes(css: string): Theme[] {
    const match =
        /--pb-rubric:\s*light-dark\(\s*(#[0-9a-fA-F]{3,6})\s*,\s*(#[0-9a-fA-F]{3,6})\s*\)/.exec(
            css,
        )!;
    return [
        {
            name: "Foundry light",
            rubric: hex(match[1]),
            text: FOUNDRY.light.text,
            grounds: { "the parchment": FOUNDRY.light.ground },
        },
        {
            name: "Foundry dark",
            rubric: hex(match[2]),
            text: FOUNDRY.dark.text,
            grounds: { "the page": FOUNDRY.dark.ground },
        },
    ];
}

const SITE_CSS = readFileSync(path.join(ROOT, "site-theme", "static", "css", "style.css"), "utf8");
const BASE_CSS = readFileSync(baseStylesheetSource(), "utf8");

const THEMES = [siteTheme(SITE_CSS), bookTheme(bookTypstPreamble()), ...foundryThemes(BASE_CSS)];

describe("the rubric", () => {
    it.each(THEMES.map((theme) => [theme.name, theme]))(
        "meets both thresholds on %s",
        (_, theme) => {
            expect(Object.keys(theme.grounds).length).toBeGreaterThan(0);
            expect(rubricFindings(theme)).toEqual([]);
        },
    );

    it("is the colour the shipped rules paint a rubric in", () => {
        const site = SITE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(site).toMatch(/\.emph-rubric\s*\{[^}]*color:\s*var\(--rubric\)/);
        expect(site).toMatch(/\.emph-overline\s*\{[^}]*text-decoration-line:\s*overline/);
        expect(site).toMatch(/\.script :is\(em, strong\)\s*\{[^}]*font-synthesis:\s*none/);
        const base = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(base).toMatch(/\.emph-rubric\s*\{[^}]*color:\s*var\(--pb-rubric\)/);
        expect(base).toMatch(/\.emph-overline\s*\{[^}]*text-decoration-line:\s*overline/);
        expect(base).toMatch(/\.script :is\(em, strong\)\s*\{[^}]*font-synthesis:\s*none/);
    });
});

describe("the guard", () => {
    const theme = (rubric: string): Theme => ({
        name: "fixture",
        rubric,
        text: "#c8d6e0",
        grounds: { "--bg": "#0f1923" },
    });

    it("refuses a rubric with too little contrast against its ground", () => {
        expect(rubricFindings(theme("#a32a1c"))).toEqual([
            "fixture: the rubric #a32a1c is 2.45:1 on --bg #0f1923, under 4.5:1",
        ]);
    });

    it("refuses a rubric too close to the body text in lightness", () => {
        expect(rubricFindings(theme("#f0a8a0"))).toEqual([
            "fixture: the rubric #f0a8a0 is 1.31:1 against the text #c8d6e0, under 1.75:1",
        ]);
    });

    it("reads every palette it is given", () => {
        expect(THEMES.map((each) => each.name)).toEqual([
            "site",
            "book",
            "Foundry light",
            "Foundry dark",
        ]);
        expect(Object.keys(THEMES[0].grounds)).toEqual(
            expect.arrayContaining(["--bg", "--bg-card", "--surface"]),
        );
    });
});
