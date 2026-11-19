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
const manifest = "https://github.com/example/repo/releases/download/v1/system.json";
const index = "https://github.com/example/repo/releases/download/v1/index.jsonl";
const rel = { id: "example", manifest, verified: "1" };
const api = "https://api.github.com/repos/example/repo/releases/tags/v1";
const assets = "https://api.github.com/repos/example/repo/releases/123/assets?per_page=100&page=1";
function apiResponse(url: string, checksum: string | null) {
    if (url === api) return Response.json({ id: 123, tag_name: "v1" });
    if (url === assets)
        return Response.json(
            checksum === null ?
                []
            :   [{ id: 99, browser_download_url: index, digest: `sha256:${checksum}` }],
        );
}

function setup(sidecar: string | null, content = "index") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "metadata-checksum-"));
    roots.push(root);
    vi.stubEnv("XDG_CACHE_HOME", path.join(root, "shared"));
    const fetcher = vi.fn(async (url: string) => {
        if (url === manifest) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url === api || url === assets)
            return apiResponse(url, sidecar?.split("  ")[0] ?? null)!;
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
it.each([null, "bad\n"])("rejects missing or invalid checksum %s", async (sidecar) => {
    const { config, fetcher } = setup(sidecar);
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum/);
    expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
});
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

it("refuses a GitHub API redirect to a loopback HTTP endpoint", async () => {
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

it("retries transient GitHub metadata and index responses", async () => {
    const { config } = setup(`${digest("index")}  index.jsonl\n`);
    let checks = 0;
    let indexes = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (url === manifest)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url === api)
                return ++checks === 1 ?
                        new Response("", { status: 503 })
                    :   apiResponse(url, digest("index"))!;
            if (url === assets) return apiResponse(url, digest("index"))!;
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
            if (url === api || url === assets) return apiResponse(url, digest("index"))!;
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
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fakeSetTimeout = globalThis.setTimeout;
    const starts = Array.from({ length: 5 }, () => Promise.withResolvers<void>());
    const retries = Array.from({ length: 4 }, () => Promise.withResolvers<number>());
    let started = 0;
    let retryCount = 0;
    const timerSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        callback,
        delay,
        ...args
    ) => {
        const timer = fakeSetTimeout(callback, delay, ...args);
        if (
            typeof delay === "number" &&
            delay >= 1000 &&
            delay < 10000 &&
            retryCount < retries.length
        ) {
            retries[retryCount++].resolve(delay);
        }
        return timer;
    }) as typeof setTimeout);
    try {
        const { config, root } = setup(`${digest("index")}  index.jsonl\n`);
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, options: RequestInit) => {
                if (url === manifest)
                    return Response.json({ version: "1", flags: { metadataUrl: index } });
                if (url === api || url === assets) return apiResponse(url, digest("index"))!;
                return new Response(
                    new ReadableStream({
                        start(controller) {
                            const signal = options.signal!;
                            const abort = () => controller.error(new Error("aborted"));
                            if (signal.aborted) abort();
                            else signal.addEventListener("abort", abort, { once: true });
                            starts[started++].resolve();
                        },
                    }),
                );
            }),
        );
        const result = fetchMetadata(config, rel).then(
            () => ({ error: undefined }),
            (error) => ({ error }),
        );
        const waitFor = async <T>(milestone: Promise<T>, watchResult = true): Promise<T> => {
            let guard: ReturnType<typeof realSetTimeout>;
            const deadline = new Promise<never>((_, reject) => {
                guard = realSetTimeout(
                    () => reject(new Error("fixture milestone timed out")),
                    10000,
                );
            });
            try {
                return await Promise.race([
                    milestone,
                    ...(watchResult ?
                        [
                            result.then(() => {
                                throw new Error("request settled before the fixture milestone");
                            }),
                        ]
                    :   []),
                    deadline,
                ]);
            } finally {
                realClearTimeout(guard!);
            }
        };
        for (let attempt = 0; attempt < 5; attempt++) {
            await waitFor(starts[attempt].promise);
            await vi.advanceTimersByTimeAsync(60000);
            if (attempt < 4) {
                const delay = await waitFor(retries[attempt].promise);
                expect(delay).toBeGreaterThanOrEqual(1000 * 2 ** attempt);
                expect(delay).toBeLessThan(1000 * 2 ** attempt + 250);
                await vi.advanceTimersByTimeAsync(delay);
            }
        }
        const outcome = await waitFor(result, false);
        expect(outcome.error).toBeInstanceOf(Error);
        expect(outcome.error.message).toMatch(/download stream failed/);
        expect(started).toBe(5);
        expect(fs.readdirSync(path.join(root, "shared", "heroiclands", "downloads"))).toEqual([]);
    } finally {
        timerSpy.mockRestore();
        vi.useRealTimers();
    }
}, 110000);

