/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";

import { serveSite } from "../engine/site-serve.mjs";
import { cacheNavigation, fixtureConfig } from "./helpers/parity";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const control = vi.hoisted(() => ({
    wait: undefined as Promise<void> | undefined,
    searchFailure: undefined as string | undefined,
    writing: undefined as ((out: string) => void) | undefined,
    copyingTheme: undefined as ((out: string) => void) | undefined,
}));
vi.mock("../engine/site-render.mjs", async (original) => {
    const actual = await original<typeof import("../engine/site-render.mjs")>();
    return {
        ...actual,
        buildPackageSite: async (options: any) => {
            await control.wait;
            return actual.buildPackageSite(options);
        },
        writeSite: (options: any) => {
            control.writing?.(options.out);
            return actual.writeSite(options);
        },
        writeThemeFiles: (out: string) => {
            control.copyingTheme?.(out);
            return actual.writeThemeFiles(out);
        },
    };
});
vi.mock("../engine/site-root.mjs", async (original) => {
    const actual = await original<typeof import("../engine/site-root.mjs")>();
    return {
        ...actual,
        indexSite: async (options: any) => {
            if (control.searchFailure) throw new Error(control.searchFailure);
            return actual.indexSite(options);
        },
    };
});

const fixture = new URL("./fixtures/site-search/", import.meta.url);
let root: string;
let served: Awaited<ReturnType<typeof serveSite>> | undefined;
let release: (() => void) | undefined;

afterEach(async () => {
    release?.();
    await served?.close();
    control.wait = undefined;
    control.searchFailure = undefined;
    control.writing = undefined;
    control.copyingTheme = undefined;
    vi.restoreAllMocks();
    served = undefined;
    fs.rmSync(root, { recursive: true, force: true });
});

it("rejects a malformed URL and continues answering valid requests", async () => {
    const options = setup();
    served = await serveSite(options);
    await served.settled();
    const response = await fetch(new URL("/%ZZ", served.url)).catch(() => undefined);
    expect(response?.status).toBe(400);
    expect((await fetch(served.url)).status).toBe(200);
});

it.each(["page", "theme"])(
    "serves complete previous bytes while a %s update is being written",
    async (kind) => {
        const options = setup();
        const watch = fs.watch.bind(fs);
        let themeChanged: (() => void) | undefined;
        vi.spyOn(fs, "watch").mockImplementation(((dir: string, settings: any, callback: any) => {
            if (String(dir).endsWith("site-theme"))
                themeChanged = () => callback("change", "layouts/base.hbs");
            return watch(dir, settings, callback);
        }) as any);
        const events: string[] = [];
        served = await serveSite({ ...options, report: (event) => events.push(event.kind) });
        await served.settled();
        const relative = kind === "page" ? "place-portlow/index.html" : "css/style.css";
        const address = new URL(relative, served.url).href;
        const before = await (await fetch(address)).text();
        let during: string | undefined;
        const pause = (target: string) => {
            // Pause a write after its destination has been truncated. The real
            // HTTP worker must continue serving the prior complete file.
            fs.writeFileSync(path.join(target, relative), "A partial update.");
            const response = spawnSync(
                process.execPath,
                [
                    "--input-type=module",
                    "-e",
                    `console.log(await (await fetch(${JSON.stringify(address)})).text());`,
                ],
                { encoding: "utf8", timeout: SUBPROCESS_TEST_TIMEOUT },
            );
            expect(response.status, response.stderr).toBe(0);
            during = response.stdout.trim();
        };
        if (kind === "page") {
            control.writing = pause;
            const note = path.join(root, "assets/content/Places/portlow.md");
            fs.appendFileSync(note, "\nThe complete updated page.\n");
        } else {
            control.copyingTheme = pause;
            expect(themeChanged).toBeDefined();
            themeChanged!();
        }
        await expect.poll(() => events.includes(kind)).toBe(true);
        await served.settled();
        expect(
            during === before.trim(),
            "HTTP serves the complete previous file during a write",
        ).toBe(true);
        const after = await (await fetch(address)).text();
        expect(after).not.toContain("A partial update.");
        if (kind === "page") expect(after).toContain("The complete updated page.");
        else expect(after).toBe(before);
    },
    SUBPROCESS_TEST_TIMEOUT,
);

