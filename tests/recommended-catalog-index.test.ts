/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A recommended dependency that supplies an item catalogue has a content
 * index the lint reads.**
 *
 * The compile resolves an embedded `model:` address through the extracted
 * catalogue of every relationship declaring `itemCatalog: true`, whatever its
 * kind. The lint resolves the same address through the content index, so the
 * index of such a relationship is fetched and read as well. A `recommends`
 * entry without the flag is advisory and stays unfetched.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { metadataRelationships } from "../engine/metadata-index.mjs";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");
const MANIFEST = "https://example.org/system.json";

/**
 * A package that stamps content for `sohl` and recommends it, with the given
 * extra keys on the recommends entry.
 */
function fixture(entryKeys: string, withCache: boolean) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "recommended-catalog-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: recommendedcat000 }
systems:
  sohl:
    manifest: ${MANIFEST}
    compatibility: { verified: "0.8.8" }
relationships:
  recommends:
    - id: sohl
      type: system
      manifest: ${MANIFEST}
      compatibility: { verified: "0.8.8" }
${entryKeys}
packs:
  - { name: actors, type: Actor }
publish: {}
`,
    );
    fs.mkdirSync(path.join(root, "assets/content/Beings"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "assets/content/Home.md"),
        "---\nshortcode: home\nname: { full: Demo }\ntype: homepage\n---\n\nA home page.\n",
    );
    fs.writeFileSync(
        path.join(root, "assets/content/Beings/Guard.md"),
        [
            "---",
            "shortcode: guard",
            "name: { full: Guard }",
            "type: being",
            "sohl:",
            "  items:",
            "    - model: sohl-sohl-skill-awar",
            "    - model: sohl-sohl-skill-awer",
            "---",
            "",
            "A guard.",
            "",
        ].join("\n"),
    );
    if (withCache) {
        const cache = path.join(root, "build/cache/metadata/sohl@0.8.8");
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(
            path.join(cache, "sohl-metadata.jsonl"),
            JSON.stringify({
                package: "sohl",
                type: "skill",
                shortcode: "awar",
                name: { full: "Awareness" },
                address: { slug: "skill-awar", canonical: "sohl-sohl-skill-awar" },
                anchors: [],
                documentation: null,
            }) + "\n",
        );
        fs.writeFileSync(path.join(cache, ".complete"), "");
    }
    return root;
}

function lint(root: string) {
    const result = spawnSync(process.execPath, [CLI, "lint"], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

describe("which relationships have a content index", () => {
    const config = (entry: object) =>
        ({
            relationships: { recommends: [{ id: "sohl", manifest: MANIFEST, ...entry }] },
        }) as never;

    it("includes a recommends entry declaring itemCatalog", () => {
        expect(metadataRelationships(config({ itemCatalog: true })).map((r) => r.id)).toEqual([
            "sohl",
        ]);
    });

    it("leaves a recommends entry without itemCatalog out", () => {
        expect(metadataRelationships(config({}))).toEqual([]);
        expect(metadataRelationships(config({ itemCatalog: false }))).toEqual([]);
    });

    it("keeps contentIndex: false authoritative over itemCatalog", () => {
        expect(metadataRelationships(config({ itemCatalog: true, contentIndex: false }))).toEqual(
            [],
        );
    });

    it("lists a relationship once when its kind is also a gating kind", () => {
        const both = {
            relationships: { systems: [{ id: "sohl", manifest: MANIFEST, itemCatalog: true }] },
        } as never;
        expect(metadataRelationships(both).map((r) => r.id)).toEqual(["sohl"]);
    });
});

describe("the lint of a package that recommends a system and embeds its items", () => {
    it(
        "resolves the embedded items and locates the misspelt one",
        () => {
            const root = fixture("      itemCatalog: true", true);
            try {
                const output = lint(root);
                expect(output).toMatch(
                    /^assets\/content\/Beings\/Guard\.md:\d+:\d+: error: `sohl\.items\.1\.model` names sohl-sohl-skill-awer, which does not resolve/m,
                );
                expect(output).not.toContain("sohl-sohl-skill-awar,");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "asks for a fetch when the declared catalogue's index is cold",
        () => {
            const root = fixture("      itemCatalog: true", false);
            try {
                expect(lint(root)).toContain("sohl is a declared dependency but its content index");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "does not read an index for a recommends entry without itemCatalog",
        () => {
            const root = fixture("", false);
            try {
                expect(lint(root)).not.toContain("content index has not been fetched");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