it.each(["missing", "duplicate", "malformed", "wrong-url"])(
    "rejects %s GitHub asset metadata before downloading",
    async (kind) => {
        const { config } = setup(null);
        const good = { id: 99, browser_download_url: index, digest: `sha256:${digest("index")}` };
        const fetcher = vi.fn(async (url: string) => {
            if (url === manifest)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url === api) return Response.json({ id: 123, tag_name: "v1" });
            if (url === assets)
                return Response.json(
                    kind === "missing" ? []
                    : kind === "duplicate" ? [good, good]
                    : kind === "malformed" ? [{ ...good, digest: "sha256:bad" }]
                    : [{ ...good, browser_download_url: `${index}.other` }],
                );
            return new Response("unexpected", { status: 500 });
        });
        vi.stubGlobal("fetch", fetcher);
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
        expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
    },
);

it("selects the exact asset across pages and never sends mirror credentials to GitHub", async () => {
    const { root, config } = setup(null);
    const tokenFile = path.join(root, "token");
    fs.writeFileSync(tokenFile, "mirror-secret");
    vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
    const mirror = "https://mirror.test/releases/download/v1/system.json";
    const mirroredIndex = "https://mirror.test/releases/download/v1/index.jsonl";
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
        if (url === mirror) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url.startsWith("https://api.github.com/")) {
            expect(JSON.stringify(options.headers)).not.toContain("mirror-secret");
            if (url === api) return Response.json({ id: 123, tag_name: "v1" });
            if (url === assets)
                return Response.json(
                    Array.from({ length: 100 }, (_, i) => ({
                        id: i + 1,
                        browser_download_url: `${index}-${i}`,
                        digest: `sha256:${digest("index")}`,
                    })),
                );
            return Response.json([
                { id: 101, browser_download_url: index, digest: `sha256:${digest("index")}` },
            ]);
        }
        if (url === mirroredIndex) {
            expect(JSON.stringify(options.headers)).toContain("mirror-secret");
            return new Response("index");
        }
        return new Response("unexpected", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
        fs.readFileSync(await fetchMetadata(config, { ...rel, buildManifest: mirror }), "utf8"),
    ).toBe("index");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("&page=2"))).toBe(true);
});

it("rejects an index from another release before requesting GitHub metadata", async () => {
    const { config } = setup(null);
    const fetcher = vi.fn(async (url: string) => {
        if (url === manifest)
            return Response.json({
                version: "1",
                flags: { metadataUrl: index.replace("/v1/", "/v2/") },
            });
        return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
    expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["release-id", "release-tag", "asset-list", "asset-page-size", "uppercase-digest"])(
    "rejects invalid GitHub metadata: %s",
    async (kind) => {
        const { root, config } = setup(null);
        const fetcher = vi.fn(async (url: string) => {
            if (url === manifest)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url === api)
                return Response.json({
                    id: kind === "release-id" ? 0 : 123,
                    tag_name: kind === "release-tag" ? "v2" : "v1",
                });
            if (url === assets) {
                if (kind === "asset-list") return Response.json({ assets: [] });
                if (kind === "asset-page-size")
                    return Response.json(Array.from({ length: 101 }, () => ({})));
                return Response.json([
                    {
                        id: 99,
                        browser_download_url: index,
                        digest: `sha256:${digest("index").toUpperCase()}`,
                    },
                ]);
            }
            return new Response("unexpected", { status: 500 });
        });
        vi.stubGlobal("fetch", fetcher);
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
        expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
        expect(fs.existsSync(path.join(root, "one", "example@1", ".complete"))).toBe(false);
    },
);

it.each(["later duplicate", "page limit"])(
    "rejects %s without downloading an index",
    async (kind) => {
        const { root, config } = setup(null);
        const entry = { id: 99, browser_download_url: index, digest: `sha256:${digest("index")}` };
        let pages = 0;
        const fetcher = vi.fn(async (url: string) => {
            if (url === manifest)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url === api) return Response.json({ id: 123, tag_name: "v1" });
            if (url.startsWith("https://api.github.com/repos/example/repo/releases/123/assets?")) {
                pages++;
                if (kind === "later duplicate" && pages === 2) return Response.json([entry]);
                return Response.json([
                    entry,
                    ...Array.from({ length: 99 }, (_, i) => ({
                        ...entry,
                        id: i + 100,
                        browser_download_url: `${index}-${i}`,
                    })),
                ]);
            }
            return new Response("unexpected", { status: 500 });
        });
        vi.stubGlobal("fetch", fetcher);
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
        expect(pages).toBe(kind === "page limit" ? 100 : 2);
        expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
        expect(fs.existsSync(path.join(root, "one", "example@1", ".complete"))).toBe(false);
    },
);

it("rejects oversized GitHub metadata without downloading an index", async () => {
    const { root, config } = setup(null);
    const fetcher = vi.fn(async (url: string) => {
        if (url === manifest) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url === api) return new Response("x".repeat(2 * 1024 * 1024 + 1));
        return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
    expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
    expect(fs.existsSync(path.join(root, "one", "example@1", ".complete"))).toBe(false);
});

it("retries interrupted GitHub metadata and refuses after exhaustion", async () => {
    const { root, config } = setup(null);
    const fetcher = vi.fn(async (url: string) => {
        if (url === manifest) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url === api)
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(new Error("interrupted"));
                    },
                }),
            );
        return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers();
    try {
        const result = fetchMetadata(config, rel).then(
            () => null,
            (error) => error,
        );
        await vi.runAllTimersAsync();
        const error = await result;
        expect(error.message).toMatch(/checksum unavailable/);
        expect(fetcher.mock.calls.filter(([url]) => url === api)).toHaveLength(5);
        expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
        expect(fs.existsSync(path.join(root, "one", "example@1", ".complete"))).toBe(false);
    } finally {
        vi.useRealTimers();
    }
});

