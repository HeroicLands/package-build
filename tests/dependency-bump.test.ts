/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Taking a newer version of a dependency.
 *
 * The cases that matter are the two failure modes this command exists to
 * remove: npm reformatting a lockfile every consumer indents with four spaces,
 * and a hand-patched lockfile being silently incomplete when the new version's
 * dependency set is not the old one's.
 *
 * npm is injected throughout — the suite reaches no registry, and a test that
 * needed one would be testing npm rather than this.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    bumpDependencies,
    declaredDependencies,
    detectJsonIndent,
    firstPartyDependencies,
    lockedVersion,
    reindentJsonFile,
} from "../engine/dependency-bump.mjs";

let root: string;

/** A consumer tree: a four-space manifest and a four-space lockfile. */
function consumer(
    deps: Record<string, string> = { "@heroiclands/package-build": "^20.0.0" },
    locked: Record<string, string> = { "@heroiclands/package-build": "20.6.0" },
    indent = "    ",
) {
    const manifest = { name: "consumer", version: "1.0.0", devDependencies: deps };
    const packages: Record<string, unknown> = { "": { name: "consumer" } };
    for (const [name, version] of Object.entries(locked)) {
        packages[`node_modules/${name}`] = {
            version,
            resolved: `https://registry.npmjs.org/${name}/-/x-${version}.tgz`,
            integrity: `sha512-${version}`,
        };
    }
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify(manifest, null, indent) + "\n",
    );
    fs.writeFileSync(
        path.join(root, "package-lock.json"),
        JSON.stringify({ name: "consumer", lockfileVersion: 3, packages }, null, indent) + "\n",
    );
}

/**
 * Stand in for npm: rewrite the lockfile the way `npm install` does — the new
 * version, and two-space indentation whatever it found.
 */
