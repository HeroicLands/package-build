/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every package this toolchain imports at runtime must be declared in its own
 * `dependencies`.
 *
 * This package spent its first six changes as a workspace inside the Song of
 * Heroic Lands repository, where a missing declaration is invisible: npm hoists
 * the root's `devDependencies` into the workspace root's `node_modules/`, so
 * `acorn` or `archiver` resolves whether or not this package ever asked for it.
 * Installed from npm by another repository nothing hoists, and the first import
 * fails. The content half shipped exactly that way once, and an
 * extraction is precisely the moment the defect becomes reachable — the same
 * class of "passes in situ, fails when installed" defect that
 * `suite-is-self-contained.test.ts` guards from the other direction.
 *
 * The content half carried an identical copy of this check until the two
 * packages merged; one package needs one.
 *
 * So the check is a manifest-completeness one, run against the files the
 * package actually ships (its `files` field), and it is deliberately blunt: a
 * bare specifier in shipped code is either a Node builtin, this package
 * addressing itself, or a declared dependency. There is no fourth case.
 *
 * The reverse direction matters too: a shipped file may not import something
 * declared only as a `devDependency`, since a consumer installing the package
 * never gets those.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.dirname(HERE);

const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
    name: string;
    files: string[];
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const declared = Object.keys(manifest.dependencies ?? {});
const declaredDev = Object.keys(manifest.devDependencies ?? {});

/**
 * `from "x"`, `import "x"`, `import("x")`, and `require("x")` — enough for this
 * package, which is plain ESM with no computed specifiers.
 *
 * The lookbehind keeps the keyword from matching inside a string literal:
 * `["from", "to"]` would otherwise read as importing `", "`.
 *
 * It cannot do the same for a **comment**, where the keyword is a real word and
 * the quotes are real quotes — so comments are removed before this ever runs
 * (see {@link blankComments}).
 */
