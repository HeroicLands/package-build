/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassicLevel } from "classic-level";
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { zipSync } from "fflate";
import {
    cachedSchemaPath,
    fetchCatalog,
    fetchMetadata,
    resolvePackPath,
} from "../engine/foreign-catalog.mjs";

const roots: string[] = [];
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const declaredManifest = "https://github.com/example/repo/releases/download/v1/system.json";
const declaredIndex = "https://github.com/example/repo/releases/download/v1/index.jsonl";
const rel = { id: "example", manifest: declaredManifest, verified: "1" };

const GITEA = "https://git.example.org";
const giteaManifest = `${GITEA}/example/repo/releases/download/v1/system.json`;
const giteaIndex = `${GITEA}/example/repo/releases/download/v1/index.jsonl`;
const giteaApi = `${GITEA}/api/v1/repos/example/repo/releases/tags/v1`;

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function setup(handler: Handler, env: Record<string, string> = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-fetch-"));
    roots.push(root);
    vi.stubEnv("XDG_CACHE_HOME", path.join(root, "shared"));
    vi.stubEnv("PACKAGE_BUILD_GITHUB_API_TOKEN", "");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        return handler(url, init) ?? new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    return { root, fetcher, config: { paths: { metadataCache: path.join(root, "cache") } } };
}
const calls = (fetcher: ReturnType<typeof vi.fn>, prefix: string) =>
    fetcher.mock.calls.filter(([url]) => String(url).startsWith(prefix));
const giteaServer =
    (assets: unknown[] | null, extra: Handler = () => undefined): Handler =>
    (url, init) => {
        if (url === `${GITEA}/api/v1/version`) return Response.json({ version: "1.24.0" });
        if (url === giteaManifest)
            return Response.json({ version: "1", flags: { metadataUrl: declaredIndex } });
        if (url === giteaApi && assets)
            return Response.json({ id: 7, tag_name: "v1", assets }, { headers: { etag: '"e1"' } });
        if (url === giteaIndex) return new Response("index");
        return extra(url, init);
    };
