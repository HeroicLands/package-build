/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadCached } from "../engine/download-cache.mjs";
import { readPackConfig } from "../engine/pack-config.mjs";
import {
    buildUserAgent,
    fetchFollowingRedirects,
    userAgentDiagnostic,
    userAgentSettings,
} from "../engine/user-agent.mjs";
import { defineConfig } from "../index.mjs";

const dirs: string[] = [];
function repo(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "user-agent-test-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
}
beforeEach(() => {
    for (const name of [
        "PACKAGE_BUILD_USER_AGENT_URL",
        "PACKAGE_BUILD_USER_AGENT_EMAIL",
        "PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS",
    ])
        vi.stubEnv(name, "");
});
afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const client = /(undici|node)\/[0-9.]+$/;
const manifest = JSON.stringify({ name: "@scope/sample-repo", version: "1.2.3" });
const config = {
    userAgentUrl: "https://example.org/contact",
    userAgentEmail: "user@example.org",
    userAgentEmailHosts: ["wikimedia.org"],
};

describe("buildUserAgent", () => {
    it("sends the email to a listed host and to its subdomains", () => {
        const rootDir = repo({ "package.json": manifest });
        for (const url of [
            "https://wikimedia.org/a",
            "https://upload.wikimedia.org/a",
            "https://UPLOAD.Wikimedia.org./a",
        ]) {
            const header = buildUserAgent(url, { config, rootDir, env: {} });
            expect(header).toMatch(
                /^scope-sample-repo\/1\.2\.3 \(https:\/\/example\.org\/contact; user@example\.org\) /,
            );
            expect(header).toMatch(client);
        }
    });

    it("withholds the email from a host that is not listed", () => {
        const rootDir = repo({ "package.json": manifest });
        for (const url of [
            "https://example.com/a",
            "https://notwikimedia.org/a",
            "https://wikimedia.org.evil.com/a",
        ]) {
            const header = buildUserAgent(url, { config, rootDir, env: {} });
            expect(header).toContain("(https://example.org/contact) ");
            expect(header).not.toContain("user@example.org");
        }
    });

    it("sends no email when none is configured", () => {
        const rootDir = repo({ "package.json": manifest });
        const header = buildUserAgent("https://upload.wikimedia.org/a", {
            config: { ...config, userAgentEmail: null },
            rootDir,
            env: {},
        });
        expect(header).toMatch(/^scope-sample-repo\/1\.2\.3 \(https:\/\/example\.org\/contact\) /);
    });

    it("omits the parenthesised contact when there is no URL and no email", () => {
        const rootDir = repo({ "package.json": manifest });
        const header = buildUserAgent("https://example.com/a", { config: {}, rootDir, env: {} });
        expect(header).toMatch(/^scope-sample-repo\/1\.2\.3 (undici|node)\/[0-9.]+$/);
        expect(header).not.toContain("(");
    });

    it("lets the environment override each configured value", () => {
        const rootDir = repo({ "package.json": manifest });
        const header = buildUserAgent("https://api.example.net/a", {
            config,
            rootDir,
            env: {
                PACKAGE_BUILD_USER_AGENT_URL: "https://env.example.org/me",
                PACKAGE_BUILD_USER_AGENT_EMAIL: "env@example.org",
                PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS: "other.org, example.net",
            },
        });
        expect(header).toContain("(https://env.example.org/me; env@example.org)");
        expect(header).not.toContain("user@example.org");
        const unlisted = buildUserAgent("https://upload.wikimedia.org/a", {
            config,
            rootDir,
            env: { PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS: "example.net" },
        });
        expect(unlisted).not.toContain("user@example.org");
    });

    it("drops a contact that would break the header comment", () => {
        const rootDir = repo({ "package.json": manifest });
        const header = buildUserAgent("https://example.com/a", {
            config: {},
            rootDir,
            env: { PACKAGE_BUILD_USER_AGENT_URL: "bad) value" },
        });
        expect(header).not.toContain("(");
    });
});