const SPECIFIER = /(?<!["'\w$.])\b(?:from|import|require)\b\s*\(?\s*["']([^"']+)["']/g;

/**
 * The source with every comment's characters replaced by spaces.
 *
 * English prose matches {@link SPECIFIER} whenever it contains the word `from`
 * — or `import`, or `require` — followed by a quoted phrase, which ordinary
 * explanatory comments in this codebase do:
 *
 * ```js
 * // writing a compile-time `null` over it would say "this phase takes no time",
 * // which is a different claim from "this note does not set the phase".
 * ```
 *
 * That reported `sohl/item-fields.mjs` as importing an undeclared package named
 * `this note does not set the phase`, and costs a debugging cycle before
 * anyone suspected the prose. A comment is not code, so nothing in one is an
 * import.
 *
 * Blanking rather than deleting is what keeps the finding honest: every
 * character is replaced one-for-one (newlines survive untouched), so offsets and
 * line numbers are the same as in the file a reader opens.
 *
 * Comments are located by parsing, not by a second regex — `//` inside a string
 * literal is not a comment, and only a parser knows the difference.
 */
function blankComments(source: string): string {
    const comments: { start: number; end: number }[] = [];
    parse(source, {
        ecmaVersion: "latest",
        sourceType: "module",
        allowHashBang: true,
        onComment: (_block, _text, start, end) => comments.push({ start, end }),
    });

    let out = "";
    let cursor = 0;
    for (const { start, end } of comments) {
        out += source.slice(cursor, start);
        out += source.slice(start, end).replace(/[^\n]/g, " ");
        cursor = end;
    }
    return out + source.slice(cursor);
}

/** The external packages a source text imports, with the line each was seen on. */
function importsIn(source: string): { pkg: string; line: number }[] {
    const code = blankComments(source);
    const seen: { pkg: string; line: number }[] = [];
    for (const match of code.matchAll(SPECIFIER)) {
        const pkg = packageOf(match[1] ?? "");
        if (!pkg) continue;
        const line = code.slice(0, match.index).split("\n").length;
        seen.push({ pkg, line });
    }
    return seen;
}

/**
 * The npm package a specifier resolves to — `yargs/helpers` is `yargs`,
 * `@scope/name/deep` is `@scope/name`. Relative specifiers yield `undefined`.
 */
function packageOf(specifier: string): string | undefined {
    if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
    if (isBuiltin(specifier)) return undefined;
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
}

/** Every `.mjs` under a path named in the manifest's `files` field. */
function shippedFiles(entry: string): string[] {
    const full = path.join(PKG_ROOT, entry);
    if (!fs.existsSync(full)) return [];
    if (fs.statSync(full).isFile()) return full.endsWith(".mjs") ? [full] : [];
    return fs
        .readdirSync(full, { withFileTypes: true })
        .flatMap((child) => shippedFiles(path.join(entry, child.name)));
}

const files = manifest.files.flatMap(shippedFiles);

/** The same, for a file on disk. */
function importsOf(file: string): { pkg: string; line: number }[] {
    return importsIn(fs.readFileSync(file, "utf8"));
}

describe("the package declares what it imports", () => {
    it("finds the shipped files it is guarding", () => {
        // A broken walk would make every case below vacuously pass.
        expect(files.length).toBeGreaterThan(0);
    });

    it("declares runtime dependencies at all", () => {
        // The state this refuses: no `dependencies` block whatsoever.
        expect(declared.length).toBeGreaterThan(0);
    });

    it.each(files.map((f) => path.relative(PKG_ROOT, f)))(
        "%s imports only builtins, itself, or a declared dependency",
        (relative) => {
            const undeclared = importsOf(path.join(PKG_ROOT, relative))
                .filter(({ pkg }) => pkg !== manifest.name && !declared.includes(pkg))
                .map(({ pkg, line }) => `${relative}:${line} → ${pkg}`);

            expect(undeclared).toEqual([]);
        },
    );

    it.each(files.map((f) => path.relative(PKG_ROOT, f)))(
        "%s imports nothing that is only a devDependency",
        (relative) => {
            // A consumer installing the package never receives these.
            const devOnly = importsOf(path.join(PKG_ROOT, relative))
                .filter(({ pkg }) => declaredDev.includes(pkg) && !declared.includes(pkg))
                .map(({ pkg, line }) => `${relative}:${line} → ${pkg}`);

            expect(devOnly).toEqual([]);
        },
    );

    it("declares vitest, which its own suite imports", () => {
        // The suite is not shipped, so vitest belongs in devDependencies —
        // but it must be declared somewhere, not borrowed from the root.
        expect(declaredDev).toContain("vitest");
    });

    it("declares no dependency it does not import", () => {
        const imported = new Set(files.flatMap((file) => importsOf(file).map(({ pkg }) => pkg)));
        const unused = declared.filter((pkg) => !imported.has(pkg));

        expect(unused).toEqual([]);
    });
});

/**
 * The comment that cost a debugging cycle, verbatim, so the regression
 * has a name. `sohl/item-fields.mjs` carries it again, reading naturally.
 */
const PROSE_FROM_329 = [
    '// writing a compile-time `null` over it would say "this phase takes no time",',
    '// which is a different claim from "this note does not set the phase".',
].join("\n");

describe("the scanner reads code, not prose", () => {
    it("finds no import in the line comment that cost a cycle", () => {
        // It was reported as `… → this note does not set the phase`, a package
        // name nothing in the message suggested was a sentence.
        expect(importsIn(PROSE_FROM_329)).toEqual([]);
    });

    it("finds no import in a block comment that names one", () => {
        const source = [
            "/*",
            ' * Resolved with require("node:fs") back when this was CommonJS, and',
            ' * imported from "archiver" ever since.',
            " */",
        ].join("\n");

        expect(importsIn(source)).toEqual([]);
    });

    it("still finds a real import on the line after such a comment", () => {
        const source = [PROSE_FROM_329, 'import archiver from "archiver";'].join("\n");

        expect(importsIn(source)).toEqual([{ pkg: "archiver", line: 3 }]);
    });

    it("still finds a real import after a block comment, at the right line", () => {
        const source = [
            "/* a comment",
            "   spanning",
            "   three lines */",
            'import { glob } from "glob";',
        ].join("\n");

        expect(importsIn(source)).toEqual([{ pkg: "glob", line: 4 }]);
    });

    it("still reads an import that a comment trails", () => {
        const source = 'import yaml from "yaml"; // parsed from "the frontmatter"';

        expect(importsIn(source)).toEqual([{ pkg: "yaml", line: 1 }]);
    });

    it("does not read a string literal as an import", () => {
        // The case the lookbehind already covered: `", "` is not a package.
        expect(importsIn('const keys = ["from", "to"];')).toEqual([]);
    });

    it("treats `//` inside a string literal as text, not the start of a comment", () => {
        // A scanner that blanked from the first `//` would lose the import.
        const source = 'const docs = "https://example.invalid/"; import yaml from "yaml";';

        expect(importsIn(source)).toEqual([{ pkg: "yaml", line: 1 }]);
    });

    it("blanks a comment in place, moving nothing after it", () => {
        const source = ["/* one", "   two */ code();", "// three"].join("\n");
        const blanked = blankComments(source);

        expect(blanked).toHaveLength(source.length);
        expect(blanked.split("\n")).toHaveLength(source.split("\n").length);
        expect(blanked.split("\n")[1]).toBe("          code();");
    });
});
