// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The book stages a declared replacement's picture in place of a foreign
 * address it would otherwise decline.
 *
 * `resolveAssetReplacement` (`engine/asset-replacement.mjs`) does not exist
 * in this tree yet — it is a sibling packet's module, landing on its own
 * branch. Every case here drives `stagedImagePath` and `buildPdf` through
 * `opts.resolveReplacement`, an injected stand-in for that function, rather
 * than importing the module itself: a static import of a file that is not
 * there would fail to load for every test in this suite, not only the ones
 * that need it. `engine/pdf-build.mjs` only ever reaches for the real module
 * through a dynamic `import()`, and only when a relationship declares
 * `assetReplacement: true` — which no case here routes through, since the
 * stub is supplied directly.
 *
 * **The contract the real resolver must satisfy for these cases to keep
 * passing once it exists:** called as
 * `resolveAssetReplacement(address, { localPackage, replacements, index })`,
 * where `address` is a canonical `<package>-none-<type>-<shortcode>` key
 * whose package segment is `localPackage`; it returns `null` when no
 * replacement in `replacements` (tried in order) carries the same type and
 * shortcode under its own package segment in `index`, and otherwise
 * `{ record, package }` — `record.asset.path` the file's path under that
 * package's own `assets/`, `package` the replacement that answered.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import { buildPdf, stagedImagePath } from "../engine/pdf-build.mjs";
import { configFromData } from "../engine/pack-config.mjs";

/**
 * A stand-in for `resolveAssetReplacement`, satisfying the contract
 * described above against a plain `Map` the test fills in by hand.
 *
 * @returns {Function} The resolver.
 */
function stubResolver() {
    return (address, { localPackage, replacements, index }) => {
        const parts = address.split("-");
        if (parts.length !== 4) return null;
        const [pkg, system, type, shortcode] = parts;
        if (pkg !== localPackage) return null;
        for (const candidatePackage of replacements) {
            const record = index.get([candidatePackage, system, type, shortcode].join("-"));
            if (record) return { record, package: candidatePackage };
        }
        return null;
    };
}

/** A minimal config `stagedImagePath` can resolve a pathname against. */
function unitConfig(overrides = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "sohl",
        packageKind: "modules",
        foundryPackage: "sohl",
        relationships: {
            requires: [{ id: "thalornaaltart", contentPackage: "thalornaaltart" }],
        },
        paths: { foreignCache: "/repo/build/cache/foreign" },
        ...overrides,
    };
}

