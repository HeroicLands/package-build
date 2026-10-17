/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "../assets/preview/gitea-theme.js"), "utf8");

function browser(initial: string) {
    let scheme = initial;
    let mutation: () => void = () => {};
    const listeners = new Map<string, () => void>();
    const classes = new Set(["hl-preview", "hl-preview-light"]);
    const node = {
        classList: {
            toggle(name: string, on: boolean) {
                if (on) classes.add(name);
                else classes.delete(name);
            },
        },
    };
    const selectors: string[] = [];
    const document = {
        documentElement: {},
        querySelectorAll(selector: string) {
            selectors.push(selector);
            return [node];
        },
        addEventListener(name: string, callback: () => void) {
            listeners.set(name, callback);
        },
    };
    vm.runInNewContext(source, {
        document,
        getComputedStyle: () => ({ getPropertyValue: () => scheme }),
        MutationObserver: class {
            constructor(callback: () => void) {
                mutation = callback;
            }
            observe() {}
        },
    });
    return {
        classes,
        selectors,
        change(value: string) {
            scheme = value;
            mutation();
        },
        listeners,
    };
}

describe("Gitea preview theme selection", () => {
    it("uses the active Gitea theme, then follows theme changes", () => {
        const page = browser("true");
        expect(page.classes.has("hl-preview-dark")).toBe(true);
        expect(page.classes.has("hl-preview-light")).toBe(false);
        page.change("false");
        expect(page.classes.has("hl-preview-light")).toBe(true);
        expect(page.classes.has("hl-preview-dark")).toBe(false);
        expect(page.selectors.every((s) => s === ".markup.markdown .hl-preview")).toBe(true);
        expect(page.listeners.has("load")).toBe(true);
        expect(page.listeners.has("DOMContentLoaded")).toBe(true);
    });

    it("keeps an explicit renderer mode when a custom theme declares no scheme", () => {
        const page = browser("");
        expect(page.classes.has("hl-preview-light")).toBe(true);
        page.change("true");
        page.change("");
        expect(page.classes.has("hl-preview-dark")).toBe(true);
    });
});
