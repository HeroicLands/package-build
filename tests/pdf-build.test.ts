// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The book stages the pictures its package ships and reports, at the line and
 * column that wrote them, those it cannot carry.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import { buildPdf, stagedImagePath } from "../engine/pdf-build.mjs";
import { configFromData } from "../engine/pack-config.mjs";

/** A minimal config `stagedImagePath` can resolve a pathname against. */
function unitConfig(overrides = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "sohl",
        packageKind: "modules",
        foundryPackage: "sohl",
        relationships: {
            requires: [{ id: "otherpkg", contentPackage: "otherpkg" }],
        },
        paths: { foreignCache: "/repo/build/cache/foreign" },
        ...overrides,
    };
}

describe("stagedImagePath", () => {
    it("stages a file this package ships", () => {
        const staged = stagedImagePath("images/beings/thorn.webp", unitConfig());
        expect(staged).toEqual({
            from: "/repo/assets/images/beings/thorn.webp",
            to: "assets/images/beings/thorn.webp",
        });
    });

    it("declines a foreign address, which names a file this package does not ship", () => {
        const staged = stagedImagePath("otherpkg/assets/icons/anvil.svg", unitConfig());
        expect(staged).toBeNull();
    });
});

/**
 * A fixture repository, configured and cached enough for `buildPdf` to run
 * against it directly — the cheaper half of what `tests/pdf-book.test.ts`
 * builds through the CLI.
 */
function makeFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-build-"));
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
            name: "bookpkg",
            version: "1.0.0",
            homepage: "https://www.heroiclands.org/sohl/",
        }),
    );
    fs.mkdirSync(path.join(dir, "assets", "content", "Gear"), { recursive: true });
    fs.mkdirSync(path.join(dir, "assets", "content", "Places"), { recursive: true });
    fs.writeFileSync(
        path.join(dir, "assets", "content", "homepage.md"),
        "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
    );
    fs.writeFileSync(
        path.join(dir, "assets", "content", "Gear", "dagger.md"),
        "---\n" +
            "type: weapongear\n" +
            "shortcode: dagger\n" +
            "name:\n  full: Dagger\n" +
            "---\n\nA blade.\n\n" +
            "![[otherpkg-none-icon-anvil|An anvil]]\n",
    );
    fs.writeFileSync(
        path.join(dir, "assets", "content", "Places", "realm.md"),
        "---\n" +
            "type: map\n" +
            "subType: regionalmap\n" +
            "shortcode: realm\n" +
            "name:\n  full: Realm Map\n" +
            "data:\n" +
            "  fixup:\n" +
            "    - { path: '.levels[0].background.src', type: address, value: otherpkg-none-icon-anvil }\n" +
            "  scene:\n" +
            "    name: Realm Map\n" +
            "    levels:\n" +
            "      - { _id: level0000000000, background: { src: modules/realm/anvil.svg } }\n" +
            "---\n\nA map.\n",
    );
    fs.writeFileSync(
        path.join(dir, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Gear",
            "    contents:",
            "      - filter: \"type = 'weapongear'\"",
            "  - sectionName: Places",
            "    contents:",
            "      - filter: \"type = 'map'\"",
        ].join("\n") + "\n",
    );
    // A real, valid configuration on disk: resolving the content tree's
    // addresses falls through, elsewhere in the engine, to a configuration
    // discovered from the working directory — this is what that discovery
    // reads.
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
            "    unprinted: \"type = 'homepage'\"",
            "    books:",
            "        - id: core",
            "          title: The Test Volume",
            "          document: book.yaml",
            "    fonts:",
            "        serif: Libertinus Serif",
        ].join("\n") + "\n",
    );
    return dir;
}

/**
 * The resolved configuration `buildPdf` compiles against, with `otherpkg`
 * declared as a dependency.
 */
function resolveFixtureConfig(dir, { books } = {}) {
    const base = configFromData(
        {
            contentPackage: "sohl",
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            pdf: {
                unprinted: "type = 'homepage'",
                books: books ?? [{ id: "core", title: "The Test Volume", document: "book.yaml" }],
                fonts: { serif: "Libertinus Serif" },
            },
        },
        path.join(dir, "package-build.config.yaml"),
    );
    return {
        ...base,
        relationships: {
            requires: [{ id: "otherpkg", contentPackage: "otherpkg" }],
        },
    };
}

/** Fetch `otherpkg`'s content index into the fixture's cache. */
function cacheDependency(config) {
    const metaDir = path.join(config.paths.metadataCache, "otherpkg@1.0.0");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
        path.join(metaDir, "index.jsonl"),
        `${JSON.stringify({
            package: "otherpkg",
            type: "icon",
            shortcode: "anvil",
            address: { canonical: "otherpkg-none-icon-anvil" },
            asset: { path: "icons/anvil.svg" },
        })}\n`,
    );
    fs.writeFileSync(path.join(metaDir, ".complete"), "");
}