describe("userAgentDiagnostic", () => {
    it("warns, located at the key, when the email has no host list", () => {
        const dir = repo({
            "package.json": JSON.stringify({ name: "docs-repo", version: "0.1.0" }),
            "package-build.config.yaml": [
                "contentPackage: docs",
                "packageKind: documentation",
                "userAgentEmail: user@example.org",
                "",
            ].join("\n"),
        });
        const loaded = readPackConfig(path.join(dir, "package-build.config.yaml"));
        const found = userAgentDiagnostic(loaded, {});
        expect(found).toMatchObject({
            file: path.join(dir, "package-build.config.yaml"),
            line: 3,
            column: 1,
            severity: "warning",
        });
        expect(found?.message).toMatch(/userAgentEmail is set but userAgentEmailHosts is empty/);
    });

    it("is silent when the list is present or no email is set", () => {
        expect(userAgentDiagnostic(config, {})).toBeUndefined();
        expect(userAgentDiagnostic({ userAgentEmailHosts: [] }, {})).toBeUndefined();
        expect(
            userAgentDiagnostic(
                { userAgentEmail: "user@example.org", userAgentEmailHosts: [] },
                { PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS: "example.org" },
            ),
        ).toBeUndefined();
    });
});

describe("downloadCached", () => {
    it("sends the header on every request, redirect hops included", async () => {
        const rootDir = repo({ "package.json": manifest });
        const bytes = Buffer.from("payload");
        const digest = createHash("sha256").update(bytes).digest("hex");
        const seen: [string, string][] = [];
        const fetcher = async (href: string, init: { headers: Record<string, string> }) => {
            seen.push([new URL(href).hostname, init.headers["user-agent"]]);
            return seen.length === 1 ?
                    new Response(null, {
                        status: 302,
                        headers: { location: "https://upload.wikimedia.org/file" },
                    })
                :   new Response(bytes, { headers: { "content-length": String(bytes.length) } });
        };
        await downloadCached("https://example.com/file", digest, {
            cacheDir: path.join(rootDir, "cache"),
            fetch: fetcher as any,
            config: { ...config, rootDir } as any,
        });
        expect(seen).toHaveLength(2);
        expect(seen[0][1]).toContain("(https://example.org/contact) ");
        expect(seen[1][1]).toContain("(https://example.org/contact; user@example.org) ");
    });
});

describe("fetchFollowingRedirects", () => {
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    async function run(first: string, hops: Record<string, string | null>) {
        const seen: [string, string][] = [];
        const fetcher = async (href: string, init: { headers: Record<string, string> }) => {
            const host = new URL(href).hostname;
            seen.push([host, init.headers["user-agent"]]);
            const to = hops[host];
            return to ? redirect(to) : new Response("ok");
        };
        await fetchFollowingRedirects(first, {}, { fetch: fetcher as any, config, env: {} });
        return seen;
    }

    it("does not pass the email from a listed host to an unlisted one", async () => {
        const seen = await run("https://upload.wikimedia.org/a", {
            "upload.wikimedia.org": "https://cdn.example.com/b",
        });
        expect(seen[0][1]).toContain("user@example.org");
        expect(seen[1][0]).toBe("cdn.example.com");
        expect(seen[1][1]).not.toContain("user@example.org");
        expect(seen[1][1]).toContain("https://example.org/contact");
    });

    it("adds the email for a listed host reached from an unlisted one", async () => {
        const seen = await run("https://cdn.example.com/a", {
            "cdn.example.com": "https://commons.wikimedia.org/b",
        });
        expect(seen[0][1]).not.toContain("user@example.org");
        expect(seen[1][1]).toContain("user@example.org");
    });

    it("never treats an appended domain as listed", async () => {
        const seen = await run("https://upload.wikimedia.org/a", {
            "upload.wikimedia.org": "https://wikimedia.org.evil.com/b",
        });
        expect(seen[1][1]).not.toContain("user@example.org");
    });

    it("keeps caller headers given as a Headers instance or an entries array", async () => {
        for (const headers of [
            new Headers({ "X-Probe": "1" }),
            [["X-Probe", "1"]] as [string, string][],
        ]) {
            const seen: Record<string, string>[] = [];
            await fetchFollowingRedirects(
                "https://a.example.com/x",
                { headers },
                {
                    fetch: (async (_href: string, init: { headers: Record<string, string> }) => {
                        seen.push(init.headers);
                        return new Response("ok");
                    }) as any,
                    config: {},
                    env: {},
                },
            );
            expect(seen[0]["x-probe"]).toBe("1");
            expect(seen[0]["user-agent"]).toBeTruthy();
        }
    });

    it("drops Authorization when a hop changes origin and refuses a redirect loop", async () => {
        const auths: (string | undefined)[] = [];
        const fetcher = async (href: string, init: { headers: Record<string, string> }) => {
            auths.push(init.headers.authorization);
            return new URL(href).hostname === "a.example.com" ?
                    redirect("https://b.example.com/x")
                :   new Response("ok");
        };
        await fetchFollowingRedirects(
            "https://a.example.com/x",
            { headers: { Authorization: "token t" } },
            { fetch: fetcher as any, config: {}, env: {} },
        );
        expect(auths).toEqual(["token t", undefined]);
        await expect(
            fetchFollowingRedirects(
                "https://a.example.com/x",
                {},
                {
                    fetch: (async () => redirect("https://a.example.com/x")) as any,
                    config: {},
                    env: {},
                },
            ),
        ).rejects.toThrow(/redirect limit/);
    });
});