describe("stagedImagePath", () => {
    it("stages a file this package ships, exactly as before", () => {
        const staged = stagedImagePath("images/beings/thorn.webp", unitConfig());
        expect(staged).toEqual({
            from: "/repo/assets/images/beings/thorn.webp",
            to: "assets/images/beings/thorn.webp",
        });
    });

    it("declines a foreign address with no declared replacement, exactly as before", () => {
        // The relationship exists (so the pathname resolves to a real
        // foreign package) but declares no `assetReplacement`, and no
        // resolver is even supplied — the gate a caller with nothing to ask
        // never reaches.
        const staged = stagedImagePath("thalornaaltart/assets/icons/anvil.svg", unitConfig());
        expect(staged).toBeNull();
    });

    it("declines a foreign address when a resolver is supplied but no replacement answers", () => {
        const config = unitConfig();
        const staged = stagedImagePath("thalornaaltart/assets/icons/anvil.svg", config, {
            foreignIndex: new Map(),
            resolveReplacement: stubResolver(),
        });
        expect(staged).toBeNull();
    });

    it("stages from a declared replacement's cached archive when it answers the address", () => {
        const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-build-cache-"));
        const archiveDir = path.join(cacheRoot, "thalornaaltart@1.0.0");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.writeFileSync(path.join(archiveDir, ".complete"), "");
        const config = unitConfig({
            relationships: {
                requires: [
                    {
                        id: "thalornaaltart",
                        contentPackage: "thalornaaltart",
                        assetReplacement: true,
                    },
                ],
            },
            paths: { foreignCache: cacheRoot },
        });
        const index = new Map([
            [
                "thalornaaltart-none-icon-anvil",
                { package: "thalornaaltart", asset: { path: "icons/anvil.svg" } },
            ],
        ]);

        const staged = stagedImagePath("thalornaaltart/assets/icons/anvil.svg", config, {
            foreignIndex: index,
            resolveReplacement: stubResolver(),
        });

        expect(staged).toEqual({
            from: path.join(archiveDir, "assets", "icons", "anvil.svg"),
            to: "assets/icons/anvil.svg",
        });
    });

    it("stages a replacement for the package's own address, which is what declaring one buys", () => {
        // The note writes this package's own address, as every note does. A
        // declared replacement answers it, so the picture staged is the
        // replacement's and not the one this package ships — the case the
        // whole mechanism exists for.
        const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-build-own-"));
        const archiveDir = path.join(cacheRoot, "thalornaaltart@1.0.0");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.writeFileSync(path.join(archiveDir, ".complete"), "");
        const config = unitConfig({
            relationships: {
                requires: [
                    {
                        id: "thalornaaltart",
                        contentPackage: "thalornaaltart",
                        assetReplacement: true,
                    },
                ],
            },
            paths: { foreignCache: cacheRoot },
        });
        const index = new Map([
            [
                "thalornaaltart-none-image-thorn",
                { package: "thalornaaltart", asset: { path: "images/beings/thorn.webp" } },
            ],
        ]);

        const staged = stagedImagePath("images/beings/thorn.webp", config, {
            foreignIndex: index,
            resolveReplacement: stubResolver(),
        });

        expect(staged).toEqual({
            from: path.join(archiveDir, "assets", "images", "beings", "thorn.webp"),
            to: "assets/images/beings/thorn.webp",
        });
    });

    it("stages the package's own file where a replacement is declared but answers nothing", () => {
        const config = unitConfig({
            relationships: {
                requires: [
                    {
                        id: "thalornaaltart",
                        contentPackage: "thalornaaltart",
                        assetReplacement: true,
                    },
                ],
            },
        });
        const staged = stagedImagePath("images/beings/groa.webp", config, {
            foreignIndex: new Map(),
            resolveReplacement: stubResolver(),
        });
        expect(staged).toEqual({
            from: "/repo/assets/images/beings/groa.webp",
            to: "assets/images/beings/groa.webp",
        });
    });

    it("throws a located error naming the relationship when the replacement answers but its archive was never fetched", () => {
        const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-build-cache-"));
        const config = unitConfig({
            relationships: {
                requires: [
                    {
                        id: "thalornaaltart",
                        contentPackage: "thalornaaltart",
                        assetReplacement: true,
                    },
                ],
            },
            paths: { foreignCache: cacheRoot },
        });
        const index = new Map([
            [
                "thalornaaltart-none-icon-anvil",
                { package: "thalornaaltart", asset: { path: "icons/anvil.svg" } },
            ],
        ]);

        expect(() =>
            stagedImagePath("thalornaaltart/assets/icons/anvil.svg", config, {
                foreignIndex: index,
                resolveReplacement: stubResolver(),
            }),
        ).toThrow(
            "`thalornaaltart` declares `assetReplacement: true` and carries " +
                "`sohl-none-icon-anvil`, but its archive has not been fetched. Run " +
                "`package-build deps fetch` first.",
        );
    });
});

/**
 * A fixture repository, configured and cached enough for `buildPdf` to run
 * against it directly — the cheaper half of what `tests/pdf-book.test.ts`
 * builds through the CLI, skipped here because the CLI's own config loader
 * refuses `assetReplacement` until the sibling packet that declares it
 * lands.
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
            "![[thalornaaltart-none-icon-anvil|An anvil]]\n",
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
            "    - { path: '.levels[0].background.src', type: address, value: thalornaaltart-none-icon-anvil }\n" +
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
    // A real, valid configuration on disk: `buildPdf`'s own staging reads
    // `config` directly (built below with `configFromData`), but resolving
    // the content tree's addresses falls through, elsewhere in the engine,
    // to a configuration discovered from the working directory — this is
    // what that discovery reads, so it has to parse under today's validator,
    // which does not know `assetReplacement` yet.
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

/**
 * The resolved configuration `buildPdf` compiles against, with a
 * `thalornaaltart` replacement relationship — declared directly on the
 * returned object rather than through the YAML file, since the validator
 * that reads the YAML does not accept `assetReplacement` yet.
 */
