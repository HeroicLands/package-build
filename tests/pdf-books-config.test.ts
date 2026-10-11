// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `pdf:` declares its books in a `books:` list, and the configuration's
 * authors are one top-level list.
 *
 * Every refusal is asserted twice: once through the validator, for the dotted
 * `field` it names, and once through a real YAML file and `locateConfigError`,
 * for the `file:line:column: error:` prefix and for the line actually holding
 * the key. A position that is merely present is not enough — the line it names
 * is read back out of the file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

import { AUTHOR_ROLES, defineConfig } from "../content-config.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";
import { configFromData, locateConfigError } from "../engine/pack-config.mjs";
import { buildManifest } from "../manifest.mjs";
import { buildPdf } from "../engine/pdf-build.mjs";

let root = "";

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-books-config-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "bookpkg",
            version: "2.0.0",
            homepage: "https://www.heroiclands.org/sohl/",
            repository: { type: "git", url: "https://github.com/HeroicLands/bookpkg" },
        }),
    );
    fs.writeFileSync(
        path.join(root, "book.yaml"),
        "contents:\n  - sectionName: Gear\n    contents:\n      - filter: \"type = 'weapongear'\"\n",
    );
    fs.mkdirSync(path.join(root, "covers"));
    // A one-pixel PNG: the build stages and resamples a cover, so it must decode.
    fs.writeFileSync(
        path.join(root, "covers", "core.webp"),
        Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "base64",
        ),
    );
    const content = path.join(root, "assets", "content", "Gear");
    fs.mkdirSync(content, { recursive: true });
    for (const [shortcode, full] of [
        ["dagger", "Dagger"],
        ["sword", "Sword"],
    ]) {
        fs.writeFileSync(
            path.join(content, `${shortcode}.md`),
            `---\ntype: weapongear\nshortcode: ${shortcode}\nname:\n  full: ${full}\n---\n\nA blade.\n`,
        );
    }
    fs.writeFileSync(
        path.join(root, "assets", "content", "homepage.md"),
        "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
    );
});

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

/** The rest of a configuration that resolves, as a YAML configuration states it. */
function data(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        contentPackage: "sohl",
        packageKind: "modules",
        compatibility: { minimum: "14.359", verified: "14.359" },
        stats: { lastModifiedBy: "sohlbuilder00000" },
        packs: [{ name: "items", type: "Item" }],
        ...overrides,
    };
}

/** One book declaring its tree by file. */
const CORE = { id: "core", title: "The Core Volume", document: "book.yaml" };

/** A tree written inline. */
const INLINE = [{ sectionName: "Gear", contents: [{ filter: "type = 'weapongear'" }] }];

/** Resolve a configuration as the YAML loader does, from `root`. */
function load(input: Record<string, unknown>) {
    return configFromData(structuredClone(input), path.join(root, "package-build.config.yaml"));
}

/**
 * The refusal a configuration earns, read three ways: the `field` it names
 * through `configFromData`, the same through `defineConfig` (the `.mjs`
 * form), and the located message through a real YAML file.
 */
function refusal(input: Record<string, unknown>) {
    const dir = fs.mkdtempSync(path.join(root, "refusal-"));
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    const file = path.join(dir, "package-build.config.yaml");
    const text = YAML.stringify(input, { indent: 4 });
    fs.writeFileSync(file, text);
    let thrown: (Error & { field?: string }) | undefined;
    try {
        configFromData(YAML.parse(text), file);
    } catch (err) {
        thrown = err as Error & { field?: string };
    }
    if (!thrown) throw new Error(`expected a refusal of:\n${text}`);
    const field = thrown.field;
    const located = (locateConfigError(thrown, file) as Error).message;
    const at = /^(.+?):(\d+):(\d+): error: /.exec(located);
    const line = at ? text.split("\n")[Number(at[2]) - 1] : "";
    return { field, located, at, file, line, text };
}

/** The `.mjs` form: `defineConfig` directly, for the field alone. */
function definedField(input: Record<string, unknown>) {
    try {
        defineConfig({ rootDir: root, foundryPackage: "bookpkg", ...structuredClone(input) });
    } catch (err) {
        return (err as Error & { field?: string }).field;
    }
    throw new Error("expected defineConfig to refuse");
}

