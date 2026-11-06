/* SPDX-License-Identifier: GPL-3.0-or-later */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { cacheNavigation, fixtureConfig, PACKAGE_ROOT } from "./helpers/parity";
import { siteBuildConfig } from "../content-config.mjs";

const roots: string[] = [];
const CLI = path.join(PACKAGE_ROOT, "bin/package-build.mjs");

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-overrides-")));
    roots.push(root);
    fs.cpSync(path.join(PACKAGE_ROOT, "tests/fixtures/root-site"), root, { recursive: true });
    const yaml = path.join(root, "package-build.config.yaml");
    fs.writeFileSync(
        yaml,
        fs.readFileSync(yaml, "utf8").replace(/^    (base|sitemaps|mergeIndexes):.*\n/gm, ""),
    );
    const pkg = path.join(root, "package.json");
    const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
    data.homepage = "https://www.example.org/rootdemo/";
    fs.writeFileSync(pkg, JSON.stringify(data));
    fs.cpSync(
        path.join(PACKAGE_ROOT, "tests/fixtures/script-fonts/fonts"),
        path.join(root, "node_modules/@heroiclands/fonts"),
        { recursive: true },
    );
    fs.appendFileSync(
        path.join(root, "assets/content/Pages/road.md"),
        "\nThe inscription reads [\u{F0200}]{font=semaron-kuriale}.\n" +
            "\n[Project attribution](https://www.heroiclands.org/author/) and [External credit](https://example.org/credit/).\n" +
            "\n![Shared image](https://cdn.heroiclands.org/sohl/images/map.webp?size=2#detail)\n" +
            "\n![External image](https://example.org/image.webp)\n" +
            "\n[CDN attribution](https://cdn.heroiclands.org/sohl/images/map.webp)\n",
    );
    cacheNavigation(fixtureConfig(root));
    return root;
}

function build(root: string, args: string[]) {
    return spawnSync(process.execPath, [CLI, "site", "build", ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: "" },
    });
}

afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("site build runtime URLs", () => {
    it("documents every option declared by siteBuildCommand in its own reference section", () => {
        const source = fs.readFileSync(path.join(PACKAGE_ROOT, "bin/content-commands.mjs"), "utf8");
        const body = source.match(/function siteBuildCommand\(\) \{([\s\S]*?)\n\}/)![1];
        const options = [...body.matchAll(/\.option\("([^"]+)"/g)].map((match) => match[1]);
        expect(options.length).toBeGreaterThan(0);
        const manual = fs.readFileSync(path.join(PACKAGE_ROOT, "docs/commands.md"), "utf8");
        const section = manual.split("### `package-build site build`")[1].split("\n### ")[0];
        for (const option of options)
            expect(section, option).toMatch(new RegExp("`--" + option + "(?:`| )"));
    });

    it.each([
        [
            "defaults",
            "https://www.internal.heroiclands.org/rootdemo/",
            "https://cdn.example.org",
            [],
        ],
        [
            "public root",
            "https://www.heroiclands.org/rootdemo/",
            "https://cdn.heroiclands.org",
            ["--root", "heroiclands.org"],
        ],
        [
            "explicit internal root",
            "https://www.internal.heroiclands.org/rootdemo/",
            "https://cdn.internal.heroiclands.org",
            ["--root", "internal.heroiclands.org"],
        ],
        [
            "internal main",
            "https://www.internal.heroiclands.org/rootdemo/",
            "https://cdn.internal.heroiclands.org",
            [
                "--base-url",
                "https://www.internal.heroiclands.org/rootdemo/",
                "--assets",
                "https://cdn.internal.heroiclands.org/",
            ],
        ],
        [
            "nested PR",
            "https://www.internal.heroiclands.org/pr/rootdemo/123/rootdemo/",
            "https://cdn.internal.heroiclands.org/media",
            [
                "--base-url",
                "https://www.internal.heroiclands.org/pr/rootdemo/123/rootdemo/",
                "--assets",
                "https://cdn.internal.heroiclands.org/media/",
            ],
        ],
    ])(
        "builds %s through the CLI",
        (_label, homepage, assets, args) => {
            const root = fixture();
            const authored = [
                "package.json",
                "package-build.config.yaml",
                "assets/content/Pages/road.md",
            ].map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]);
            const result = build(root, args as string[]);
            expect(result.stderr).toBe("");
            expect(result.status, result.stdout).toBe(0);
            const base = new URL(homepage as string).pathname;
            const out = path.join(root, "build/site", base);
            const read = (file: string) => fs.readFileSync(path.join(out, file), "utf8");
            const html = read("doc-roadproject/index.html");
            expect(html).toContain(`${base}blog/`);
            expect(html).toContain(`${new URL(homepage as string).origin}/license/`);
            expect(html).toContain(
                `href="${new URL(homepage as string).origin}/" class="nav-link"`,
            );
            expect(html).toContain('href="https://www.heroiclands.org/author/"');
            expect(html).toContain('href="https://example.org/credit/"');
            expect(html).toContain(`${assets}/images/brand/sohl-icon-white.webp`);
            expect(html).toContain(`src="${assets}/sohl/images/map.webp?size=2#detail"`);
            expect(html).toContain('src="https://example.org/image.webp"');
            expect(html).toContain('href="https://cdn.heroiclands.org/sohl/images/map.webp"');
            expect(html).toContain(`${base}fonts/heroiclands/1.4.0/fonts.css`);
            expect(html).toContain(`${base}pagefind/`);
            expect(read("sitemap.xml")).toContain(`${homepage}doc-roadproject/`);
            expect(read("blog/atom.xml")).toContain(`${homepage}doc-secondlantern/`);
            expect(
                fs.existsSync(
                    path.join(out, "fonts/heroiclands/1.4.0/fonts/SemaronKuriale-Regular.woff2"),
                ),
            ).toBe(true);
            expect(fs.existsSync(path.join(out, "pagefind/pagefind.js"))).toBe(true);
            const fragments = fs
                .readdirSync(path.join(out, "pagefind/fragment"))
                .map((file) =>
                    gunzipSync(
                        fs.readFileSync(path.join(out, "pagefind/fragment", file)),
                    ).toString(),
                )
                .join("\n");
            expect(fragments).toContain("doc-roadproject");
            expect(fs.readFileSync(path.join(root, "build/site/_headers"), "utf8")).toContain(
                "X-Robots-Tag: noindex",
            );
            for (const [file, original] of authored)
                expect(fs.readFileSync(path.join(root, file), "utf8")).toBe(original);
        },
        120_000,
    );

    it.each([
        ["--root", "https://heroiclands.org"],
        ["--root", "heroiclands.org/path"],
        ["--root", "heroiclands.org:443"],
        ["--root", "user@heroiclands.org"],
        ["--root", "heroiclands.org?x"],
        ["--root", "-invalid.org"],
        ["--root", "invalid..org"],
        ["--root", ""],
        ["--base-url", "https:///example.org/rootdemo/"],
        ["--base-url", "/relative/"],
        ["--base-url", "ftp://example.org/rootdemo/"],
        ["--base-url", "https://example.org/no-slash"],
        ["--base-url", "https://example.org/rootdemo/?q=yes"],
        ["--base-url", "https://user:secret@example.org/rootdemo/"],
        ["--base-url", "https://example.org/rootdemo/#part"],
        ["--assets", "/relative"],
        ["--assets", "https://cdn.example.org/?q=yes"],
        ["--assets", "https://cdn.example.org/#part"],
        ["--assets", "https://user:secret@cdn.example.org"],
        ["--assets", "https://"],
        ["--assets", ""],
        ["--base-url", ""],
    ])(
        "refuses unusable %s %s before replacing output",
        (flag, value) => {
            const root = fixture();
            const out = path.join(root, "build/site/rootdemo");
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(out, "index.html"), "last good build");
            const result = build(root, [`${flag}=${value}`]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(flag);
            expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
        },
        30_000,
    );

    it.each(["%2e%2e", "..", "."])(
        "refuses raw %s dot segments before replacing either output tree",
        (segment) => {
            const root = fixture();
            const sentinels = ["rootdemo/index.html", "pr/rootdemo/index.html", "_headers"];
            for (const file of sentinels) {
                const target = path.join(root, "build/site", file);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, `existing ${file}`);
            }
            const result = build(root, [
                "--base-url",
                `https://preview.example.org/pr/${segment}/rootdemo/`,
            ]);
            expect(result.status, result.stderr).toBe(1);
            expect(result.stderr).toContain("--base-url");
            expect(result.stderr).toContain("dot segments");
            for (const file of sentinels) {
                expect(fs.readFileSync(path.join(root, "build/site", file), "utf8")).toBe(
                    `existing ${file}`,
                );
            }
        },
        30_000,
    );

    it.each(["%2e%2e", "%2E", ".%2e", "%2e.", "..", "."])(
        "refuses %s asset dot segments before URL normalization",
        (segment) => {
            const config = fixtureConfig(fixture());
            expect(() =>
                siteBuildConfig(config, {
                    assets: `https://cdn.example.org/pr/${segment}/images/`,
                }),
            ).toThrow(/--assets.*dot segments/);
            expect(config.site.assets).toBe("https://cdn.example.org");
        },
    );

    it("resolves root and low-level precedence without changing the authored config", () => {
        const authored = fixtureConfig(fixture());
        const original = JSON.stringify(authored);
        const defaults = siteBuildConfig(authored, {});
        expect(defaults.homepage).toBe("https://www.internal.heroiclands.org/rootdemo/");
        expect(defaults.site.assets).toBe("https://cdn.example.org");
        const selected = siteBuildConfig(authored, { root: "heroiclands.org" });
        expect(selected.site.assets).toBe("https://cdn.heroiclands.org");
        expect(selected.site.base).toBe("/rootdemo/");
        expect(Object.isFrozen(selected.site)).toBe(true);
        const overrides = siteBuildConfig(authored, {
            root: "heroiclands.org",
            baseUrl: "https://preview.example.org/pr/rootdemo/123/rootdemo/",
            assets: "https://assets.example.org/media/",
        });
        expect(overrides.homepage).toBe("https://preview.example.org/pr/rootdemo/123/rootdemo/");
        expect(overrides.site.assets).toBe("https://assets.example.org/media");
        expect(JSON.stringify(authored)).toBe(original);
    });

    it("checks the authored homepage even when a valid override is supplied", () => {
        const root = fixture();
        const pkg = path.join(root, "package.json");
        const data = JSON.parse(fs.readFileSync(pkg, "utf8"));
        data.homepage = "https://www.example.org/wrong/";
        fs.writeFileSync(pkg, JSON.stringify(data));
        const result = build(root, ["--base-url", "https://preview.example.org/rootdemo/"]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("homepage");
        expect(fs.existsSync(path.join(root, "build/site"))).toBe(false);
    }, 30_000);
});