const asset = (extra: object = {}) => ({
    id: 1,
    name: "index.jsonl",
    browser_download_url: giteaIndex,
    ...extra,
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("reads a dependency from a Gitea forge, using the asset digest", async () => {
    const { config, fetcher } = setup(
        giteaServer([asset({ digest: `sha256:${digest("index")}` })]),
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    const file = await fetchMetadata(config, rel);
    expect(fs.readFileSync(file, "utf8")).toBe("index");
    expect(calls(fetcher, "https://github.com")).toHaveLength(0);
    expect(calls(fetcher, "https://api.github.com")).toHaveLength(0);
    expect(calls(fetcher, giteaApi)).toHaveLength(1);
});

it("takes the checksum from the single download when the Gitea release publishes no digest", async () => {
    const { config, fetcher } = setup(giteaServer([asset()]), { PACKAGE_BUILD_FORGE_URL: GITEA });
    const file = await fetchMetadata(config, rel);
    expect(path.basename(file)).toBe(`${digest("index")}.jsonl`);
    expect(calls(fetcher, giteaIndex)).toHaveLength(1);
});

it("sends the Gitea forge token to the forge's own origin and nowhere else", async () => {
    const { config, fetcher } = setup(giteaServer([asset()]), {
        PACKAGE_BUILD_FORGE_URL: GITEA,
        PACKAGE_BUILD_FORGE_TOKEN: "secret-forge",
        PACKAGE_BUILD_GITHUB_API_TOKEN: "secret-github",
    });
    await fetchMetadata(config, rel);
    const headers = (url: string) =>
        calls(fetcher, url).map(
            ([, init]) => ((init ?? {}) as RequestInit).headers as Record<string, string>,
        );
    expect(headers(giteaApi)[0].Authorization).toBe("token secret-forge");
    expect(headers(giteaManifest)[0].Authorization).toBe("token secret-forge");
    expect(headers(giteaIndex)[0].Authorization).toBe("token secret-forge");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("secret-github");
    for (const [url] of fetcher.mock.calls)
        expect(String(url)).toMatch(/^https:\/\/git\.example\.org\//);
});

it("refuses a redirect off the forge's origin without forwarding the token", async () => {
    const server = giteaServer([asset()]);
    const { config, fetcher } = setup(
        (url, init) =>
            url === giteaIndex ?
                new Response(null, {
                    status: 302,
                    headers: { location: "https://elsewhere.example.net/index.jsonl" },
                })
            :   server(url, init),
        { PACKAGE_BUILD_FORGE_URL: GITEA, PACKAGE_BUILD_FORGE_TOKEN: "secret-forge" },
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow();
    expect(calls(fetcher, "https://elsewhere.example.net")).toHaveLength(0);
});

it("refuses an empty Gitea forge token without a request to the API", async () => {
    const { config, fetcher } = setup(giteaServer([asset()]), {
        PACKAGE_BUILD_FORGE_URL: GITEA,
        PACKAGE_BUILD_FORGE_TOKEN: "",
    });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(
        /PACKAGE_BUILD_FORGE_TOKEN must contain one non-empty token/,
    );
    expect(calls(fetcher, giteaApi)).toHaveLength(0);
});

it.each([
    [404, /git\.example\.org checksum unavailable \(git\.example\.org HTTP 404\)/],
    [401, /git\.example\.org rejected the credential.*PACKAGE_BUILD_FORGE_TOKEN/],
    [429, /git\.example\.org API rate limit.*PACKAGE_BUILD_FORGE_TOKEN/],
])("reports HTTP %s from the Gitea forge by name", async (status, message) => {
    const { config } = setup(
        giteaServer(null, (url) => (url === giteaApi ? new Response(null, { status }) : undefined)),
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(message);
});

it("reports a Gitea 403 with an exhausted quota as a rate limit", async () => {
    const { config } = setup(
        giteaServer(null, (url) =>
            url === giteaApi ?
                new Response(null, { status: 403, headers: { "retry-after": "30" } })
            :   undefined,
        ),
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(
        /git\.example\.org API rate limit.*PACKAGE_BUILD_FORGE_TOKEN/,
    );
});

it("names the host when the Gitea release is missing", async () => {
    const { config } = setup(giteaServer(null), { PACKAGE_BUILD_FORGE_URL: GITEA });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/git\.example\.org HTTP 404/);
});

it("refuses an unknown host that does not answer the Gitea version API, sending no token", async () => {
    const { config, fetcher } = setup(() => undefined, {
        PACKAGE_BUILD_FORGE_URL: "https://unknown.example.net",
        PACKAGE_BUILD_FORGE_TOKEN: "secret-forge",
    });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(
        /PACKAGE_BUILD_FORGE_URL names https:\/\/unknown\.example\.net/,
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        "https://unknown.example.net/api/v1/version",
    ]);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("secret-forge");
});

it("refuses a host whose version answer is not Gitea's", async () => {
    const { config } = setup(
        (url) => (url.endsWith("/api/v1/version") ? new Response("<html></html>") : undefined),
        { PACKAGE_BUILD_FORGE_URL: "https://html.example.net" },
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/PACKAGE_BUILD_FORGE_URL/);
});

it("refuses www.github.com without a request", async () => {
    const { config, fetcher } = setup(() => undefined, {
        PACKAGE_BUILD_FORGE_URL: "https://www.github.com",
    });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(
        /^PACKAGE_BUILD_FORGE_URL .*GitHub-looking/,
    );
    expect(fetcher).not.toHaveBeenCalled();
});

it("treats an empty variable as GitHub", async () => {
    const { config, fetcher } = setup(() => undefined, { PACKAGE_BUILD_FORGE_URL: "" });
    await expect(fetchMetadata(config, rel)).rejects.toThrow();
    expect(fetcher.mock.calls[0][0]).toBe(declaredManifest);
});

it("refuses a Gitea release that lists no assets array", async () => {
    const { config } = setup(
        (url) =>
            url === giteaApi ? Response.json({ id: 7, tag_name: "v1" })
            : url === giteaManifest ?
                Response.json({ version: "1", flags: { metadataUrl: declaredIndex } })
            : url === `${GITEA}/api/v1/version` ? Response.json({ version: "1" })
            : undefined,
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
});

it("refuses a release whose asset is not listed", async () => {
    const { config } = setup(giteaServer([asset({ browser_download_url: `${giteaIndex}.x` })]), {
        PACKAGE_BUILD_FORGE_URL: GITEA,
    });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
});

it("refuses a malformed forge URL in the variable by naming it", async () => {
    const { config, fetcher } = setup(() => undefined, {
        PACKAGE_BUILD_FORGE_URL: "http://git.example.org",
    });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/^PACKAGE_BUILD_FORGE_URL /);
    expect(fetcher).not.toHaveBeenCalled();
});

it("revalidates the release lookup with its stored entity tag", async () => {
    let conditional: string | null = null;
    const server = giteaServer([asset({ digest: `sha256:${digest("index")}` })], () => undefined);
    const { config, fetcher } = setup(
        (url, init) => {
            if (url === giteaApi && (init?.headers as Record<string, string>)["If-None-Match"]) {
                conditional = (init?.headers as Record<string, string>)["If-None-Match"];
                return new Response(null, { status: 304 });
            }
            return server(url, init);
        },
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    const file = await fetchMetadata(config, rel);
    fs.rmSync(path.join(path.dirname(file), ".complete"));
    expect(fs.readFileSync(await fetchMetadata(config, rel), "utf8")).toBe("index");
    expect(conditional).toBe('"e1"');
    expect(calls(fetcher, giteaApi)).toHaveLength(2);
});

it("makes no request when the stored index for the pinned version is current", async () => {
    const { config, fetcher } = setup(
        giteaServer([asset({ digest: `sha256:${digest("index")}` })]),
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    await fetchMetadata(config, rel);
    fetcher.mockClear();
    await fetchMetadata(config, rel);
    expect(fetcher).not.toHaveBeenCalled();
});

it("does not reuse a stored index across forges", async () => {
    const { config, fetcher } = setup(
        giteaServer([asset({ digest: `sha256:${digest("index")}` })]),
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    await fetchMetadata(config, rel);
    vi.stubEnv("PACKAGE_BUILD_FORGE_URL", "https://other.example.org");
    fetcher.mockClear();
    await expect(fetchMetadata(config, rel)).rejects.toThrow();
    expect(calls(fetcher, "https://other.example.org").length).toBeGreaterThan(0);
});

it("reads GitHub when the variable names it", async () => {
    const api = "https://api.github.com/repos/example/repo/releases/tags/v1";
    const { config, fetcher } = setup(
        (url) => {
            if (url === declaredManifest)
                return Response.json({ version: "1", flags: { metadataUrl: declaredIndex } });
            if (url === api)
                return Response.json({
                    id: 3,
                    tag_name: "v1",
                    assets: [
                        {
                            id: 2,
                            browser_download_url: declaredIndex,
                            digest: `sha256:${digest("index")}`,
                        },
                    ],
                });
            if (url === declaredIndex) return new Response("index");
            return undefined;
        },
        { PACKAGE_BUILD_FORGE_URL: "https://github.com" },
    );
    await fetchMetadata(config, rel);
    expect(calls(fetcher, api)).toHaveLength(1);
    expect(calls(fetcher, "https://api.github.com")).toHaveLength(1);
});

it("names GitHub and its token variable when GitHub rate-limits", async () => {
    const { config } = setup((url) =>
        url === declaredManifest ?
            Response.json({ version: "1", flags: { metadataUrl: declaredIndex } })
        : url.startsWith("https://api.github.com") ? new Response(null, { status: 429 })
        : undefined,
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(
        /GitHub API rate limit.*PACKAGE_BUILD_GITHUB_API_TOKEN/,
    );
});

const githubApi = "https://api.github.com/repos/example/repo/releases/tags/v1";
const githubServer =
    (release: Response | undefined, extra: Handler = () => undefined): Handler =>
    (url, init) => {
        if (url === declaredManifest)
            return Response.json({ version: "1", flags: { metadataUrl: declaredIndex } });
        if (url === githubApi) return release;
        if (url === declaredIndex) return new Response("index");
        return extra(url, init);
    };

it("reports a missing GitHub release", async () => {
    const { config } = setup(githubServer(new Response(null, { status: 404 })));
    await expect(fetchMetadata(config, rel)).rejects.toThrow(
        /checksum unavailable \(GitHub HTTP 404\)/,
    );
});

it("refuses a GitHub asset without a digest", async () => {
    const { config, fetcher } = setup(
        githubServer(
            Response.json({
                id: 3,
                tag_name: "v1",
                assets: [{ id: 2, browser_download_url: declaredIndex }],
            }),
        ),
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/checksum unavailable/);
    expect(calls(fetcher, declaredIndex)).toHaveLength(0);
});

it("ignores a stored manifest whose checksum no longer matches its receipt", async () => {
    const { config, fetcher } = setup(
        githubServer(
            Response.json({
                id: 3,
                tag_name: "v1",
                assets: [
                    {
                        id: 2,
                        browser_download_url: declaredIndex,
                        digest: `sha256:${digest("index")}`,
                    },
                ],
            }),
        ),
    );
    const file = await fetchMetadata(config, rel);
    fs.writeFileSync(path.join(path.dirname(file), "manifest.json"), '{"version":"1"}');
    fetcher.mockClear();
    await fetchMetadata(config, rel).catch(() => {});
    expect(calls(fetcher, declaredManifest)).toHaveLength(1);
});

it.each(["forge", "manifestSha256"])("ignores a receipt whose %s is wrong", async (field) => {
    const { config, fetcher } = setup(
        giteaServer([asset({ digest: `sha256:${digest("index")}` })]),
        { PACKAGE_BUILD_FORGE_URL: GITEA },
    );
    const file = await fetchMetadata(config, rel);
    const stamp = path.join(path.dirname(file), ".complete");
    const receipt = JSON.parse(fs.readFileSync(stamp, "utf8"));
    if (field === "forge") receipt.source.forge = "https://other.example.org";
    else receipt.manifestSha256 = digest("other");
    fs.writeFileSync(stamp, JSON.stringify(receipt));
    fetcher.mockClear();
    await fetchMetadata(config, rel);
    expect(calls(fetcher, giteaManifest)).toHaveLength(1);
});

const authOf = (init?: RequestInit) =>
    ((init ?? {}) as { headers?: Record<string, string> }).headers?.Authorization;
const forgeEnv = { PACKAGE_BUILD_FORGE_URL: GITEA, PACKAGE_BUILD_FORGE_TOKEN: "secret-forge" };

it("sends no Authorization header to a declared manifest on another host", async () => {
    const { config, fetcher } = setup(giteaServer([asset()]), forgeEnv);
    await expect(
        fetchMetadata(config, {
            id: "example",
            manifest: "https://third.example/example/repo/releases/download/v1/system.json",
            verified: "1",
        }),
    ).rejects.toThrow();
    const off = calls(fetcher, "https://third.example");
    expect(off.length).toBeGreaterThan(0);
    for (const [, init] of off) expect(authOf(init)).toBeUndefined();
});

it("sends no Authorization header to an archive on another host", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-archive-"));
    roots.push(root);
    const server = giteaServer([asset()]);
    const { fetcher } = setup(
        (url, init) =>
            url === giteaManifest ?
                Response.json({ version: "1", download: "https://evil.example/pack.zip" })
            :   server(url, init),
        forgeEnv,
    );
    await expect(
        fetchCatalog({ paths: { foreignCache: path.join(root, "catalog") } }, rel),
    ).rejects.toThrow();
    const off = calls(fetcher, "https://evil.example");
    expect(off.length).toBeGreaterThan(0);
    for (const [, init] of off) expect(authOf(init)).toBeUndefined();
    expect(authOf(calls(fetcher, giteaManifest)[0][1])).toBe("token secret-forge");
});

it("sends no Authorization header past a redirect of the manifest off the forge", async () => {
    const server = giteaServer([asset()]);
    const { config, fetcher } = setup(
        (url, init) =>
            url === giteaManifest ?
                new Response(null, {
                    status: 302,
                    headers: { location: "https://elsewhere.example.net/system.json" },
                })
            :   server(url, init),
        forgeEnv,
    );
    await expect(fetchMetadata(config, rel)).rejects.toThrow();
    expect(calls(fetcher, "https://elsewhere.example.net")).toHaveLength(0);
});

it("keeps the pinned checksum when the index of a digest-less release is deleted or swapped", async () => {
    let served = "index";
    const server = giteaServer([asset()]);
    const { config } = setup(
        (url, init) => (url === giteaIndex ? new Response(served) : server(url, init)),
        forgeEnv,
    );
    const file = await fetchMetadata(config, rel);
    const dir = path.dirname(file);
    fs.rmSync(file);
    served = "swapped";
    fs.rmSync(path.join(path.dirname(file), "..", "..", "shared"), {
        recursive: true,
        force: true,
    });
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/does not match the checksum pinned/);
    fs.writeFileSync(file, "damaged");
    await expect(fetchMetadata(config, rel)).rejects.toThrow(/does not match the checksum pinned/);
    served = "index";
    expect(fs.readFileSync(await fetchMetadata(config, rel), "utf8")).toBe("index");
    expect(fs.existsSync(dir)).toBe(true);
});

describe("a digest-less Gitea index stays pinned to the index it was first downloaded as", () => {
    const other = `${GITEA}/example/repo/releases/download/v1/index2.jsonl`;
    const setupRepublish = () => {
        let advertised = declaredIndex;
        const listing = [
            asset(),
            asset({ id: 2, name: "index2.jsonl", browser_download_url: other }),
        ];
        const server = giteaServer(listing);
        return {
            republish: () => (advertised = other.replace(GITEA, "https://github.com")),
            ...setup(
                (url, init) =>
                    url === giteaManifest ?
                        Response.json({ version: "1", flags: { metadataUrl: advertised } })
                    : url === other ? new Response("index-EVIL")
                    : server(url, init),
                forgeEnv,
            ),
        };
    };
    it("refuses a republished manifest naming another release file after the index is deleted", async () => {
        const { config, republish, root } = setupRepublish();
        const file = await fetchMetadata(config, rel);
        fs.rmSync(file);
        fs.rmSync(path.join(root, "shared"), { recursive: true, force: true });
        republish();
        await expect(fetchMetadata(config, rel)).rejects.toThrow(
            /release changed after its content index was pinned/,
        );
    });
    it("refuses it for a pinned manifest without verified, with the index intact", async () => {
        const { config, republish } = setupRepublish();
        const unverified = { id: "example", manifest: declaredManifest };
        const file = await fetchMetadata(config, unverified);
        republish();
        await expect(fetchMetadata(config, unverified)).rejects.toThrow(
            /release changed after its content index was pinned/,
        );
        expect(fs.readFileSync(file, "utf8")).toBe("index");
    });
    it("keeps the pin when the completion receipt is a symlink", async () => {
        const { config, root } = setupRepublish();
        const file = await fetchMetadata(config, rel);
        const stamp = path.join(path.dirname(file), ".complete");
        fs.renameSync(stamp, path.join(root, "outside"));
        fs.symlinkSync(path.join(root, "outside"), stamp);
        fs.rmSync(file);
        fs.rmSync(path.join(root, "shared"), { recursive: true, force: true });
        expect(fs.readFileSync(await fetchMetadata(config, rel), "utf8")).toBe("index");
    });
});

describe("the pin of a digest-less Gitea index", () => {
    /** A Gitea forge on `host` whose release, index bytes and digest the test changes. */
    const world = (host: string) => {
        const state = {
            version: "1",
            index: "index",
            indexName: "index.jsonl",
            digest: undefined as string | undefined,
        };
        const base = `https://${host}`;
        const handler: Handler = (url) => {
            if (url === `${base}/api/v1/version`) return Response.json({ version: "1.24.0" });
            if (url === `${base}/example/repo/releases/download/v1/system.json`)
                return Response.json({
                    version: state.version,
                    flags: {
                        metadataUrl: `https://github.com/example/repo/releases/download/v1/${state.indexName}`,
                    },
                });
            if (url === `${base}/api/v1/repos/example/repo/releases/tags/v1`)
                return Response.json({
                    id: 7,
                    tag_name: "v1",
                    assets: [
                        {
                            id: 1,
                            browser_download_url: `${base}/example/repo/releases/download/v1/${state.indexName}`,
                            ...(state.digest ? { digest: `sha256:${state.digest}` } : {}),
                        },
                    ],
                });
            if (url === `${base}/example/repo/releases/download/v1/${state.indexName}`)
                return new Response(state.index);
        };
        return { state, handler, base };
    };
    const fresh = (host = "pin.example.org") => {
        const w = world(host);
        const env = { PACKAGE_BUILD_FORGE_URL: w.base, PACKAGE_BUILD_FORGE_TOKEN: "secret-forge" };
        const harness = setup(w.handler, env);
        const unverified = { id: "example", manifest: declaredManifest };
        const pinFileOf = () => {
            const dir = path.join(harness.root, "cache", ".pins");
            return path.join(dir, fs.readdirSync(dir)[0]);
        };
        const wipe = (file: string) => {
            fs.rmSync(file, { force: true });
            fs.rmSync(path.join(harness.root, "shared"), { recursive: true, force: true });
        };
        return { ...w, ...harness, env, unverified, pinFileOf, wipe };
    };
    const refused = /does not match the checksum pinned|release changed after|pin receipt/;

    it("records the first download and accepts it again with no request", async () => {
        const t = fresh("pin-first.example.org");
        const file = await fetchMetadata(t.config, rel);
        expect(JSON.parse(fs.readFileSync(t.pinFileOf(), "utf8"))).toMatchObject({
            version: "1",
            sha256: digest("index"),
        });
        t.fetcher.mockClear();
        expect(await fetchMetadata(t.config, rel)).toBe(file);
        expect(t.fetcher).not.toHaveBeenCalled();
    });

    it("accepts a legitimately republished release once the pin receipt is deleted", async () => {
        const t = fresh("pin-repin.example.org");
        const file = await fetchMetadata(t.config, rel);
        t.wipe(file);
        t.state.index = "index-v2";
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(
            /delete the pin receipt .*\.json/,
        );
        fs.rmSync(t.pinFileOf());
        const again = await fetchMetadata(t.config, rel);
        expect(fs.readFileSync(again, "utf8")).toBe("index-v2");
    });

    it("refuses a changed reported version with another index when no verified is declared (C1)", async () => {
        const t = fresh("pin-c1.example.org");
        const file = await fetchMetadata(t.config, t.unverified);
        t.wipe(file);
        t.state.version = "1.0.1";
        t.state.indexName = "index2.jsonl";
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, t.unverified)).rejects.toThrow(
            /release changed after.*it now reports version 1\.0\.1, not 1/,
        );
    });

    it("refuses a changed reported version with swapped bytes at the same index URL (C2)", async () => {
        const t = fresh("pin-c2.example.org");
        const file = await fetchMetadata(t.config, t.unverified);
        t.wipe(file);
        t.state.version = "1.0.1";
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, t.unverified)).rejects.toThrow(
            /release changed after/,
        );
    });

    it.each([
        ["garbage", (f: string) => fs.writeFileSync(f, "{not json")],
        [
            "oversized",
            (f: string) => fs.writeFileSync(f, JSON.stringify({ pad: "x".repeat(17_000) })),
        ],
        [
            "a symlink",
            (f: string) => {
                fs.renameSync(f, `${f}.real`);
                fs.symlinkSync(`${f}.real`, f);
            },
        ],
        ["empty", (f: string) => fs.writeFileSync(f, "")],
        [
            "for another release",
            (f: string) => {
                const pin = JSON.parse(fs.readFileSync(f, "utf8"));
                pin.identity.id = "other";
                fs.writeFileSync(f, JSON.stringify(pin));
            },
        ],
    ])(
        "refuses, without downloading the index, when the pin receipt is %s",
        async (name, damage) => {
            const t = fresh(`pin-d-${String(name).replace(/\W/g, "")}.example.org`);
            const file = await fetchMetadata(t.config, rel);
            t.wipe(file);
            damage(t.pinFileOf());
            t.state.index = "index-EVIL";
            t.fetcher.mockClear();
            await expect(fetchMetadata(t.config, rel)).rejects.toThrow(
                /^example: the pin receipt \S+\.json is unusable \(.*\)\. Nothing was cached or recorded\. .*delete that receipt and fetch again\.$/,
            );
            expect(
                calls(t.fetcher, `${t.base}/example/repo/releases/download/v1/index.jsonl`),
            ).toHaveLength(0);
        },
    );

    it.each([
        ["garbage", (f: string) => fs.writeFileSync(f, "{not json")],
        ["empty", (f: string) => fs.writeFileSync(f, "")],
        [
            "a symlink",
            (f: string) => {
                fs.renameSync(f, `${f}.real`);
                fs.symlinkSync(`${f}.real`, f);
            },
        ],
    ])("holds swapped bytes to the pin when the completion receipt is %s", async (name, damage) => {
        const t = fresh(`pin-d2-${String(name).replace(/\W/g, "")}.example.org`);
        const file = await fetchMetadata(t.config, rel);
        damage(path.join(path.dirname(file), ".complete"));
        t.wipe(file);
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(refused);
        t.state.index = "index";
        expect(fs.readFileSync(await fetchMetadata(t.config, rel), "utf8")).toBe("index");
    });

    it("keeps the pin through a GitHub run and holds the forge to it (E2, E5)", async () => {
        const t = fresh("pin-e2.example.org");
        const file = await fetchMetadata(t.config, rel);
        const githubApi = "https://api.github.com/repos/example/repo/releases/tags/v1";
        vi.stubEnv("PACKAGE_BUILD_FORGE_URL", "");
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) =>
                url === declaredManifest ?
                    Response.json({ version: "1", flags: { metadataUrl: declaredIndex } })
                : url === githubApi ?
                    Response.json({
                        id: 3,
                        tag_name: "v1",
                        assets: [
                            {
                                id: 2,
                                browser_download_url: declaredIndex,
                                digest: `sha256:${digest("index-GH")}`,
                            },
                        ],
                    })
                : url === declaredIndex ? new Response("index-GH")
                : new Response("", { status: 404 }),
            ),
        );
        expect(fs.readFileSync(await fetchMetadata(t.config, rel), "utf8")).toBe("index-GH");
        vi.stubEnv("PACKAGE_BUILD_FORGE_URL", t.base);
        vi.stubGlobal("fetch", t.fetcher);
        t.wipe(file);
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(refused);
    });

    it("keeps one pin per forge, so another forge never erases it (E3)", async () => {
        const t = fresh("pin-e3.example.org");
        const file = await fetchMetadata(t.config, rel);
        const other = world("pin-e3-other.example.org");
        vi.stubEnv("PACKAGE_BUILD_FORGE_URL", other.base);
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => other.handler(url, init)),
        );
        other.state.index = "other-forge-index";
        expect(fs.readFileSync(await fetchMetadata(t.config, rel), "utf8")).toBe(
            "other-forge-index",
        );
        expect(fs.readdirSync(path.join(t.root, "cache", ".pins"))).toHaveLength(2);
        vi.stubEnv("PACKAGE_BUILD_FORGE_URL", t.base);
        vi.stubGlobal("fetch", t.fetcher);
        t.wipe(file);
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(refused);
    });

    it("keeps one pin per mirror, so adding a mirror never erases it (F1)", async () => {
        const t = fresh("pin-f1.example.org");
        const file = await fetchMetadata(t.config, rel);
        const mirror = "https://mirror.example.net/example/repo/releases/download/v1/system.json";
        const mirrored = { ...rel, buildManifest: mirror };
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) =>
                url === mirror ?
                    Response.json({ version: "1", flags: { metadataUrl: declaredIndex } })
                : (
                    url ===
                    "https://mirror.example.net/example/repo/releases/download/v1/index.jsonl"
                ) ?
                    new Response("index-mirror")
                :   t.handler(url, init),
            ),
        );
        expect(fs.readFileSync(await fetchMetadata(t.config, mirrored), "utf8")).toBe(
            "index-mirror",
        );
        expect(fs.readdirSync(path.join(t.root, "cache", ".pins"))).toHaveLength(2);
        vi.stubGlobal("fetch", t.fetcher);
        t.wipe(file);
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(refused);
    });

    it("refuses a digest the forge publishes later that differs from the pin (H1)", async () => {
        const t = fresh("pin-h1.example.org");
        const file = await fetchMetadata(t.config, rel);
        t.wipe(file);
        t.state.index = "index-EVIL";
        t.state.digest = digest("index-EVIL");
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(/publishes a different digest/);
    });

    it("pins a first use whose checksum came from a forge digest (Q4)", async () => {
        const t = fresh("pin-q4.example.org");
        t.state.digest = digest("index");
        const file = await fetchMetadata(t.config, rel);
        expect(JSON.parse(fs.readFileSync(t.pinFileOf(), "utf8")).sha256).toBe(digest("index"));
        t.state.digest = undefined;
        t.state.index = "index-EVIL";
        t.wipe(file);
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(
            /does not match the checksum pinned/,
        );
    });

    it("re-pins from the intact stored index when the pin receipt is gone (Q5)", async () => {
        const t = fresh("pin-q5.example.org");
        const file = await fetchMetadata(t.config, rel);
        fs.rmSync(t.pinFileOf());
        t.fetcher.mockClear();
        expect(await fetchMetadata(t.config, rel)).toBe(file);
        expect(t.fetcher).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(t.pinFileOf(), "utf8")).sha256).toBe(digest("index"));
        t.wipe(file);
        t.state.index = "index-EVIL";
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(refused);
    });

    it("writes no pin on GitHub", async () => {
        const { config, root } = setup(
            githubServer(
                Response.json({
                    id: 3,
                    tag_name: "v1",
                    assets: [
                        {
                            id: 2,
                            browser_download_url: declaredIndex,
                            digest: `sha256:${digest("index")}`,
                        },
                    ],
                }),
            ),
        );
        await fetchMetadata(config, rel);
        expect(fs.existsSync(path.join(root, "cache", ".pins"))).toBe(false);
    });

    const identityFile = (t: ReturnType<typeof fresh>) =>
        path.join(
            t.root,
            "cache",
            ".pins",
            `${createHash("sha256")
                .update(
                    JSON.stringify({
                        forge: t.base,
                        mirror: null,
                        id: "example",
                        manifest: declaredManifest,
                    }),
                )
                .digest("hex")}.json`,
        );
    const pinBody = (t: ReturnType<typeof fresh>, sha256: string) =>
        JSON.stringify({
            identity: { forge: t.base, mirror: null, id: "example", manifest: declaredManifest },
            version: "1",
            index: declaredIndex,
            sha256,
        });

    it("refuses a first use that loses a race to a different pin, and leaves no temporary file", async () => {
        const t = fresh("pin-race.example.org");
        const server = world("pin-race.example.org");
        let raced = false;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => {
                if (url.endsWith("/index.jsonl") && !raced) {
                    raced = true;
                    fs.mkdirSync(path.dirname(identityFile(t)), { recursive: true });
                    fs.writeFileSync(identityFile(t), pinBody(t, digest("index-other-run")));
                }
                return t.handler(url, init) ?? server.handler(url, init);
            }),
        );
        await expect(fetchMetadata(t.config, rel)).rejects.toThrow(
            /^example: another fetch pinned a different content index for this release first\. To accept/,
        );
        expect(
            fs.readdirSync(path.dirname(identityFile(t))).filter((n) => n.endsWith(".tmp")),
        ).toEqual([]);
        expect(fs.existsSync(path.join(t.root, "cache", "example@1", ".complete"))).toBe(false);
    });

    it("accepts a first use that loses a race to the identical pin", async () => {
        const t = fresh("pin-race2.example.org");
        let raced = false;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => {
                if (url.endsWith("/index.jsonl") && !raced) {
                    raced = true;
                    fs.mkdirSync(path.dirname(identityFile(t)), { recursive: true });
                    fs.writeFileSync(identityFile(t), pinBody(t, digest("index")));
                }
                return t.handler(url, init);
            }),
        );
        expect(fs.readFileSync(await fetchMetadata(t.config, rel), "utf8")).toBe("index");
    });

    it("never follows a symlink planted at a temporary pin name", async () => {
        const t = fresh("pin-tmp.example.org");
        const target = path.join(t.root, "victim");
        fs.writeFileSync(target, "untouched");
        fs.mkdirSync(path.dirname(identityFile(t)), { recursive: true });
        fs.symlinkSync(target, `${identityFile(t)}.${process.pid}.tmp`);
        await fetchMetadata(t.config, rel);
        expect(fs.readFileSync(target, "utf8")).toBe("untouched");
    });

    it("names the dependency and the receipt once in a changed-release refusal", async () => {
        const t = fresh("pin-msg.example.org");
        const file = await fetchMetadata(t.config, rel);
        t.wipe(file);
        t.state.index = "index-EVIL";
        const error = await fetchMetadata(t.config, rel).catch((e) => e);
        expect(error.message).toMatch(/^example@1: the downloaded content index does not match/);
        expect(error.message.match(/[0-9a-f]{64}\.json/g)).toHaveLength(1);
        t.state.indexName = "index2.jsonl";
        const second = await fetchMetadata(t.config, rel).catch((e) => e);
        expect(second.message).toMatch(/^example@1: the release changed after/);
        expect(second.message.match(/[0-9a-f]{64}\.json/g)).toHaveLength(1);
    });

    it("accepts a later forge digest that agrees with the pin", async () => {
        const t = fresh("pin-h2.example.org");
        const file = await fetchMetadata(t.config, rel);
        t.wipe(file);
        t.state.digest = digest("index");
        expect(fs.readFileSync(await fetchMetadata(t.config, rel), "utf8")).toBe("index");
    });
});

