/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
it("imports settlement declarations and checks in a fresh process without configuration", () => {
    const env = { ...process.env };
    delete env.PACKAGE_BUILD_CONFIG;
    for (const name of ["settlement-tables", "note-vocabulary", "settlement-terms"]) {
        const file = fileURLToPath(new URL("../engine/" + name + ".mjs", import.meta.url));
        const result = spawnSync(
            process.execPath,
            ["--input-type=module", "-e", `await import(${JSON.stringify(file)})`],
            { env, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
    }
});
