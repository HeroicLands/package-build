/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { resolvePackageBuildConfig } from "../config.mjs";
import { buildConverterData, writeConverterData } from "../engine/converter-data.mjs";
import { encode, decode, validateData } from "../convert.mjs";
import { runContext, renderRuns } from "../engine/content-scripts.mjs";
import { encodeWithLanguage } from "../engine/encoding-language.mjs";
import { serializeLexicon } from "../engine/encoding-lexicon.mjs";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";
import { installEncodingNote, template, codes, encodingName } from "./helpers/encoding-note.js";
let root: string, config: any, records: any[];
beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "converter-note-"));
    ({ config, records } = installEncodingNote(root));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
describe("converter build artifact", () => {
    it("snapshots authored encoding data and selected font codes with only converter inputs", () => {
        const generated = buildConverterData(config, records);
        expect(validateData(generated)).toBe(generated);
        expect(generated.format).toBe(2);
        expect(generated.encodings[encodingName]).toEqual({ data: template, codes });
        expect(generated.languages.aelw).toMatchObject({ name: "Aelwythi" });
        expect(generated.languages.aelw).not.toHaveProperty("enc");
        expect(generated.languages.aelw.lexicon!.data).not.toHaveProperty("roman");
        const ctx = runContext(config, records),
            lexicon = serializeLexicon(ctx.lexicons!.get("aelw"));
        for (const form of ["say", "saith", "thikke", "Adwell"]) {
            const browser = encode(generated, "aelw", form, { enc: encodingName });
            expect(browser).toEqual(
                encodeWithLanguage(ctx.encodings!.get(encodingName), form, { lexicon }),
            );
            const rendered = renderRuns(`[${form}]{enc=aelwsemaronenc}`, ctx);
            expect(rendered.errors).toEqual([]);
            expect(rendered.markdown).toContain(browser.text);
            expect(decode(generated, "aelw", browser.text, { enc: encodingName }).findings).toEqual(
                [],
            );
        }
    });
    it("includes configured note-less languages for literal encoding documents", () => {
        const configured = {
            ...config,
            languages: { ...config.languages, zxx: { tag: "zxx" }, en: { tag: "en" } },
        };
        const literalNote = {
            ...records.find((record) => record.type === "doc"),
            shortcode: "literalenc",
            data: {
                language: "zxx",
                font: "semaron-kuriale",
                mappings: {},
                rules: { normalization: "NFC", matching: "longest-first" },
            },
        };
        const generated = buildConverterData(configured, [...records, literalNote]);
        expect(generated.languages.zxx).toEqual({ name: "zxx" });
        expect(generated.languages.en).toEqual({ name: "en" });
        expect(generated.languages.aelw.name).toBe("Aelwythi");
        expect(generated.languages.aelw.lexicon).toBeDefined();
        expect(generated.encodings["demo-note-doc-literalenc"].data.language).toBe("zxx");
        expect(validateData(generated)).toBe(generated);
        const source = "⟦ANKRON_MIN⟧";
        const native = encode(generated, "zxx", source, { enc: "literalenc" });
        expect(native.findings).toEqual([]);
        expect(decode(generated, "zxx", native.text, { enc: "literalenc" })).toEqual({
            text: source,
            findings: [],
        });
    });
    it("writes only opted-in snapshots beneath the package stage", () => {
        const packageBuild = resolvePackageBuildConfig({
            ...config,
            packageBuild: { converterData: "data/converter.json" },
        });
        const written = writeConverterData({ config, packageBuild, records })!;
        expect(written.path).toBe(path.join(root, "build/stage/data/converter.json"));
        expect(JSON.parse(fs.readFileSync(written.path, "utf8"))).toEqual(written.data);
        expect(
            writeConverterData({ config, packageBuild: { stageDir: "build/stage" }, records }),
        ).toBeUndefined();
    });
    it("refuses invalid encoding documents rather than omitting their payload", () => {
        const bad = records.map((record) =>
            record.type === "doc" ?
                { ...record, data: { ...record.data, font: "missing" } }
            :   record,
        );
        expect(() => buildConverterData(config, bad)).toThrow(/missing.*not installed/);
    });
    it("validates artifact paths before output writes", () => {
        for (const converterData of [
            "../outside.json",
            "/tmp/outside.json",
            "C:\\outside.json",
            "data/../../outside.json",
            "module.json",
            "system.json",
            "package.json",
            "data/",
            "data.txt",
            "",
        ])
            expect(() =>
                resolvePackageBuildConfig({ ...config, packageBuild: { converterData } }),
            ).toThrow(/converterData/);
    });
});
it(
    "the manifest command emits the same document snapshot",
    () => {
        const { rootDir, ...authoredConfig } = config;
        const actual = {
            ...authoredConfig,
            paths: { assets: "assets", content: "assets/content" },
            packageKind: "modules",
            compatibility: { minimum: "14.359" },
            stats: { lastModifiedBy: "demobuilder00000" },
            packs: [{ name: "items", type: "Item", label: "Items", default: true }],
            packageBuild: { manifest: { title: "Demo" }, converterData: "data/from-manifest.json" },
        };
        const file = path.join(root, "package-build.config.yaml");
        fs.writeFileSync(file, YAML.stringify(actual));
        const result = spawnSync(
            process.execPath,
            [new URL("../bin/package-build.mjs", import.meta.url).pathname, "manifest"],
            {
                cwd: root,
                encoding: "utf8",
                timeout: SUBPROCESS_TEST_TIMEOUT,
                env: { ...process.env, PACKAGE_BUILD_CONFIG: file },
            },
        );
        expect(result.status, result.stderr).toBe(0);
        const artifact = JSON.parse(
            fs.readFileSync(path.join(root, "build/stage/data/from-manifest.json"), "utf8"),
        );
        expect(artifact.encodings[encodingName]).toEqual({ data: template, codes });
    },
    SUBPROCESS_TEST_TIMEOUT,
);
