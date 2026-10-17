/*
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CURRENT_DATE, normalizeCurrentDate } from "../engine/current-date.mjs";
import { defineConfig } from "../content-config.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";

const config = (currentDate?: unknown) =>
    defineConfig({
        rootDir: "/repo",
        contentPackage: "demo",
        packageKind: "documentation",
        currentDate,
    });
describe("setting current date", () => {
    it("defaults consistently in pure normalization, configuration and site date context", () => {
        expect(DEFAULT_CURRENT_DATE).toBe("720.1");
        expect(normalizeCurrentDate()).toBe("720.1");
        expect(config().currentDate).toBe("720.1");
        expect(buildSiteIndex([], { package: "demo" }).dateContext.present).toBe("720.1");
    });
    it("preserves exact day digits and propagates explicit settings", () => {
        expect(normalizeCurrentDate("721.130")).toBe("721.130");
        expect(config("721.130").currentDate).toBe("721.130");
        expect(
            buildSiteIndex([], { package: "demo", currentDate: "721.130" }).dateContext.present,
        ).toBe("721.130");
    });
    it.each([
        null,
        720.1,
        "unknown",
        "0.1",
        "720.0",
        "720.1:250000",
        "datefrom commoncal 720 AF",
        "720/1/1",
        "~720.1",
    ])("refuses invalid or dependent explicit value %s", (value) => {
        expect(() => normalizeCurrentDate(value)).toThrow(/currentDate/);
        expect(() => config(value)).toThrow(/currentDate/);
    });
});