function setup() {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-startup-")));
    fs.cpSync(fixture, root, { recursive: true });
    const config = fixtureConfig(root);
    cacheNavigation(config);
    const out = path.join(root, "build/site/searchdemo");
    return { config, out, port: 0, search: false, year: 2026 };
}

it(
    "listens before a delayed first build and answers while the build thread is blocked",
    async () => {
        const options = setup();
        fs.mkdirSync(options.out, { recursive: true });
        fs.writeFileSync(path.join(options.out, "index.html"), "<body>The previous site.</body>");
        control.wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        const starting = serveSite(options);
        // Listening has a separate short responsiveness assertion; child process
        // kill deadlines use the shared budget for startup under contention.
        const first = await Promise.race([
            starting,
            new Promise<undefined>((resolve) => setTimeout(resolve, 1000)),
        ]);
        if (!first) {
            release!();
            served = await starting;
        }
        expect(
            first,
            "serveSite waits for listening, independently of the initial build",
        ).toBeDefined();
        served = first!;
        // spawnSync blocks the build thread. HTTP must still be answered by the
        // serving thread, including throughout synchronous index/render/write work.
        const response = spawnSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `const res = await fetch(${JSON.stringify(served.url)}); console.log(res.status, await res.text());`,
            ],
            { encoding: "utf8", timeout: SUBPROCESS_TEST_TIMEOUT },
        );
        expect(response.status, response.stderr).toBe(0);
        expect(response.stdout).toContain("200 <body>The previous site.");
        release!();
        await served.settled();
        expect(await (await fetch(served.url)).text()).toContain("The Search Demo");
        expect(fs.readdirSync(path.dirname(options.out))).toEqual(["searchdemo"]);
    },
    SUBPROCESS_TEST_TIMEOUT,
);