describe("the Gitea version probe", () => {
    const probeUrl = (host: string) => `https://${host}/api/v1/version`;
    const probeFor = (host: string, answer: () => Response | Promise<Response>) =>
        setup((url) => (url === probeUrl(host) ? (answer() as Response) : undefined), {
            PACKAGE_BUILD_FORGE_URL: `https://${host}`,
        });
    it.each([
        [
            "redirects",
            () => new Response(null, { status: 302, headers: { location: "https://x.example/" } }),
        ],
        ["answers an error", () => new Response("boom", { status: 500 })],
        ["answers an oversized body", () => new Response(`{"version":"${"1".repeat(70_000)}"}`)],
    ])("refuses a host that %s", async (name, answer) => {
        const host = `probe-${String(name).replace(/\W/g, "")}.example.net`;
        const { config, fetcher } = probeFor(host, answer);
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/PACKAGE_BUILD_FORGE_URL names/);
        expect(fetcher.mock.calls.map(([url]) => url)).toEqual([probeUrl(host)]);
        expect(authOf(fetcher.mock.calls[0][1])).toBeUndefined();
        expect((fetcher.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
    });
    it("refuses a host whose probe fails or times out", async () => {
        const host = "probe-timeout.example.net";
        const { config } = setup(
            (url) => {
                if (url === probeUrl(host))
                    throw new DOMException("The operation timed out", "TimeoutError");
            },
            { PACKAGE_BUILD_FORGE_URL: `https://${host}` },
        );
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/could not be reached/);
    });
    it("probes a host once per process", async () => {
        const host = "probe-once.example.net";
        const { config, fetcher } = probeFor(host, () => new Response("nope"));
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/PACKAGE_BUILD_FORGE_URL names/);
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/PACKAGE_BUILD_FORGE_URL names/);
        expect(calls(fetcher, probeUrl(host))).toHaveLength(1);
    });
});

