/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `package-build cdn publish` puts every picture on the CDN, flat, as the
 * stage would write it, and lists exactly the left-out ones in the set file.
 *
 * Driven through the command line against a throwaway repository and an
 * in-process S3 stub on the loopback interface, so the whole path — the
 * signing, the size check, the transform, the set — is the one a real run
 * takes, and nothing leaves the machine. The stub refuses any request not
 * signed with the fixture's key, so an unsigned upload fails here.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

import {
    s3Store,
    publicStore,
    internalStore,
    planCdnPublish,
    publishToCdn,
} from "../engine/cdn-publish.mjs";

import { subprocessTimeout } from "./subprocess-timeout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(HERE), "bin", "package-build.mjs");

const PKG = "tpkg";
const BUCKET = "cdn-bucket";
const KEY_ID = "TESTKEYID";
const SECRET = "test-secret-never-printed";

const record = (license: string, ai: boolean) =>
    YAML.stringify({ attribution: "Someone", license, ai });

/** Shipped: anvil, missing (icons), gate (image). Left out: bolt (icon), fort, hero (images). */
const PICTURES: Record<string, string> = {
    "assets/icons/game/provenance.yaml": record("CC-BY-3.0", false),
    "assets/icons/game/anvil.svg": '<svg fill="#000">anvil</svg>',
    "assets/icons/game/deep/bolt.svg": '<svg fill="#000">bolt</svg>',
    "assets/icons/game/deep/bolt.svg.yaml": record("CC-BY-3.0", true),
    "assets/icons/missing.svg": "<svg>missing</svg>",
    "assets/icons/missing.svg.yaml": record("LicenseRef-PublicDomain", false),
    "assets/images/provenance.yaml": record("LicenseRef-Proprietary", false),
    "assets/images/places/fort.png": "fort-bytes",
    "assets/images/places/gate.png": "gate",
    "assets/images/places/gate.png.yaml": record("CC-BY-SA-4.0", false),
    "assets/images/people/hero.png": "hero-bytes!",
    "assets/images/people/hero.png.yaml": record("CC-BY-4.0", true),
};

const ALL_KEYS = [
    `${PKG}/icons/anvil.svg`,
    `${PKG}/icons/bolt.svg`,
    `${PKG}/icons/missing.svg`,
    `${PKG}/images/fort.png`,
    `${PKG}/images/gate.png`,
    `${PKG}/images/hero.png`,
];

const NOTES: Record<string, string> = {
    // An art slot naming a left-out icon, and a body image naming a left-out image.
    "assets/content/bolt-being.md":
        "---\nname: Bolt\nshortcode: boltb\ntype: being\ndata:\n    icon: bolt\n---\n\n" +
        "Some prose.\n\n![Hero](images/people/hero.png)\n",
};

/** One stored object. */
interface StoredObject {
    body: Buffer;
    contentType: string;
}

/** The in-process S3 stub: path-style signed access, and public reads at `/<key>`. */
class FakeS3 {
    objects = new Map<string, StoredObject>();
    puts: string[] = [];
    unsigned = 0;
    /** Keys whose PUT the stub refuses. */
    refuse = new Set<string>();
    server = http.createServer((req, res) => this.handle(req, res));
    port = 0;

    async start() {
        await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
        this.port = (this.server.address() as any).port;
    }

    stop() {
        return new Promise<void>((resolve) => this.server.close(() => resolve()));
    }

    get url() {
        return `http://127.0.0.1:${this.port}`;
    }

    handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const pathname = decodeURIComponent(new URL(req.url ?? "/", this.url).pathname);
        const signed = pathname.startsWith(`/${BUCKET}/`);
        const key = signed ? pathname.slice(BUCKET.length + 2) : pathname.slice(1);
        if (signed) {
            const auth = String(req.headers.authorization ?? "");
            if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${KEY_ID}/`)) {
                this.unsigned++;
                res.writeHead(403).end();
                return;
            }
        } else if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405).end();
            return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            if (req.method === "PUT" && this.refuse.has(key)) {
                res.writeHead(500).end();
                return;
            }
            if (req.method === "PUT") {
                this.objects.set(key, {
                    body: Buffer.concat(chunks),
                    contentType: String(req.headers["content-type"] ?? ""),
                });
                this.puts.push(key);
                res.writeHead(200).end();
                return;
            }
            const object = this.objects.get(key);
            if (!object) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, {
                "content-length": String(object.body.length),
                "content-type": object.contentType,
            });
            res.end(req.method === "HEAD" ? undefined : object.body);
        });
    }
}

/** Write a file tree under a root. */
function writeTree(root: string, tree: Record<string, string>) {
    for (const [rel, body] of Object.entries(tree)) {
        const full = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body, "utf8");
    }
}

/** A throwaway repository whose CDN is the stub. */
function makeRepo(
    prefix: string,
    host: string,
    extra: Record<string, string> = {},
    build: Record<string, unknown> = {},
) {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    writeTree(repo, { ...PICTURES, ...NOTES, ...extra });
    // Rethemes every SVG, so a byte comparison proves the CDN holds the
    // transformed file rather than the source.
    writeTree(repo, {
        "utils/theme.mjs":
            'import fs from "node:fs";\n' +
            "export function transform(file) {\n" +
            '    if (!file.endsWith(".svg")) return null;\n' +
            '    return fs.readFileSync(file, "utf8").replaceAll("#000", "currentColor");\n' +
            "}\n",
    });
    fs.writeFileSync(
        path.join(repo, "package.json"),
        JSON.stringify({ name: PKG, version: "1.0.0", private: true }),
    );
    fs.writeFileSync(
        path.join(repo, "package-build.config.yaml"),
        YAML.stringify({
            contentPackage: PKG,
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "tpkgbuild0000000" },
            packs: [],
            site: { assets: host },
            packageBuild: {
                baseStyles: false,
                manifest: { title: "Test Package" },
                assets: [],
                assetTransform: "./utils/theme.mjs",
                ...build,
            },
        }),
    );
    return repo;
}

/** The environment a run sees: the parent's, minus any real store, plus `extra`. */
function environment(repo: string, extra: Record<string, string>) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith("CDN_") && value !== undefined) env[key] = value;
    }
    return {
        ...env,
        PACKAGE_BUILD_CONFIG: path.join(repo, "package-build.config.yaml"),
        ...extra,
    };
}

/** Run the command line asynchronously, so the stub in this process can answer. */
function run(repo: string, args: string[], env: Record<string, string>) {
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
            cwd: repo,
            env: environment(repo, env),
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
}

const PUBLISH = [
    "cdn",
    "publish",
    "--dest",
    "cloudflare",
    "--set",
    "alt-art.json",
    "--name",
    "Test — illustrated",
];

let s3: FakeS3;
let credentials: Record<string, string>;

beforeAll(async () => {
    s3 = new FakeS3();
    await s3.start();
    credentials = {
        CDN_ENDPOINT: s3.url,
        CDN_BUCKET: BUCKET,
        CDN_ACCESS_KEY_ID: KEY_ID,
        CDN_SECRET_ACCESS_KEY: SECRET,
    };
});

afterAll(async () => {
    await s3.stop();
});

describe("cdn publish", () => {
    let repo: string;
    let dry: Awaited<ReturnType<typeof run>>;
    let first: Awaited<ReturnType<typeof run>>;
    let second: Awaited<ReturnType<typeof run>>;
    let putsAfterDryRun: number;

    beforeAll(async () => {
        repo = makeRepo("package-build-cdn-", "https://cdn.example.test");
        dry = await run(repo, [...PUBLISH, "--dry-run"], credentials);
        putsAfterDryRun = s3.puts.length;
        first = await run(repo, PUBLISH, credentials);
        second = await run(repo, PUBLISH, credentials);
    }, subprocessTimeout(3));

    it("writes nothing on a dry run, and lists every picture it would upload", () => {
        expect(dry.stderr).toBe("");
        expect(dry.status).toBe(0);
        for (const key of ALL_KEYS) expect(dry.stdout).toContain(`would upload ${key}`);
        expect(dry.stdout).toContain(`would upload ${PKG}/alt-art.json`);
        expect(putsAfterDryRun).toBe(0);
    });

    it("uploads every picture, shipped and left out, flat", () => {
        expect(first.stderr).toBe("");
        expect(first.status).toBe(0);
        expect(s3.unsigned).toBe(0);
        const pictures = [...s3.objects.keys()].filter((key) => key !== `${PKG}/alt-art.json`);
        expect(pictures.sort()).toEqual(ALL_KEYS);
    });

    it("uploads the bytes the stage writes, transform applied", () => {
        expect(s3.objects.get(`${PKG}/icons/anvil.svg`)?.body.toString()).toBe(
            '<svg fill="currentColor">anvil</svg>',
        );
        expect(s3.objects.get(`${PKG}/images/fort.png`)?.body.toString()).toBe("fort-bytes");
        expect(s3.objects.get(`${PKG}/icons/anvil.svg`)?.contentType).toBe("image/svg+xml");
    });

    it("lists exactly the left-out pictures, with absolute sources and deployed targets", () => {
        const set = JSON.parse(String(s3.objects.get(`${PKG}/alt-art.json`)?.body));
        expect(set.name).toBe("Test — illustrated");
        expect(set.package).toBe(PKG);
        expect(set.assets).toEqual([
            {
                address: `${PKG}-none-icon-bolt`,
                source: "https://cdn.example.test/tpkg/icons/bolt.svg",
                target: "icons/bolt.svg",
                size: Buffer.byteLength('<svg fill="currentColor">bolt</svg>'),
            },
            {
                address: `${PKG}-none-image-fort`,
                source: "https://cdn.example.test/tpkg/images/fort.png",
                target: "images/fort.png",
                size: "fort-bytes".length,
            },
            {
                address: `${PKG}-none-image-hero`,
                source: "https://cdn.example.test/tpkg/images/hero.png",
                target: "images/hero.png",
                size: "hero-bytes!".length,
            },
        ]);
        for (const entry of set.assets) {
            expect(new URL(entry.source).href).toBe(entry.source);
            expect(entry.target).toMatch(/^(icons|images)\/[^/]+$/);
            expect(s3.objects.get(`${PKG}/${entry.target}`)?.body.length).toBe(entry.size);
        }
    });

    it("uploads nothing on a second run", () => {
        expect(second.status).toBe(0);
        expect(second.stdout).not.toMatch(/\buploaded tpkg\//);
        expect(second.stdout).toContain("Uploaded 0, skipped 6, failed 0");
        expect(second.stdout).toContain(`skipped ${PKG}/alt-art.json, unchanged`);
        expect(s3.puts.filter((key) => key.startsWith(`${PKG}/`))).toHaveLength(
            ALL_KEYS.length + 1,
        );
    });

    it("never prints the secret", () => {
        for (const out of [dry, first, second]) {
            expect(out.stdout + out.stderr).not.toContain(SECRET);
        }
    });
});

describe(
    "cdn publish refuses",
    () => {
        it("`default.json`, the shipped set's name", async () => {
            const repo = makeRepo("package-build-cdn-default-", "https://cdn.example.test");
            const out = await run(
                repo,
                ["cdn", "publish", "--set", "default.json", "--name", "X"],
                credentials,
            );
            expect(out.status).not.toBe(0);
            expect(out.stderr).toContain("`--set default.json` is refused");
        });

        it("a picture whose name is no address, naming the file", async () => {
            const repo = makeRepo("package-build-cdn-orphan-file-", "https://cdn.example.test", {
                "assets/images/places/Bad Name.png": "bad",
            });
            const before = s3.puts.length;
            const out = await run(repo, PUBLISH, credentials);
            expect(out.status).toBe(1);
            expect(out.stderr).toMatch(
                /^assets\/images\/places\/Bad Name\.png: error: "Bad Name" is not a shortcode/m,
            );
            expect(s3.puts.length).toBe(before);
        });

        it("an upload with no store configured", async () => {
            const repo = makeRepo("package-build-cdn-nostore-", "https://cdn.example.test");
            const out = await run(repo, PUBLISH, {});
            expect(out.status).not.toBe(0);
            expect(out.stderr).toContain("no CDN store is configured");
        });
    },
    subprocessTimeout(4),
);

describe(
    "cdn publish --dry-run without credentials",
    () => {
        it("compares against the public CDN and writes nothing", async () => {
            const repo = makeRepo("package-build-cdn-public-", s3.url);
            const before = s3.puts.length;
            const out = await run(repo, [...PUBLISH, "--dry-run"], {});
            expect(out.status).toBe(0);
            expect(out.stdout).toContain(`against ${s3.url}, read-only`);
            // The first suite left every picture in the stub at the same keys.
            expect(out.stdout).toContain("Would upload 0, skipped 6, failed 0");
            expect(s3.puts.length).toBe(before);
        });
    },
    subprocessTimeout(1),
);

describe(
    "cdn publish reports documents",
    () => {
        it("naming a picture the package does not have, at its line and column, and still publishes", async () => {
            const repo = makeRepo("package-build-cdn-orphan-note-", "https://cdn.example.test", {
                "assets/content/ghost.md":
                    "---\nname: Ghost\nshortcode: ghost\ntype: being\ndata:\n    icon: wraith\n---\n\n" +
                    "Text.\n\n![[image-nowhere|Nowhere]]\n",
            });
            const out = await run(repo, PUBLISH, credentials);
            expect(out.status).toBe(0);
            expect(out.stderr).toMatch(
                /^assets\/content\/ghost\.md:6:11: warning: `wraith` names a picture the `tpkg` package does not have/m,
            );
            expect(out.stderr).toMatch(
                /^assets\/content\/ghost\.md:11:1: warning: `image-nowhere`/m,
            );
            expect(out.stdout).toContain("skipped 6");
        });

        it("naming left-out art that did not upload, at the note, and withholds the set", async () => {
            const repo = makeRepo("package-build-cdn-unpublished-", "https://cdn.example.test");
            const empty = new FakeS3();
            empty.refuse.add(`${PKG}/images/hero.png`);
            await empty.start();
            try {
                const out = await run(repo, PUBLISH, { ...credentials, CDN_ENDPOINT: empty.url });
                expect(out.status).toBe(1);
                expect(out.stderr).toMatch(
                    /^assets\/images\/people\/hero\.png: error: tpkg\/images\/hero\.png did not upload: PUT tpkg\/images\/hero\.png answered 500/m,
                );
                expect(out.stderr).toMatch(
                    /^assets\/content\/bolt-being\.md:11:1: warning: `tpkg-none-image-hero` is left out of the package and is not on the CDN/m,
                );
                expect(out.stderr).not.toContain("tpkg-none-icon-bolt");
                expect([...empty.objects.keys()].sort()).toEqual(
                    ALL_KEYS.filter((key) => key !== `${PKG}/images/hero.png`),
                );
                expect(out.stdout).toContain("failed 1");
            } finally {
                await empty.stop();
            }
        });
    },
    subprocessTimeout(2),
);

describe(
    "cdn publish with licences the package adds",
    () => {
        it("leaves out of the set what the stage ships", async () => {
            const repo = makeRepo(
                "package-build-cdn-licences-",
                "https://cdn.example.test",
                {},
                {
                    shippingLicenses: ["LicenseRef-Proprietary"],
                },
            );
            const store = new FakeS3();
            await store.start();
            try {
                const out = await run(repo, PUBLISH, { ...credentials, CDN_ENDPOINT: store.url });
                expect(out.status).toBe(0);
                const set = JSON.parse(String(store.objects.get(`${PKG}/alt-art.json`)?.body));
                expect(set.assets.map((entry: any) => entry.target)).toEqual([
                    "icons/bolt.svg",
                    "images/hero.png",
                ]);
                expect(store.objects.has(`${PKG}/images/fort.png`)).toBe(true);
            } finally {
                await store.stop();
            }
        });
    },
    subprocessTimeout(1),
);

describe("store size()", () => {
    const stores = (fetchImpl: typeof fetch) => ({
        s3: s3Store({
            endpoint: "http://cdn.test",
            bucket: BUCKET,
            accessKeyId: KEY_ID,
            secretAccessKey: SECRET,
            fetch: fetchImpl,
        }),
        public: publicStore("http://cdn.test", fetchImpl),
    });

    for (const kind of ["s3", "public"] as const) {
        it(`${kind}: asks for the identity encoding, so the length is the object's`, async () => {
            let seen: Headers | undefined;
            const fetchImpl = (async (input: any, init: any) => {
                seen = new Headers(input instanceof Request ? input.headers : init?.headers);
                return new Response(null, { status: 200, headers: { "content-length": "3509" } });
            }) as typeof fetch;
            expect(await stores(fetchImpl)[kind].size("a/b.svg")).toBe(3509);
            expect(seen?.get("accept-encoding")).toBe("identity");
        });

        it(`${kind}: a 200 without a content-length is an unknown size`, async () => {
            const fetchImpl = (async () =>
                new Response(null, {
                    status: 200,
                    headers: { "content-encoding": "gzip" },
                })) as typeof fetch;
            expect(await stores(fetchImpl)[kind].size("a/b.svg")).toBeUndefined();
        });
    }
});

