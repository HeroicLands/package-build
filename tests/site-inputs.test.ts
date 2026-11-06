/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { siteBuildConfig } from "../content-config.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { serveSite } from "../engine/site-serve.mjs";
import { fixtureConfig, PACKAGE_ROOT } from "./helpers/parity";

const roots: string[] = [];
function fixture(provider?: string) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-inputs-")));
    roots.push(root);
    fs.cpSync(path.join(PACKAGE_ROOT, "tests/fixtures/root-site"), root, { recursive: true });
    if (provider !== undefined) {
        fs.mkdirSync(path.join(root, "utils"));
        fs.writeFileSync(path.join(root, "utils/site-inputs.mjs"), provider);
        fs.appendFileSync(
            path.join(root, "package-build.config.yaml"),
            "    inputs: utils/site-inputs.mjs\n",
        );
    }
    const out = path.join(root, "build/site");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "index.html"), "last good build");
    return { root, out };
}
const provider = `export default async function({config}) {
    const navigation = [{name: "Selected home", url: new URL("/", config.homepage).href}];
    return {navigation, files: {"nav.json": JSON.stringify(navigation), "data/origins.json": JSON.stringify({
        homepage: config.homepage, assets: config.site.assets,
        frozen: Object.isFrozen(config) && Object.isFrozen(config.site),
    })}};
}`;
const output = (files: unknown, navigation: unknown = []) =>
    `export default () => (${JSON.stringify({ navigation, files })});`;
afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("site input providers", () => {
    it.each(["internal.heroiclands.org", "heroiclands.org"])(
        "builds with %s inputs without a navigation cache",
        async (domain) => {
            const { root, out } = fixture(provider);
            const authored = fixtureConfig(root);
            const config = siteBuildConfig(authored, { root: domain });
            const result = await buildPackageSite({ config, out });
            expect(result.written).not.toBeNull();
            const navigation = JSON.parse(fs.readFileSync(path.join(out, "nav.json"), "utf8"));
            expect(navigation).toEqual([{ name: "Selected home", url: `https://www.${domain}/` }]);
            expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toContain(
                `href="${navigation[0].url}" class="nav-link`,
            );
            expect(
                JSON.parse(fs.readFileSync(path.join(out, "data/origins.json"), "utf8")),
            ).toEqual({
                homepage: `https://www.${domain}/`,
                assets: `https://cdn.${domain}`,
                frozen: true,
            });
            expect(result.written.files).toContain(path.join(out, "nav.json"));
            expect(authored.homepage).toBe("https://www.example.org/");
        },
    );

    it.each([
        "/absolute.mjs",
        "../outside.mjs",
        "utils/../outside.mjs",
        "utils\\outside.mjs",
        "./utils/site-inputs.mjs",
        "",
    ])("rejects nonlocal or unsafe provider module path %s", (modulePath) => {
        const { root } = fixture(provider);
        const yaml = path.join(root, "package-build.config.yaml");
        fs.writeFileSync(
            yaml,
            fs
                .readFileSync(yaml, "utf8")
                .replace("inputs: utils/site-inputs.mjs", `inputs: ${JSON.stringify(modulePath)}`),
        );
        expect(() => fixtureConfig(root)).toThrow(/site.inputs/);
    });

    it("serves provider-backed output without a navigation cache", async () => {
        const { root, out } = fixture(provider);
        const config = siteBuildConfig(fixtureConfig(root), { root: "internal.heroiclands.org" });
        const served = await serveSite({ config, out, root: out, port: 0, search: false });
        try {
            await served.settled();
            const response = await fetch(new URL("nav.json", served.url));
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual([
                { name: "Selected home", url: "https://www.internal.heroiclands.org/" },
            ]);
        } finally {
            await served.close();
        }
    });

    it("retains the navigation-cache requirement without a provider", async () => {
        const { root, out } = fixture();
        await expect(
            buildPackageSite({ config: siteBuildConfig(fixtureConfig(root)), out }),
        ).rejects.toThrow("deps fetch");
        expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
    });

    it("rejects a provider's canonical drift finding before content or output changes", async () => {
        const { root, out } = fixture(
            'export default () => { throw new Error("canonical navigation drift"); };',
        );
        fs.writeFileSync(path.join(root, "assets/content/homepage.md"), "invalid content");
        await expect(
            buildPackageSite({ config: siteBuildConfig(fixtureConfig(root)), out }),
        ).rejects.toThrow("canonical navigation drift");
        expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
    });

    it.each([
        "/outside.json",
        "../outside.json",
        "./nav.json",
        "a//nav.json",
        "a/../nav.json",
        "a\\nav.json",
        "a%2fnav.json",
        "C:/nav.json",
        ".hidden/nav.json",
        "index.html",
        "INDEX.HTML",
        "doc-roadproject/index.html",
        "doc-roadproject",
        "fonts/nav.json",
        "css/nav.json",
        "js/nav.json",
        "img/nav.json",
        "assets/nav.json",
        "pagefind/nav.json",
        "tags/nav.json",
        "sitemap.xml",
        "sitemap-index.xml",
        "robots.txt",
        "_headers",
        "blog/atom.xml",
    ])("refuses unsafe or builder-owned file %s before replacing output", async (file) => {
        const { root, out } = fixture(output({ [file]: "bad" }));
        await expect(
            buildPackageSite({ config: siteBuildConfig(fixtureConfig(root)), out }),
        ).rejects.toThrow(/site.inputs/);
        expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
        expect(fs.existsSync(path.join(root, "build/outside.json"))).toBe(false);
    });

    it.each([
        { data: "text", "data/nav.json": "text" },
        { "nav.json": "text", "NAV.json": "text" },
        { "nav.json": 3 },
    ])("rejects colliding paths or nontext files", async (files) => {
        const { root, out } = fixture(output(files));
        await expect(
            buildPackageSite({ config: siteBuildConfig(fixtureConfig(root)), out }),
        ).rejects.toThrow(/site.inputs/);
        expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
    });

    it("rejects malformed navigation before replacing output", async () => {
        const { root, out } = fixture(output({ "nav.json": "[]" }, [{ name: "Missing URL" }]));
        await expect(
            buildPackageSite({ config: siteBuildConfig(fixtureConfig(root)), out }),
        ).rejects.toThrow(/site.inputs.*url/);
        expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
    });

    it.each(["destination", "module"])("rejects %s symlinks before writing", async (kind) => {
        const { root, out } = fixture(provider);
        const target = path.join(root, "external");
        fs.mkdirSync(target);
        if (kind === "destination") fs.symlinkSync(target, path.join(out, "data"));
        else {
            fs.renameSync(
                path.join(root, "utils/site-inputs.mjs"),
                path.join(target, "inputs.mjs"),
            );
            fs.symlinkSync(
                path.join(target, "inputs.mjs"),
                path.join(root, "utils/site-inputs.mjs"),
            );
        }
        await expect(
            buildPackageSite({ config: siteBuildConfig(fixtureConfig(root)), out }),
        ).rejects.toThrow(/site.inputs.*symlink/);
        expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("last good build");
        expect(fs.readdirSync(target)).toEqual(kind === "module" ? ["inputs.mjs"] : []);
    });
});
