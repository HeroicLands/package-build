/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { defineConfig } from "../index.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { prepareSitePreview } from "../engine/site-preview.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { openNotesDatabase, prepareSqlTables } from "../engine/sql-tables.mjs";

let root: string;
let file: string;
let source: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-preview-"));
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "assets/content/home.md"),
        "---\nshortcode: root\ntype: homepage\n---\n\nHome\n",
    );
    file = path.join(root, "assets/content/intro.md");
    source =
        "---\nshortcode: intro\nname: {full: Intro}\ntype: doc\nsubType: concept\n---\n\nHello.\n";
    fs.writeFileSync(file, source);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function config() {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [],
        publish: { site: "content", address: { prefix: "kb/" } },
        site: { assets: "https://cdn.example.org" },
    });
}

it("renders a saved page identically to the site writer and leaves the mount untouched", async () => {
    const conf = config();
    buildSite({ config: conf });
    const output = path.join(root, "build/hugo/content/kb/doc-intro.md");
    const published = matter(fs.readFileSync(output, "utf8"));
    const before = fs.readFileSync(output, "utf8");
    const preview = await prepareSitePreview({ config: conf });
    try {
        const result = await preview.render(file, source);
        expect(result).toMatchObject({
            ok: true,
            markdown: published.content,
            frontmatter: published.data,
        });
        expect(fs.readFileSync(output, "utf8")).toBe(before);
        expect(fs.readFileSync(file, "utf8")).toBe(source);
    } finally {
        await preview.close();
    }
});

it("uses live frontmatter and SQL only for the active note, and keeps failed renders private", async () => {
    const conf = config();
    const other = path.join(root, "assets/content/other.md");
    fs.writeFileSync(
        other,
        "---\nshortcode: other\nname: {full: Other}\ntype: doc\nsubType: concept\n---\n\nOther text.\n",
    );
    const saved = source.replace(
        "Hello.\n",
        "[[doc-other|Other]]\n\n![Portrait](images/portrait.webp){float: top-left, size: medium}\n\n```md\n[[doc-missing|literal example]]\n```\n\n```sql\nSELECT name.full AS \"Name\" FROM notes WHERE type = 'doc' ORDER BY name.full\n```\n\n:::secret\nGM information.\n:::\n",
    );
    fs.writeFileSync(file, saved);
    const db = await openNotesDatabase(indexRecordsFor({ config: conf }));
    const sqlTables = await prepareSqlTables(db, [
        { source: file, markdown: matter(saved).content },
    ]);
    await db.close();
    buildSite({ config: conf, sqlTables });
    const output = path.join(root, "build/hugo/content/kb/doc-intro.md");
    const published = matter(fs.readFileSync(output, "utf8"));
    const preview = await prepareSitePreview({ config: conf });
    try {
        expect(await preview.render(file, saved)).toMatchObject({
            ok: true,
            markdown: published.content,
            frontmatter: published.data,
        });
        expect(published.content).toContain("<figure");
        expect(published.content).toContain("[[doc-missing|literal example]]");
        const live = saved
            .replace("full: Intro", "full: Revised Intro")
            .replace("WHERE type = 'doc'", "WHERE shortcode = 'intro'");
        const changed = await preview.render(file, live);
        expect(changed.ok).toBe(true);
        expect(changed.frontmatter.name.full).toBe("Revised Intro");
        expect(changed.markdown).toContain("Revised Intro");
        expect(changed.markdown).not.toContain("| Other |");
        const broken = await preview.render(
            file,
            live.replace('name.full AS "Name"', "missing_column"),
        );
        expect(broken.ok).toBe(false);
        expect(broken.findings[0]).toMatchObject({ file, severity: "error" });
        expect(broken.findings[0].line).toBeGreaterThan(1);
        expect(broken.markdown).toBeUndefined();
        expect(fs.readFileSync(file, "utf8")).toBe(saved);
        expect(matter(fs.readFileSync(output, "utf8")).content).toBe(published.content);
        fs.writeFileSync(
            other,
            fs.readFileSync(other, "utf8").replace("full: Other", "full: Saved Other"),
        );
        await preview.refresh();
        const refreshed = await preview.render(file, saved);
        expect(refreshed.ok).toBe(true);
        expect(refreshed.markdown).toContain("Saved Other");
    } finally {
        await preview.close();
    }
});