describe("pdf.books — accepted", () => {
    it("one book, by document", () => {
        const config = load(data({ pdf: { out: "build/pdf", books: [CORE] } }));
        expect(config.pdf.books).toHaveLength(1);
        const [book] = config.pdf.books;
        expect(book.id).toBe("core");
        expect(book.title).toBe("The Core Volume");
        expect(book.subtitle).toBe("");
        expect(book.document).toBe(path.join(root, "book.yaml"));
        expect(book.contents).toBeNull();
        expect(book.out).toBe("sohl-core");
        expect(book.coverImage).toBe("");
        expect(config.pdf.out).toBe("build/pdf");
    });

    it("two books, one inline, each with its own stem, front and cover", () => {
        const config = load(
            data({
                pdf: {
                    books: [
                        { ...CORE, out: "sohl", coverImage: "covers/core.webp" },
                        {
                            id: "gear-guide",
                            title: "Gear",
                            subtitle: "A Guide",
                            front: ["front.md"],
                            contents: INLINE,
                        },
                    ],
                },
            }),
        );
        const [core, gear] = config.pdf.books;
        expect(core.out).toBe("sohl");
        expect(core.coverImage).toBe(path.join(root, "covers", "core.webp"));
        expect(gear.out).toBe("sohl-gear-guide");
        expect(gear.document).toBe("");
        expect(gear.contents).toEqual(INLINE);
        expect(gear.front).toEqual([path.join(root, "front.md")]);
        expect(gear.subtitle).toBe("A Guide");
    });

    it("the shared keys: unprinted, coverage, copyright and a licence of several lines", () => {
        const config = load(
            data({
                pdf: {
                    unprinted: "type IN ('folder','homepage')",
                    coverage: "error",
                    copyright: "© 2026 Tom Rodriguez",
                    license: "Licensed CC BY-SA 4.0.\nSee LICENSE.md.",
                    books: [CORE],
                },
            }),
        );
        expect(config.pdf.unprinted).toBe("type IN ('folder','homepage')");
        expect(config.pdf.coverage).toBe("error");
        expect(config.pdf.copyright).toBe("© 2026 Tom Rodriguez");
        expect(config.pdf.license).toBe("Licensed CC BY-SA 4.0.\nSee LICENSE.md.");
    });

    it("coverage defaults to warning, and the statements to empty", () => {
        const config = load(data({ pdf: { books: [CORE] } }));
        expect(config.pdf.coverage).toBe("warning");
        expect(config.pdf.unprinted).toBe("");
        expect(config.pdf.copyright).toBe("");
        expect(config.pdf.license).toBe("");
    });

    it("a missing cover or document is not a configuration error", () => {
        const config = load(
            data({
                pdf: {
                    books: [{ ...CORE, document: "absent.yaml", coverImage: "covers/absent.webp" }],
                },
            }),
        );
        expect(config.pdf.books[0].coverImage).toBe(path.join(root, "covers", "absent.webp"));
    });
});

