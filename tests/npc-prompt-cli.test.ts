/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

const cli = path.resolve(__dirname, "../bin/package-build.mjs");

describe("npc prompt", () => {
    it(
        "builds deterministic separate prompt channels from indexed items",
        () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "portrait-cli-"));
            try {
                fs.writeFileSync(
                    path.join(root, "package.json"),
                    JSON.stringify({ name: "demo", version: "1.0.0" }),
                );
                fs.writeFileSync(
                    path.join(root, "package-build.config.yaml"),
                    `contentPackage: demo\npackageKind: modules\ncompatibility: {minimum: "14.359"}\nstats: {lastModifiedBy: portraitbuild000}\npacks: [{name: journals, type: JournalEntry}]\n`,
                );
                const content = path.join(root, "assets/content");
                fs.mkdirSync(content, { recursive: true });
                fs.writeFileSync(
                    path.join(content, "item.md"),
                    `---\nshortcode: lantern\nname: {full: Lantern}\ntype: miscgear\ndata: {kind: miscgear, name: lantern}\n---\n\nA lantern.\n`,
                );
                fs.writeFileSync(
                    path.join(content, "person.md"),
                    `---\nshortcode: person\nname: {full: Person}\ntype: being\nsubType: npc\ndata:\n  portraitSettings: {model: sdxl, seed: sample, ageBand: adult, extras: [stormy shore]}\n  appearance: {skin_color: brown, complexion: [freckled]}\n  items: [{model: miscgear-lantern}]\n---\n\nA person.\n`,
                );
                const run = (...args: string[]) =>
                    spawnSync(process.execPath, [cli, "npc", "prompt", ...args], {
                        cwd: root,
                        env: {
                            ...process.env,
                            PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                        },
                        encoding: "utf8",
                        timeout: SUBPROCESS_TEST_TIMEOUT,
                    });
                const first = run("being-person");
                expect(first.status, first.stderr).toBe(0);
                const output = JSON.parse(first.stdout);
                expect(output.positive).toContain("carrying lantern");
                expect(output.positive).toContain("stormy shore");
                expect(output.negative).toContain("cartoon");
                expect(run("being-person").stdout).toBe(first.stdout);
                expect(run("being-missing").status).not.toBe(0);
                fs.writeFileSync(
                    path.join(content, "unset.md"),
                    `---\nshortcode: unset\nname: {full: Person}\ntype: being\nsubType: npc\n---\n\nA person.\n`,
                );
                expect(run("being-unset").stderr).toContain("portraitSettings");
                fs.writeFileSync(
                    path.join(content, "missing-seed.md"),
                    `---\nshortcode: missingseed\nname: {full: Person}\ntype: being\nsubType: npc\ndata:\n  portraitSettings: {model: sdxl, ageBand: adult}\n---\n\nA person.\n`,
                );
                const missingSeed = run("being-missingseed");
                expect(missingSeed.status).not.toBe(0);
                expect(missingSeed.stderr).toMatch(
                    /missing-seed\.md:\d+:\d+: error: .*portraitSettings/,
                );
                fs.writeFileSync(
                    path.join(content, "other.md"),
                    `---\nshortcode: other\nname: {full: Other Person}\ntype: being\nsubType: npc\n---\n\nAnother person.\n`,
                );
                fs.writeFileSync(
                    path.join(content, "bad-item.md"),
                    `---\nshortcode: baditem\nname: {full: Person}\ntype: being\nsubType: npc\ndata:\n  portraitSettings: {model: sdxl, seed: sample, ageBand: adult}\n  items: [{model: being-other, kind: miscgear}]\n---\n\nA person.\n`,
                );
                const badItem = run("being-baditem");
                expect(badItem.status).not.toBe(0);
                expect(badItem.stderr).toMatch(/bad-item\.md:\d+:\d+: error: .*item note/);

                const note = (slug: string, details: string) =>
                    fs.writeFileSync(
                        path.join(content, `${slug}.md`),
                        `---\nshortcode: ${slug}\nname: {full: Person}\ntype: being\nsubType: npc\ndata:\n  portraitSettings: {model: sdxl, seed: 42, ageBand: adult${details === "extra" ? ", extras: [stormy shore, full-body pose]" : ""}}\n${
                            details === "feature" ?
                                "  appearance: {extra_features: [full-body pose]}\n"
                            : details === "item" ?
                                "  items: [{kind: miscgear, name: flat colors}]\n"
                            : details === "ink" ?
                                "  appearance: {extra_features: [ink-stained fingers]}\n  items: [{kind: miscgear, name: ink pot}]\n"
                            :   ""
                        }---\n\nA person.\n`,
                    );
                note("badextra", "extra");
                expect(run("being-badextra").stderr).toMatch(
                    /badextra\.md:\d+:\d+: error: .*portraitSettings\.extras\[1\]/,
                );
                note("badfeature", "feature");
                expect(run("being-badfeature").stderr).toMatch(
                    /badfeature\.md:\d+:\d+: error: .*appearance\.extra_features\[0\]/,
                );
                note("baddirection", "item");
                expect(run("being-baddirection").stderr).toMatch(
                    /baddirection\.md:\d+:\d+: error: .*items\[0\]\.name/,
                );
                note("inkmarks", "ink");
                const ink = run("being-inkmarks");
                expect(ink.status, ink.stderr).toBe(0);
                expect(JSON.parse(ink.stdout).positive).toContain("ink pot");
                const person = path.join(content, "person.md");
                fs.writeFileSync(
                    person,
                    fs
                        .readFileSync(person, "utf8")
                        .replace(
                            "  items:",
                            `  portrait:\n    prompt: ${JSON.stringify(output.positive)}\n    negativePrompt: ${JSON.stringify(output.negative)}\n  items:`,
                        ),
                );
                fs.writeFileSync(
                    path.join(content, "item.md"),
                    `---\nshortcode: lantern\nname: {full: Lantern}\ntype: miscgear\ndata: {kind: miscgear, name: changed lantern}\n---\n\nA lantern.\n`,
                );
                const updated = run("being-person");
                expect(JSON.parse(updated.stdout).positive).toContain("carrying changed lantern");
                const lint = spawnSync(process.execPath, [cli, "lint"], {
                    cwd: root,
                    env: {
                        ...process.env,
                        PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                    },
                    encoding: "utf8",
                    timeout: SUBPROCESS_TEST_TIMEOUT,
                });
                expect(lint.stdout + lint.stderr).toContain("portrait prompt is stale");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        subprocessTimeout(12),
    );
});
