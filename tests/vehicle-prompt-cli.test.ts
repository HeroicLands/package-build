/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { subprocessTimeout } from "./subprocess-timeout.js";
it("documents vehicle prompt options without loading configuration", () => {
    const env = { ...process.env };
    delete env.PACKAGE_BUILD_CONFIG;
    delete env.CONTENT_BUILD_CONFIG;
    const help = execFileSync(
        process.execPath,
        ["bin/package-build.mjs", "vehicle", "prompt", "--help"],
        { env, encoding: "utf8" },
    );
    for (const option of [
        "--model",
        "--seed",
        "--view",
        "flux-dev",
        "flux2-pro",
        "sdxl",
        "required",
        "stored",
        "seed",
    ])
        expect(help.toLowerCase()).toContain(option);
    const compact = help.toLowerCase().replace(/\s+/g, " ");
    expect(compact).toMatch(/required with --seed without a picture record/);
    expect(compact).toMatch(/required with --model without a picture record/);
    expect(compact).toMatch(/stored records refuse all model, seed, and view overrides/);
    expect(compact).toMatch(/omitted view is selected from the seed/);
    expect(compact).toMatch(/choices: "flux-dev", "flux2-pro", "sdxl"/);
});

it(
    "builds a transient prompt from indexed vehicle and item facts without writes",
    async () => {
        const { default: fs } = await import("node:fs");
        const { default: os } = await import("node:os");
        const { default: path } = await import("node:path");
        const { spawnSync } = await import("node:child_process");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "vehicle-prompt-"));
        try {
            fs.writeFileSync(
                path.join(root, "package.json"),
                JSON.stringify({ name: "demo", version: "1.0.0" }),
            );
            fs.writeFileSync(
                path.join(root, "package-build.config.yaml"),
                'contentPackage: demo\npackageKind: modules\ncompatibility: {minimum: "14.359"}\nstats: {lastModifiedBy: portraitbuild000}\npacks: [{name: journals, type: JournalEntry}]\n',
            );
            const content = path.join(root, "assets/content");
            fs.mkdirSync(content, { recursive: true });
            fs.writeFileSync(
                path.join(content, "rope.md"),
                "---\ntype: miscgear\nshortcode: rope\nname: {full: Rope}\ndata: {kind: miscgear, name: Rope}\n---\nRope.\n",
            );
            const source =
                "---\ntype: vehicle\nshortcode: cart\nname: {full: Cart}\ndata:\n  family: Cart\n  size: 1\n  locomotion: [wheeled]\n  role: [merchant]\n  capacity: 1\n  movementProperties: [{medium: terrestrial, rates: [{prob: 1, distance: 0, distUnit: feet, timeUnit: hour}]}]\n  items: [{model: miscgear-rope}]\n---\nCart.\n";
            const file = path.join(content, "cart.md");
            fs.writeFileSync(file, source);
            const run = (...args: string[]) =>
                spawnSync(
                    process.execPath,
                    [path.resolve("bin/package-build.mjs"), "vehicle", "prompt", ...args],
                    {
                        cwd: root,
                        env: {
                            ...process.env,
                            PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                        },
                        encoding: "utf8",
                    },
                );
            const first = run(
                "vehicle-cart",
                "--model",
                "sdxl",
                "--seed",
                "test",
                "--view",
                "side",
            );
            expect(first.status, first.stderr).toBe(0);
            expect(JSON.parse(first.stdout).positive).toContain("Rope");
            expect(
                run("vehicle-cart", "--model", "sdxl", "--seed", "test", "--view", "side").stdout,
            ).toBe(first.stdout);
            expect(run("vehicle-cart", "--model", "sdxl").status).not.toBe(0);
            expect(run("vehicle-missing", "--model", "sdxl", "--seed", "test").status).not.toBe(0);
            expect(run("vehicle-cart", "--model", "bad", "--seed", "test").status).not.toBe(0);
            fs.renameSync(file, path.join(content, "renamed.md"));
            expect(
                run("vehicle-cart", "--model", "sdxl", "--seed", "test", "--view", "side").stdout,
            ).toBe(first.stdout);
            fs.renameSync(path.join(content, "renamed.md"), file);
            fs.writeFileSync(file, source.replace("miscgear-rope", "being-absent"));
            const wrong = run("vehicle-cart", "--model", "sdxl", "--seed", "test");
            expect(wrong.status).not.toBe(0);
            expect(wrong.stderr).toMatch(/cart\.md:\d+:\d+: error:/);
            fs.writeFileSync(file, source);
            expect(fs.readFileSync(file, "utf8")).toBe(source);
            const { vehiclePromptFromData } = await import("../engine/vehicle-prompt.mjs");
            const YAML = (await import("yaml")).default;
            const missingImage = YAML.parse(source.split("---\n")[1]);
            missingImage.data.items = [{ name: "Rope", kind: "miscgear", img: "image-missing" }];
            fs.writeFileSync(file, `---\n${YAML.stringify(missingImage)}---\nCart.\n`);
            const invalidItemImage = run("vehicle-cart", "--model", "sdxl", "--seed", "test");
            expect(invalidItemImage.status).not.toBe(0);
            expect(invalidItemImage.stderr).toMatch(/cart\.md:\d+:\d+: error:/);
            missingImage.data.items[0].img = "being-cart";
            fs.writeFileSync(file, `---\n${YAML.stringify(missingImage)}---\nCart.\n`);
            const wrongItemImage = run("vehicle-cart", "--model", "sdxl", "--seed", "test");
            expect(wrongItemImage.status).not.toBe(0);
            expect(wrongItemImage.stderr).toMatch(/cart\.md:\d+:\d+: error:/);
            fs.writeFileSync(file, source);
            const picture = path.join(root, "assets/images/cart.png");
            fs.mkdirSync(path.dirname(picture), { recursive: true });
            fs.writeFileSync(picture, "image");
            fs.writeFileSync(
                path.join(path.dirname(picture), "provenance.yaml"),
                "attribution: Someone\nlicense: CC-BY-4.0\nai: false\n",
            );
            const fm = YAML.parse(source.split("---\n")[1]);
            fm.data.icon = "image-cart";
            fm.data.portraitSettings = { model: "sdxl", seed: "test", view: "side" };
            const result = vehiclePromptFromData(
                fm.data,
                [{ kind: "miscgear", name: "Rope" }],
                fm.data.items,
            );
            fm.data.portrait = { prompt: result.positive, negativePrompt: result.negative };
            fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\nCart.\n`);
            fm.data.icon = "image-missing";
            fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\nCart.\n`);
            const invalidPicture = run("vehicle-cart");
            expect(invalidPicture.status).not.toBe(0);
            expect(invalidPicture.stderr).toMatch(/cart\.md:\d+:\d+: error:/);
            fm.data.icon = "being-cart";
            fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\nCart.\n`);
            const wrongPicture = run("vehicle-cart");
            expect(wrongPicture.status).not.toBe(0);
            expect(wrongPicture.stderr).toMatch(/cart\.md:\d+:\d+: error:/);
            fm.data.icon = "image-cart";
            fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\nCart.\n`);
            const stored = run("vehicle-cart");
            expect(stored.status, stored.stderr).toBe(0);
            expect(JSON.parse(stored.stdout)).toEqual(result);
            for (const args of [
                ["--model", "sdxl"],
                ["--seed", "test"],
                ["--view", "side"],
            ])
                expect(run("vehicle-cart", ...args).status).not.toBe(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
    subprocessTimeout(15),
);
