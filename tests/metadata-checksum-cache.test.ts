/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fetchMetadata } from "../engine/foreign-catalog.mjs";

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
