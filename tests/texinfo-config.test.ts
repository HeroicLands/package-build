/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `packageBuild.texinfo` declares the Texinfo manuals: a list of top pages,
 * each with an optional output name and title.
 */

import { describe, it, expect } from "vitest";

import { resolvePackageBuildConfig } from "../config.mjs";

const NO_INDICES = { commands: [], configuration: [], api: [] };

function resolve(texinfo?: unknown) {
    return resolvePackageBuildConfig({
        rootDir: "/repo",
        packageKind: "systems",
        foundryPackage: "acme",
        packageBuild: texinfo === undefined ? {} : { texinfo },
    }).texinfo;
}

describe("packageBuild.texinfo", () => {
    it("defaults to no manual", () => {
        expect(resolve()).toEqual([]);
    });

    it("resolves a page with its optional name and title", () => {
        expect(
            resolve([
                { page: "index.md", out: "guide", title: "The Guide" },
                { page: "reference/index.md" },
            ]),
        ).toEqual([
            { page: "index.md", out: "guide", title: "The Guide", indices: NO_INDICES },
            { page: "reference/index.md", out: null, title: null, indices: NO_INDICES },
        ]);
    });

    it("resolves the pages that fill the structural indexes", () => {
        expect(
            resolve([
                {
                    page: "index.md",
                    indices: { commands: "commands", configuration: ["config", "config", "keys"] },
                },
            ])[0].indices,
        ).toEqual({ commands: ["commands"], configuration: ["config", "keys"], api: [] });
    });

    it.each([
        [
            "indices that are not a mapping",
            [{ page: "a.md", indices: ["a"] }],
            /indices` must be a mapping/,
        ],
        [
            "an unknown index role",
            [{ page: "a.md", indices: { options: "a" } }],
            /indices\.options` is not a recognised key/,
        ],
        [
            "an empty list of pages",
            [{ page: "a.md", indices: { api: [] } }],
            /indices\.api` must name at least one page shortcode/,
        ],
        [
            "a page shortcode that is not a string",
            [{ page: "a.md", indices: { api: [3] } }],
            /indices\.api\[0\]` must be a non-empty string/,
        ],
    ])("refuses %s", (_, value, message) => {
        expect(() => resolve(value)).toThrow(message);
    });

    it.each([
        ["not a list", { page: "index.md" }, /`packageBuild\.texinfo` must be a list/],
        ["an entry that is not a mapping", ["index.md"], /texinfo\[0\]` must be a mapping/],
        [
            "an unknown key",
            [{ page: "a.md", base: "x" }],
            /texinfo\[0\]\.base` is not a recognised key/,
        ],
        ["no page", [{ out: "a" }], /texinfo\[0\]\.page` must be a non-empty string/],
        [
            "a page that is not Markdown",
            [{ page: "a.txt" }],
            /texinfo\[0\]\.page` must be a Markdown page path/,
        ],
        [
            "an absolute page",
            [{ page: "/a.md" }],
            /texinfo\[0\]\.page` must be a Markdown page path/,
        ],
        [
            "a page outside the tree",
            [{ page: "../a.md" }],
            /texinfo\[0\]\.page` must be a Markdown page path/,
        ],
        [
            "a repeated page",
            [{ page: "a.md" }, { page: "a.md" }],
            /texinfo\[1\]\.page` names `a\.md` more than once/,
        ],
        [
            "an output with an extension",
            [{ page: "a.md", out: "a.texi" }],
            /texinfo\[0\]\.out` must be a file name/,
        ],
        [
            "an output with a slash",
            [{ page: "a.md", out: "x/a" }],
            /texinfo\[0\]\.out` must be a file name/,
        ],
        [
            "a repeated output",
            [
                { page: "a.md", out: "m" },
                { page: "b.md", out: "m" },
            ],
            /texinfo\[1\]\.out` names `m` more than once/,
        ],
        [
            "an empty title",
            [{ page: "a.md", title: " " }],
            /texinfo\[0\]\.title` must be a non-empty string/,
        ],
    ])("refuses %s", (_, value, message) => {
        expect(() => resolve(value)).toThrow(message);
    });
});
