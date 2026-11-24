/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The command inventory the documentation guards share is not vacuous: it
 * holds known commands with their invocations, placeholders and options.
 */

import { describe, it, expect } from "vitest";
import { commandSurface } from "./helpers/command-surface.js";

const surface = commandSurface();
const byInvocation = (invocation: string) =>
    surface.find((entry) => entry.invocation === invocation);

describe("the command surface inventory", () => {
    it("holds more commands than a sanity floor", () => {
        expect(surface.length).toBeGreaterThan(40);
        expect(surface.filter((entry) => entry.path.length === 1).length).toBeGreaterThan(30);
    });

    it("holds known commands by invocation", () => {
        for (const invocation of [
            "package-build clean",
            "package-build pdf",
            "package-build site-root",
            "package-build content-format schema",
        ]) {
            expect(byInvocation(invocation), invocation).toBeDefined();
        }
    });

    it("lists a command's subcommands by invocation", () => {
        const parent = byInvocation("package-build content-format");
        expect(parent?.subcommands).toEqual(
            expect.arrayContaining([
                "package-build content-format schema",
                "package-build content-format fields",
            ]),
        );
    });

    it("carries placeholders, options and choices", () => {
        expect(surface.some((entry) => entry.placeholders.length > 0)).toBe(true);
        expect(surface.some((entry) => entry.options.length > 0)).toBe(true);
        expect(surface.some((entry) => entry.choices.length > 0)).toBe(true);
        expect(byInvocation("package-build deps")?.placeholders).toContain("<action>");
    });
});