describe("manifest values that name cache paths", () => {
    const bad = [
        ["..", "..", "outside"].join("/"),
        "a/b",
        "..",
        "/abs",
        ".hidden",
        "v1\u0000x",
        "a\\b",
        7,
    ];
    const giteaWith = (version: unknown) =>
        giteaServer([asset({ digest: `sha256:${digest("index")}` })], () => undefined);
    const served =
        (version: unknown, base: Handler): Handler =>
        (url, init) =>
            url === giteaManifest ?
                Response.json({ version, flags: { metadataUrl: declaredIndex } })
            :   base(url, init);

    it.each(bad)(
        "refuses the manifest version %j on a Gitea forge and writes nothing outside the cache",
        async (version) => {
            const { config, root } = setup(served(version, giteaWith(version)), {
                PACKAGE_BUILD_FORGE_URL: GITEA,
            });
            const unverified = { id: "example", manifest: declaredManifest };
            await expect(fetchMetadata(config, unverified)).rejects.toThrow(
                /example: its manifest .*reports version .*not one plain version/,
            );
            expect(fs.readdirSync(root).sort()).toEqual(
                ["shared"].filter((n) => fs.existsSync(path.join(root, n))),
            );
        },
    );

    it("refuses a traversing manifest version on GitHub with the variable unset", async () => {
        const { config, root } = setup((url) =>
            url === declaredManifest ?
                Response.json({
                    version: ["..", "..", "outside"].join("/"),
                    flags: { metadataUrl: declaredIndex },
                })
            :   undefined,
        );
        await expect(
            fetchMetadata(config, { id: "example", manifest: declaredManifest }),
        ).rejects.toThrow(/not one plain version/);
        expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
        expect(fs.existsSync(path.join(path.dirname(root), "outside"))).toBe(false);
    });

    it("refuses a traversing compatibility.verified and a traversing dependency id", async () => {
        const { config, fetcher } = setup(() => undefined);
        await expect(
            fetchMetadata(config, { id: "example", manifest: declaredManifest, verified: "../x" }),
        ).rejects.toThrow(
            /example: compatibility\.verified \(declared for the manifest https:\/\/github\.com\/example\/repo\/releases\/download\/v1\/system\.json\) is "\.\.\/x", which is not one plain version/,
        );
        await expect(
            fetchMetadata(config, { id: "../evil", manifest: declaredManifest, verified: "1" }),
        ).rejects.toThrow(
            /a dependency id must be one plain name \(declared for the manifest https:/,
        );
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("refuses a traversing version when fetching an item catalogue", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-catalog-"));
        roots.push(root);
        setup((url) =>
            url === declaredManifest ?
                Response.json({
                    version: ["..", "..", "outside"].join("/"),
                    download: "https://github.com/x/y/releases/download/v1/p.zip",
                })
            :   undefined,
        );
        await expect(
            fetchCatalog(
                { paths: { foreignCache: path.join(root, "catalog") } },
                {
                    id: "example",
                    manifest: declaredManifest,
                },
            ),
        ).rejects.toThrow(/not one plain version/);
        expect(fs.existsSync(path.join(root, "catalog"))).toBe(false);
    });
});

describe("Item pack names and paths from a manifest", () => {
    const escaped = ["..", "..", "..", "escapedpack"].join("/");
    const archive = zipSync({ "readme.txt": new Uint8Array([1, 2, 3]) });
    const packManifest = (name: unknown, packPath = "packs/items") => ({
        version: "1",
        download: "https://github.com/example/repo/releases/download/v1/pack.zip",
        packs: [{ name, type: "Item", path: packPath }],
    });

    it.each([
        [
            "GitHub",
            declaredManifest,
            "https://github.com/example/repo/releases/download/v1/pack.zip",
            {},
        ],
        [
            "a Gitea forge",
            giteaManifest,
            `${GITEA}/example/repo/releases/download/v1/pack.zip`,
            { PACKAGE_BUILD_FORGE_URL: GITEA },
        ],
    ])(
        "refuses a traversing pack name on %s and writes nothing outside the cache",
        async (_n, manifestUrl, zipUrl, env) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pack-"));
            roots.push(root);
            setup(
                (url) =>
                    url === manifestUrl ? Response.json(packManifest(escaped))
                    : url === zipUrl ? new Response(archive)
                    : url === `${GITEA}/api/v1/version` ? Response.json({ version: "1" })
                    : undefined,
                env as Record<string, string>,
            );
            await expect(
                fetchCatalog({ paths: { foreignCache: path.join(root, "catalog") } }, rel),
            ).rejects.toThrow(
                /^example@1: its manifest \S+ declares the Item pack ".*escapedpack", which is not one plain name$/,
            );
            expect(fs.existsSync(path.join(root, "escapedpack"))).toBe(false);
        },
    );

    it("refuses a pack path that leaves the unpacked package", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pack-"));
        roots.push(root);
        const outside = path.join(root, "outside");
        fs.mkdirSync(outside);
        const archiveRoot = path.join(root, "archive");
        fs.mkdirSync(archiveRoot);
        expect(() => resolvePackPath(archiveRoot, "../outside", 'example@1: pack "a"')).toThrow(
            /pack "a" is declared at \.\.\/outside, which resolves outside the unpacked package/,
        );
        fs.symlinkSync(outside, path.join(archiveRoot, "link"));
        expect(() => resolvePackPath(archiveRoot, "link", 'example@1: pack "a"')).toThrow(
            /resolves outside the unpacked package/,
        );
        fs.mkdirSync(path.join(archiveRoot, "packs"));
        expect(resolvePackPath(archiveRoot, "packs")).toBe(path.join(archiveRoot, "packs"));
        expect(resolvePackPath(archiveRoot, "missing")).toBeNull();
    });

    it("reaches the pack-path refusal through a fetched archive", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pack-"));
        roots.push(root);
        setup((url) =>
            url === declaredManifest ?
                Response.json(packManifest("items", ["..", "..", "elsewhere"].join("/")))
            : url === "https://github.com/example/repo/releases/download/v1/pack.zip" ?
                new Response(archive)
            :   undefined,
        );
        await expect(
            fetchCatalog({ paths: { foreignCache: path.join(root, "catalog") } }, rel),
        ).rejects.toThrow(
            /resolves outside the unpacked package|which the package does not contain/,
        );
    });
});

