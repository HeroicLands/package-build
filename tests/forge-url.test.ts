/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    forgeAssetUrl,
    forgeFromUrl,
    forgeToken,
    forgeUrlProblem,
    resolveForge,
} from "../engine/forge-url.mjs";

describe("forge selection", () => {
    it("is GitHub when the variable is unset", () => {
        expect(resolveForge({}).kind).toBe("github");
    });
    it.each(["https://github.com", "https://github.com/", "https://api.github.com"])(
        "treats %s as GitHub",
        (url) => {
            expect(resolveForge({ PACKAGE_BUILD_FORGE_URL: url })).toMatchObject({
                kind: "github",
                origin: "https://github.com",
                apiOrigin: "https://api.github.com",
                tokenVariable: "PACKAGE_BUILD_GITHUB_API_TOKEN",
            });
        },
    );
    it("treats an empty variable as unset", () => {
        expect(resolveForge({ PACKAGE_BUILD_FORGE_URL: "" }).kind).toBe("github");
    });
    it.each([
        "https://www.github.com",
        "https://github.example.org",
        "https://my-github.net",
        "https://github.com:8443",
    ])("refuses the GitHub-looking host %s", (value) => {
        expect(forgeUrlProblem(value)).toMatch(/GitHub-looking/);
        expect(() => resolveForge({ PACKAGE_BUILD_FORGE_URL: value })).toThrow(
            /^PACKAGE_BUILD_FORGE_URL /,
        );
    });
    it("treats any other https host as Gitea", () => {
        expect(resolveForge({ PACKAGE_BUILD_FORGE_URL: "https://git.example.org" })).toMatchObject({
            kind: "gitea",
            origin: "https://git.example.org",
            tokenVariable: "PACKAGE_BUILD_FORGE_TOKEN",
        });
        expect(forgeFromUrl("https://forge.example.org:8443/").origin).toBe(
            "https://forge.example.org:8443",
        );
    });
    it.each([
        " ",
        "git.example.org",
        "http://git.example.org",
        "https://user:pw@git.example.org",
        "https://git.example.org/?a=b",
        "https://git.example.org/#frag",
        "https://git.example.org?",
        "https://git.example.org/sub",
        "ftp://git.example.org",
    ])("refuses %j by naming the variable", (value) => {
        expect(forgeUrlProblem(value)).not.toBe("");
        expect(() => resolveForge({ PACKAGE_BUILD_FORGE_URL: value })).toThrow(
            /^PACKAGE_BUILD_FORGE_URL /,
        );
    });
});

describe("forge tokens", () => {
    const gitea = forgeFromUrl("https://git.example.org");
    const github = forgeFromUrl("https://github.com");
    it("reads each forge's own variable", () => {
        const env = { PACKAGE_BUILD_FORGE_TOKEN: "abc", PACKAGE_BUILD_GITHUB_API_TOKEN: "def" };
        expect(forgeToken(gitea, env)).toBe("abc");
        expect(forgeToken(github, env)).toBe("def");
        expect(forgeToken(gitea, {})).toBeUndefined();
    });
    it("refuses an empty Gitea forge token and a malformed one", () => {
        expect(() => forgeToken(gitea, { PACKAGE_BUILD_FORGE_TOKEN: "" })).toThrow(
            /PACKAGE_BUILD_FORGE_TOKEN must contain one non-empty token/,
        );
        expect(() => forgeToken(gitea, { PACKAGE_BUILD_FORGE_TOKEN: "a b" })).toThrow(/non-empty/);
    });
});

describe("release asset URLs on a forge", () => {
    const gitea = forgeFromUrl("https://git.example.org");
    const declared = "https://github.com/o/r/releases/download/v1/index.jsonl";
    it("moves a declared GitHub release URL to the Gitea origin", () => {
        expect(forgeAssetUrl(gitea, declared)).toBe(
            "https://git.example.org/o/r/releases/download/v1/index.jsonl",
        );
    });
    it("leaves other URLs and GitHub alone", () => {
        expect(forgeAssetUrl(forgeFromUrl("https://github.com"), declared)).toBe(declared);
        expect(forgeAssetUrl(gitea, "https://example.com/o/r/releases/download/v1/x")).toBe(
            "https://example.com/o/r/releases/download/v1/x",
        );
    });
});