describe("pdf.books — refused, each at its key", () => {
    const cases: Array<{
        name: string;
        input: Record<string, unknown>;
        field: string;
        line: RegExp;
        message?: RegExp;
    }> = [
        {
            name: "a top-level pdf.title",
            input: data({ pdf: { title: "Old", books: [CORE] } }),
            field: "pdf.title",
            line: /^\s+title: Old/,
            message: /not a recognized option.*books/,
        },
        {
            name: "a top-level pdf.document",
            input: data({ pdf: { document: "book.yaml", books: [CORE] } }),
            field: "pdf.document",
            line: /^\s+document: book\.yaml/,
        },
        {
            name: "books missing",
            input: data({ pdf: { out: "build/pdf" } }),
            field: "pdf.books",
            line: /^pdf:/,
            message: /required/,
        },
        {
            name: "books empty",
            input: data({ pdf: { books: [] } }),
            field: "pdf.books",
            line: /^\s+books:/,
        },
        {
            name: "a duplicate id",
            input: data({
                pdf: { books: [CORE, { ...CORE, title: "Second", out: "other" }] },
            }),
            field: "pdf.books[1].id",
            line: /^\s+- id: core/,
            message: /`core`.*more than once/,
        },
        {
            name: "an id outside the charset",
            input: data({ pdf: { books: [{ ...CORE, id: "Core Book" }] } }),
            field: "pdf.books[0].id",
            line: /id: Core Book/,
        },
        {
            name: "title missing",
            input: data({ pdf: { books: [{ id: "core", document: "book.yaml" }] } }),
            field: "pdf.books[0].title",
            line: /- id: core/,
        },
        {
            name: "both contents and document",
            input: data({ pdf: { books: [{ ...CORE, contents: INLINE }] } }),
            field: "pdf.books[0]",
            line: /- id: core/,
            message: /exactly one of `contents` and `document`/,
        },
        {
            name: "neither contents nor document",
            input: data({ pdf: { books: [{ id: "core", title: "T" }] } }),
            field: "pdf.books[0]",
            line: /- id: core/,
            message: /exactly one of `contents` and `document`/,
        },
        {
            name: "an out that is a path",
            input: data({ pdf: { books: [{ ...CORE, out: "dist/core" }] } }),
            field: "pdf.books[0].out",
            line: /out: dist\/core/,
        },
        {
            name: "two books with one stem",
            input: data({
                pdf: {
                    books: [
                        { ...CORE, out: "same" },
                        { id: "other", title: "Other", document: "book.yaml", out: "same" },
                    ],
                },
            }),
            field: "pdf.books[1].out",
            line: /out: same/,
            message: /`same`/,
        },
        {
            name: "a default stem colliding with a declared one",
            input: data({
                pdf: {
                    books: [
                        { ...CORE, out: "sohl-other" },
                        { id: "other", title: "Other", document: "book.yaml" },
                    ],
                },
            }),
            field: "pdf.books[1].id",
            line: /- id: other/,
            message: /`sohl-other`/,
        },
        {
            name: "an unknown book key",
            input: data({ pdf: { books: [{ ...CORE, cover: "covers/core.webp" }] } }),
            field: "pdf.books[0].cover",
            line: /cover: covers/,
            message: /coverImage/,
        },
        {
            name: "coverage outside its list",
            input: data({ pdf: { coverage: "maybe", books: [CORE] } }),
            field: "pdf.coverage",
            line: /coverage: maybe/,
            message: /warning, error, off/,
        },
        {
            name: "an unprinted clause that is not a string",
            input: data({ pdf: { unprinted: 3, books: [CORE] } }),
            field: "pdf.unprinted",
            line: /unprinted: 3/,
        },
        {
            name: "a copyright that is not a string",
            input: data({ pdf: { copyright: 2026, books: [CORE] } }),
            field: "pdf.copyright",
            line: /copyright: 2026/,
        },
        {
            name: "a copyright of two lines",
            input: data({ pdf: { copyright: "© 2026\nTom", books: [CORE] } }),
            field: "pdf.copyright",
            line: /copyright:/,
            message: /one line/,
        },
        {
            name: "a licence that is not a string",
            input: data({ pdf: { license: ["CC BY-SA"], books: [CORE] } }),
            field: "pdf.license",
            line: /license:/,
        },
    ];

    for (const { name, input, field, line, message } of cases) {
        it(name, () => {
            const found = refusal(input);
            expect(found.field, found.located).toBe(field);
            expect(found.at, found.located).not.toBeNull();
            expect(found.at![1]).toBe(found.file);
            expect(found.line, `${found.located}\n---\n${found.text}`).toMatch(line);
            if (message) expect(found.located).toMatch(message);
            expect(definedField(input)).toBe(field);
        });
    }
});

