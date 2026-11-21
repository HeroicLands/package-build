/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { pathToFileURL } from "node:url";

it("imports the vehicle module and engine barrel independently in a bare consumer", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vehicle-import-"));
    try {
        const installed = path.join(root, "package");
        fs.mkdirSync(installed);
        const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
        for (const entry of manifest.files)
            if (fs.existsSync(entry))
                fs.cpSync(entry, path.join(installed, entry), { recursive: true });
        fs.copyFileSync("package.json", path.join(installed, "package.json"));
        const vitestCache = path.resolve("node_modules", ".vitest-cache");
        fs.cpSync("node_modules", path.join(root, "node_modules"), {
            recursive: true,
            filter: (source) => path.resolve(source) !== vitestCache,
        });
        const env = { ...process.env };
        delete env.PACKAGE_BUILD_CONFIG;
        delete env.CONTENT_BUILD_CONFIG;
        for (const file of ["engine/vehicle-prompt.mjs", "engine/index.mjs"]) {
            const url = pathToFileURL(path.join(installed, file)).href;
            expect(() =>
                execFileSync(
                    process.execPath,
                    ["--input-type=module", "-e", "await import(process.argv[1])", url],
                    { cwd: root, env, stdio: "pipe" },
                ),
            ).not.toThrow();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 120000);