describe("internal CDN transport", () => {
    it("uploads the same transformed plan through rsync and skips an unchanged second run", async () => {
        const repo = makeRepo("package-build-internal-", "https://unused.test");
        const plan = planCdnPublish({
            assetsBase: path.join(repo, "assets"),
            contentPackage: PKG,
            host: "https://cdn.internal.heroiclands.org",
            setFile: "art.json",
            setName: "Internal",
            transform: (file: string) =>
                file.endsWith(".svg") ?
                    fs.readFileSync(file, "utf8").replace("#000", "currentColor")
                :   null,
        });
        const objects = new Map<string, Buffer>();
        const transfers: string[][] = [];
        const stagedPaths: string[] = [];
        const store = internalStore({
            destination: "preview-atlas:cdn",
            fetch: (async (url: string, init: RequestInit) => {
                const key = decodeURIComponent(new URL(url).pathname.slice(1));
                const body = objects.get(key);
                return body ?
                        new Response(init.method === "HEAD" ? null : body, {
                            headers: { "content-length": String(body.length) },
                        })
                    :   new Response(null, { status: 404 });
            }) as typeof fetch,
            transfer: async (args: string[]) => {
                transfers.push(args);
                for (const source of args.slice(args.indexOf("--") + 1, -1)) {
                    stagedPaths.push(source);
                    const root = source.split("/./")[0];
                    const relative = source.split("/./")[1];
                    const collect = (file: string) => {
                        if (fs.statSync(file).isDirectory()) {
                            for (const name of fs.readdirSync(file)) collect(path.join(file, name));
                        } else {
                            objects.set(path.relative(root, file), fs.readFileSync(file));
                        }
                    };
                    collect(path.join(root, relative));
                }
            },
        });
        const dry = await publishToCdn(plan, { store, dryRun: true });
        expect(dry.uploaded).toHaveLength(6);
        expect(transfers).toHaveLength(0);
        expect(objects.size).toBe(0);
        const first = await publishToCdn(plan, { store });
        expect(first.failed).toEqual([]);
        expect(first.uploaded).toHaveLength(6);
        expect(transfers).toHaveLength(2);
        expect(objects.get("tpkg/icons/anvil.svg")?.toString()).toContain('fill="currentColor"');
        expect(objects.get("tpkg/art.json")).toEqual(plan.set!.body);
        expect(JSON.parse(objects.get("tpkg/art.json")!.toString()).assets[0].source).toMatch(
            /^https:\/\/cdn.internal.heroiclands.org\//,
        );
        for (const args of transfers) {
            expect(args.at(-1)).toBe("preview-atlas:cdn/");
            expect(args).toContain("--relative");
            expect(args).toContain("--ignore-times");
            expect(args.join(" ")).toContain("StrictHostKeyChecking=yes");
            expect(args.join(" ")).not.toMatch(/--delete|--rsync-path|IdentityFile/);
        }
        expect(stagedPaths.every((file) => !fs.existsSync(file))).toBe(true);
        const second = await publishToCdn(plan, { store });
        expect(second.skipped).toHaveLength(6);
        expect(second.set).toBe("skipped");
        expect(transfers).toHaveLength(2);
    });

    it("rejects unsafe destinations and keys before a transfer", async () => {
        let calls = 0;
        const transfer = async () => {
            calls++;
        };
        for (const destination of [
            "-host:cdn",
            "atlas:../cdn",
            "atlas:cdn;id",
            "atlas:/other",
            "user:secret@atlas:cdn",
        ]) {
            expect(() => internalStore({ destination, transfer })).toThrow(/destination/);
        }
        const store = internalStore({ transfer });
        for (const key of [
            "../bad",
            "/absolute",
            "tpkg/../bad",
            "tpkg/./bad",
            "tpkg//bad",
            "tpkg/back\\slash",
            "tpkg/bad\nname",
        ]) {
            await expect(store.write!(key, Buffer.from("x"), "image/png")).rejects.toThrow(/key/);
        }
        expect(calls).toBe(0);
    });

    it("sanitizes transfer failures, cleans scratch and withholds the set", async () => {
        let staged = "";
        const store = internalStore({
            fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
            transfer: async (args: string[]) => {
                staged = args.at(-2)!;
                throw new Error("secret-in-ssh-error");
            },
        });
        const plan = {
            uploads: [
                {
                    key: "tpkg/images/a.png",
                    body: Buffer.from("a"),
                    address: "a",
                    contentType: "image/png",
                },
            ],
            set: { key: "tpkg/art.json", body: Buffer.from("{}"), set: { assets: [] } },
        };
        plan.uploads.push({ ...plan.uploads[0], key: "tpkg/images/b.png", address: "b" });
        const result = await publishToCdn(plan as any, { store });
        expect(result.uploaded).toEqual([]);
        expect(result.failed).toHaveLength(2);
        expect(result.published.size).toBe(0);
        expect(result.set).toBe("withheld");
        expect(result.failed[0].message).toMatch(/rsync.*failed/);
        expect(result.failed[0].message).not.toContain("secret-in-ssh-error");
        expect(fs.existsSync(staged)).toBe(false);
    });
});

