/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("describes on-demand settlement inputs without loading project configuration", () => {
    const env = { ...process.env };
    delete env.PACKAGE_BUILD_CONFIG;
    delete env.CONTENT_BUILD_CONFIG;
    const help = execFileSync(process.execPath, ["bin/package-build.mjs", "settlement", "--help"], {
        env,
        encoding: "utf8",
    });
    for (const option of ["--polity", "--map", "--json", "--inputs", "--write"])
        expect(help).toContain(option);
});
