/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The site build's Texinfo step: which files are manuals, the `texi2any`
 * command line it runs, the located findings it reports, and, with the real
 * converter, the pages it writes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { siteBuildConfig } from "../content-config.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { buildTexinfo, findTexinfoManuals, texinfoArguments } from "../engine/site-texinfo.mjs";
import { cacheNavigation, fixtureConfig, PACKAGE_ROOT } from "./helpers/parity";
import { skipUnlessPresent, texi2anySkip } from "./helpers/texinfo-tools";

const roots: string[] = [];
afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function scratch(prefix = "site-texinfo-") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

function write(root: string, rel: string, text: string) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

const MANUAL = (name: string) =>
    `\\input texinfo\n@setfilename ${name}.info\n@settitle ${name}\n@node Top\n@top ${name}\n\nBody.\n\n@bye\n`;

type Call = { command: string; args: string[]; cwd?: string };

function stub(result: Record<string, unknown> = { status: 0, stdout: "", stderr: "" }) {
    const calls: Call[] = [];
    const run = (command: string, args: string[], options: { cwd?: string }) => {
        calls.push({ command, args, cwd: options.cwd });
        return result;
    };
    return { calls, run: run as never };
}

const config = (rootDir: string, texinfo = "texinfo") => ({ rootDir, site: { texinfo } });

describe("discovery", () => {
    it("finds `.texi` and `.texinfo` files that hold an @setfilename line", () => {
        const root = scratch();
        write(root, "texinfo/guide.texi", MANUAL("guide"));
        write(root, "texinfo/nested/ref.texinfo", MANUAL("ref"));
        write(root, "texinfo/chapter.texi", "@node Chapter\n@chapter Chapter\n");
        write(root, "texinfo/notes.txt", MANUAL("notes"));
        write(root, "texinfo/.hidden/skip.texi", MANUAL("skip"));
        expect(findTexinfoManuals(path.join(root, "texinfo")).map((m) => m.name)).toEqual([
            "guide",
            "ref",
        ]);
    });

    it("finds nothing in a folder that does not exist", () => {
        expect(findTexinfoManuals(path.join(scratch(), "texinfo"))).toEqual([]);
    });
});

describe("the converter command", () => {
    it("is texi2any with the site stylesheet and the shared Info script directory", () => {
        expect(
            texinfoArguments({
                manual: "/m/guide.texi",
                output: "/o/texi/guide",
                stylesheet: "/p/css/texinfo.css",
            }),
        ).toEqual([
            "--html",
            "--css-ref=/p/css/texinfo.css",
            "-c",
            "INFO_JS_DIR=../js",
            "-o",
            "/o/texi/guide",
            "/m/guide.texi",
        ]);
    });

    it("runs once per manual, in the manual's folder, writing under texi/<name>", () => {
        const root = scratch();
        const guide = write(root, "texinfo/guide.texi", MANUAL("guide"));
        const ref = write(root, "texinfo/ref/ref.texi", MANUAL("ref"));
        const out = path.join(root, "out");
        const { calls, run } = stub();
        const result = buildTexinfo({ config: config(root), out, base: "/demo/", run });
        expect(result.findings).toEqual([]);
        expect(result.manuals.map((m: { name: string }) => m.name)).toEqual(["guide", "ref"]);
        expect(calls.map((c) => c.command)).toEqual(["texi2any", "texi2any"]);
        expect(calls[0].args).toEqual(
            texinfoArguments({
                manual: guide,
                output: path.join(out, "texi/guide"),
                stylesheet: "/demo/css/texinfo.css",
            }),
        );
        expect(calls[1].args.at(-1)).toBe(ref);
        expect(calls[1].cwd).toBe(path.dirname(ref));
    });

    it("reads the folder `site.texinfo` names", () => {
        const root = scratch();
        write(root, "build/docs/manual.texi", MANUAL("manual"));
        const { calls, run } = stub();
        buildTexinfo({
            config: config(root, "build/docs"),
            out: path.join(root, "out"),
            base: "/d/",
            run,
        });
        expect(calls).toHaveLength(1);
    });

    it("points at the package's own texinfo.css, and publishes it, when the folder has one", () => {
        const root = scratch();
        write(root, "texinfo/guide.texi", MANUAL("guide"));
        write(root, "texinfo/texinfo.css", "body { color: red; }\n");
        const out = path.join(root, "out");
        const { calls, run } = stub();
        buildTexinfo({ config: config(root), out, base: "/demo/", run });
        expect(calls[0].args).toContain("--css-ref=/demo/texi/texinfo.css");
        expect(fs.readFileSync(path.join(out, "texi/texinfo.css"), "utf8")).toContain("color: red");
    });
});

