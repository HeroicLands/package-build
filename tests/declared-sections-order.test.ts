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
import { describe, it, expect } from "vitest";

import { insertDeclaredSections } from "../engine/declared-sections.mjs";

describe("insertDeclaredSections", () => {
    const sections = [
        { slug: "settlements", heading: "Settlements", markdown: "first table" },
        { slug: "settlementindex", heading: "Settlement index", markdown: "second table" },
    ];

    it("keeps declared order when no section is authored", () => {
        const { markdown } = insertDeclaredSections("Intro", sections);
        const lines = markdown.split("\n");
        expect(lines.indexOf("# Settlements {#settlements}")).toBeGreaterThan(-1);
        expect(lines.indexOf("# Settlements {#settlements}")).toBeLessThan(
            lines.indexOf("# Settlement index {#settlementindex}"),
        );
    });

    it("keeps declared order ahead of the generated boundary", () => {
        const { markdown } = insertDeclaredSections("Intro\n# Within", sections, {
            generatedFrom: 1,
        });
        const lines = markdown.split("\n");
        const settlements = lines.indexOf("# Settlements {#settlements}");
        expect(settlements).toBeGreaterThan(0);
        expect(settlements).toBeLessThan(lines.indexOf("# Settlement index {#settlementindex}"));
        expect(lines.indexOf("# Settlement index {#settlementindex}")).toBeLessThan(
            lines.indexOf("# Within"),
        );
    });
});