describe("CDN destination CLI", () => {
    it(
        "dry-runs internal by default without SSH or R2 credentials",
        async () => {
            const repo = makeRepo("package-build-internal-dry-", "https://configured-public.test");
            const preload = path.join(repo, "fetch.mjs");
            fs.writeFileSync(
                preload,
                `globalThis.fetch = async (input) => {
            if (new URL(input).origin !== "https://cdn.internal.heroiclands.org") throw new Error("unexpected destination");
            return new Response(null, {status: 404});
        };`,
            );
            const fakeBin = path.join(repo, "bin");
            fs.mkdirSync(fakeBin);
            const marker = path.join(repo, "ssh-attempted");
            fs.writeFileSync(
                path.join(fakeBin, "rsync"),
                '#!/bin/sh\n: > "$CDN_TEST_MARKER"\nexit 17\n',
                { mode: 0o700 },
            );
            const out = await run(
                repo,
                ["cdn", "publish", "--set", "art.json", "--name", "Internal", "--dry-run"],
                {
                    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
                    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
                    CDN_TEST_MARKER: marker,
                    CDN_INTERNAL_DESTINATION: "unsafe:path",
                    CDN_ACCESS_KEY_ID: "half-configured-and-ignored",
                },
            );
            expect(out.stderr).toBe("");
            expect(out.status).toBe(0);
            expect(out.stdout).toContain("against https://cdn.internal.heroiclands.org, read-only");
            expect(out.stdout).toContain("Would upload 6, skipped 0, failed 0");
            expect(fs.existsSync(marker)).toBe(false);
        },
        subprocessTimeout(1),
    );
    it(
        "defaults to internal and rejects an unknown destination before publication",
        async () => {
            const repo = makeRepo("package-build-destination-", "https://unused.test");
            const help = await run(repo, ["cdn", "publish", "--help"], {});
            expect(help.status).toBe(0);
            expect(help.stdout).toMatch(
                /--dest[\s\S]*internal[\s\S]*cloudflare[\s\S]*default: "internal"/,
            );
            const defaultRun = await run(
                repo,
                ["cdn", "publish", "--set", "art.json", "--name", "Internal"],
                {
                    CDN_INTERNAL_DESTINATION: "unsafe:path",
                    CDN_ACCESS_KEY_ID: "half-configured-and-ignored",
                },
            );
            expect(defaultRun.status).not.toBe(0);
            expect(defaultRun.stderr).toContain("invalid internal CDN destination");
            expect(defaultRun.stderr).not.toContain("half configured");
            const bad = await run(repo, [...PUBLISH, "--dest", "elsewhere"], credentials);
            expect(bad.status).not.toBe(0);
            expect(bad.stderr).toContain("Invalid values");
        },
        subprocessTimeout(3),
    );
});

