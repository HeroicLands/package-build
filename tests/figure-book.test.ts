// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const ROOT = path.resolve(__dirname, "..");

const dirs: string[] = [];

afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A repository with two notes in one section, each carrying a `:::figure`
 * fence, so the book's cross-note numbering and `{{ref}}` resolution can be
 * exercised through the real build rather than through a unit-level stub.
 */
function makeRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figure-book-"));
    dirs.push(dir);
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
            name: "figurebookpkg",
            version: "1.0.0",
            homepage: "https://www.heroiclands.org/sohl/",
        }),
    );

    const content = path.join(dir, "assets", "content", "Gear");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(
        path.join(content, "alpha.md"),
        [
            "---",
            "type: weapongear",
            "shortcode: alpha",
            "name:",
            "  full: Alpha Figure",
            "---",
            "",
            'See {{ref "#c1"}} for the mechanism, drawn in full as {{ref "#c1" form="full"}}.',
            "",
            'The beta note carries {{ref "weapongear-beta#c2"}} of its own.',
            "",
            ":::figure {#c1}",
            "```js",
            "1",
            "```",
            "///",
            "The alpha listing.",
            ":::",
        ].join("\n") + "\n",
    );
    fs.writeFileSync(
        path.join(content, "beta.md"),
        [
            "---",
            "type: weapongear",
            "shortcode: beta",
            "name:",
            "  full: Beta Figure",
            "---",
            "",
            ":::figure {#c2}",
            "```js",
            "2",
            "```",
            "///",
            "The beta listing.",
            ":::",
        ].join("\n") + "\n",
    );
    fs.writeFileSync(
        path.join(dir, "assets", "content", "homepage.md"),
        "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
    );
    fs.writeFileSync(
        path.join(dir, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Gear",
            "    contents:",
            "      - filter: \"type = 'weapongear'\"",
        ].join("\n") + "\n",
    );
    fs.writeFileSync(
        path.join(dir, "package-build.config.yaml"),
        [
            "contentPackage: sohl",
            "packageKind: modules",
            "compatibility:",
            '    minimum: "14.359"',
            '    verified: "14.359"',
            "stats:",
            "    lastModifiedBy: sohlbuilder00000",
            "packs:",
            "    - name: items",
            "      type: Item",
            "pdf:",
            "    title: The Test Volume",
            "    document: book.yaml",
            "    fonts:",
            "        serif: Libertinus Serif",
        ].join("\n") + "\n",
    );
    return dir;
}

/** Run `package-build pdf --no-compile` and return the generated `.typ` source. */
function buildTypstSource(dir: string): { out: string; status: number | null; source: string } {
    const r = spawnSync(
        process.execPath,
        [path.join(ROOT, "bin", "package-build.mjs"), "pdf", "--no-compile"],
        {
            cwd: dir,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(dir, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const dist = path.join(dir, "build", "dist");
    const typFile =
        fs.existsSync(dist) ? fs.readdirSync(dist).find((f) => f.endsWith(".typ")) : undefined;
    const source = typFile ? fs.readFileSync(path.join(dist, typFile), "utf8") : "";
    return { out, status: r.status, source };
}

describe("a figure fence in the book", () => {
    it(
        "numbers a kind across the book, in reading order, rather than resetting per note",
        () => {
            const dir = makeRepo();
            const { out, status, source } = buildTypstSource(dir);
            expect(status, out).toBe(0);
            // "Alpha Figure" sorts before "Beta Figure", so the first note's
            // listing is Code 1 and the second note's continues the same
            // count rather than starting over.
            expect(source).toContain("Code 1: The alpha listing.");
            expect(source).toContain("Code 2: The beta listing.");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "resolves a same-note {{ref}} to a working link carrying the book's own number",
        () => {
            const dir = makeRepo();
            const { out, status, source } = buildTypstSource(dir);
            expect(status, out).toBe(0);
            // The `ref` helper is threaded the book's cross-note numbering, so
            // the reference reads "Code 1" — the number the book gives the
            // figure — rather than resetting to a per-note count, and raises
            // no "names no figure" finding.
            expect(out).not.toMatch(/names no figure/);
            // The helper's Markdown link resolves, through the same pass
            // that resolves every other same-page fragment link, to a Typst
            // reference landing on the figure's own anchor — the one label
            // its code fence itself declares.
            const anchorMatch = source.match(/<([\w-]*--c1)>/);
            expect(anchorMatch).not.toBeNull();
            const label = anchorMatch![1];
            expect(source).toContain(`#link(<${label}>)[Code 1]`);
            expect(source).toContain(`#link(<${label}>)[Code 1: The alpha listing.]`);
            expect(source).toContain(
                `#block(below: 0.6em)[#text(size: 7.6pt, style: "italic")[Code 1: The alpha listing.]] <${label}>`,
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "resolves a cross-note {{ref}} to the target's own book-wide number",
        () => {
            const dir = makeRepo();
            const { out, status, source } = buildTypstSource(dir);
            expect(status, out).toBe(0);
            // The alpha note's reference names the beta note's figure, which
            // is "Code 2" in the book's own reading order — not "Code 1",
            // which is what a page-local recount of beta alone would give it.
            expect(out).not.toMatch(/names no figure/);
            expect(out).not.toMatch(/names no note/);
            const anchorMatch = source.match(/<([\w-]*--c2)>/);
            expect(anchorMatch).not.toBeNull();
            const label = anchorMatch![1];
            expect(source).toContain(`#link(<${label}>)[Code 2]`);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
