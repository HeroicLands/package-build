/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fetchMetadata } from "../engine/foreign-catalog.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";

const roots: string[] = [];
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const manifest = "https://example.test/releases/download/v1/system.json";
const index = "https://example.test/releases/download/v1/index.jsonl";
const rel = { id: "example", manifest, verified: "1" };
function setup(sidecar: string | null, content = "index") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "metadata-checksum-"));
    roots.push(root);
    vi.stubEnv("XDG_CACHE_HOME", path.join(root, "shared"));
    const fetcher = vi.fn(async (url: string) => {
        if (url === manifest) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url === `${index}.sha256`)
            return sidecar === null ? new Response("", { status: 404 }) : new Response(sidecar);
        if (url === index) return new Response(content);
        return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    return { root, fetcher, config: { paths: { metadataCache: path.join(root, "one") } } };
}
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("verifies shared hits and restores damaged materialized and shared files", async () => {
    const { root, fetcher, config } = setup(`${digest("index")}  index.jsonl\n`);
    const file = await fetchMetadata(config, rel);
    fs.writeFileSync(file, "damaged");
    await fetchMetadata({ paths: { metadataCache: path.join(root, "two") } }, rel);
    await fetchMetadata(config, rel);
    expect(fs.readFileSync(file, "utf8")).toBe("index");
    expect(fetcher.mock.calls.filter(([url]) => url === index)).toHaveLength(1);
    fs.writeFileSync(
        path.join(root, "shared", "heroiclands", "downloads", digest("index")),
        "damaged",
    );
    await fetchMetadata(config, rel);
    expect(fetcher.mock.calls.filter(([url]) => url === index)).toHaveLength(2);
});
it.each([null, "bad\n", `${digest("index")}  other.jsonl\n`])(
    "rejects missing or invalid checksum %s",
    async (sidecar) => {
        const { config, fetcher } = setup(sidecar);
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum/);
        expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
    },
);
it("rejects bytes that do not match the prior checksum", async () => {
    const { config } = setup(`${digest("other")}  index.jsonl\n`);
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/SHA-256/);
});
it("rejects a manifest for another version", async () => {
    const { config, fetcher } = setup(`${digest("index")}  index.jsonl\n`);
    await expect(fetchMetadata(config, { ...rel, verified: "2" })).rejects.toThrow(/moving target/);
    expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
});

it("selects the verified index with stale siblings and concurrent fetches", async () => {
    const body =
        JSON.stringify({
            package: "example",
            type: "lore",
            shortcode: "valid",
            name: { full: "Valid" },
            address: { canonical: "example-note-lore-valid", slug: "lore-valid" },
            anchors: [],
        }) + "\n";
    const { config } = setup(`${digest(body)}  index.jsonl\n`, body);
    const dir = path.join(config.paths.metadataCache, "example@1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.jsonl"), "stale");
    await Promise.all([fetchMetadata(config, rel), fetchMetadata(config, rel)]);
    const { cachedIndexFile, loadForeignIndexes } = await import("../engine/metadata-index.mjs");
    const file = cachedIndexFile(config, "example");
    expect(file).toBe(path.join(dir, `${digest(body)}.jsonl`));
    const resolved = loadForeignIndexes(
        { ...loadPackConfig(), ...config, relationships: { requires: [rel] } },
        [],
    );
    expect(resolved.index.has("example-note-lore-valid")).toBe(true);
    expect(resolved.stale).toEqual([]);
});

it("never exposes an authenticated redirect location through error causes", async () => {
    const { root, config } = setup(null);
    const token = "reflected-secret";
    const tokenFile = path.join(root, "token");
    fs.writeFileSync(tokenFile, token);
    vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
    const mirror = "https://mirror.test/system.json";
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (url === mirror)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            return new Response(null, { status: 302, headers: { location: `http://[${token}` } });
        }),
    );
    const error = await fetchMetadata(config, { ...rel, buildManifest: mirror }).catch((e) => e);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(token);
    expect(error.cause).toBeUndefined();
});

it("refuses a checksum redirect from HTTPS to a loopback HTTP mirror", async () => {
    const { config } = setup(null);
    const mirror = "https://mirror.test/system.json";
    const fetcher = vi.fn(async (url: string) => {
        if (url === mirror) return Response.json({ version: "1", flags: { metadataUrl: index } });
        return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/checksum" },
        });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchMetadata(config, { ...rel, buildManifest: mirror })).rejects.toThrow(
        /checksum/,
    );
    expect(fetcher.mock.calls.some(([url]) => url.startsWith("http://"))).toBe(false);
});

it("retries transient sidecar and index responses", async () => {
    const { config } = setup(`${digest("index")}  index.jsonl\n`);
    let checks = 0;
    let indexes = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (url === manifest)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url === `${index}.sha256`)
                return ++checks === 1 ?
                        new Response("", { status: 503 })
                    :   new Response(`${digest("index")}  index.jsonl\n`);
            return ++indexes === 1 ? new Response("", { status: 503 }) : new Response("index");
        }),
    );
    const result = await fetchMetadata(config, rel);
    expect(fs.readFileSync(result, "utf8")).toBe("index");
    expect([checks, indexes]).toEqual([2, 2]);
}, 15000);

it("bounds chunked JSONL downloads and removes temporary files", async () => {
    const { config, root } = setup(`${digest("index")}  index.jsonl\n`);
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (url === manifest)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url.endsWith(".sha256")) return new Response(`${digest("index")}  index.jsonl\n`);
            let count = 0;
            return new Response(
                new ReadableStream({
                    pull(controller) {
                        if (count++ < 257) controller.enqueue(new Uint8Array(1024 * 1024));
                        else controller.close();
                    },
                }),
            );
        }),
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/size/);
    expect(fs.readdirSync(path.join(root, "shared", "heroiclands", "downloads"))).toEqual([]);
});

it("times out stalled index bodies and cleans download files", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
        const { config, root } = setup(`${digest("index")}  index.jsonl\n`);
        let started = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options: RequestInit) => {
                if (url === manifest)
                    return Response.json({ version: "1", flags: { metadataUrl: index } });
                if (url.endsWith(".sha256"))
                    return new Response(`${digest("index")}  index.jsonl\n`);
                return new Response(
                    new ReadableStream({
                        start(controller) {
                            started++;
                            options.signal!.addEventListener("abort", () =>
                                controller.error(new Error("aborted")),
                            );
                        },
                    }),
                );
            }),
        );
        const result = fetchMetadata(config, rel).catch((error) => error);
        for (let attempt = 1; attempt <= 5; attempt++) {
            while (started < attempt) {
                await new Promise<void>((resolve) => setImmediate(resolve));
                await vi.advanceTimersByTimeAsync(1000);
            }
            await vi.advanceTimersByTimeAsync(60000);
        }
        expect(await result).toBeInstanceOf(Error);
        expect(fs.readdirSync(path.join(root, "shared", "heroiclands", "downloads"))).toEqual([]);
    } finally {
        vi.useRealTimers();
    }
});