it("shares release metadata across relationships in one dependency fetch", async () => {
    const { root } = setup(null);
    const fetcher = vi.fn(async (url: string) => {
        if (url === manifest) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url === api || url === assets) return apiResponse(url, digest(""))!;
        if (url === index) return new Response("");
        return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    const { fetchAllMetadata } = await import("../engine/foreign-catalog.mjs");
    const config = {
        paths: { metadataCache: path.join(root, "one") },
        contentPackage: "consumer",
        relationships: {
            systems: [
                { id: "first", manifest, compatibility: { verified: "1" } },
                { id: "second", manifest, compatibility: { verified: "1" } },
            ],
        },
    };
    expect(await fetchAllMetadata(config)).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => url === api)).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url === assets)).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url === index)).toHaveLength(1);
    for (const id of ["first", "second"])
        expect(fs.existsSync(path.join(root, "one", `${id}@1`, ".complete"))).toBe(true);
});

it("times out stalled GitHub metadata and refuses after bounded retries", async () => {
    const { root, config } = setup(null);
    let attempts = 0;
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
        if (url === manifest) return Response.json({ version: "1", flags: { metadataUrl: index } });
        if (url === api) {
            attempts++;
            return new Response(
                new ReadableStream({
                    start(controller) {
                        const signal = options.signal!;
                        const abort = () => controller.error(new Error("aborted"));
                        if (signal.aborted) abort();
                        else signal.addEventListener("abort", abort, { once: true });
                    },
                }),
            );
        }
        return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers();
    try {
        const result = fetchMetadata(config, rel).then(
            () => null,
            (error) => error,
        );
        await vi.runAllTimersAsync();
        expect((await result).message).toMatch(/checksum unavailable/);
        expect(attempts).toBe(5);
        expect(fetcher.mock.calls.some(([url]) => url === index)).toBe(false);
        expect(fs.existsSync(path.join(root, "one", "example@1", ".complete"))).toBe(false);
    } finally {
        vi.useRealTimers();
    }
});

it("reports the GitHub HTTP status without exposing mirror credentials", async () => {
    const { root, config } = setup(null);
    const token = "mirror-secret";
    const tokenFile = path.join(root, "token");
    fs.writeFileSync(tokenFile, token);
    vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
    const mirror = "https://mirror.test/system.json";
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, options: RequestInit) => {
            if (url === mirror)
                return Response.json({ version: "1", flags: { metadataUrl: index } });
            if (url === api) {
                expect(JSON.stringify(options.headers)).not.toContain(token);
                return new Response("private response text", { status: 403 });
            }
            return new Response("unexpected", { status: 500 });
        }),
    );
    const error = await fetchMetadata(config, { ...rel, buildManifest: mirror }).catch((e) => e);
    expect(error.message).toContain("GitHub HTTP 403");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(token);
    expect(error.message).not.toContain("private response text");
});