function npmThatBumpsTo(version: string) {
    return (_command: string, args: string[], cwd: string) => {
        const lockPath = path.join(cwd, "package-lock.json");
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        for (const spec of args.filter((a) => a.includes("@", 1))) {
            const name = spec.slice(0, spec.lastIndexOf("@"));
            const entry = lock.packages[`node_modules/${name}`];
            if (entry) entry.version = version;
        }
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    };
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-bump-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("reading a file's own formatting", () => {
    it("reports the indent a file already uses, rather than assuming npm's", () => {
        expect(detectJsonIndent('{\n    "a": 1\n}')).toBe("    ");
        expect(detectJsonIndent('{\n  "a": 1\n}')).toBe("  ");
        expect(detectJsonIndent('{\n\t"a": 1\n}')).toBe("\t");
    });

    it("falls back to npm's own default when there is nothing to read", () => {
        // A one-line document rewrites to two-space either way, so reporting
        // it is not a guess.
        expect(detectJsonIndent('{"a":1}')).toBe("  ");
    });

    it("rewrites a file's indentation without touching its content", () => {
        const file = path.join(root, "x.json");
        fs.writeFileSync(file, '{\n  "a": {\n    "b": 1\n  }\n}\n');
        expect(reindentJsonFile(file, "    ")).toBe(true);
        const after = fs.readFileSync(file, "utf8");
        expect(after).toContain('\n    "a"');
        expect(JSON.parse(after)).toEqual({ a: { b: 1 } });
        // Idempotent: nothing to do the second time.
        expect(reindentJsonFile(file, "    ")).toBe(false);
    });
});

describe("what a bump targets", () => {
    it("reads every section a range can be declared in", () => {
        expect(
            declaredDependencies({
                dependencies: { a: "1" },
                devDependencies: { b: "1" },
                optionalDependencies: { c: "1" },
            }),
        ).toEqual(["a", "b", "c"]);
    });

    it("defaults to the first-party packages, not everything", () => {
        // A third-party bump arrives from Dependabot on its own schedule. The
        // one a person runs by hand is the first-party release that just
        // published, usually to unblock the change that prompted it.
        const manifest = {
            devDependencies: {
                "@heroiclands/package-build": "^20.0.0",
                "@heroiclands/hugo-theme": "^0.5.0",
                prettier: "^3.9.6",
            },
        };
        expect(firstPartyDependencies(manifest)).toEqual([
            "@heroiclands/package-build",
            "@heroiclands/hugo-theme",
        ]);
    });

    it("reports the version the lockfile resolves, not the range declared", () => {
        // `npm ci` installs from the lockfile, so that is what a bump moves. A
        // caret range admitting the new version needs no manifest change at
        // all, and reading the range would report such a bump as changing
        // nothing.
        const lock = { packages: { "node_modules/x": { version: "2.1.0" } } };
        expect(lockedVersion(lock, "x")).toBe("2.1.0");
        expect(lockedVersion(lock, "absent")).toBeUndefined();
    });
});

describe("taking a newer version", () => {
    it("restores the lockfile's indentation after npm rewrites it", () => {
        // The whole reason this command exists: npm writes two-space, every
        // consumer here writes four and prettier-ignores the file, so the
        // three-line change arrives as a whole-file reformat.
        consumer();
        const result = bumpDependencies({
            rootDir: root,
            run: npmThatBumpsTo("20.7.0"),
        });

        const text = fs.readFileSync(path.join(root, "package-lock.json"), "utf8");
        expect(detectJsonIndent(text)).toBe("    ");
        expect(result.changes).toEqual([
            { name: "@heroiclands/package-build", from: "20.6.0", to: "20.7.0" },
        ]);
    });

    it("leaves a two-space consumer on two spaces", () => {
        // The restoration is of whatever was there, not of four spaces.
        consumer(
            { "@heroiclands/hugo-theme": "^0.5.0" },
            { "@heroiclands/hugo-theme": "0.5.0" },
            "  ",
        );
        bumpDependencies({ rootDir: root, run: npmThatBumpsTo("0.6.0") });
        expect(
            detectJsonIndent(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")),
        ).toBe("  ");
    });

    it("reports a version that did not move as unchanged rather than as a bump", () => {
        consumer();
        const result = bumpDependencies({
            rootDir: root,
            run: npmThatBumpsTo("20.6.0"),
        });
        expect(result.changes).toEqual([]);
        expect(result.unchanged).toEqual(["@heroiclands/package-build"]);
    });

    it("refuses a package the manifest does not depend on", () => {
        consumer();
        expect(() =>
            bumpDependencies({
                rootDir: root,
                packages: ["left-pad"],
                run: npmThatBumpsTo("1.0.0"),
            }),
        ).toThrow(/not a declared dependency: left-pad/);
    });

    it("refuses a tree with no lockfile, naming why the lockfile is the point", () => {
        consumer();
        fs.rmSync(path.join(root, "package-lock.json"));
        expect(() => bumpDependencies({ rootDir: root, run: npmThatBumpsTo("20.7.0") })).toThrow(
            /no package-lock\.json/,
        );
    });

    it("does nothing, rather than everything, when there is no first-party dependency", () => {
        consumer({ prettier: "^3.9.6" }, { prettier: "3.9.6" });
        const result = bumpDependencies({ rootDir: root, run: npmThatBumpsTo("9.9.9") });
        expect(result.changes).toEqual([]);
        expect(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")).toContain("3.9.6");
    });

    it("passes each named package to npm at the requested tag", () => {
        consumer(
            { "@heroiclands/package-build": "^20.0.0", "@heroiclands/hugo-theme": "^0.5.0" },
            { "@heroiclands/package-build": "20.6.0", "@heroiclands/hugo-theme": "0.5.0" },
        );
        const seen: string[] = [];
        bumpDependencies({
            rootDir: root,
            tag: "next",
            run: (command, args, cwd) => {
                seen.push([command, ...args].join(" "));
                npmThatBumpsTo("21.0.0")(command, args, cwd);
            },
        });
        expect(seen[0]).toBe(
            "npm install --package-lock-only @heroiclands/package-build@next @heroiclands/hugo-theme@next",
        );
    });
});