const HAS_RSYNC_RECEIVER =
    spawnSync("rsync", ["--version"]).status === 0 && spawnSync("rrsync", ["-h"]).status === 0;
it.skipIf(!HAS_RSYNC_RECEIVER)(
    "internal writes work with a forced write-only rrsync receiver",
    async () => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "package-build-rrsync-"));
        try {
            const root = path.join(scratch, "receiver");
            fs.mkdirSync(path.join(root, "cdn"), { recursive: true });
            fs.chmodSync(path.join(root, "cdn"), 0o700);
            fs.writeFileSync(path.join(root, "cdn", "unrelated.txt"), "keep");
            // Homebrew's receiver script names Apple's different /usr/bin/rsync.
            // Keep the installed receiver logic, selecting the same rsync as the sender.
            const find = (name: string) =>
                process.env
                    .PATH!.split(path.delimiter)
                    .map((dir) => path.join(dir, name))
                    .find((file) => fs.existsSync(file))!;
            const receiver = path.join(scratch, "rrsync");
            fs.writeFileSync(
                receiver,
                fs
                    .readFileSync(find("rrsync"), "utf8")
                    .replace(/^RSYNC = .*$/m, `RSYNC = ${JSON.stringify(find("rsync"))}`),
                { mode: 0o700 },
            );
            const transport = path.join(scratch, "transport");
            fs.writeFileSync(
                transport,
                '#!/bin/sh\nshift\nSSH_ORIGINAL_COMMAND="$*" exec "$CDN_TEST_RECEIVER" -wo -munge "$CDN_TEST_ROOT"\n',
                { mode: 0o700 },
            );
            const store = internalStore({
                destination: "restricted-atlas:cdn",
                transfer: async (args: string[]) => {
                    const result = spawnSync(
                        "rsync",
                        args.map((arg) => (arg.startsWith("--rsh=") ? `--rsh=${transport}` : arg)),
                        {
                            encoding: "utf8",
                            env: {
                                ...process.env,
                                CDN_TEST_ROOT: root,
                                CDN_TEST_RECEIVER: receiver,
                            },
                        },
                    );
                    expect(result.stderr).toBe("");
                    expect(result.status).toBe(0);
                },
            });
            await store.writeMany!([
                { key: "tpkg/icons/quote' space.svg", body: Buffer.from("first") } as any,
                { key: "tpkg/images/second.png", body: Buffer.from("second") } as any,
                { key: "other/images/third.png", body: Buffer.from("third") } as any,
            ]);
            expect(fs.readFileSync(path.join(root, "cdn/tpkg/images/second.png"), "utf8")).toBe(
                "second",
            );
            await store.write!("tpkg/art.json", Buffer.from("first"), "application/json");
            await store.write!("tpkg/art.json", Buffer.from("other"), "application/json");
            expect(
                fs.readFileSync(path.join(root, "cdn/tpkg/icons/quote' space.svg"), "utf8"),
            ).toBe("first");
            expect(fs.readFileSync(path.join(root, "cdn/tpkg/art.json"), "utf8")).toBe("other");
            expect(fs.readFileSync(path.join(root, "cdn/unrelated.txt"), "utf8")).toBe("keep");
            expect(fs.readFileSync(path.join(root, "cdn/other/images/third.png"), "utf8")).toBe(
                "third",
            );
            expect(fs.statSync(path.join(root, "cdn")).mode & 0o777).toBe(0o700);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    },
);

