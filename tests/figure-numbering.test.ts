/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **A figure is numbered once, with its role, for every target.** A `ref` to a
 * captioned map reads `Map N` wherever it is written: in the note's own page,
 * in Foundry, and from another note's page on the website. The parity corpus
 * holds the same-note case for every target; this holds the cross-note case,
 * which only the website resolves.
 */

import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import { configFromData } from "../engine/pack-config.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

import { builtPages } from "./helpers/built-pages";
import { copyFixture } from "./helpers/parity";

let root: string;

/** The pages the build published, by file name. */
let pages: Record<string, string> = {};

/** The published page of one note. */
function page(shortcode: string): string {
    const text = pages[`lore-${shortcode}.md`];
    if (!text) throw new Error(`no page was built for ${shortcode}`);
    return text;
}

beforeAll(async () => {
    root = copyFixture();
    fs.writeFileSync(
        path.join(root, "assets", "content", "Lore", "lore-cites.md"),
        [
            "---",
            "type: lore",
            "subType: concept",
            "shortcode: cites",
            "name:",
            "    full: The Citing Note",
            "---",
            "",
            'The coast is {{ref "lore-corpus#fig-coast"}} and the pennant {{ref "lore-corpus#fig-pennant"}}.',
            "",
        ].join("\n"),
    );
    const configPath = path.join(root, "package-build.config.yaml");
    const config = configFromData(YAML.parse(fs.readFileSync(configPath, "utf8")), configPath);
    const sqlTables = await prepareTreeSqlTables(config.paths.content, {
        skipDirectories: config.skipDirectories,
        config,
        audience: "public",
    });
    const built = buildSite({ config, sqlTables });
    pages = builtPages(built);
    expect(built.expressionErrors).toEqual([]);
}, 120_000);

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("a ref to a figure in another note's page", () => {
    it("reads the map's own label, as the map's page does", () => {
        expect(page("cites")).toContain("The coast is [Map 1](/parity/lore-corpus/#fig-coast)");
    });

    it("reads a picture's label as a Figure", () => {
        expect(page("cites")).toContain("the pennant [Figure 1](/parity/lore-corpus/#fig-pennant)");
    });

    it("agrees with the label the map's own page carries", () => {
        expect(page("corpus")).toContain('<p class="content-figure-label">Map 1: The coast.</p>');
    });
});