describe("findings", () => {
    it("names the tool, located, when texi2any is missing", () => {
        const root = scratch();
        const manual = write(root, "texinfo/guide.texi", MANUAL("guide"));
        const { run } = stub({
            error: Object.assign(new Error("spawn texi2any ENOENT"), { code: "ENOENT" }),
        });
        const result = buildTexinfo({
            config: config(root),
            out: path.join(root, "out"),
            base: "/d/",
            run,
        });
        expect(result.manuals).toEqual([]);
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]).toMatchObject({
            file: path.relative(process.cwd(), manual),
            line: 1,
            column: 1,
            severity: "error",
        });
        expect(result.findings[0].message).toContain("`texi2any` is not installed");
    });

    it("locates what the converter reports", () => {
        const root = scratch();
        const manual = write(root, "texinfo/guide.texi", MANUAL("guide"));
        const { run } = stub({
            status: 1,
            stdout: "",
            stderr: `${manual}:7: @foo is not a command\n${manual}:9: warning: unused node\n`,
        });
        const result = buildTexinfo({
            config: config(root),
            out: path.join(root, "out"),
            base: "/d/",
            run,
        });
        expect(result.manuals).toEqual([]);
        expect(
            result.findings.map((f: { line: number; severity: string }) => [f.line, f.severity]),
        ).toEqual([
            [7, "error"],
            [9, "warning"],
        ]);
    });

    it("reports a failure with no located message at the manual", () => {
        const root = scratch();
        write(root, "texinfo/guide.texi", MANUAL("guide"));
        const { run } = stub({ status: 2, stdout: "", stderr: "boom\n" });
        const result = buildTexinfo({
            config: config(root),
            out: path.join(root, "out"),
            base: "/d/",
            run,
        });
        expect(result.findings[0].message).toContain("exited with status 2");
    });

    it("refuses two manuals with one name", () => {
        const root = scratch();
        write(root, "texinfo/a/guide.texi", MANUAL("guide"));
        write(root, "texinfo/b/guide.texinfo", MANUAL("guide"));
        const { calls, run } = stub();
        const result = buildTexinfo({
            config: config(root),
            out: path.join(root, "out"),
            base: "/d/",
            run,
        });
        expect(calls).toEqual([]);
        expect(result.findings[0].message).toContain("each name is used once");
    });

    it("does nothing, and finds nothing, for a package without Texinfo files", () => {
        const root = scratch();
        const out = path.join(root, "out");
        const { calls, run } = stub();
        expect(buildTexinfo({ config: config(root), out, base: "/d/", run })).toEqual({
            manuals: [],
            findings: [],
        });
        expect(calls).toEqual([]);
        expect(fs.existsSync(out)).toBe(false);
    });
});

function siteFixture() {
    const root = scratch("site-texinfo-site-");
    fs.cpSync(path.join(PACKAGE_ROOT, "tests/fixtures/root-site"), root, { recursive: true });
    cacheNavigation(fixtureConfig(root));
    const out = path.join(root, "build/site");
    return { root, out };
}

describe("the site build", () => {
    it("builds a package without Texinfo files exactly as before", async () => {
        const { root, out } = siteFixture();
        const config = siteBuildConfig(fixtureConfig(root), { root: "internal.heroiclands.org" });
        const result = await buildPackageSite({ config, out });
        expect(result.written).not.toBeNull();
        expect(result.texinfo).toEqual({ manuals: [], findings: [] });
        expect(fs.existsSync(path.join(out, "texi"))).toBe(false);
    });

    it("converts a manual with the real texi2any under texi/, with the stylesheet beside the site's", async (context) => {
        skipUnlessPresent(context, texi2anySkip());
        const { root, out } = siteFixture();
        write(root, "texinfo/guide.texi", MANUAL("guide"));
        const config = siteBuildConfig(fixtureConfig(root), { root: "internal.heroiclands.org" });
        const result = await buildPackageSite({ config, out });
        expect(result.texinfo.findings).toEqual([]);
        expect(result.texinfo.manuals.map((m: { name: string }) => m.name)).toEqual(["guide"]);
        const page = fs.readFileSync(path.join(out, "texi/guide/index.html"), "utf8");
        expect(page).toContain('href="/css/texinfo.css"');
        expect(page).toContain('src="../js/info.js"');
        expect(fs.existsSync(path.join(out, "texi/js/info.js"))).toBe(true);
        expect(fs.existsSync(path.join(out, "css/texinfo.css"))).toBe(true);
    }, 120_000);

    it("converts package-build's own manual", async (context) => {
        skipUnlessPresent(context, texi2anySkip());
        const { spawnSync } = await import("node:child_process");
        const root = scratch("site-texinfo-docs-");
        const built = spawnSync(
            process.execPath,
            [
                path.join(PACKAGE_ROOT, "scripts/docs-texinfo.mjs"),
                "--root",
                PACKAGE_ROOT,
                "--out",
                path.join(root, "build/docs"),
            ],
            { encoding: "utf8", maxBuffer: 1 << 26 },
        );
        expect(built.status, built.stderr).toBe(0);
        const out = path.join(root, "out");
        const result = buildTexinfo({
            config: config(root, "build/docs"),
            out,
            base: "/packagebuild/",
        });
        expect(result.findings.filter((f: { severity: string }) => f.severity === "error")).toEqual(
            [],
        );
        expect(result.manuals.map((m: { name: string }) => m.name)).toEqual(["package-build"]);
        expect(fs.existsSync(path.join(out, "texi/package-build/index.html"))).toBe(true);
    }, 300_000);
});

