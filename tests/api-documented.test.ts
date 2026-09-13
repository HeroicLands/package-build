/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `docs/api.md` documents every export of every subpath entry, and this makes
 * that assertion executable.
 *
 * The real export surface is generated at runtime — each subpath entry is
 * imported and its `Object.keys()` taken — and diffed against the document
 * text, so a new export or a renamed one fails here rather than going
 * unnoticed. Nothing here enumerates the surface by hand: the list a
 * consumer actually gets from `import` is the list this test checks.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const API_DOC = fs.readFileSync(path.join(ROOT, "docs", "api.md"), "utf8");

/**
 * Every export name in the document: a table row's first cell for a flat
 * export, or a `### \`engine.ids\`` heading's member name for a namespace
 * re-export (`engine`, `sohl` and `hm3` re-export whole modules, not
 * individual functions, so those names never appear as table rows).
 */
function documentedNames(): Set<string> {
    const names = new Set<string>();
    for (const match of API_DOC.matchAll(/^\|\s*`([A-Za-z0-9_$]+)`\s*\|/gm)) {
        names.add(match[1]);
    }
    for (const match of API_DOC.matchAll(/^### `(?:engine|sohl|hm3)\.([A-Za-z0-9_$]+)`/gm)) {
        names.add(match[1]);
    }
    return names;
}

const DOCUMENTED = documentedNames();

/** A genuine ESM module namespace object (`export * as x from "..."`). */
function isModuleNamespace(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        Object.prototype.toString.call(value) === "[object Module]"
    );
}

/**
 * Subpath entries with a fixed import specifier — every entry in
 * `package.json`'s `exports` map except the two wildcard patterns
 * (`./engine/*`, `./sohl/*`, `./hm3/*`) and `./package.json`, which is not a
 * JavaScript module.
 */
const MODULE_SUBPATHS = Object.keys(PACKAGE_JSON.exports).filter(
    (entry) => !entry.endsWith("*") && entry !== "./package.json",
);

const WILDCARD_SUBPATHS = Object.keys(PACKAGE_JSON.exports).filter((entry) => entry.endsWith("*"));

describe("docs/api.md documents the real export surface", () => {
    it("parses a document that still has export tables to read", () => {
        // Guards the guard: a reshaped table would otherwise make every
        // assertion below vacuously pass.
        expect(DOCUMENTED.size).toBeGreaterThan(100);
        expect(DOCUMENTED.has("defineConfig")).toBe(true);
    });

    it("covers exactly the subpath entries package.json declares", () => {
        // A new subpath entry (or a renamed one) must be documented here as
        // its own section, not merely mentioned in passing.
        expect(MODULE_SUBPATHS).toEqual([
            ".",
            "./engine",
            "./sohl",
            "./hm3",
            "./content-config",
            "./config",
            "./prettier",
            "./markdownlint",
            "./bundle",
            "./container",
            "./coverage",
            "./deploy",
            "./e2e",
            "./lang",
            "./manifest",
            "./release",
            "./stage",
            "./templates",
        ]);
        for (const entry of MODULE_SUBPATHS) {
            const heading = entry === "." ? "`.` —" : `\`${entry}\``;
            expect(API_DOC, entry).toContain(heading);
        }
    });

    it("documents the wildcard entries as their own reachable modules", () => {
        expect(WILDCARD_SUBPATHS).toEqual(["./engine/*", "./sohl/*", "./hm3/*"]);
        expect(API_DOC).toContain("@heroiclands/package-build/engine/<module>");
        expect(API_DOC).toContain("@heroiclands/package-build/sohl/being-info");
        expect(API_DOC).toContain("@heroiclands/package-build/hm3/item-fields");
    });

    it("mentions ./package.json, which carries no JavaScript exports", () => {
        expect(API_DOC).toContain("`./package.json`");
    });

    for (const subpath of MODULE_SUBPATHS) {
        it(`documents every export of \`${subpath}\``, async () => {
            const specifier =
                subpath === "." ?
                    "@heroiclands/package-build"
                :   `@heroiclands/package-build/${subpath.slice(2)}`;
            const mod: Record<string, unknown> = await import(specifier);
            const missing = Object.keys(mod).filter((name) => !DOCUMENTED.has(name));
            expect(missing, subpath).toEqual([]);

            // A namespace re-export (`export * as ids from "./ids.mjs"`, as
            // `engine`, `sohl` and `hm3` are built from) groups a whole
            // module's own exports under one name — checking the namespace
            // name alone would miss a function disappearing from inside it.
            for (const [name, value] of Object.entries(mod)) {
                if (!isModuleNamespace(value)) continue;
                const missingMembers = Object.keys(value).filter(
                    (member) => !DOCUMENTED.has(member),
                );
                expect(missingMembers, `${subpath} -> ${name}`).toEqual([]);
            }
        });
    }
});
