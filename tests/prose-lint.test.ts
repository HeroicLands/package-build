/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * A stand-in Prettier whose `format` is deliberately not idempotent.
 *
 * The reported symptom (#125) is a `--write` pass that leaves a file its own
 * next pass would still change. Whatever produced it in the wild, the shape is
 * this: `format` applied once does not reach a fixpoint. Injecting that shape
 * is the only way to test the guarantee rather than the accident — a fixture
 * that happens to be idempotent under the installed Prettier proves nothing
 * about a Prettier that is not.
 *
 * @param step - One formatting pass, applied to a file's text.
 * @returns A module shaped like the parts of Prettier `checkFormatting` uses.
 */
const stubPrettier = (step: (source: string) => string) => ({
    getFileInfo: async () => ({ ignored: false, inferredParser: "markdown" }),
    resolveConfig: async () => ({}),
    format: async (source: string) => step(source),
    check: async (source: string) => step(source) === source,
});

/** Strips one `!` from before the final newline — converges after two passes. */
const stripOneBang = (source: string) => source.replace(/!(\n)$/, "$1");

/** Adds a `!` before the final newline on every pass — never converges. */
const addOneBang = (source: string) => source.replace(/(\n)$/, "!$1");

describe("content-build format --write converges (#125)", () => {
    it("leaves nothing for a second pass to write", async () => {
        // The regression test the issue asks for: format a tree once, then
        // assert an immediately following pass writes nothing at all.
        write("a.md", "Some   *emphasis*    here.\n");
        write("b.md", "# Title\n## Sub\ntext\n");
        write("c.js", "function x() {\n  return 1;\n}\n");

        const first = await checkFormatting(root, { write: true });
        expect(first.written.length).toBeGreaterThan(0);

        const second = await checkFormatting(root, { write: true });
        expect(second.written).toEqual([]);
        expect(second.findings).toEqual([]);
    });

    it("formats to a fixpoint when one pass is not enough", async () => {
        const file = write("a.md", "text!!\n");
        const r = await checkFormatting(root, {
            write: true,
            prettier: stubPrettier(stripOneBang),
        });

        // One invocation, not two: the file arrives at the value a second run
        // would have produced.
        expect(r.written.map((f) => path.relative(root, f))).toEqual(["a.md"]);
        expect(fs.readFileSync(file, "utf8")).toBe("text\n");
        expect(r.findings).toEqual([]);
    });

    it("reports a file that never converges instead of writing it silently", async () => {
        const file = write("a.md", "text\n");
        const r = await checkFormatting(root, {
            write: true,
            prettier: stubPrettier(addOneBang),
        });

        const finding = r.findings.find((f) => f.file === file)!;
        expect(finding).toBeDefined();
        expect(finding.severity).toBe("error");
        expect(finding.message).toMatch(/did not converge/);
        // A whole-file verdict carries no line or column (#17).
        expect((finding as any).line).toBeUndefined();
        expect((finding as any).column).toBeUndefined();
        // And the file is left as it was: a formatting the command cannot
        // reproduce is not one it should commit to disk.
        expect(fs.readFileSync(file, "utf8")).toBe("text\n");
        expect(r.written).toEqual([]);
    });
});

describe("content-build format --write reports what it could not do (#125)", () => {
    /** The real binary, because the exit code is half of what is under test. */
    const bin = fileURLToPath(new URL("../bin/content-build.mjs", import.meta.url));

    it("emits the diagnostic and fails, instead of reporting a clean write", () => {
        // `--write` used to discard `findings` entirely: an unparseable file
        // was collected and thrown away, so the run said "Formatted N of M"
        // and exited 0 having silently left a file unformatted. The same
        // channel now carries a file that will not converge, so it has to
        // reach the caller.
        write("lang/en.json", '[\n    "KEY.One": "value"\n]\n');

        const r = spawnSync(process.execPath, [bin, "format", "--write"], {
            cwd: root,
            encoding: "utf8",
        });

        expect(r.status).toBe(1);
        const output = `${r.stdout}${r.stderr}`;
        expect(output).toContain(path.join("lang", "en.json"));
        expect(output).toMatch(/cannot be parsed/);
    });
});

describe("content-build format agrees with Prettier itself (#125)", () => {
    /**
     * Prettier's own CLI, resolved from this package's dependency tree.
     *
     * The point of running the binary rather than the API is independence: it
     * is a second implementation of the walk, the ignore files and the config
     * search, which is precisely the part the command stands in for.
     */
    const prettierBin = fileURLToPath(new URL("../node_modules/.bin/prettier", import.meta.url));

    /** Files `prettier --check .` warns about, relative to the fixture root. */
    const prettierComplaints = (): string[] => {
        let output = "";
        try {
            output = execFileSync(prettierBin, ["--check", "."], {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                // Its findings go to stderr, coloured; `NO_COLOR` keeps the
                // `[warn] <path>` lines parseable without stripping escapes.
                env: { ...process.env, NO_COLOR: "1" },
            });
        } catch (err: any) {
            output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
        }
        return output
            .split("\n")
            .filter((line) => line.startsWith("[warn] "))
            .map((line) => line.slice("[warn] ".length).trim())
            .filter((line) => !line.startsWith("Code style issues"))
            .map((line) => path.normalize(line))
            .sort();
    };

    it("names exactly the files Prettier names, and skips exactly what Prettier skips", async () => {
        // A consumer, modelled: its own config file, which is what makes the
        // two tools comparable at all. With no config the command applies the
        // shared defaults and bare Prettier applies its own, so they are
        // *meant* to differ — the promise only bites where a config exists.
        write("prettier.config.mjs", `export default ${JSON.stringify(PRETTIER_CONFIG)};\n`);

        write("clean.md", "# Title\n\nSome _emphasis_ here.\n");
        write("dirty.md", "Some   *emphasis*    here.\n");
        write("nested/dirty.js", "function x() {\n  return 1;\n}\n");
        write("nested/clean.js", "function x() {\n    return 1;\n}\n");
        // Correct exclusions, which must stay excluded on both sides.
        write("ignored.md", "Some   *emphasis*    here.\n");
        write("build/out.md", "Some   *emphasis*    here.\n");
        write("node_modules/dep/index.md", "Some   *emphasis*    here.\n");
        write("art/logo.svgz", "not something Prettier parses\n");
        write(".prettierignore", "ignored.md\n");
        write(".gitignore", "build/\n");

        const r = await checkFormatting(root);
        expect(files(r.findings)).toEqual(prettierComplaints());
        // Guard against the assertion passing because both sides found
        // nothing.
        expect(files(r.findings)).toContain("dirty.md");
    });

    it("still agrees once the tree has been formatted", async () => {
        write("prettier.config.mjs", `export default ${JSON.stringify(PRETTIER_CONFIG)};\n`);
        write("a.md", "Some   *emphasis*    here.\n");
        write("b.js", "function x() {\n  return 1;\n}\n");
        write("note.md", "---\nname:\n  full: X\n  aliases:\n    - A\n---\n\ntext\n");

        await checkFormatting(root, { write: true });

        expect((await checkFormatting(root)).findings).toEqual([]);
        expect(prettierComplaints()).toEqual([]);
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