describe("a numeric version", () => {
    it("is refused with a note to quote it", async () => {
        const { config, fetcher } = setup(() => undefined);
        await expect(
            fetchMetadata(config, {
                id: "example",
                manifest: declaredManifest,
                verified: 14 as never,
            }),
        ).rejects.toThrow(
            /compatibility\.verified .* is 14, which is not one plain version; write the version as a quoted string/,
        );
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("gives the schema check the same clear refusal", () => {
        expect(() =>
            cachedSchemaPath({ paths: { foreignCache: "/x" } }, "sohl", 14 as never),
        ).toThrow(
            /sohl: the version is 14, which is not one plain version; write the version as a quoted string/,
        );
    });
});

describe("what a refused fetch leaves behind", () => {
    it("writes no release record when the index fails its digest", async () => {
        const server = giteaServer([asset({ digest: `sha256:${digest("not-the-index")}` })]);
        const { config, root } = setup(server, { PACKAGE_BUILD_FORGE_URL: GITEA });
        await expect(fetchMetadata(config, rel)).rejects.toThrow(/SHA-256/);
        expect(fs.existsSync(path.join(root, "cache", "example@1", "release.json"))).toBe(false);
    });

    it("writes the release record once the index is accepted", async () => {
        const server = giteaServer([asset({ digest: `sha256:${digest("index")}` })]);
        const { config, root } = setup(server, { PACKAGE_BUILD_FORGE_URL: GITEA });
        await fetchMetadata(config, rel);
        expect(fs.existsSync(path.join(root, "cache", "example@1", "release.json"))).toBe(true);
    });
});

describe("a pin on a filesystem without hard links", () => {
    afterEach(() => vi.restoreAllMocks());
    const noLinks = () =>
        vi.spyOn(fs, "linkSync").mockImplementation(() => {
            throw Object.assign(new Error("not supported"), { code: "ENOTSUP" });
        });

    it("is still created exclusively in place", async () => {
        noLinks();
        const { config, root } = setup(giteaServer([asset()]), { PACKAGE_BUILD_FORGE_URL: GITEA });
        const file = await fetchMetadata(config, rel);
        const pins = fs.readdirSync(path.join(root, "cache", ".pins"));
        expect(pins).toHaveLength(1);
        expect(pins[0]).toMatch(/^[0-9a-f]{64}\.json$/);
        expect(
            JSON.parse(fs.readFileSync(path.join(root, "cache", ".pins", pins[0]), "utf8")).sha256,
        ).toBe(digest("index"));
        fs.rmSync(file);
    });

    it("never overwrites an existing pin", async () => {
        noLinks();
        const server = giteaServer([asset()]);
        let planted = "";
        const { config, root } = setup(
            (url, init) => {
                if (url === giteaIndex && !planted) {
                    const dir = path.join(root, "cache", ".pins");
                    fs.mkdirSync(dir, { recursive: true });
                    const identity = {
                        forge: GITEA,
                        mirror: null,
                        id: "example",
                        manifest: declaredManifest,
                    };
                    planted = path.join(
                        dir,
                        `${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.json`,
                    );
                    fs.writeFileSync(
                        planted,
                        JSON.stringify({
                            identity,
                            version: "1",
                            index: declaredIndex,
                            sha256: digest("someone-else"),
                        }),
                    );
                }
                return server(url, init);
            },
            { PACKAGE_BUILD_FORGE_URL: GITEA },
        );
        await expect(fetchMetadata(config, rel)).rejects.toThrow(
            /another fetch pinned a different/,
        );
        expect(JSON.parse(fs.readFileSync(planted, "utf8")).sha256).toBe(digest("someone-else"));
    });
});

describe("document keys inside a downloaded pack", () => {
    const packZip = async (entries: [string, object][]) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-leveldb-"));
        roots.push(root);
        const pack = path.join(root, "pack");
        const db = new ClassicLevel(pack, { keyEncoding: "utf8", valueEncoding: "json" });
        await db.open();
        for (const [key, doc] of entries) await db.put(key, doc);
        await db.close();
        const files: Record<string, Uint8Array> = {};
        for (const file of fs.readdirSync(pack))
            files[`packs/items/${file}`] = fs.readFileSync(path.join(pack, file));
        return { archive: zipSync(files), pack };
    };
    const manifestWith = {
        version: "1",
        download: "https://github.com/example/repo/releases/download/v1/pack.zip",
        packs: [{ name: "items", type: "Item", path: "packs/items" }],
    };
    const fetchPack = async (archive: Uint8Array, forge: "github" | "gitea") => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-keys-"));
        roots.push(root);
        const [manifestUrl, zipUrl] =
            forge === "github" ?
                [declaredManifest, manifestWith.download]
            :   [giteaManifest, `${GITEA}/example/repo/releases/download/v1/pack.zip`];
        setup(
            (url) =>
                url === manifestUrl ? Response.json(manifestWith)
                : url === zipUrl ? new Response(archive)
                : url === `${GITEA}/api/v1/version` ? Response.json({ version: "1" })
                : undefined,
            forge === "gitea" ? { PACKAGE_BUILD_FORGE_URL: GITEA } : {},
        );
        const dir = path.join(root, "catalog");
        return {
            root,
            run: () => fetchCatalog({ paths: { foreignCache: dir } }, rel),
        };
    };
    const traversal = ["..", "..", "..", "..", "..", "ESC", "k1"].join("/");

    it("names files exactly as the extractor does for ordinary ids", async () => {
        const entries: [string, object][] = [
            ["!items!abc123", { _id: "abc123", name: "Long Sword", type: "weapon" }],
            ["!items!def456", { _id: "def456", type: "weapon" }],
        ];
        const { archive, pack } = await packZip(entries);
        const t = await fetchPack(archive, "github");
        const dir = await t.run();
        const reference = path.join(t.root, "reference");
        fs.mkdirSync(reference);
        await extractPack(pack, reference, { log: false });
        const out = path.join(dir, "items", "items");
        expect(fs.readdirSync(out).sort()).toEqual(fs.readdirSync(reference).sort());
        for (const file of fs.readdirSync(reference))
            expect(fs.readFileSync(path.join(out, file), "utf8")).toBe(
                fs.readFileSync(path.join(reference, file), "utf8"),
            );
    });

    it.each(["github", "gitea"] as const)(
        "refuses a traversing document id on %s and writes nothing outside the cache",
        async (forge) => {
            const { archive } = await packZip([
                [`!items!${traversal}`, { _id: traversal, type: "weapon" }],
            ]);
            const t = await fetchPack(archive, forge);
            await expect(t.run()).rejects.toThrow(
                /^example@1: pack "items" of \S+ holds a document whose id ".*ESC\/k1" is not one plain name$/,
            );
            expect(fs.existsSync(path.join(t.root, "ESC"))).toBe(false);
            expect(fs.readdirSync(t.root).sort()).toEqual(["catalog"]);
        },
    );

    it.each(["github", "gitea"] as const)(
        "writes a document with a traversing key but a plain id inside the cache on %s",
        async (forge) => {
            const { archive } = await packZip([
                [`!items!${traversal}`, { _id: "a", name: "Foo", type: "weapon" }],
            ]);
            const t = await fetchPack(archive, forge);
            const dir = await t.run();
            expect(fs.readdirSync(path.join(dir, "items", "items"))).toEqual(["Foo_a.json"]);
            expect(fs.existsSync(path.join(t.root, "ESC"))).toBe(false);
        },
    );
});