it("validates the whole plan before any read or write", async () => {
    let calls = 0;
    const store = {
        describe: "test",
        size: async () => {
            calls++;
            return undefined;
        },
        read: async () => {
            calls++;
            return undefined;
        },
        write: async () => {
            calls++;
        },
    };
    const valid = {
        key: "tpkg/images/a.png",
        body: Buffer.from("a"),
        address: "a",
        contentType: "image/png",
    };
    for (const plan of [
        { uploads: [valid, { ...valid, key: "tpkg/../outside" }], set: { key: "tpkg/art.json" } },
        { uploads: [valid], set: { key: "../outside.json" } },
    ]) {
        await expect(publishToCdn(plan as any, { store })).rejects.toThrow(/unsafe CDN key/);
    }
    expect(calls).toBe(0);
});

it("public reads encode each validated key segment", async () => {
    const seen: string[] = [];
    const store = publicStore("https://cdn.test", (async (url: string) => {
        seen.push(url);
        return new Response(null, { status: 404 });
    }) as typeof fetch);
    await store.read("tpkg/set #1?.json");
    expect(seen).toEqual(["https://cdn.test/tpkg/set%20%231%3F.json"]);
});

describe("internal publication failure diagnostics", () => {
    it.each([
        [255, "Host key verification failed."],
        [255, "Permission denied (publickey)."],
        [12, "rrsync error: untrusted transfer option refused"],
    ])("retains exit %s and actionable stderr", async (code, diagnostic) => {
        const store = internalStore({
            transfer: async () => {
                throw Object.assign(new Error("Command failed: rsync secret-argv"), {
                    code,
                    stderr: `debug command: secret-argv\n${diagnostic}\nrsync: connection unexpectedly closed\nrsync error: unexplained error (code ${code}) at io.c(232)\n`,
                });
            },
        });
        await expect(
            store.write!("tpkg/art.json", Buffer.from("{}"), "application/json"),
        ).rejects.toThrow(`exit ${code}: ${diagnostic}`);
    });

    it("bounds terminal-safe context and omits commands and private key material", async () => {
        const secret = "private-key-body-never-log";
        const store = internalStore({
            transfer: async () => {
                throw Object.assign(new Error(`Command failed: secret-argv ${secret}`), {
                    code: 255,
                    stderr: `-----BEGIN OPENSSH PRIVATE KEY-----\n${secret}\n-----END OPENSSH PRIVATE KEY-----\nCommand failed: secret-argv\n\u001b[31mPermission denied (publickey).\u001b[0m\r\n`,
                });
            },
        });
        let message = "";
        try {
            await store.write!("tpkg/art.json", Buffer.from("{}"), "application/json");
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain("exit 255: Permission denied (publickey).");
        expect(message).not.toMatch(/secret-argv|private-key|PRIVATE KEY|[\x00-\x1f\x7f-\x9f]/);
        expect(message.length).toBeLessThan(500);
    });

    it.each(["mkdtempSync", "writeFileSync"] as const)(
        "reports local %s EACCES without a path or original message",
        async (operation) => {
            const before = new Set(
                fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("package-build-cdn-")),
            );
            const spy = vi.spyOn(fs, operation).mockImplementation(() => {
                throw Object.assign(new Error("private-local-path"), { code: "EACCES" });
            });
            let calls = 0;
            const store = internalStore({
                transfer: async () => {
                    calls++;
                },
            });
            let message = "";
            try {
                await store.write!("tpkg/art.json", Buffer.from("{}"), "application/json");
            } catch (err) {
                message = (err as Error).message;
            } finally {
                spy.mockRestore();
            }
            expect(message).toContain("EACCES");
            expect(message).toContain(
                operation === "mkdtempSync" ? "create temporary directory" : "write staged file",
            );
            expect(message).not.toContain("private-local-path");
            expect(calls).toBe(0);
            expect(
                new Set(
                    fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("package-build-cdn-")),
                ),
            ).toEqual(before);
        },
    );
});

it("bounds long receiver context", async () => {
    const store = internalStore({
        transfer: async () => {
            throw Object.assign(new Error("argv-hidden"), {
                code: 12,
                stderr: "rrsync error: " + "receiver refused ".repeat(100),
            });
        },
    });
    let message = "";
    try {
        await store.write!("tpkg/art.json", Buffer.from("{}"), "application/json");
    } catch (err) {
        message = (err as Error).message;
    }
    expect(message).toContain("exit 12: rrsync error: receiver refused");
    expect(message.length).toBeLessThan(500);
});

it("reports installed rrsync's executable-prefixed refusal safely", async () => {
    const store = internalStore({
        transfer: async () => {
            throw Object.assign(new Error("argv-hidden"), {
                code: 12,
                stderr: '/usr/bin/rrsync error: invalid path "private-path"\nrsync error: error in rsync protocol data stream (code 12)\n',
            });
        },
    });
    await expect(
        store.write!("tpkg/art.json", Buffer.from("{}"), "application/json"),
    ).rejects.toThrow("exit 12: rrsync error: invalid path [redacted]");
});