function resolveFixtureConfig(dir, { declareReplacement = true } = {}) {
    const base = configFromData(
        {
            contentPackage: "sohl",
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            pdf: {
                title: "The Test Volume",
                document: "book.yaml",
                fonts: { serif: "Libertinus Serif" },
            },
        },
        path.join(dir, "package-build.config.yaml"),
    );
    return {
        ...base,
        relationships: {
            requires: [
                {
                    id: "thalornaaltart",
                    contentPackage: "thalornaaltart",
                    ...(declareReplacement ? { assetReplacement: true } : {}),
                },
            ],
        },
    };
}

/** Fetch `thalornaaltart`'s content index and (optionally) its archive into the fixture's caches. */
function cacheReplacement(config, { archive = true } = {}) {
    const metaDir = path.join(config.paths.metadataCache, "thalornaaltart@1.0.0");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
        path.join(metaDir, "index.jsonl"),
        `${JSON.stringify({
            package: "thalornaaltart",
            type: "icon",
            shortcode: "anvil",
            address: { canonical: "thalornaaltart-none-icon-anvil" },
            asset: { path: "icons/anvil.svg" },
        })}\n`,
    );
    fs.writeFileSync(path.join(metaDir, ".complete"), "");

    if (!archive) return;
    const archiveDir = path.join(config.paths.foreignCache, "thalornaaltart@1.0.0");
    fs.mkdirSync(path.join(archiveDir, "assets", "icons"), { recursive: true });
    fs.writeFileSync(
        path.join(archiveDir, "assets", "icons", "anvil.svg"),
        "<svg>replacement</svg>",
    );
    fs.writeFileSync(path.join(archiveDir, ".complete"), "");
}

describe("buildPdf staging a replacement", () => {
    const dirs: string[] = [];
    const savedConfigEnv = process.env.PACKAGE_BUILD_CONFIG;

    afterEach(() => {
        for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
        if (savedConfigEnv === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
        else process.env.PACKAGE_BUILD_CONFIG = savedConfigEnv;
    });

    it("stages a replaced picture at both call sites — a body image and a map background", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir);
        cacheReplacement(config);

        const result = await buildPdf({
            config,
            compile: false,
            resolveReplacement: stubResolver(),
        });

        expect(result.findings).toEqual([]);
        expect(result.built).toBe(true);
        const staged = path.join(dir, "build", "dist", "assets", "icons", "anvil.svg");
        expect(fs.readFileSync(staged, "utf8")).toBe("<svg>replacement</svg>");
    });

    it("declines an undeclared foreign address exactly as before, with no replacement in play", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        // No `assetReplacement` declared at all: the dependency is still
        // addressable (its content index resolves), it simply never opted in.
        const config = resolveFixtureConfig(dir, { declareReplacement: false });
        cacheReplacement(config);

        const result = await buildPdf({
            config,
            compile: false,
            resolveReplacement: stubResolver(),
        });

        expect(result.findings).toEqual([
            expect.objectContaining({
                severity: "warning",
                message: expect.stringContaining("names a file this package does not ship"),
            }),
            expect.objectContaining({
                severity: "warning",
                message: expect.stringContaining(
                    'the map background "thalornaaltart-none-icon-anvil" cannot be resolved',
                ),
            }),
        ]);
    });

    it("reports a located error naming the relationship when the replacement's archive was never fetched", async () => {
        const dir = makeFixture();
        dirs.push(dir);
        process.env.PACKAGE_BUILD_CONFIG = path.join(dir, "package-build.config.yaml");
        const config = resolveFixtureConfig(dir);
        cacheReplacement(config, { archive: false });

        const result = await buildPdf({
            config,
            compile: false,
            resolveReplacement: stubResolver(),
        });

        expect(result.findings).toContainEqual(
            expect.objectContaining({
                severity: "error",
                message:
                    "`thalornaaltart` declares `assetReplacement: true` and carries " +
                    "`sohl-none-icon-anvil`, but its archive has not been fetched. Run " +
                    "`package-build deps fetch` first.",
            }),
        );
    });
});