describe("what the converter prints", () => {
    const manualIn = (root: string) => write(root, "texinfo/guide.texi", MANUAL("guide"));
    const run = (root: string, result: Record<string, unknown>) =>
        buildTexinfo({
            config: config(root),
            out: path.join(root, "out"),
            base: "/d/",
            run: stub(result).run,
        });

    it("reads an error as texi2any prints it, with no severity word", () => {
        const root = scratch();
        const manual = manualIn(root);
        const result = run(root, {
            status: 1,
            stderr: `${manual}:6: unknown command \`foo'\n${manual}:9: warning: node \`Bar' unreferenced\n`,
        });
        expect(result.findings).toMatchObject([
            { line: 6, column: 1, severity: "error", message: "unknown command `foo'" },
            { line: 9, column: 1, severity: "warning" },
        ]);
    });

    it("reads a message with a column, and one with no line", () => {
        const root = scratch();
        const manual = manualIn(root);
        const result = run(root, {
            status: 1,
            stderr: `${manual}:4: 12: warning: odd\ntexi2any: could not open nothing.texi\n`,
        });
        expect(result.findings).toMatchObject([
            { line: 4, column: 12, severity: "warning" },
            { line: 1, column: 1, severity: "error", message: "could not open nothing.texi" },
        ]);
    });

    it("keeps unlocated text in the message of a failed run", () => {
        const root = scratch();
        manualIn(root);
        const result = run(root, { status: 1, stderr: "something odd happened\n" });
        expect(result.findings[0].message).toContain(
            "exited with status 1: something odd happened",
        );
    });

    it("does not fail a run that only warns", () => {
        const root = scratch();
        const manual = manualIn(root);
        const result = run(root, { status: 0, stderr: `${manual}:9: warning: unused\n` });
        expect(result.manuals).toHaveLength(1);
        expect(result.findings).toMatchObject([{ severity: "warning", line: 9 }]);
    });

    it("reports a run stopped for its time, located", () => {
        const root = scratch();
        manualIn(root);
        const result = run(root, {
            error: Object.assign(new Error("spawnSync texi2any ETIMEDOUT"), { code: "ETIMEDOUT" }),
        });
        expect(result.findings[0]).toMatchObject({ line: 1, column: 1, severity: "error" });
        expect(result.findings[0].message).toContain("stopped after 300 seconds");
    });
});

describe("names", () => {
    it("refuses a manual named js and names that differ only in case", () => {
        const root = scratch();
        write(root, "texinfo/js.texi", MANUAL("js"));
        write(root, "texinfo/a/Guide.texi", MANUAL("Guide"));
        write(root, "texinfo/b/guide.texi", MANUAL("guide"));
        write(root, "texinfo/c/odd name.texi", MANUAL("odd"));
        const { calls, run } = stub();
        const result = buildTexinfo({
            config: config(root),
            out: path.join(root, "out"),
            base: "/d/",
            run,
        });
        expect(calls).toEqual([]);
        const messages = result.findings.map((f: { message: string }) => f.message).join("\n");
        expect(messages).toContain("`js`");
        expect(messages).toContain("apart from case");
        expect(messages).toContain("`odd name`");
    });
});

describe("images", () => {
    it("copies an image a page shows from beside the manual, and nothing outside the folder", () => {
        const root = scratch();
        write(root, "texinfo/guide.texi", MANUAL("guide"));
        write(root, "texinfo/pics/a.png", "png");
        write(root, "secret.png", "no");
        const out = path.join(root, "out");
        const outside = ["..", ".."].join("/") + "/";
        const run = (_command: string, args: string[]) => {
            const dir = args[args.indexOf("-o") + 1];
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, "index.html"),
                `<img src="pics/a.png"><img src="${outside}secret.png"><img src="https://x.org/y.png"><img src="/abs.png">`,
            );
            return { status: 0, stdout: "", stderr: "" };
        };
        buildTexinfo({ config: config(root), out, base: "/d/", run: run as never });
        expect(fs.readFileSync(path.join(out, "texi/guide/pics/a.png"), "utf8")).toBe("png");
        expect(fs.existsSync(path.join(out, "texi/secret.png"))).toBe(false);
        expect(fs.existsSync(path.join(out, "secret.png"))).toBe(false);
    });
});

describe("reportSiteFindings", () => {
    it("prints file:line:column: severity: message, with column 1 where none is given", async () => {
        const { reportSiteFindings } = await import("../bin/content-commands.mjs");
        const lines: string[] = [];
        const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
        for (const spy of spies) spy.mockImplementation((text: string) => void lines.push(text));
        try {
            reportSiteFindings([
                { file: "texinfo/g.texi", line: 6, severity: "error", message: "bad" },
                { file: "texinfo/g.texi", line: 9, column: 4, severity: "warning", message: "odd" },
            ]);
        } finally {
            for (const spy of spies) spy.mockRestore();
        }
        expect(lines).toEqual([
            "texinfo/g.texi:6:1: error: bad",
            "texinfo/g.texi:9:4: warning: odd",
        ]);
    });
});
