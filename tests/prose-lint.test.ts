/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkFormatting, lintMarkdown } from "../engine/prose-lint.mjs";
import { MARKDOWNLINT_CONFIG, PRETTIER_CONFIG } from "../engine/prose-config.mjs";

/**
 * A throwaway repository.
 *
 * Built under the OS temp directory rather than beside the suite on purpose:
 * Prettier resolves configuration by walking *up* from each file, so a fixture
 * inside this repository would silently inherit this repository's own
 * `prettier.config.js` and the "a consumer's config wins" tests would prove
 * nothing.
 */
let root: string;

const write = (rel: string, body: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
};

/** Paths of the findings, relative to the fixture root, for readable asserts. */
const files = (findings: Array<{ file: string }>) =>
    findings.map((f) => path.relative(root, f.file)).sort();

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-prose-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("the shared configuration (#69)", () => {
    it("states the emphasis convention rather than inheriting it", () => {
        // The whole point of declaring MD049/MD050: without them the
        // convention holds only as a side effect of Prettier's default.
        expect((MARKDOWNLINT_CONFIG as any).MD049).toEqual({
            style: "underscore",
        });
        expect((MARKDOWNLINT_CONFIG as any).MD050).toEqual({
            style: "asterisk",
        });
    });

    it("turns markdownlint's defaults off and enables rules by name", () => {
        expect((MARKDOWNLINT_CONFIG as any).default).toBe(false);
    });

    it("is frozen, so a consumer cannot mutate the shared rules in place", () => {
        expect(Object.isFrozen(PRETTIER_CONFIG)).toBe(true);
        expect(Object.isFrozen(MARKDOWNLINT_CONFIG)).toBe(true);
    });
});

describe("content-build format (#69)", () => {
    it("reports an unformatted file and leaves it alone", () => {
        const file = write("a.md", "Some   *emphasis*    here.\n");
        return checkFormatting(root).then((r) => {
            expect(files(r.findings)).toEqual(["a.md"]);
            expect(fs.readFileSync(file, "utf8")).toBe("Some   *emphasis*    here.\n");
        });
    });

    it("reports nothing for a tree that is already formatted", async () => {
        write("a.md", "Some _emphasis_ here.\n");
        const r = await checkFormatting(root);
        expect(r.findings).toEqual([]);
        expect(r.checked).toBe(1);
    });

    it("rewrites in place under --write, and reports what it touched", async () => {
        const file = write("a.md", "Some   *emphasis*    here.\n");
        const r = await checkFormatting(root, { write: true });
        expect(r.written.map((f) => path.relative(root, f))).toEqual(["a.md"]);
        expect(fs.readFileSync(file, "utf8")).toBe("Some _emphasis_ here.\n");
        // And the rewritten tree is then clean.
        expect((await checkFormatting(root)).findings).toEqual([]);
    });

    it("honours .prettierignore and .gitignore, and never walks node_modules", async () => {
        write("a.md", "Some   *bad*   formatting.\n");
        write("skipped.md", "Some   *bad*   formatting.\n");
        write("build/out.md", "Some   *bad*   formatting.\n");
        write("node_modules/dep/index.md", "Some   *bad*   formatting.\n");
        write(".prettierignore", "skipped.md\n");
        write(".gitignore", "build/\n");

        const r = await checkFormatting(root);
        expect(files(r.findings)).toEqual(["a.md"]);
    });

    it("lets a consumer's own Prettier config win over the shared default", async () => {
        // The shared default indents code at 4. Two identical two-space files,
        // one beside a config asking for 2 and one not: the first is clean only
        // if the local config won, the second is a finding only if the shared
        // default applied. Two directories rather than one mutated in place,
        // because Prettier caches config resolution for the life of a process.
        write("with/prettier.config.mjs", "export default { tabWidth: 2 };\n");
        write("with/a.js", "function x() {\n  return 1;\n}\n");
        write("without/a.js", "function x() {\n  return 1;\n}\n");

        const r = await checkFormatting(root);
        expect(files(r.findings)).toEqual([path.join("without", "a.js")]);
    });

    // Prettier applies an `overrides` block only while resolving a config
    // *file*; options handed to it directly keep the global values. So the
    // shared configuration's markdown override was silently dropped in exactly
    // the repositories the command exists for — the ones declaring no config of
    // their own — and markdown indented at 4 (#76). It went unseen because a
    // repository with a config resolves it correctly, and every markdown
    // fixture here was a single line with nothing to indent.
    it("indents markdown at 2 with no local config, as the shared override says", async () => {
        const note = write("note.md", "---\nname:\n  full: X\n  aliases:\n    - A\n---\n\ntext\n");

        expect((await checkFormatting(root)).findings).toEqual([]);

        await checkFormatting(root, { write: true });
        expect(fs.readFileSync(note, "utf8")).toContain("  full: X");
        expect(fs.readFileSync(note, "utf8")).not.toContain("    full: X");
    });

    it("still indents everything else at the shared global width", async () => {
        // The override is scoped to markdown; the rest of the tree keeps 4, so
        // fixing the override must not flatten that too.
        write("a.js", "function x() {\n  return 1;\n}\n");
        expect(files((await checkFormatting(root)).findings)).toEqual(["a.js"]);
    });

    it("reports an unparseable file with its position, and keeps going", async () => {
        // Exactly the shape that took a whole run down before it could report:
        // sohl-kethira-basic's lang/en.json, an array holding object pairs.
        write("lang/en.json", '[\n    "KEY.One": "value"\n]\n');
        write("later.md", "Some   *bad*   formatting.\n");

        const r = await checkFormatting(root);
        const bad = r.findings.find((f) => f.file.endsWith("en.json"))!;
        expect(bad).toBeDefined();
        expect(bad.message).toMatch(/cannot be parsed/);
        expect((bad as any).line).toBe(2);
        expect(Number.isFinite((bad as any).column)).toBe(true);
        // The file after it was still checked — one bad file must not cost the
        // report on every other one.
        expect(files(r.findings)).toContain("later.md");
    });

    it("checks only the paths it is given", async () => {
        write("a.md", "Some   *bad*   formatting.\n");
        write("sub/b.md", "Some   *bad*   formatting.\n");
        const r = await checkFormatting(root, { paths: ["sub"] });
        expect(files(r.findings)).toEqual([path.join("sub", "b.md")]);
    });
});

