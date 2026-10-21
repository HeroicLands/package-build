/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `site serve` serves the site it builds, writes again what a change touches,
 * and tells an open page to reload over server-sent events.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RELOAD_PATH, serveSite } from "../engine/site-serve.mjs";
import { cacheNavigation, fixtureConfig } from "./helpers/parity";

const FIXTURE = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "fixtures",
    "site-search",
);

let root: string;
let served: Awaited<ReturnType<typeof serveSite>>;
const events: string[] = [];
let reloads = 0;
let stream: AbortController;

/** Resolve once the server has sent `count` reloads in all. */
async function reloadCount(count: number) {
    for (let i = 0; i < 400 && reloads < count; i++) await new Promise((r) => setTimeout(r, 50));
    expect(reloads).toBeGreaterThanOrEqual(count);
}

beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-serve-")));
    fs.cpSync(FIXTURE, root, { recursive: true });
    fs.mkdirSync(path.join(root, "build", "cache", "metadata"), { recursive: true });
    const config = fixtureConfig(root);
    cacheNavigation(config);
    served = await serveSite({
        config,
        out: path.join(root, "build", "site", "searchdemo"),
        port: 0,
        search: false,
        year: 2026,
        report: (event) => events.push(event.kind),
    });
    stream = new AbortController();
    const res = await fetch(new URL(RELOAD_PATH, served.url), { signal: stream.signal });
    const reader = res.body!.getReader();
    (async () => {
        const decoder = new TextDecoder();
        for (;;) {
            const { value, done } = await reader
                .read()
                .catch(() => ({ value: undefined, done: true }));
            if (done) return;
            reloads += (decoder.decode(value).match(/event: reload/g) ?? []).length;
        }
    })();
}, 240_000);

afterAll(async () => {
    stream?.abort();
    await served?.close();
    fs.rmSync(root, { recursive: true, force: true });
});

describe("a served site", () => {
    it("serves its pages at their deployed addresses, each with the reload script", async () => {
        expect(served.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/searchdemo\/$/);
        const res = await fetch(new URL("place-portlow/", served.url));
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Portlow is a place of the small world.");
        expect(html).toContain(`new EventSource("${RELOAD_PATH}")`);
        expect(
            fs.readFileSync(
                path.join(root, "build/site/searchdemo/place-portlow/index.html"),
                "utf8",
            ),
        ).not.toContain("EventSource");
        expect(events).toContain("built");
    });

    it("answers an address it does not publish with its page-not-found page", async () => {
        const res = await fetch(new URL("nowhere/", served.url));
        expect(res.status).toBe(404);
        expect(await res.text()).toContain("Page not found");
    });

    it("writes a changed note's page again and reloads the page", async () => {
        const note = path.join(root, "assets/content/Places/portlow.md");
        fs.writeFileSync(note, fs.readFileSync(note, "utf8").replace("small world", "wide sea"));
        await reloadCount(1);
        await served.settled();
        expect(events).toContain("page");
        const html = await (await fetch(new URL("place-portlow/", served.url))).text();
        expect(html).toContain("Portlow is a place of the wide sea.");
    });

    it("builds the whole site again when a note's name changes", async () => {
        const before = reloads;
        const note = path.join(root, "assets/content/Places/highcairn.md");
        fs.writeFileSync(
            note,
            fs.readFileSync(note, "utf8").replace("full: Highcairn", "full: Highcairn Town"),
        );
        await reloadCount(before + 1);
        await served.settled();
        expect(events.filter((kind) => kind === "built").length).toBeGreaterThanOrEqual(2);
        const html = await (await fetch(new URL("being-wanderer/", served.url))).text();
        expect(html).toContain("Highcairn Town");
    });
});