describe("authors", () => {
    it("are listed with and without roles, and the byline is the first", () => {
        const config = load(
            data({
                authors: [
                    {
                        name: "Tom Rodriguez",
                        email: "toasty@heroiclands.org",
                        url: "https://heroiclands.org",
                        discord: "toasty",
                        role: "author",
                    },
                    { name: "A. Painter", role: "artist" },
                    { name: "Plain Name" },
                ],
            }),
        );
        expect(config.authors).toEqual([
            {
                name: "Tom Rodriguez",
                email: "toasty@heroiclands.org",
                url: "https://heroiclands.org",
                discord: "toasty",
                role: "author",
            },
            { name: "A. Painter", role: "artist" },
            { name: "Plain Name" },
        ]);
        expect(config.author).toEqual({
            name: "Tom Rodriguez",
            email: "toasty@heroiclands.org",
            url: "https://heroiclands.org",
        });
    });

    it("are empty, with no byline, when none are declared", () => {
        const config = load(data());
        expect(config.authors).toEqual([]);
        expect(config.author).toBeNull();
    });

    it("take every role in the closed list", () => {
        expect(AUTHOR_ROLES.length).toBeGreaterThan(1);
        const config = load(
            data({ authors: AUTHOR_ROLES.map((role: string) => ({ name: `N ${role}`, role })) }),
        );
        expect(config.authors.map((a: { role: string }) => a.role)).toEqual([...AUTHOR_ROLES]);
    });

    const refused: Array<{
        name: string;
        input: Record<string, unknown>;
        field: string;
        line: RegExp;
    }> = [
        {
            name: "a role outside the list",
            input: data({ authors: [{ name: "T", role: "wizard" }] }),
            field: "authors[0].role",
            line: /role: wizard/,
        },
        {
            name: "an entry with no name",
            input: data({ authors: [{ email: "t@example.org" }] }),
            field: "authors[0].name",
            line: /email: t@example\.org/,
        },
        {
            name: "an unknown entry key",
            input: data({ authors: [{ name: "T", handle: "@t" }] }),
            field: "authors[0].handle",
            line: /handle: "?@t/,
        },
        {
            name: "authors that are not a list",
            input: data({ authors: "Tom" }),
            field: "authors",
            line: /^authors: Tom/,
        },
        {
            name: "a top-level author",
            input: data({ author: "Tom" }),
            field: "author",
            line: /^author: Tom/,
        },
    ];
    for (const { name, input, field, line } of refused) {
        it(`refuse ${name}, at its key`, () => {
            const found = refusal(input);
            expect(found.field, found.located).toBe(field);
            expect(found.at, found.located).not.toBeNull();
            expect(found.line, `${found.located}\n---\n${found.text}`).toMatch(line);
            expect(definedField(input)).toBe(field);
        });
    }

    it("the role refusal names the closed list", () => {
        const found = refusal(data({ authors: [{ name: "T", role: "wizard" }] }));
        expect(found.located).toContain(AUTHOR_ROLES.join(", "));
    });

    it("refuse packageBuild.manifest.authors, naming where authors are declared", () => {
        let err: (Error & { field?: string }) | undefined;
        try {
            resolvePackageBuildConfig({
                rootDir: root,
                packageKind: "modules",
                foundryPackage: "bookpkg",
                packageBuild: { manifest: { title: "T", authors: [{ name: "Tom" }] } },
            });
        } catch (e) {
            err = e as Error & { field?: string };
        }
        expect(err?.field).toBe("packageBuild.manifest.authors");
        expect(err?.message).toMatch(/`authors`/);

        const dir = fs.mkdtempSync(path.join(root, "manifest-"));
        const file = path.join(dir, "package-build.config.yaml");
        const text = YAML.stringify(
            data({ packageBuild: { manifest: { title: "T", authors: [{ name: "Tom" }] } } }),
            { indent: 4 },
        );
        fs.writeFileSync(file, text);
        const located = (locateConfigError(err, file) as Error).message;
        const at = /^(.+?):(\d+):(\d+): error: /.exec(located);
        expect(at, located).not.toBeNull();
        expect(text.split("\n")[Number(at![2]) - 1]).toMatch(/^\s+authors:/);
    });

    it("reach the generated manifest without their roles", () => {
        const config = load(
            data({
                authors: [
                    { name: "Tom Rodriguez", email: "t@example.org", role: "author" },
                    { name: "A. Painter", discord: "painter", role: "artist" },
                    { name: "Plain Name" },
                ],
                packageBuild: { manifest: { title: "Book" } },
            }),
        );
        const manifest = buildManifest({
            config,
            packageJson: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")),
            artifact: "module",
        });
        expect(manifest.authors).toEqual([
            { name: "Tom Rodriguez", email: "t@example.org" },
            { name: "A. Painter", discord: "painter" },
            { name: "Plain Name" },
        ]);
        for (const author of manifest.authors) expect(author).not.toHaveProperty("role");
    });

    it("leave the manifest without authors when none are declared", () => {
        const config = load(data({ packageBuild: { manifest: { title: "Book" } } }));
        const manifest = buildManifest({
            config,
            packageJson: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")),
            artifact: "module",
        });
        expect(manifest).not.toHaveProperty("authors");
    });
});