describe("content-build markdown (#69)", () => {
    it("reports the emphasis marker the convention does not use", async () => {
        write("a.md", "Some *emphasis* here.\n");
        const r = await lintMarkdown(root);
        // One per marker, opening and closing — the rule reports the character
        // it wants changed, not the span.
        expect(r.findings.length).toBeGreaterThan(0);
        for (const f of r.findings) expect(f.message).toContain("MD049");
        expect(r.exitCode).toBe(1);
    });

    it("reports nothing for a clean tree", async () => {
        write("a.md", "# Title\n\nSome _emphasis_ here.\n");
        const r = await lintMarkdown(root);
        expect(r.findings).toEqual([]);
        expect(r.exitCode).toBe(0);
    });

    it("locates a finding by line and column", async () => {
        write("a.md", "# Title\n\nfine\n\nSome *emphasis* here.\n");
        const r = await lintMarkdown(root);
        expect(r.findings[0].line).toBe(5);
        expect(r.findings[0].column).toBeGreaterThan(0);
    });

    it("reports a heading level that skips", async () => {
        write("a.md", "# One\n\n### Three\n");
        const r = await lintMarkdown(root);
        expect(r.findings.map((f) => f.message).join()).toContain("MD001");
    });

    it("skips the changelog changesets regenerates", async () => {
        write("CHANGELOG.md", "# Log\n\n### Skipped\n\nSome *emphasis*.\n");
        const r = await lintMarkdown(root);
        expect(r.findings).toEqual([]);
    });

    it("lets a consumer's own markdownlint config win", async () => {
        write("a.md", "Some *emphasis* here.\n");
        write(
            ".markdownlint-cli2.jsonc",
            JSON.stringify({ config: { default: false, MD049: false } }),
        );
        const r = await lintMarkdown(root);
        expect(r.findings).toEqual([]);
    });
});