describe("contact validation", () => {
    it("refuses one-label, numeric and malformed suffixes from the configuration", () => {
        const base = {
            rootDir: "/repo",
            contentPackage: "docs",
            packageKind: "documentation",
        } as any;
        for (const bad of ["org", "3.4", "a b.org", "example.123", "-x.org"])
            expect(() => defineConfig({ ...base, userAgentEmailHosts: [bad] })).toThrow(
                /userAgentEmailHosts\[0\]/,
            );
        expect(() => defineConfig({ ...base, userAgentEmail: "a\\b@example.org" })).toThrow(
            /backslashes/,
        );
        expect(() => defineConfig({ ...base, userAgentUrl: "https://exämple.org" })).toThrow(
            /visible ASCII/,
        );
        expect(
            defineConfig({ ...base, userAgentEmailHosts: ["*.wikimedia.org", ".example.org"] })
                .userAgentEmailHosts,
        ).toEqual(["*.wikimedia.org", ".example.org"]);
    });

    it("keeps the YAML location when a refused environment email leaves the configured one", () => {
        const dir = repo({
            "package.json": JSON.stringify({ name: "docs-repo", version: "0.1.0" }),
            "package-build.config.yaml":
                "contentPackage: docs\npackageKind: documentation\nuserAgentEmail: user@example.org\n",
        });
        const loaded = readPackConfig(path.join(dir, "package-build.config.yaml"));
        const found = userAgentDiagnostic(loaded, {
            PACKAGE_BUILD_USER_AGENT_EMAIL: "bad (value)",
        });
        expect(found).toMatchObject({ line: 3, column: 1 });
    });

    it("validates the environment host list and names the variable, never the value", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const rootDir = repo({ "package.json": manifest });
            const header = buildUserAgent("https://upload.wikimedia.org/a", {
                config,
                rootDir,
                env: {
                    PACKAGE_BUILD_USER_AGENT_EMAIL: "bad (value)@example.org",
                    PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS: "org,3.4,*.wikimedia.org",
                },
            });
            expect(header).toContain("user@example.org");
            const out = warn.mock.calls.map((call) => String(call[0])).join("\n");
            expect(out).toContain("PACKAGE_BUILD_USER_AGENT_EMAIL must be visible ASCII");
            expect(out).toContain("PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS has an entry");
            expect(out).not.toContain("bad (value)");
            expect(
                userAgentSettings(undefined, {
                    PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS: "org,3.4,*.Wikimedia.org",
                }).hosts,
            ).toEqual(["wikimedia.org"]);
        } finally {
            warn.mockRestore();
        }
    });
});