it("answers a cold start, keeps failed output out of service, and recovers on later edits", async () => {
    const options = setup();
    const note = path.join(root, "assets/content/Places/portlow.md");
    const source = fs.readFileSync(note, "utf8");
    fs.writeFileSync(note, source + "\n[[place-missing|Missing]].\n");
    control.wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    const events: string[] = [];
    const starting = serveSite({ ...options, report: (event) => events.push(event.kind) });
    served = await Promise.race([
        starting,
        new Promise<undefined>((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (!served) {
        release!();
        served = await starting;
        expect.fail("the cold server must listen before the first build finishes");
    }
    const pending = await fetch(served.url);
    expect(pending.status).toBe(503);
    expect(await pending.text()).toContain("terminal");
    release!();
    await served.settled();
    expect(events).toContain("failed");
    expect((await fetch(served.url)).status).toBe(503);
    expect(fs.existsSync(options.out)).toBe(false);

    fs.writeFileSync(note, source);
    await expect.poll(() => events.filter((event) => event === "built").length).toBe(1);
    await served.settled();
    const good = await (await fetch(new URL("place-portlow/", served.url))).text();
    expect(good).toContain("Portlow is a place of the small world.");
    const homepage = fs.readFileSync(path.join(options.out, "index.html"), "utf8");

    fs.writeFileSync(
        note,
        source.replace("full: Portlow", "full: Portlow Town") + "\n[[place-missing|Missing]].\n",
    );
    await expect.poll(() => events.filter((event) => event === "failed").length).toBe(2);
    await served.settled();
    expect(await (await fetch(new URL("place-portlow/", served.url))).text()).toBe(good);
    expect(fs.readFileSync(path.join(options.out, "index.html"), "utf8")).toBe(homepage);

    fs.writeFileSync(note, source.replace("full: Portlow", "full: Portlow Town"));
    await expect.poll(() => events.filter((event) => event === "built").length).toBe(2);
    await served.settled();
    expect(await (await fetch(new URL("place-portlow/", served.url))).text()).toContain(
        "Portlow Town",
    );
    expect(fs.readdirSync(path.dirname(options.out))).toEqual(["searchdemo"]);
}, 30000);

it("retains the previous site when search indexing fails and indexes the next successful build", async () => {
    const options = setup();
    fs.mkdirSync(path.join(options.out, "pagefind"), { recursive: true });
    fs.writeFileSync(path.join(options.out, "index.html"), "The previous site.");
    fs.writeFileSync(path.join(options.out, "pagefind/pagefind.js"), "previous search");
    control.searchFailure = "the test indexer failed";
    const events: any[] = [];
    served = await serveSite({ ...options, search: true, report: (event) => events.push(event) });
    await served.settled();
    expect(events).toContainEqual(
        expect.objectContaining({ kind: "error", error: expect.any(Error) }),
    );
    expect(await (await fetch(served.url)).text()).toContain("The previous site.");
    expect(await (await fetch(new URL("pagefind/pagefind.js", served.url))).text()).toBe(
        "previous search",
    );
    control.searchFailure = undefined;
    const note = path.join(root, "assets/content/Places/portlow.md");
    fs.appendFileSync(note, "\nThe next successful build.\n");
    await expect.poll(() => events.filter((event) => event.kind === "built").length).toBe(1);
    await served.settled();
    expect(await (await fetch(served.url)).text()).toContain("The Search Demo");
    expect(fs.readFileSync(path.join(options.out, "pagefind/pagefind.js"), "utf8")).not.toBe(
        "previous search",
    );
});

it("restores the previous output when installing a staged tree fails", async () => {
    const { out } = setup();
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "index.html"), "The previous site.");
    const worker = new Worker(new URL("../engine/site-serve-http.mjs", import.meta.url), {
        workerData: {
            root: path.dirname(out),
            out,
            host: "127.0.0.1",
            port: 0,
            reloadPath: "/reload",
        },
    });
    try {
        const listening: any = await new Promise((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
        });
        const installed = new Promise<any>((resolve) => worker.once("message", resolve));
        worker.postMessage({
            kind: "install",
            staged: path.join(root, "absent"),
            previous: path.join(root, "previous"),
        });
        expect((await installed).error).toBeInstanceOf(Error);
        expect(
            await (await fetch(`http://127.0.0.1:${listening.port}/searchdemo/`)).text(),
        ).toContain("The previous site.");
        expect(fs.existsSync(path.join(root, "previous"))).toBe(false);
    } finally {
        await worker.terminate();
    }
});

it(
    "starts when the API caller runs Node with --input-type",
    () => {
        setup();
        const serveModule = new URL("../engine/site-serve.mjs", import.meta.url).href;
        const configModule = new URL("../engine/pack-config.mjs", import.meta.url).href;
        const result = spawnSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `
        import { serveSite } from ${JSON.stringify(serveModule)};
        import { loadPackConfig } from ${JSON.stringify(configModule)};
        const config = loadPackConfig();
        const served = await serveSite({ config, out: ${JSON.stringify(path.join(root, "build/site/searchdemo"))}, port: 0, search: false });
        console.log(served.url);
        await served.settled();
        await served.close();
    `,
            ],
            {
                cwd: root,
                encoding: "utf8",
                timeout: SUBPROCESS_TEST_TIMEOUT,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                },
            },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toMatch(/http:\/\/127\.0\.0\.1:\d+\/searchdemo\//);
    },
    SUBPROCESS_TEST_TIMEOUT,
);

it(
    "closes HTTP when its content watcher cannot start",
    () => {
        setup();
        fs.renameSync(path.join(root, "assets/content"), path.join(root, "assets/moved-content"));
        const serveModule = new URL("../engine/site-serve.mjs", import.meta.url).href;
        const configModule = new URL("../engine/pack-config.mjs", import.meta.url).href;
        const result = spawnSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `
        import { serveSite } from ${JSON.stringify(serveModule)};
        import { loadPackConfig } from ${JSON.stringify(configModule)};
        try {
            await serveSite({ config: loadPackConfig(), out: ${JSON.stringify(path.join(root, "build/site/searchdemo"))}, port: 0, search: false });
            process.exitCode = 1;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            console.log('watcher failure closes the server');
        }
    `,
            ],
            {
                cwd: root,
                encoding: "utf8",
                timeout: SUBPROCESS_TEST_TIMEOUT,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                },
            },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("watcher failure closes the server");
    },
    SUBPROCESS_TEST_TIMEOUT,
);
