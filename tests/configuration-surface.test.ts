/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The configuration inventory the documentation guards share is not vacuous:
 * every probe returns keys, and known keys and closed sets are present.
 */

import { describe, it, expect } from "vitest";
import {
    configurationChoices,
    configurationKeyGroups,
    configurationKeys,
    configurationSurface,
} from "./helpers/configuration-surface.js";

describe("the configuration surface inventory", () => {
    it("reads a non-empty key list from every probe", () => {
        const groups = configurationKeyGroups();
        expect(groups.length).toBeGreaterThan(30);
        for (const group of groups) {
            expect(group.keys.length, group.path || "top level").toBeGreaterThan(0);
        }
    });

    it("holds known keys by dotted path", () => {
        const paths = configurationSurface().map((key) => key.path);
        expect(paths.length).toBeGreaterThan(150);
        expect(paths).toContain("contentPackage");
        expect(paths).toContain("pdf.fonts.serif");
        expect(paths).toContain("packageBuild.container.stages.<name>.port");
    });

    it("refuses a group it has no probe for", () => {
        expect(() => configurationKeys("no.such.group")).toThrow();
    });

    it("holds the closed value sets", () => {
        const sets = configurationChoices();
        for (const path of ["packageKind", "packs[].type", "authors[].role"]) {
            expect(sets.find((set) => set.path === path)?.values.length, path).toBeGreaterThan(1);
        }
    });
});