describe("buildPdf over several books", () => {
    const saved = process.env.PACKAGE_BUILD_CONFIG;
    afterEach(() => {
        if (saved === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
        else process.env.PACKAGE_BUILD_CONFIG = saved;
    });

    /** Write `input` as the package's configuration and resolve it. */
    function packageWith(input: Record<string, unknown>) {
        const dir = fs.mkdtempSync(path.join(root, "build-"));
        for (const file of ["package.json", "book.yaml"]) {
            fs.copyFileSync(path.join(root, file), path.join(dir, file));
        }
        fs.cpSync(path.join(root, "assets"), path.join(dir, "assets"), { recursive: true });
        fs.cpSync(path.join(root, "covers"), path.join(dir, "covers"), { recursive: true });
        const configPath = path.join(dir, "package-build.config.yaml");
        const text = YAML.stringify(input, { indent: 4 });
        fs.writeFileSync(configPath, text);
        process.env.PACKAGE_BUILD_CONFIG = configPath;
        const config = configFromData(YAML.parse(text), configPath);
        return { dir, config, configPath, text };
    }

    const TWO = data({
        pdf: {
            out: "build/pdf",
            books: [
                { id: "core", title: "Core", contents: INLINE },
                { id: "gear", title: "Gear", out: "gear-book", contents: INLINE },
            ],
        },
    });

    it("writes one source per book, named by its stem", async () => {
        const { dir, config, configPath } = packageWith(TWO);
        const result = await buildPdf({ config, configPath, compile: false, version: "2.0.0" });
        expect(result.findings.filter((f: { severity: string }) => f.severity === "error")).toEqual(
            [],
        );
        expect(result.built).toBe(true);
        expect(result.books.map((b: { id: string }) => b.id)).toEqual(["core", "gear"]);
        expect(result.books.map((b: { typ: string }) => path.basename(b.typ))).toEqual([
            "sohl-core-2.0.0.typ",
            "gear-book-2.0.0.typ",
        ]);
        for (const book of result.books) {
            expect(fs.existsSync(book.typ)).toBe(true);
            expect(path.dirname(book.typ)).toBe(path.join(dir, "build", "pdf"));
            expect(book.stats.notes).toBe(2);
        }
        expect(fs.readFileSync(result.books[1].typ, "utf8")).toContain("Gear");
    });

    it("builds the one book --book names", async () => {
        const { config, configPath } = packageWith(TWO);
        const result = await buildPdf({ config, configPath, book: "gear", compile: false });
        expect(result.books.map((b: { id: string }) => b.id)).toEqual(["gear"]);
        expect(path.basename(result.books[0].typ)).toBe("gear-book.typ");
    });

    it("reports an unknown --book at pdf.books, listing the declared ids", async () => {
        const { config, configPath, text } = packageWith(TWO);
        const result = await buildPdf({ config, configPath, book: "nope", compile: false });
        expect(result.built).toBe(false);
        expect(result.books).toEqual([]);
        const errors = result.findings.filter((f: { severity: string }) => f.severity === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe(configPath);
        expect(errors[0].message).toBe(
            "--book `nope` names no declared book; declared: core, gear",
        );
        expect(text.split("\n")[errors[0].line - 1]).toMatch(/^\s+books:/);
    });

    it("locates a finding in an inline tree in the configuration", async () => {
        const { config, configPath, text } = packageWith(
            data({
                pdf: {
                    books: [
                        {
                            id: "core",
                            title: "Core",
                            contents: [{ sectionName: "Gear", bogus: 1, contents: [] }],
                        },
                    ],
                },
            }),
        );
        const result = await buildPdf({ config, configPath, compile: false });
        const bogus = result.findings.find((f: { message: string }) => f.message.includes("bogus"));
        expect(bogus?.file).toBe(configPath);
        expect(text.split("\n")[bogus.line - 1]).toMatch(/bogus: 1/);
    });

    it("reports a missing cover image at its key, and builds nothing for that book", async () => {
        const { config, configPath, text } = packageWith(
            data({
                pdf: {
                    books: [
                        {
                            id: "core",
                            title: "Core",
                            contents: INLINE,
                            coverImage: "covers/absent.webp",
                        },
                        {
                            id: "gear",
                            title: "Gear",
                            contents: INLINE,
                            coverImage: "covers/core.webp",
                        },
                    ],
                },
            }),
        );
        const result = await buildPdf({ config, configPath, compile: false });
        const errors = result.findings.filter((f: { severity: string }) => f.severity === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe(configPath);
        expect(errors[0].message).toMatch(/covers\/absent\.webp/);
        expect(text.split("\n")[errors[0].line - 1]).toMatch(/coverImage: covers\/absent\.webp/);
        expect(result.books.map((b: { id: string }) => b.id)).toEqual(["gear"]);
        expect(result.built).toBe(false);
    });

    it("reports a missing document and a missing front file at their keys", async () => {
        const { config, configPath, text } = packageWith(
            data({
                pdf: {
                    books: [
                        { id: "core", title: "Core", document: "absent.yaml" },
                        { id: "gear", title: "Gear", contents: INLINE, front: ["absent.md"] },
                    ],
                },
            }),
        );
        const result = await buildPdf({ config, configPath, compile: false });
        const errors = result.findings.filter((f: { severity: string }) => f.severity === "error");
        expect(errors.map((e: { line: number }) => text.split("\n")[e.line - 1].trim())).toEqual([
            "document: absent.yaml",
            "- absent.md",
        ]);
        for (const error of errors) expect(error.file).toBe(configPath);
    });
});