describe("buildPdf image findings", () => {
    const dirs: string[] = [];
    const savedConfigEnv = process.env.PACKAGE_BUILD_CONFIG;

    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
        if (savedConfigEnv === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
        else process.env.PACKAGE_BUILD_CONFIG = savedConfigEnv;
    });

    it("declines a foreign address, in a body image and a map background", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir);
        cacheDependency(config);

        const result = await buildPdf({ config, compile: false });

        expect(result.findings).toEqual([
            expect.objectContaining({
                severity: "warning",
                message: expect.stringContaining("names a file this package does not ship"),
            }),
            expect.objectContaining({
                severity: "warning",
                message: expect.stringContaining(
                    'the map background "otherpkg-none-icon-anvil" cannot be resolved',
                ),
            }),
        ]);
    });

    it("locates the missing-image warning at the picture's line and column in the note", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir);
        cacheDependency(config);
        const note = path.join(dir, "assets", "content", "Gear", "dagger.md");
        const lines = [
            "---",
            "type: weapongear",
            "shortcode: dagger",
            "name:",
            "  full: Dagger",
            "---",
            "",
            "A blade.",
            "",
            "![One](https://cdn.example.org/images/one.webp) and ![Again](https://cdn.example.org/images/one.webp)",
            "",
            "Text  ![Two](https://cdn.example.org/images/two.webp)",
            "",
        ];
        fs.writeFileSync(note, lines.join("\n"));

        const result = await buildPdf({ config, compile: false });

        const missing = result.findings.filter((f) =>
            f.message.includes("names a file this package does not ship"),
        );
        // A repeated address is reported once, at its first occurrence.
        expect(missing.map((f) => [f.line, f.column, f.message.split("`")[1]])).toEqual([
            [10, lines[9].indexOf("https://") + 1, "https://cdn.example.org/images/one.webp"],
            [12, lines[11].indexOf("https://") + 1, "https://cdn.example.org/images/two.webp"],
        ]);
    });

    it("locates the map-background warning at the fixup key that supplied the value", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir);
        cacheDependency(config);

        const result = await buildPdf({ config, compile: false });

        const note = path.join(dir, "assets", "content", "Places", "realm.md");
        const lines = fs.readFileSync(note, "utf8").split("\n");
        const at = lines.findIndex((l) => l.includes("value: otherpkg-none-icon-anvil"));
        const found = result.findings.filter((f) => f.message.includes("map background"));
        expect(found.map((f) => [f.file, f.line, f.column])).toEqual([
            [note, at + 1, lines[at].indexOf("otherpkg-none-icon-anvil") + 1],
        ]);
    });

    it("locates a banner finding at the `banner:` key of the section that declared it", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir);
        cacheDependency(config);
        const book = [
            "contents:",
            "  - sectionName: Gear",
            "    page:",
            "      banner: ../outside.webp",
            "    contents:",
            "      - filter: \"type = 'weapongear'\"",
            "      - sectionName: Blades",
            "        contents:",
            "          - filter: \"type = 'weapongear'\"",
            "  - sectionName: Places",
            "    contents:",
            "      - filter: \"type = 'map'\"",
        ];
        fs.writeFileSync(path.join(dir, "book.yaml"), book.join("\n") + "\n");

        const result = await buildPdf({ config, compile: false });

        // One finding for the declared value, at the key that wrote it, though
        // the nested section inherits it.
        const found = result.findings.filter((f) => f.message.includes("is outside this package"));
        expect(found.map((f) => [f.file, f.line, f.column])).toEqual([
            [path.join(dir, "book.yaml"), 4, book[3].indexOf("banner") + 1],
        ]);
    });

    it("locates a banner finding in the tree file of the book whose section declared it", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir, {
            books: [
                { id: "core", title: "The Test Volume", document: "book.yaml" },
                { id: "second", title: "The Second Volume", document: "second.yaml" },
            ],
        });
        cacheDependency(config);
        const plain = ["contents:", "  - sectionName: Gear", "    contents:"];
        const second = [
            "# a leading comment",
            "contents:",
            "  - sectionName: Gear",
            "    page:",
            "      banner: ../outside.webp",
            "    contents:",
            "      - filter: \"type = 'weapongear'\"",
        ];
        fs.writeFileSync(
            path.join(dir, "book.yaml"),
            [...plain, "      - filter: \"type = 'weapongear'\""].join("\n") + "\n",
        );
        fs.writeFileSync(path.join(dir, "second.yaml"), second.join("\n") + "\n");

        const result = await buildPdf({ config, compile: false });

        const found = result.findings.filter((f) => f.message.includes("is outside this package"));
        expect(found.map((f) => [f.file, f.line, f.column])).toEqual([
            [path.join(dir, "second.yaml"), 5, second[4].indexOf("banner") + 1],
        ]);
    });
});
