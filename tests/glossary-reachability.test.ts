/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Dictionary and glossary entries link only to pages a reader can reach.
 *
 * The homepage leads to a culture whose glossary names a word of a language.
 * Nothing leads to the language, so the entry's link to the word is plain text
 * until a reachable page leads there.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cacheNavigation, fixtureConfig } from "./helpers/parity";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "reach-site");
const CLI = path.join(HERE, "..", "bin", "package-build.mjs");

const made: string[] = [];

const note = (frontmatter: string, body: string) => `---\n${frontmatter}---\n\n${body}\n`;

function build(extra: Record<string, string>) {
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "glossary-reach-")));
    made.push(scratch);
    fs.cpSync(FIXTURE, scratch, { recursive: true });
    fs.appendFileSync(
        path.join(scratch, "package-build.config.yaml"),
        "languages:\n    tongue: { tag: art-x-tongue, note: skill-tongue }\n",
    );
    const content = path.join(scratch, "assets", "content");
    fs.appendFileSync(path.join(content, "homepage.md"), "\nAlso [Folk](lore-folk/).\n");
    for (const [name, text] of Object.entries(extra))
        fs.writeFileSync(path.join(content, name), text);
    cacheNavigation(fixtureConfig(scratch));
    const run = spawnSync(process.execPath, [CLI, "site", "build"], {
        cwd: scratch,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: "" },
    });
    return { run, site: path.join(scratch, "build", "site", "reachdemo") };
}

const page = (site: string, slug: string) =>
    fs.readFileSync(path.join(site, slug, "index.html"), "utf8");

const language = note(
    "type: skill\nsubType: language\nshortcode: tongue\nname:\n  full: Tongue\n" +
        "data:\n  words:\n    - form: zethu\n      gloss: a scribe\n      class: n\n      field: Court\n",
    "The Tongue.",
);
const culture = (link: string) =>
    note(
        "type: lore\nsubType: culture\nshortcode: folk\nname:\n  full: Folk\n" +
            "data:\n  lang: tongue\n  glossary:\n    - name: zethu\n",
        link,
    );

let unlinked: ReturnType<typeof build>;
let linked: ReturnType<typeof build>;

beforeAll(() => {
    unlinked = build({ "tongue.md": language, "folk.md": culture("The Folk.") });
    linked = build({
        "tongue.md": language,
        "folk.md": culture("The Folk."),
        "bravo.md": note(
            "type: doc\nshortcode: bravo\nname:\n  full: Bravo\n",
            "Bravo leads to [[skill-tongue|Tongue]].",
        ),
    });
}, 240_000);

afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

describe("dictionary and glossary entries", () => {
    it("build", () => {
        expect(unlinked.run.stderr).toBe("");
        expect(unlinked.run.status).toBe(0);
    });

    it("name a word of a language nothing leads to as plain text", () => {
        const html = page(unlinked.site, "lore-folk");
        expect(html).toContain("zethu");
        expect(html).not.toMatch(/href="[^"]*skill-tongue/);
    });

    it("link the word once a reachable page leads to its language", () => {
        expect(page(linked.site, "lore-folk")).toMatch(/href="[^"]*skill-tongue/);
    });

    it("do not make the language reachable", () => {
        const xml = fs.readFileSync(path.join(unlinked.site, "sitemap.xml"), "utf8");
        expect(xml).toContain("lore-folk");
        expect(xml).not.toContain("skill-tongue");
    });
});
