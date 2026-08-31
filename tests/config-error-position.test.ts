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

/**
 * A configuration error names the **line** its key is on, not just the key.
 *
 * Every check in `content-config.mjs` and `config.mjs` reports through one
 * `fail()`, which knew the offending key's dotted path and nothing about where
 * that path was written. The position is resolvable — the source is YAML and
 * the loader knows which file it read — so it is attached once, at the loader,
 * for all of them (#95).
 *
 * These cases assert the two halves that matter: that the emitted line is the
 * `file:line:column: severity: message` form the rest of the build already
 * uses, and that the position it names is **true** — each case reads the line
 * back out of the file it wrote and requires the key to be on it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { CONFIG_BASENAME, configFromData, locateConfigError } from "../engine/pack-config.mjs";
import { yamlKeyPath, positionOfYamlPath } from "../engine/diagnostics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The smallest configuration body that resolves, as YAML lines. */
const MINIMAL = [
    "contentPackage: sohl",
    "packageKind: systems",
    "compatibility:",
    '    minimum: "14.359"',
    "stats:",
    "    lastModifiedBy: sohlbuilder00000",
    "packs:",
    "    - name: items",
    "      type: Item",
].join("\n");

/**
 * Write a throwaway repository whose configuration is exactly `text`.
 *
 * @returns The absolute path of the configuration file.
 */
function configFile(text: string, extension = "yaml"): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-pos-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    const file = path.join(root, `${CONFIG_BASENAME}.${extension}`);
    fs.writeFileSync(file, text, "utf8");
    return file;
}

/** Resolve a YAML configuration the way the loader does, and return the throw. */
function failureFor(text: string): { err: Error; file: string } {
    const file = configFile(text);
    try {
        configFromData(YAML.parse(text), file);
    } catch (err) {
        return { err: err as Error, file };
    }
    throw new Error("expected the configuration to be rejected");
}

/** The `line:column` a diagnostic names, parsed back out of its message. */
function locatorOf(message: string): { line: number; column: number } {
    const at = /:(\d+):(\d+): error: /.exec(message);
    if (!at) throw new Error(`no line:column locator in: ${message}`);
    return { line: Number(at[1]), column: Number(at[2]) };
}

/** What the file actually holds at a 1-based line and column. */
function textAt(source: string, line: number, column: number): string {
    return source.split("\n")[line - 1].slice(column - 1);
}

/**
 * Load a configuration through the real loader, in a fresh module registry.
 *
 * The loader memoises, so a second configuration in one process would be
 * ignored; resetting the registry gives each case its own loader.
 */
