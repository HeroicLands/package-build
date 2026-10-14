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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

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

const PUBLISH = ["cdn", "publish", "--set", "ai-art.json", "--name", "Test — illustrated"];

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
        expect(dry.stdout).toContain(`would upload ${PKG}/ai-art.json`);
        expect(putsAfterDryRun).toBe(0);
    });

    it("uploads every picture, shipped and left out, flat", () => {
        expect(first.stderr).toBe("");
        expect(first.status).toBe(0);
        expect(s3.unsigned).toBe(0);
        const pictures = [...s3.objects.keys()].filter((key) => key !== `${PKG}/ai-art.json`);
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
        const set = JSON.parse(String(s3.objects.get(`${PKG}/ai-art.json`)?.body));
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
        expect(second.stdout).toContain(`skipped ${PKG}/ai-art.json, unchanged`);
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
                const set = JSON.parse(String(store.objects.get(`${PKG}/ai-art.json`)?.body));
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