async function loadFresh(file: string): Promise<Error> {
    vi.resetModules();
    vi.stubEnv("PACKAGE_BUILD_CONFIG", file);
    const { loadPackageBuildConfig } = await import("../config.mjs");
    try {
        loadPackageBuildConfig();
    } catch (err) {
        return err as Error;
    }
    throw new Error("expected the configuration to be rejected");
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe("yamlKeyPath", () => {
    it("splits a dotted path into map keys", () => {
        expect(yamlKeyPath("site.sections.affliction.title")).toEqual([
            "site",
            "sections",
            "affliction",
            "title",
        ]);
    });

    it("reads a bracketed segment as a sequence index", () => {
        expect(yamlKeyPath("packs[0].name")).toEqual(["packs", 0, "name"]);
        expect(yamlKeyPath("relationships.systems[1].id")).toEqual([
            "relationships",
            "systems",
            1,
            "id",
        ]);
        expect(yamlKeyPath("packs[1].folders[2]")).toEqual(["packs", 1, "folders", 2]);
    });

    it("yields nothing for what is not a path", () => {
        expect(yamlKeyPath("")).toEqual([]);
        expect(yamlKeyPath(undefined as never)).toEqual([]);
    });
});

describe("positionOfYamlPath, addressing the key rather than its value", () => {
    const yaml = ["site:", "    sections:", "        gear: { title: X }", ""].join("\n");

    it("points at the declaring key when asked for it", () => {
        // The value is what a type error is about; the *key* is what a message
        // naming a field sends the reader to look for, and in a flow mapping
        // the two are different columns on the same line.
        expect(
            positionOfYamlPath(yaml, ["site", "sections", "gear", "title"], {
                key: true,
            }),
        ).toEqual({ line: 3, column: 17 });
        expect(positionOfYamlPath(yaml, ["site", "sections", "gear", "title"])).toEqual({
            line: 3,
            column: 24,
        });
    });

    it("still yields nothing when the key is not there", () => {
        expect(
            positionOfYamlPath(yaml, ["site", "sections", "nope"], {
                key: true,
            }),
        ).toEqual({});
    });
});

describe("a configuration error carries the position of its key", () => {
    it("locates an unrecognised key, path first", () => {
        const text = `${MINIMAL}\nsite:\n    sections:\n        gear: { title: Gear, descrption: Nope }\n`;
        const { err, file } = failureFor(text);

        expect(err.message).toBe(
            `${file}:12:30: error: package-build config: ` +
                "`site.sections.gear.descrption` is not a recognized option " +
                "(expected one of: title, banner, description).",
        );
        const { line, column } = locatorOf(err.message);
        expect(textAt(text, line, column)).toMatch(/^descrption/);
    });

    it("locates a wrong-typed value nested in a sequence", () => {
        const text = `${MINIMAL}\n    - name: 42\n      type: Item\n`;
        const { err } = failureFor(text);

        expect(err.message).toContain("`packs[1].name` must be a non-empty string.");
        const { line, column } = locatorOf(err.message);
        expect(textAt(text, line, column)).toMatch(/^name: 42/);
    });

    it("names the mapping a required key is missing from", () => {
        // There is no node for a key that was never written, so the position
        // names the entry that lacks it — the mapping the reader must edit —
        // rather than defaulting to a line that is not wrong.
        const text = `${MINIMAL}\n    - type: Item\n`;
        const { err } = failureFor(text);

        expect(err.message).toContain("`packs[1].name` must be a non-empty string.");
        const { line, column } = locatorOf(err.message);
        expect(textAt(text, line, column)).toMatch(/^type: Item/);
    });

    it("drops the position, keeping the file, for a missing top-level key", () => {
        const text = `${MINIMAL.split("\n").slice(0, 6).join("\n")}\n`;
        const { err, file } = failureFor(text);

        expect(err.message).toBe(
            `${file}: error: package-build config: \`packs\` must be an array.`,
        );
    });

    it("locates a key in the reserved packageBuild section", async () => {
        const text = `${MINIMAL}\npackageBuild:\n    container:\n        stages:\n            qa: { port: "30000" }\n`;
        const file = configFile(text);
        const err = await loadFresh(file);

        expect(err.message).toBe(
            `${file}:13:19: error: package-build config: ` +
                "`packageBuild.container.stages.qa.port` must be a number.",
        );
        const { line, column } = locatorOf(err.message);
        expect(textAt(text, line, column)).toMatch(/^port/);
    });

    it("locates it through the loader, not only through configFromData", async () => {
        const text = `${MINIMAL}\nskipDirectories: nope\n`;
        const file = configFile(text);
        const err = await loadFresh(file);

        expect(err.message).toBe(
            `${file}:10:1: error: package-build config: ` + "`skipDirectories` must be an array.",
        );
    });
});

describe("what cannot be located", () => {
    it("keeps the file and drops the position for an .mjs configuration", async () => {
        // There is no YAML text to resolve a key path against, and parsing JS
        // source as YAML would resolve some paths to positions that are not
        // there — which is worse than no position at all.
        const entry = path.join(HERE, "..", "content-config.mjs").split(path.sep).join("/");
        const file = configFile(
            [
                `import { defineConfig } from "file://${entry}";`,
                "export default defineConfig({",
                `    rootDir: ${JSON.stringify(os.tmpdir())},`,
                '    foundryPackage: "sohl",',
                '    contentPackage: "sohl",',
                '    packageKind: "systems",',
                '    packs: "nope",',
                "});",
            ].join("\n"),
            "mjs",
        );
        const err = await loadFresh(file);

        expect(err.message).toBe(
            `${file}: error: package-build config: \`packs\` must be an array.`,
        );
        // A dropped field must not leave an empty one behind: `file::` is a
        // malformed locator that no parser resolves.
        expect(err.message).not.toContain("::");
    });

    it("leaves an error that names no field alone", () => {
        const err = locateConfigError(new Error("something else"), "x.yaml");
        expect(err.message).toBe("something else");
    });

    it("decorates once, however many boundaries it crosses", () => {
        const text = `${MINIMAL}\n    - name: 42\n      type: Item\n`;
        const { err } = failureFor(text);
        const again = locateConfigError(err, "package-build.config.yaml");
        expect(again.message).toBe(err.message);
    });
});
